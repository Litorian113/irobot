/**
 * V.I.L.L.A.G.E.R.'s shaders. GLSL ES 1.0 only: they run unchanged on WebGL 1
 * (the 2009/2010 iMacs). The sparkles have no simulation: each one's place is
 * a formula of the time.
 */

/**
 * One unit cube per pixel of the figure, plus the sparkles.
 * aKind: 0 robe (stays put), 1 head (turns), 2 folded arms (tilted forward), 3 sparkle.
 */
export const CUBE_VERTEX = /* glsl */ `
uniform mat3 uTurn, uArms;
uniform vec3 uPivot, uArmPivot, uSparkleAt;
uniform float uSize, uTime, uSparkle;
attribute vec3 aHome, aColor;
attribute vec4 aSeed;
attribute float aKind;
varying vec3 vColor, vNormal;
varying float vGlow;

void main() {
  vec3 p = position * uSize;
  vec3 n = normal;
  vec3 at = aHome;
  vColor = aColor;
  vGlow = 0.0;
  if (aKind > 2.5) {
    // A green twinkle: pops up somewhere round the head, drifts up, shrinks away, comes back elsewhere.
    float t = uTime / (1.1 + aSeed.w * 0.7) + aSeed.x * 7.0;
    float life = fract(t);
    float round_ = floor(t);
    vec3 r = fract(sin(vec3(round_ * 12.9898 + aSeed.y * 78.233, round_ * 39.346 + aSeed.z * 11.135, round_ * 7.719 + aSeed.x * 3.371)) * 43758.5453);
    at = uSparkleAt + (r - 0.5) * vec3(2.3, 1.9, 1.2) + vec3(0.0, life * 0.3, 0.35);
    p *= uSparkle * sin(life * 3.14159) * (0.6 + 0.6 * aSeed.y);
    // Turned onto its corner: a diamond, as in the game.
    p.xy = mat2(0.7071, 0.7071, -0.7071, 0.7071) * p.xy;
    vGlow = 1.0;
  } else if (aKind > 1.5) {
    at = uArmPivot + uArms * (aHome - uArmPivot);
    p = uArms * p;
    n = uArms * n;
  } else if (aKind > 0.5) {
    at = uPivot + uTurn * (aHome - uPivot);
    p = uTurn * p;
    n = uTurn * n;
  }
  vNormal = n;
  gl_Position = projectionMatrix * viewMatrix * vec4(at + p, 1.0);
}
`

/** Flat light as in the game: the front nearly as authored, the top bright, the sides a step darker. Sparkles glow on their own. */
export const CUBE_FRAGMENT = /* glsl */ `
varying vec3 vColor, vNormal;
varying float vGlow;
void main() {
  vec3 n = normalize(vNormal);
  float light = clamp(0.74 + 0.25 * max(n.z, 0.0) + 0.26 * max(n.y, 0.0) - 0.06 * n.x, 0.0, 1.0);
  gl_FragColor = vec4(vColor * mix(light, 1.0, vGlow), 1.0);
}
`

export const SKY_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

/** Morning over the village: a pale sky, a strip of distant green hills low down. */
export const SKY_FRAGMENT = /* glsl */ `
varying vec2 vUv;
void main() {
  vec3 col = mix(vec3(0.8, 0.88, 0.98), vec3(0.5, 0.68, 0.96), smoothstep(0.3, 0.9, vUv.y));
  // Hills in steps, the way the game builds them.
  float x = floor(vUv.x * 64.0) / 64.0;
  float hill = 0.3 + 0.035 * sin(x * 23.0) + 0.02 * sin(x * 61.0 + 1.3);
  hill = floor(hill * 90.0) / 90.0;
  col = mix(col, vec3(0.42, 0.6, 0.38), step(vUv.y, hill));
  gl_FragColor = vec4(col, 1.0);
}
`
