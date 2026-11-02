import * as THREE from 'three'
import { SHAPE_H, SHAPE_W } from '../tracking/silhouette'
import { height, wallRect, width, type Rect } from './geometry'
import type { PatternView } from './pattern'

/**
 * Kritzel: each person in front of the wall drawn by one pencil line, scribbled fast in small loops
 * (circular scribble art, Chiu et al. 2015): the loops run round a hidden path that starts in the
 * darkest place, the chest, and works its way outwards over the body, going over the dark parts
 * again and again. The longer someone stands, the more of the line is drawn and the heavier the
 * drawing gets. From WOBBLE_AFTER on it never quite keeps still; from MORPH_AFTER the scribble comes
 * apart, flies over the wall and gathers into the letters H F G over all screens.
 *
 * Every screen draws the same picture: the paths are made once from a fixed seed, and where they lie
 * on the body follows only from the outline the camera sends, not from what a screen drew before.
 * Per frame the CPU places 2048 anchors per person on the outline (a distance field on the 64 x 36
 * grid) and sends them as a small texture; the GPU draws the loops round them from a fixed buffer,
 * and only as far as the line has got.
 */

/** People at most, anchors of the hidden path per person, and line points per anchor. */
const PEOPLE = 3
const ANCHORS = 2048
const STEPS = 24
const POINTS = ANCHORS * STEPS
/** Line points per loop, on average. */
const PER_LOOP = 12

const PAPER = 0xefece6
/** Loop radius on a body and in the letters, line width, in metres (a pixel on an iMac is 0.27 mm). */
const R_BODY = 0.01
const R_LETTER = 0.021
const WIDTH = 0.0007
/** The hidden path: its step and the box it is made in, a person standing 1 m tall. */
const BODY_STEP = 0.012
const BODY_BOX = { w: 0.45, h: 1 }
const LETTER_STEP = 0.02

/** Timeline of someone standing, in seconds. */
const DRAW_S = 22
const WOBBLE_AFTER = 20
const WOBBLE_FULL = 26
const MORPH_AFTER = 32
const MORPH_S = 9
/** How far the strands fly apart on their way to the letters, metres; how far they tremble. */
const SCATTER = 0.35
const WOBBLE = 0.005

/** How fast the shown outline and the anchors follow a new one (per second). */
const FOLLOW = 7
/** A person not seen for this long is gone; their line fades and starts again when they come back. */
const FORGET_MS = 1500

