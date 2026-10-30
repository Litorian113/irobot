/**
 * Builds X.E.N.O. (src/heads/xeno): a biomechanical creature's head as signed distance fields,
 * meshed with surface nets, with baked occlusion and wear, and rig weights for neck, jaw and the
 * inner jaw. Writes public/models/Xeno.json and .bin. Run: node scripts/build_xeno.mjs
 *
 * Modelled in the pose of the reference photo, which is a profile: +z out of the mouth, y up, x to
 * the side. Most shapes are given in the photo's pixels through at(); see below.
 */
import { writeFileSync } from 'node:fs'

const OUT = new URL('../public/models/', import.meta.url)

// --- small helpers ------------------------------------------------------------------------------
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s]
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const len = (a) => Math.hypot(a[0], a[1], a[2])
const norm = (a) => mul(a, 1 / (len(a) || 1))
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const clamp = (x, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x))
const mix = (a, b, t) => a + (b - a) * t
const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a))
  return t * t * (3 - 2 * t)
}
const smin = (a, b, k) => {
  const h = clamp(0.5 + (0.5 * (b - a)) / k)
  return mix(b, a, h) - k * h * (1 - h)
}
const smax = (a, b, k) => -smin(-a, -b, k)
const hash = (x) => {
  const s = Math.sin(x * 127.1 + 11.7) * 43758.5453
  return s - Math.floor(s)
}
function hash3(x, y, z) {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453
  return s - Math.floor(s)
}
function noise3(x, y, z) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z)
  const f = (t) => t * t * (3 - 2 * t)
  const fx = f(x - ix), fy = f(y - iy), fz = f(z - iz)
  const c = (a, b, d) => hash3(ix + a, iy + b, iz + d)
  return mix(
    mix(mix(c(0, 0, 0), c(1, 0, 0), fx), mix(c(0, 1, 0), c(1, 1, 0), fx), fy),
    mix(mix(c(0, 0, 1), c(1, 0, 1), fx), mix(c(0, 1, 1), c(1, 1, 1), fx), fy),
    fz,
  )
}

/** The photo's pixels to head units: 300 px to a unit, the origin in the middle of the cheek. */
const at = (u, v, x = 0) => [x, (500 - v) / 300, (u - 520) / 300]

// --- the dome: one smooth surface, by profiles along z ------------------------------------------
/** A smooth function through (z, value) keys: cubic, then blurred, so reflections show no kinks. */
function profile(keys) {
  const sorted = [...keys].sort((a, b) => a[0] - b[0])
  const lo = sorted[0][0], hi = sorted[sorted.length - 1][0]
  const N = 2048
  let table = new Float64Array(N)
  for (let i = 0; i < N; i++) {
    const z = lo + ((hi - lo) * i) / (N - 1)
    let s = 0
    while (s < sorted.length - 2 && z > sorted[s + 1][0]) s++
    const [z0, v0] = sorted[s], [z1, v1] = sorted[s + 1]
    const m = (k) => {
      const a = sorted[Math.max(k - 1, 0)], b = sorted[Math.min(k + 1, sorted.length - 1)]
      return (b[1] - a[1]) / (b[0] - a[0])
    }
    const h = z1 - z0, t = (z - z0) / h, t2 = t * t, t3 = t2 * t
    table[i] = (2 * t3 - 3 * t2 + 1) * v0 + (t3 - 2 * t2 + t) * h * m(s) + (-2 * t3 + 3 * t2) * v1 + (t3 - t2) * h * m(s + 1)
  }
  for (let pass = 0; pass < 6; pass++) {
    const blurred = new Float64Array(N)
    const R = 22
    let sum = 0
    for (let i = -R; i <= R; i++) sum += table[clamp(i, 0, N - 1)]
    for (let i = 0; i < N; i++) {
      blurred[i] = sum / (2 * R + 1)
      sum += table[Math.min(i + R + 1, N - 1)] - table[Math.max(i - R, 0)]
    }
    table = blurred
  }
  return (z) => {
    const f = clamp((z - lo) / (hi - lo)) * (N - 1)
    const i = Math.min(Math.floor(f), N - 2)
    return mix(table[i], table[i + 1], f - i)
  }
}

const DOME_FRONT = 1.05
const DOME_BACK = -2.95
const domeTop = profile([[1.05, 0.2], [1.0, 0.33], [0.9, 0.67], [0.6, 1.03], [0.27, 1.25], [-0.07, 1.33], [-0.57, 1.32], [-1.07, 1.12], [-1.43, 0.93], [-1.73, 0.73], [-2.3, 0.42], [-2.95, 0.12]])
const domeRim = profile([[1.05, 0.2], [0.75, 0.25], [0.4, 0.2], [0.13, 0.12], [-0.4, 0.32], [-0.97, 0.5], [-1.73, 0.4], [-2.4, 0.22], [-2.95, 0.1]])
const domeWidth = profile([[1.05, 0.06], [0.95, 0.25], [0.7, 0.39], [0.3, 0.51], [-0.2, 0.61], [-0.9, 0.61], [-1.6, 0.5], [-2.3, 0.3], [-2.8, 0.09], [-2.95, 0.02]])

