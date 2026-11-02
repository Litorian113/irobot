import * as THREE from 'three'
import { SHAPE_H, SHAPE_W } from '../tracking/silhouette'
import { height, wallRect, width, type Rect } from './geometry'
import type { PatternView } from './pattern'

/**
 * Silhouette and Schraffur, from the same outline of the people in front of the wall.
 *
 * Silhouette: the people in front of the wall, drawn back on it as lines across their bodies on
 * white, like a mirror: the lines bow with the body, thicker parts more. The camera picture is laid
 * over the whole wall, its height to the wall's, mirrored. Only a coarse outline arrives
 * (tracking/silhouette.ts); it is smoothed here, so the people seem to flow rather than flicker.
 * Schraffur: the same people on black, hatched in fine strokes of uneven length that fray at the
 * edges and redraw a few times a second, lit from one side, with a few strokes of floor under their
 * feet. Each person has their own colour from one spectrum (cyan, blue, violet, pink); who stays a few
 * seconds gets an aura: the strokes start to flow and grow, light streams off the body, the colour
 * wanders through the spectrum.
 * WebGL 1 safe: one quad, a 64 x 36 texture, GLSL ES 1.0 without derivatives.
 */

export type OutlineStyle = 'silhouette' | 'schraffur'

const PAPER = 0xefece6
const INK = new THREE.Color(0x1e1e1e)
/** Distance between the lines and their width, in metres. */
const SPACING = 0.024
const WIDTH = 0.0034
/** How far the lines bow over the thickest part of a body, in metres. */
const BOW = 0.05
/** How fast the shown outline follows a new one (per second): fast enough to follow, slow enough to flow. */
const FOLLOW = 7
/** Someone standing this long (ms) starts to glow; fully by AURA_FULL. */
const AURA_AFTER = 3500
const AURA_FULL = 7000
/** A person not seen for this long is gone: their aura starts again when they come back. */
const FORGET_MS = 1500
/** Where in the spectrum a person sits: spread out, so two people side by side differ. */
const hueOf = (person: number) => (person * 0.381966 + 0.13) % 1

const VERTEX = /* glsl */ `
varying vec2 vWall;
void main() {
  vec4 wall = modelMatrix * vec4(position, 1.0);
  vWall = wall.xy;
  gl_Position = projectionMatrix * viewMatrix * wall;
}
`

const FRAGMENT = /* glsl */ `
uniform sampler2D uShape;
uniform vec3 uInk;
uniform vec4 uFrame;   // centre x, centre y, width, height of the camera picture on the wall
uniform float uSpacing, uWidth, uBow, uPixel, uTime;
varying vec2 vWall;
void main() {
  // Mirrored: someone on the left of the street sees themselves on the left of the wall.
  vec2 uv = vec2(0.5 - (vWall.x - uFrame.x) / uFrame.z, 0.5 - (vWall.y - uFrame.y) / uFrame.w);
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) discard;
  vec4 shape = texture2D(uShape, uv);
  float body = smoothstep(0.44, 0.56, shape.r);
  if (body <= 0.0) discard;
  // The lines sag where the body is thick, and breathe a little.
  float y = vWall.y + uBow * shape.g + 0.004 * sin(vWall.x * 9.0 + uTime * 0.8);
  float d = abs(fract(y / uSpacing) - 0.5) * uSpacing;
  float ink = (1.0 - smoothstep(uWidth * 0.5, uWidth * 0.5 + uPixel, d)) * body;
  if (ink <= 0.01) discard;
  gl_FragColor = vec4(uInk, ink);
}
`

