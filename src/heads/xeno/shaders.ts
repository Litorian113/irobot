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
// camera, a large window high on the right and a strip low on the left.
vec3 studio(vec3 r) {
  float room = mix(1.0, 0.012, smoothstep(-0.25, 0.42, r.z));
  room *= mix(0.32, 1.0, smoothstep(-0.7, 0.3, r.y));
  float light = 0.0;
  if (r.z > 0.02) {
    vec2 s = r.xy / r.z;
    light += 15.0 * smoothstep(0.62, 0.5, abs(s.x - 0.75)) * smoothstep(0.4, 0.3, abs(s.y - 1.1));
    light += 3.5 * smoothstep(0.2, 0.12, abs(s.x + 1.3)) * smoothstep(1.0, 0.7, abs(s.y - 0.1));
  }
  // A black beam across the window, as in the reflections of the photo.
  return vec3(room + light);
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
    float albedo = mix(0.32, 0.86, wear);
    float gloss = pow(max(dot(r, normalize(vec3(0.5, 0.65, 0.58))), 0.0), 40.0);
    colour = vec3(albedo) * (0.34 + 0.25 * sky + 0.75 * key) * (0.08 + 0.92 * ao) + vec3(1.6) * gloss * ao;
    colour += vec3(0.06 + 0.5 * pow(1.0 - facing, 3.0)) * studio(r) * ao * 0.5;
  } else if (kind > 0.25) {
    // The shell: black glass that goes grey and matt towards the back of the skull.
    float fresnel = 0.05 + 0.95 * pow(1.0 - facing, 4.0);
    vec3 base = vec3(0.012 + wear * 0.28) * (0.35 + 0.65 * sky + 0.4 * key);
    colour = base + fresnel * studio(r) * mix(1.0, 0.7, wear);
  } else {
    // The machinery: wet black rubber, its raised edges rubbed to pale metal.
    float rubbed = smoothstep(0.52, 0.85, wear);
    float fresnel = mix(0.1, 0.34, rubbed) + 0.62 * pow(1.0 - facing, 3.0);
    vec3 base = vec3(mix(0.012, 0.2, rubbed)) * (0.32 + 0.45 * sky + 0.85 * key);
    float gloss = pow(max(dot(r, normalize(vec3(0.5, 0.65, 0.58))), 0.0), 90.0);
    float ambient = ao * ao;
    colour = (base + fresnel * studio(r) * mix(0.2, 1.0, ao)) * ambient + vec3(3.2) * gloss * ao;
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
