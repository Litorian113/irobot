/**
 * C.R.E.E.P.E.R.'s shaders. GLSL ES 1.0 only: they run unchanged on WebGL 1
 * (the 2009/2010 iMacs). The explosion has no simulation: every cube's path
 * is a formula of the time since the blast.
 */

/**
 * One unit cube per pixel of the figure, plus the cubes of the smoke.
 * aKind: 0 body (stays put), 1 head (turns and swells), 2 smoke.
 * uBoom: seconds since the blast, < 0 before it. uReturn: 0 gone .. 1 in place.
 */
export const CUBE_VERTEX = /* glsl */ `
uniform mat3 uTurn;
uniform vec3 uPivot, uCenter;
uniform float uSwell, uBoom, uReturn, uSize;
attribute vec3 aHome, aColor, aVelocity;
attribute vec4 aSeed;
attribute float aKind;
varying vec3 vColor, vNormal;
varying float vFlashes;

vec3 spin(vec3 v, vec3 axis, float a) {
  float c = cos(a), s = sin(a);
  return v * c + cross(axis, v) * s + axis * dot(axis, v) * (1.0 - c);
}

void main() {
  vec3 n = normal;
  vec3 p = position * uSize;
  vec3 at;
  vColor = aColor;
  vFlashes = 1.0;

  if (aKind > 1.5) {
    // Smoke: puffs out fast, slows, rises, grows and shrinks away. Grey as it ages.
    float life = uBoom < 0.0 ? 2.0 : uBoom / (0.8 + aSeed.w * 1.2);
    if (life >= 1.0) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      return;
    }
    at = aHome + aVelocity * (1.0 - exp(-life * 3.0)) + vec3(0.0, 0.5 * life, 0.0);
    p *= (0.7 + 1.5 * aSeed.x) * sin(min(life * 1.3 + 0.12, 1.0) * 3.14159);
    p = spin(p, normalize(aSeed.xyz - 0.5), aSeed.y * 6.0 + life * 2.0);
    n = spin(n, normalize(aSeed.xyz - 0.5), aSeed.y * 6.0 + life * 2.0);
    vColor = mix(vec3(0.98), vec3(0.45), life * (0.6 + 0.4 * aSeed.z));
    vFlashes = 0.0;
  } else {
    bool head = aKind > 0.5;
    at = head ? uPivot + uTurn * (aHome - uPivot) : aHome;
    if (head) {
      at = uCenter + (at - uCenter) * uSwell;
      p = uTurn * p * uSwell;
      n = uTurn * n;
    }
    if (uBoom >= 0.0) {
      // Thrown out, falling, tumbling.
      at += aVelocity * uBoom + vec3(0.0, -6.5 * uBoom * uBoom, 0.0);
      vec3 axis = normalize(aSeed.xyz - 0.5);
      float a = (2.0 + aSeed.w * 9.0) * uBoom;
      p = spin(p, axis, a);
      n = spin(n, axis, a);
    }
    if (uReturn < 1.0) {
      // Flying back in from below, body first, each cube on its own beat.
      float start = (head ? 0.35 : 0.0) + aSeed.w * 0.25;
      float e = clamp((uReturn - start) / (1.0 - start - 0.05), 0.0, 1.0);
      e = 1.0 - (1.0 - e) * (1.0 - e) * (1.0 - e);
      at.y -= 7.0 * (1.0 - e);
      p *= smoothstep(0.0, 0.25, e);
    }
  }
  vNormal = n;
  gl_Position = projectionMatrix * viewMatrix * vec4(at + p, 1.0);
}
`

/** Blocky three-tone light, as in the game. uFlash blinks the figure white. */
export const CUBE_FRAGMENT = /* glsl */ `
uniform float uFlash;
varying vec3 vColor, vNormal;
varying float vFlashes;
void main() {
  vec3 n = normalize(vNormal);
  float light = 0.62 + 0.38 * max(dot(n, normalize(vec3(-0.35, 0.8, 0.5))), 0.0);
  vec3 col = vColor * light;
  gl_FragColor = vec4(mix(col, vec3(1.0), uFlash * vFlashes), 1.0);
}
`

export const SKY_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

/** A plain sky; the blast whites it out. */
export const SKY_FRAGMENT = /* glsl */ `
uniform float uFlash;
varying vec2 vUv;
void main() {
  vec3 col = mix(vec3(0.72, 0.84, 0.98), vec3(0.47, 0.66, 0.96), smoothstep(0.2, 0.85, vUv.y));
  gl_FragColor = vec4(mix(col, vec3(1.0), uFlash), 1.0);
}
`
