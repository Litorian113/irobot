/**
 * Builds the figure of the Figur pattern (src/fullwall/figure.ts): a plain mannequin, life size, as a
 * signed distance field meshed with surface nets, with one bone per limb of the COCO skeleton that the
 * pose model gives (src/tracking/detector.worker.ts) and, per point, where its strokes run: along the
 * axis of its bone and round it, so that they wrap every limb like a drawing.
 * Writes public/models/Figur.json and .bin. Run: node scripts/build_figur.mjs
 *
 * Standing at the origin on the floor (y = 0), facing +z, 1.76 m tall; its left side at -x, as it is
 * seen in the mirror of the wall.
 */
import { writeFileSync } from 'node:fs'

const OUT = new URL('../public/models/', import.meta.url)
const CELL = 0.01
const BOUNDS = { min: [-0.46, -0.02, -0.22], max: [0.46, 1.82, 0.3] }

const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s]
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const len = (a) => Math.hypot(a[0], a[1], a[2])
const norm = (a) => mul(a, 1 / (len(a) || 1))
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const clamp = (x, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x))
const mix = (a, b, t) => a + (b - a) * t
const mixV = (a, b, t) => a.map((v, i) => mix(v, b[i], t))
const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a))
  return t * t * (3 - 2 * t)
}
const smin = (a, b, k) => {
  const h = clamp(0.5 + (0.5 * (b - a)) / k)
  return mix(b, a, h) - k * h * (1 - h)
}

// --- the skeleton: start and end of each bone, its parent; the pose moves it about `start` ---------
const side = (s, p) => [p[0] * s, p[1], p[2]]
const L = -1, R = 1
const bones = [
  { name: 'pelvis', parent: -1, start: [0, 0.84, 0], end: [0, 1.04, 0], radius: 0.16 },
  { name: 'spine', parent: 0, start: [0, 0.98, 0], end: [0, 1.47, 0], radius: 0.16 },
  { name: 'head', parent: 1, start: [0, 1.47, 0], end: [0, 1.76, 0.01], radius: 0.1 },
  { name: 'leftUpperArm', parent: 1, start: side(L, [0.2, 1.42, 0]), end: side(L, [0.25, 1.13, -0.01]), radius: 0.05 },
  { name: 'leftForearm', parent: 3, start: side(L, [0.25, 1.13, -0.01]), end: side(L, [0.29, 0.88, 0.02]), radius: 0.04 },
  { name: 'rightUpperArm', parent: 1, start: side(R, [0.2, 1.42, 0]), end: side(R, [0.25, 1.13, -0.01]), radius: 0.05 },
  { name: 'rightForearm', parent: 5, start: side(R, [0.25, 1.13, -0.01]), end: side(R, [0.29, 0.88, 0.02]), radius: 0.04 },
  { name: 'leftThigh', parent: 0, start: side(L, [0.1, 0.92, 0]), end: side(L, [0.11, 0.5, 0.01]), radius: 0.08 },
  { name: 'leftShin', parent: 7, start: side(L, [0.11, 0.5, 0.01]), end: side(L, [0.11, 0.08, 0]), radius: 0.055 },
  { name: 'rightThigh', parent: 0, start: side(R, [0.1, 0.92, 0]), end: side(R, [0.11, 0.5, 0.01]), radius: 0.08 },
  { name: 'rightShin', parent: 9, start: side(R, [0.11, 0.5, 0.01]), end: side(R, [0.11, 0.08, 0]), radius: 0.055 },
]
for (const b of bones) {
  b.dir = norm(sub(b.end, b.start))
  b.length = len(sub(b.end, b.start))
}

// --- the shape -----------------------------------------------------------------------------------
function ellipsoid(p, c, r) {
  const q = [(p[0] - c[0]) / r[0], (p[1] - c[1]) / r[1], (p[2] - c[2]) / r[2]]
  return (len(q) - 1) * Math.min(r[0], r[1], r[2])
}
function capsule(p, a, b, ra, rb) {
  const ab = sub(b, a)
  const t = clamp(dot(sub(p, a), ab) / dot(ab, ab))
  return len(sub(p, add(a, mul(ab, t)))) - mix(ra, rb, t)
}

