/**
 * V.O.L.T.'s shaders. GLSL ES 1.0 only: they run unchanged on WebGL 1
 * (the 2009/2010 iMacs), so no derivatives, no texelFetch, no float textures.
 */

export const PASS_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

export const SCREEN_VERTEX = /* glsl */ `
varying vec2 vP;
void main() {
  vP = position.xy; // head units, centred on the screen
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

/**
 * The face: two eyes and a mouth drawn as distance fields, on an LED dot mesh.
 * uError turns the eyes into X and the mouth into a flat line; uGlitch tears rows sideways.
 */
export const SCREEN_FRAGMENT = /* glsl */ `
uniform float uTime, uBlink, uHappy, uCurious, uError, uGlitch;
uniform vec2 uLook, uSize;
uniform vec3 uGlow;
varying vec2 vP;

// An upward arc (the happy "^" eye): the circle's upper half.
float arcUp(vec2 q, float r, float t) {
  if (q.y >= 0.0) return abs(length(q) - r) - t;
  return length(vec2(abs(q.x) - r, q.y)) - t;
}

// A smile: the lower part of a circle centred above, spanning +-span radians.
float smile(vec2 q, float r, float span, float t) {
  q.y -= r;
  float a = atan(q.x, -q.y);
  if (abs(a) < span) return abs(length(q) - r) - t;
  vec2 tip = r * vec2(sin(span), -cos(span));
  return length(vec2(abs(q.x), q.y) - tip) - t;
}

// A rounded X (half-size s, stroke r).
float xMark(vec2 q, float s, float r) {
  q = abs(q);
  return length(q - min(q.x + q.y, 2.0 * s) * 0.5) - r;
}

float hash(float n) {
  return fract(sin(n) * 43758.5453);
}

void main() {
  vec2 p = vP;
  // A glitch tears horizontal bands sideways, changing many times a second.
  float row = floor(p.y * 14.0);
  float tick = floor(uTime * 24.0);
  float tear = step(0.55, hash(row * 7.1 + tick)) * (hash(row + tick * 3.7) - 0.5);
  p.x += uGlitch * tear * 0.16;
  float d = 1000.0;

  // eyes
  float eyeR = mix(0.12, 0.15, uCurious);
  for (int i = 0; i < 2; i++) {
    float side = i == 0 ? -1.0 : 1.0;
    vec2 q = p - (vec2(side * 0.25, 0.08) + uLook);
    q.y /= max(0.05, 1.0 - uBlink);
    float roundEye = length(q) - eyeR;
    float happyEye = arcUp(q + vec2(0.0, 0.035), 0.105, 0.032);
    float xEye = xMark(q, 0.1, 0.03);
    d = min(d, mix(mix(roundEye, happyEye, uHappy), xEye, uError));
  }

  // mouth: a smile, an "o" when curious
  vec2 m = p - (vec2(0.0, -0.2) + uLook * 0.7);
  float smileD = smile(m, mix(0.1, 0.13, uHappy), mix(0.55, 0.9, uHappy), mix(0.022, 0.03, uHappy));
  float oD = abs(length(m - vec2(0.0, 0.01)) - 0.045) - 0.018;
  float flatMouth = length(vec2(max(abs(m.x) - 0.08, 0.0), m.y - 0.02)) - 0.02;
  d = min(d, mix(mix(smileD, oD, uCurious), flatMouth, uError));

  float core = smoothstep(0.004, -0.004, d);
  float halo = exp(-max(d, 0.0) * 55.0);

  // LED dot mesh and scanlines, a slow bright band rolling down.
  vec2 cell = fract(p / 0.0125) - 0.5;
  float led = mix(0.35, 1.0, smoothstep(0.5, 0.18, length(cell)));
  float scan = 0.9 + 0.1 * sin(p.y * 260.0 + uTime * 6.0);
  float band = 1.0 + 0.3 * exp(-pow((fract(p.y * 0.6 - uTime * 0.12) - 0.5) * 9.0, 2.0));

  // Dark glass, faintly lit from within, darker towards the bezel, with one soft reflection.
  vec2 edge = abs(p) / (uSize * 0.5);
  float rim = smoothstep(0.65, 1.0, max(edge.x, edge.y));
  vec3 glass = vec3(0.006, 0.008, 0.007) + uGlow * 0.01 * (1.0 - rim);
  glass += vec3(0.05) * smoothstep(0.08, 0.0, abs(p.x + p.y * 0.8 + 0.35)) * 0.2;

  vec3 light = uGlow * (core * 1.9 + halo * 0.22) * led * scan * band;
  gl_FragColor = vec4(glass + light, 1.0);
}
`

/** Lens flares: kind 0 is an anamorphic streak, kind 1 a soft halo. Additive. */
export const FLARE_FRAGMENT = /* glsl */ `
uniform vec3 uGlow;
uniform float uKind, uIntensity;
varying vec2 vUv;
void main() {
  vec2 q = (vUv - 0.5) * 2.0;
  float streak = exp(-abs(q.x) * 4.0) * exp(-q.y * q.y * 5.0) * 0.35;
  float halo = exp(-dot(q, q) * 6.0) * 0.12;
  float a = (uKind < 0.5 ? streak : halo) * uIntensity;
  gl_FragColor = vec4(uGlow, a);
}
`

/** The wall behind: dark, a faint glow behind the head, a passing scan. */
export const BACKDROP_FRAGMENT = /* glsl */ `
uniform float uTime;
uniform vec3 uGlow;
varying vec2 vUv;
void main() {
  vec2 p = (vUv - 0.5) * vec2(40.0, 24.0);
  vec3 col = vec3(0.008, 0.01, 0.013);
  col += uGlow * 0.018 * exp(-dot(p, p) * 0.03);
  float scan = exp(-pow((p.y - (mod(uTime * 1.1, 30.0) - 15.0)) * 0.7, 2.0));
  col += uGlow * scan * 0.012 * exp(-abs(p.x) * 0.08);
  gl_FragColor = vec4(col, 1.0);
}
`

/** Specks drifting up behind the head. Positions come from seeds and time only. */
export const SPARK_VERTEX = /* glsl */ `
uniform float uTime, uScale;
attribute vec4 aSeed;
varying float vAlpha;
void main() {
  float y = mod(aSeed.y * 10.0 + uTime * (0.08 + 0.14 * aSeed.w), 10.0) - 5.0;
  vec3 p = vec3((aSeed.x - 0.5) * 12.0 + sin(uTime * 0.3 + aSeed.w * 20.0) * 0.2, y, -1.2 - aSeed.z * 4.0);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = uScale * (2.0 + 4.0 * aSeed.w) * (6.0 / -mv.z);
  vAlpha = (0.25 + 0.75 * aSeed.w) * smoothstep(-5.0, -3.5, y) * smoothstep(5.0, 3.0, y) * (0.6 + 0.4 * sin(uTime * 3.0 + aSeed.x * 40.0));
}
`

export const SPARK_FRAGMENT = /* glsl */ `
uniform vec3 uGlow;
varying float vAlpha;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  gl_FragColor = vec4(uGlow, exp(-dot(c, c) * 18.0) * vAlpha * 0.45);
}
`
