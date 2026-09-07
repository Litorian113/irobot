import * as THREE from 'three'
import type { HeadConfig } from './config'

const vertex = /* glsl */ `
uniform sampler2D uFront;
uniform float uTime;
uniform float uFormation;
uniform float uBrightness;
uniform float uDepth;
uniform float uGap;
uniform float uPointSize;
uniform float uFlicker;
uniform float uOptical;
attribute float aSeed;
varying float vBrightness;
void main() {
  vec3 p = position * vec3(1.0 + uGap, 1.0 + uGap, uDepth);
  vec4 face = texture2D(uFront, p.xy * 0.5 + 0.5);
  float frontal = smoothstep(0.25, 0.9, dot(normalize(modelMatrix[2].xyz), normalize(cameraPosition)));
  float nearFace = exp(-pow((p.z - face.r) / 0.085, 2.0)) * face.b;
  float twinkle = 0.72 + 0.28 * sin(aSeed * 97.0 + uTime * (0.4 + aSeed * 0.25));
  float outer = smoothstep(0.65, 1.0, max(abs(position.x), abs(position.y)));
  // Keep the cube legible outside the portrait; only a few quiet cells remain in front of it.
  float visibility = 1.0 - mix(0.94, 0.87, uOptical) * face.b * frontal * uFormation;
  vBrightness = uBrightness * (0.035 + 0.15 * aSeed * aSeed + 0.05 * outer) * visibility;
  vBrightness += uBrightness * nearFace * face.g * 0.12 * uFormation;
  vBrightness *= mix(1.0, twinkle, uFlicker);
  vBrightness *= 0.45 + 0.35 * (position.z * 0.5 + 0.5);
  // Reveal fragments of the display volume through the pane, fading whole regions into black.
  float field = 0.5 + 0.5 * sin(position.x * 4.1 + position.z * 2.3) * cos(position.y * 3.8 - position.z * 0.7);
  float falloff = 1.0 - smoothstep(0.76, 1.08, max(abs(position.x), abs(position.y)));
  vBrightness *= mix(1.0, smoothstep(0.24, 0.72, field) * falloff, uOptical);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = uPointSize * (4.2 / -mv.z);
}
`
const fragment = /* glsl */ `
uniform vec3 uColor;
varying float vBrightness;
void main() {
  vec2 p = abs(gl_PointCoord - 0.5);
  float cell = (1.0 - smoothstep(0.28, 0.46, p.x)) * (1.0 - smoothstep(0.12, 0.25, p.y));
  gl_FragColor = vec4(uColor, cell * min(vBrightness, 0.20));
}
`

/** A real volume of ordered rectangular light cells, rotating with the face. */
export class DataCube {
  readonly group = new THREE.Group()
  private material: THREE.ShaderMaterial
  private cells: THREE.Points
  private edgeMaterial = new THREE.LineBasicMaterial({ color: 0x8faaba, transparent: true, opacity: 0.05, depthWrite: false })
  private edges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(2, 2, 2)), this.edgeMaterial)
  private gridSize = 0
  private pixelRatio = 1
  private height = 900

  constructor(front: THREE.Texture) {
    this.material = new THREE.ShaderMaterial({
      vertexShader: vertex, fragmentShader: fragment,
      uniforms: {
        uFront: { value: front }, uTime: { value: 0 }, uFormation: { value: 1 },
        uBrightness: { value: 0.6 }, uDepth: { value: 0.9 }, uGap: { value: 0.08 },
        uPointSize: { value: 7 }, uFlicker: { value: 0.3 }, uColor: { value: new THREE.Color() },
        uOptical: { value: 0 },
      },
      transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending,
    })
    this.cells = new THREE.Points(new THREE.BufferGeometry(), this.material)
    this.cells.frustumCulled = false
    this.cells.renderOrder = 1
    this.group.add(this.cells, this.edges)
  }

  private rebuild(n: number) {
    const ny = Math.round(n * 1.18), nz = Math.round(n * 0.24)
    const positions = new Float32Array(n * ny * nz * 3)
    const seeds = new Float32Array(n * ny * nz)
    let i = 0, seed = 7413
    for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < n; x++) {
      // Stagger ordered layers to avoid long radial interference streaks.
      const staggerX = ((z * 0.381966) % 1 - 0.5) * 1.4 / n
      const staggerY = ((z * 0.618034) % 1 - 0.5) * 1.4 / ny
      positions.set([x / (n - 1) * 2 - 1 + staggerX, y / (ny - 1) * 2 - 1 + staggerY, z / (nz - 1) * 2 - 1], i * 3)
      seeds[i++] = ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296)
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1))
    this.cells.geometry.dispose()
    this.cells.geometry = geometry
    this.gridSize = n
    this.resize(this.pixelRatio, this.height)
  }

  applyConfig(config: HeadConfig) {
    const n = Math.round(24 + config.cubeDensity * 28)
    if (n !== this.gridSize) this.rebuild(n)
    const u = this.material.uniforms
    u.uBrightness.value = config.cage * (config.optical ? 0.75 : 1)
    u.uOptical.value = config.optical ? 1 : 0
    u.uDepth.value = config.cubeDepth
    u.uGap.value = config.cubeGap
    u.uFlicker.value = config.flicker
    u.uColor.value.set(config.colorA)
    this.edges.scale.set(1 + config.cubeGap, 1 + config.cubeGap, config.cubeDepth)
    this.edgeMaterial.color.set(config.colorA)
    this.edgeMaterial.opacity = config.optical ? 0 : config.cage * 0.10
  }

  resize(pixelRatio: number, height: number) {
    this.pixelRatio = pixelRatio
    this.height = height
    this.material.uniforms.uPointSize.value = pixelRatio * height / 900 * 9.5 * 38 / Math.max(this.gridSize, 1)
  }

  update(time: number, formation: number) {
    this.material.uniforms.uTime.value = time
    this.material.uniforms.uFormation.value = formation
  }

  dispose() {
    this.cells.geometry.dispose()
    this.material.dispose()
    this.edges.geometry.dispose()
    this.edgeMaterial.dispose()
  }
}
