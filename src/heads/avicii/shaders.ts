/**
 * A.V.I.C.I.I.'s shaders. GLSL ES 1.0 only: they run unchanged on WebGL 1
 * (the 2009/2010 iMacs), so no derivatives - the flat facet normals come from
 * the CPU (see AviciiHead) - no texelFetch, no float textures.
 */

/**
 * The head turns on the neck (weight by height), normals are per facet. As
 * in O.T.L.'s bust. Regions: 0 skin, 1 cap, 2 brow, 3 eye, 5 hair, 6 stubble.
 */
export const BUST_VERTEX = /* glsl */ `
uniform float uYaw, uPitch;
attribute float aRegion, aFacet;
varying vec3 vNormal, vWorld;
varying float vRegion, vFacet;

void main() {
  float cy = cos(uYaw), sy = sin(uYaw), cp = cos(uPitch), sp = sin(uPitch);
  mat3 yaw = mat3(cy, 0.0, -sy, 0.0, 1.0, 0.0, sy, 0.0, cy);
  mat3 pitch = mat3(1.0, 0.0, 0.0, 0.0, cp, -sp, 0.0, sp, cp);
  mat3 turn = yaw * pitch;
  float w = smoothstep(-0.16, 0.12, position.y);
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
 * Low-poly greyscale: brightness from a key light on the left, each facet
 * nudged a little and stepped into a few flat greys. Skin light, the cap near
 * black, brows and eyes dark, hair and stubble mid-grey. On a 128 BPM beat a few facets flash now and then, like a
 * quiet light show.
 */
export const BUST_FRAGMENT = /* glsl */ `
uniform vec3 uKey;
uniform float uTime;
varying vec3 vNormal, vWorld;
varying float vRegion, vFacet;

float hash(float n) { return fract(sin(n * 12.9898) * 43758.5453); }

void main() {
  if (!gl_FrontFacing) {
    gl_FragColor = vec4(vec3(0.06), 1.0);
    return;
  }
  vec3 n = normalize(vNormal);
  float light = dot(n, uKey) * 0.5 + 0.5;
  light = light * light * 1.1 + 0.05;
  light += (hash(vFacet) - 0.5) * 0.16;

  // The beat: 128 per minute; on each, a handful of facets light up and fade.
  float beat = uTime * 128.0 / 60.0;
  float flash = step(0.985, hash(vFacet * 1.37 + floor(beat))) * exp(-fract(beat) * 5.0);
  light += flash * 0.35;

  float r = vRegion;
  float lo = 0.16, hi = 0.97;                 // skin
  if (r > 0.5 && r < 1.5) { lo = 0.02; hi = 0.3; }        // cap: near black, its facets catching light
  else if (r > 1.5 && r < 2.5) { lo = 0.12; hi = 0.5; }   // brows
  else if (r > 2.5 && r < 3.5) { lo = 0.03; hi = 0.22; }  // eyes
  else if (r > 4.5 && r < 5.5) { lo = 0.18; hi = 0.62; }  // hair
  else if (r > 5.5) { lo = 0.12; hi = 0.6; }              // stubble, light
  float t = clamp(light, 0.0, 1.0);
  t = (floor(t * 9.0) + 0.5) / 9.0;
  vec3 col = vec3(mix(lo, hi, t));
  // A pale rim where the surface turns away, lifting the dark cap and hoodie off the wall.
  col += vec3(0.18) * pow(1.0 - clamp(n.z, 0.0, 1.0), 4.0);
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
 * The wall: large grey triangles, each a slightly different tone, bright where
 * the light comes from on the left, darker to the right and the corners.
 */
export const WALL_FRAGMENT = /* glsl */ `
varying vec2 vUv;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void main() {
  vec2 p = (vUv - 0.5) * vec2(16.0, 9.0);
  // A triangle grid: skew into cells, split each along its diagonal.
  vec2 q = p * 0.9;
  q.x += q.y * 0.5;
  vec2 cell = floor(q);
  vec2 f = fract(q);
  float upper = step(f.y, f.x);
  float tone = hash(cell * 1.7 + upper * 13.1);
  float base = 0.5 + 0.38 * exp(-dot(p - vec2(-3.5, 1.0), p - vec2(-3.5, 1.0)) * 0.05);
  base *= 1.0 - 0.25 * smoothstep(3.0, 9.0, length(p * vec2(0.7, 1.1)));
  gl_FragColor = vec4(vec3(base + (tone - 0.5) * 0.07), 1.0);
}
`
