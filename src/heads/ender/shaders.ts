/**
 * E.N.D.E.R.'s shaders. GLSL ES 1.0 only: they run unchanged on WebGL 1 (the 2009/2010 iMacs).
 * Everything moves by formula: the drifting particles from the time, the teleport from uPort.
 */

/**
 * One unit cube per pixel of the figure, plus small cubes of purple dust.
 * aKind: 0 body, 1 head, 2 the top of the head (lifts when it gets angry), 3 dust.
 * aColor.a: 1 for the eyes, which glow. uPort: 0 in place .. 1 scattered into dust.
 */
export const ENDER_VERTEX = /* glsl */ `
uniform mat3 uTurn;
uniform vec3 uPivot, uOffset;
uniform float uSize, uJaw, uPort, uTime, uStare;
attribute vec4 aColor, aSeed;
attribute vec3 aHome;
attribute float aKind;
varying vec3 vColor, vNormal;
varying float vGlow;

const vec3 PURPLE = vec3(0.78, 0.25, 1.0);

void main() {
  vec3 n = normal;
  vec3 p = position * uSize;
  vec3 at;
  vColor = aColor.rgb;
  vGlow = aColor.a;

  if (aKind > 2.5) {
    // Dust: drifting round the figure, each its own slow orbit; thicker while it teleports.
    float angle = aSeed.y * 6.2831 + uTime * (0.15 + 0.35 * aSeed.z) * (aSeed.x > 0.5 ? 1.0 : -1.0);
    float radius = 0.7 + aSeed.z * 1.1 + uPort * 0.8 * aSeed.w;
    float rise = fract(aSeed.w + uTime * (0.03 + 0.05 * aSeed.x));
    at = uOffset + vec3(cos(angle) * radius, -1.5 + rise * 3.2, sin(angle) * radius * 0.45 + 0.3);
    float life = sin(rise * 3.14159);
    p *= (0.22 + 0.25 * aSeed.x) * life * (1.0 + uPort * 0.8);
    vGlow = 1.0;
  } else {
    at = aHome;
    // Angry: the top of the head lifts away, as in the game.
    if (aKind > 1.5) at.y += uJaw * uSize * 1.4;
    if (aKind > 0.5) {
      at = uPivot + uTurn * (at - uPivot);
      p = uTurn * p;
      n = uTurn * n;
    }
    // Teleport: every cube flies apart into purple dust, a beat after the one before.
    float k = smoothstep(aSeed.w * 0.45, aSeed.w * 0.45 + 0.55, uPort);
    at += normalize(aSeed.xyz - 0.5) * k * (0.8 + aSeed.w);
    p *= 1.0 - k;
    vColor = mix(vColor, PURPLE, k);
    vGlow = max(vGlow, k);
    at += uOffset;
    // Staring eyes burn brighter.
    if (aColor.a > 0.5) vColor *= 1.0 + 0.6 * uStare;
  }
  vNormal = n;
  gl_Position = projectionMatrix * viewMatrix * vec4(at + p, 1.0);
}
`

/** Blocky light from the top left, a little purple from the eyes' side; eyes and dust glow. */
export const ENDER_FRAGMENT = /* glsl */ `
varying vec3 vColor, vNormal;
varying float vGlow;
void main() {
  vec3 n = normalize(vNormal);
  float light = 0.6 + 0.4 * max(dot(n, normalize(vec3(-0.4, 0.75, 0.55))), 0.0);
  vec3 col = vColor * light;
  // A faint purple on the sides, so the black head stands off the black background.
  col += vec3(0.11, 0.035, 0.16) * (1.0 - abs(n.z)) * (1.0 - abs(n.y));
  gl_FragColor = vec4(mix(col, vColor, vGlow), 1.0);
}
`