function dome(p) {
  const z = clamp(p[2], DOME_BACK, DOME_FRONT)
  const rim = domeRim(z)
  const h = Math.max(domeTop(z) - rim, 0.02)
  const w = Math.max(domeWidth(z), 0.02)
  const y = p[1] - rim
  // A flat underside: the shell ends at the rim, the machinery comes out from below it.
  const q = Math.hypot(p[0] / w, y / (y > 0 ? h : 0.09))
  let d = (q - 1) * Math.min(w, h > 0.2 ? h * 0.8 : h)
  d = Math.max(d, p[2] - DOME_FRONT, DOME_BACK - p[2])
  return d
}

// --- tubes: everything else is made of these ----------------------------------------------------
/** A tapering tube along [u, v, x, r] keys in the photo's pixels, optionally ribbed. */
function tube(keys, { k = 0.035, rib = null, world = false } = {}) {
  const key = keys.map(([u, v, x, r]) => (world ? [u, v, x, r] : [...at(u, v, x), r]))
  const points = []
  const STEPS = 6
  for (let i = 0; i < key.length - 1; i++) {
    const a = key[Math.max(i - 1, 0)], b = key[i], c = key[i + 1], d = key[Math.min(i + 2, key.length - 1)]
    for (let s = 0; s < STEPS; s++) {
      const t = s / STEPS, t2 = t * t, t3 = t2 * t
      const interpolate = (n) => 0.5 * (2 * b[n] + (c[n] - a[n]) * t + (2 * a[n] - 5 * b[n] + 4 * c[n] - d[n]) * t2 + (3 * b[n] - a[n] - 3 * c[n] + d[n]) * t3)
      points.push([interpolate(0), interpolate(1), interpolate(2), Math.max(interpolate(3), 0.002)])
    }
  }
  points.push(key[key.length - 1])
  let walked = 0
  const lengths = points.map((pt, i) => {
    if (i) walked += len(sub(pt, points[i - 1]))
    return walked
  })
  const margin = Math.max(...points.map((pt) => pt[3])) * 1.3
  const min = [0, 1, 2].map((i) => Math.min(...points.map((pt) => pt[i])) - margin)
  const max = [0, 1, 2].map((i) => Math.max(...points.map((pt) => pt[i])) + margin)
  return { points, lengths, min, max, k, rib }
}

function tubeDistance(tb, p) {
  const { points, lengths, rib } = tb
  let best = Infinity
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1]
    const ax = p[0] - a[0], ay = p[1] - a[1], az = p[2] - a[2]
    const bx = b[0] - a[0], by = b[1] - a[1], bz = b[2] - a[2]
    const t = clamp((ax * bx + ay * by + az * bz) / (bx * bx + by * by + bz * bz || 1))
    let r = mix(a[3], b[3], t)
    if (rib) {
      const s = mix(lengths[i], lengths[i + 1], t)
      if (s >= rib.from && s <= rib.to) {
        const ring = Math.abs(Math.sin((s * Math.PI) / rib.period))
        r *= 1 + rib.amp * (Math.pow(ring, 0.6) - 0.7)
      }
    }
    const d = Math.hypot(ax - bx * t, ay - by * t, az - bz * t) - r
    if (d < best) best = d
  }
  return best
}

const boxGap = (tb, p) => Math.hypot(Math.max(tb.min[0] - p[0], 0, p[0] - tb.max[0]), Math.max(tb.min[1] - p[1], 0, p[1] - tb.max[1]), Math.max(tb.min[2] - p[2], 0, p[2] - tb.max[2]))

function union(tubes, p, start = 9) {
  let d = start
  for (const tb of tubes) {
    if (boxGap(tb, p) > d + tb.k) continue
    d = smin(d, tubeDistance(tb, p), tb.k)
  }
  return d
}

const ribs = (period, amp, from = 0, to = 99) => ({ period, amp, from, to })

/** The body under the shell, the throat behind the mouth: seen dark through the holes of the cheek. */
const CORE = [
  tube([[-300, 400, 0, 0.25], [0, 430, 0, 0.44], [200, 430, 0, 0.5], [400, 450, 0, 0.42], [560, 480, 0, 0.27], [700, 470, 0, 0.14]], { k: 0.12 }),
  tube([[420, 500, 0, 0.32], [450, 620, 0, 0.3], [480, 720, 0, 0.23], [540, 790, 0, 0.14]], { k: 0.1 }),
]

