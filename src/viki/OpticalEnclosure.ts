import * as THREE from 'three'
import type { HeadConfig } from './config'

/** Curved, ribbed optical pane. Transmission samples the scene behind this mesh. */
export class OpticalEnclosure {
  readonly mesh: THREE.Mesh
  private target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter })
  private material: THREE.ShaderMaterial
  private size = new THREE.Vector2()

  constructor() {
    const geometry = new THREE.PlaneGeometry(2.42, 2.52, 64, 64)
    const p = geometry.attributes.position
    for (let i = 0; i < p.count; i++) p.setZ(i, 1.04 + 0.055 * (1 - Math.pow(p.getX(i) / 1.21, 2)) * (1 - Math.pow(p.getY(i) / 1.26, 2)))
    geometry.computeVertexNormals()
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uScene: { value: this.target.texture }, uTime: { value: 0 },
        uRefraction: { value: 0.55 }, uDiffusion: { value: 0.6 },
        uRibs: { value: 0.65 }, uGrain: { value: 0.18 },
      },
      vertexShader: `
        varying vec2 vUv;
        varying vec4 vClip;
        void main() {
          vUv = uv;
          vClip = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_Position = vClip;
        }`,
      fragmentShader: `
        uniform sampler2D uScene;
        uniform float uTime, uRefraction, uDiffusion, uRibs, uGrain;
        varying vec2 vUv;
        varying vec4 vClip;
        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float noise(vec2 p) {
          vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1,0)), f.x), mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), f.x), f.y);
        }
        vec3 transmitted(vec2 uv) { return texture2D(uScene, clamp(uv, vec2(0.002), vec2(0.998))).rgb; }
        void main() {
          vec2 screen = vClip.xy / vClip.w * 0.5 + 0.5;
          float weave = noise(vUv * vec2(7.0, 46.0));
          float fiber = noise(vUv * vec2(210.0, 3.0));
          float phase = vUv.x * (940.0 + 1300.0 * uRibs) + weave * 2.4 + sin(vUv.y * 17.0) * 0.7;
          float ridge = sin(phase);
          float crossWeave = sin(vUv.y * 920.0 + sin(vUv.x * 70.0) * 0.8);
          // Local rib normals bend transmission anisotropically; the clean head is untouched.
          vec2 bend = vec2(ridge * 0.0007 + (fiber - 0.5) * 0.0012, crossWeave * 0.00025);
          // Keep only small optical imperfections: broad warping makes the face look rubbery.
          bend += vec2(noise(vUv * vec2(8, 19)) - 0.5, noise(vUv * vec2(13, 5)) - 0.5) * 0.004;
          vec2 uv = screen + bend * uRefraction;
          float roughness = uDiffusion * (0.00035 + 0.00085 * fiber);
          vec3 color = transmitted(uv) * 0.22;
          // A narrow transmission lobe across the ribs, plus weaker vertical diffusion.
          for (int i = 1; i <= 3; i++) {
            float f = float(i);
            vec2 spread = vec2(roughness * f, roughness * crossWeave * 0.35);
            color += (transmitted(uv + spread) + transmitted(uv - spread)) * 0.10;
          }
          color += (transmitted(uv + vec2(0, roughness * 2.5)) + transmitted(uv - vec2(0, roughness * 2.5))) * 0.09;
          float light = dot(color, vec3(0.2126, 0.7152, 0.0722));
          // Scattered highlight spill is modulated by the material, never a full-frame blur.
          float spill = dot(transmitted(uv + vec2(roughness * 5.0, roughness)), vec3(0.2126, 0.7152, 0.0722));
          light += max(spill - 0.13, 0.0) * uDiffusion * 0.10;
          light *= (0.68 + 0.24 * fiber + 0.035 * ridge + 0.015 * crossWeave);
          light *= 0.83 + 0.17 * noise(vUv * vec2(12, 28));
          light = max(0.0, light - 0.0035);
          float edge = 1.0 - smoothstep(0.48, 0.75, length((vUv - 0.5) * vec2(1.05, 0.90)));
          float haze = 0.009 * (0.35 + 0.65 * noise(vUv * vec2(3, 7))) * edge;
          float grain = (hash(floor(vUv * vec2(1100, 1200)) + floor(uTime * 12.0)) - 0.5) * uGrain * 0.007;
          vec3 tint = vec3(0.77, 0.87, 0.91);
          color = tint * max(0.0, light * edge + haze + grain);
          // Fade the pane boundary into the scene instead of drawing a glass rectangle.
          float boundary = smoothstep(0.0, 0.10, min(min(vUv.x, 1.0-vUv.x), min(vUv.y, 1.0-vUv.y)));
          gl_FragColor = vec4(color, boundary);
        }`,
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
    })
    this.mesh = new THREE.Mesh(geometry, this.material)
    this.mesh.renderOrder = 5
    this.mesh.frustumCulled = false
    this.mesh.visible = false
  }

  applyConfig(cfg: HeadConfig) {
    const u = this.material.uniforms
    u.uRefraction.value = cfg.refraction
    u.uDiffusion.value = cfg.diffusion
    u.uRibs.value = cfg.glassRibs
    u.uGrain.value = cfg.filmGrain
  }

  capture(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, time: number) {
    if (!this.mesh.visible) return
    renderer.getDrawingBufferSize(this.size)
    // Native resolution preserves the material ridges; diffusion happens at transmission samples.
    if (this.target.width !== this.size.x || this.target.height !== this.size.y) this.target.setSize(this.size.x, this.size.y)
    const previous = renderer.getRenderTarget()
    this.mesh.visible = false
    try {
      renderer.setRenderTarget(this.target)
      renderer.clear()
      renderer.render(scene, camera)
    } finally {
      renderer.setRenderTarget(previous)
      this.mesh.visible = true
    }
    this.material.uniforms.uTime.value = time
  }

  dispose() { this.mesh.geometry.dispose(); this.material.dispose(); this.target.dispose() }
}
