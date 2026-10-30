/**
 * A.D.A.M.'s shaders. GLSL ES 1.0 only: they run unchanged on WebGL 1
 * (the 2009/2010 iMacs), so no derivatives.
 */

export const PASS_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

/**
 * A storm at night: two layers of a painted cloud texture drifting past each other, cheap
 * enough for the old GPUs, lit from inside by the lightning. Applies its own colour space.
 */
export const BACKDROP_FRAGMENT = /* glsl */ `
varying vec2 vUv;
uniform sampler2D uClouds;
uniform float uTime, uFlash;
void main() {
  float a = texture2D(uClouds, vUv * vec2(1.6, 1.0) + vec2(uTime * 0.006, 0.0)).r;
  float b = texture2D(uClouds, vUv * vec2(2.7, 1.7) + vec2(-uTime * 0.011, 0.31)).r;
  float clouds = a * 0.65 + b * 0.35;
  float glow = 1.0 - smoothstep(0.0, 0.8, length((vUv - vec2(0.5, 0.62)) * vec2(1.6, 1.0)));
  vec3 night = mix(vec3(0.003, 0.005, 0.012), vec3(0.075, 0.11, 0.2), clouds * clouds) * (0.35 + 1.1 * glow);
  vec3 color = night + vec3(0.42, 0.5, 0.75) * uFlash * (0.1 + clouds * clouds);
  gl_FragColor = vec4(pow(color, vec3(1.0 / 2.2)), 1.0);
}
`

/** Declarations added to the head's material. */
export const FACE_PARS = /* glsl */ `
varying vec3 vFace;
uniform vec2 uLook;
uniform float uBlink, uSmile, uWide;

/** 1 up to \`near\`, 0 from \`far\` on. smoothstep itself is undefined with its edges swapped. */
float fall(float near, float far, float x) {
  return 1.0 - smoothstep(near, far, x);
}

/** The height of the mouth at x: the corners sink, and lift only a little when he smiles. */
float mouthY(float x) {
  return -0.555 + x * x * (-0.8 + 1.15 * uSmile);
}
`

/** Hair, sockets, eyes and mouth on the patched skin. In head units, seen from the front. */
export const FACE_PAINT = /* glsl */ `
vec2 p = vFace.xy;
vec2 m = vec2(abs(p.x), p.y);

// The hair grows from the skin: a low hairline down to the temples, all of the back of the head.
float hairline = 0.6 - 0.62 * smoothstep(0.3, 0.68, m.x) + 0.05 * sin(p.x * 34.0);
float hair = smoothstep(hairline - 0.012, hairline + 0.012, p.y);
if (vFace.z < 0.05) hair = 1.0;

if (vFace.z > 0.0) {
  // Deep, bruised sockets, darkest right around the eye.
  float socket = fall(0.035, 0.2, length((m - vec2(0.26, 0.165)) * vec2(1.0, 1.75)));
  diffuseColor.rgb *= 1.0 - 0.95 * socket;
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.02, 0.012, 0.022), socket * socket * 0.7);

  // Thin, bloodless lips.
  float width = 0.2 + 0.02 * uSmile;
  float dy = p.y - mouthY(p.x);
  float ends = fall(width - 0.02, width + 0.012, abs(p.x));
  float lips = fall(0.014, 0.04, abs(dy + 0.003)) * ends;
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.13, 0.07, 0.085), lips * 0.85);

  // The mouth: a dark line that parts when he smiles, over teeth of a pearly white.
  float open = 0.005 + 0.016 * uSmile * (1.0 - pow(abs(p.x) / width, 2.0));
  float line = fall(open, open + 0.005, abs(dy)) * ends;
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.008, 0.004, 0.006), line);
  float gaps = smoothstep(0.08, 0.2, abs(fract(p.x / 0.038) - 0.5));
  float teeth = fall(open - 0.008, open - 0.002, abs(dy)) * smoothstep(0.009, 0.016, open) * ends;
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.62, 0.6, 0.5), teeth * gaps);

  // The eye: a narrow almond under a heavy lid, its pale iris following what it sees.
  vec2 e = vec2(m.x - 0.26, p.y - 0.165);
  float along = 1.0 - pow(e.x / 0.092, 2.0);
  float high = (0.027 + 0.018 * uWide) * (1.0 - uBlink) * max(along, 0.0);
  float eye = fall(high - 0.003, high + 0.003, abs(e.y + 0.004)) * step(0.0015, high) * step(0.0, along);
  vec2 q = p - vec2(sign(p.x) * 0.26, 0.162) - uLook * vec2(0.04, 0.018);
  float d = length(q);
  vec3 white = vec3(0.3, 0.27, 0.19) * (0.5 + 0.5 * fall(0.02, 0.09, abs(e.x)));
  vec3 iris = mix(vec3(0.34, 0.42, 0.42), vec3(0.07, 0.1, 0.11), smoothstep(0.012, 0.031, d));
  vec3 ball = mix(iris, white, smoothstep(0.03, 0.034, d));
  ball = mix(vec3(0.003), ball, smoothstep(0.008 + 0.003 * uWide, 0.012 + 0.003 * uWide, d));
  diffuseColor.rgb = mix(diffuseColor.rgb, ball, eye);
}
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.008, 0.008, 0.011), hair);
`

/** A wet glint in each eye: they are watery, and catch the lightning. */
export const FACE_GLOW = /* glsl */ `
if (vFace.z > 0.0) {
  vec2 g = vFace.xy - vec2(sign(vFace.x) * 0.26, 0.162) - uLook * vec2(0.04, 0.018) - vec2(-0.011, 0.009);
  totalEmissiveRadiance += vec3(0.6, 0.72, 0.9) * fall(0.003, 0.008, length(g)) * (1.0 - uBlink);
}
`
