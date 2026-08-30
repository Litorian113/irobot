// GLSL for the V.I.K.I. particle lattice.
// Each point of a 3-D grid samples the face texture (see FacePass) at its x/y:
// R = surface depth, G = luminance, B = mask. Points on the surface light up,
// points behind it glow faintly (volumetric fill), the rest stay a dim lattice.

export const vertexShader = /* glsl */ `
uniform sampler2D uFaceTex;
uniform float uTime;
uniform float uFace;       // 0 = dormant lattice, 1 = fully formed face
uniform float uTurb;       // 0..1 turbulence / dissolve
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

void main() {
  vec3 p = position;
  vec3 q = p;
  if (uTurb > 0.001) {
    q += (vec3(
      noise(p * 2.0 + uTime * 0.30),
      noise(p * 2.0 + 7.0 - uTime * 0.25),
      noise(p * 3.0 + uTime * 0.40)) - 0.5) * 0.35 * uTurb;
  }

  vec4 f = texture2D(uFaceTex, p.xy * 0.5 + 0.5);
  float d = f.r;
  float lum = f.g;
  float mask = f.b;

  float dz = p.z - d;
  float shell = exp(-(dz * dz) / (2.0 * 0.075 * 0.075));
  float behind = smoothstep(0.02, -0.5, dz);
  float face = mask * lum * (shell + 0.05 * behind);

  // slow-drifting dim lattice (no flicker: cheap and calm when idle)
  // per-cell variation breaks the moiré of a perfectly regular grid
  float amb = (0.045 + 0.075 * noise(p * 3.0 + vec3(0.0, 0.0, uTime * 0.15))) * (0.7 + 0.6 * aSeed);

  float intensity = amb * (1.0 - 0.35 * uFace) + 1.1 * face * uFace * (1.0 - 0.6 * uTurb);
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
