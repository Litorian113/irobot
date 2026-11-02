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
 * edges, lit from one side, with a few strokes of floor under their
 * feet. Each person has their own colour from one spectrum (cyan, blue, violet, pink); who stays a few
 * seconds gets an aura: the strokes stay put, the colours run through the spectrum and into one
 * another, and a slow wave of light goes up the body.
 * WebGL 1 safe: one quad, a 64 x 36 texture, GLSL ES 1.0 without derivatives.
 */

export type OutlineStyle = 'silhouette' | 'schraffur' | 'gewirr'

/** Gewirr: lines per person at most, and people at most. */
const TANGLE_LINES = 560
const TANGLE_PEOPLE = 3

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
  // Drawn once: the strokes stay put, nothing flickers.
  float frame = 0.0;
  float spacing = 0.0062;
  float ink = 0.0;
  float light = 1.0;

  if (uv.x >= 0.0 && uv.x <= 1.0 && uv.y >= 0.0 && uv.y <= 1.0) {
    vec4 shape = texture2D(uShape, uv);
    // Light from the left of the picture: brighter where the body rises towards it.
    float gx = texture2D(uShape, uv + vec2(1.0 / 64.0, 0.0)).g - texture2D(uShape, uv - vec2(1.0 / 64.0, 0.0)).g;
    light = clamp(0.55 + gx * 5.0 + shape.g * 0.25, 0.25, 1.0);
    float aura = shape.b;
    // The colours run into one another, slowly, more so in the aura.
    tint = spectrum(shape.a + vWall.y * 0.22 + uTime * (0.012 + 0.07 * aura));
    float y = vWall.y + 0.03 * shape.g;
    float row = floor(y / spacing);
    // Long strokes of uneven length along the row, with gaps; each leans a little on its own.
    // They stay where they are: in the aura only the colour moves.
    float along = vWall.x / 0.11 + hash(vec2(row, 3.0 + frame)) * 13.0;
    float stroke = floor(along);
    float t = fract(along);
    float on = step(t, mix(0.45, 0.98, hash(vec2(row * 1.7, stroke + frame))));
    float lean = (hash(vec2(row * 3.1, stroke + frame)) - 0.5) * spacing * 1.6;
    float across = abs(fract((y + (t - 0.5) * lean) / spacing) - 0.5) * spacing;
    // Frayed edges: some strokes reach past the outline, some stop short.
    float edge = (hash(vec2(row + 11.0, stroke + frame * 0.5)) - 0.5) * 0.32;
    float body = smoothstep(0.42, 0.58, shape.r + edge);
    float width = 0.0009 * (0.7 + 0.7 * hash(vec2(row, stroke)));
    light *= 0.55 + 0.45 * hash(vec2(row * 7.0, stroke + frame));
    light *= 1.0 + 0.25 * aura * sin(uTime * 1.5 + vWall.y * 6.0);
    float mark = 1.0 - smoothstep(width * 0.5, width * 0.5 + uPixel, across);
    ink = mark * on * body;

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

/** Gewirr: the people solid black on white, softly edged, a little shadow at their feet. */
const BLACK_FRAGMENT = /* glsl */ `
uniform sampler2D uShape;
uniform vec4 uFrame;
varying vec2 vWall;
void main() {
  vec2 uv = vec2(0.5 - (vWall.x - uFrame.x) / uFrame.z, 0.5 - (vWall.y - uFrame.y) / uFrame.w);
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) discard;
  float body = smoothstep(0.4, 0.58, texture2D(uShape, uv).r);
  if (body <= 0.01) discard;
  gl_FragColor = vec4(vec3(0.04), body);
}
`

/**
 * Gewirr: pencil lines running out of each person, every one on its own slow way outwards, fading
 * as it goes, and a new one starting from the body. A quarter of them lie flat round the feet.
 * Each line is a thin quad; `position.x` 0..1 along it, `position.y` -0.5..0.5 across.
 */
const TANGLE_VERTEX = /* glsl */ `
uniform vec4 uPeople[3];   // centre x, y and width, height of each person on the wall; width 0: nobody
uniform vec3 uPresence;
uniform float uTime, uPixel;
attribute vec4 aSeed;
attribute float aPerson;
varying float vAcross, vAlpha, vHalf;
float hash(float n) { return fract(sin(n * 12.9898) * 43758.5453); }
void main() {
  vec4 who = aPerson < 0.5 ? uPeople[0] : aPerson < 1.5 ? uPeople[1] : uPeople[2];
  float here = aPerson < 0.5 ? uPresence.x : aPerson < 1.5 ? uPresence.y : uPresence.z;
  float life = fract(uTime * (0.025 + 0.05 * aSeed.x) + aSeed.y);
  bool ground = aSeed.w > 0.75;
  vec2 origin, dir;
  float reach, length;
  if (ground) {
    origin = vec2(who.x + (aSeed.z - 0.5) * who.z * 2.6, who.y - who.w * 0.5 + (hash(aSeed.x * 7.1) - 0.5) * who.w * 0.05);
    float a = (hash(aSeed.y * 3.3) - 0.5) * 0.35 + (hash(aSeed.z * 5.7) > 0.5 ? 3.14159 : 0.0);
    dir = vec2(cos(a), sin(a));
    reach = life * who.z * 1.4;
    length = (0.15 + 0.5 * hash(aSeed.x * 9.1)) * who.w * 0.5;
  } else {
    origin = who.xy + (vec2(aSeed.z, hash(aSeed.z * 3.7)) - 0.5) * who.zw * vec2(0.7, 0.85);
    // Every direction, a little more often up and down, like the drawing.
    float a = hash(aSeed.x * 4.3 + aSeed.y) * 6.28318;
    a += sin(a * 2.0) * 0.25;
    dir = vec2(cos(a), sin(a));
    // Most stay close round the body, a few go far.
    reach = life * (0.1 + 0.9 * aSeed.z * aSeed.z) * who.w * 0.75;
    length = (0.06 + 0.34 * hash(aSeed.y * 6.1)) * who.w;
  }
  vec2 start = origin + dir * reach;
  vec2 side = vec2(-dir.y, dir.x);
  float width = 0.0011 * (0.6 + 0.8 * hash(aSeed.w * 11.0));
  vHalf = width * 0.5;
  float across = position.y * (width + 2.0 * uPixel);
  vAcross = across;
  vec2 p = start + dir * length * position.x + side * across;
  // Coming out of the body, fading as it leaves; nobody there, no lines.
  vAlpha = smoothstep(0.0, 0.08, life) * (1.0 - life) * mix(0.3, 0.95, hash(aSeed.x * 17.0)) * here * step(0.001, who.z);
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 0.0, 1.0);
}
`
const TANGLE_FRAGMENT = /* glsl */ `
uniform float uPixel;
varying float vAcross, vAlpha, vHalf;
void main() {
  float ink = (1.0 - smoothstep(vHalf, vHalf + uPixel, abs(vAcross))) * vAlpha;
  if (ink <= 0.01) discard;
  gl_FragColor = vec4(vec3(0.12), ink);
}
`

function tangleGeometry() {
  const quad = new THREE.PlaneGeometry(1, 1, 1, 1)
  quad.translate(0.5, 0, 0)
  const geometry = new THREE.InstancedBufferGeometry()
  geometry.setIndex(quad.index)
  geometry.setAttribute('position', quad.attributes.position)
  const count = TANGLE_LINES * TANGLE_PEOPLE
  const seed = new Float32Array(count * 4), person = new Float32Array(count)
  for (let i = 0; i < count; i++) {
    for (let k = 0; k < 4; k++) seed[i * 4 + k] = Math.random()
    person[i] = i % TANGLE_PEOPLE
  }
  geometry.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 4))
  geometry.setAttribute('aPerson', new THREE.InstancedBufferAttribute(person, 1))
  geometry.instanceCount = count
  return geometry
}

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
  const tangled = options.style === 'gewirr'
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
    fragmentShader: hatched ? HATCH_FRAGMENT : tangled ? BLACK_FRAGMENT : FRAGMENT,
    transparent: true,
  })
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(width(view), height(view)), material)
  quad.position.set((view.x0 + view.x1) / 2, (view.y0 + view.y1) / 2, 0)
  quad.frustumCulled = false
  scene.add(quad)

  // Gewirr: the lines, drawn before the people so that the people stand in front of them.
  const people = Array.from({ length: TANGLE_PEOPLE }, () => new THREE.Vector4(0, 0, 0, 0))
  const presence = new THREE.Vector3()
  const tangleMaterial = tangled ? new THREE.ShaderMaterial({
    uniforms: { uPeople: { value: people }, uPresence: { value: presence }, uTime: material.uniforms.uTime, uPixel: material.uniforms.uPixel },
    vertexShader: TANGLE_VERTEX,
    fragmentShader: TANGLE_FRAGMENT,
    transparent: true,
    depthWrite: false,
  }) : null
  const tangle = tangleMaterial ? new THREE.Mesh(tangleGeometry(), tangleMaterial) : null
  if (tangle) {
    tangle.frustumCulled = false
    tangle.renderOrder = -1
    scene.add(tangle)
  }
  /** Which person each of the three line sets follows, and where they are (wall metres), eased. */
  const tracked: (number | null)[] = [null, null, null]

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

  /** Gewirr: each person's box from the outline, handed to the three line sets, eased. */
  const placePeople = (k: number) => {
    const boxes = new Map<number, { x0: number; x1: number; y0: number; y1: number; n: number }>()
    for (let y = 0; y < SHAPE_H; y++) for (let x = 0; x < SHAPE_W; x++) {
      const i = y * SHAPE_W + x
      if (shown[i] < 0.5 || !labels[i]) continue
      const b = boxes.get(labels[i]) ?? { x0: x, x1: x, y0: y, y1: y, n: 0 }
      b.x0 = Math.min(b.x0, x); b.x1 = Math.max(b.x1, x); b.y0 = Math.min(b.y0, y); b.y1 = Math.max(b.y1, y); b.n++
      boxes.set(labels[i], b)
    }
    const biggest = [...boxes.entries()].filter(([, b]) => b.n > 6).sort((a, b) => b[1].n - a[1].n).slice(0, TANGLE_PEOPLE).map(([id]) => id)
    // A person keeps their set of lines; a new one takes a free set.
    for (let slot = 0; slot < TANGLE_PEOPLE; slot++) if (tracked[slot] !== null && !biggest.includes(tracked[slot]!)) tracked[slot] = null
    for (const id of biggest) if (!tracked.includes(id)) { const free = tracked.indexOf(null); if (free >= 0) tracked[free] = id }
    tracked.forEach((id, slot) => {
      const b = id === null ? null : boxes.get(id)
      const target = slot === 0 ? 'x' : slot === 1 ? 'y' : 'z'
      presence[target] += ((b ? 1 : 0) - presence[target]) * Math.min(1, k * 0.6)
      if (!b) return
      // From cells of the camera picture to the wall, mirrored.
      const u = (b.x0 + b.x1 + 1) / 2 / SHAPE_W, v = (b.y0 + b.y1 + 1) / 2 / SHAPE_H
      const w = ((b.x1 - b.x0 + 1) / SHAPE_W) * frame.z, h = ((b.y1 - b.y0 + 1) / SHAPE_H) * frame.w
      const goal = new THREE.Vector4(frame.x + (0.5 - u) * frame.z, frame.y + (0.5 - v) * frame.w, w, h)
      if (people[slot].z === 0) people[slot].copy(goal)
      else people[slot].lerp(goal, Math.min(1, k))
    })
  }

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
    if (tangled) placePeople(k)
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
      tangle?.geometry.dispose()
      tangleMaterial?.dispose()
      material.dispose()
      texture.dispose()
      renderer.dispose()
    },
  }
}
