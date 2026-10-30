/**
 * The hand: three bones per point, moved in the vertex shader. Colour, shading and
 * nails come baked with the mesh (scripts/build_haendchen.mjs); the skin's fine
 * lines are one small noise texture. WebGL 1 safe: GLSL ES 1.0, no derivatives.
 */
export const HAND_VERTEX = /* glsl */ `
uniform mat4 uBones[17];
attribute vec4 aColor, aBones, aWeights;
attribute vec2 aDetail;
varying vec3 vRest, vNormal, vTangentX, vTangentY, vView;
varying vec4 vColor;
varying vec2 vDetail;
varying float vNail;

void main() {
  mat4 a = uBones[int(aBones.x + 0.5)];
  mat4 b = uBones[int(aBones.y + 0.5)];
  mat4 c = uBones[int(aBones.z + 0.5)];
  vec3 w = aWeights.xyz / 255.0;
  w /= w.x + w.y + w.z;
  vec4 p = (a * vec4(position, 1.0)) * w.x + (b * vec4(position, 1.0)) * w.y + (c * vec4(position, 1.0)) * w.z;
  vec3 axisX = a[0].xyz * w.x + b[0].xyz * w.y + c[0].xyz * w.z;
  vec3 axisY = a[1].xyz * w.x + b[1].xyz * w.y + c[1].xyz * w.z;
  vec3 axisZ = a[2].xyz * w.x + b[2].xyz * w.y + c[2].xyz * w.z;
  vec3 n = axisX * normal.x + axisY * normal.y + axisZ * normal.z;
  vNormal = normalMatrix * n;
  vTangentX = normalMatrix * axisX;
  vTangentY = normalMatrix * axisY;
  vRest = position;
  vColor = aColor;
  vDetail = aDetail / 255.0;
  vNail = aWeights.w / 255.0;
  vec4 view = modelViewMatrix * p;
  vView = -view.xyz;
  gl_Position = projectionMatrix * view;
}
`

export const HAND_FRAGMENT = /* glsl */ `
uniform sampler2D uLines;
varying vec3 vRest, vNormal, vTangentX, vTangentY, vView;
varying vec4 vColor;
varying vec2 vDetail;
varying float vNail;

void main() {
  float thread = vDetail.y;
  float wrinkle = vDetail.x * (1.0 - thread);
  // Lines run across the fingers, which run along y.
  vec2 uv = vec2(vRest.x * 1.4 + vRest.z * 0.4, vRest.y * 2.6 + vRest.z * 0.21);
  float h = texture2D(uLines, uv).r;
  float hx = texture2D(uLines, uv + vec2(0.006, 0.0)).r;
  float hy = texture2D(uLines, uv + vec2(0.0, 0.006)).r;
  float nail = smoothstep(0.42, 0.58, vNail) * (1.0 - thread);
  float bump = (0.08 + 1.5 * wrinkle) * (1.0 - thread) * (1.0 - nail * 0.85);
  vec3 n = normalize(normalize(vNormal)
    + (normalize(vTangentX) * (h - hx) + normalize(vTangentY) * (h - hy)) * bump);
  vec3 toEye = normalize(vView);

  float crease = smoothstep(0.5, 0.26, h) * (0.02 + 0.5 * wrinkle) * (1.0 - nail);
  vec3 albedo = vColor.rgb * (1.0 - crease * (1.0 - thread));
  // The nail: pale and smooth, with a dark rim where it meets the skin.
  float rim = smoothstep(0.3, 0.5, vNail) * (1.0 - smoothstep(0.5, 0.68, vNail));
  albedo = mix(albedo, vec3(0.66, 0.6, 0.6), nail);
  albedo *= 1.0 - rim * 0.5 * (1.0 - thread);

  // A soft key from the upper left, a violet fill, and light that creeps in at the edges.
  vec3 keyDir = normalize(vec3(-0.45, 0.72, 0.55));
  vec3 fillDir = normalize(vec3(0.7, -0.15, 0.55));
  float key = max(dot(n, keyDir), 0.0);
  float wrap = max((dot(n, keyDir) + 0.45) / 1.45, 0.0);
  float fill = max(dot(n, fillDir), 0.0);
  float ao = vColor.a;
  vec3 light = vec3(1.0, 0.95, 0.92) * (0.62 * key + 0.2 * wrap) + vec3(0.52, 0.5, 0.68) * (0.32 * fill + 0.18);
  vec3 col = albedo * light * (0.35 + 0.65 * ao) * 1.22;
  // Warm where the light dies, like skin.
  col += albedo * vec3(0.16, 0.04, 0.05) * smoothstep(0.0, 0.3, wrap) * (1.0 - smoothstep(0.3, 0.75, wrap)) * ao;
  // Barely any shine: matte, a little more on the nail.
  vec3 halfway = normalize(keyDir + toEye);
  col += vec3(1.0, 0.97, 0.95) * pow(max(dot(n, halfway), 0.0), mix(18.0, 60.0, nail)) * mix(0.07, 0.3, nail) * ao * (1.0 - thread * 0.5);
  float edge = 1.0 - max(dot(n, toEye), 0.0);
  col += vec3(0.3, 0.3, 0.55) * edge * edge * edge * 0.3 * ao;
  gl_FragColor = vec4(col, 1.0);
}
`

export const BACKDROP_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 1.0, 1.0);
}
`

/** Plain dark violet, a little lighter behind the hand. */
export const BACKDROP_FRAGMENT = /* glsl */ `
varying vec2 vUv;
void main() {
  float d = length((vUv - vec2(0.5, 0.56)) * vec2(1.1, 1.0));
  vec3 col = mix(vec3(0.2, 0.19, 0.42), vec3(0.055, 0.05, 0.17), smoothstep(0.0, 0.8, d));
  gl_FragColor = vec4(col, 1.0);
}
`

export const SHADOW_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

export const SHADOW_FRAGMENT = /* glsl */ `
uniform float uStrength;
varying vec2 vUv;
void main() {
  float d = length(vUv - 0.5) * 2.0;
  gl_FragColor = vec4(0.0, 0.0, 0.03, uStrength * (1.0 - smoothstep(0.1, 1.0, d)));
}
`
