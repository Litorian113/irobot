// GLSL for the V.I.K.I. particle lattice.
// Each point of a 3-D grid samples the head textures (see FacePass), rendered
// by cameras at +z, -z, +x and -x. A point lights up
// when it sits on any of those surfaces (a closed 3-D shell), glows faintly
// inside the head (volumetric fill) and otherwise stays a dim lattice cell.

export const vertexShader = /* glsl */ `
uniform sampler2D uFront;
uniform sampler2D uBack;
uniform sampler2D uRight;
uniform sampler2D uLeft;
uniform float uTime;
uniform float uFace;       // 0 = dormant lattice, 1 = fully formed face
uniform float uTurb;       // 0..1 turbulence / dissolve
uniform float uGain;       // face brightness
uniform float uFill;       // interior fill
uniform float uPointBase;  // device px per grid cell at camera distance
uniform float uCamDist;

attribute float aSeed;

varying float vIntensity;

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
float shell(float d) { return exp(-(d * d) / (2.0 * 0.075 * 0.075)); }

void main() {
  vec3 p = position;
  vec3 q = p;
  if (uTurb > 0.001) {
    q += (vec3(
      noise(p * 2.0 + uTime * 0.30),
      noise(p * 2.0 + 7.0 - uTime * 0.25),
      noise(p * 3.0 + uTime * 0.40)) - 0.5) * 0.35 * uTurb;
  }

  // screen-x of each orthographic camera (looking at the origin, up = +y)
  vec4 f = texture2D(uFront, vec2(0.5 + 0.5 * p.x, 0.5 + 0.5 * p.y)); // camera +z: right = +x
  vec4 b = texture2D(uBack,  vec2(0.5 - 0.5 * p.x, 0.5 + 0.5 * p.y)); // camera -z: right = -x
  vec4 r = texture2D(uRight, vec2(0.5 - 0.5 * p.z, 0.5 + 0.5 * p.y)); // camera +x: right = -z
  vec4 l = texture2D(uLeft,  vec2(0.5 + 0.5 * p.z, 0.5 + 0.5 * p.y)); // camera -x: right = +z

  float sF = shell(p.z - f.r) * f.g * f.b;
  float sB = shell(p.z - b.r) * b.g * b.b;
  float sR = shell(p.x - r.a) * r.g * r.b;
  float sL = shell(p.x - l.a) * l.g * l.b;
  float surf = max(max(sF, sB), max(sR, sL));

  float insideZ = f.b * b.b * smoothstep(b.r - 0.03, b.r + 0.03, p.z) * (1.0 - smoothstep(f.r - 0.03, f.r + 0.03, p.z));
  float insideX = r.b * l.b * smoothstep(l.a - 0.03, l.a + 0.03, p.x) * (1.0 - smoothstep(r.a - 0.03, r.a + 0.03, p.x));
  float inside = insideZ * insideX;
  float face = surf + uFill * inside * max(f.g, 0.3);

  // per-cell variation breaks the moiré of a perfectly regular grid
  float amb = (0.045 + 0.075 * noise(p * 3.0 + vec3(0.0, 0.0, uTime * 0.15))) * (0.7 + 0.6 * aSeed);

  float intensity = amb * (1.0 - 0.35 * uFace) + uGain * face * uFace * (1.0 - 0.6 * uTurb);
  intensity = min(intensity, 1.1);
  vIntensity = intensity;

  vec4 mv = modelViewMatrix * vec4(q, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = uPointBase * (uCamDist / -mv.z) * (0.6 + 0.4 * clamp(intensity, 0.0, 1.1));
}
`

export const fragmentShader = /* glsl */ `
uniform vec3 uColorDim;
uniform vec3 uColorBright;
uniform vec3 uColorHot;
varying float vIntensity;

void main() {
  // small wide "cell", like the stacked screens of the VIKI lattice
  vec2 c = gl_PointCoord - 0.5;
  float a = (1.0 - smoothstep(0.30, 0.5, abs(c.x))) * (1.0 - smoothstep(0.24, 0.42, abs(c.y)));
  float i = vIntensity;
  vec3 col = mix(uColorDim, uColorBright, clamp(i * 1.2, 0.0, 1.0));
  col = mix(col, uColorHot, clamp((i - 0.75) * 2.5, 0.0, 1.0));
  float alpha = a * clamp(i, 0.0, 1.0);
  if (alpha < 0.005) discard;
  gl_FragColor = vec4(col * (0.35 + 0.65 * i), alpha);
}
`