const HATCH_FRAGMENT = /* glsl */ `
uniform sampler2D uShape;
uniform vec4 uFrame;
uniform vec3 uFloor;   // the feet in the picture: u, v, half width in u; v < 0: no one standing
uniform float uPixel, uTime;
varying vec2 vWall;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

// One spectrum for everyone: cyan, blue, violet, pink, and round again.
vec3 spectrum(float h) {
  h = fract(h) * 4.0;
  vec3 a = vec3(0.37, 0.91, 1.0), b = vec3(0.44, 0.55, 1.0), c = vec3(0.77, 0.42, 1.0), d = vec3(1.0, 0.44, 0.71);
  if (h < 1.0) return mix(a, b, h);
  if (h < 2.0) return mix(b, c, h - 1.0);
  if (h < 3.0) return mix(c, d, h - 2.0);
  return mix(d, a, h - 3.0);
}

void main() {
  vec2 uv = vec2(0.5 - (vWall.x - uFrame.x) / uFrame.z, 0.5 - (vWall.y - uFrame.y) / uFrame.w);
  vec3 tint = vec3(1.0);
  // Redrawn by hand a few times a second.
  float frame = floor(uTime * 7.0);
  float spacing = 0.0062;
  float ink = 0.0;
  float light = 1.0;

  if (uv.x >= 0.0 && uv.x <= 1.0 && uv.y >= 0.0 && uv.y <= 1.0) {
    vec4 shape = texture2D(uShape, uv);
    // Light from the left of the picture: brighter where the body rises towards it.
    float gx = texture2D(uShape, uv + vec2(1.0 / 64.0, 0.0)).g - texture2D(uShape, uv - vec2(1.0 / 64.0, 0.0)).g;
    light = clamp(0.55 + gx * 5.0 + shape.g * 0.25, 0.25, 1.0);
    float aura = shape.b;
    tint = spectrum(shape.a + uTime * 0.05 * aura);
    float y = vWall.y + 0.03 * shape.g;
    float row = floor(y / spacing);
    // Long strokes of uneven length along the row, with gaps; each leans a little on its own.
    // In the aura they flow along their rows, every other row the other way, and grow longer.
    float flow = uTime * (0.5 + 0.7 * hash(vec2(row, 5.0))) * aura * (mod(row, 2.0) * 2.0 - 1.0);
    float along = vWall.x / 0.11 + hash(vec2(row, 3.0 + frame)) * 13.0 + flow;
    float stroke = floor(along);
    float t = fract(along);
    float on = step(t, mix(0.45, 0.98, hash(vec2(row * 1.7, stroke + frame))) + 0.2 * aura);
    float lean = (hash(vec2(row * 3.1, stroke + frame)) - 0.5) * spacing * 1.6;
    float across = abs(fract((y + (t - 0.5) * lean) / spacing) - 0.5) * spacing;
    // Frayed edges: some strokes reach past the outline, some stop short.
    float edge = (hash(vec2(row + 11.0, stroke + frame * 0.5)) - 0.5) * 0.32;
    float body = smoothstep(0.42, 0.58, shape.r + edge);
    float width = 0.0009 * (0.7 + 0.7 * hash(vec2(row, stroke)));
    light *= 0.55 + 0.45 * hash(vec2(row * 7.0, stroke + frame));
    light *= 1.0 + 0.35 * aura * sin(uTime * 3.0 + row * 0.35);
    // Light streaming off the body: sparse strokes in the aura around it.
    float halo = (1.0 - body) * smoothstep(0.08, 0.45, aura) * step(0.72, hash(vec2(row * 2.3, stroke + frame)));
    float mark = 1.0 - smoothstep(width * 0.5, width * 0.5 + uPixel, across);
    ink = mark * on * max(body, halo * 0.7);

    // A little floor under the feet: flat strokes, densest under them, fading out sideways.
    if (uFloor.y > 0.0) {
      float below = (uv.y - uFloor.y) * uFrame.w;
      float side = abs(uv.x - uFloor.x) / max(uFloor.z, 0.02);
      float band = (1.0 - smoothstep(-0.006, 0.03, abs(below - 0.008))) * (1.0 - smoothstep(0.8, 2.6 + hash(vec2(row, frame)) * 1.4, side));
      float fy = vWall.y / (spacing * 0.55);
      float fRow = floor(fy);
      float fAlong = vWall.x / 0.07 + hash(vec2(fRow, 7.0 + frame)) * 5.0;
      float fOn = step(fract(fAlong), mix(0.4, 0.95, hash(vec2(fRow, floor(fAlong) + frame))));
      float fLine = 1.0 - smoothstep(0.0005, 0.0005 + uPixel, abs(fract(fy) - 0.5) * spacing * 0.55);
      ink = max(ink, fLine * fOn * band * 0.8);
    }
  }
  if (ink <= 0.01) discard;
  gl_FragColor = vec4(mix(vec3(1.0), tint, 0.8) * (0.93 * light + 0.07), ink);
}
`

