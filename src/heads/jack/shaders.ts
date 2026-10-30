/**
 * J.A.C.K.'s shaders. GLSL ES 1.0 only: they run unchanged on WebGL 1
 * (the 2009/2010 iMacs), so no derivatives, no texelFetch, no float textures.
 */

export const PUMPKIN_VERTEX = /* glsl */ `
uniform vec3 uShape;
attribute float aLobe;
varying vec3 vDir, vPos, vNormal;
varying float vLobe;
void main() {
  // The direction on the unit sphere the pumpkin was grown from: the ribs only change the radius.
  vDir = normalize(position / uShape);
  vPos = position;
  vNormal = mat3(modelMatrix) * normal;
  vLobe = aLobe;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

/**
 * The skin is painted; the carving is an illusion with depth. The mask holds
 * the face for each expression (red neutral, green curious, blue happy),
 * blurred, so that blending the channels morphs one cut into the next. Inside
 * a hole the ray walks on through the shell: if it hits solid mask again it
 * sees the cut wall, otherwise the candle-lit inside. A wide mip of the mask
 * is the glow that shines through the flesh around the holes.
 */
export const PUMPKIN_FRAGMENT = /* glsl */ `
uniform sampler2D uMask;
uniform vec3 uWeights, uCamera, uKey;
uniform float uBlink, uFlame, uLid, uTime, uRange, uThickness;
varying vec3 vDir, vPos, vNormal;
varying float vLobe;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + 1.0), f.x), f.y);
}

float cut(vec2 f, float bias) {
  // A blink squeezes only the eyes shut, around their middle.
  if (abs(f.x - 0.5) > 0.045 && f.y > 0.53) {
    float eye = 0.63;
    f.y = eye + (f.y - eye) / max(1.0 - uBlink * 0.97, 0.03);
  }
  return dot(texture2D(uMask, f, bias).rgb, uWeights);
}

void main() {
  vec3 d = normalize(vDir);
  float phi = atan(d.x, d.z), lat = asin(clamp(d.y, -1.0, 1.0));
  vec2 f = vec2(phi, lat) / uRange * 0.5 + 0.5;
  vec3 n = normalize(vNormal);

  // --- the skin ---
  float streak = noise(vec2(phi * 38.0, lat * 2.5)) * 0.6 + noise(vec2(phi * 90.0, lat * 7.0)) * 0.4;
  float lobe = vLobe * vLobe;
  vec3 skin = mix(vec3(0.42, 0.13, 0.02), vec3(0.9, 0.42, 0.07), lobe);
  skin *= 0.9 + 0.18 * streak;
  float light = max(dot(n, uKey) * 0.65 + 0.35, 0.0);
  // The hat's shadow over the crown.
  float crown = smoothstep(0.5, 0.86, d.y);
  vec3 col = skin * (0.22 + 0.62 * light) * mix(1.0, 0.5, crown);
  vec3 toCam = normalize(uCamera - vPos);
  vec3 half_ = normalize(uKey + vec3(0.0, 0.0, 1.0));
  col += vec3(0.7, 0.8, 0.9) * pow(max(dot(n, half_), 0.0), 40.0) * 0.12 * vLobe;

  // Candlelight through the flesh: strongest around the cuts and in the thin grooves.
  float near = cut(f, 4.5);
  float wide = cut(f, 6.5);
  float glow = uFlame * (0.16 + 0.55 * near + 0.5 * wide + 0.2 * (1.0 - vLobe));
  col += vec3(1.0, 0.36, 0.05) * glow * (0.35 + 0.65 * skin.r);
  // When the hat lifts: the opening on top.
  col += vec3(1.0, 0.62, 0.18) * uLid * uFlame * smoothstep(0.9, 0.985, d.y) * 1.6;

  // --- the carving ---
  float m = cut(f, 0.0);
  float hole = smoothstep(0.46, 0.54, m);
  if (hole > 0.0) {
    // Walk the view ray through the shell, in the mask's coordinates.
    vec3 into = -toCam;
    vec3 e1 = vec3(cos(phi), 0.0, -sin(phi));
    vec3 e2 = vec3(-sin(phi) * d.y, cos(lat), -cos(phi) * d.y);
    float slant = max(dot(toCam, d), 0.3);
    vec2 step_ = vec2(dot(into, e1) / max(cos(lat), 0.25), dot(into, e2)) / slant * uThickness / uRange * 0.5;
    float wall = 2.0;
    if (cut(f + step_ * 0.34, 0.0) < 0.5) wall = 0.34;
    else if (cut(f + step_ * 0.67, 0.0) < 0.5) wall = 0.67;
    else if (cut(f + step_, 0.0) < 0.5) wall = 1.0;
    vec3 inside;
    if (wall < 1.5) {
      // The cut flesh: pale and lit from behind, brighter towards the candle.
      inside = mix(vec3(0.8, 0.33, 0.04), vec3(1.0, 0.62, 0.14), wall);
    } else {
      // The hollow: the flame low in the middle, seen with parallax.
      vec2 q = (f + step_ * 2.2 - vec2(0.5, 0.42)) * vec2(1.3, 1.6);
      float flame = exp(-dot(q, q) * 14.0);
      inside = mix(vec3(1.0, 0.72, 0.2), vec3(1.0, 0.98, 0.72), flame);
    }
    inside *= 0.16 + 0.9 * uFlame;
    col = mix(col, inside, hole);
  }
  gl_FragColor = vec4(col, 1.0);
}
`

/**
 * The evening behind him: cold fog, pale high up, a warm smear of last light
 * on the right, and the out-of-focus branches of a bare tree.
 */
