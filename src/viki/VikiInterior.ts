import * as THREE from 'three'
import { HEAD_DEFORM_GLSL, HEAD_MORPH_GLSL, HEAD_MORPH_INPUT_GLSL, HEAD_PAINT_GLSL, HEAD_UNIFORMS_GLSL, type HeadUniforms } from './headShader'
import type { HeadConfig } from './config'
import { PixelChains, PIXEL_CHAINS_GLSL } from './PixelChains'

const headVertex = /* glsl */ `
${HEAD_UNIFORMS_GLSL}
${HEAD_DEFORM_GLSL}
${HEAD_MORPH_GLSL}
uniform float uRecess;
varying vec3 vLocal, vNormal, vHeadPosition, vPattern;
varying float vHair;
void main() {
  vec3 q, l, n;
  float hair;
  ${HEAD_MORPH_INPUT_GLSL}
  deformHead(transformed, objectNormal, q, l, n, hair);
  vLocal = l; vNormal = n; vHeadPosition = q; vHair = hair;
  vPattern = (uHeadMatrix * vec4(position, 1.0)).xyz;
  // The accepted geometry sits behind the window (local z = 0).
  // Keep its proportions intact; the recess moves the whole head, not its features.
  vec3 inside = q * 1.08 - vec3(0.0, 0.06, 0.94 + uRecess * 0.5);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(inside, 1.0);
}
`
const headFragment = /* glsl */ `
${HEAD_UNIFORMS_GLSL}
${HEAD_PAINT_GLSL}
varying float vFeature, vHair;
varying vec3 vLocal, vNormal, vHeadPosition, vPattern;
uniform float uFlow, uDensity, uCellSize;
${PIXEL_CHAINS_GLSL}
float tileLight(vec2 point) {
  vec2 grid = point * vec2(uDensity, uDensity * 1.16) * 0.5;
  vec2 id = floor(grid), p = abs(fract(grid) - 0.5);
  float footprint = max(length(dFdx(grid)), length(dFdy(grid)));
  float grain = mix(hashH(vec3(id, 7.0)), 0.57735, smoothstep(0.8, 1.8, footprint));
  vec2 radius = clamp(vec2(0.32, 0.39) * uCellSize * mix(0.78, 1.08, grain), vec2(0.17), vec2(0.46));
  vec2 aa = max(fwidth(grid) * 0.6, vec2(0.035));
  vec2 tile = 1.0 - smoothstep(radius - aa, radius + aa, p);
  float aperture = mix(tile.x * tile.y, 4.0 * radius.x * radius.y, smoothstep(0.8, 1.5, footprint));
  return (0.10 + 0.9 * aperture) * (0.3 + 1.25 * grain * grain + uFlow * chainLight(id) * 1.25);
}
void main() {
  if (headCoverage(vLocal) < 0.5) discard;
  float cavity, maskv;
  float light = paintLum(vLocal, normalize(vNormal), vHeadPosition, vHair, vFeature, cavity, maskv);
  maskv *= smoothstep(-0.24, -0.02, vLocal.y);
  if (maskv < 0.005) discard;
  // R = spatial data field, G = head luminance, B = head coverage.
  // Cells follow the actual surface, instead of flattening it into a grid on the window.
  gl_FragColor = vec4(0.0, light * maskv * tileLight(vPattern.xy), maskv, 1.0);
}
`

/** One real 3D scene, viewed through each cube window with a different off-axis camera. */
export class VikiInterior {
  readonly scene = new THREE.Scene()
  private head: THREE.Mesh | null = null
  private headMaterial: THREE.ShaderMaterial
  private cells: THREE.Points
  private cellMaterial: THREE.ShaderMaterial
  private room: THREE.Mesh
  private headUniforms: HeadUniforms
  private chains = new PixelChains()
  private flow = 0.55
  private speed = 0.7

