/**
 * Builds the hand of H.Ä.N.D.C.H.E.N. (src/heads/haendchen): a signed distance field of a right
 * hand, meshed with surface nets, with bone weights, stitches as real thread and baked shading.
 * Writes public/models/Haendchen.json and .bin. Run: node scripts/build_haendchen.mjs
 *
 * The hand as modelled: fingers down (-y), wrist cut off at the top, back of the hand towards +z,
 * thumb on +x. A flex about +x bends a finger towards the palm (-z).
 */
import { writeFileSync } from 'node:fs'

const OUT = new URL('../public/models/', import.meta.url)
const CELL = 0.024
const BOUNDS = { min: [-1.35, -2.3, -1.05], max: [1.55, 1.6, 0.75] }
const STUMP_TOP = 1.42

// --- small vector helpers -----------------------------------------------------------------------
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s]
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const len = (a) => Math.hypot(a[0], a[1], a[2])
const norm = (a) => mul(a, 1 / (len(a) || 1))
const crossV = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const clamp = (x, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x))
const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a))
  return t * t * (3 - 2 * t)
}
const mix = (a, b, t) => a + (b - a) * t
const mixV = (a, b, t) => a.map((v, i) => mix(v, b[i], t))
const rad = (d) => (d * Math.PI) / 180
function rotate(v, axis, angle) {
  const c = Math.cos(angle), s = Math.sin(angle)
  return add(add(mul(v, c), mul(crossV(axis, v), s)), mul(axis, dot(axis, v) * (1 - c)))
}
const smin = (a, b, k) => {
  const h = clamp(0.5 + (0.5 * (b - a)) / k)
  return mix(b, a, h) - k * h * (1 - h)
}
const smax = (a, b, k) => -smin(-a, -b, k)

function hash3(x, y, z) {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453
  return s - Math.floor(s)
}
function noise3(x, y, z) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z)
  const f = (t) => t * t * (3 - 2 * t)
  const fx = f(x - ix), fy = f(y - iy), fz = f(z - iz)
  const at = (a, b, c) => hash3(ix + a, iy + b, iz + c)
  return mix(
    mix(mix(at(0, 0, 0), at(1, 0, 0), fx), mix(at(0, 1, 0), at(1, 1, 0), fx), fy),
    mix(mix(at(0, 0, 1), at(1, 0, 1), fx), mix(at(0, 1, 1), at(1, 1, 1), fx), fy),
    fz,
  )
}

// --- the skeleton -------------------------------------------------------------------------------
const FINGERS = [
  { name: 'index', at: [0.47, -0.66, 0.0], lengths: [0.62, 0.4, 0.3], r: [0.14, 0.13, 0.12, 0.108], splay: 8 },
  { name: 'middle', at: [0.16, -0.72, 0.01], lengths: [0.68, 0.46, 0.31], r: [0.145, 0.133, 0.122, 0.11], splay: 2 },
  { name: 'ring', at: [-0.15, -0.69, 0.0], lengths: [0.63, 0.43, 0.3], r: [0.138, 0.127, 0.117, 0.105], splay: -4 },
  { name: 'pinky', at: [-0.42, -0.6, -0.02], lengths: [0.48, 0.31, 0.26], r: [0.122, 0.11, 0.1, 0.09], splay: -12 },
]
/** The pose it is modelled in: half bent, so bending either way asks little of the skin. */
const REST_FLEX = [25, 20, 10].map(rad)
const THUMB = { at: [0.44, 0.3, -0.08], dir: norm([0.42, -0.82, -0.38]), lengths: [0.5, 0.44, 0.36], r: [0.205, 0.17, 0.15, 0.122] }

