import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import type { HeadConfig } from './config'
import { DEFAULT_CONFIG } from './config'

/**
 * Renders a real scanned human head (Lee Perry-Smith, CC-BY) from four sides
 * into small textures that the particle lattice samples:
 *   R = z of the surface, A = x of the surface (both in lattice space)
 *   G = luminance (lighting), B = mask (1 where the head is)
 * Each view is rendered by a camera on that side of the head (front faces only),
 * so the lattice gets a closed 3-D shell that reads from every angle.
 * Expressions and the configurator's shape tweaks are deformations in the
 * head's vertex shader.
 */

const headVertex = /* glsl */ `
uniform float uMouthOpen;
uniform float uSmile;
uniform float uBrow;
uniform float uMouthY;
uniform float uBrowY;
uniform float uJawWidth;
uniform float uChin;
uniform float uCheek;
uniform float uBrowRidge;
uniform float uNoseSize;
uniform float uHair;
uniform float uHairline;

varying vec3 vNormal;
varying vec3 vPos;
varying float vHair;

float g2(float x, float y, float sx, float sy) {
  return exp(-((x * x) / (2.0 * sx * sx) + (y * y) / (2.0 * sy * sy)));
}

void main() {
  vec3 q = (modelMatrix * vec4(position, 1.0)).xyz;
  vec3 nw = normalize(mat3(modelMatrix) * normal);
  float front = smoothstep(-0.25, 0.25, q.z);
  float ax = abs(q.x);

  // jaw drops: everything below the mouth line sinks, smoothly blended
  float jaw = smoothstep(uMouthY + 0.10, uMouthY - 0.30, q.y) * front;
  q.y -= uMouthOpen * 0.14 * jaw;
  q.z -= uMouthOpen * 0.04 * jaw;

  // smile / frown: mouth corners up-out or down
  float corner = g2(ax - 0.20, q.y - uMouthY, 0.10, 0.09) * front;
  q.y += uSmile * 0.05 * corner;
  q.x += sign(q.x) * max(uSmile, 0.0) * 0.025 * corner;

  // brows raise / furrow
  float brow = g2(ax - 0.22, q.y - uBrowY, 0.16, 0.06) * front;
  q.y += uBrow * 0.045 * brow;
  q.z += max(-uBrow, 0.0) * 0.02 * brow;

  // configurable proportions: jaw & neck width, brow ridge, nose, cheekbones, chin
  float below = smoothstep(uMouthY + 0.15, uMouthY - 0.45, q.y);
  q.x *= 0.96 - uJawWidth * below;
  float ridge = g2(ax - 0.20, q.y - (uBrowY - 0.03), 0.25, 0.05) * front;
  q.z -= uBrowRidge * ridge;
  float nose = g2(q.x, q.y - (uBrowY - 0.30), 0.07, 0.11) * front;
  q.z += uNoseSize * nose;
  float cheek = g2(ax - 0.30, q.y - (uBrowY - 0.30), 0.10, 0.08) * front;
  q.z += uCheek * cheek;
  float chin = g2(q.x, q.y - (uMouthY - 0.22), 0.14, 0.08) * front;
  q.x *= 1.0 - uChin * chin;

  // hair: volume on the skull above a hairline that dips at the temples, plus the back of the head
  float hl = uHairline - 0.5 * ax * ax;
  float hair = smoothstep(hl, hl + 0.10, q.y) * (1.0 - smoothstep(0.35, 0.6, q.z));
  hair = max(hair, smoothstep(0.15, -0.15, q.z) * smoothstep(-0.35, -0.05, q.y));
  q += nw * uHair * 0.07 * hair;
  vHair = hair * uHair;

  vPos = q;
  vNormal = nw;
  gl_Position = projectionMatrix * viewMatrix * vec4(q, 1.0);
}
`

