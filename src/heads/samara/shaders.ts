/**
 * S.A.M.A.R.A.'s shaders. GLSL ES 1.0 only: they run unchanged on WebGL 1
 * (the 2009/2010 iMacs), so no derivatives.
 */

/** A wood out of focus, in the teal of the film: one painted texture drifting past itself. Applies its own colour space. */
/** Declarations added to the head's material. */
export const FACE_PARS = /* glsl */ `
varying vec3 vFace;
uniform vec2 uLook;
uniform float uBlink, uOpen, uWide;

/** 1 up to \`near\`, 0 from \`far\` on. smoothstep itself is undefined with its edges swapped. */
float fall(float near, float far, float x) {
  return 1.0 - smoothstep(near, far, x);
}
`

/** Hair shadow, sockets, the mouth and the one eye to be seen. In head units, seen from the front. */
export const FACE_PAINT = /* glsl */ `
vec2 p = vFace.xy;
vec2 m = vec2(abs(p.x), p.y);
vec3 eyeColor = vec3(0.0);
float eyeMask = 0.0;

// Her other eye sits behind the hair and deeper in the dark: the face is not even.
float hidden = step(p.x, 0.0);

if (vFace.z > 0.0) {
  // Sockets like bruises, darkest right around the eye.
  float socket = fall(0.03, 0.2 + 0.03 * hidden, length((m - vec2(0.25, 0.135)) * vec2(1.0, 1.65)));
  diffuseColor.rgb *= 1.0 - (0.88 + 0.1 * hidden) * socket;
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.006, 0.012, 0.012), socket * socket * (0.65 + 0.3 * hidden));

  // Lips without blood, the corners pulled down.
  float dy = p.y + 0.52 + 1.25 * p.x * p.x;
  float ends = fall(0.17, 0.215, m.x);
  float lips = fall(0.022, 0.085, abs(dy + 0.008)) * ends;
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.03, 0.033, 0.036), lips * 0.9);

  // The mouth: a dark line that parts when she has seen you.
  float open = 0.009 + 0.034 * uOpen * (1.0 - pow(m.x / 0.215, 2.0));
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.002, 0.002, 0.003), fall(open, open + 0.006, abs(dy)) * ends);

  // The eye: a narrow almond, sloping down towards the nose, under a heavy lid.
  vec2 e = vec2(m.x - 0.25, p.y - 0.135 - (m.x - 0.25) * 0.24);
  float along = 1.0 - pow(e.x / 0.092, 2.0);
  float high = (0.028 + 0.022 * uWide) * (1.0 - uBlink) * max(along, 0.0) * (1.0 - 0.35 * hidden);
  eyeMask = fall(high - 0.003, high + 0.003, abs(e.y + 0.004)) * step(0.0015, high) * step(0.0, along);
  vec2 q = p - vec2(sign(p.x) * 0.25, 0.137) - uLook * vec2(0.034, 0.014);
  float d = length(q);
  vec3 white = vec3(0.12, 0.125, 0.11) * (0.4 + 0.6 * fall(0.02, 0.08, abs(e.x)));
  vec3 iris = mix(vec3(0.52, 0.7, 0.86), vec3(0.17, 0.27, 0.36), smoothstep(0.016, 0.04, d));
  eyeColor = mix(iris, white, smoothstep(0.038, 0.043, d));
  eyeColor = mix(vec3(0.004), eyeColor, smoothstep(0.012 - 0.003 * uWide, 0.016 - 0.003 * uWide, d));
  eyeColor *= 1.0 - 0.8 * hidden;
  diffuseColor.rgb = mix(diffuseColor.rgb, eyeColor, eyeMask);

  // The curtain of hair throws its shadow over everything at the edge of the face.
  float curtain = smoothstep(0.16, 0.4, m.x + 0.05 * hidden);
  float above = smoothstep(0.42, 0.72, p.y);
  diffuseColor.rgb *= (1.0 - 0.9 * curtain) * (1.0 - 0.9 * above);

  // Under the nose, and the lower half of the face sinks into the dirt.
  diffuseColor.rgb *= 1.0 - 0.72 * fall(0.02, 0.1, length((p - vec2(0.0, -0.345)) * vec2(0.55, 1.6)));
  diffuseColor.rgb *= 1.0 - 0.9 * fall(-0.98, -0.58, p.y);
  diffuseColor.rgb *= 1.0 - 0.6 * fall(0.015, 0.05, abs(p.y + 0.615 + 0.5 * p.x * p.x)) * ends;

  // The sides of the nose, for shape where the flat light gives none.
  diffuseColor.rgb *= 1.0 - 0.62 * fall(0.0, 0.05, abs(m.x - 0.105)) * fall(0.0, 0.2, abs(p.y + 0.07));
}
// Where the hair grows the skin is never seen.
float hairline = 0.78 - 0.34 * smoothstep(0.08, 0.6, m.x);
if (vFace.z < 0.05 || p.y > hairline) diffuseColor.rgb = vec3(0.004, 0.005, 0.006);
`

