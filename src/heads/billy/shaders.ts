/**
 * B.I.L.L.Y.'s shaders. GLSL ES 1.0 only: they run unchanged on WebGL 1
 * (the 2009/2010 iMacs), so no derivatives, no texelFetch, no float textures.
 */

export const MASK_VERTEX = /* glsl */ `
attribute vec3 aPaint;
varying vec3 vPos, vNormal, vPaint;
varying vec2 vPlan;
void main() {
  vPos = position;
  vNormal = normal;
  vPaint = aPaint;
  // Before the bumps: where this point lies on the mask's plan, for the cuts and the print.
  vPlan = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

/**
 * Old papier-mache: off-white, dirty in its creases, cracked. aPaint holds
 * x the black round the eyes, y the red lips, z the dirt in the hollows.
 * uCut opens the slot the chin moves in and trims the jowls.
 */
export const MASK_FRAGMENT = /* glsl */ `
uniform mat4 modelMatrix;
uniform sampler2D uDetail;
uniform vec3 uKey;
uniform float uLight, uCut, uEyeGlow;
varying vec3 vPos, vNormal, vPaint;
varying vec2 vPlan;

void main() {
  vec2 st = vec2(vPlan.x / 1.7 + 0.5, vPlan.y / 2.4 + 0.5);
  vec4 detail = texture2D(uDetail, st);
  if (uCut > 0.5) {
    float edge = (detail.b - 0.5) * 0.05;
    if (abs(vPlan.x) < 0.232 && vPlan.y < -0.415) discard;
    if (vPlan.y < -0.78 + edge) discard;
    // The jowls taper in towards the jaw.
    if (vPlan.y < -0.3 && abs(vPlan.x) > 0.68 + (vPlan.y + 0.3) * 0.58 + edge) discard;
  }
  if (!gl_FrontFacing) {
    gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }
  // The rough surface: bump from the detail map.
  float e = 0.004;
  float dx = texture2D(uDetail, st + vec2(e, 0.0)).r - detail.r;
  float dy = texture2D(uDetail, st + vec2(0.0, e)).r - detail.r;
  vec3 n = normalize(vNormal - vec3(dx, dy, 0.0) * 1.1);
  n = normalize(mat3(modelMatrix) * n);
  float diffuse = max(dot(n, uKey) * 0.72 + 0.28, 0.0);

  vec3 paper = vec3(0.86, 0.84, 0.79) * (0.72 + 0.48 * detail.r);
  // Grey-brown dirt settled in the hollows, and hairline cracks.
  paper = mix(paper, vec3(0.24, 0.21, 0.18), clamp(vPaint.z, 0.0, 0.88));
  paper *= 1.0 - 0.75 * detail.g;
  vec3 lips = vec3(0.72, 0.04, 0.03) * (0.82 + 0.3 * detail.r);
  vec3 albedo = mix(paper, lips, smoothstep(0.42, 0.62, vPaint.y));
  float soot = smoothstep(0.1, 0.5, vPaint.x);
  albedo *= 1.0 - soot;

  vec3 half_ = normalize(uKey + vec3(0.0, 0.0, 1.0));
  float spec = pow(max(dot(n, half_), 0.0), 28.0) * (0.1 + 0.35 * smoothstep(0.42, 0.62, vPaint.y)) * (1.0 - soot);
  vec3 col = albedo * (0.1 + 0.95 * diffuse) * uLight + vec3(spec) * uLight;
  // The eyes' red reaches a little way into the black.
  col += vec3(0.14, 0.006, 0.004) * uEyeGlow * smoothstep(0.75, 1.0, vPaint.x);
  gl_FragColor = vec4(col, 1.0);
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

/** A cheek: a white ball with a hand-painted red spiral winding round its +z pole. */
export const CHEEK_FRAGMENT = /* glsl */ `
uniform vec3 uKey;
uniform float uLight, uSide;
varying vec3 vLocal, vNormal;
void main() {
  float polar = acos(clamp(vLocal.z, -1.0, 1.0));
  float around = atan(vLocal.y, vLocal.x) * uSide;
  // Wobbly, as painted by a shaky hand.
  float wobble = 0.05 * sin(around * 3.0 + polar * 5.0);
  float s = fract(polar * 3.1 / 1.57 + around / 6.2831853 + wobble);
  float red = smoothstep(0.03, 0.08, s) * (1.0 - smoothstep(0.42, 0.47, s));
  red *= smoothstep(0.12, 0.2, polar);
  vec3 albedo = mix(vec3(0.86, 0.83, 0.78), vec3(0.72, 0.04, 0.03), red);
  vec3 n = normalize(vNormal);
  float diffuse = max(dot(n, uKey) * 0.72 + 0.28, 0.0);
  vec3 half_ = normalize(uKey + vec3(0.0, 0.0, 1.0));
  float spec = pow(max(dot(n, half_), 0.0), 40.0) * 0.28;
  gl_FragColor = vec4((albedo * (0.1 + 0.95 * diffuse) + spec) * uLight, 1.0);
}
`

/** An eye: wet red iris, darker ring, black pupil; it keeps glowing when the light fails. */
export const EYE_FRAGMENT = /* glsl */ `
uniform vec3 uKey;
uniform float uLight, uGlow, uPupil;
varying vec3 vLocal, vNormal;
void main() {
  float r = acos(clamp(vLocal.z, -1.0, 1.0));
  vec3 iris = mix(vec3(0.95, 0.12, 0.06), vec3(0.42, 0.01, 0.01), smoothstep(0.35, 1.05, r));
  // A dark band round the pupil, then the sharp black pupil itself.
  iris *= 0.45 + 0.55 * smoothstep(uPupil, uPupil + 0.2, r);
  vec3 col = mix(vec3(0.0), iris, smoothstep(uPupil - 0.02, uPupil + 0.02, r));
  col *= 0.42 * uLight + 0.55 * uGlow;
  vec3 n = normalize(vNormal);
  vec3 half_ = normalize(uKey + vec3(0.0, 0.0, 1.0));
  col += vec3(1.0, 0.92, 0.88) * pow(max(dot(n, half_), 0.0), 170.0) * (0.25 + 0.9 * uLight);
  gl_FragColor = vec4(col, 1.0);
}
`

export const PASS_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

/** Almost pure black: the faintest grimy wall behind him, there only while the light is on. */
export const ROOM_FRAGMENT = /* glsl */ `
uniform float uLight;
varying vec2 vUv;
void main() {
  vec2 p = (vUv - 0.5) * vec2(16.0, 9.0);
  float pool = exp(-dot(p - vec2(0.0, 0.2), p - vec2(0.0, 0.2)) * 0.22);
  vec3 col = vec3(0.06, 0.055, 0.05) * pool * uLight;
  gl_FragColor = vec4(col, 1.0);
}
`