/** Mulberry32: the same numbers on every screen. */
function seeded(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/**
 * The hidden path through `density` (0..1 over `bounds`, in metres): from `start` it heads, with
 * some momentum and a shaky hand, for what is dark and not yet covered, and so works its way
 * outwards; covered places fade from its interest but never quite, so it comes back to the darkest.
 */
function hiddenPath(density: (x: number, y: number) => number, bounds: Rect, start: { x: number; y: number }, step: number, seed: number) {
  const random = seeded(seed)
  const cell = 0.025
  const gw = Math.ceil(width(bounds) / cell), gh = Math.ceil(height(bounds) / cell)
  const dark = new Float32Array(gw * gh), cover = new Float32Array(gw * gh)
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) dark[y * gw + x] = density(bounds.x0 + (x + 0.5) * cell, bounds.y0 + (y + 0.5) * cell)
  const cellOf = (x: number, y: number) => {
    const cx = Math.floor((x - bounds.x0) / cell), cy = Math.floor((y - bounds.y0) / cell)
    return cx < 0 || cy < 0 || cx >= gw || cy >= gh ? -1 : cy * gw + cx
  }
  const need = (i: number) => (i < 0 ? -1 : dark[i] * Math.exp(-cover[i] / (2 * dark[i] + 0.1)))
  const turn = (from: number, to: number, k: number) => from + Math.atan2(Math.sin(to - from), Math.cos(to - from)) * k

  const out = new Float32Array(ANCHORS * 2)
  let x = start.x, y = start.y, heading = random() * Math.PI * 2, stuck = 0
  for (let k = 0; k < ANCHORS; k++) {
    out[k * 2] = x
    out[k * 2 + 1] = y
    const here = cellOf(x, y)
    if (here >= 0) {
      cover[here] += 0.5
      for (const n of [here - 1, here + 1, here - gw, here + gw]) if (n >= 0 && n < cover.length) cover[n] += 0.25
    }
    let best = heading, bestScore = -Infinity, bestNeed = 0
    for (let c = -3; c <= 3; c++) {
      const a = heading + c * 0.38
      const n = need(cellOf(x + Math.cos(a) * cell * 1.6, y + Math.sin(a) * cell * 1.6))
      const score = n + random() * 0.12
      if (score > bestScore) { bestScore = score; best = a; bestNeed = n }
    }
    stuck = bestNeed < 0.12 ? stuck + 1 : 0
    if (stuck > 10) {
      // Nothing worth drawing ahead: across to the nearest place that still wants it.
      let goal = -1, goalScore = -Infinity
      for (let i = 0; i < dark.length; i++) {
        const gx = bounds.x0 + ((i % gw) + 0.5) * cell, gy = bounds.y0 + (Math.floor(i / gw) + 0.5) * cell
        const score = need(i) - Math.hypot(gx - x, gy - y) * 0.6
        if (score > goalScore) { goalScore = score; goal = i }
      }
      const gx = bounds.x0 + ((goal % gw) + 0.5) * cell, gy = bounds.y0 + (Math.floor(goal / gw) + 0.5) * cell
      heading = turn(heading, Math.atan2(gy - y, gx - x), 0.4)
    } else {
      heading = turn(heading, best, 0.3)
    }
    heading += (random() - 0.5) * 0.3
    x = Math.min(bounds.x1, Math.max(bounds.x0, x + Math.cos(heading) * step))
    y = Math.min(bounds.y1, Math.max(bounds.y0, y + Math.sin(heading) * step))
  }
  return out
}

/** A person standing in their box (x 0..1 left to right, y 0..1 top to bottom): how dark to draw where. */
function bodyDensity(u: number, v: number) {
  if (Math.hypot((u - 0.5) / 0.1, (v - 0.075) / 0.075) < 1) return 0.75
  if (Math.abs(u - 0.5) < 0.05 && v < 0.16) return 0.6
  if (Math.abs(u - 0.5) < 0.2 && v > 0.14 && v < 0.54) return 1 - Math.abs(u - 0.5) * 1.2 - Math.max(0, v - 0.4)
  if (Math.abs(u - 0.5) < 0.33 && v > 0.16 && v < 0.52) return 0.5
  const leg = Math.abs(Math.abs(u - 0.5) - 0.095)
  if (leg < 0.075 && v > 0.5 && v < 0.99) return 0.65
  return 0
}

/** The letters H F G over the wall, as seen from the street, in metres. */
function letterDensity(x: number, y: number) {
  const top = 0.53, w = 0.21, t = 0.13, gap = 0.54
  if (Math.abs(y) > top) return 0
  const inside = (x0: number, x1: number, y0: number, y1: number) => x >= x0 && x <= x1 && y >= y0 && y <= y1
  const h = -gap, f = 0, g = gap
  if (inside(h - w, h - w + t, -top, top) || inside(h + w - t, h + w, -top, top) || inside(h - w, h + w, -t / 2, t / 2)) return 1
  if (inside(f - w, f - w + t, -top, top) || inside(f - w, f + w, top - t, top) || inside(f - w, f + w * 0.7, -0.03, 0.1)) return 1
  const outer = Math.hypot((x - g) / w, y / top), inner = Math.hypot((x - g) / (w - t), y / (top - t))
  const angle = Math.atan2(y / top, (x - g) / w)
  if (outer <= 1 && inner >= 1 && !(angle > 0.05 && angle < 0.95)) return 1
  if (inside(g, g + w, -t / 2, t / 2) || inside(g + w - t, g + w, -0.35, 0)) return 1
  return 0
}