/** Hoses and lumps on the side of the head, below the rim. */
const HOSES = [
  tube([[-90, 500, 0.44, 0.08], [0, 455, 0.5, 0.085], [110, 400, 0.56, 0.095], [235, 355, 0.55, 0.085], [320, 345, 0.5, 0.05]], { rib: ribs(0.045, 0.2, 0.86, 1.2), k: 0.03 }),
  tube([[110, 470, 0.55, 0.055], [180, 440, 0.6, 0.078], [240, 425, 0.58, 0.06], [300, 440, 0.53, 0.035]], { k: 0.025 }),
  tube([[335, 455, 0.48, 0.06], [420, 470, 0.44, 0.072], [500, 478, 0.4, 0.06], [570, 495, 0.36, 0.034]], { k: 0.03 }),
  tube([[380, 410, 0.47, 0.035], [440, 425, 0.44, 0.048], [480, 450, 0.41, 0.03]], { k: 0.02 }),
  tube([[-60, 420, 0.42, 0.05], [0, 395, 0.5, 0.05], [120, 345, 0.56, 0.04], [260, 305, 0.56, 0.035], [400, 345, 0.53, 0.03], [500, 430, 0.46, 0.025]], { k: 0.025 }),
  tube([[230, 395, 0.59, 0.03], [300, 395, 0.55, 0.036], [360, 420, 0.5, 0.03]], { rib: ribs(0.05, 0.25), k: 0.02 }),
  tube([[250, 470, 0.58, 0.05], [320, 500, 0.52, 0.055], [400, 520, 0.47, 0.04]], { k: 0.03 }),
  tube([[30, 520, 0.52, 0.06], [120, 510, 0.58, 0.07], [210, 520, 0.56, 0.05], [280, 560, 0.52, 0.04]], { k: 0.04 }),
]
for (let i = 0; i < 14; i++) {
  // Small cords and knots packed between the big hoses.
  const u = 120 + hash(i) * 380, v = 400 + hash(i + 40) * 120
  const a = hash(i + 80) * 6.28
  const reach = 22 + hash(i + 120) * 34
  const x = 0.6 - ((u - 120) / 380) * 0.2
  HOSES.push(tube([[u, v, x, 0.014 + hash(i + 160) * 0.016], [u + Math.cos(a) * reach, v + Math.sin(a) * reach * 0.6, x - 0.02, 0.018 + hash(i + 200) * 0.018]], { k: 0.02 }))
}

/** The cheek: sinews from under the lip down to the jaw, with real holes between them. */
const CHEEK = [
  tube([[628, 545, 0.33, 0.028], [603, 620, 0.34, 0.037], [592, 700, 0.35, 0.04], [592, 790, 0.33, 0.04], [625, 860, 0.29, 0.03]], { k: 0.02 }),
  tube([[565, 500, 0.38, 0.03], [552, 590, 0.39, 0.016], [546, 660, 0.38, 0.018], [575, 740, 0.36, 0.02], [592, 780, 0.34, 0.016]], { k: 0.015 }),
  tube([[470, 500, 0.42, 0.04], [430, 590, 0.44, 0.046], [425, 690, 0.43, 0.058], [470, 770, 0.39, 0.052]], { k: 0.025 }),
  tube([[350, 480, 0.47, 0.045], [345, 610, 0.5, 0.05], [390, 690, 0.47, 0.05], [430, 730, 0.43, 0.04]], { k: 0.03 }),
  tube([[340, 640, 0.49, 0.035], [420, 640, 0.44, 0.03], [490, 680, 0.39, 0.024], [545, 690, 0.37, 0.012]], { k: 0.018 }),
  tube([[480, 530, 0.4, 0.018], [520, 610, 0.385, 0.014], [540, 680, 0.37, 0.013]], { k: 0.012 }),
  tube([[430, 590, 0.44, 0.024], [490, 555, 0.4, 0.018], [545, 540, 0.385, 0.012]], { k: 0.015 }),
  tube([[390, 540, 0.45, 0.03], [340, 560, 0.49, 0.036], [300, 620, 0.5, 0.03]], { k: 0.02 }),
  tube([[400, 610, 0.45, 0.016], [370, 670, 0.47, 0.015]], { k: 0.012 }),
  tube([[455, 650, 0.41, 0.014], [510, 720, 0.38, 0.016], [560, 780, 0.35, 0.014]], { k: 0.012 }),
  tube([[440, 740, 0.41, 0.03], [510, 770, 0.37, 0.026], [590, 800, 0.33, 0.024]], { k: 0.022 }),
]