/** Only the eye lights up by itself: pale out of the dark, with a wet glint. */
export const FACE_GLOW = /* glsl */ `
totalEmissiveRadiance += eyeColor * eyeMask * (0.32 + 0.3 * uWide);
if (vFace.z > 0.0) {
  vec2 g = vFace.xy - vec2(sign(vFace.x) * 0.25, 0.137) - uLook * vec2(0.034, 0.014) - vec2(-0.009, 0.007);
  totalEmissiveRadiance += vec3(0.7, 0.85, 0.95) * fall(0.0025, 0.007, length(g)) * eyeMask * (1.0 - hidden);
}
`

export const HAIR_PARS = /* glsl */ `
uniform vec2 uCounter;
uniform float uTime;
`

/**
 * Wet and heavy: the hair hardly sways, the more the lower it hangs. Everything that lies on the
 * shoulders stays behind when the head turns (uCounter: yaw and pitch of the head).
 */
export const HAIR_MOVE = /* glsl */ `
float low = 1.0 - smoothstep(-1.8, 0.4, position.y);
transformed.x += low * (0.032 * sin(uTime * 0.7 + position.y * 1.7 + position.x * 5.0) + 0.011 * sin(uTime * 1.7 + position.x * 13.0));
transformed.z += low * 0.012 * sin(uTime * 0.9 + position.x * 7.0);
float stay = 1.0 - smoothstep(-1.5, -0.7, position.y);
float yaw = -uCounter.x * stay, pitch = -uCounter.y * stay;
transformed.xz = vec2(transformed.x * cos(yaw) + transformed.z * sin(yaw), -transformed.x * sin(yaw) + transformed.z * cos(yaw));
float above = transformed.y + 0.9;
transformed.yz = vec2(above * cos(pitch) - transformed.z * sin(pitch) - 0.9, above * sin(pitch) + transformed.z * cos(pitch));
`

/** Covers the whole picture, in clip space. */
export const TAPE_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 1.0, 1.0);
}
`

/** The cursed tape: scan lines, grain, a dark edge, and when it skips, snow and a bright tracking band. */
export const TAPE_FRAGMENT = /* glsl */ `
varying vec2 vUv;
uniform sampler2D uNoise;
uniform vec2 uScale, uOffset;
uniform float uSkip, uBand, uHeight;
void main() {
  float grain = texture2D(uNoise, vUv * uScale + uOffset).r;
  float scan = 0.5 + 0.5 * sin(vUv.y * uHeight * 2.1);
  vec2 c = (vUv - 0.5) * vec2(1.25, 1.05);
  float edge = smoothstep(0.32, 0.8, length(c));
  float band = 1.0 - smoothstep(0.0, 0.05 + 0.05 * grain, abs(vUv.y - uBand));
  float snow = uSkip * (0.28 + 0.62 * band);
  // Black at first, for the lines and the edge; the snow on top of that, white and grey.
  float dark = 1.0 - (1.0 - 0.11 * scan) * (1.0 - 0.5 * edge) * (1.0 - 0.09 * grain);
  float alpha = dark + snow - dark * snow;
  gl_FragColor = vec4(vec3(0.72, 0.84, 0.82) * grain * snow / max(alpha, 0.001), alpha);
}
`
