import { ATLAS_CELLS, PICTOGRAMS } from './pictograms'

/**
 * O.T.L.'s shaders. GLSL ES 1.0 only: they run unchanged on WebGL 1
 * (the 2009/2010 iMacs), so no derivatives - the flat facet normals come
 * from the CPU - no texelFetch, no float textures.
 */

/**
 * The head turns on the neck (weight by height; the shirt collar barely
 * moves), normals are per facet.
 */
export const BUST_VERTEX = /* glsl */ `
uniform float uYaw, uPitch;
attribute float aRegion, aFacet;
varying vec3 vNormal, vWorld;
varying float vRegion, vFacet;

void main() {
  float cy = cos(uYaw), sy = sin(uYaw), cp = cos(uPitch), sp = sin(uPitch);
  mat3 yaw = mat3(cy, 0.0, -sy, 0.0, 1.0, 0.0, sy, 0.0, cy);
  // Columns: looking up (uPitch > 0) tips the face's +z towards +y.
  mat3 pitch = mat3(1.0, 0.0, 0.0, 0.0, cp, -sp, 0.0, sp, cp);
  mat3 turn = yaw * pitch;
  // Only the head turns; the neck twists inside the collar, collar and shoulders stay put.
  float w = smoothstep(-0.16, 0.12, position.y) * (aRegion > 3.5 ? 0.0 : 1.0);
  vec3 p = mix(position, turn * position, w);
  vNormal = normalize(mix(normal, turn * normal, w));
  vec4 world = modelMatrix * vec4(p, 1.0);
  vWorld = world.xyz;
  vRegion = aRegion;
  vFacet = aFacet;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`

/**
 * Painted facets: brightness from a key light top-right, each facet nudged a
 * little, stepped into a few flat tones and looked up in a palette - mint,
 * teal, steel blue, indigo - like a low-poly bust painted with a few colours.
 * Hair is a pale grey crop, brows, eyes and shirt darker. The white wall
 * bounces into the shadow side, a light blue rims the silhouette. uSweep is a band of
 * light that passes over now and then.
 */
export const BUST_FRAGMENT = /* glsl */ `
uniform vec3 uKey;
uniform float uSweep, uTime;
varying vec3 vNormal, vWorld;
varying float vRegion, vFacet;

float hash(float n) { return fract(sin(n * 12.9898) * 43758.5453); }

vec3 ramp(float t) {
  vec3 c0 = vec3(0.07, 0.06, 0.2);
  vec3 c1 = vec3(0.13, 0.17, 0.5);
  vec3 c2 = vec3(0.24, 0.47, 0.66);
  vec3 c3 = vec3(0.52, 0.79, 0.76);
  vec3 c4 = vec3(0.86, 0.95, 0.91);
  vec3 c5 = vec3(0.97, 0.99, 0.97);
  if (t < 0.25) return mix(c0, c1, t / 0.25);
  if (t < 0.48) return mix(c1, c2, (t - 0.25) / 0.23);
  if (t < 0.68) return mix(c2, c3, (t - 0.48) / 0.2);
  if (t < 0.86) return mix(c3, c4, (t - 0.68) / 0.18);
  return mix(c4, c5, clamp((t - 0.86) / 0.14, 0.0, 1.0));
}

void main() {
  if (!gl_FrontFacing) {
    gl_FragColor = vec4(0.05, 0.04, 0.14, 1.0);
    return;
  }
  vec3 n = normalize(vNormal);
  float light = dot(n, uKey) * 0.5 + 0.5;
  light = light * light * 1.15;
  // Every facet painted a touch differently.
  light += (hash(vFacet) - 0.5) * 0.14;
  // A band of light sweeping diagonally over the head.
  light += 0.22 * exp(-pow((vWorld.x * 0.8 + vWorld.y * 0.6 - uSweep) * 5.0, 2.0)) * step(0.0, dot(n, vec3(0.3, 0.4, 0.9)));

  float r = vRegion;
  float tone = 0.0;
  if (r > 0.5 && r < 1.5) tone = 0.0;        // hair: its own grey, below
  else if (r > 1.5 && r < 2.5) tone = -0.52; // brows: heavy and dark
  else if (r > 2.5 && r < 3.5) tone = -0.58; // eyes: slits in shadow
  else if (r > 3.5) tone = -0.66;            // the black shirt
  // A few flat tones per region, not a smooth gradient: painted, not rendered.
  float t = clamp(light + tone, 0.0, 1.0);
  t = (floor(t * 8.0) + 0.5) / 8.0;
  vec3 col = ramp(t);
  // The crop: grey-white facets, set apart from the mint skin.
  if (r > 0.5 && r < 1.5) col = mix(vec3(0.24, 0.23, 0.33), vec3(0.76, 0.76, 0.79), t);

  // The white wall bounces a cool light into what faces away from the key.
  float bounce = smoothstep(0.1, 0.9, dot(n, normalize(vec3(-0.9, -0.25, 0.2))));
  col = mix(col, col * vec3(1.1, 1.15, 1.2) + vec3(0.04, 0.06, 0.09), bounce * 0.4);
  // A light blue rim, the blue of the 1972 Games, where the surface turns away.
  float rim = pow(1.0 - clamp(n.z, 0.0, 1.0), 3.0) * (0.5 + 0.5 * smoothstep(0.2, -0.6, n.x));
  col += vec3(0.25, 0.5, 0.75) * rim * 0.3;
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

/**
 * The wall: white paper with a section of a sheet of sport pictograms in
 * square fields (atlas: red = figure, green = frame and number). Now and then
 * one figure takes on a colour of the 1972 Games and lets it go again.
 */
export const WALL_FRAGMENT = /* glsl */ `
uniform sampler2D uAtlas;
uniform float uHi, uHiAmount;
uniform vec3 uHiColor;
varying vec2 vUv;

const float PITCH = 1.3;
const float COUNT = ${PICTOGRAMS.toFixed(1)};
const float CELLS = ${ATLAS_CELLS.toFixed(1)};

void main() {
  vec2 p = (vUv - 0.5) * vec2(16.0, 9.0);
  vec2 g = (p - vec2(-0.45, 0.2)) / PITCH;
  vec2 tile = floor(g);
  vec2 f = fract(g);
  // Each field its own figure; along a row they run on like on the sheet.
  float k = mod(tile.x + tile.y * 5.0, COUNT);
  vec2 cell = vec2(mod(k, CELLS), floor(k / CELLS));
  vec4 sheet = texture2D(uAtlas, vec2((cell.x + f.x) / CELLS, 1.0 - (cell.y + 1.0 - f.y) / CELLS));

  vec3 paper = vec3(0.955, 0.95, 0.935);
  float hi = uHiAmount * (1.0 - step(0.5, abs(k - uHi)));
  vec3 ink = mix(vec3(0.74, 0.76, 0.79), uHiColor, hi);
  vec3 col = mix(paper, vec3(0.83, 0.84, 0.85), sheet.g);
  col = mix(col, ink, sheet.r);
  // A soft shadow of the head on the paper, and darker towards the corners.
  vec2 s = (p - vec2(-0.35, 0.1)) * vec2(1.0, 0.75);
  col *= 1.0 - 0.08 * exp(-dot(s, s) * 0.5);
  col *= 1.0 - 0.12 * smoothstep(3.0, 9.0, length(p * vec2(0.8, 1.2)));
  gl_FragColor = vec4(col, 1.0);
}
`