/** Upper lip and gums: an arch in plan, like a horseshoe. */
const GUM = [[676, 512, 0.315, 0.04], [742, 486, 0.25, 0.045], [800, 482, 0.13, 0.045], [826, 486, 0, 0.042]]
const UPPER = [
  tube([[628, 548, 0.34, 0.03], [650, 490, 0.345, 0.034], [700, 440, 0.33, 0.038], [770, 428, 0.24, 0.042], [820, 438, 0.12, 0.044], [836, 450, 0, 0.044]], { k: 0.03 }),
  tube(GUM, { k: 0.05 }),
  // The roof of the mouth and the plate from lip to gum.
  tube([[650, 470, 0.22, 0.09], [730, 455, 0.16, 0.09], [790, 455, 0.07, 0.07], [820, 460, 0, 0.05]], { k: 0.06 }),
  tube([[640, 500, 0.13, 0.1], [560, 500, 0.15, 0.1]], { k: 0.08 }),
]

/** The lower jaw: rim, chin, floor of the mouth. */
const JAW_RIM = [[600, 770, 0.3, 0.028], [640, 835, 0.28, 0.034], [690, 850, 0.2, 0.036], [730, 835, 0.09, 0.036], [740, 826, 0, 0.036]]
const JAW = [
  tube(JAW_RIM, { k: 0.04 }),
  tube([[470, 790, 0.35, 0.07], [540, 860, 0.3, 0.095], [610, 930, 0.21, 0.095], [680, 950, 0.11, 0.085], [700, 948, 0, 0.09]], { k: 0.06 }),
  tube([[600, 868, 0.24, 0.085], [680, 900, 0.14, 0.075], [722, 872, 0, 0.075]], { k: 0.06 }),
  tube([[550, 835, 0.1, 0.09], [640, 880, 0.08, 0.06], [710, 865, 0, 0.04]], { k: 0.08 }),
  tube([[500, 800, 0.33, 0.04], [570, 835, 0.31, 0.03], [625, 870, 0.27, 0.03]], { k: 0.03 }),
  tube([[540, 900, 0.28, 0.02], [600, 960, 0.2, 0.022], [650, 975, 0.13, 0.018]], { k: 0.02 }),
]
/** Pits in the jaw, like the nostrils of a dead thing. */
const PITS = [at(525, 872, 0.37), at(628, 957, 0.21), at(700, 985, 0.03)]

/** Neck: a core, a smooth throat in front, big ringed tubes round the rest. */
const NECK_LINE = (s) => {
  const v = mix(520, 1650, s)
  return [(mix(215, 170, s) - 520) / 300, (500 - v) / 300, mix(0.6, 0.86, s)]
}
const NECK = [
  tube([[250, 480, 0, 0.5], [235, 700, 0, 0.6], [215, 1000, 0, 0.68], [190, 1650, 0, 0.84]], { k: 0.15 }),
  tube([[540, 830, 0, 0.13], [450, 980, 0, 0.3], [330, 1240, 0, 0.42], [240, 1650, 0, 0.56]], { k: 0.14 }),
]
{
  const COUNT = 8
  for (let i = 0; i < COUNT; i++) {
    const phi = 0.86 + (i / (COUNT - 1)) * (Math.PI - 0.86)
    const keys = []
    const top = 0.02 + hash(i + 300) * 0.05
    for (let s = 0; s <= 6; s++) {
      const f = s / 6
      const [z, y, r] = NECK_LINE(mix(top, 1, f))
      const a = phi + Math.sin(f * 7 + i * 1.7) * 0.07
      const out = r * (1.0 + hash(i * 3 + s) * 0.05) * smoothstep(-0.2, 0.15, f + 0.1)
      keys.push([Math.sin(a) * out, y + Math.sin(i * 2.3) * 0.08, z + Math.cos(a) * out, 0.1 + hash(i + 340) * 0.035 + f * 0.04])
    }
    const period = 0.075 + hash(i + 400) * 0.045
    NECK.push(tube(keys.map(([x, y, z, r]) => [x, y, z, r]), { rib: ribs(period, 0.3), k: 0.022, world: true }))
  }
  // Beaded cords in the grooves: vertebrae and tendons.
  for (const [phi, r, top] of [[0.72, 0.042, 0.28], [1.25, 0.03, 0.12], [1.72, 0.03, 0.05]]) {
    const keys = []
    for (let s = 0; s <= 6; s++) {
      const [z, y, ring] = NECK_LINE(mix(top, 1, s / 6))
      const out = ring * 1.14
      keys.push([Math.sin(phi) * out, y, z + Math.cos(phi) * out, r])
    }
    NECK.push(tube(keys, { rib: ribs(0.06, 0.62), k: 0.012, world: true }))
  }
  // Old rings set into the side of the neck.
  for (const [u, v, x] of [[64, 562, 0.63], [266, 815, 0.71], [150, 690, 0.72]]) {
    const keys = []
    for (let i = 0; i <= 12; i++) {
      const a = (i / 12) * Math.PI * 2
      keys.push([u + Math.cos(a) * 30, v + Math.sin(a) * 36, x, 0.03])
    }
    NECK.push(tube(keys, { k: 0.02 }))
  }
}
/** The holes in those rings. */
const RING_HOLES = [at(64, 562, 0.68), at(266, 815, 0.76), at(150, 690, 0.77)]