/** Bones: index 0 is the palm and wrist. `tip`, `dorsal` and radii are for the mesh only. */
const bones = [{ name: 'root', parent: -1, joint: [0, 0, 0], hinge: [1, 0, 0] }]
for (const finger of FINGERS) {
  const hinge = rotate([1, 0, 0], [0, 0, 1], rad(finger.splay))
  let dir = rotate([0, -1, 0], [0, 0, 1], rad(finger.splay))
  let joint = finger.at
  let parent = 0
  let flex = 0
  finger.lengths.forEach((length, i) => {
    flex += REST_FLEX[i]
    const d = rotate(dir, hinge, flex)
    const tip = add(joint, mul(d, length))
    bones.push({ name: `${finger.name}${i}`, parent, joint, tip, dir: d, length, r0: finger.r[i], r1: finger.r[i + 1], hinge, dorsal: norm(crossV(d, hinge)), last: i === 2 })
    parent = bones.length - 1
    joint = tip
  })
}
{
  const hinge = norm(crossV([0.35, 0.1, 0.93], THUMB.dir))
  let joint = THUMB.at
  let parent = 0
  let flex = 0
  THUMB.lengths.forEach((length, i) => {
    flex += [0, 10, 12][i] * (Math.PI / 180)
    const d = rotate(THUMB.dir, hinge, flex)
    const tip = add(joint, mul(d, length))
    bones.push({ name: `thumb${i}`, parent, joint, tip, dir: d, length, r0: THUMB.r[i], r1: THUMB.r[i + 1], hinge, dorsal: norm(crossV(d, hinge)), last: i === 2 })
    parent = bones.length - 1
    joint = tip
  })
}
const limbs = bones.slice(1)
/** The stump bends against the palm: it stands upright while the back of the hand slopes. */
const WRIST = bones.length
bones.push({ name: 'wrist', parent: 0, joint: [0, 0.66, 0], hinge: [1, 0, 0] })

// --- the seams (x, y as seen from the side they are on) ------------------------------------------
const SEAMS = [
  { side: 1, path: [[0.0, -0.02], [0.17, 0.13], [0.38, 0.2], [0.54, 0.13]] },
  { side: 1, path: [[-0.04, -0.58], [0.05, -0.42], [0.24, -0.31], [0.44, -0.33], [0.62, -0.5]] },
  { side: 1, path: [[-0.53, 0.2], [-0.48, 0.02], [-0.38, -0.22], [-0.24, -0.48], [-0.17, -0.68]] },
  { side: -1, path: [[-0.46, 0.3], [-0.2, 0.42], [0.08, 0.42], [0.24, 0.5]] },
  { side: -1, path: [[0.34, -1.0], [0.56, -1.02]] },
  { side: -1, path: [[-0.52, 0.68], [-0.32, 0.72], [-0.14, 0.7]] },
]
/** The lines of a palm: only pressed in, no thread. */
const CREASES = [
  { side: -1, path: [[0.5, -0.32], [0.22, -0.2], [0.05, 0.05], [-0.02, 0.32], [-0.02, 0.52]] },
  { side: -1, path: [[-0.54, -0.28], [-0.2, -0.38], [0.14, -0.42], [0.42, -0.5]] },
  { side: -1, path: [[-0.5, -0.1], [-0.2, -0.14], [0.08, -0.02], [0.3, 0.2]] },
]

