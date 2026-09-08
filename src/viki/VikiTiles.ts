import { PIXEL_CHAINS_GLSL } from './PixelChains'

/** The same cell pitch, aperture and refresh pattern on the head and in its enclosing matrix. */
export const VIKI_TILES_GLSL = /* glsl */ `
uniform float uFlow, uDensity, uCellSize;
${PIXEL_CHAINS_GLSL}
float tileHash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float tileLight(vec2 point) {
  vec2 grid = point * vec2(uDensity, uDensity * 1.16) * 0.5;
  vec2 id = floor(grid), p = abs(fract(grid) - 0.5);
  float footprint = max(length(dFdx(grid)), length(dFdy(grid)));
  float grain = mix(tileHash(vec3(id, 7.0)), 0.57735, smoothstep(0.8, 1.8, footprint));
  vec2 radius = clamp(vec2(0.32, 0.39) * uCellSize * mix(0.78, 1.08, grain), vec2(0.17), vec2(0.46));
  vec2 aa = max(fwidth(grid) * 0.6, vec2(0.035));
  vec2 tile = 1.0 - smoothstep(radius - aa, radius + aa, p);
  float aperture = mix(tile.x * tile.y, 4.0 * radius.x * radius.y, smoothstep(0.8, 1.5, footprint));
  return (0.10 + 0.9 * aperture) * (0.3 + 1.25 * grain * grain + uFlow * chainLight(id) * 1.25);
}
`