const INNER = [
  // The throat that carries the second mouth; ringed like a windpipe.
  tube([[505, 770, 0, 0.14], [610, 730, 0, 0.11], [670, 680, 0, 0.088], [710, 655, 0, 0.076]], { rib: ribs(0.05, 0.16), k: 0.02 }),
  tube([[640, 620, 0.12, 0.028], [700, 600, 0.1, 0.03], [745, 606, 0.05, 0.026], [754, 612, 0, 0.026]], { k: 0.03 }),
  tube([[650, 720, 0.11, 0.03], [705, 706, 0.09, 0.03], [745, 692, 0.045, 0.024], [754, 686, 0, 0.024]], { k: 0.03 }),
  tube([[628, 615, 0.08, 0.034], [660, 660, 0.085, 0.05], [646, 722, 0.07, 0.034]], { k: 0.035 }),
  tube([[680, 595, 0.05, 0.024], [640, 610, 0.05, 0.03]], { k: 0.04 }),
]

// --- the fields ---------------------------------------------------------------------------------
const lumps = (p) => 0.016 * (noise3(p[0] * 8, p[1] * 8, p[2] * 8) - 0.5) + 0.009 * (noise3(p[0] * 21, p[1] * 21, p[2] * 21) - 0.5)
const mirror = (p) => [Math.abs(p[0]), p[1], p[2]]

function bio(world) {
  const p = mirror(world)
  let d = union(CORE, p)
  d = union(NECK, p, d)
  for (const hole of RING_HOLES) d = smax(d, 0.042 - Math.hypot(p[0] - hole[0], p[1] - hole[1], p[2] - hole[2]), 0.015)
  // The side of the head and the cheek keep their own shapes: only small seams melt.
  d = union(HOSES, p, d)
  d = union(CHEEK, p, d)
  d = union(UPPER, p, d)
  d = union(JAW, p, d)
  for (const pit of PITS) d = smax(d, 0.034 - Math.hypot(p[0] - pit[0], p[1] - pit[1], p[2] - pit[2]), 0.02)
  return Math.abs(d) < 0.08 ? d + lumps(world) : d
}

function inner(world) {
  const d = union(INNER, mirror(world))
  return Math.abs(d) < 0.05 ? d + lumps(world) * 0.5 : d
}

const everything = (p) => Math.min(dome(p), bio(p), inner(p))

const gradientOf = (field, p, e = 0.006) => norm([
  field([p[0] + e, p[1], p[2]]) - field([p[0] - e, p[1], p[2]]),
  field([p[0], p[1] + e, p[2]]) - field([p[0], p[1] - e, p[2]]),
  field([p[0], p[1], p[2] + e]) - field([p[0], p[1], p[2] - e]),
])

// --- surface nets, sparse: only blocks near the surface are sampled finely -----------------------
const CORNERS = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]]
const EDGES = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]]

