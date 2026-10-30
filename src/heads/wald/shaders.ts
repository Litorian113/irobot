/**
 * W.A.L.D.'s shaders. GLSL ES 1.0 only: they run unchanged on WebGL 1
 * (the 2009/2010 iMacs), so no derivatives, no texelFetch, no float textures.
 */

const NOISE = /* glsl */ `
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + 1.0), f.x), f.y);
}
`

export const PASS_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

export const BONE_VERTEX = /* glsl */ `
attribute vec2 aPaint;
varying vec3 vNormal;
varying vec2 vPlan, vPaint;
void main() {
  vNormal = mat3(modelMatrix) * normal;
  vPlan = uv;
  vPaint = aPaint;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

/**
 * Old bone. The eye sockets and the nasal opening are real holes in the front
 * of the skull: behind them only the black inside. aPaint: x marks the front
 * (where the holes are), y the dirt in the hollows.
 */
export const BONE_FRAGMENT = /* glsl */ `
uniform sampler2D uDetail;
uniform vec3 uKey;
varying vec3 vNormal;
varying vec2 vPlan, vPaint;

float socket(vec2 p) {
  // Slanted almonds, high and to the side: a stag's, looking down at you.
  vec2 q = vec2(abs(p.x) - 0.225, p.y - 0.165);
  q = vec2(q.x * 0.8 - q.y * 0.6, q.y * 0.8 + q.x * 0.6);
  return length(q / vec2(0.058, 0.098)) - 1.0;
}
float pear(vec2 p) {
  if (p.y > -0.06 || p.y < -0.47) return 1.0;
  float w = 0.085 * (1.0 - smoothstep(-0.3, -0.06, p.y));
  if (p.y < -0.38) w *= sqrt(max(1.0 - pow((p.y + 0.38) / 0.09, 2.0), 0.0));
  return (abs(p.x) - w) * 12.0;
}