/** Per person: the hidden path over a body (in its box, 0..1) and over the letters (wall metres). */
const makePaths = () => Array.from({ length: PEOPLE }, (_, person) => {
  const box: Rect = { x0: 0, y0: 0, x1: BODY_BOX.w, y1: BODY_BOX.h }
  const body = hiddenPath((x, y) => bodyDensity(x / BODY_BOX.w, y / BODY_BOX.h), box, { x: BODY_BOX.w / 2, y: BODY_BOX.h * 0.3 }, BODY_STEP, 11 + person * 101)
  for (let k = 0; k < ANCHORS; k++) { body[k * 2] /= BODY_BOX.w; body[k * 2 + 1] /= BODY_BOX.h }
  const letters = hiddenPath(letterDensity, { x0: -0.8, y0: -0.55, x1: 0.8, y1: 0.55 }, { x: -0.7, y: 0.45 }, LETTER_STEP, 23 + person * 211)
  const random = seeded(37 + person)
  // How each anchor travels to the letters: when it sets off, and which way it is blown first.
  const delay = new Float32Array(ANCHORS), blow = new Float32Array(ANCHORS * 2), inset = new Float32Array(ANCHORS), ink = new Float32Array(ANCHORS)
  for (let k = 0; k < ANCHORS; k++) {
    delay[k] = 0.3 * (k / ANCHORS) + 0.25 * random()
    const a = random() * Math.PI * 2
    blow[k * 2] = Math.cos(a)
    blow[k * 2 + 1] = Math.sin(a)
    inset[k] = 0.3 + 0.9 * random()
    // Between the letters the pencil is lifted.
    ink[k] = letterDensity(letters[k * 2], letters[k * 2 + 1])
  }
  return { body, letters, delay, blow, inset, ink }
})
/** Made on first use: a few hundred milliseconds, not for the other patterns. */
let paths: ReturnType<typeof makePaths> | null = null

/**
 * The line itself, the same for everyone: where on its loop each point is, how big the loop, how hard
 * the pencil presses, and where it is lifted for a moment.
 */