function surfaceNets(field, bounds, cell) {
  const [nx, ny, nz] = [0, 1, 2].map((i) => Math.ceil((bounds.max[i] - bounds.min[i]) / cell) + 1)
  const at3 = (x, y, z) => x + nx * (y + ny * z)
  const values = new Float32Array(nx * ny * nz)
  const BLOCK = 8
  const reach = BLOCK * cell * 1.0
  for (let bz = 0; bz < nz; bz += BLOCK) for (let by = 0; by < ny; by += BLOCK) for (let bx = 0; bx < nx; bx += BLOCK) {
    const d = field([bounds.min[0] + (bx + BLOCK / 2) * cell, bounds.min[1] + (by + BLOCK / 2) * cell, bounds.min[2] + (bz + BLOCK / 2) * cell])
    const coarse = Math.abs(d) > reach * 1.2
    for (let z = bz; z < Math.min(bz + BLOCK, nz); z++) for (let y = by; y < Math.min(by + BLOCK, ny); y++) for (let x = bx; x < Math.min(bx + BLOCK, nx); x++) {
      values[at3(x, y, z)] = coarse ? d : field([bounds.min[0] + x * cell, bounds.min[1] + y * cell, bounds.min[2] + z * cell])
    }
  }
  const positions = []
  const indices = []
  const cellVertex = new Int32Array(nx * ny * nz).fill(-1)
  for (let z = 0; z < nz - 1; z++) for (let y = 0; y < ny - 1; y++) for (let x = 0; x < nx - 1; x++) {
    const v = CORNERS.map((c) => values[at3(x + c[0], y + c[1], z + c[2])])
    if (v.every((s) => s < 0) || v.every((s) => s >= 0)) continue
    let sx = 0, sy = 0, sz = 0, count = 0
    for (const [a, b] of EDGES) {
      if (v[a] < 0 === v[b] < 0) continue
      const t = v[a] / (v[a] - v[b])
      sx += mix(CORNERS[a][0], CORNERS[b][0], t)
      sy += mix(CORNERS[a][1], CORNERS[b][1], t)
      sz += mix(CORNERS[a][2], CORNERS[b][2], t)
      count++
    }
    cellVertex[at3(x, y, z)] = positions.length
    positions.push([bounds.min[0] + (x + sx / count) * cell, bounds.min[1] + (y + sy / count) * cell, bounds.min[2] + (z + sz / count) * cell])
  }
  const quad = (a, b, c, d, flip) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return
    if (flip) indices.push(a, c, b, b, c, d)
    else indices.push(a, b, c, b, d, c)
  }
  for (let z = 1; z < nz - 1; z++) for (let y = 1; y < ny - 1; y++) for (let x = 1; x < nx - 1; x++) {
    const inside = values[at3(x, y, z)] < 0
    if (inside !== values[at3(x + 1, y, z)] < 0) quad(cellVertex[at3(x, y - 1, z - 1)], cellVertex[at3(x, y, z - 1)], cellVertex[at3(x, y - 1, z)], cellVertex[at3(x, y, z)], !inside)
    if (inside !== values[at3(x, y + 1, z)] < 0) quad(cellVertex[at3(x - 1, y, z - 1)], cellVertex[at3(x - 1, y, z)], cellVertex[at3(x, y, z - 1)], cellVertex[at3(x, y, z)], !inside)
    if (inside !== values[at3(x, y, z + 1)] < 0) quad(cellVertex[at3(x - 1, y - 1, z)], cellVertex[at3(x, y - 1, z)], cellVertex[at3(x - 1, y, z)], cellVertex[at3(x, y, z)], !inside)
  }
  return { positions, indices }
}

// --- rig and paint -------------------------------------------------------------------------------
const HINGE = at(430, 700)
const LIP_CORNER = at(620, 650)
export const PIVOT = at(250, 640)
const lineDown = norm([0, -(LIP_CORNER[2] - HINGE[2]), LIP_CORNER[1] - HINGE[1]])

function jawWeight(p) {
  const s = dot(sub(p, HINGE), lineDown)
  return smoothstep(-0.17, 0.16, -s) * smoothstep(-0.46, -0.14, p[2]) * smoothstep(-2.4, -1.6, p[1])
}
function bendWeight(p) {
  return mix(0.38, 1, smoothstep(-3.3, -0.85, p[1] + Math.max(p[2], 0) * 1.1))
}
const innerWeight = (p) => smoothstep(0.02, 0.42, p[2])

function occlusion(p, n) {
  let shade = 0
  for (const [h, w] of [[0.025, 1], [0.06, 0.8], [0.13, 0.55], [0.26, 0.4], [0.45, 0.25]]) {
    shade += (w * Math.max(0, h - everything(add(p, mul(n, h))))) / h
  }
  return clamp(1 - shade * 0.4, 0.02, 1)
}
/** Raised edges catch the light and rub pale; 0.5 is flat. */
function wearOf(field, p) {
  let sum = 0
  for (const e of [0.02, 0.05]) {
    let mean = 0
    for (const c of [[e, 0, 0], [-e, 0, 0], [0, e, 0], [0, -e, 0], [0, 0, e], [0, 0, -e]]) mean += field(add(p, c))
    sum += (mean / 6 / e) * 2.2
  }
  return clamp(0.5 + sum)
}

/** kind: 0 machinery, 0.5 shell, 1 tooth. */
const KIND = { bio: 0, dome: 128, tooth: 255 }
const parts = []

function bake(name, field, bounds, cell, kind, keep, rig) {
  const start = Date.now()
  const { positions, indices } = surfaceNets(field, bounds, cell)
  const vertices = positions.map((p) => {
    const n = gradientOf(field, p)
    const ao = occlusion(p, n)
    const wear = kind === 'dome' ? smoothstep(-0.6, -2.2, p[2]) * 0.6 + 0.1 * noise3(p[0] * 2, p[1] * 2, p[2] * 2) : wearOf(field, p)
    return { p, n, ao, wear, kind: KIND[kind], rig: rig(p) }
  })
  const kept = []
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i], b = indices[i + 1], c = indices[i + 2]
    if (keep(positions[a]) || keep(positions[b]) || keep(positions[c])) kept.push(a, b, c)
  }
  parts.push({ vertices, indices: kept })
  console.log(`${name}: ${positions.length} Punkte, ${kept.length / 3} Dreiecke, ${((Date.now() - start) / 1000).toFixed(1)} s`)
}

