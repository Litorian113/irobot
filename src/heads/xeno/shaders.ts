/**
 * X.E.N.O.'s shaders. GLSL ES 1.0 only: they run unchanged on WebGL 1 (the 2009/2010 iMacs).
 * The whole look is reflection: a black, wet surface in a white studio.
 */

/** Neck, jaw and inner jaw all move in here, by the weights in aRig. */
export const XENO_VERTEX = /* glsl */ `
attribute vec4 aPaint, aRig;
uniform vec2 uTurn;
uniform float uJaw;
uniform vec3 uInner, uHinge, uPivot;
varying vec3 vWorld, vNormal, vLocal;
varying vec3 vPaint;

mat3 aboutX(float a) {
  float c = cos(a), s = sin(a);
  return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c);
}

void main() {
  vLocal = position;
  vPaint = aPaint.xyz;
  vec3 p = position + uInner * aRig.z;
  mat3 jaw = aboutX(uJaw * aRig.y);
  p = uHinge + jaw * (p - uHinge);
  // The head's Euler 'YXZ' (yaw, -pitch), scaled by how much of it this point follows.
  float y = uTurn.x * aRig.x, x = -uTurn.y * aRig.x;
  float cy = cos(y), sy = sin(y);
  mat3 bend = mat3(cy, 0.0, -sy, 0.0, 1.0, 0.0, sy, 0.0, cy) * aboutX(x);
  p = uPivot + bend * (p - uPivot);
  vec4 world = modelMatrix * vec4(p, 1.0);
  vWorld = world.xyz;
  vNormal = mat3(modelMatrix) * bend * jaw * normal;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`

export const XENO_FRAGMENT = /* glsl */ `
uniform float uFlash;
varying vec3 vWorld, vNormal, vLocal;
varying vec3 vPaint;

// The studio as the head sees it: a white room behind and beside it, black flags around the
// camera. The shell, being glass, also sees a large window high on the right and a strip low on the left.
float room(vec3 r, float soft) {
  return mix(1.0, 0.012, smoothstep(-0.25 - soft, 0.42 + soft, r.z)) * mix(0.32, 1.0, smoothstep(-0.7, 0.3, r.y));
}
float lamps(vec3 r) {
  if (r.z < 0.02) return 0.0;
  vec2 s = r.xy / r.z;
  return 15.0 * smoothstep(0.62, 0.5, abs(s.x - 0.75)) * smoothstep(0.4, 0.3, abs(s.y - 1.1))
    + 3.5 * smoothstep(0.2, 0.12, abs(s.x + 1.3)) * smoothstep(1.0, 0.7, abs(s.y - 0.1))
    // Small lamps further down: the little sparks low on the shell.
    + 9.0 * smoothstep(0.1, 0.06, length(s - vec2(1.25, 0.28)))
    + 7.0 * smoothstep(0.07, 0.04, length(s - vec2(0.72, 0.3)))
    + 6.0 * smoothstep(0.06, 0.03, length(s - vec2(0.2, 0.42)));
}

void main() {
  vec3 n = normalize(vNormal);
  vec3 v = normalize(cameraPosition - vWorld);
  vec3 r = reflect(-v, n);
  float facing = max(dot(n, v), 0.0);
  float ao = vPaint.x, wear = vPaint.y, kind = vPaint.z;
  float sky = 0.5 + 0.5 * n.y;
  float key = max(dot(n, normalize(vec3(0.45, 0.65, 0.6))), 0.0);
  vec3 colour;

  if (kind > 0.75) {
    // A tooth: wet bone, darker at the gum.
    float albedo = mix(0.2, 0.72, wear);
    float gloss = pow(max(dot(r, normalize(vec3(0.5, 0.65, 0.58))), 0.0), 40.0);
    colour = vec3(albedo) * (0.3 + 0.25 * sky + 0.7 * key) * (0.04 + 0.96 * ao * ao) + vec3(1.6) * gloss * ao;
    colour += vec3(0.06 + 0.5 * pow(1.0 - facing, 3.0)) * room(r, 0.3) * ao * 0.5;
  } else if (kind > 0.25) {
    // The shell: black glass that goes grey and matt towards the back of the skull.
    float fresnel = 0.05 + 0.95 * pow(1.0 - facing, 4.0);
    vec3 base = vec3(0.012 + wear * 0.28) * (0.35 + 0.65 * sky + 0.4 * key);
    colour = base + fresnel * (room(r, 0.0) + lamps(r)) * mix(1.0, 0.7, wear);
  } else {
    // The machinery: wet black rubber, only its highest edges rubbed to pale metal.
    float rubbed = smoothstep(0.72, 1.0, wear) * 0.75;
    float fresnel = mix(0.16, 0.5, rubbed) + 0.75 * pow(1.0 - facing, 3.0);
    vec3 base = vec3(mix(0.012, 0.3, rubbed)) * (0.28 + 0.4 * sky + 0.9 * key);
    vec3 toKey = normalize(vec3(0.5, 0.65, 0.58));
    float highlight = max(dot(r, toKey), 0.0);
    float gloss = pow(highlight, 110.0) * 3.2 + pow(highlight, 18.0) * 0.28;
    // A second, lower light, so the undersides of the hoses shine too.
    gloss += pow(max(dot(r, normalize(vec3(-0.35, -0.25, 0.9))), 0.0), 70.0) * 0.9;
    float ambient = mix(0.015, 1.0, ao * ao);
    colour = (base + fresnel * room(r, 0.18)) * ambient + vec3(gloss) * ambient;
  }

  gl_FragColor = vec4(colour + vec3(uFlash), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`

export const BACKDROP_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 1.0, 1.0);
}
`

/** The studio wall: paper white, a breath darker in the corners. */
export const BACKDROP_FRAGMENT = /* glsl */ `
uniform float uFlash;
varying vec2 vUv;
void main() {
  vec2 p = vUv - 0.5;
  float grey = 0.97 - 0.2 * dot(p, p);
  gl_FragColor = vec4(vec3(grey + uFlash), 1.0);
  #include <colorspace_fragment>
}
`
