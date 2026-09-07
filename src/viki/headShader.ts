import * as THREE from 'three'
import { DEFAULT_CONFIG, REF_SCALE, type HeadConfig } from './config'

/**
 * Shared GLSL for every head style. Relative position/normal morphs animate the
 * new head; procedural expressions remain available for the legacy scan.
 * Proportions, hair and lighting use the same head frame in every pass.
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
uniform float uFormation;
uniform float uLighting;
uniform vec3 uKeyDirection;
uniform float uLightFill;
uniform sampler2D uKeyShadow;
uniform mat4 uKeyMatrix;
uniform float uShadowReady;
uniform float uRigged;
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
float headCoverage(vec3 l) {
  if (uFormation < 0.001) return 0.0;
  if (uFormation > 0.999) return 1.0;
  float cell = hashH(floor(l * 120.0));
  return smoothstep(cell * 0.85, cell * 0.85 + 0.15, uFormation);
}
/** head frame -> head-local (reference-scale) coordinates, where all feature anchors live */
vec3 toLocal(vec3 headFrame) { return (headFrame - uHeadOffset) * (${REF_SCALE.toFixed(3)} / uHeadScale); }
`

export const HEAD_MORPH_GLSL = /* glsl */ `
#include <morphtarget_pars_vertex>
attribute float aFeature;
varying float vFeature;
`

export const HEAD_MORPH_INPUT_GLSL = /* glsl */ `
  vec3 transformed = position;
  vec3 objectNormal = normal;
  #include <morphnormal_vertex>
  #include <morphtarget_vertex>
  vFeature = aFeature;
`

export const HEAD_DEFORM_GLSL = /* glsl */ `
/**
 * Deform a raw scan vertex. Outputs the head-frame position q (before the cube
 * rotation), the head-local anchor coordinates l, the head-frame normal nw and
 * how much hair covers this vertex.
 */
