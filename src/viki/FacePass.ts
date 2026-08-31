import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import type { HeadConfig } from './config'
import { DEFAULT_CONFIG, REF_SCALE } from './config'

/**
 * Renders a real scanned human head (Lee Perry-Smith, CC-BY) from four sides
 * into small textures that the particle lattice samples:
 *   R = z of the surface, A = x of the surface (both in lattice space)
 *   G = luminance (lighting + painted features), B = mask (1 where the head is)
 * Each view is rendered by a camera on that side of the head (front faces only),
 * so the lattice gets a closed 3-D shell that reads from every angle.
 *
 * All feature anchors (eyes, brows, mouth, hair) live in *head-local* units:
 * the head as it is at the reference scale, centred on its placement. That way
 * the size/height sliders and the "come forward" motion carry the features along.
 */

/** Rest / active depth of the head inside the cube (it moves forward when she wakes up). */
export const HEAD_Z_REST = -0.42
export const HEAD_Z_ACTIVE = 0.0

const shaderCommon = /* glsl */ `
uniform vec3 uHeadOffset;   // placement of the head in the cube
uniform vec3 uHeadScale;    // mesh scale per axis
uniform float uMouthY;
uniform float uEyeX;
uniform float uEyeY;
uniform float uBrowY;
uniform float uMouthWidth;
uniform float uLipFull;
uniform float uActive;      // 0 dormant .. 1 awake: features come out

float g2(float x, float y, float sx, float sy) {
  return exp(-((x * x) / (2.0 * sx * sx) + (y * y) / (2.0 * sy * sy)));
}
/** world -> head-local (reference-scale) coordinates */
vec3 toLocal(vec3 world) { return (world - uHeadOffset) * (${REF_SCALE.toFixed(3)} / uHeadScale); }
`

const headVertex = /* glsl */ `
${shaderCommon}
uniform float uMouthOpen;
uniform float uSmile;
uniform float uBrow;
uniform float uJawWidth;
uniform float uChin;
uniform float uCheek;
uniform float uBrowRidge;
uniform float uNoseSize;
uniform float uHair;
uniform float uHairline;

varying vec3 vNormal;
varying vec3 vPos;
varying vec3 vLocal;
varying float vHair;

void main() {
  vec3 q = (modelMatrix * vec4(position, 1.0)).xyz;
  vec3 nw = normalize(mat3(modelMatrix) * normal);
  vec3 l = toLocal(q);
  float front = smoothstep(-0.25, 0.25, l.z);
  float ax = abs(l.x);

  // jaw drops: everything below the mouth line sinks, smoothly blended
  float jaw = smoothstep(uMouthY + 0.10, uMouthY - 0.30, l.y) * front;
  q.y -= uMouthOpen * 0.14 * jaw;
  q.z -= uMouthOpen * 0.04 * jaw;

  // smile / frown: mouth corners up-out or down
  float corner = g2(ax - 0.20, l.y - uMouthY, 0.10, 0.09) * front;
  q.y += uSmile * 0.05 * corner;
  q.x += sign(l.x) * max(uSmile, 0.0) * 0.025 * corner;

  // brows raise / furrow
  float brow = g2(ax - 0.22, l.y - uBrowY, 0.16, 0.06) * front;
  q.y += uBrow * 0.045 * brow;
  q.z += max(-uBrow, 0.0) * 0.02 * brow;

  // configurable proportions: jaw & neck width, brow ridge, nose, cheekbones, chin
  float below = smoothstep(uMouthY + 0.15, uMouthY - 0.45, l.y);
  q.x = uHeadOffset.x + (q.x - uHeadOffset.x) * (0.96 - uJawWidth * below);
  float ridge = g2(ax - 0.20, l.y - (uBrowY - 0.03), 0.25, 0.05) * front;
  q.z -= uBrowRidge * ridge;
  float nose = g2(l.x, l.y - (uBrowY - 0.30), 0.07, 0.11) * front;
  q.z += uNoseSize * nose;
  float cheek = g2(ax - 0.30, l.y - (uBrowY - 0.30), 0.10, 0.08) * front;
  q.z += uCheek * cheek;
  float chin = g2(l.x, l.y - (uMouthY - 0.22), 0.14, 0.08) * front;
  q.x = uHeadOffset.x + (q.x - uHeadOffset.x) * (1.0 - uChin * chin);

  // fuller lips: a soft geometric bump along the mouth
  float lensV = pow(max(1.0 - pow(clamp(l.x / uMouthWidth, -1.0, 1.0), 2.0), 0.0), 0.7);
  float lipBump = exp(-pow((l.y - uMouthY) / 0.035, 2.0)) * lensV * front;
  q.z += uLipFull * 0.12 * lipBump;

  // hair: volume on the skull above a hairline that dips at the temples, plus the back of the head
  float hl = uHairline - 0.5 * ax * ax;
  float hair = smoothstep(hl, hl + 0.10, l.y) * (1.0 - smoothstep(0.35, 0.6, l.z));
  hair = max(hair, smoothstep(0.15, -0.15, l.z) * smoothstep(-0.35, -0.05, l.y));
  q += nw * uHair * 0.07 * hair;
  vHair = hair * uHair;

  vPos = q;
  vLocal = l;
  vNormal = nw;
  gl_Position = projectionMatrix * viewMatrix * vec4(q, 1.0);
}
`