  constructor(head: HeadUniforms) {
    this.headUniforms = head
    this.headMaterial = new THREE.ShaderMaterial({
      vertexShader: headVertex, fragmentShader: headFragment,
      uniforms: {
        ...head, ...this.chains.uniforms, uRecess: { value: 0.4 },
        uFlow: { value: 0.55 }, uDensity: { value: 97 }, uCellSize: { value: 1 },
      },
      depthWrite: true, depthTest: true,
    })
    this.cellMaterial = new THREE.ShaderMaterial({
      uniforms: { ...this.chains.uniforms, uFlow: { value: 0.55 }, uSize: { value: 3 } },
      vertexShader: /* glsl */ `
        uniform float uFlow, uSize;
        attribute float aSeed;
        attribute vec2 aCell;
        ${PIXEL_CHAINS_GLSL}
        varying float vLight;
        void main() {
          float pulse = chainLight(aCell) * 2.0;
          vLight = (0.06 + 0.20 * aSeed * aSeed) * (1.0 + uFlow * pulse);
          vLight *= mix(0.35, 1.0, smoothstep(-1.7, -0.1, position.z));
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = clamp(uSize * 3.0 / -mv.z, 1.0, 6.0);
        }`,
      fragmentShader: /* glsl */ `
        varying float vLight;
        void main() {
          vec2 p = abs(gl_PointCoord - 0.5);
          float cell = (1.0 - smoothstep(0.20, 0.48, p.x)) * (1.0 - smoothstep(0.12, 0.36, p.y));
          gl_FragColor = vec4(vLight, 0.0, 0.0, cell);
        }`,
      transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending,
    })
    const nx = 34, ny = 40, nz = 14
    const positions = new Float32Array(nx * ny * nz * 3), seeds = new Float32Array(nx * ny * nz)
    const addresses = new Float32Array(nx * ny * nz * 2)
    let index = 0, seed = 7423
    for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
      positions.set([
        (x + (z * 0.382) % 1) / nx * 1.96 - 0.98,
        (y + (z * 0.618) % 1) / ny * 1.96 - 0.98,
        -0.12 - z / (nz - 1) * 1.5,
      ], index * 3)
      addresses.set([x + z * 13, y + z * 7], index * 2)
      seeds[index++] = ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296)
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1))
    geometry.setAttribute('aCell', new THREE.BufferAttribute(addresses, 2))
    this.cells = new THREE.Points(geometry, this.cellMaterial)
    this.cells.frustumCulled = false

    // Quiet inner walls/floor provide perspective cues around the floating head.
    this.room = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 1.8), new THREE.ShaderMaterial({
      uniforms: { ...this.chains.uniforms, uFlow: { value: 0.55 } },
      vertexShader: /* glsl */ `
        varying vec3 vPosition, vNormal;
        void main() { vPosition = position; vNormal = normal; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        varying vec3 vPosition, vNormal;
        uniform float uFlow;
        ${PIXEL_CHAINS_GLSL}
        void main() {
          vec3 n = abs(vNormal);
          vec2 uv = n.x > 0.5 ? vPosition.zy : n.y > 0.5 ? vPosition.xz : vPosition.xy;
          vec2 grid = uv * vec2(24.0, 28.0);
          vec2 p = abs(fract(grid) - 0.5);
          vec2 aa = max(fwidth(grid) * 0.6, vec2(0.02));
          vec2 tile = 1.0 - smoothstep(vec2(0.3) - aa, vec2(0.3) + aa, p);
          float fade = 0.35 + 0.65 * pow(0.5 + 0.5 * sin(uv.x * 4.0) * cos(uv.y * 5.0), 2.0);
          float refresh = 1.0 + uFlow * chainLight(grid + n.xy * 37.0) * 2.5;
          gl_FragColor = vec4((0.005 + tile.x * tile.y * 0.038) * fade * refresh, 0.0, 0.0, 1.0);
        }`,
      side: THREE.BackSide,
    }))
    this.room.position.z = -0.9
    this.scene.add(this.room, this.cells)
  }

  setGeometry(geometry: THREE.BufferGeometry, influences: number[]) {
    if (this.head) this.scene.remove(this.head)
    this.head = new THREE.Mesh(geometry, this.headMaterial)
    this.head.morphTargetInfluences = influences
    this.head.frustumCulled = false
    this.scene.add(this.head)
  }

  setMirror(mirror: boolean) { if (this.head) this.head.scale.x = mirror ? -1 : 1 }

  applyConfig(cfg: HeadConfig) {
    const u = this.headMaterial.uniforms
    u.uRecess.value = cfg.portraitDepth ?? 0.4
    u.uFlow.value = cfg.dataFlow ?? 0.55
    u.uDensity.value = 48 + 70 * cfg.density
    u.uCellSize.value = cfg.cellSize
    this.cellMaterial.uniforms.uFlow.value = cfg.dataFlow ?? 0.55
    ;(this.room.material as THREE.ShaderMaterial).uniforms.uFlow.value = cfg.dataFlow ?? 0.55
    this.flow = cfg.dataFlow ?? 0.55
    this.speed = cfg.flowSpeed ?? 0.7
  }

  update(time: number) {
    // At formation zero the fragment shader discards the whole mesh, including its depth.
    // Skip submitting those invisible vertices while keeping every data particle.
    if (this.head) this.head.visible = this.headUniforms.uFormation.value >= 0.001
    if (this.flow > 0) this.chains.update(time, this.speed)
  }

  dispose() {
    this.headMaterial.dispose()
    this.chains.dispose()
    this.cellMaterial.dispose()
    this.cells.geometry.dispose()
    this.room.geometry.dispose()
    ;(this.room.material as THREE.Material).dispose()
    // The shared head geometry belongs to HeadRig.
  }
}