void deformHead(vec3 position, vec3 normal, out vec3 q, out vec3 l, out vec3 nw, out float hairOut) {
  q = (uHeadMatrix * vec4(position, 1.0)).xyz;
  nw = normalize(normal / uHeadScale);
  l = toLocal(q);
  float front = smoothstep(-0.25, 0.25, l.z);
  float ax = abs(l.x);

  if (uRigged < 0.5) {
  // Bring the tall scan's crown into balance with the face.
  q.y -= max(l.y - 0.68, 0.0) * 0.18 * uHeadScale.y / ${REF_SCALE.toFixed(3)};

  // jaw drops: everything below the mouth line sinks, smoothly blended
  float jaw = (1.0 - smoothstep(uMouthY - 0.30, uMouthY + 0.10, l.y)) * front;
  q.y -= uMouthOpen * 0.095 * jaw;
  q.z -= uMouthOpen * 0.018 * jaw;

  // Stretch / round the lips locally with the analysed vowel energy.
  float mouthZone = g2(l.x, l.y - uMouthY, uMouthWidth, 0.10) * front;
  q.x += l.x * (uMouthWide - 0.4) * uMouthOpen * 0.24 * mouthZone;

  // smile / frown: mouth corners up-out or down
  float corner = g2(ax - 0.20, l.y - uMouthY, 0.10, 0.09) * front;
  q.y += uSmile * 0.05 * corner;
  q.x += sign(l.x) * max(uSmile, 0.0) * 0.025 * corner;

  // Compress the sculpted eyelids towards their seam during a blink.
  float eye = g2(ax - uEyeX, l.y - uEyeY, 0.075 * uEyeSize, 0.048) * front;
  q.y -= (l.y - uEyeY) * (1.0 - clamp(uEyeOpen, 0.0, 1.0)) * 0.75 * eye;

  // brows raise / furrow
  float brow = g2(ax - 0.22, l.y - uBrowY, 0.16, 0.06) * front;
  q.y += uBrow * 0.045 * brow;
  q.z += max(-uBrow, 0.0) * 0.02 * brow;

  }

  // configurable proportions: jaw & neck width, brow ridge, nose, cheekbones, chin
  float below = 1.0 - smoothstep(uMouthY - 0.45, uMouthY + 0.15, l.y);
  q.x = uHeadOffset.x + (q.x - uHeadOffset.x) * (mix(0.96, 1.0, uRigged) - uJawWidth * below);
  float ridge = g2(ax - 0.20, l.y - (uBrowY - 0.03), 0.25, 0.05) * front;
  q.z -= uBrowRidge * ridge;
  float nose = g2(l.x, l.y - (uBrowY - 0.30), 0.07, 0.11) * front;
  q.z += uNoseSize * nose;
  // Narrow the bridge and alae as nose size is reduced, not only its depth.
  q.x += l.x * min(uNoseSize, 0.0) * 3.0 * nose;
  float cheek = g2(ax - 0.30, l.y - (uBrowY - 0.30), 0.10, 0.08) * front;
  q.z += uCheek * cheek;
  float chin = g2(l.x, l.y - (uMouthY - 0.22), 0.14, 0.08) * front;
  q.x = uHeadOffset.x + (q.x - uHeadOffset.x) * (1.0 - uChin * chin);

  // fuller lips: a soft geometric bump along the mouth
  float lensV = pow(max(1.0 - pow(clamp(l.x / uMouthWidth, -1.0, 1.0), 2.0), 0.0), 0.7);
  float lipBump = exp(-pow((l.y - uMouthY) / 0.035, 2.0)) * lensV * front;
  q.z += uLipFull * 0.12 * lipBump;
  if (uRigged > 0.5) {
    float lipRegion = g2(l.x, l.y - uMouthY, 0.19, 0.10) * front;
    q.x += l.x * (uMouthWidth / 0.15 - 1.0) * lipRegion * uHeadScale.x / ${REF_SCALE.toFixed(3)};
  }

  // hair: volume on the skull above a hairline that dips at the temples, plus the back of the head
  float hl = uHairline - 0.5 * ax * ax;
  float hair = smoothstep(hl, hl + 0.10, l.y) * (1.0 - smoothstep(0.35, 0.6, l.z));
  hair = max(hair, (1.0 - smoothstep(-0.15, 0.15, l.z)) * smoothstep(-0.35, -0.05, l.y));
  q += nw * uHair * 0.07 * hair;
  hairOut = hair * uHair;
}
`

export const HEAD_PAINT_GLSL = /* glsl */ `
/**
 * Lighting + semantic part shading for a surface point. n is the normal in the
 * head frame (light is attached to the head). Returns luminance 0..~1.3 and
 * writes the open-mouth cavity (0..1) and the neck fade mask (0..1).
 */