const headFragment = /* glsl */ `
${shaderCommon}
uniform float uMouthOpen;
uniform float uMouthWide;
uniform float uEyeOpen;
uniform float uEyeSize;
uniform float uEyeGlow;

varying vec3 vNormal;
varying vec3 vPos;
varying vec3 vLocal;
varying float vHair;

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
  vec2 l = vLocal.xy;
  float ax = abs(l.x);
  float faceZone = smoothstep(0.05, 0.35, vLocal.z); // painted features only on the face
  float boost = mix(0.55, 1.0, uActive);              // features come out when she is awake

  // ---- mouth: a wide lens. The upper lip stays put, the lower lip drops with the jaw.
  float mw = uMouthWidth + 0.04 * uMouthWide;
  float u = clamp(l.x / mw, -1.0, 1.0);
  float lens = pow(max(1.0 - u * u, 0.0), 0.7);
  float openH = (0.006 + 0.075 * uMouthOpen) * lens;
  float top = uMouthY + 0.008 * lens;
  float bottom = uMouthY - openH;
  float inside = smoothstep(bottom - 0.012, bottom + 0.004, l.y) * (1.0 - smoothstep(top - 0.004, top + 0.012, l.y));
  inside *= 1.0 - smoothstep(0.85, 1.0, abs(l.x / mw));
  float cav = inside * smoothstep(0.02, 0.12, uMouthOpen) * faceZone;
  lum *= 1.0 - 0.9 * cav;
  depth -= 0.2 * cav;
  // lips: dark line between them, bright lower lip, softer upper lip
  float lipLine = exp(-pow((l.y - uMouthY) / 0.006, 2.0)) * lens * (1.0 - cav) * faceZone;
  float lowerLip = exp(-pow((l.y - (uMouthY - 0.026)) / 0.016, 2.0)) * lens * (1.0 - cav) * faceZone;
  float upperLip = exp(-pow((l.y - (uMouthY + 0.018)) / 0.012, 2.0)) * lens * (1.0 - cav) * faceZone;
  lum *= 1.0 - 0.55 * lipLine * boost;
  lum += uLipFull * boost * (1.1 * lowerLip + 0.5 * upperLip);

  // ---- eyes: bright almond, dark iris with a catchlight, lid shadow above; lids close on a blink
  vec2 ep = vec2(ax - uEyeX, l.y - uEyeY);
  vec2 er = vec2(0.075, 0.034) * uEyeSize;
  vec2 en = ep / er;
  float almond = (1.0 - smoothstep(0.75, 1.0, dot(en, en))) * faceZone;
  float irisR = length(ep / (er.y * 1.15));
  float iris = 1.0 - smoothstep(0.55, 0.72, irisR);
  float pupil = 1.0 - smoothstep(0.22, 0.34, irisR);
  float catchlight = 1.0 - smoothstep(0.10, 0.22, length((ep - vec2(-0.007, 0.008)) / (er.y * 1.15)));
  float open = smoothstep(0.15, 0.8, uEyeOpen);
  float eyeLum = 1.0 * (1.0 - 0.8 * iris - 0.2 * pupil) + 0.9 * catchlight * iris;
  float eyeMix = almond * open * clamp(uEyeGlow, 0.0, 1.0) * boost;
  lum = mix(lum, eyeLum, eyeMix);
  lum += 0.25 * uEyeGlow * almond * open * boost;          // a little glow
  lum *= 1.0 - 0.45 * almond * (1.0 - open);               // closed lids read as a dark line
  vec2 en2 = (ep - vec2(0.0, er.y * 0.55)) / (er * vec2(1.25, 1.35));
  float lidShadow = max(0.0, (1.0 - smoothstep(0.7, 1.15, dot(en2, en2))) - almond) * faceZone;
  lum *= 1.0 - 0.4 * lidShadow * boost;

  // ---- brows: dark arched strokes above the eyes
  float bx = ax - uEyeX * 1.05;
  float yb = uBrowY + 0.02 - 0.9 * bx * bx;
  float browBand = exp(-pow((l.y - yb) / 0.012, 2.0)) * (1.0 - smoothstep(0.10, 0.16, abs(bx))) * faceZone;
  lum *= 1.0 - 0.55 * browBand * boost;

  // ---- cheekbone highlight
  float cheekHi = g2(ax - 0.33, l.y - (uEyeY - 0.12), 0.09, 0.05) * faceZone;
  lum += 0.12 * cheekHi * boost;

  // hair: a little darker with a fine strand-like grain
  lum *= 1.0 - 0.3 * vHair;
  lum += vHair * 0.35 * hash(floor(vLocal * vec3(90.0, 14.0, 90.0)));

  // fade the neck out below the chin: no shoulders in the lattice
  float maskv = smoothstep(-0.62, -0.28, l.y);

  gl_FragColor = vec4(depth, lum * maskv, maskv, vPos.x);
}
`