/** Box blur, in place, `radius` cells wide: soft edges from the coarse grid, and the body's thickness. */
function blur(values: Float32Array, radius: number) {
  const out = new Float32Array(values.length)
  for (const horizontal of [true, false]) {
    for (let y = 0; y < SHAPE_H; y++) for (let x = 0; x < SHAPE_W; x++) {
      let sum = 0, n = 0
      for (let d = -radius; d <= radius; d++) {
        const xx = horizontal ? x + d : x, yy = horizontal ? y : y + d
        if (xx < 0 || yy < 0 || xx >= SHAPE_W || yy >= SHAPE_H) continue
        sum += values[yy * SHAPE_W + xx]
        n++
      }
      out[y * SHAPE_W + x] = sum / n
    }
    values.set(out)
  }
  return values
}

/**
 * Where the feet are: the lowest rows that still hold someone, their middle and width, in picture
 * coordinates (v down). Nobody: v below 0, no floor.
 */
function placeFloor(cells: Float32Array, floor: THREE.Vector3) {
  for (let y = SHAPE_H - 1; y >= 0; y--) {
    let sum = 0, weighted = 0, lo = SHAPE_W, hi = -1
    for (let x = 0; x < SHAPE_W; x++) {
      const v = cells[y * SHAPE_W + x]
      if (v < 0.5) continue
      sum += v
      weighted += v * x
      lo = Math.min(lo, x)
      hi = Math.max(hi, x)
    }
    if (sum < 1) continue
    const u = (weighted / sum + 0.5) / SHAPE_W
    floor.set(u, (y + 1) / SHAPE_H, Math.max(1.5, (hi - lo + 1) / 2) / SHAPE_W)
    return
  }
  floor.set(0, -1, 0)
}