void main() {
  float hole = 1.0;
  if (vPaint.x > 0.5) {
    hole = min(socket(vPlan), pear(vPlan));
    if (hole < 0.0) discard;
  }
  if (!gl_FrontFacing) {
    gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }
  vec2 st = vec2(vPlan.x / 0.9 + 0.5, vPlan.y / 1.3 + 0.5);
  vec4 detail = texture2D(uDetail, st);
  float e = 0.004;
  float dx = texture2D(uDetail, st + vec2(e, 0.0)).r - detail.r;
  float dy = texture2D(uDetail, st + vec2(0.0, e)).r - detail.r;
  vec3 n = normalize(normalize(vNormal) - vec3(dx, dy, 0.0) * 1.3);
  float diffuse = max(dot(n, uKey) * 0.75 + 0.25, 0.0);

  vec3 bone = mix(vec3(0.84, 0.79, 0.66), vec3(0.46, 0.35, 0.22), detail.b * 0.8);
  bone *= 0.74 + 0.46 * detail.r;
  bone = mix(bone, vec3(0.13, 0.09, 0.06), clamp(vPaint.y, 0.0, 0.9));
  bone *= 1.0 - 0.8 * detail.g;
  // Dark round the holes' edges.
  bone *= 0.3 + 0.7 * smoothstep(0.0, 0.3, hole);
  vec3 half_ = normalize(uKey + vec3(0.0, 0.0, 1.0));
  float spec = pow(max(dot(n, half_), 0.0), 26.0) * 0.16;
  gl_FragColor = vec4(bone * (0.08 + 1.02 * diffuse) + spec, 1.0);
}
`

export const BARK_VERTEX = /* glsl */ `
attribute float aTip;
varying vec3 vNormal;
varying vec2 vBark;
varying float vTip;
void main() {
  vNormal = mat3(modelMatrix) * normal;
  vBark = uv;
  vTip = aTip;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

/** Antler and dead wood: dark furrowed bark, worn pale at the tips, moss low down; uPale for the antlers. */
export const BARK_FRAGMENT = /* glsl */ `
uniform vec3 uKey;
uniform float uPale;
varying vec3 vNormal;
varying vec2 vBark;
varying float vTip;
${NOISE}
void main() {
  vec3 n = normalize(vNormal);
  // Long furrows running along the antler.
  float furrow = noise(vec2(vBark.y * 22.0, vBark.x * 1.6)) * 0.7 + noise(vec2(vBark.y * 60.0, vBark.x * 5.0)) * 0.3;
  vec3 col = mix(vec3(0.07, 0.052, 0.038), vec3(0.34, 0.27, 0.18), smoothstep(0.3, 0.72, furrow));
  col = mix(col, vec3(0.62, 0.56, 0.43), uPale * smoothstep(0.72, 1.0, vTip));
  float moss = smoothstep(0.62, 0.8, noise(vBark * vec2(3.0, 5.0))) * (1.0 - smoothstep(0.05, 0.3, vTip));
  col = mix(col, vec3(0.15, 0.19, 0.07), moss * 0.55);
  float diffuse = max(dot(n, uKey) * 0.75 + 0.25, 0.0);
  vec3 half_ = normalize(uKey + vec3(0.0, 0.0, 1.0));
  float spec = pow(max(dot(n, half_), 0.0), 22.0) * 0.14;
  float rim = pow(1.0 - clamp(n.z, 0.0, 1.0), 3.0);
  gl_FragColor = vec4(col * (0.1 + 1.05 * diffuse) + spec + vec3(0.09, 0.11, 0.13) * rim, 1.0);
}
`

/**
 * The hood: the top turns with the skull (uTurn about uPivot), the shoulders
 * stay put. aEdge is the distance to the torn edge of the opening.
 */
export const HOOD_VERTEX = /* glsl */ `
uniform mat3 uTurn;
uniform vec3 uPivot;
attribute float aEdge;
varying vec3 vNormal, vPos;
varying vec2 vUv;
varying float vEdge;
void main() {
  float w = smoothstep(-1.0, -0.4, position.y);
  vec3 p = position - uPivot;
  p = mix(p, uTurn * p, w) + uPivot;
  vNormal = mat3(modelMatrix) * normalize(mix(normal, uTurn * normal, w));
  vPos = position;
  vUv = uv;
  vEdge = aEdge;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`

export const HOOD_FRAGMENT = /* glsl */ `
uniform sampler2D uMap;
uniform vec3 uKey;
varying vec3 vNormal, vPos;
varying vec2 vUv;
varying float vEdge;
${NOISE}
void main() {
  vec4 tex = texture2D(uMap, vUv);
  if (tex.a < 0.5) discard;
  float rag = noise(vPos.xy * vec2(9.0, 15.0)) * 0.7 + noise(vPos.xy * 31.0) * 0.3;
  if (vEdge < rag * 0.13) discard;
  if (!gl_FrontFacing) {
    // The inside: a little brown near the torn edge, black deeper in.
    gl_FragColor = vec4(tex.rgb * (0.03 + 0.3 * (1.0 - smoothstep(0.0, 0.3, vEdge))), 1.0);
    return;
  }
  vec3 n = normalize(vNormal);
  float diffuse = max(dot(n, uKey) * 0.8 + 0.2, 0.0);
  vec3 half_ = normalize(uKey + vec3(0.0, 0.0, 1.0));
  float spec = pow(max(dot(n, half_), 0.0), 14.0) * 0.07;
  float rim = pow(1.0 - clamp(n.z, 0.0, 1.0), 3.0);
  vec3 col = tex.rgb * (0.12 + 1.35 * diffuse * diffuse) + spec + vec3(0.05, 0.06, 0.07) * rim;
  // Frayed, darker along the torn edge.
  col *= 0.55 + 0.45 * smoothstep(0.1, 0.3, vEdge);
  gl_FragColor = vec4(col, 1.0);
}
`

/** The forest at night: black trunks in thin cold fog, a little pale light behind the antlers. */
export const FOREST_FRAGMENT = /* glsl */ `
uniform vec2 uSize;
uniform float uTime, uWake;
varying vec2 vUv;
${NOISE}
void main() {
  vec2 p = (vUv - 0.5) * uSize;
  float fog = noise(p * 0.45 + vec2(uTime * 0.03, 0.0)) * 0.6 + noise(p * 1.1 - vec2(uTime * 0.05, uTime * 0.012)) * 0.4;
  vec3 col = vec3(0.022, 0.026, 0.03) + vec3(0.05, 0.062, 0.068) * smoothstep(0.3, 0.85, fog);
  col += vec3(0.085, 0.105, 0.11) * exp(-dot((p - vec2(0.0, 1.5)) * vec2(0.34, 0.5), (p - vec2(0.0, 1.5)) * vec2(0.34, 0.5)));
  // Trunks, far out of focus: uneven columns, leaning a little.
  float x = p.x + p.y * 0.06;
  float trunks = smoothstep(0.34, 0.72, noise(vec2(x * 0.95, 3.0))) * (0.75 + 0.25 * noise(vec2(x * 2.6, p.y * 0.3)));
  col *= 1.0 - 0.55 * trunks;
  // When the forest wakes, a sick green breath through the fog.
  col += vec3(0.03, 0.075, 0.035) * uWake * smoothstep(0.3, 0.8, fog);
  col *= 1.0 - 0.45 * smoothstep(2.0, 7.0, length(p - vec2(0.0, 0.5)));
  gl_FragColor = vec4(col, 1.0);
}
`

/** Will-o'-the-wisps. Positions come from seeds and time only. */
export const WISP_VERTEX = /* glsl */ `
uniform float uTime, uScale, uWake;
attribute vec4 aSeed;
varying float vAlpha;
void main() {
  vec3 p = vec3((aSeed.x - 0.5) * 7.0, (aSeed.y - 0.5) * 4.0 + 0.5, -2.2 + aSeed.z * 3.0);
  float t = uTime * (0.1 + 0.16 * aSeed.w) + aSeed.w * 40.0;
  p += vec3(sin(t) * 0.3 + sin(t * 2.3) * 0.08, cos(t * 0.8) * 0.2, sin(t * 0.6) * 0.15);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = uScale * (0.03 + 0.05 * aSeed.w) * (1.0 + uWake * 0.6) / -mv.z;
  float pulse = pow(0.5 + 0.5 * sin(uTime * (0.7 + aSeed.y) + aSeed.x * 60.0), 3.0);
  vAlpha = pulse * (0.55 + 0.45 * uWake);
}
`

export const WISP_FRAGMENT = /* glsl */ `
varying float vAlpha;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  gl_FragColor = vec4(vec3(0.72, 0.95, 0.42), exp(-dot(c, c) * 22.0) * vAlpha);
}
`

/** Cold breath from the nasal opening: soft puffs that grow and fade. */
export const BREATH_VERTEX = /* glsl */ `
uniform float uScale;
attribute float aAge;
varying float vAlpha;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float life = clamp(aAge, 0.0, 1.0);
  gl_PointSize = uScale * (0.05 + 0.34 * life) / -mv.z;
  vAlpha = aAge < 0.0 ? 0.0 : smoothstep(0.0, 0.12, life) * (1.0 - life);
}
`

export const BREATH_FRAGMENT = /* glsl */ `
varying float vAlpha;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  gl_FragColor = vec4(vec3(0.6, 0.66, 0.66), exp(-dot(c, c) * 13.0) * vAlpha * 0.13);
}
`