function distanceToPath(x, y, path) {
  let best = 9
  for (let i = 0; i < path.length - 1; i++) {
    const [ax, ay] = path[i], [bx, by] = path[i + 1]
    const dx = bx - ax, dy = by - ay
    const t = clamp(((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy))
    best = Math.min(best, Math.hypot(x - ax - dx * t, y - ay - dy * t))
  }
  return best
}

// --- the shape ----------------------------------------------------------------------------------
function ellipsoid(p, c, r) {
  const q = [(p[0] - c[0]) / r[0], (p[1] - c[1]) / r[1], (p[2] - c[2]) / r[2]]
  const l = len(q)
  return (l - 1) * Math.min(r[0], r[1], r[2])
}
function capsule(p, a, b, ra, rb) {
  const ab = sub(b, a)
  const t = clamp(dot(sub(p, a), ab) / dot(ab, ab))
  return len(sub(p, add(a, mul(ab, t)))) - mix(ra, rb, t)
}

/** The flat of the hand, which stays put whatever the thumb does. */
function palmBody(p) {
  const narrow = 0.84 + 0.16 * smoothstep(0.75, -0.45, p[1])
  const x = p[0] / narrow
  const z = p[2] - 0.07 * (1 - Math.min(1, (x / 0.62) ** 2))
  const qx = Math.abs(x) - 0.5, qy = Math.abs(p[1] + 0.03) - 0.6, qz = Math.abs(z) - 0.1
  const box = Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0) - 0.15
  return box * narrow
}

function palm(p) {
  let d = palmBody(p)
  d = smin(d, ellipsoid(p, [0.32, 0.14, -0.15], [0.3, 0.46, 0.19]), 0.1)
  d = smin(d, ellipsoid(p, [-0.38, 0.06, -0.12], [0.2, 0.48, 0.16]), 0.1)
  d = smin(d, capsule(p, [-0.44, -0.54, -0.1], [0.46, -0.58, -0.1], 0.13, 0.13), 0.1)
  return d
}

function wrist(p) {
  const flare = 0.03 * smoothstep(1.0, STUMP_TOP, p[1]) + 0.04 * smoothstep(0.75, 0.45, p[1])
  const side = Math.hypot(p[0], p[2] * 1.45) - 0.42 - flare
  return smax(smax(side, p[1] - STUMP_TOP, 0.06), 0.4 - p[1], 0.05)
}

function baseShape(p) {
  let d = smin(palm(p), wrist(p), 0.3)
  // Tendons and the bones of the knuckles on the back of the hand.
  for (let i = 0; i < 4; i++) {
    const at = FINGERS[i].at
    d = smin(d, capsule(p, [at[0] * 0.5, 0.22, 0.17], [at[0], at[1] + 0.08, 0.2], 0.035, 0.05), 0.09)
    d = smin(d, ellipsoid(p, [at[0], at[1] - 0.02, at[2] + 0.07], [0.15, 0.15, 0.14]), 0.07)
  }
  // A vein that wanders over the back of the hand.
  d = smin(d, capsule(p, [0.18, 0.62, 0.26], [0.08, 0.2, 0.26], 0.026, 0.03), 0.07)
  d = smin(d, capsule(p, [0.08, 0.2, 0.25], [-0.14, -0.2, 0.25], 0.03, 0.025), 0.07)
  // The fingers only melt into the palm, not into each other.
  let fingers = 9
  for (let f = 0; f < 5; f++) {
    const chain = limbs.slice(f * 3, f * 3 + 3)
    let finger = capsule(p, chain[0].joint, chain[0].tip, chain[0].r0, chain[0].r1)
    for (let i = 1; i < 3; i++) finger = smin(finger, capsule(p, chain[i].joint, chain[i].tip, chain[i].r0, chain[i].r1), 0.025)
    // Knuckles that stand out a little.
    for (let i = 1; i < 3; i++) {
      const b = chain[i]
      finger = smin(finger, len(sub(p, add(b.joint, mul(b.dorsal, 0.02)))) - b.r0 * 0.99, 0.05)
    }
    if (f < 4) fingers = Math.min(fingers, finger)
    else d = smin(d, finger, 0.16)
  }
  return smin(d, fingers, 0.09)
}