/** Everything hidden deep inside the shell is left out. */
const headRig = (p) => [bendWeight(p), jawWeight(p), 0]

bake('Kuppel', dome, { min: [-0.72, -0.05, -3.05], max: [0.72, 1.45, 1.15] }, 0.03, 'dome', () => true, () => [1, 0, 0])
const WAIST = -0.9
bake('Kopf', bio, { min: [-0.8, WAIST - 0.06, -1.2], max: [0.8, 0.75, 1.2] }, 0.017, 'bio', (p) => dome(p) > -0.05, headRig)
bake('Hals', bio, { min: [-1.15, -3.7, -1.5], max: [1.15, 0.75, 0.55] }, 0.024, 'bio', (p) => dome(p) > -0.05 && !(p[1] > WAIST && p[2] > -1.15), headRig)
bake('Innerer Kiefer', inner, { min: [-0.3, -1.05, 0.0], max: [0.3, -0.2, 0.95] }, 0.012, 'bio', () => true, (p) => [bendWeight(p), 0, innerWeight(p)])

// --- teeth: real points, too fine for the grid ----------------------------------------------------
function curveThrough(keys) {
  const key = keys.map(([u, v, x]) => at(u, v, x))
  return (t) => {
    const f = clamp(t) * (key.length - 1)
    const i = Math.min(Math.floor(f), key.length - 2)
    const a = key[Math.max(i - 1, 0)], b = key[i], c = key[i + 1], d = key[Math.min(i + 2, key.length - 1)]
    const s = f - i, s2 = s * s, s3 = s2 * s
    return [0, 1, 2].map((n) => 0.5 * (2 * b[n] + (c[n] - a[n]) * s + (2 * a[n] - 5 * b[n] + 4 * c[n] - d[n]) * s2 + (3 * b[n] - a[n] - 3 * c[n] + d[n]) * s3))
  }
}

function tooth(base, tipDir, length, radius, curl, rig) {
  const RINGS = 7, SIDES = 7
  const vertices = [], indices = []
  const along = norm(tipDir)
  const side = norm(cross(along, Math.abs(along[0]) > 0.9 ? [0, 1, 0] : [1, 0, 0]))
  const up = cross(side, along)
  const centre = (t) => add(add(base, mul(along, length * t)), mul(curl, length * 0.26 * t * t))
  for (let r = 0; r <= RINGS; r++) {
    const t = r / RINGS
    const c = centre(t)
    const forward = norm(sub(centre(Math.min(t + 0.05, 1.02)), centre(Math.max(t - 0.05, -0.02))))
    const size = radius * Math.pow(1 - t, 0.72) * (1 + 0.14 * (1 - t))
    for (let s = 0; s < SIDES; s++) {
      const a = (s / SIDES) * Math.PI * 2
      const out = add(mul(side, Math.cos(a)), mul(up, Math.sin(a) * 0.72))
      const p = add(c, mul(out, size))
      const n = norm(add(out, mul(forward, 0.45)))
      vertices.push({ p, n, ao: mix(0.05, 1, smoothstep(0, 0.34, t)), wear: smoothstep(0.1, 0.8, t), kind: KIND.tooth, rig: rig(base) })
    }
  }
  for (let r = 0; r < RINGS; r++) for (let s = 0; s < SIDES; s++) {
    const a = r * SIDES + s, b = r * SIDES + (s + 1) % SIDES, c = a + SIDES, d = b + SIDES
    indices.push(a, b, c, b, d, c)
  }
  // The winding must face out, whichever way the tooth points.
  const first = vertices[SIDES], ab = sub(vertices[SIDES + 1].p, first.p), ac = sub(vertices[SIDES * 2].p, first.p)
  if (dot(cross(ab, ac), first.n) < 0) for (let i = 0; i < indices.length; i += 3) [indices[i + 1], indices[i + 2]] = [indices[i + 2], indices[i + 1]]
  return { vertices, indices }
}

function teethRow(gumKeys, count, { length, radius, dir, curl, rig, tiltOut = 0.15, seed = 0 }) {
  const curve = curveThrough(gumKeys)
  for (const sign of [1, -1]) {
    for (let i = 0; i < count; i++) {
      const t = (i + 0.5) / count
      const c = curve(t)
      const base = [sign * Math.max(c[0], 0.012 + 0.0), c[1], c[2]]
      if (i === count - 1) base[0] = sign * 0.03
      const wobble = hash(i * 7 + seed + (sign > 0 ? 0 : 31))
      const size = length(t) * (0.82 + wobble * 0.32)
      const direction = [sign * tiltOut * (0.4 + c[0] * 2), dir[1], dir[2] + (wobble - 0.5) * 0.2]
      parts.push(tooth(base, direction, size, radius(t) * (0.9 + wobble * 0.2), [sign * curl[0], curl[1], curl[2]], rig))
    }
  }
}

