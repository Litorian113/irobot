/**
 * W.A.L.L.·E's shaders. GLSL ES 1.0 only: they run unchanged on WebGL 1
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
 * A binocular lens: smoked, domed glass with an inner lens ring, and a warm
 * amber light deep inside that is his pupil - uAperture is its size. Fine
 * scratches, and the room reflected on the dome; uTurn moves the reflections
 * as the head turns. uEvil turns the light red.
 */
export const LENS_FRAGMENT = /* glsl */ `
uniform float uTime, uAperture, uZoom, uEvil, uFlash, uSide;
uniform vec2 uTurn;
uniform vec3 uEvilColor;
varying vec2 vUv;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void main() {
  vec2 p = (vUv - 0.5) * 2.0;
  float r = length(p);
  if (r > 1.0) discard;

  // Smoked glass, a little lighter towards the rim where the dome catches the room.
  vec3 col = mix(vec3(0.014, 0.011, 0.01), vec3(0.07, 0.06, 0.055), smoothstep(0.5, 1.0, r));

  // The inner lens: a darker barrel with a bright edge; it slides in when zooming.
  float z = 1.0 - 0.15 * uZoom;
  float inner = 0.6 * z;
  col *= 1.0 - 0.5 * (1.0 - smoothstep(inner - 0.02, inner + 0.02, r));
  col += vec3(0.2, 0.17, 0.14) * exp(-pow((r - inner) * 55.0, 2.0));
  col += vec3(0.07, 0.06, 0.05) * exp(-pow((r - inner * 0.75) * 70.0, 2.0));

  // The warm light inside: a soft disc with a hot centre.
  vec3 warm = mix(vec3(1.0, 0.55, 0.25), uEvilColor, uEvil);
  float core = mix(0.1, 0.42, uAperture) * z;
  float disc = 1.0 - smoothstep(core * 0.25, core, r);
  float pulse = 0.88 + 0.12 * sin(uTime * 1.3 + uSide);
  col += warm * (disc * disc * 0.8 + exp(-r * r / (core * core + 0.001) * 2.0) * 0.3) * pulse * (1.0 + uEvil * 0.8);
  // A faint glow fills the inner barrel, a red haze when evil.
  col += warm * (0.05 + 0.35 * uEvil) * (1.0 - smoothstep(inner - 0.05, inner, r));

  // Fine scratches on the glass.
  for (int i = 0; i < 7; i++) {
    float fi = float(i) + uSide * 13.0;
    vec2 c = vec2(hash(vec2(fi, 1.0)), hash(vec2(fi, 2.0))) * 1.4 - 0.7;
    float a = hash(vec2(fi, 3.0)) * 3.1416;
    vec2 d = vec2(cos(a), sin(a));
    vec2 q = p - c;
    float across = abs(dot(q, vec2(-d.y, d.x)));
    float along = abs(dot(q, d));
    col += vec3(0.16) * (1.0 - smoothstep(0.0, 0.01, across)) * (1.0 - smoothstep(0.0, 0.16, along));
  }

  // Reflections on the dome: a window arc top-left, the key light, a warm glint below.
  vec2 key = vec2(-0.4, 0.45) - uTurn;
  col += vec3(0.7, 0.68, 0.62) * exp(-pow(length((p - key) * vec2(1.0, 1.7)), 2.0) * 18.0) * (0.6 + uFlash * 3.0);
  float arc = exp(-pow((r - 0.82) * 14.0, 2.0)) * smoothstep(0.1, 0.9, -p.x * 0.6 + p.y - uTurn.x);
  col += vec3(0.12, 0.12, 0.13) * arc * (1.0 + uFlash * 4.0);
  vec2 low = vec2(0.45, -0.52) - uTurn * 0.6;
  col += vec3(0.6, 0.42, 0.28) * exp(-pow(length(p - low), 2.0) * 50.0) * 0.4;

  // The very edge of the dome falls off into the gasket.
  col *= 0.55 + 0.45 * (1.0 - smoothstep(0.86, 1.0, r));
  gl_FragColor = vec4(col, 1.0);
}
`

/**
 * The room behind: warm, dusty dusk with a soft glow behind the head.
 * uFlash is lightning, uEvil turns the glow a dark red.
 */
export const BACKDROP_FRAGMENT = /* glsl */ `
uniform float uFlash, uEvil;
varying vec2 vUv;
void main() {
  vec2 p = (vUv - 0.5) * vec2(40.0, 24.0);
  vec3 col = mix(vec3(0.03, 0.02, 0.012), vec3(0.008, 0.008, 0.012), smoothstep(-6.0, 9.0, p.y));
  vec3 glow = mix(vec3(0.07, 0.042, 0.02), vec3(0.07, 0.008, 0.006), uEvil);
  col += glow * exp(-dot(p, p) * 0.025);
  col *= 1.0 - 0.5 * uEvil;
  col += vec3(0.45, 0.45, 0.55) * uFlash * (0.6 + 0.4 * exp(-dot(p, p) * 0.01));
  gl_FragColor = vec4(col, 1.0);
}
`

/** Dust motes floating in the light. Positions come from seeds and time only. */
export const DUST_VERTEX = /* glsl */ `
uniform float uTime, uScale;
attribute vec4 aSeed;
varying float vAlpha;
void main() {
  float y = mod(aSeed.y * 8.0 + uTime * (0.03 + 0.05 * aSeed.w), 8.0) - 4.0;
  float x = (aSeed.x - 0.5) * 10.0 + sin(uTime * 0.25 + aSeed.w * 30.0) * 0.4;
  vec3 p = vec3(x, y, 1.0 - aSeed.z * 5.0);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = uScale * (1.5 + 3.5 * aSeed.w) * (6.0 / -mv.z);
  vAlpha = (0.3 + 0.7 * aSeed.w) * smoothstep(-4.0, -2.5, y) * smoothstep(4.0, 2.5, y) * (0.6 + 0.4 * sin(uTime * 1.5 + aSeed.x * 40.0));
}
`

export const DUST_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
varying float vAlpha;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  gl_FragColor = vec4(uColor, exp(-dot(c, c) * 18.0) * vAlpha * 0.35);
}
`