/** The parts of the body, one per bone (same order): each point of the mesh belongs to the nearest. */
function parts(p) {
  const out = []
  for (const s of [L, R]) {
    const shoulder = side(s, [0.2, 1.42, 0]), elbow = side(s, [0.25, 1.13, -0.01]), wrist = side(s, [0.29, 0.88, 0.02])
    const hand = add(wrist, mul(norm(sub(wrist, elbow)), 0.11))
    const hip = side(s, [0.1, 0.92, 0]), knee = side(s, [0.11, 0.5, 0.01]), ankle = side(s, [0.11, 0.08, 0])
    out.push({
      upperArm: capsule(p, shoulder, elbow, 0.052, 0.042),
      forearm: smin(capsule(p, elbow, wrist, 0.041, 0.031), capsule(p, wrist, hand, 0.032, 0.03), 0.02),
      thigh: capsule(p, hip, knee, 0.085, 0.054),
      shin: smin(capsule(p, knee, ankle, 0.054, 0.038), capsule(p, add(ankle, [0, -0.02, -0.03]), side(s, [0.12, 0.03, 0.17]), 0.042, 0.03), 0.025),
    })
  }
  let head = ellipsoid(p, [0, 1.64, 0.01], [0.082, 0.108, 0.098])
  head = smin(head, ellipsoid(p, [0, 1.565, 0.04], [0.058, 0.05, 0.058]), 0.03)
  head = smin(head, capsule(p, [0, 1.42, -0.005], [0, 1.57, 0.0], 0.052, 0.048), 0.04)
  let chest = ellipsoid(p, [0, 1.3, 0.005], [0.165, 0.17, 0.108])
  chest = smin(chest, ellipsoid(p, [0, 1.1, 0], [0.135, 0.14, 0.092]), 0.07)
  chest = smin(chest, capsule(p, side(L, [0.17, 1.4, -0.005]), side(R, [0.17, 1.4, -0.005]), 0.068, 0.068), 0.06)
  const hips = ellipsoid(p, [0, 0.94, -0.005], [0.165, 0.12, 0.108])
  const [l, r] = out
  return [hips, chest, head, l.upperArm, l.forearm, r.upperArm, r.forearm, l.thigh, l.shin, r.thigh, r.shin]
}

function sdf(p) {
  const [hips, chest, head, ...limbs] = parts(p)
  let body = smin(smin(hips, chest, 0.07), head, 0.04)
  // Upper arm and forearm, thigh and shin, melt at the joint; all limbs into the trunk.
  body = smin(body, smin(limbs[0], limbs[1], 0.02), 0.035)
  body = smin(body, smin(limbs[2], limbs[3], 0.02), 0.035)
  body = smin(body, smin(limbs[4], limbs[5], 0.025), 0.035)
  body = smin(body, smin(limbs[6], limbs[7], 0.025), 0.035)
  return body
}

function gradient(p) {
  const e = 0.004
  return norm([
    sdf([p[0] + e, p[1], p[2]]) - sdf([p[0] - e, p[1], p[2]]),
    sdf([p[0], p[1] + e, p[2]]) - sdf([p[0], p[1] - e, p[2]]),
    sdf([p[0], p[1], p[2] + e]) - sdf([p[0], p[1], p[2] - e]),
  ])
}