function sdf(p) {
  const base = baseShape(p)
  if (Math.abs(base) > 0.09) return base
  let d = base
  // Puckered where it was sewn shut.
  const angle = Math.atan2(p[2], p[0])
  d += 0.012 * Math.cos(angle * 26) * smoothstep(STUMP_TOP - 0.16, STUMP_TOP - 0.03, p[1]) * smoothstep(0.26, 0.38, Math.hypot(p[0], p[2]))
  d += 0.02 * smoothstep(0.34, 0.0, Math.hypot(p[0], p[2])) * smoothstep(STUMP_TOP - 0.05, STUMP_TOP, p[1])
  for (const seam of SEAMS) {
    if (p[2] * seam.side < 0) continue
    d += 0.016 * Math.exp(-((distanceToPath(p[0], p[1], seam.path) / 0.035) ** 2))
  }
  for (const crease of CREASES) {
    if (p[2] * crease.side < 0) continue
    d += 0.014 * Math.exp(-((distanceToPath(p[0], p[1], crease.path) / 0.028) ** 2))
  }
  // Lumps and folds at a size the mesh can carry; the fine lines are drawn in the shader.
  d += 0.01 * (noise3(p[0] * 7, p[1] * 7, p[2] * 7) - 0.5)
  return d
}

function gradient(p) {
  const e = 0.012
  return norm([
    sdf([p[0] + e, p[1], p[2]]) - sdf([p[0] - e, p[1], p[2]]),
    sdf([p[0], p[1] + e, p[2]]) - sdf([p[0], p[1] - e, p[2]]),
    sdf([p[0], p[1], p[2] + e]) - sdf([p[0], p[1], p[2] - e]),
  ])
}

// --- surface nets -------------------------------------------------------------------------------
const size = [0, 1, 2].map((i) => Math.ceil((BOUNDS.max[i] - BOUNDS.min[i]) / CELL) + 1)
const [nx, ny, nz] = size
const field = new Float32Array(nx * ny * nz)
const at = (x, y, z) => x + nx * (y + ny * z)
for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
  field[at(x, y, z)] = sdf([BOUNDS.min[0] + x * CELL, BOUNDS.min[1] + y * CELL, BOUNDS.min[2] + z * CELL])
}

const positions = []
const indices = []
const cellVertex = new Int32Array(nx * ny * nz).fill(-1)
const CORNERS = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]]
const EDGES = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]]
for (let z = 0; z < nz - 1; z++) for (let y = 0; y < ny - 1; y++) for (let x = 0; x < nx - 1; x++) {
  const values = CORNERS.map((c) => field[at(x + c[0], y + c[1], z + c[2])])
  if (values.every((v) => v < 0) || values.every((v) => v >= 0)) continue
  let sum = [0, 0, 0], count = 0
  for (const [a, b] of EDGES) {
    if (values[a] < 0 === values[b] < 0) continue
    const t = values[a] / (values[a] - values[b])
    sum = add(sum, mixV(CORNERS[a], CORNERS[b], t))
    count++
  }
  cellVertex[at(x, y, z)] = positions.length
  positions.push([
    BOUNDS.min[0] + (x + sum[0] / count) * CELL,
    BOUNDS.min[1] + (y + sum[1] / count) * CELL,
    BOUNDS.min[2] + (z + sum[2] / count) * CELL,
  ])
}
function quad(a, b, c, d, flip) {
  if (a < 0 || b < 0 || c < 0 || d < 0) return
  if (flip) indices.push(a, c, b, b, c, d)
  else indices.push(a, b, c, b, d, c)
}
for (let z = 1; z < nz - 1; z++) for (let y = 1; y < ny - 1; y++) for (let x = 1; x < nx - 1; x++) {
  const inside = field[at(x, y, z)] < 0
  if (inside !== field[at(x + 1, y, z)] < 0) quad(cellVertex[at(x, y - 1, z - 1)], cellVertex[at(x, y, z - 1)], cellVertex[at(x, y - 1, z)], cellVertex[at(x, y, z)], !inside)
  if (inside !== field[at(x, y + 1, z)] < 0) quad(cellVertex[at(x - 1, y, z - 1)], cellVertex[at(x - 1, y, z)], cellVertex[at(x, y, z - 1)], cellVertex[at(x, y, z)], !inside)
  if (inside !== field[at(x, y, z + 1)] < 0) quad(cellVertex[at(x - 1, y - 1, z)], cellVertex[at(x, y - 1, z)], cellVertex[at(x - 1, y, z)], cellVertex[at(x, y, z)], !inside)
}
const surfaceVertices = positions.length

