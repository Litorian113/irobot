import { HEAD_DEFORM_GLSL, HEAD_MORPH_GLSL, HEAD_MORPH_INPUT_GLSL, HEAD_UNIFORMS_GLSL, NOISE_GLSL } from '../../viki/headShader'

/**
 * G.L.A.S.'s shaders. GLSL ES 1.0, no derivatives, no float textures: they run
 * unchanged on WebGL 1. Glass without a refraction pass: a multiply pass tints
 * whatever lies behind, an additive pass lays the studio's reflections on top.
 */

/** Shared by glass and ink: the deformed, morphing head in view space. */
export const HEAD_VERTEX = /* glsl */ `
${HEAD_UNIFORMS_GLSL}
${HEAD_DEFORM_GLSL}
${HEAD_MORPH_GLSL}
uniform float uShrink;
uniform vec3 uCore;
varying vec3 vLocal;
varying vec3 vNormal;
varying vec3 vView;
void main() {
  vec3 q, l, nw;
  float hair;
  ${HEAD_MORPH_INPUT_GLSL}
  deformHead(transformed, objectNormal, q, l, nw, hair);
  // The ink is the same skin pulled in towards the core of the head.
  q = uCore + (q - uCore) * uShrink;
  vLocal = l;
  vNormal = normalize(normalMatrix * nw);
  vec4 mv = modelViewMatrix * vec4(q, 1.0);
  vView = mv.xyz;
  gl_Position = projectionMatrix * mv;
}
`

/** A photo studio, seen in reflections: two large softboxes, a strip light, a warm floor. */
const STUDIO_GLSL = /* glsl */ `
float softbox(vec3 r, vec3 dir, vec3 up, vec2 size) {
  vec3 side = normalize(cross(dir, up));
  vec3 u = normalize(cross(side, dir));
  float facing = dot(r, dir);
  if (facing <= 0.0) return 0.0;
  vec2 p = vec2(dot(r, side), dot(r, u)) / facing;
  vec2 d = abs(p) - size;
  return (1.0 - smoothstep(0.0, 0.06, max(d.x, d.y))) * smoothstep(0.0, 0.25, facing);
}
vec3 studio(vec3 r) {
  vec3 col = mix(vec3(0.20, 0.18, 0.17), vec3(0.55, 0.53, 0.51), r.y * 0.5 + 0.5);
  col += vec3(1.0) * softbox(r, normalize(vec3(-0.55, 0.55, 0.62)), vec3(0.0, 1.0, 0.0), vec2(0.55, 0.38)) * 1.6;
  col += vec3(1.0, 0.97, 0.94) * softbox(r, normalize(vec3(0.85, 0.15, 0.3)), vec3(0.0, 1.0, 0.0), vec2(0.08, 0.7)) * 1.2;
  col += vec3(1.0, 0.72, 0.5) * smoothstep(-0.2, -0.75, r.y) * 0.25;
  return col;
}
`

/** Where the glass turns to chrome: lips, nose and ears (head-local coordinates). */
const CHROME_GLSL = /* glsl */ `
float chrome(vec3 l) {
  float front = smoothstep(0.1, 0.35, l.z);
  float lips = g2(l.x, l.y - uMouthY, 0.11, 0.045) * front;
  float nose = g2(l.x, l.y - (uBrowY - 0.36), 0.05, 0.07) * smoothstep(0.35, 0.5, l.z);
  float ear = smoothstep(0.36, 0.43, abs(l.x)) * g2(l.z + 0.02, l.y - 0.42, 0.13, 0.17);
  return clamp(max(max(lips, nose), ear) * 1.4, 0.0, 1.0);
}
`

/** Multiply pass: what shows through the glass, tinted; thick at the rim, chrome nearly opaque. */
export const TINT_FRAGMENT = /* glsl */ `
${HEAD_UNIFORMS_GLSL}
${CHROME_GLSL}
uniform vec3 uTint;
uniform float uBack;
varying vec3 vLocal;
varying vec3 vNormal;
varying vec3 vView;
varying float vFeature;
void main() {
  if (vFeature > 0.5) discard; // no eyeballs or mouth cavity inside the glass
  vec3 n = normalize(vNormal);
  if (uBack > 0.5) n = -n;
  float facing = clamp(dot(n, normalize(-vView)), 0.0, 1.0);
  float edge = 1.0 - facing;
  // Thin and clear where we look straight through, peach in the body, a dark line at the rim.
  vec3 t = mix(vec3(1.0), uTint, mix(0.35, 1.0, smoothstep(0.1, 0.8, edge)));
  t *= 1.0 - 0.75 * smoothstep(0.82, 0.98, edge);
  t = mix(t, vec3(0.12, 0.12, 0.14), chrome(vLocal) * (1.0 - uBack));
  // The back wall is lighter: it only adds a little depth.
  gl_FragColor = vec4(mix(t, vec3(1.0), uBack * 0.55), 1.0);
}
`