float keyVisibility(vec3 q, vec3 n) {
  if (uShadowReady < 0.5) return 1.0;
  vec4 shadow = uKeyMatrix * vec4(q, 1.0);
  vec3 uv = shadow.xyz / shadow.w * 0.5 + 0.5;
  if (min(uv.x, uv.y) < 0.0 || max(uv.x, uv.y) > 1.0) return 1.0;
  float bias = 0.0012 + 0.0015 * (1.0 - max(dot(n, uKeyDirection), 0.0));
  float visible = 0.0;
  for (int x = -1; x <= 1; x++) for (int y = -1; y <= 1; y++) {
    float depth = texture2D(uKeyShadow, uv.xy + vec2(float(x), float(y)) / 1024.0).r;
    visible += step(uv.z - bias, depth);
  }
  return visible / 9.0;
}
float paintLum(vec3 l, vec3 n, vec3 q, float hair, float feature, out float cav, out float maskv) {
  // Broad portrait lighting: retain the scan's anatomy without black eye sockets.
  vec3 key = uKeyDirection;
  vec3 fill = normalize(vec3(0.65, 0.15, 0.9));
  float lum = uLightFill + 0.43 * max(dot(n, key), 0.0)
                   + uLightFill * max(dot(n, fill), 0.0);
  lum += 0.06 * pow(1.0 - abs(n.z), 2.0);

  if (uLighting > 0.5) {
    float diffuse = max(dot(n, uKeyDirection), 0.0);
    lum = uLightFill + 0.92 * diffuse * keyVisibility(q, n);
    lum += 0.025 * pow(1.0 - abs(n.z), 3.0);
  }

  float cinematicMask = 1.0;
  if (uLighting > 1.5) {
    // Art-directed light falloff follows anatomical landmarks, not screen space.
    // Broad feathering keeps the forehead/central cheeks lit without hard patches.
    float socket = 1.0 - smoothstep(0.72, 1.28, length(vec2((abs(l.x) - uEyeX) / 0.108, (l.y - (uEyeY + 0.018)) / 0.071)));
    float side = 1.0 - smoothstep(0.22, 0.37, abs(l.x));
    float crown = 1.0 - smoothstep(uBrowY + 0.17, uBrowY + 0.32, l.y);
    float frontLight = smoothstep(0.10, 0.33, l.z);
    cinematicMask = (1.0 - socket) * side * crown * frontLight;
    lum *= cinematicMask;
  }

  float ax = abs(l.x);
  float faceZone = smoothstep(0.05, 0.35, l.z);
  float boost = mix(0.55, 1.0, uActive);

  if (uRigged > 0.5) {
    cav = 0.0;
    maskv = smoothstep(-0.40, -0.16, l.y);
    maskv *= 1.0 - 0.5 * smoothstep(0.36, 0.56, ax);
    maskv *= 1.0 - 0.65 * smoothstep(0.85, 1.14, l.y);
    if (feature > 1.5) return uLighting > 1.5 ? 0.005 : 0.028;
    if (feature > 0.5) {
      if (uLighting > 1.5) return 0.003 * cinematicMask;
      // Iris shading is restricted to the actual eyeballs, behind the moving lids.
      float iris = 1.0 - smoothstep(0.029 * uEyeSize, 0.038 * uEyeSize, length(vec2(ax - uEyeX, l.y - uEyeY)));
      return mix(0.49 + 0.10 * uEyeGlow, 0.23, iris) * (uLighting < 0.5 ? 1.0 : clamp(lum * 1.35, 0.12, 1.0));
    }
    float browBand = g2(ax - uEyeX, l.y - uBrowY, 0.075, 0.018) * faceZone;
    lum *= 1.0 - 0.12 * browBand;
    return min(lum, 0.85);
  }

  // mouth: a wide lens. The upper lip stays put, the lower lip drops with the jaw.
  float mw = uMouthWidth * (1.0 + 0.22 * uMouthWide);
  float u = clamp(l.x / mw, -1.0, 1.0);
  float lens = pow(max(1.0 - u * u, 0.0), 0.7);
  float openH = (0.003 + 0.045 * uMouthOpen) * lens;
  float top = uMouthY + 0.008 * lens;
  float bottom = uMouthY - openH;
  float inside = smoothstep(bottom - 0.012, bottom + 0.004, l.y) * (1.0 - smoothstep(top - 0.004, top + 0.012, l.y));
  inside *= 1.0 - smoothstep(0.85, 1.0, abs(l.x / mw));
  cav = inside * smoothstep(0.02, 0.12, uMouthOpen) * faceZone;
  lum = mix(lum, 0.10, cav);
  float lipLine = exp(-pow((l.y - uMouthY) / 0.006, 2.0)) * lens * (1.0 - cav) * faceZone;
  float lowerLip = exp(-pow((l.y - (bottom - 0.015)) / 0.012, 2.0)) * lens * (1.0 - cav) * faceZone;
  float upperLip = exp(-pow((l.y - (top + 0.010)) / 0.009, 2.0)) * lens * (1.0 - cav) * faceZone;
  lum *= 1.0 - 0.55 * lipLine * boost;
  lum += (0.10 + uLipFull) * boost * (0.25 * lowerLip + 0.12 * upperLip);

  // Quiet eyes within the sculpted lids: a small iris and a muted opening,
  // using the same light range as the face, without white bars or catchlights.
  float ex = (ax - uEyeX) / (0.085 * uEyeSize);
  float eyeLens = max(0.0, 1.0 - ex * ex);
  float lidY = uEyeY + 0.009 * eyeLens;
  vec2 ep = vec2(ax - uEyeX, l.y - uEyeY);
  float eyeHeight = 0.019 * uEyeSize * clamp(uEyeOpen, 0.08, 1.3);
  float aperture = (1.0 - smoothstep(0.45, 1.0,
    pow(ep.x / (0.067 * uEyeSize), 2.0) + pow(ep.y / eyeHeight, 2.0))) * faceZone;
  float iris = 1.0 - smoothstep(0.012, 0.020, length(ep));
  lum = mix(lum, mix(0.44, 0.20, iris), aperture * 0.75 * boost);
  float lid = exp(-pow((l.y - lidY) / 0.009, 2.0)) * eyeLens * faceZone;
  lum *= 1.0 - lid * (0.16 + 0.20 * (1.0 - clamp(uEyeOpen, 0.0, 1.0)));
  lum += 0.025 * uEyeGlow * g2(ax - uEyeX, l.y - (uEyeY - 0.035), 0.075, 0.024) * faceZone;

  // Brows are a soft change in tone, never a dark painted arch.
  float bx = ax - uEyeX;
  float yb = uBrowY + 0.012 - 0.65 * bx * bx;
  float browBand = g2(bx, l.y - yb, 0.075, 0.018) * faceZone;
  lum *= 1.0 - 0.12 * browBand;

  // cheekbone highlight
  float cheekHi = g2(ax - 0.33, l.y - (uEyeY - 0.12), 0.09, 0.05) * faceZone;
  lum += 0.06 * cheekHi * boost;

  // hair: a little darker with a fine strand-like grain
  lum *= 1.0 - 0.3 * hair;
  lum += hair * 0.35 * hashH(floor(l * vec3(90.0, 14.0, 90.0)));

  // A gentle local shadow tames inward-facing nostril facets. Keep the
  // bridge, septum and nose wings intact instead of painting a black band.
  float nostril = g2(ax - 0.065, l.y - 0.295, 0.022, 0.014) * faceZone;
  lum = mix(lum, min(lum, 0.22), nostril * 0.75);

  // soft highlight roll-off: nothing clips to a flat white blob
  float over = max(lum - 0.8, 0.0);
  lum = min(lum, 0.8) + over / (1.0 + 1.7 * over);

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
    uFormation: { value: 0 },
    uLighting: { value: 1 },
    uKeyDirection: { value: new THREE.Vector3(0, 0.707, 0.707) },
    uLightFill: { value: c.lightFill },
    uKeyShadow: { value: null as THREE.Texture | null },
    uKeyMatrix: { value: new THREE.Matrix4() },
    uShadowReady: { value: 0 },
    uRigged: { value: 0 },
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
  u.uLighting.value = cfg.lighting === 'soft' ? 0 : cfg.lighting === 'viki' ? 2 : 1
  u.uLightFill.value = cfg.lightFill
  const elevation = THREE.MathUtils.degToRad(cfg.lightElevation)
  u.uKeyDirection.value.set(cfg.lighting === 'cinema' ? -0.10 : 0, Math.sin(elevation), Math.cos(elevation)).normalize()
  if (cfg.lighting === 'soft') u.uKeyDirection.value.set(-0.35, 0.45 * Math.tan(elevation) / Math.tan(Math.PI / 6), 1).normalize()
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