// --- which bones move a point -------------------------------------------------------------------
const BLEND = 0.085
const BONES = bones.length
/** First guess of a point's weights over all bones; the mesh smooths them below. */
function skin(p) {
  const v = new Float32Array(BONES)
  let best = null, bestD = 9
  limbs.forEach((b) => {
    const t = clamp(dot(sub(p, b.joint), b.dir) / b.length)
    const d = len(sub(p, add(b.joint, mul(b.dir, b.length * t)))) - mix(b.r0, b.r1, t)
    if (d < bestD) { bestD = d; best = b }
  })
  const index = bones.indexOf(best)
  const along = dot(sub(p, best.joint), best.dir)
  const isThumb = best.name.startsWith('thumb')
  const child = best.last ? null : bones[index + 1]
  // How much of the point belongs to this limb at all, and not to the palm under it.
  let limb = 1 - (isThumb ? smoothstep(0.02, 0.34, bestD) : smoothstep(0.03, 0.2, bestD))
  if (best.parent === 0) limb *= isThumb ? smoothstep(-0.05, 0.32, along) : smoothstep(-0.14, 0.1, along)
  // The thumb moves itself and its ball, not the flat of the hand it folds over.
  if (isThumb) limb *= smoothstep(-0.03, 0.13, palmBody(p))
  const childPart = child ? smoothstep(-BLEND, BLEND, dot(sub(p, child.joint), child.dir)) : 0
  const parentPart = best.parent > 0 ? 1 - smoothstep(-BLEND, BLEND, along) : 0
  v[index] += limb * (1 - childPart - parentPart * (1 - childPart))
  if (child) v[index + 1] += limb * childPart
  if (best.parent > 0) v[best.parent] += limb * parentPart * (1 - childPart)
  const stump = smoothstep(0.42, 0.9, p[1])
  v[0] += (1 - limb) * (1 - stump)
  v[WRIST] += (1 - limb) * stump
  return v
}

const surfaceWeights = positions.map(skin)
{
  const neighbours = positions.map(() => new Set())
  for (let i = 0; i < indices.length; i += 3) {
    const [a, b, c] = [indices[i], indices[i + 1], indices[i + 2]]
    neighbours[a].add(b).add(c)
    neighbours[b].add(a).add(c)
    neighbours[c].add(a).add(b)
  }
  const thumbBase = limbs[12]
  const nearThumb = positions.map((p) => {
    const t = clamp(dot(sub(p, thumbBase.joint), thumbBase.dir) / thumbBase.length)
    return len(sub(p, add(thumbBase.joint, mul(thumbBase.dir, thumbBase.length * t)))) < 0.6
  })
  // Around the thumb's root the skin has far to stretch: it gets many more rounds.
  for (let pass = 0; pass < 18; pass++) {
    const next = surfaceWeights.map((w, i) => {
      if (pass >= 4 && !nearThumb[i]) return w
      const out = new Float32Array(BONES)
      for (const j of neighbours[i]) for (let b = 0; b < BONES; b++) out[b] += surfaceWeights[j][b]
      const n = neighbours[i].size || 1
      for (let b = 0; b < BONES; b++) out[b] = out[b] / n * 0.6 + w[b] * 0.4
      return out
    })
    surfaceWeights.splice(0, surfaceWeights.length, ...next)
  }
}
/** The three strongest bones of a point, as bones and weights. */
function strongest(v) {
  const order = [...v.keys()].sort((a, b) => v[b] - v[a]).slice(0, 3)
  const sum = order.reduce((total, b) => total + v[b], 0) || 1
  return { bones: order, weights: order.map((b) => v[b] / sum) }
}
const lookup = new Map()
const keyOf = (p) => `${Math.floor(p[0] / 0.08)},${Math.floor(p[1] / 0.08)},${Math.floor(p[2] / 0.08)}`
positions.forEach((p, i) => {
  const key = keyOf(p)
  if (!lookup.has(key)) lookup.set(key, [])
  lookup.get(key).push(i)
})
function nearestSurface(p) {
  let best = 0, bestD = 9
  for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) {
    for (const i of lookup.get(keyOf([p[0] + x * 0.08, p[1] + y * 0.08, p[2] + z * 0.08])) ?? []) {
      const d = len(sub(p, positions[i]))
      if (d < bestD) { bestD = d; best = i }
    }
  }
  return best
}

