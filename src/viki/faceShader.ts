// GLSL for the V.I.K.I. particle lattice.
// Every point of a 3-D grid evaluates a procedural face height-field f(x, y).
// Points whose z lies on that surface light up; the rest stay a dim lattice.

export const vertexShader = /* glsl */ `
uniform float uTime;
uniform float uFace;       // 0 = dormant lattice, 1 = fully formed face
uniform float uMouthOpen;  // 0..1
uniform float uMouthWide;  // 0..1
uniform float uSmile;      // -1 frown .. 1 smile
uniform float uBrow;       // -1 furrow .. 1 raise
uniform float uEyeOpen;    // 0 closed .. 1.3 wide
uniform float uTurb;       // 0..1 turbulence / dissolve
uniform float uPointBase;  // device px per grid cell at camera distance
uniform float uCamDist;

attribute float aSeed;

varying float vIntensity;

float g1(float v, float s) { return exp(-(v * v) / (2.0 * s * s)); }
float g2(float x, float y, float sx, float sy) {
  return exp(-((x * x) / (2.0 * sx * sx) + (y * y) / (2.0 * sy * sy)));
}

float hash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float noise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash(i + vec3(0, 0, 0)), hash(i + vec3(1, 0, 0)), f.x),
        mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x),
        mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y),
    f.z);
}

// Height-field of the face. Returns surface z; mask = inside head silhouette,
// glow = extra brightness (eyes) / darkness (mouth cavity).
float faceDepth(vec2 p, out float mask, out float glow, out float eyes) {
  float x = p.x;
  float y = p.y;
  float ax = abs(x);

  float r = (x * x) / (0.70 * 0.70) + (y * y) / (0.90 * 0.90);
  mask = 1.0 - smoothstep(0.62, 0.96, r);
  float z = sqrt(max(0.0, 1.0 - r)) * 0.6 - 0.3;

  // nose
  float noseRidge = g1(x, 0.06) * g1(y - 0.05, 0.2);
  z += 0.17 * noseRidge;
  z += 0.07 * g2(x, y + 0.12, 0.09, 0.05);

  // eyes
  float ex = ax - 0.26;
  float ey = y - 0.22;
  z -= 0.11 * g2(ex, ey, 0.15, 0.09);
  float eyeball = g2(ex, ey, 0.08, 0.045 * max(uEyeOpen, 0.15));
  z += 0.04 * uEyeOpen * eyeball;

  // brows
  float browY = 0.40 + 0.07 * uBrow - 0.05 * max(0.0, -uBrow) * (1.0 - smoothstep(0.1, 0.45, ax));
  float brow = g2(ex - 0.02, y - browY, 0.16, 0.03);
  z += 0.07 * brow;

  // mouth
  float xm = x / 0.22;
  float yc = -0.42 + uSmile * 0.10 * xm * xm - 0.03 * uMouthOpen;
  float w = 0.20 + 0.06 * uMouthWide - 0.04 * uMouthOpen;
  float h = 0.015 + 0.14 * uMouthOpen;
  float inX = 1.0 - smoothstep(w * 0.75, w, ax);
  float dy = abs(y - yc);
  float cavity = inX * (1.0 - smoothstep(h * 0.5, h, dy));
  z -= 0.22 * cavity;
  float lips = inX * g1(dy - h, 0.03);
  z += 0.05 * lips;

  // chin, cheeks
  z += 0.03 * g2(x, y + 0.68, 0.18, 0.06);
  z += 0.03 * max(uSmile, 0.0) * g2(ax - 0.38, y + 0.2, 0.12, 0.1);

  eyes = uEyeOpen * g2(ex, ey, 0.07, 0.04 * max(uEyeOpen, 0.2));
  glow = 0.6 * brow + 0.8 * lips + 0.5 * noseRidge - 0.9 * cavity;
  return z;
}

void main() {
  vec3 p = position;

  // turbulence: particles drift off-grid while dissolving / thinking
  vec3 disp = (vec3(
    noise(p * 2.0 + uTime * 0.30),
    noise(p * 2.0 + 7.0 - uTime * 0.25),
    noise(p * 3.0 + uTime * 0.40)) - 0.5) * 0.35 * uTurb;
  vec3 q = p + disp;

  float mask, glow, eyes, m2, g2_, e2;
  float d = faceDepth(p.xy, mask, glow, eyes);
  float eps = 0.02;
  float ddx = faceDepth(p.xy + vec2(eps, 0.0), m2, g2_, e2) - d;
  float ddy = faceDepth(p.xy + vec2(0.0, eps), m2, g2_, e2) - d;
  vec3 nrm = normalize(vec3(-ddx, -ddy, eps));
  float light = 0.25 + 0.75 * max(0.0, dot(nrm, normalize(vec3(0.25, 0.45, 1.0))));
  float facing = pow(max(nrm.z, 0.0), 1.3); // flanks of the head fade out, no bright rim

  float dz = p.z - d;
  float surf = exp(-(dz * dz) / (2.0 * 0.085 * 0.085));
  float face = surf * mask * (light * facing * max(0.0, 1.0 + glow) + 1.5 * eyes);

  float amb = 0.05 + 0.10 * pow(noise(p * 4.0 + vec3(0.0, 0.0, uTime * 0.6)), 2.0);
  float twinkle = 0.22 * smoothstep(0.975, 1.0, noise(vec3(aSeed * 120.0, uTime * 0.8, 3.0)));

  float intensity = (amb + twinkle) * (1.0 - 0.25 * uFace) + 0.55 * face * uFace * (1.0 - 0.6 * uTurb);
  intensity = min(intensity, 1.1);
  vIntensity = intensity;

  vec4 mv = modelViewMatrix * vec4(q, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = uPointBase * (uCamDist / -mv.z) * (0.42 + 0.55 * clamp(intensity, 0.0, 1.1));
}
`

export const fragmentShader = /* glsl */ `
uniform vec3 uColorDim;
uniform vec3 uColorBright;
uniform vec3 uColorHot;
varying float vIntensity;

void main() {
  vec2 c = gl_PointCoord - 0.5;
  float m = max(abs(c.x), abs(c.y));
  float a = 1.0 - smoothstep(0.28, 0.5, m);
  float i = vIntensity;
  vec3 col = mix(uColorDim, uColorBright, clamp(i * 1.2, 0.0, 1.0));
  col = mix(col, uColorHot, clamp((i - 0.8) * 2.0, 0.0, 1.0));
  float alpha = a * clamp(i, 0.0, 1.0);
  if (alpha < 0.005) discard;
  gl_FragColor = vec4(col * (0.35 + 0.65 * i), alpha);
}
`
