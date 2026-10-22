/**
 * F.L.U.X.'s shaders. GLSL ES 1.0 only: they run unchanged on WebGL 1
 * (the 2009/2010 iMacs), so no derivatives. The scene renders without
 * post-processing, so each one applies tone mapping and colour space itself.
 */

export const PASS_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

/**
 * The gel: many lumps in one geometry. Each drifts inside the box, tumbles
 * and wobbles, and lags behind when the head turns (uSpin, box-local).
 * Kind 1 are drops that leave the box, shrink and start again.
 */
export const GEL_VERTEX = /* glsl */ `
uniform float uTime, uChurn;
uniform vec3 uSpin, uHalf;
attribute vec3 aCenter;
attribute vec4 aSeed;
attribute float aKind;
varying vec3 vNormal, vWorld;
varying float vSeed;

mat3 tumble(float a, float b) {
  float ca = cos(a), sa = sin(a), cb = cos(b), sb = sin(b);
  return mat3(ca, 0.0, -sa, 0.0, 1.0, 0.0, sa, 0.0, ca) * mat3(1.0, 0.0, 0.0, 0.0, cb, sb, 0.0, -sb, cb);
}

void main() {
  float t = uTime * uChurn;
  vec4 s = aSeed;
  vec3 c = aCenter;
  float scale = 1.0;
  if (aKind < 0.5) {
    c += vec3(sin(t * (0.21 + 0.2 * s.x) + s.y * 6.3) * 0.09,
              sin(t * (0.33 + 0.2 * s.z) + s.w * 6.3) * 0.04,
              sin(t * (0.17 + 0.15 * s.w) + s.x * 6.3) * 0.16);
    // A container that turns leaves its contents behind for a moment.
    c += cross(uSpin, c);
    c = clamp(c, -uHalf, uHalf);
  } else {
    // A drop: out through the wall it starts on, slowly, shrinking away.
    float life = fract(uTime * (0.05 + 0.05 * s.x) + s.y);
    vec3 away = normalize(aCenter / uHalf + (s.xyz - 0.5) * 0.8);
    c += away * life * 0.45 + vec3(0.0, sin(life * 3.0 + s.z * 6.3) * 0.03, 0.0);
    scale = sin(min(life * 5.0, 1.0) * 1.5708) * (1.0 - life);
  }
  mat3 r = tumble(t * (0.3 + 0.4 * s.z) + s.x * 6.3, t * (0.2 + 0.3 * s.w) + s.y * 6.3);
  // Jelly: a slow wobble through the lump.
  float wobble = 1.0 + 0.13 * sin(dot(normalize(position), vec3(3.0, 4.0, 5.0)) + uTime * (1.3 + s.w) * uChurn);
  vec3 p = c + r * (position * wobble * scale);
  vec4 world = modelMatrix * vec4(p, 1.0);
  vWorld = world.xyz;
  vNormal = normalize(mat3(modelMatrix) * (r * normal));
  vSeed = s.z;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`

/**
 * Translucent red gel lit from the key light: deep red where it is thick,
 * pink and coral at the edges, glossy highlights. uBack draws the far side.
 */
export const GEL_FRAGMENT = /* glsl */ `
uniform float uBack, uGlow;
uniform vec3 uKey;
varying vec3 vNormal, vWorld;
varying float vSeed;
void main() {
  vec3 n = normalize(vNormal);
  vec3 v = normalize(cameraPosition - vWorld);
  if (uBack > 0.5) n = -n;
  float facing = abs(dot(n, v));
  float rim = pow(1.0 - facing, 2.0);
  float lit = 0.5 + 0.5 * dot(n, uKey);

  vec3 deep = mix(vec3(0.3, 0.0, 0.02), vec3(0.42, 0.0, 0.07), vSeed);
  vec3 pink = mix(vec3(0.95, 0.1, 0.16), vec3(1.0, 0.24, 0.14), vSeed);
  vec3 col = mix(deep, pink, lit * 0.6 + rim * 0.45) * (0.75 + 0.45 * uGlow);
  // Light gathers inside the gel and leaves it towards the viewer.
  col += vec3(1.0, 0.25, 0.12) * pow(facing, 3.0) * 0.15 * uGlow;
  float spec = pow(max(dot(reflect(-uKey, n), v), 0.0), 60.0);
  float alpha = uBack > 0.5 ? 0.45 : 0.55 + 0.35 * rim;
  if (uBack < 0.5) col += vec3(1.0, 0.92, 0.95) * spec * 1.6;

  gl_FragColor = vec4(col, alpha + spec * 0.3);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`

/** Grey-lilac haze behind him, lighter above. */
export const BACKDROP_FRAGMENT = /* glsl */ `
varying vec2 vUv;
void main() {
  vec2 p = (vUv - 0.5) * vec2(40.0, 24.0);
  float light = 0.36 + 0.012 * p.y + 0.1 * exp(-dot(p, p) * 0.015);
  gl_FragColor = vec4(vec3(1.0, 0.97, 1.02) * light, 1.0);
  #include <colorspace_fragment>
}
`
