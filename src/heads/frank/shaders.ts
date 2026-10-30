/**
 * F.R.A.N.K.'s shaders. GLSL ES 1.0 only: they run unchanged on WebGL 1
 * (the 2009/2010 iMacs), so no derivatives.
 */

/** A studio wall, a pool of light behind him to one side. Applies its own colour space. */
/** Drawn over the finished picture, straight in clip space. */
export const FILM_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 1.0, 1.0);
}
`

/**
 * The print: grain from a noise texture that jumps every frame, a dark gate around the
 * picture, and now and then a scratch on the film.
 */
export const FILM_FRAGMENT = /* glsl */ `
varying vec2 vUv;
uniform sampler2D uNoise;
uniform vec2 uGrainScale, uGrainOffset;
uniform float uScratch;
void main() {
  float n = texture2D(uNoise, vUv * uGrainScale + uGrainOffset).r;
  vec2 c = (vUv - 0.5) * vec2(1.0, 1.25);
  float gate = smoothstep(0.34, 0.8, length(c));
  float grain = abs(n - 0.5) * 0.17;
  float scratch = (1.0 - smoothstep(0.0003, 0.0011, abs(vUv.x - uScratch))) * 0.16;
  float light = max(step(0.5, n) * grain * (1.0 - gate), scratch);
  // Light marks over a dark gate: a little white, or a lot of black.
  float alpha = max(light, max(grain * (1.0 - step(0.5, n)), gate * 0.8));
  gl_FragColor = vec4(vec3(light / max(alpha, 0.001)), alpha);
}
`

/** Must say the same as `hairlineY` in FrankHead.ts: the skull steps out where the hair starts. */
export const FACE_PARS = /* glsl */ `
varying vec3 vFace;
uniform vec2 uLook;
uniform float uBlink, uSmile, uWide;

/** 1 up to \`near\`, 0 from \`far\` on. smoothstep itself is undefined with its edges swapped. */
float fall(float near, float far, float x) {
  return 1.0 - smoothstep(near, far, x);
}

float hairlineY(float side, float z) {
  float front = 0.84 - 0.66 * smoothstep(0.42, 0.64, side) - 0.06 * exp(-pow((side - 0.39) / 0.035, 2.0));
  return mix(-0.75, front, smoothstep(-0.02, 0.2, z));
}

/** The mouth at x: a long hard line with sunken corners, which lift only when he smiles. */
float mouthY(float x) {
  return -0.515 + x * x * (-0.42 + 0.95 * uSmile);
}
`

/** Hair, eyes and mouth on the painted skin, under the baked shadows. In head units, from the front. */
export const FACE_PAINT = /* glsl */ `
vec2 p = vFace.xy;
vec2 m = vec2(abs(p.x), p.y);

if (vFace.z > 0.0) {
  // Closed lips: a dark seam, the upper lip in shadow, the lower one catching some light.
  float width = 0.3 + 0.02 * uSmile;
  float dy = p.y - mouthY(p.x);
  float ends = fall(width - 0.05, width + 0.012, abs(p.x));
  float upper = fall(0.012, 0.05 - 0.14 * p.x * p.x, dy) * step(0.0, dy);
  float lower = fall(0.02, 0.066 - 0.36 * p.x * p.x, -dy) * step(dy, 0.0);
  diffuseColor.rgb *= 1.0 - 0.72 * upper * ends - 0.34 * lower * ends;

  float open = 0.005 + 0.015 * uSmile * (1.0 - pow(abs(p.x) / width, 2.0));
  float seam = fall(open, open + 0.006, abs(dy)) * ends;
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.006), seam);
  float gaps = smoothstep(0.08, 0.2, abs(fract(p.x / 0.046) - 0.5));
  float teeth = fall(open - 0.008, open - 0.002, abs(dy)) * smoothstep(0.009, 0.016, open) * ends;
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.5), teeth * gaps);

  // The eye: a slit under a heavy lid that hardly ever lifts, the dark iris following what it sees.
  vec2 e = vec2(m.x - 0.305, p.y - 0.085);
  float along = 1.0 - pow(e.x / 0.108, 2.0);
  float slit = (1.0 - uBlink) * max(along, 0.0);
  float top = (0.019 + 0.024 * uWide) * slit;
  float bottom = 0.017 * slit;
  float eye = step(0.0015, slit) * fall(top - 0.003, top + 0.003, e.y) * fall(bottom - 0.003, bottom + 0.003, -e.y);
  vec2 q = p - vec2(sign(p.x) * 0.305, 0.088) - uLook * vec2(0.05, 0.018);
  float d = length(q);
  vec3 ball = mix(vec3(0.006), vec3(0.05) * (0.4 + 0.6 * fall(0.02, 0.1, abs(e.x))), smoothstep(0.034, 0.04, d));
  // The dark rim of the lids around it.
  float rim = fall(top + 0.003, top + 0.016, e.y) * fall(bottom + 0.003, bottom + 0.014, -e.y) * fall(0.11, 0.135, abs(e.x));
  diffuseColor.rgb *= 1.0 - 0.75 * rim;
  diffuseColor.rgb = mix(diffuseColor.rgb, ball, eye);
}

// The flat top is pale, combed forward and shining; the sides and the back are black.
float edgeY = hairlineY(m.x, vFace.z) + 0.005 * sin(p.x * 70.0);
float hair = smoothstep(edgeY - 0.008, edgeY + 0.008, p.y);
float combed = 0.5 + 0.5 * sin(p.x * 150.0 + 2.6 * sin(vFace.z * 8.0 + p.x * 9.0));
float streaks = 0.55 * combed + 0.45 * (0.5 + 0.5 * sin(p.x * 57.0 + vFace.z * 4.0));
float crown = smoothstep(0.62, 0.86, p.y) * fall(0.4, 0.58, m.x);
vec3 hairColor = mix(vec3(0.012 + 0.016 * (0.5 + 0.5 * sin(p.y * 95.0 + vFace.z * 24.0))), vec3(0.46, 0.46, 0.44), crown * (0.42 + 0.58 * streaks));
diffuseColor.rgb = mix(diffuseColor.rgb, hairColor, hair);
`

/** Oily hair shines, grease paint does not. */
export const FACE_ROUGHNESS = /* glsl */ `
roughnessFactor = mix(roughnessFactor, 0.34, hair);
`

/** A wet glint in each eye. */
export const FACE_GLOW = /* glsl */ `
if (vFace.z > 0.0) {
  vec2 g = vFace.xy - vec2(sign(vFace.x) * 0.305, 0.09) - uLook * vec2(0.05, 0.018) - vec2(0.013, 0.006);
  totalEmissiveRadiance += vec3(0.75) * fall(0.003, 0.008, length(g)) * (1.0 - uBlink);
}
`