const headFragment = /* glsl */ `
uniform float uMouthOpen;
uniform float uMouthWide;
uniform float uEyeOpen;
uniform float uMouthY;
uniform float uEyeX;
uniform float uEyeY;
uniform float uEyeSize;
uniform float uEyeGlow;
uniform float uMouthWidth;
uniform float uLipFull;

varying vec3 vNormal;
varying vec3 vPos;
varying float vHair;

float ell(vec2 p, vec2 c, vec2 r) {
  vec2 d = (p - c) / r;
  return 1.0 - smoothstep(0.7, 1.0, dot(d, d));
}
float hash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

void main() {
  vec3 n = normalize(vNormal);
  vec3 key = normalize(vec3(0.35, 0.55, 1.0));
  vec3 fill = normalize(vec3(-0.6, 0.1, 0.6));
  // wrap lighting so the back and sides of the head still read when the cube is turned
  float wrap = 0.5 + 0.5 * dot(n, key);
  float lum = 0.08 + 0.85 * pow(wrap, 3.0) + 0.10 * max(dot(n, fill), 0.0);
  lum += 0.08 * pow(1.0 - abs(n.z), 3.0);

  float depth = vPos.z;
  float ax = abs(vPos.x);
  float faceZone = smoothstep(0.05, 0.35, vPos.z); // painted features only on the face

  // mouth: a wide lens. The upper lip stays put, the lower lip drops with the jaw.
  float mw = uMouthWidth + 0.04 * uMouthWide;
  float u = clamp(vPos.x / mw, -1.0, 1.0);
  float lens = pow(max(1.0 - u * u, 0.0), 0.7);
  float openH = (0.006 + 0.075 * uMouthOpen) * lens;
  float top = uMouthY + 0.008 * lens;
  float bottom = uMouthY - openH;
  float inside = smoothstep(bottom - 0.012, bottom + 0.004, vPos.y) * (1.0 - smoothstep(top - 0.004, top + 0.012, vPos.y));
  inside *= 1.0 - smoothstep(0.85, 1.0, abs(vPos.x / mw));
  float cav = inside * smoothstep(0.02, 0.12, uMouthOpen) * faceZone;
  lum *= 1.0 - 0.9 * cav;
  depth -= 0.2 * cav;
  float lips = exp(-pow((vPos.y - uMouthY) / 0.03, 2.0)) * lens * (1.0 - cav) * faceZone;
  lum += uLipFull * lips;

  // eyes: soft almond glow when open, dark on a blink
  float eye = ell(vec2(ax, vPos.y), vec2(uEyeX, uEyeY), vec2(0.075, 0.034) * uEyeSize) * faceZone;
  lum += uEyeGlow * eye * smoothstep(0.2, 0.9, uEyeOpen);
  lum *= 1.0 - 0.6 * eye * (1.0 - smoothstep(0.0, 0.3, uEyeOpen));

  // hair: a little darker with a fine strand-like grain
  lum *= 1.0 - 0.3 * vHair;
  lum += vHair * 0.35 * hash(floor(vPos * vec3(90.0, 14.0, 90.0)));

  // fade the neck out below the chin: no shoulders in the lattice
  float maskv = smoothstep(-1.0, -0.66, vPos.y);

  gl_FragColor = vec4(depth, lum * maskv, maskv, vPos.x);
}
`

interface View {
  target: THREE.WebGLRenderTarget
  camera: THREE.OrthographicCamera
}

export class FacePass {
  readonly uniforms = {
    uMouthOpen: { value: 0 },
    uMouthWide: { value: 0 },
    uSmile: { value: 0 },
    uBrow: { value: 0 },
    uEyeOpen: { value: 1 },
    uMouthY: { value: DEFAULT_CONFIG.mouthY },
    uEyeX: { value: DEFAULT_CONFIG.eyeX },
    uEyeY: { value: DEFAULT_CONFIG.eyeY },
    uBrowY: { value: DEFAULT_CONFIG.browY },
    uJawWidth: { value: DEFAULT_CONFIG.jawWidth },
    uChin: { value: DEFAULT_CONFIG.chin },
    uCheek: { value: DEFAULT_CONFIG.cheek },
    uBrowRidge: { value: DEFAULT_CONFIG.browRidge },
    uNoseSize: { value: DEFAULT_CONFIG.noseSize },
    uHair: { value: DEFAULT_CONFIG.hair },
    uHairline: { value: DEFAULT_CONFIG.hairline },
    uEyeSize: { value: DEFAULT_CONFIG.eyeSize },
    uEyeGlow: { value: DEFAULT_CONFIG.eyeGlow },
    uMouthWidth: { value: DEFAULT_CONFIG.mouthWidth },
    uLipFull: { value: DEFAULT_CONFIG.lipFull },
  }
  ready = false

