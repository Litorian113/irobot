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
 * The wall behind him: pale, in Colani's round forms - a big tilted droplet,
 * long swelling curves sweeping across - and a floor far back where his truck
 * is parked. uHorizon is the floor line's height on this wall (world units).
 */
export const STUDIO_FRAGMENT = /* glsl */ `
uniform vec2 uSize;
uniform float uHorizon;
varying vec2 vUv;

// Soft-edged inside of a shape whose distance-like value is d (< 0 inside).
float inside(float d) { return 1.0 - smoothstep(-0.02, 0.02, d); }

void main() {
  vec2 p = (vUv - 0.5) * uSize;
  vec3 col = mix(vec3(0.82, 0.86, 0.9), vec3(0.93, 0.95, 0.97), smoothstep(-0.5, 3.0, p.y));

  // A large droplet, tilted, top right: lighter, like a form lit from within.
  vec2 q = p - vec2(2.6, 1.9);
  float c = cos(0.6), s = sin(0.6);
  q = vec2(c * q.x - s * q.y, s * q.x + c * q.y);
  q.y += 0.35 * q.x * q.x * 0.2;
  float drop = length(q * vec2(0.62, 1.0)) - 1.25 + 0.25 * q.y;
  col = mix(col, col * 1.04 + 0.025, inside(drop));
  // Its echo, smaller, bottom left.
  vec2 e = p - vec2(-3.3, 0.2);
  col = mix(col, col * 0.97, inside(length(e * vec2(0.8, 1.1)) - 0.9 + 0.2 * e.x));

  // Two long, swelling curves sweeping across the wall.
  float wave = p.y - (0.7 + 0.45 * sin(p.x * 0.42 + 0.6) + 0.12 * sin(p.x * 1.1));
  col = mix(col, col * 0.95 + vec3(0.0, 0.01, 0.02), inside(-wave) * inside(wave - 0.32));
  float swoop = p.y - (2.4 + 0.5 * sin(p.x * 0.33 - 1.4));
  col = mix(col, col * 1.03 + 0.015, inside(-swoop) * inside(swoop - 0.16));

  // The floor, with a soft rounded cove where it meets the wall.
  vec3 floorCol = mix(vec3(0.72, 0.75, 0.79), vec3(0.8, 0.83, 0.86), smoothstep(uHorizon - 2.0, uHorizon, p.y));
  col = mix(floorCol, col, smoothstep(uHorizon - 0.03, uHorizon + 0.12, p.y));

  // Light falls on the wall behind the figure, the corners stay a little darker.
  col *= 0.88 + 0.16 * exp(-dot(p - vec2(-0.4, 0.5), p - vec2(-0.4, 0.5)) * 0.06);
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