function lineGeometry() {
  const random = seeded(5)
  const position = new Float32Array(POINTS * 2 * 3), loop = new Float32Array(POINTS * 2 * 4), shape = new Float32Array(POINTS * 2 * 2)
  const phases = [random() * 6.3, random() * 6.3, random() * 6.3, random() * 6.3]
  let phase = 0, turned = 0, lift = 0
  // Every loop the hand makes a little differently: bigger, faster, flatter; it eases into each.
  let size = 1, sizeGoal = 1, speed = 1, speedGoal = 1, squash = 0.7, squashGoal = 0.7, way = 1
  for (let k = 0; k < POINTS; k++) {
    const step = ((Math.PI * 2) / PER_LOOP) * speed * (1 + 0.12 * (random() - 0.5))
    phase += way * step
    turned += step
    if (turned >= Math.PI * 2) {
      turned -= Math.PI * 2
      // Sometimes the hand turns the other way round: a figure of eight.
      if (random() < 0.18) way = -way
      sizeGoal = 0.4 + 0.9 * random()
      speedGoal = 0.75 + 0.5 * random()
      // Now and then hardly a loop at all: a quick zigzag.
      squashGoal = random() < 0.15 ? 0.08 + 0.2 * random() : 0.35 + 0.6 * random()
    }
    size += (sizeGoal - size) * 0.12
    speed += (speedGoal - speed) * 0.1
    squash += (squashGoal - squash) * 0.1
    const pressure = 0.5 + 0.5 * Math.sin(k * 0.0071 + phases[3]) * Math.sin(k * 0.0017 + phases[0])
    if (lift <= 0 && random() < 1 / 1200) lift = 8 + random() * 20
    const up = lift > 0 ? 1 - Math.min(1, Math.min(lift, 4) / 4) : 1
    lift--
    // The loops lie at a slowly changing slant.
    const turn = (k * 0.0015 + 1.3 * Math.sin(k * 0.0033 + phases[1])) % (Math.PI * 2)
    for (let s = 0; s < 2; s++) {
      const v = k * 2 + s
      position.set([k, s ? 1 : -1, 0], v * 3)
      // Angles kept small: a GPU's sine is coarse far from zero.
      loop.set([((phase % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2), size * (0.88 + 0.12 * Math.sin(k * 0.004 + phases[2])), pressure, up], v * 4)
      shape.set([squash, turn], v * 2)
    }
  }
  const index = new Uint32Array((POINTS - 1) * 6)
  for (let k = 0; k < POINTS - 1; k++) index.set([k * 2, k * 2 + 1, k * 2 + 2, k * 2 + 1, k * 2 + 3, k * 2 + 2], k * 6)
  return {
    position: new THREE.BufferAttribute(position, 3),
    loop: new THREE.BufferAttribute(loop, 4),
    shape: new THREE.BufferAttribute(shape, 2),
    index: new THREE.BufferAttribute(index, 1),
  }
}

const VERTEX = /* glsl */ `
uniform sampler2D uAnchors;
uniform vec4 uRange;   // x0, y0, width, height of the coded anchor positions, wall metres
uniform float uRow, uSpin, uPixel, uRBody, uRLetter, uWidth;
attribute vec4 aLoop;  // phase on the loop, loop size, pressure, 0 where the pencil is lifted
attribute vec2 aShape; // how flat the loop is, which way it lies
varying float vAcross, vHalf, vInk;
varying vec2 vWall;

const float ANCHORS = ${ANCHORS.toFixed(1)};
const float STEPS = ${STEPS.toFixed(1)};
const float ROWS = ${(PEOPLE * 2).toFixed(1)};
const float STEP_ANGLE = ${((Math.PI * 2) / PER_LOOP).toFixed(5)};

vec2 anchor(float i) {
  vec4 t = texture2D(uAnchors, vec2((clamp(i, 0.0, ANCHORS - 1.0) + 0.5) / ANCHORS, (uRow + 0.5) / ROWS));
  return uRange.xy + vec2(t.r * 65280.0 + t.g * 255.0, t.b * 65280.0 + t.a * 255.0) / 65535.0 * uRange.zw;
}
vec2 catmull(vec2 a, vec2 b, vec2 c, vec2 d, float t) {
  return 0.5 * (2.0 * b + (c - a) * t + (2.0 * a - 5.0 * b + 4.0 * c - d) * t * t + (3.0 * b - a - 3.0 * c + d) * t * t * t);
}

void main() {
  float s = position.x;
  float a = s / STEPS;
  float i = floor(a), t = a - i;
  vec2 a0 = anchor(i - 1.0), a1 = anchor(i), a2 = anchor(i + 1.0), a3 = anchor(i + 2.0);
  vec4 more = texture2D(uAnchors, vec2((i + 0.5) / ANCHORS, (uRow + ${PEOPLE.toFixed(1)} + 0.5) / ROWS));
  float morph = more.r;
  float r = mix(uRBody, uRLetter, morph) * aLoop.y;
  float squash = aShape.x;
  mat2 rot = mat2(cos(aShape.y), sin(aShape.y), -sin(aShape.y), cos(aShape.y));
  float theta = aLoop.x + uSpin;
  float dt = 0.3 / STEPS;
  vec2 p = catmull(a0, a1, a2, a3, t) + rot * vec2(cos(theta), squash * sin(theta)) * r;
  vec2 q = catmull(a0, a1, a2, a3, t + dt) + rot * vec2(cos(theta + 0.3 * STEP_ANGLE), squash * sin(theta + 0.3 * STEP_ANGLE)) * r;
  vec2 dir = normalize(q - p + vec2(1e-7, 0.0));
  float pressure = aLoop.z;
  // Never thinner than a pixel, or it falls apart into dots on a small preview.
  float w = max(uWidth * (0.7 + 0.6 * pressure), 1.2 * uPixel);
  vHalf = w * 0.5;
  vAcross = position.y * (vHalf + 1.5 * uPixel);
  vInk = (0.3 + 0.45 * pressure) * aLoop.w * more.g;
  p += vec2(-dir.y, dir.x) * vAcross;
  vWall = p;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 0.0, 1.0);
}
`

const FRAGMENT = /* glsl */ `
uniform float uPixel, uFade;
varying float vAcross, vHalf, vInk;
varying vec2 vWall;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + 1.0), f.x), f.y);
}

void main() {
  float d = abs(vAcross);
  float mark = 1.0 - smoothstep(vHalf, vHalf + uPixel, d);
  // The pencil's tip touches the paper in two places, a little apart.
  mark *= 0.7 + 0.3 * cos(vAcross / max(vHalf, 1e-6) * 4.7);
  // The tooth of the paper: lying still under the moving line, light strokes only catch its tops.
  // Its grain never finer than two pixels, or it only flickers.
  float grain = max(0.0006, 2.0 * uPixel);
  float tooth = noise(vWall / grain) * 0.6 + noise(vWall / (grain * 3.8)) * 0.4;
  float ink = mark * vInk * smoothstep(0.0, 0.55, tooth + vInk * 0.8 - 0.1) * uFade;
  if (ink <= 0.004) discard;
  gl_FragColor = vec4(0.16, 0.16, 0.19, ink);
}
`

/** Distance (in cells) from each cell to the nearest cell of `mask`; two passes. */
function distanceField(mask: Uint8Array, out: Float32Array) {
  for (let i = 0; i < out.length; i++) out[i] = mask[i] ? 0 : 1e4
  const D = Math.SQRT2
  for (let y = 0; y < SHAPE_H; y++) for (let x = 0; x < SHAPE_W; x++) {
    const i = y * SHAPE_W + x
    let v = out[i]
    if (x > 0) v = Math.min(v, out[i - 1] + 1)
    if (y > 0) {
      v = Math.min(v, out[i - SHAPE_W] + 1)
      if (x > 0) v = Math.min(v, out[i - SHAPE_W - 1] + D)
      if (x < SHAPE_W - 1) v = Math.min(v, out[i - SHAPE_W + 1] + D)
    }
    out[i] = v
  }
  for (let y = SHAPE_H - 1; y >= 0; y--) for (let x = SHAPE_W - 1; x >= 0; x--) {
    const i = y * SHAPE_W + x
    let v = out[i]
    if (x < SHAPE_W - 1) v = Math.min(v, out[i + 1] + 1)
    if (y < SHAPE_H - 1) {
      v = Math.min(v, out[i + SHAPE_W] + 1)
      if (x < SHAPE_W - 1) v = Math.min(v, out[i + SHAPE_W + 1] + D)
      if (x > 0) v = Math.min(v, out[i + SHAPE_W - 1] + D)
    }
    out[i] = v
  }
}

/** `field` at (x, y) in cells (cell centres at .5), bilinear. */
function sample(field: Float32Array, x: number, y: number) {
  const fx = Math.min(SHAPE_W - 1.001, Math.max(0, x - 0.5)), fy = Math.min(SHAPE_H - 1.001, Math.max(0, y - 0.5))
  const ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy
  const i = iy * SHAPE_W + ix
  return (field[i] * (1 - tx) + field[i + 1] * tx) * (1 - ty) + (field[i + SHAPE_W] * (1 - tx) + field[i + SHAPE_W + 1] * tx) * ty
}

interface Slot {
  /** The person (their number in the outline), or null; since when they stand, last seen (ms). */
  id: number | null
  since: number
  seen: number
  presence: number
  /** Their box in cells of the camera picture, eased: x0, y0, x1, y1 (exclusive). */
  box: Float32Array | null
  /** The anchors on their body, wall metres, eased; null until placed once. */
  body: Float32Array | null
  centre: { x: number; y: number }
}

/**
 * Draw the people as pencil scribbles into `canvas`, showing the part `view` of the wall. `ahead`
 * (ms) lets everyone seem to have stood that much longer: for the preview pictures.
 */
export function createScribble(canvas: HTMLCanvasElement, view: Rect, options: { now: () => number; fps?: number; maxPixelRatio?: number; ahead?: number }): PatternView & { setShape(cells: Uint8Array | null): void } {
  const attributes: WebGLContextAttributes = { antialias: true, alpha: false, powerPreference: 'high-performance' }
  const renderer = new THREE.WebGLRenderer({ canvas, ...attributes })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, options.maxPixelRatio ?? 1.5))
  renderer.setClearColor(PAPER, 1)
  const scene = new THREE.Scene()
  const camera = new THREE.OrthographicCamera(view.x0, view.x1, view.y1, view.y0, -1, 1)
  const wall = wallRect()
  // The camera picture, 16:9, as high as the wall, in its middle (as in Silhouette).
  const frameHeight = height(wall)
  const frame = { x: (wall.x0 + wall.x1) / 2, y: (wall.y0 + wall.y1) / 2, w: frameHeight * 16 / 9, h: frameHeight }
  // Anchors are coded in 16 bits over the wall and some room round it for the strands flying apart.
  const range = new THREE.Vector4(wall.x0 - 0.6, wall.y0 - 0.6, width(wall) + 1.2, height(wall) + 1.2)

  // Rows 0-2: each person's anchors (x, y in 16 bits each); rows 3-5: how far on to the letters, ink.
  const data = new Uint8Array(ANCHORS * PEOPLE * 2 * 4)
  const texture = new THREE.DataTexture(data, ANCHORS, PEOPLE * 2, THREE.RGBAFormat)
  texture.magFilter = THREE.NearestFilter
  texture.minFilter = THREE.NearestFilter
  texture.needsUpdate = true

  const line = lineGeometry()
  const pixel = { value: 0.001 }
  const PATHS = paths ??= makePaths()
  const meshes = Array.from({ length: PEOPLE }, (_, person) => {
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', line.position)
    geometry.setAttribute('aLoop', line.loop)
    geometry.setAttribute('aShape', line.shape)
    geometry.setIndex(line.index)
    geometry.setDrawRange(0, 0)
    const material = new THREE.ShaderMaterial({
      uniforms: {
        uAnchors: { value: texture }, uRange: { value: range }, uRow: { value: person }, uSpin: { value: 0 },
        uPixel: pixel, uRBody: { value: R_BODY }, uRLetter: { value: R_LETTER }, uWidth: { value: WIDTH }, uFade: { value: 0 },
      },
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      // The loops turn both ways: a strip that winds back would otherwise be culled.
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
    })
    const mesh = new THREE.Mesh(geometry, material)
    mesh.frustumCulled = false
    mesh.visible = false
    scene.add(mesh)
    return mesh
  })

  const slots: Slot[] = Array.from({ length: PEOPLE }, () => ({ id: null, since: 0, seen: 0, presence: 0, box: null, body: null, centre: { x: 0, y: 0 } }))
  const target = new Float32Array(SHAPE_W * SHAPE_H)
  const shown = new Float32Array(SHAPE_W * SHAPE_H)
  const labels = new Uint8Array(SHAPE_W * SHAPE_H)
  const mask = new Uint8Array(SHAPE_W * SHAPE_H)
  const distance = new Float32Array(SHAPE_W * SHAPE_H)
  let raf = 0, last = performance.now(), frames = 0, since = last, renderedFps = 0, disposed = false
  const fps = options.fps ?? 30
  const ahead = options.ahead ?? 0

  const resize = () => {
    const w = canvas.clientWidth || 1
    renderer.setSize(w, canvas.clientHeight || 1, false)
    pixel.value = width(view) / (w * renderer.getPixelRatio())
  }
  const observer = new ResizeObserver(resize)
  observer.observe(canvas)
  resize()

  /** Who is where: each person's box from the outline; a person keeps their slot, a new one takes a free one. */
  const placePeople = (now: number, k: number) => {
    const boxes = new Map<number, { x0: number; x1: number; y0: number; y1: number; n: number }>()
    for (let y = 0; y < SHAPE_H; y++) for (let x = 0; x < SHAPE_W; x++) {
      const i = y * SHAPE_W + x
      if (shown[i] < 0.5 || !labels[i]) continue
      const b = boxes.get(labels[i]) ?? { x0: x, x1: x, y0: y, y1: y, n: 0 }
      b.x0 = Math.min(b.x0, x); b.x1 = Math.max(b.x1, x); b.y0 = Math.min(b.y0, y); b.y1 = Math.max(b.y1, y); b.n++
      boxes.set(labels[i], b)
    }
    const biggest = [...boxes.entries()].filter(([, b]) => b.n > 6).sort((a, b) => b[1].n - a[1].n).slice(0, PEOPLE)
    for (const slot of slots) {
      const seen = slot.id !== null && biggest.some(([id]) => id === slot.id)
      if (seen) slot.seen = now
      else if (slot.id !== null && now - slot.seen > FORGET_MS) slot.id = null
      slot.presence += ((slot.id !== null ? 1 : 0) - slot.presence) * Math.min(1, k * (slot.id !== null ? 0.5 : 0.3))
      // Faded out: free, to start again from nothing.
      if (slot.id === null && slot.presence < 0.01) { slot.presence = 0; slot.box = null; slot.body = null }
    }
    for (const [id] of biggest) {
      if (slots.some((s) => s.id === id)) continue
      const free = slots.find((s) => s.id === null && s.presence === 0)
      if (free) Object.assign(free, { id, since: now - ahead, seen: now })
    }
    for (const slot of slots) {
      const b = slot.id === null ? undefined : boxes.get(slot.id)
      if (!b) continue
      const goal = [b.x0, b.y0, b.x1 + 1, b.y1 + 1]
      if (!slot.box) slot.box = Float32Array.from(goal)
      else for (let j = 0; j < 4; j++) slot.box[j] += (goal[j] - slot.box[j]) * k
    }
  }

  /** The body anchors of `person` in `slot` laid on their outline, eased, in wall metres. */
  const placeBody = (slot: Slot, person: number, k: number) => {
    const box = slot.box!
    for (let i = 0; i < mask.length; i++) mask[i] = shown[i] >= 0.5 && labels[i] === slot.id ? 1 : 0
    distanceField(mask, distance)
    const path = PATHS[person]
    const first = !slot.body
    slot.body ??= new Float32Array(ANCHORS * 2)
    let cx = 0, cy = 0
    for (let a = 0; a < ANCHORS; a++) {
      // Mirrored: the left of the box on the wall is the right of the camera picture.
      let x = box[2] - path.body[a * 2] * (box[2] - box[0])
      let y = box[1] + path.body[a * 2 + 1] * (box[3] - box[1])
      // Outside the body: down the distance field onto it, and a little way in.
      for (let n = 0; n < 4; n++) {
        const d = sample(distance, x, y)
        if (d <= 0.05) break
        const gx = sample(distance, x + 0.5, y) - sample(distance, x - 0.5, y)
        const gy = sample(distance, x, y + 0.5) - sample(distance, x, y - 0.5)
        const g = Math.hypot(gx, gy) || 1
        x -= (gx / g) * (d + path.inset[a])
        y -= (gy / g) * (d + path.inset[a])
      }
      const wx = frame.x + (0.5 - x / SHAPE_W) * frame.w, wy = frame.y + (0.5 - y / SHAPE_H) * frame.h
      if (first) { slot.body[a * 2] = wx; slot.body[a * 2 + 1] = wy }
      else { slot.body[a * 2] += (wx - slot.body[a * 2]) * k; slot.body[a * 2 + 1] += (wy - slot.body[a * 2 + 1]) * k }
      cx += slot.body[a * 2]
      cy += slot.body[a * 2 + 1]
    }
    slot.centre = { x: cx / ANCHORS, y: cy / ANCHORS }
  }

  /** Into the texture: where each anchor is now, with the trembling and the way to the letters. */
  const writeAnchors = (slot: Slot, person: number, stood: number, t: number) => {
    const path = PATHS[person]
    const wobble = WOBBLE * smoothstep(WOBBLE_AFTER, WOBBLE_FULL, stood)
    const morph = Math.min(1, Math.max(0, (stood - MORPH_AFTER) / MORPH_S))
    const body = slot.body!
    for (let a = 0; a < ANCHORS; a++) {
      const e = smoothstep(path.delay[a], path.delay[a] + 0.45, morph)
      // Away from the body first, every strand its own way, then into the letters.
      const out = Math.sin(Math.PI * e) * SCATTER
      const bx = body[a * 2], by = body[a * 2 + 1]
      const ox = bx - slot.centre.x, oy = by - slot.centre.y, ol = Math.hypot(ox, oy) || 1
      let x = bx + (path.letters[a * 2] - bx) * e + out * (0.6 * ox / ol + 0.4 * path.blow[a * 2])
      let y = by + (path.letters[a * 2 + 1] - by) * e + out * (0.6 * oy / ol + 0.4 * path.blow[a * 2 + 1])
      x += wobble * Math.sin(t * 0.9 + a * 0.21 + person)
      y += wobble * Math.sin(t * 0.77 + a * 0.17 + 2.1 + person)
      const u = Math.round(Math.min(1, Math.max(0, (x - range.x) / range.z)) * 65535)
      const v = Math.round(Math.min(1, Math.max(0, (y - range.y) / range.w)) * 65535)
      const i = (person * ANCHORS + a) * 4
      data[i] = u >> 8; data[i + 1] = u & 255; data[i + 2] = v >> 8; data[i + 3] = v & 255
      const j = ((PEOPLE + person) * ANCHORS + a) * 4
      data[j] = Math.round(e * 255)
      data[j + 1] = Math.round((1 - e + e * path.ink[a]) * 255)
    }
  }

  const tick = () => {
    if (disposed) return
    raf = requestAnimationFrame(tick)
    const now = performance.now()
    if (now - last < 1000 / fps - 2) return
    const k = Math.min(1, ((now - last) / 1000) * FOLLOW)
    last = now
    for (let i = 0; i < shown.length; i++) shown[i] += (target[i] - shown[i]) * k
    placePeople(now, k)
    const t = (options.now() / 1000) % 3600
    let changed = false
    slots.forEach((slot, person) => {
      const mesh = meshes[person]
      const material = mesh.material as THREE.ShaderMaterial
      mesh.visible = slot.presence > 0.005 && slot.box !== null
      if (!mesh.visible) return
      if (slot.id !== null && slot.box) placeBody(slot, person, k)
      if (!slot.body) { mesh.visible = false; return }
      const stood = (now - slot.since) / 1000
      writeAnchors(slot, person, stood, t)
      // The loops turn on their own as the trembling sets in: by the time stood, so alike on every screen.
      const x = Math.min(1, Math.max(0, (stood - WOBBLE_AFTER) / (WOBBLE_FULL - WOBBLE_AFTER)))
      const turned = (WOBBLE_FULL - WOBBLE_AFTER) * (x * x * x - (x * x * x * x) / 2) + Math.max(0, stood - WOBBLE_FULL)
      material.uniforms.uSpin.value = (turned * 0.9) % (Math.PI * 2)
      material.uniforms.uFade.value = slot.presence
      // Fast at first, then slower, as a hand that has the figure and goes over it again.
      const drawn = 1 - Math.pow(1 - Math.min(1, Math.max(0, stood - 0.4) / DRAW_S), 1.6)
      mesh.geometry.setDrawRange(0, Math.floor(drawn * (POINTS - 1)) * 6)
      changed = true
    })
    if (changed) texture.needsUpdate = true
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
      for (let i = 0; i < target.length; i++) {
        target[i] = cells[i] ? 1 : 0
        if (cells[i]) labels[i] = cells[i]
      }
    },
    setPerson() {},
    debug: () => ({
      webgl: renderer.capabilities.isWebGL2 ? 2 : 1, renderedFps, headLoaded: true, pattern: 'kritzel',
      people: slots.map((s) => (s.id === null ? null : { id: s.id, stood: Math.round((performance.now() - s.since) / 100) / 10 })),
    }),
    dispose() {
      disposed = true
      cancelAnimationFrame(raf)
      observer.disconnect()
      for (const mesh of meshes) {
        mesh.geometry.dispose()
        ;(mesh.material as THREE.ShaderMaterial).dispose()
      }
      texture.dispose()
      renderer.dispose()
    },
  }
}
