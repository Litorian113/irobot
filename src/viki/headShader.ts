import * as THREE from 'three'
import { DEFAULT_CONFIG, REF_SCALE, type HeadConfig } from './config'

/**
 * Shared GLSL for every head style: the scanned head is deformed in its own
 * frame (expressions + configurable proportions + hair) and a "painted"
 * feature layer (eyes, brows, lips, cheek highlight) is computed from the
 * head-local position. Styles only differ in how they draw the result.
 *
 * Head frame: uHeadMatrix places the raw scan inside the cube (scale + offset).
 * The mesh itself has an identity transform, so `modelMatrix` is just the
 * rotating cube group (identity inside the FacePass).
 */

export const HEAD_UNIFORMS_GLSL = /* glsl */ `
uniform mat4 uHeadMatrix;
uniform vec3 uHeadOffset;
uniform vec3 uHeadScale;
uniform float uActive;
uniform float uMouthOpen;
uniform float uMouthWide;
uniform float uSmile;
uniform float uBrow;
uniform float uEyeOpen;
uniform float uMouthY;
uniform float uEyeX;
uniform float uEyeY;
uniform float uBrowY;
uniform float uJawWidth;
uniform float uChin;
uniform float uCheek;
uniform float uBrowRidge;
uniform float uNoseSize;
uniform float uHair;
uniform float uHairline;
uniform float uEyeSize;
uniform float uEyeGlow;
uniform float uMouthWidth;
uniform float uLipFull;

float g2(float x, float y, float sx, float sy) {
  return exp(-((x * x) / (2.0 * sx * sx) + (y * y) / (2.0 * sy * sy)));
}
float hashH(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
/** head frame -> head-local (reference-scale) coordinates, where all feature anchors live */
vec3 toLocal(vec3 headFrame) { return (headFrame - uHeadOffset) * (${REF_SCALE.toFixed(3)} / uHeadScale); }
`

export const HEAD_DEFORM_GLSL = /* glsl */ `
/**
 * Deform a raw scan vertex. Outputs the head-frame position q (before the cube
 * rotation), the head-local anchor coordinates l, the head-frame normal nw and
 * how much hair covers this vertex.
 */
void deformHead(vec3 position, vec3 normal, out vec3 q, out vec3 l, out vec3 nw, out float hairOut) {
  q = (uHeadMatrix * vec4(position, 1.0)).xyz;
  nw = normalize(mat3(uHeadMatrix) * normal);
  l = toLocal(q);
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
  hairOut = hair * uHair;
}
`

export const HEAD_PAINT_GLSL = /* glsl */ `
/**
 * Lighting + painted features for a surface point. n is the normal in the
 * head frame (light is attached to the head). Returns luminance 0..~1.3 and
 * writes the open-mouth cavity (0..1) and the neck fade mask (0..1).
 */
float paintLum(vec3 l, vec3 n, float hair, out float cav, out float maskv) {
  // Rembrandt light: a single key high above, falling down the face;
  // deep sockets, nose and cheek shadows, only a whisper of fill.
  vec3 key = normalize(vec3(0.42, 0.88, 0.45));
  vec3 fill = normalize(vec3(-0.55, 0.05, 0.8));
  float wrap = 0.5 + 0.5 * dot(n, key);
  float lum = 0.045 + 1.0 * pow(wrap, 3.6) + 0.07 * max(dot(n, fill), 0.0);
  lum += 0.05 * pow(1.0 - abs(n.z), 3.0);

  float ax = abs(l.x);
  float faceZone = smoothstep(0.05, 0.35, l.z);
  float boost = mix(0.55, 1.0, uActive);

  // mouth: a wide lens. The upper lip stays put, the lower lip drops with the jaw.
  float mw = uMouthWidth + 0.04 * uMouthWide;
  float u = clamp(l.x / mw, -1.0, 1.0);
  float lens = pow(max(1.0 - u * u, 0.0), 0.7);
  float openH = (0.006 + 0.075 * uMouthOpen) * lens;
  float top = uMouthY + 0.008 * lens;
  float bottom = uMouthY - openH;
  float inside = smoothstep(bottom - 0.012, bottom + 0.004, l.y) * (1.0 - smoothstep(top - 0.004, top + 0.012, l.y));
  inside *= 1.0 - smoothstep(0.85, 1.0, abs(l.x / mw));
  cav = inside * smoothstep(0.02, 0.12, uMouthOpen) * faceZone;
  lum *= 1.0 - 0.9 * cav;
  float lipLine = exp(-pow((l.y - uMouthY) / 0.006, 2.0)) * lens * (1.0 - cav) * faceZone;
  float lowerLip = exp(-pow((l.y - (uMouthY - 0.026)) / 0.016, 2.0)) * lens * (1.0 - cav) * faceZone;
  float upperLip = exp(-pow((l.y - (uMouthY + 0.018)) / 0.012, 2.0)) * lens * (1.0 - cav) * faceZone;
  lum *= 1.0 - 0.55 * lipLine * boost;
  lum += uLipFull * boost * (0.35 * lowerLip + 0.12 * upperLip);

  // eyes: soft almond, a large dark iris with a catchlight; lids close on a blink.
  // Kept dim overall so they read as eyes, not white bars, at cell resolution.
  vec2 ep = vec2(ax - uEyeX, l.y - uEyeY);
  vec2 er = vec2(0.068, 0.028) * uEyeSize;
  vec2 en = ep / er;
  float almond = (1.0 - smoothstep(0.6, 1.0, dot(en, en))) * faceZone;
  float irisR = length(ep / (er.y * 1.35));
  float iris = 1.0 - smoothstep(0.5, 0.68, irisR);
  float pupil = 1.0 - smoothstep(0.2, 0.32, irisR);
  float catchlight = 1.0 - smoothstep(0.08, 0.2, length((ep - vec2(-0.006, 0.007)) / (er.y * 1.35)));
  float open = smoothstep(0.15, 0.8, uEyeOpen);
  float eyeLum = 0.78 * (1.0 - 0.85 * iris - 0.2 * pupil) + 0.95 * catchlight * iris;
  float eyeMix = almond * open * clamp(uEyeGlow, 0.0, 1.0) * boost;
  lum = mix(lum, eyeLum, eyeMix);
  lum += 0.1 * uEyeGlow * almond * open * boost;
  lum *= 1.0 - 0.45 * almond * (1.0 - open);
  vec2 en2 = (ep - vec2(0.0, er.y * 0.55)) / (er * vec2(1.25, 1.35));
  float lidShadow = max(0.0, (1.0 - smoothstep(0.7, 1.15, dot(en2, en2))) - almond) * faceZone;
  lum *= 1.0 - 0.4 * lidShadow * boost;

  // brows: dark arched strokes above the eyes
  float bx = ax - uEyeX * 1.05;
  float yb = uBrowY + 0.02 - 0.9 * bx * bx;
  float browBand = exp(-pow((l.y - yb) / 0.012, 2.0)) * (1.0 - smoothstep(0.10, 0.16, abs(bx))) * faceZone;
  lum *= 1.0 - 0.55 * browBand * boost;

  // cheekbone highlight
  float cheekHi = g2(ax - 0.33, l.y - (uEyeY - 0.12), 0.09, 0.05) * faceZone;
  lum += 0.06 * cheekHi * boost;

  // hair: a little darker with a fine strand-like grain
  lum *= 1.0 - 0.3 * hair;
  lum += hair * 0.35 * hashH(floor(l * vec3(90.0, 14.0, 90.0)));

  // soft highlight roll-off: nothing clips to a flat white blob
  float over = max(lum - 0.8, 0.0);
  lum = 0.8 + over / (1.0 + 1.7 * over);

  // fade the neck out below the chin: no shoulders
  maskv = smoothstep(-0.62, -0.28, l.y);
  return lum;
}
`