  /** cameras at +z, -z, +x, -x respectively */
  readonly views: { front: View; back: View; right: View; left: View }

  private scene = new THREE.Scene()
  private material: THREE.ShaderMaterial
  private head: THREE.Mesh | null = null
  private geometry: THREE.BufferGeometry | null = null
  private tmpColor = new THREE.Color()
  private scale = DEFAULT_CONFIG.headScale
  private offsetY = DEFAULT_CONFIG.headY

  constructor(size = 256) {
    const makeTarget = () =>
      new THREE.WebGLRenderTarget(size, size, {
        type: THREE.HalfFloatType,
        format: THREE.RGBAFormat,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        depthBuffer: true,
        stencilBuffer: false,
      })
    const makeCamera = (x: number, z: number) => {
      const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 6)
      cam.position.set(x, 0, z)
      cam.lookAt(0, 0, 0)
      cam.updateMatrixWorld()
      return cam
    }
    this.material = new THREE.ShaderMaterial({
      vertexShader: headVertex,
      fragmentShader: headFragment,
      uniforms: this.uniforms,
      side: THREE.FrontSide,
    })
    this.views = {
      front: { target: makeTarget(), camera: makeCamera(0, 3) },
      back: { target: makeTarget(), camera: makeCamera(0, -3) },
      right: { target: makeTarget(), camera: makeCamera(3, 0) },
      left: { target: makeTarget(), camera: makeCamera(-3, 0) },
    }
  }

  async load(url: string): Promise<void> {
    const gltf = await new GLTFLoader().loadAsync(url)
    let geometry: THREE.BufferGeometry | null = null
    gltf.scene.traverse((o) => {
      if (!geometry && o instanceof THREE.Mesh) geometry = o.geometry
    })
    if (!geometry) throw new Error('No mesh found in head model')
    this.geometry = geometry
    const head = new THREE.Mesh(geometry, this.material)
    head.frustumCulled = false
    this.head = head
    this.scene.add(head)
    this.applyPlacement()
    this.ready = true
  }

  applyConfig(cfg: HeadConfig) {
    const u = this.uniforms
    u.uMouthY.value = cfg.mouthY
    u.uEyeX.value = cfg.eyeX
    u.uEyeY.value = cfg.eyeY
    u.uBrowY.value = cfg.browY
    u.uJawWidth.value = cfg.jawWidth
    u.uChin.value = cfg.chin
    u.uCheek.value = cfg.cheek
    u.uBrowRidge.value = cfg.browRidge
    u.uNoseSize.value = cfg.noseSize
    u.uHair.value = cfg.hair
    u.uHairline.value = cfg.hairline
    u.uEyeSize.value = cfg.eyeSize
    u.uEyeGlow.value = cfg.eyeGlow
    u.uMouthWidth.value = cfg.mouthWidth
    u.uLipFull.value = cfg.lipFull
    this.scale = cfg.headScale
    this.offsetY = cfg.headY
    this.applyPlacement()
  }

  private applyPlacement() {
    if (!this.head) return
    this.head.scale.setScalar(this.scale)
    this.head.position.y = this.offsetY
    this.head.updateMatrixWorld()
  }

  render(renderer: THREE.WebGLRenderer) {
    if (!this.ready || !this.head) return
    const prevTarget = renderer.getRenderTarget()
    const prevColor = renderer.getClearColor(this.tmpColor)
    const prevAlpha = renderer.getClearAlpha()
    renderer.setClearColor(0x000000, 0)
    for (const view of Object.values(this.views)) {
      renderer.setRenderTarget(view.target)
      renderer.clear(true, true, false)
      renderer.render(this.scene, view.camera)
    }
    renderer.setRenderTarget(prevTarget)
    renderer.setClearColor(prevColor, prevAlpha)
  }

  dispose() {
    for (const view of Object.values(this.views)) view.target.dispose()
    this.material.dispose()
    this.geometry?.dispose()
  }
}