/** Front surface, normal blending: frosted pastel glass, denser at the rim; the ink only glimmers through. */
export const BODY_FRAGMENT = /* glsl */ `
${HEAD_UNIFORMS_GLSL}
${CHROME_GLSL}
uniform vec3 uTint;
uniform vec3 uDeep;
varying vec3 vLocal;
varying vec3 vNormal;
varying vec3 vView;
varying float vFeature;
void main() {
  if (vFeature > 0.5) discard;
  vec3 n = normalize(vNormal);
  float edge = 1.0 - clamp(dot(n, normalize(-vView)), 0.0, 1.0);
  vec3 col = mix(uTint, uDeep, smoothstep(0.35, 0.95, edge));
  // Milky at the face, which hides the ink from the front; clear at the back and
  // neck, where the ink shows as soon as the head turns.
  float front = smoothstep(0.05, 0.36, vLocal.z) * smoothstep(-0.3, -0.1, vLocal.y);
  float alpha = mix(mix(0.3, 0.86, front), 0.9, smoothstep(0.35, 0.92, edge));
  // A thin dark line where the glass turns away, like the reference's outline.
  col *= 1.0 - 0.55 * smoothstep(0.9, 0.99, edge);
  float c = chrome(vLocal);
  col = mix(col, vec3(0.16, 0.16, 0.18), c);
  alpha = mix(alpha, 0.94, c);
  gl_FragColor = vec4(col, alpha);
}
`

/** Additive pass: reflections of the studio, strongest at grazing angles and on the chrome. */
export const SHINE_FRAGMENT = /* glsl */ `
${HEAD_UNIFORMS_GLSL}
${STUDIO_GLSL}
${CHROME_GLSL}
uniform vec3 uWarm;
varying vec3 vLocal;
varying vec3 vNormal;
varying vec3 vView;
varying float vFeature;
void main() {
  if (vFeature > 0.5) discard;
  vec3 n = normalize(vNormal);
  vec3 v = normalize(-vView);
  float facing = clamp(dot(n, v), 0.0, 1.0);
  float fresnel = 0.04 + 0.96 * pow(1.0 - facing, 5.0);
  vec3 env = studio(reflect(-v, n));
  float c = chrome(vLocal);
  // Glass reflects mostly at its rim; chrome everywhere. A faint warm inner glow in the body.
  vec3 col = env * mix(fresnel * 0.9 + 0.06, 0.95, c);
  col += uWarm * 0.06 * smoothstep(0.4, 1.0, facing) * (1.0 - c);
  gl_FragColor = vec4(col, 1.0);
}
`

/** The ink: dark, glossy, only behind the ear and down the neck, its edge flowing. */
export const INK_FRAGMENT = /* glsl */ `
${HEAD_UNIFORMS_GLSL}
${NOISE_GLSL}
${STUDIO_GLSL}
uniform float uTime;
varying vec3 vLocal;
varying vec3 vNormal;
varying vec3 vView;
varying float vFeature;
void main() {
  if (vFeature > 0.5) discard;
  vec3 l = vLocal;
  float flow = noise3(vec3(l.x * 3.0, l.y * 2.2 + uTime * 0.12, l.z * 3.0));
  // Behind the ears and down the neck, with tendrils reaching up the back of the
  // skull; the border wanders slowly. Kept off the crown, so the face stays clear from the front.
  float behind = smoothstep(0.0, 0.06, -l.z - 0.08 + (flow - 0.5) * 0.4);
  float low = smoothstep(0.08, -0.08, l.y - 0.42 - (flow - 0.35) * 0.9);
  float back = behind * low;
  float neck = smoothstep(0.1, -0.05, l.y + (flow - 0.5) * 0.3) * smoothstep(-0.1, -0.02, -l.z + 0.1);
  if (max(back, neck) < 0.5) discard;
  vec3 n = normalize(vNormal);
  if (!gl_FrontFacing) n = -n;
  vec3 v = normalize(-vView);
  vec3 env = studio(reflect(-v, n));
  // Glossy streaks running down with the flow.
  float streak = smoothstep(0.82, 1.0, sin(l.y * 38.0 + flow * 9.0 - uTime * 0.8) * 0.5 + 0.5);
  float fresnel = 0.05 + 0.95 * pow(1.0 - clamp(dot(n, v), 0.0, 1.0), 4.0);
  vec3 col = vec3(0.01, 0.018, 0.028) + env * (0.1 + 0.55 * fresnel) + vec3(0.6, 0.75, 0.85) * streak * 0.1;
  gl_FragColor = vec4(col, 1.0);
}
`

export const BACKDROP_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

/** Off-white studio wall, a little warmer and darker towards the corners. */
export const BACKDROP_FRAGMENT = /* glsl */ `
varying vec2 vUv;
void main() {
  vec2 p = vUv - vec2(0.5, 0.55);
  float vignette = 1.0 - dot(p, p) * 0.7;
  gl_FragColor = vec4(vec3(0.95, 0.93, 0.91) * vignette, 1.0);
}
`