export const NOISE_GLSL = /* glsl */ `
float noise3(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hashH(i + vec3(0, 0, 0)), hashH(i + vec3(1, 0, 0)), f.x),
        mix(hashH(i + vec3(0, 1, 0)), hashH(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(hashH(i + vec3(0, 0, 1)), hashH(i + vec3(1, 0, 1)), f.x),
        mix(hashH(i + vec3(0, 1, 1)), hashH(i + vec3(1, 1, 1)), f.x), f.y),
    f.z);
}
`

export type HeadUniforms = ReturnType<typeof createHeadUniforms>

export function createHeadUniforms() {
  const c = DEFAULT_CONFIG
  return {
    uHeadMatrix: { value: new THREE.Matrix4() },
    uHeadOffset: { value: new THREE.Vector3() },
    uHeadScale: { value: new THREE.Vector3(REF_SCALE, REF_SCALE, REF_SCALE) },
    uActive: { value: 0 },
    uMouthOpen: { value: 0 },
    uMouthWide: { value: 0 },
    uSmile: { value: 0 },
    uBrow: { value: 0 },
    uEyeOpen: { value: 1 },
    uMouthY: { value: c.mouthY },
    uEyeX: { value: c.eyeX },
    uEyeY: { value: c.eyeY },
    uBrowY: { value: c.browY },
    uJawWidth: { value: c.jawWidth },
    uChin: { value: c.chin },
    uCheek: { value: c.cheek },
    uBrowRidge: { value: c.browRidge },
    uNoseSize: { value: c.noseSize },
    uHair: { value: c.hair },
    uHairline: { value: c.hairline },
    uEyeSize: { value: c.eyeSize },
    uEyeGlow: { value: c.eyeGlow },
    uMouthWidth: { value: c.mouthWidth },
    uLipFull: { value: c.lipFull },
  }
}

/** Push the shape part of a config into the shared uniforms. */
export function applyShapeConfig(u: HeadUniforms, cfg: HeadConfig) {
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
}

/** Rest / active depth of the head inside the cube (it moves forward and grows when she wakes up). */
export const HEAD_Z_REST = -0.95
export const HEAD_Z_ACTIVE = -0.3
const REST_SCALE_MUL = 0.8

const tmpPos = new THREE.Vector3()
const tmpQuat = new THREE.Quaternion()
const tmpScale = new THREE.Vector3()

/** Compose the head placement (scale + offset, "forward" 0..1) into the shared uniforms. */
export function applyPlacement(u: HeadUniforms, cfg: HeadConfig, forward: number) {
  const grow = REST_SCALE_MUL + (1 - REST_SCALE_MUL) * forward
  const sx = cfg.headScale * grow * (1 - 0.5 * cfg.oval)
  const sy = cfg.headScale * grow * (1 + cfg.oval)
  const sz = cfg.headScale * grow
  const z = HEAD_Z_REST + (HEAD_Z_ACTIVE - HEAD_Z_REST) * forward
  u.uHeadScale.value.set(sx, sy, sz)
  u.uHeadOffset.value.set(0, cfg.headY, z)
  u.uHeadMatrix.value.compose(tmpPos.set(0, cfg.headY, z), tmpQuat.identity(), tmpScale.set(sx, sy, sz))
  u.uActive.value = forward
}
