import * as THREE from 'three'
import { VIKI_ASSEMBLY_GLSL } from './VikiAssembly'

/** Short columns of light descend to build the cube, then lift off on deactivation. */
export class VikiRain extends THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial> {
  constructor() {
    const columns = 260, length = 7
    const positions = new Float32Array(columns * length * 3)
    const segments = new Float32Array(columns * length)
    let seed = 1721
    const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296)
    for (let c = 0; c < columns; c++) {
      const x = (Math.floor(random() * 76) + 0.5) / 38 - 1
      const z = (Math.floor(random() * 76) + 0.5) / 38 - 1
      for (let i = 0; i < length; i++) {
        positions.set([x, 0, z], (c * length + i) * 3)
        segments[c * length + i] = i
      }
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geometry.setAttribute('aSegment', new THREE.BufferAttribute(segments, 1))
    const material = new THREE.ShaderMaterial({
      uniforms: {
        uBuild: { value: 0 }, uDirection: { value: 1 }, uTime: { value: 0 },
        uPixelScale: { value: 500 }, uColor: { value: new THREE.Color() },
      },
      vertexShader: /* glsl */ `
        ${VIKI_ASSEMBLY_GLSL}
        uniform float uDirection, uTime, uPixelScale;
        attribute float aSegment;
        varying float vLight;
        void main() {
          float seed = columnSeed(floor(position.xz * 38.0));
          float head = assemblyFront(position.xz);
          float phase = fract(uTime * 3.0 + seed * 11.0);
          vec3 p = position;
          p.y = head + uDirection * (aSegment * 0.072 + phase * 0.07);
          float progress = columnProgress(position.xz);
          float envelope = smoothstep(0.0, 0.09, progress) * (1.0 - smoothstep(0.82, 1.0, progress));
          vLight = envelope * (0.25 + 0.75 * pow(1.0 - aSegment / 7.0, 1.5)) * (0.4 + seed * 0.6);
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          float scale = length(modelMatrix[0].xyz);
          gl_PointSize = clamp(uPixelScale * scale * 0.032 / -mv.z, 1.0, 14.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        varying float vLight;
        void main() {
          vec2 p = abs(gl_PointCoord - 0.5);
          float core = (1.0 - smoothstep(0.16, 0.29, p.x)) * (1.0 - smoothstep(0.26, 0.46, p.y));
          float glow = exp(-dot(p * vec2(4.5, 3.0), p * vec2(4.5, 3.0))) * 0.22;
          gl_FragColor = vec4(uColor * vLight * 0.9, core + glow);
        }`,
      transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
    })
    super(geometry, material)
    this.frustumCulled = false
    this.renderOrder = 2
    this.name = 'VIKI-assembly-columns'
  }

  dispose() { this.geometry.dispose(); this.material.dispose() }
}