// --- colour -------------------------------------------------------------------------------------
const SKIN = [0.71, 0.63, 0.59]
const BRUISE = [0.5, 0.39, 0.43]
const OCHRE = [0.68, 0.58, 0.46]
const RED = [0.54, 0.34, 0.38]
const THREAD = [0.05, 0.04, 0.06]
function ambient(p, n) {
  let occlusion = 0
  for (const [h, w] of [[0.05, 1], [0.14, 0.6], [0.3, 0.35]]) occlusion += (w * Math.max(0, h - sdf(add(p, mul(n, h))))) / h
  return clamp(1 - occlusion * 0.42, 0.2, 1)
}
function skinColor(p, n) {
  const blotch = noise3(p[0] * 3.1, p[1] * 3.1, p[2] * 3.1) * 0.6 + noise3(p[0] * 8, p[1] * 8, p[2] * 8) * 0.4
  const warm = noise3(p[0] * 2.3 + 5, p[1] * 2.3, p[2] * 2.3)
  let c = mixV(SKIN, BRUISE, smoothstep(0.45, 0.75, blotch) * 0.6)
  c = mixV(c, OCHRE, smoothstep(0.5, 0.78, warm) * 0.5)
  let wrinkle = 0.28
  let nail = 0
  for (const b of limbs) {
    if (b.parent > 0) {
      // Knuckles: red and full of folds.
      const fromJoint = len(sub(p, b.joint))
      const near = 1 - smoothstep(b.r0 * 0.7, b.r0 * 1.7, fromJoint)
      c = mixV(c, RED, near * 0.6)
      wrinkle = Math.max(wrinkle, near)
    }
    if (b.last) {
      const local = sub(p, b.joint)
      const along = dot(local, b.dir) / b.length
      const across = Math.abs(dot(local, crossV(b.dorsal, b.dir))) / b.r1
      const above = dot(local, b.dorsal) / b.r1
      c = mixV(c, BRUISE, smoothstep(0.55, 1.2, along) * (1 - smoothstep(0.1, 0.4, len(sub(p, b.tip)))) * 0.8)
      if (above > 0.2) nail = Math.max(nail, clamp(0.5 + 1.6 * (1 - Math.hypot((along - 0.8) / 0.4, across / 0.82))))
    }
  }
  // MCP knuckles on the back of the hand.
  for (const f of FINGERS) {
    const near = 1 - smoothstep(0.08, 0.26, len(sub(p, add(f.at, [0, -0.02, 0.15]))))
    c = mixV(c, RED, near * 0.35)
    wrinkle = Math.max(wrinkle, near * 0.7)
  }
  // The cut, and the stump's darker skin near it.
  c = mixV(c, BRUISE, smoothstep(STUMP_TOP - 0.12, STUMP_TOP, p[1]) * 0.8)
  if (n[1] > 0.5 && p[1] > STUMP_TOP - 0.08) c = mixV(c, [0.32, 0.2, 0.24], 0.85)
  return { color: c, wrinkle, nail }
}