const upperRig = (p) => [1, jawWeight(p) * 0.1, 0]
const lowerRig = (p) => [bendWeight(p), 1, 0]
const innerRig = () => [1, 0, 1]

// The big upper teeth: long in front, smaller towards the corners.
teethRow(GUM, 9, {
  length: (t) => mix(0.17, 0.3, smoothstep(0.1, 0.8, t)), radius: (t) => mix(0.028, 0.044, t),
  dir: [0, -1, -0.12], curl: [0, 0, -0.5], rig: upperRig, tiltOut: 0.05,
})
teethRow(JAW_RIM.map(([u, v, x]) => [u, v - 6, x]), 9, {
  length: (t) => mix(0.13, 0.22, smoothstep(0.1, 0.9, t)), radius: (t) => mix(0.024, 0.036, t),
  dir: [0, 1, 0.12], curl: [0, 0, -0.5], rig: lowerRig, tiltOut: 0.08, seed: 50,
})
teethRow([[640, 618, 0.12], [700, 604, 0.1], [745, 610, 0.05], [754, 616, 0]], 6, {
  length: (t) => mix(0.05, 0.12, smoothstep(0.2, 0.9, t)), radius: (t) => mix(0.012, 0.018, t),
  dir: [0, -1, 0.05], curl: [0, 0, -0.5], rig: innerRig, tiltOut: 0.05, seed: 100,
})
teethRow([[650, 716, 0.11], [705, 702, 0.09], [745, 688, 0.045], [754, 682, 0]], 6, {
  length: (t) => mix(0.05, 0.11, smoothstep(0.2, 0.9, t)), radius: (t) => mix(0.012, 0.017, t),
  dir: [0, 1, 0.12], curl: [0, 0, -0.5], rig: innerRig, tiltOut: 0.05, seed: 150,
})

// --- write: chunks of at most 65535 points, because the iMacs have 16-bit indices ------------------
const byte = (v) => Math.round(clamp(v) * 255)
const chunks = []
{
  let current = null
  const flush = () => {
    if (current?.index.length) chunks.push(current)
    current = null
  }
  for (const part of parts) {
    const map = new Int32Array(part.vertices.length).fill(-1)
    const stamp = new Int32Array(part.vertices.length).fill(-1)
    for (let i = 0; i < part.indices.length; i += 3) {
      if (!current || current.vertices.length + 3 > 65535) {
        flush()
        current = { vertices: [], index: [], id: chunks.length }
      }
      for (let k = 0; k < 3; k++) {
        const v = part.indices[i + k]
        if (stamp[v] !== current.id || map[v] < 0) {
          stamp[v] = current.id
          map[v] = current.vertices.length
          current.vertices.push(part.vertices[v])
        }
        current.index.push(map[v])
      }
    }
  }
  flush()
}
const blobs = []
const pad = (buffer) => {
  blobs.push(buffer)
  const rest = buffer.length % 4
  if (rest) blobs.push(Buffer.alloc(4 - rest))
}
let totalVertices = 0, totalIndices = 0
for (const chunk of chunks) {
  const n = chunk.vertices.length
  totalVertices += n
  totalIndices += chunk.index.length
  const position = new Float32Array(n * 3)
  const normal = new Int16Array(n * 3)
  const paint = new Uint8Array(n * 4)
  const rig = new Uint8Array(n * 4)
  chunk.vertices.forEach((v, i) => {
    position.set(v.p, i * 3)
    normal.set(v.n.map((c) => Math.round(c * 32767)), i * 3)
    paint.set([byte(v.ao), byte(v.wear), v.kind, 255], i * 4)
    rig.set([byte(v.rig[0]), byte(v.rig[1]), byte(v.rig[2]), 255], i * 4)
  })
  const index = new Uint16Array(chunk.index)
  for (const array of [position, normal, paint, rig, index]) pad(Buffer.from(array.buffer, array.byteOffset, array.byteLength))
}
writeFileSync(new URL('Xeno.bin', OUT), Buffer.concat(blobs))
const round = (v) => v.map((c) => Number(c.toFixed(4)))
writeFileSync(new URL('Xeno.json', OUT), JSON.stringify({
  chunks: chunks.map((c) => ({ vertices: c.vertices.length, indices: c.index.length })),
  hinge: round(HINGE),
  pivot: round(PIVOT),
}) + '\n')
console.log(`${chunks.length} Teile, ${totalVertices} Punkte, ${totalIndices / 3} Dreiecke`)