/** Draw the people into `canvas` in `style`, showing the part `view` of the wall. */
export function createSilhouette(canvas: HTMLCanvasElement, view: Rect, options: { now: () => number; fps?: number; maxPixelRatio?: number; style?: OutlineStyle }): PatternView & { setShape(cells: Uint8Array | null): void } {
  const hatched = options.style === 'schraffur'
  const attributes: WebGLContextAttributes = { antialias: true, alpha: false, powerPreference: 'high-performance' }
  const renderer = new THREE.WebGLRenderer({ canvas, ...attributes })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, options.maxPixelRatio ?? 1.5))
  renderer.setClearColor(hatched ? 0x000000 : PAPER, 1)
  const scene = new THREE.Scene()
  const camera = new THREE.OrthographicCamera(view.x0, view.x1, view.y1, view.y0, -1, 1)
  const wall = wallRect()
  // The camera picture, 16:9, as high as the wall, in its middle.
  const frameHeight = height(wall)
  const frame = new THREE.Vector4((wall.x0 + wall.x1) / 2, (wall.y0 + wall.y1) / 2, frameHeight * 16 / 9, frameHeight)

  const data = new Uint8Array(SHAPE_W * SHAPE_H * 4)
  const texture = new THREE.DataTexture(data, SHAPE_W, SHAPE_H, THREE.RGBAFormat)
  texture.magFilter = THREE.LinearFilter
  texture.minFilter = THREE.LinearFilter
  texture.needsUpdate = true
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uShape: { value: texture },
      uInk: { value: INK },
      uFrame: { value: frame },
      uSpacing: { value: SPACING },
      uWidth: { value: WIDTH },
      uBow: { value: BOW },
      uPixel: { value: 0.001 },
      uTime: { value: 0 },
      uFloor: { value: new THREE.Vector3(0, -1, 0) },
    },
    vertexShader: VERTEX,
    fragmentShader: hatched ? HATCH_FRAGMENT : FRAGMENT,
    transparent: true,
  })
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(width(view), height(view)), material)
  quad.position.set((view.x0 + view.x1) / 2, (view.y0 + view.y1) / 2, 0)
  quad.frustumCulled = false
  scene.add(quad)

  const target = new Float32Array(SHAPE_W * SHAPE_H)
  const shown = new Float32Array(SHAPE_W * SHAPE_H)
  /** Who each cell last belonged to, their place in the spectrum, and how long each person has been there. */
  const labels = new Uint8Array(SHAPE_W * SHAPE_H)
  const hue = new Float32Array(SHAPE_W * SHAPE_H)
  const stay = new Map<number, { since: number; seen: number }>()
  let raf = 0, last = performance.now(), frames = 0, since = last, renderedFps = 0, disposed = false
  const fps = options.fps ?? 30

  const resize = () => {
    const w = canvas.clientWidth || 1
    renderer.setSize(w, canvas.clientHeight || 1, false)
    material.uniforms.uPixel.value = width(view) / (w * renderer.getPixelRatio())
  }
  const observer = new ResizeObserver(resize)
  observer.observe(canvas)
  resize()

  const tick = () => {
    if (disposed) return
    raf = requestAnimationFrame(tick)
    const now = performance.now()
    if (now - last < 1000 / fps - 2) return
    const k = Math.min(1, ((now - last) / 1000) * FOLLOW)
    last = now
    for (let i = 0; i < shown.length; i++) shown[i] += (target[i] - shown[i]) * k
    const edge = blur(Float32Array.from(shown), 1)
    const depth = blur(Float32Array.from(shown), 4)
    // The aura of each person, by how long they have stood there, spread a little past their outline.
    for (const [person, s] of stay) if (now - s.seen > FORGET_MS) stay.delete(person)
    const glow = new Float32Array(shown.length)
    for (let i = 0; i < shown.length; i++) {
      const s = labels[i] ? stay.get(labels[i]) : undefined
      if (s) glow[i] = shown[i] * Math.min(1, Math.max(0, (now - s.since - AURA_AFTER) / (AURA_FULL - AURA_AFTER)))
    }
    const aura = blur(glow, 5)
    for (let i = 0; i < shown.length; i++) {
      data[i * 4] = Math.round(edge[i] * 255)
      data[i * 4 + 1] = Math.round(Math.min(1, depth[i] * 1.25) * 255)
      data[i * 4 + 2] = Math.round(Math.min(1, Math.max(glow[i], aura[i] * 1.6)) * 255)
      data[i * 4 + 3] = Math.round(hue[i] * 255)
    }
    texture.needsUpdate = true
    if (hatched) placeFloor(edge, material.uniforms.uFloor.value as THREE.Vector3)
    material.uniforms.uTime.value = (options.now() / 1000) % 3600
    renderer.render(scene, camera)
    frames++
    if (now - since > 1000) {
      renderedFps = frames
      frames = 0
      since = now
    }
  }
  tick()

  return {
    setShape(cells) {
      if (!cells) {
        target.fill(0)
        return
      }
      const now = performance.now()
      for (let i = 0; i < target.length; i++) {
        target[i] = cells[i] ? 1 : 0
        if (!cells[i]) continue
        labels[i] = cells[i]
        hue[i] = hueOf(cells[i])
        const s = stay.get(cells[i])
        if (s) s.seen = now
        else stay.set(cells[i], { since: now, seen: now })
      }
    },
    setPerson() {},
    debug: () => ({ webgl: renderer.capabilities.isWebGL2 ? 2 : 1, renderedFps, headLoaded: true, pattern: options.style ?? 'silhouette', cells: target.reduce((a, b) => a + b, 0), people: stay.size }),
    dispose() {
      disposed = true
      cancelAnimationFrame(raf)
      observer.disconnect()
      quad.geometry.dispose()
      material.dispose()
      texture.dispose()
      renderer.dispose()
    },
  }
}
