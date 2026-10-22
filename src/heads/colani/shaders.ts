/**
 * C.O.L.A.N.I.'s shaders. GLSL ES 1.0 only: they run unchanged on WebGL 1
 * (the 2009/2010 iMacs), so no derivatives, no texelFetch, no float textures.
 */

export const PASS_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

/**
 * The wall behind him: a baseplate, studs in rows, lit from the upper left -
 * a bright rim on top of each stud, a shadow below it, a soft pool of light
 * behind the figure.
 */
export const PLATE_FRAGMENT = /* glsl */ `
uniform vec2 uSize;
uniform vec3 uColor;
varying vec2 vUv;
void main() {
  vec2 p = (vUv - 0.5) * uSize;
  // One stud per cell.
  vec2 cell = fract(p / 0.32) - 0.5;
  float r = length(cell);
  float stud = 1.0 - smoothstep(0.3, 0.33, r);
  vec2 light = normalize(vec2(-0.6, 0.8));
  // Rim light on the upper left of each stud, shade on the lower right.
  float rim = (1.0 - smoothstep(0.24, 0.31, r)) * smoothstep(0.18, 0.3, r) * dot(normalize(cell + 1e-4), light);
  float drop = (1.0 - smoothstep(0.3, 0.42, length(cell + light * 0.07))) * (1.0 - stud);
  vec3 col = uColor * (1.0 - 0.18 * drop);
  col = mix(col, uColor * 1.06, stud);
  col += vec3(0.16) * max(rim, 0.0) * stud;
  col -= vec3(0.1) * max(-rim, 0.0) * stud;
  // Light falls on the plate behind the figure, the corners stay darker.
  col *= 0.72 + 0.4 * exp(-dot(p - vec2(-0.4, 0.6), p - vec2(-0.4, 0.6)) * 0.035);
  gl_FragColor = vec4(col, 1.0);
}
`

/** Cigar smoke: soft puffs that grow and fade as they rise. */
export const SMOKE_VERTEX = /* glsl */ `
uniform float uScale;
attribute float aAge;
attribute float aSeed;
varying float vAlpha;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float life = clamp(aAge, 0.0, 1.0);
  gl_PointSize = uScale * (0.03 + 0.32 * life * (0.7 + 0.6 * aSeed)) / -mv.z;
  vAlpha = aAge < 0.0 || aAge > 1.0 ? 0.0 : smoothstep(0.0, 0.08, life) * (1.0 - life) * (0.5 + 0.3 * aSeed);
}
`

export const SMOKE_FRAGMENT = /* glsl */ `
varying float vAlpha;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float a = exp(-dot(c, c) * 14.0) * vAlpha;
  gl_FragColor = vec4(vec3(0.93, 0.94, 0.97), a * 0.55);
}
`