// --- thread -------------------------------------------------------------------------------------
function projectAlongZ(x, y, side) {
  let z = side > 0 ? BOUNDS.max[2] : BOUNDS.min[2]
  for (let i = 0; i < 80; i++) {
    const d = sdf([x, y, z])
    if (d < 0.001) break
    z -= side * d
    if (z > BOUNDS.max[2] || z < BOUNDS.min[2]) return null
  }
  return [x, y, z]
}
const onSurface = (p) => {
  let q = p
  for (let i = 0; i < 6; i++) q = sub(q, mul(gradient(q), sdf(q)))
  return q
}
const threadVertices = []
const threadNormals = []
const threadSkin = []
const threadIndices = []
function tube(points, radius) {
  const SIDES = 5
  const start = surfaceVertices + threadVertices.length
  // A thread follows one place on the hand: split between two fingers it would be pulled into a spike.
  const place = strongest(surfaceWeights[nearestSurface(points[points.length >> 1])])
  let previous = [0.31, 0.77, 0.56]
  points.forEach((point, i) => {
    const forward = norm(sub(points[Math.min(i + 1, points.length - 1)], points[Math.max(i - 1, 0)]))
    const u = norm(crossV(forward, previous))
    const v = crossV(u, forward)
    previous = v
    for (let s = 0; s < SIDES; s++) {
      const a = (s / SIDES) * Math.PI * 2
      const out = add(mul(u, Math.cos(a)), mul(v, Math.sin(a)))
      threadVertices.push(add(point, mul(out, radius)))
      threadNormals.push(out)
      threadSkin.push(place)
    }
  })
  for (let i = 0; i < points.length - 1; i++) for (let s = 0; s < SIDES; s++) {
    const a = start + i * SIDES + s, b = start + i * SIDES + (s + 1) % SIDES
    const c = a + SIDES, d = b + SIDES
    threadIndices.push(a, c, b, b, c, d)
  }
  for (const [ring, flip] of [[0, true], [points.length - 1, false]]) {
    for (let s = 1; s < SIDES - 1; s++) {
      const base = start + ring * SIDES
      if (flip) threadIndices.push(base, base + s + 1, base + s)
      else threadIndices.push(base, base + s, base + s + 1)
    }
  }
}
/** A short thread lying on the surface between two surface points. */
function stitch(a, b, radius, lift = 0.008) {
  const points = []
  for (let i = 0; i <= 4; i++) {
    const on = onSurface(mixV(a, b, i / 4))
    const humped = lift + 0.012 * Math.sin((i / 4) * Math.PI)
    points.push(add(on, mul(gradient(on), humped)))
  }
  tube(points, radius)
}
function sewPath(samples, spacing) {
  const running = []
  for (const s of samples) running.push(s)
  for (let i = 0; i < running.length - 1; i++) stitch(running[i], running[i + 1], 0.0095)
  // The cross stitches over it.
  let walked = spacing / 2
  for (let i = 0; i < running.length - 1; i++) {
    const step = len(sub(running[i + 1], running[i]))
    while (walked < step) {
      const c = mixV(running[i], running[i + 1], walked / step)
      const on = onSurface(c)
      const across = norm(crossV(gradient(on), sub(running[i + 1], running[i])))
      const reach = 0.042 + 0.012 * hash3(c[0], c[1], c[2])
      stitch(add(on, mul(across, -reach)), add(on, mul(across, reach)), 0.0115)
      walked += spacing
    }
    walked -= step
  }
}
function subdivide(path, side) {
  const out = []
  for (let i = 0; i < path.length - 1; i++) {
    const steps = Math.max(2, Math.round(Math.hypot(path[i + 1][0] - path[i][0], path[i + 1][1] - path[i][1]) / 0.05))
    for (let s = 0; s < steps; s++) {
      const t = s / steps
      const p = projectAlongZ(mix(path[i][0], path[i + 1][0], t), mix(path[i][1], path[i + 1][1], t), side)
      if (p) out.push(p)
    }
  }
  const last = path[path.length - 1]
  const p = projectAlongZ(last[0], last[1], side)
  if (p) out.push(p)
  return out
}
for (const seam of SEAMS) sewPath(subdivide(seam.path, seam.side), 0.105)
// Round the cut of the stump.
{
  const ring = []
  for (let i = 0; i <= 56; i++) {
    const a = (i / 56) * Math.PI * 2
    ring.push(onSurface([Math.cos(a) * 0.45, STUMP_TOP - 0.05, (Math.sin(a) * 0.45) / 1.45]))
  }
  sewPath(ring, 0.125)
}
// A dark line across the thumb, as on the prop.
{
  const b = limbs[13]
  const c = add(b.joint, mul(b.dir, b.length * 0.4))
  const across = crossV(b.dorsal, b.dir)
  const arc = []
  for (let i = 0; i <= 8; i++) {
    const a = (i / 8 - 0.5) * 1.7
    arc.push(onSurface(add(c, add(mul(across, Math.sin(a) * b.r0), mul(b.dorsal, Math.cos(a) * b.r0)))))
  }
  for (let i = 0; i < 8; i++) stitch(arc[i], arc[i + 1], 0.01)
}

