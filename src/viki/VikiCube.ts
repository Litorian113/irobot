import * as THREE from 'three'
import type { HeadConfig } from './config'

const vertex = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

const fragment = /* glsl */ `
uniform sampler2D uFace;
uniform vec3 uShadow, uSilver, uHighlight;
uniform float uTime, uFormation, uDensity, uCellSize, uGain, uField, uFlow, uSpeed, uMirror, uSide, uDiffusion;
varying vec2 vUv;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
vec2 faceUv(vec2 uv) {
  uv.x = mix(uv.x, 1.0 - uv.x, uMirror);
  return (uv - 0.5) * 0.86 + vec2(0.5, 0.535);
}
void main() {
  vec2 cells = vec2(uDensity, uDensity * 1.16);
  vec2 grid = vUv * cells;
  float footprint = max(fwidth(grid.x), fwidth(grid.y));
  vec2 id = floor(grid);
  vec2 center = (id + 0.5) / cells;
  float grain = hash(id + vec2(uSide * 41.0, 7.0));
  // Average unresolved cell variations on small screens / grazing faces instead of aliasing.
  grain = mix(grain, 0.57735, smoothstep(0.8, 1.8, footprint));
  vec2 p = abs(fract(grid) - 0.5);
  vec2 aa = max(fwidth(grid) * 0.65, vec2(0.045 + uDiffusion * 0.06));
  vec2 radius = clamp(vec2(0.32, 0.39) * uCellSize * mix(0.78, 1.08, grain), vec2(0.17), vec2(0.46));
  vec2 tile = 1.0 - smoothstep(radius - aa, radius + aa, p);
  float aperture = tile.x * tile.y;
  aperture = mix(aperture, 4.0 * radius.x * radius.y, smoothstep(0.8, 1.5, footprint));

  vec2 uv = faceUv(center);
  float spread = 0.001 + uDiffusion * 0.003;
  vec4 face = texture2D(uFace, uv);
  float light = face.g * 0.6;
  light += (texture2D(uFace, uv + vec2(spread, 0)).g + texture2D(uFace, uv - vec2(spread, 0)).g) * 0.2;

  // Sparse packets travel along individual columns. They modulate cells, never face geometry.
  float column = hash(vec2(id.x, uSide + 8.0));
  float time = uTime * uSpeed;
  float head = fract(column + time * (0.045 + column * 0.055));
  float distance = abs(fract(center.y - head + 0.5) - 0.5);
  float packet = 1.0 - smoothstep(0.005, 0.055, distance);
  float trail = exp(-fract(head - center.y + 1.0) * 24.0);
  float crawl = sin(id.y * 1.63 + id.x * 0.19 - time * 2.7) * 0.5 + 0.5;
  float activity = uFlow * (packet * 0.75 + trail * 0.25 + crawl * 0.12);
  float variation = 0.16 + 1.45 * grain * grain;
  float faceLight = pow(max(light, 0.0), 1.12) * uFormation;
  // Keep the sockets dark: moving data there stays much weaker than on the lit face.
  float field = uField * mix(0.11, 0.014, face.b * uFormation);
  float energy = (field + faceLight * 1.45) * (variation + activity);
  float boundary = min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y));
  float edge = smoothstep(0.0, 0.024, boundary);
  float veil = 0.68 + 0.32 * sin(center.x * 9.0 + uSide) * sin(center.y * 6.5 + 0.7);
  energy *= mix(veil, 1.0, faceLight) * edge;

  // Silvery green-gray phosphor on a nearly black optical substrate.
  vec3 tint = mix(uSilver, uHighlight, smoothstep(0.25, 0.75, faceLight) * 0.65);
  // A narrow diffusion halo belongs to each tile; no displacement of the facial features.
  float halo = exp(-dot(p / vec2(0.39, 0.47), p / vec2(0.39, 0.47)) * 2.0);
  vec3 color = tint * energy * (0.055 + 0.86 * aperture + 0.16 * halo) * uGain;
  color += uShadow * (0.018 + field * 0.15) * edge;
  gl_FragColor = vec4(color, 1.0);
}
`

/** Six outward-facing optical displays sharing one live, animated portrait texture. */
export class VikiCube {
  readonly group = new THREE.Group()
  private geometry = new THREE.PlaneGeometry(2, 2)
  private materials: THREE.ShaderMaterial[] = []

  constructor(face: THREE.Texture) {
    const faces = [
      { name: 'front', position: [0, 0, 1], rotation: [0, 0, 0], mirror: 0 },
      { name: 'right', position: [1, 0, 0], rotation: [0, Math.PI / 2, 0], mirror: 1 },
      { name: 'back', position: [0, 0, -1], rotation: [0, Math.PI, 0], mirror: 0 },
      { name: 'left', position: [-1, 0, 0], rotation: [0, -Math.PI / 2, 0], mirror: 1 },
      { name: 'top', position: [0, 1, 0], rotation: [-Math.PI / 2, 0, 0], mirror: 0 },
      { name: 'bottom', position: [0, -1, 0], rotation: [Math.PI / 2, 0, 0], mirror: 1 },
    ]
    for (const [side, faceSide] of faces.entries()) {
      const material = new THREE.ShaderMaterial({
        vertexShader: vertex, fragmentShader: fragment,
        uniforms: {
          uFace: { value: face }, uTime: { value: 0 }, uFormation: { value: 0 },
          uShadow: { value: new THREE.Color() }, uSilver: { value: new THREE.Color() }, uHighlight: { value: new THREE.Color() },
          uDensity: { value: 92 }, uCellSize: { value: 1 }, uGain: { value: 1.4 }, uField: { value: 0.7 },
          uFlow: { value: 0.55 }, uSpeed: { value: 0.7 }, uMirror: { value: faceSide.mirror },
          uSide: { value: side }, uDiffusion: { value: 0.45 },
        },
        // Outward faces occlude the far faces, so their portraits cannot leak through each other.
        side: THREE.FrontSide, depthWrite: true,
      })
      const panel = new THREE.Mesh(this.geometry, material)
      panel.name = `VIKI-${faceSide.name}`
      panel.position.fromArray(faceSide.position)
      panel.rotation.set(faceSide.rotation[0], faceSide.rotation[1], faceSide.rotation[2])
      panel.frustumCulled = false
      this.materials.push(material)
      this.group.add(panel)
    }
    this.group.visible = false
  }

  applyConfig(cfg: HeadConfig) {
    this.group.scale.set(1, 1, cfg.cubeDepth)
    for (const material of this.materials) {
      const u = material.uniforms
      u.uShadow.value.set(cfg.colorA)
      u.uSilver.value.set(cfg.colorB)
      u.uHighlight.value.set(cfg.colorC)
      u.uDensity.value = 48 + 70 * cfg.density
      u.uCellSize.value = cfg.cellSize
      u.uGain.value = cfg.gain
      u.uField.value = cfg.cage
      u.uFlow.value = cfg.dataFlow ?? 0.55
      u.uSpeed.value = cfg.flowSpeed ?? 0.7
      u.uDiffusion.value = cfg.diffusion
    }
  }

  update(time: number, formation: number) {
    for (const material of this.materials) {
      material.uniforms.uTime.value = time
      material.uniforms.uFormation.value = formation
    }
  }

  dispose() { for (const material of this.materials) material.dispose(); this.geometry.dispose() }
}