interface View {
  target: THREE.WebGLRenderTarget
  camera: THREE.OrthographicCamera
}

export class FacePass {
  readonly uniforms = {
    uHeadOffset: { value: new THREE.Vector3(0, DEFAULT_CONFIG.headY, HEAD_Z_REST) },
    uHeadScale: { value: new THREE.Vector3(REF_SCALE, REF_SCALE, REF_SCALE) },
    uActive: { value: 0 },
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
  private oval = DEFAULT_CONFIG.oval
  private offsetY = DEFAULT_CONFIG.headY
  private forward = 0

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
    this.oval = cfg.oval
    this.offsetY = cfg.headY
    this.applyPlacement()
  }

  /** 0 = resting deep in the cube, 1 = awake and forward. */
  setForward(v: number) {
    this.forward = v
    this.uniforms.uActive.value = v
    this.applyPlacement()
  }

  private applyPlacement() {
    const sx = this.scale * (1 - 0.5 * this.oval)
    const sy = this.scale * (1 + this.oval)
    const sz = this.scale
    const z = HEAD_Z_REST + (HEAD_Z_ACTIVE - HEAD_Z_REST) * this.forward
    this.uniforms.uHeadScale.value.set(sx, sy, sz)
    this.uniforms.uHeadOffset.value.set(0, this.offsetY, z)
    if (!this.head) return
    this.head.scale.set(sx, sy, sz)
    this.head.position.set(0, this.offsetY, z)
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
