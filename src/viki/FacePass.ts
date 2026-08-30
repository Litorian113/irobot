import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'

/**
 * Renders a real scanned human head (Lee Perry-Smith, CC-BY) into a small
 * texture that the particle lattice samples:
 *   R = surface depth in lattice space (-1..1)
 *   G = luminance (lighting)
 *   B = mask (1 where the head is)
 * Expressions are procedural deformations applied in the head's vertex shader.
 */

export interface FaceAnchors {
  scale: number
  offsetY: number
  mouthY: number
  eyeX: number
  eyeY: number
  browY: number
}

/** Calibrated for LeePerrySmith.glb (raw bounds x ±4.28, y ±3.97, z ±2.59). */
export const DEFAULT_ANCHORS: FaceAnchors = {
  scale: 0.29,
  offsetY: -0.38,
  mouthY: -0.27,
  eyeX: 0.216,
  eyeY: 0.11,
  browY: 0.21,
}

const headVertex = /* glsl */ `
uniform float uMouthOpen;
uniform float uSmile;
uniform float uBrow;
uniform float uMouthY;
uniform float uBrowY;

varying vec3 vNormal;
varying vec3 vPos;

float g2(float x, float y, float sx, float sy) {
  return exp(-((x * x) / (2.0 * sx * sx) + (y * y) / (2.0 * sy * sy)));
}

void main() {
  vec3 q = (modelMatrix * vec4(position, 1.0)).xyz;
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

  // feminine proportions on the scan: narrower jaw & neck, softer brow ridge,
  // smaller nose, cheekbones, tapered chin, slightly narrower head
  float below = smoothstep(uMouthY + 0.15, uMouthY - 0.45, q.y);
  q.x *= 0.96 - 0.11 * below;
  float ridge = g2(ax - 0.20, q.y - (uBrowY - 0.03), 0.25, 0.05) * front;
  q.z -= 0.035 * ridge;
  float nose = g2(q.x, q.y - (uBrowY - 0.30), 0.07, 0.11) * front;
  q.z -= 0.03 * nose;
  float cheek = g2(ax - 0.30, q.y - (uBrowY - 0.30), 0.10, 0.08) * front;
  q.z += 0.02 * cheek;
  float chin = g2(q.x, q.y - (uMouthY - 0.22), 0.14, 0.08) * front;
  q.x *= 1.0 - 0.10 * chin;

  vPos = q;
  vNormal = normalize(mat3(modelMatrix) * normal);
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

varying vec3 vNormal;
varying vec3 vPos;

float ell(vec2 p, vec2 c, vec2 r) {
  vec2 d = (p - c) / r;
  return 1.0 - smoothstep(0.7, 1.0, dot(d, d));
}

void main() {
  vec3 n = normalize(vNormal);
  vec3 key = normalize(vec3(0.35, 0.55, 1.0));
  vec3 fill = normalize(vec3(-0.6, 0.1, 0.6));
  float lum = 0.12 + 0.72 * max(dot(n, key), 0.0) + 0.16 * max(dot(n, fill), 0.0);
  lum = pow(lum, 1.35) * 1.05;                // soft but readable shading
  lum += 0.08 * pow(1.0 - max(n.z, 0.0), 3.0); // thin rim

  float depth = vPos.z;
  float ax = abs(vPos.x);

  // mouth: a wide lens. The upper lip stays put, the lower lip drops with the jaw.
  float mw = 0.15 + 0.04 * uMouthWide;                 // half width
  float u = clamp(vPos.x / mw, -1.0, 1.0);
  float lens = pow(max(1.0 - u * u, 0.0), 0.7);        // 1 at centre, 0 at the corners
  float openH = (0.006 + 0.075 * uMouthOpen) * lens;   // how far the lower lip is down
  float top = uMouthY + 0.008 * lens;
  float bottom = uMouthY - openH;
  float inside = smoothstep(bottom - 0.012, bottom + 0.004, vPos.y) * (1.0 - smoothstep(top - 0.004, top + 0.012, vPos.y));
  inside *= 1.0 - smoothstep(0.85, 1.0, abs(vPos.x / mw));
  float cav = inside * smoothstep(0.02, 0.12, uMouthOpen);
  lum *= 1.0 - 0.9 * cav;
  depth -= 0.2 * cav;
  // fuller lips: a soft highlight just around the mouth line
  float lips = exp(-pow((vPos.y - uMouthY) / 0.03, 2.0)) * lens * (1.0 - cav);
  lum += 0.12 * lips;

  // eyes: soft almond glow when open, dark on a blink
  float eye = ell(vec2(ax, vPos.y), vec2(uEyeX, uEyeY), vec2(0.075, 0.034));
  lum += 0.5 * eye * smoothstep(0.2, 0.9, uEyeOpen);
  lum *= 1.0 - 0.6 * eye * (1.0 - smoothstep(0.0, 0.3, uEyeOpen));

  // fade the neck out below the chin: no shoulders in the lattice
  float maskv = smoothstep(-1.0, -0.66, vPos.y);

  gl_FragColor = vec4(depth, lum * maskv, maskv, 1.0);
}
`

export class FacePass {
  readonly target: THREE.WebGLRenderTarget
  readonly uniforms = {
    uMouthOpen: { value: 0 },
    uMouthWide: { value: 0 },
    uSmile: { value: 0 },
    uBrow: { value: 0 },
    uEyeOpen: { value: 1 },
    uMouthY: { value: DEFAULT_ANCHORS.mouthY },
    uEyeX: { value: DEFAULT_ANCHORS.eyeX },
    uEyeY: { value: DEFAULT_ANCHORS.eyeY },
    uBrowY: { value: DEFAULT_ANCHORS.browY },
  }
  ready = false

  private scene = new THREE.Scene()
  private camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 6)
  private head: THREE.Mesh | null = null
  private material: THREE.ShaderMaterial
  private tmpColor = new THREE.Color()

  constructor(size = 256) {
    this.target = new THREE.WebGLRenderTarget(size, size, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: true,
      stencilBuffer: false,
    })
    this.camera.position.set(0, 0, 3)
    this.camera.lookAt(0, 0, 0)
    this.material = new THREE.ShaderMaterial({
      vertexShader: headVertex,
      fragmentShader: headFragment,
      uniforms: this.uniforms,
      side: THREE.FrontSide,
    })
  }

  async load(url: string, anchors: FaceAnchors = DEFAULT_ANCHORS): Promise<void> {
    const gltf = await new GLTFLoader().loadAsync(url)
    let geometry: THREE.BufferGeometry | null = null
    gltf.scene.traverse((o) => {
      if (!geometry && o instanceof THREE.Mesh) geometry = o.geometry
    })
    if (!geometry) throw new Error('No mesh found in head model')
    const head = new THREE.Mesh(geometry, this.material)
    head.scale.setScalar(anchors.scale)
    head.position.y = anchors.offsetY
    head.frustumCulled = false
    this.head = head
    this.scene.add(head)
    this.ready = true
  }

  render(renderer: THREE.WebGLRenderer) {
    if (!this.ready) return
    const prevTarget = renderer.getRenderTarget()
    const prevColor = renderer.getClearColor(this.tmpColor)
    const prevAlpha = renderer.getClearAlpha()
    renderer.setRenderTarget(this.target)
    renderer.setClearColor(0x000000, 0)
    renderer.clear(true, true, false)
    renderer.render(this.scene, this.camera)
    renderer.setRenderTarget(prevTarget)
    renderer.setClearColor(prevColor, prevAlpha)
  }

  dispose() {
    this.target.dispose()
    this.material.dispose()
    this.head?.geometry.dispose()
  }
}
