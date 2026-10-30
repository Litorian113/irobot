/**
 * A.R.T.'s shaders. GLSL ES 1.0 only: they run unchanged on WebGL 1
 * (the 2009/2010 iMacs), so no derivatives, no texelFetch, no float textures.
 * Everything is grey: he only exists on black-and-white film.
 */

export const MASK_VERTEX = /* glsl */ `
attribute vec3 aFace;
uniform float uJaw;
varying vec3 vNormal;
varying vec2 vPlan;
varying vec2 vFace;
void main() {
  // The jaw hangs from the upper lip: the hole in the plan opens as its lower edge drops.
  vec3 p = position;
  p.y -= uJaw * aFace.y;
  p.z -= uJaw * aFace.y * 0.18;
  vNormal = normal;
  vPlan = uv;
  vFace = vec2(aFace.x, aFace.z);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`

/**
 * White latex and greasepaint. uDetail, projected from the front:
 * red the black paint, green the hole of the mouth, blue the creases (grey = none).
 * vFace: x how far this point faces the front, y the dirt baked into the hollows.
 */
export const MASK_FRAGMENT = /* glsl */ `
uniform mat4 modelMatrix;
uniform sampler2D uDetail;
uniform vec3 uKey;
uniform float uLight;
varying vec3 vNormal;
varying vec2 vPlan;
varying vec2 vFace;

void main() {
  vec2 st = vec2(vPlan.x / 1.8 + 0.5, vPlan.y / 2.8 + 0.5);
  vec4 detail = texture2D(uDetail, st);
  float face = step(0.5, vFace.x);
  if (face * detail.g > 0.5) discard;
  // Looking into the mouth you see the inside of the head: pure black.
  if (!gl_FrontFacing) {
    gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }
  float e = 0.0035;
  float dx = texture2D(uDetail, st + vec2(e, 0.0)).b - detail.b;
  float dy = texture2D(uDetail, st + vec2(0.0, e)).b - detail.b;
  vec3 n = normalize(vNormal - vec3(dx, dy, 0.0) * 2.6);
  n = normalize(mat3(modelMatrix) * n);
  float diffuse = max(dot(n, uKey) * 0.86 + 0.14, 0.0);

  float crease = smoothstep(0.5, 0.18, detail.b);
  float paint = smoothstep(0.35, 0.65, detail.r) * face;
  float albedo = 0.93 * (1.0 - 0.42 * crease) * (1.0 - clamp(vFace.y, 0.0, 0.85));
  albedo *= 1.0 - paint;

  vec3 half_ = normalize(uKey + vec3(0.0, 0.0, 1.0));
  float spec = pow(max(dot(n, half_), 0.0), 34.0) * mix(0.1, 0.2, paint);
  float col = albedo * (0.07 + 0.98 * diffuse) + spec;
  gl_FragColor = vec4(vec3(col * uLight), 1.0);
}
`

export const BALL_VERTEX = /* glsl */ `
varying vec3 vLocal, vNormal;
void main() {
  vLocal = normalize(position);
  vNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

/** An eye far back in the black: a dull grey iris, a big pupil and one hard glint. */
export const EYE_FRAGMENT = /* glsl */ `
uniform vec3 uKey;
uniform float uLight;
varying vec3 vLocal, vNormal;
void main() {
  float r = acos(clamp(vLocal.z, -1.0, 1.0));
  float col = mix(0.02, 0.15, smoothstep(0.55, 0.3, r));
  col *= smoothstep(0.17, 0.2, r);
  vec3 n = normalize(vNormal);
  vec3 half_ = normalize(uKey + vec3(0.0, 0.0, 1.0));
  col += pow(max(dot(n, half_), 0.0), 220.0) * 0.8;
  gl_FragColor = vec4(vec3(col * uLight), 1.0);
}
`

export const PASS_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

/** The dark behind him: out of focus, something like a shop window at night. */
export const ROOM_FRAGMENT = /* glsl */ `
uniform float uLight;
varying vec2 vUv;
void main() {
  vec2 p = (vUv - 0.5) * vec2(16.0, 9.0);
  float pool = exp(-dot(p - vec2(0.4, 0.5), p - vec2(0.4, 0.5)) * 0.16);
  float bars = 0.8 + 0.2 * sin(p.y * 2.3 + sin(p.x * 0.7) * 0.8) * sin(p.x * 0.9 + 1.0);
  gl_FragColor = vec4(vec3(0.15 * pool * bars * uLight), 1.0);
}
`

export const FILM_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`

/** Over everything: film grain jumping from frame to frame, and the corners going dark. */
export const FILM_FRAGMENT = /* glsl */ `
uniform sampler2D uNoise;
uniform vec2 uScale, uOffset;
varying vec2 vUv;
void main() {
  float grain = texture2D(uNoise, vUv * uScale + uOffset).r;
  vec2 c = vUv - 0.5;
  float corner = smoothstep(0.14, 0.62, dot(c, c));
  gl_FragColor = vec4(vec3(grain * (1.0 - corner)), 0.055 + 0.6 * corner);
}
`