// --- surface nets --------------------------------------------------------------------------------
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
    sum = add(sum, mixV(CORNERS[a], CORNERS[b], values[a] / (values[a] - values[b])))
    count++
  }
  cellVertex[at(x, y, z)] = positions.length
  positions.push([BOUNDS.min[0] + (x + sum[0] / count) * CELL, BOUNDS.min[1] + (y + sum[1] / count) * CELL, BOUNDS.min[2] + (z + sum[2] / count) * CELL])
}
const quad = (a, b, c, d, flip) => {
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

// --- bones, weights and strokes per point --------------------------------------------------------
const BLEND = 0.045
/** Hands and feet belong to the end of their limb: its segment is reached further. */
const reach = (b) => (b.name.includes('Forearm') ? 0.13 : b.name.includes('Shin') ? 0.12 : 0)
function nearestBone(p) {
  const d = parts(p)
  let best = 0
  for (let i = 1; i < d.length; i++) if (d[i] < d[best]) best = i
  return best
}
void reach
const weights = positions.map((p) => {
  const v = new Float32Array(bones.length)
  const i = nearestBone(p)
  const b = bones[i]
  const along = dot(sub(p, b.start), b.dir)
  // Near its start a bone hands over to its parent, so the joint bends smoothly.
  const own = b.parent < 0 ? 1 : smoothstep(-BLEND, BLEND, along)
  v[i] += own
  if (b.parent >= 0) v[b.parent] += 1 - own
  return v
})
{
  const neighbours = positions.map(() => new Set())
  for (let i = 0; i < indices.length; i += 3) {
    const [a, b, c] = [indices[i], indices[i + 1], indices[i + 2]]
    neighbours[a].add(b).add(c)
    neighbours[b].add(a).add(c)
    neighbours[c].add(a).add(b)
  }
  for (let pass = 0; pass < 3; pass++) {
    const next = weights.map((w, i) => {
      const out = new Float32Array(bones.length)
      for (const j of neighbours[i]) for (let k = 0; k < bones.length; k++) out[k] += weights[j][k]
      const n = neighbours[i].size || 1
      for (let k = 0; k < bones.length; k++) out[k] = (out[k] / n) * 0.5 + w[k] * 0.5
      return out
    })
    weights.splice(0, weights.length, ...next)
  }
}

/**
 * Where the strokes run. Trunk, head and legs: level rows over the whole body, strokes along them,
 * so nothing breaks where the legs meet or at the knee. Arms: rows along the arm and the angle
 * round it (in sevenths, as the shader draws seven strokes round a limb), so they wrap the arm.
 */
function strokeOf(p, bone) {
  const b = bones[bone]
  // Cut by planes tipped a little towards the street: the rows curve round the body as on the drawing.
  if (Math.abs(b.dir[1]) > 0.8) return [p[1] - 0.32 * p[2], (p[0] * 0.8 + p[2] * 0.6) / 0.16]
  const along = dot(sub(p, b.start), b.dir)
  const ref = Math.abs(b.dir[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]
  const u = norm(cross(b.dir, ref)), w = cross(b.dir, u)
  const off = sub(p, add(b.start, mul(b.dir, along)))
  return [along - 0.32 * dot(off, [0, 0, 1]) + bone * 0.37, ((Math.atan2(dot(off, w), dot(off, u)) / (2 * Math.PI) + 1) % 1) * 1.6]
}

// --- write ---------------------------------------------------------------------------------------
const total = positions.length
if (total > 65535) throw new Error(`Zu viele Punkte für 16-Bit-Indizes: ${total}`)
const position = new Float32Array(total * 3)
const normal = new Int8Array(total * 4)
const skin = new Uint8Array(total * 4)
const stroke = new Float32Array(total * 2)
const byte = (v) => Math.round(clamp(v) * 255)
positions.forEach((p, i) => {
  position.set(p, i * 3)
  normal.set([...gradient(p).map((v) => Math.round(v * 127)), 0], i * 4)
  const order = [...weights[i].keys()].sort((a, b) => weights[i][b] - weights[i][a])
  const [a, b] = order
  const sum = weights[i][a] + weights[i][b] || 1
  skin.set([a, b, byte(weights[i][b] / sum), 0], i * 4)
  stroke.set(strokeOf(p, a), i * 2)
})
const index = new Uint16Array(indices)
const chunks = [position, stroke, normal, skin, index]
writeFileSync(new URL('Figur.bin', OUT), Buffer.concat(chunks.map((c) => Buffer.from(c.buffer, c.byteOffset, c.byteLength))))
writeFileSync(new URL('Figur.json', OUT), JSON.stringify({
  vertices: total,
  indices: index.length,
  height: 1.76,
  bones: bones.map((b) => ({ name: b.name, parent: b.parent, start: b.start, end: b.end })),
}) + '\n')
console.log(`${total} Punkte, ${index.length / 3} Dreiecke`)