// --- write ---------------------------------------------------------------------------------------
const total = surfaceVertices + threadVertices.length
if (total > 65535) throw new Error(`Zu viele Punkte für 16-Bit-Indizes: ${total}`)
const position = new Float32Array(total * 3)
const normal = new Int8Array(total * 3)
const color = new Uint8Array(total * 4)
const boneIds = new Uint8Array(total * 4)
const weights = new Uint8Array(total * 4)
const detail = new Uint8Array(total * 2)
const byte = (v) => Math.round(clamp(v) * 255)
for (let i = 0; i < total; i++) {
  const thread = i >= surfaceVertices
  const p = thread ? threadVertices[i - surfaceVertices] : positions[i]
  const n = thread ? threadNormals[i - surfaceVertices] : gradient(p)
  position.set(p, i * 3)
  normal.set(n.map((v) => Math.round(v * 127)), i * 3)
  const place = thread ? threadSkin[i - surfaceVertices] : strongest(surfaceWeights[i])
  boneIds.set([...place.bones, 0], i * 4)
  const [w0, w1, w2] = place.weights
  if (thread) {
    color.set([byte(THREAD[0]), byte(THREAD[1]), byte(THREAD[2]), 255], i * 4)
    weights.set([byte(w0), byte(w1), byte(w2), 0], i * 4)
    detail.set([0, 255], i * 2)
  } else {
    const { color: c, wrinkle, nail } = skinColor(p, n)
    color.set([byte(c[0]), byte(c[1]), byte(c[2]), byte(ambient(p, n))], i * 4)
    weights.set([byte(w0), byte(w1), byte(w2), byte(nail)], i * 4)
    detail.set([byte(wrinkle), 0], i * 2)
  }
}
const index = new Uint16Array([...indices, ...threadIndices])
const chunks = [position, normal, color, boneIds, weights, detail, index]
writeFileSync(new URL('Haendchen.bin', OUT), Buffer.concat(chunks.map((c) => Buffer.from(c.buffer, c.byteOffset, c.byteLength))))
writeFileSync(new URL('Haendchen.json', OUT), JSON.stringify({
  vertices: total,
  indices: index.length,
  bones: bones.map((b) => ({
    name: b.name,
    parent: b.parent,
    joint: b.joint.map((v) => Number(v.toFixed(4))),
    hinge: b.hinge.map((v) => Number(v.toFixed(4))),
    ...(b.tip ? { tip: b.tip.map((v) => Number(v.toFixed(4))) } : {}),
  })),
}) + '\n')
console.log(`${total} Punkte (${threadVertices.length} Faden), ${index.length / 3} Dreiecke`)
