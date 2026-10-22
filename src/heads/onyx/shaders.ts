/**
 * O.N.Y.X.'s shaders. GLSL ES 1.0 only: they run unchanged on WebGL 1
 * (the 2009/2010 iMacs), so no derivatives and no textures of their own.
 * The scene renders without post-processing, so each one applies the
 * renderer's tone mapping and output colour space itself.
 */

export const PASS_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

export const SHELL_VERTEX = /* glsl */ `
varying vec3 vWorld, vNormal, vLocal;
void main() {
  vLocal = position; // head units: x to screen-right, y up, z out of the face
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  vNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * world;
}
`

/**
 * The helmet: glossy black plastic reflecting an analytic studio, so its
 * highlights slide over it as it turns. Behind the visor: the pixel mark
 * (two squares touching at a corner), two camera lenses and a status arc; on its
 * right side a small display with the number and the battery.
 */
export const SHELL_FRAGMENT = /* glsl */ `
uniform float uTime, uBlink, uStatus, uBattery;
uniform vec2 uLook;
varying vec3 vWorld, vNormal, vLocal;

/** Side of one square of the mark. */
const float SQUARE = 0.12;
const vec2 MARK = vec2(0.0, 0.03);
const vec2 CAM_TOP = vec2(0.0, 0.37);
const vec2 CAM_LOW = vec2(0.0, -0.53);
/** The side display, in (z, y) on the head's -x side. */
const vec2 DISPLAY = vec2(-0.16, 0.38);
const float DOT = 0.016;

float box(vec2 q, vec2 b, float r) {
  vec2 d = abs(q) - b + r;
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - r;
}

// The studio as the shell sees it: grey room and darker floor, a big softbox
// overhead, a strip light on each side, black flags behind the camera.
vec3 studio(vec3 r) {
  float room = (0.32 + 0.2 * r.y) * mix(1.0, 0.04, smoothstep(0.05, 0.75, r.z));
  vec2 s = r.xz / max(r.y, 0.001);
  float top = smoothstep(1.1, 0.55, abs(s.x)) * smoothstep(0.9, 0.4, abs(s.y + 0.1)) * step(0.0, r.y);
  vec2 l = r.yz / max(-r.x, 0.001);
  float left = smoothstep(1.2, 0.7, abs(l.x - 0.15)) * smoothstep(0.32, 0.12, abs(l.y + 0.05)) * step(0.0, -r.x);
  vec2 rr = r.yz / max(r.x, 0.001);
  float right = smoothstep(1.0, 0.6, abs(rr.x - 0.2)) * smoothstep(0.3, 0.1, abs(rr.y + 0.45)) * step(0.0, r.x);
  return vec3(room) + vec3(16.0) * top + vec3(7.0) * left + vec3(0.92, 0.95, 1.0) * 4.0 * right;
}

// One 3 x 5 glyph of the display font, p in dots from its top-left corner.
float glyph(vec2 p, float bits) {
  if (p.x < 0.0 || p.y < 0.0 || p.x >= 3.0 || p.y >= 5.0) return 0.0;
  vec2 c = floor(p);
  float on = mod(floor((bits + 0.5) / pow(2.0, (2.0 - c.x) + 3.0 * (4.0 - c.y))), 2.0);
  vec2 f = abs(fract(p) - 0.5);
  return on * smoothstep(0.45, 0.32, max(f.x, f.y));
}

void main() {
  vec3 n = normalize(vNormal);
  vec3 v = normalize(cameraPosition - vWorld);
  vec3 r = reflect(-v, n);
  float fresnel = 0.04 + 0.96 * pow(1.0 - max(dot(n, v), 0.0), 5.0);

  vec3 base = vec3(0.004) + vec3(0.01) * max(dot(n, normalize(vec3(-0.4, 0.8, 0.5))), 0.0);
  vec3 glow = vec3(0.0);

  if (vLocal.z > 0.25) {
    // The mark: two squares behind the glass, upper left and lower right, squashed by a blink.
    vec2 q = vLocal.xy - MARK - uLook;
    q.y /= max(0.06, 1.0 - uBlink);
    vec2 c = vec2(-0.5, 0.5) * SQUARE;
    float d = min(box(q - c, vec2(SQUARE * 0.5), 0.004), box(q + c, vec2(SQUARE * 0.5), 0.004));
    float core = smoothstep(0.003, -0.003, d);
    float halo = exp(-max(d, 0.0) * 55.0);
    glow += vec3(0.93, 0.96, 1.0) * (core * 3.2 + halo * 0.06);

    // Camera lenses: a grey ring catching the light, darker glass, a glint.
    for (int i = 0; i < 2; i++) {
      vec2 p = vLocal.xy - (i == 0 ? CAM_TOP : CAM_LOW);
      float d = length(p);
      float ring = smoothstep(0.05, 0.045, d) * smoothstep(0.034, 0.04, d);
      base = mix(base, vec3(0.035), ring);
      base *= 1.0 - 0.7 * smoothstep(0.036, 0.03, d);
      vec2 g = p - vec2(-0.011, 0.012);
      glow += vec3(0.5, 0.6, 0.8) * exp(-dot(g, g) * 30000.0) * 0.35;
    }
    // The status arc under the upper lens: dim, bright when someone is seen.
    vec2 a = vLocal.xy - CAM_TOP;
    float arc = abs(length(a) - 0.068) - 0.005;
    float lower = smoothstep(-0.03, -0.05, a.y);
    glow += vec3(1.0, 0.97, 0.92) * smoothstep(0.003, -0.003, arc) * lower * (0.25 + 2.4 * uStatus);
  }

  if (vLocal.x < -0.3) {
    // Side display: "005" and a battery, in dots.
    vec2 p = (vec2(vLocal.z, -vLocal.y) - vec2(DISPLAY.x, -DISPLAY.y)) / DOT;
    float text = glyph(p, 31599.0) + glyph(p - vec2(4.0, 0.0), 31599.0) + glyph(p - vec2(8.0, 0.0), 31183.0);
    vec2 b = p - vec2(2.2, 7.6);
    float shell = abs(box(b, vec2(2.2, 0.8), 0.25)) - 0.12;
    float nub = box(b - vec2(2.65, 0.0), vec2(0.18, 0.35), 0.05);
    float fill = box(b - vec2(-1.85 + 1.85 * uBattery, 0.0), vec2(1.85 * uBattery, 0.5), 0.1);
    float battery = smoothstep(0.1, -0.1, min(min(shell, nub), fill));
    glow += vec3(0.92, 0.95, 1.0) * (text * 1.6 + battery * 1.1);
  }

  gl_FragColor = vec4(base + glow + fresnel * studio(r), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`

/** The light in the seam: brighter towards the jaw, a pulse runs down it. */
export const SEAM_FRAGMENT = /* glsl */ `
uniform float uPulse, uLevel;
varying vec2 vUv;
void main() {
  float s = vUv.x;
  float ends = smoothstep(0.0, 0.08, s) * smoothstep(1.0, 0.96, s);
  float pulse = exp(-pow((s - uPulse) * 7.0, 2.0)) * 2.5;
  float light = (mix(0.35, 1.6, s * s) * uLevel + pulse) * ends;
  gl_FragColor = vec4(vec3(0.9, 0.94, 1.0) * light, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`

/** The studio wall: light grey, brightest behind the head. */
export const BACKDROP_FRAGMENT = /* glsl */ `
varying vec2 vUv;
void main() {
  vec2 p = (vUv - 0.5) * vec2(40.0, 24.0);
  float grey = 0.5 + 0.17 * exp(-dot(p, p) * 0.018) - 0.006 * p.y;
  gl_FragColor = vec4(vec3(grey), 1.0);
  #include <colorspace_fragment>
}
`
