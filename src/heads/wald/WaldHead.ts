import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { GazeSpring } from '../GazeSpring'
import type { Expression, HeadView, HeadViewOptions } from '../types'
import { BARK_FRAGMENT, BARK_VERTEX, BONE_FRAGMENT, BONE_VERTEX, BREATH_FRAGMENT, BREATH_VERTEX, FOREST_FRAGMENT, HOOD_FRAGMENT, HOOD_VERTEX, PASS_VERTEX, WISP_FRAGMENT, WISP_VERTEX } from './shaders'

/**
 * W.A.L.D. - a forest spirit: a stag's bare skull with real holes for eyes and
 * nose, an enormous lopsided rack of antlers, a torn leather hood stitched and
 * patched, mossy. Beside him a stick with a small skull that watches you, a
 * branch with a bone tied on. Pale lights burn deep in the sockets, cold breath
 * comes from the nose; now and then the forest wakes: the eyes flare, the jaw
 * drops without a sound, the wisps in the dark burn brighter.
 * WebGL 1 safe: geometry, canvas paint and plain GLSL ES 1.0.
 */

const FOV = 30
/** Slightly from below, so the rack looms; antlers fill the frame, the robe runs out at the bottom. */
const CAM = new THREE.Vector3(0, 0.42, 6.45)
const LOOK = new THREE.Vector3(0, 0.62, 0)
const KEY = new THREE.Vector3(-0.42, 0.68, 0.6).normalize()
/** Skull and antlers turn about this point, in the neck. */
const PIVOT = new THREE.Vector3(0, -0.45, -0.1)
const TURN = 0.62
const EMBER = new THREE.Color('#b8e04a')
const BREATHS = 36

const FACES: Record<Expression, { tilt: number; jaw: number; eye: number }> = {
  neutral: { tilt: 0.035, jaw: 0, eye: 0.5 },
  curious: { tilt: 0.21, jaw: 0.06, eye: 0.8 },
  happy: { tilt: -0.06, jaw: 0.75, eye: 1 },
}
/** He breathes out (seconds). */
const BREATHE_EVERY = [4.5, 8]
/** The forest wakes (seconds). */
const WAKE_EVERY = [24, 42]
const WAKE_LENGTH = 3.4

const between = ([lo, hi]: number[]) => lo + Math.random() * (hi - lo)
const smoothstep = (a: number, b: number, x: number) => {
  const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1)
  return t * t * (3 - 2 * t)
}
const gauss = (d: number) => Math.exp(-d * d)
/** Distance from a point to a segment, measured in widths. */
function segment(x: number, y: number, ax: number, ay: number, bx: number, by: number, w: number) {
  const dx = bx - ax, dy = by - ay
  const t = THREE.MathUtils.clamp(((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy), 0, 1)
  return Math.hypot(x - ax - dx * t, y - ay - dy * t) / w
}
const table = (rows: number[][], y: number) => {
  // rows run from high y to low y: [y, ...values]; linear in between.
  let i = 0
  while (i < rows.length - 2 && y < rows[i + 1][0]) i++
  const f = THREE.MathUtils.clamp((rows[i][0] - y) / (rows[i][0] - rows[i + 1][0]), 0, 1)
  return rows[i].map((v, k) => THREE.MathUtils.lerp(v, rows[i + 1][k], f))
}

// --- the skull -------------------------------------------------------------------------------------------------------

/** y, half-width, half-depth, from the poll down to the muzzle. */
const SKULL = new THREE.CatmullRomCurve3([
  [0.47, 0.02, 0.02], [0.45, 0.13, 0.1], [0.39, 0.24, 0.18], [0.29, 0.3, 0.24], [0.18, 0.325, 0.25], [0.08, 0.285, 0.23],
  [-0.04, 0.215, 0.2], [-0.2, 0.165, 0.17], [-0.36, 0.14, 0.145], [-0.5, 0.13, 0.125], [-0.6, 0.11, 0.1], [-0.645, 0.03, 0.03],
].map(([y, w, d]) => new THREE.Vector3(y, w, d)), false, 'centripetal')
/** The muzzle comes forward, towards you. */
const skullZ = (y: number) => 0.03 + 0.26 * (1 - smoothstep(-0.6, 0.3, y))

function pearEdge(ax: number, y: number) {
  if (y > -0.04 || y < -0.5) return 1
  let w = 0.085 * (1 - smoothstep(-0.3, -0.06, y))
  if (y < -0.38) w *= Math.sqrt(Math.max(1 - ((y + 0.38) / 0.09) ** 2, 0))
  return ax - w
}

function relief(px: number, y: number) {
  const x = Math.abs(px)
  let h = 0
  // The rims of the orbits, standing proud; the hollow below them.
  h += 0.035 * gauss((Math.hypot((x - 0.225) / 0.078, (y - 0.17) / 0.118) - 1) / 0.3)
  h += 0.05 * gauss(segment(x, y, 0.09, 0.27, 0.31, 0.31, 0.045))
  h -= 0.04 * gauss(Math.hypot((x - 0.2) / 0.085, (y + 0.05) / 0.07))
  // Brow and the pedicles the antlers grow from.
  h += 0.05 * gauss(Math.hypot((x - 0.16) / 0.06, (y - 0.43) / 0.05))
  // A groove down the frontal bones, two nasal bones below it.
  h -= 0.016 * gauss(x / 0.018) * smoothstep(0.0, 0.3, y)
  h += 0.024 * gauss((x - 0.04) / 0.032) * smoothstep(-0.1, 0.0, y) * (1 - smoothstep(0.08, 0.26, y))
  // The raised rim round the nasal opening.
  if (y < 0 && y > -0.55) h += 0.026 * gauss(pearEdge(x, y) / 0.028)
  h += 0.004 * Math.sin(px * 19 + y * 13) + 0.003 * Math.sin(px * 37 - y * 29)
  return h
}

function skullGeometry() {
  const rows = 150, cols = 180, n = 2.4
  const position: number[] = [], uv: number[] = [], paint: number[] = [], index: number[] = []
  const at = new THREE.Vector3()
  for (let j = 0; j <= rows; j++) {
    SKULL.getPoint(j / rows, at)
    const y = at.x, w = at.y, d = at.z
    for (let i = 0; i <= cols; i++) {
      const phi = -Math.PI + (i / cols) * Math.PI * 2
      const s = Math.sin(phi), c = Math.cos(phi)
      const x = w * Math.sign(s) * Math.abs(s) ** (2 / n)
      const z = d * Math.sign(c) * Math.abs(c) ** (2 / n)
      const front = c > 0
      const len = Math.hypot(x, z) || 1
      const h = relief(x, y) * smoothstep(-0.1, 0.4, c)
      position.push(x + (x / len) * h * 0.5, y, skullZ(y) + z + (z / len) * h)
      uv.push(x, y)
      const e = 0.04
      const mean = (relief(x + e, y) + relief(x - e, y) + relief(x, y + e) + relief(x, y - e)) / 4
      paint.push(front ? 1 : 0, Math.max(0, mean - relief(x, y)) * 20 + (1 - smoothstep(-0.5, 0.1, c)) * 0.75)
    }
  }
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const a = j * (cols + 1) + i, b = a + 1, c = a + cols + 1, d = c + 1
      index.push(a, c, b, b, c, d)
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  geometry.setAttribute('aPaint', new THREE.Float32BufferAttribute(paint, 2))
  geometry.setIndex(index)
  geometry.computeVertexNormals()
  return geometry
}

/** Plan and paint on a geometry that has no holes: the jaw and the teeth. */
function bonePaint(geometry: THREE.BufferGeometry, dirt: number) {
  const position = geometry.attributes.position as THREE.BufferAttribute
  const uv = new Float32Array(position.count * 2), paint = new Float32Array(position.count * 2)
  for (let i = 0; i < position.count; i++) {
    uv[i * 2] = position.getX(i) * 2
    uv[i * 2 + 1] = position.getY(i)
    paint[i * 2 + 1] = dirt
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
  geometry.setAttribute('aPaint', new THREE.BufferAttribute(paint, 2))
  return geometry
}

/** Red: lumps, for colour and bump. Green: cracks and sutures. Blue: old stains. */
function boneDetail() {
  const small = document.createElement('canvas')
  small.width = small.height = 256
  const lumps = small.getContext('2d')!
  lumps.fillStyle = 'rgb(128,0,20)'
  lumps.fillRect(0, 0, 256, 256)
  for (let i = 0; i < 1500; i++) {
    const r = 0.8 + Math.random() ** 2 * 8
    lumps.fillStyle = Math.random() < 0.5 ? `rgba(215,0,20,${0.06 + Math.random() * 0.14})` : `rgba(50,0,20,${0.06 + Math.random() * 0.16})`
    lumps.beginPath()
    lumps.ellipse(Math.random() * 256, Math.random() * 256, r, r * (0.4 + Math.random()), Math.random() * 3, 0, Math.PI * 2)
    lumps.fill()
  }
  for (let i = 0; i < 26; i++) {
    const r = 6 + Math.random() * 26
    const x = Math.random() * 256, y = Math.random() * 256
    const stain = lumps.createRadialGradient(x, y, 0, x, y, r)
    stain.addColorStop(0, `rgba(128,0,230,${0.2 + Math.random() * 0.35})`)
    stain.addColorStop(1, 'rgba(128,0,230,0)')
    lumps.fillStyle = stain
    lumps.fillRect(x - r, y - r, r * 2, r * 2)
  }
  const size = 1024
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(small, 0, 0, size, size)
  ctx.globalCompositeOperation = 'lighter'
  const plan = (x: number, y: number): [number, number] => [(x / 0.9 + 0.5) * size, (0.5 - y / 1.3) * size]
  const crack = (x: number, y: number, angle: number, length: number, width: number) => {
    ctx.strokeStyle = `rgb(0,${Math.floor(110 + width * 60)},0)`
    ctx.lineWidth = width
    ctx.beginPath()
    ctx.moveTo(x, y)
    for (let i = 0; i < length; i++) {
      angle += (Math.random() - 0.5) * 0.9
      x += Math.cos(angle) * 8
      y += Math.sin(angle) * 8
      ctx.lineTo(x, y)
    }
    ctx.stroke()
    if (width > 1 && length > 6) crack(x, y, angle + (Math.random() < 0.5 ? 0.9 : -0.9), length * 0.6, width * 0.65)
  }
  // Sutures: zigzags across the brow and down the middle.
  ctx.strokeStyle = 'rgb(0,110,0)'
  ctx.lineWidth = 1.2
  for (const [ax, ay, bx, by] of [[0, 0.46, 0, 0.1], [-0.2, 0.37, 0.2, 0.37], [-0.05, 0.03, -0.13, -0.2], [0.05, 0.03, 0.12, -0.2]]) {
    const [x0, y0] = plan(ax, ay), [x1, y1] = plan(bx, by)
    ctx.beginPath()
    for (let i = 0; i <= 40; i++) {
      const f = i / 40, k = (i % 2 ? 1 : -1) * (2 + Math.random() * 4)
      ctx.lineTo(x0 + (x1 - x0) * f + k * (y1 - y0 ? 1 : 0), y0 + (y1 - y0) * f + k * (x1 - x0 ? 1 : 0))
    }
    ctx.stroke()
  }
  for (const [x, y, a, l] of [[0.14, 0.38, 1.2, 14], [-0.24, 0.04, 2.0, 12], [0.09, -0.3, 1.5, 12], [-0.1, -0.5, -1.4, 8], [0.25, 0.3, 0.6, 7]]) crack(...plan(x, y), a, l, 2)
  return new THREE.CanvasTexture(canvas)
}

// --- antlers and dead wood -------------------------------------------------------------------------------------------

/** A tapering, knobbly tube along the points. aTip runs 0..1 base to tip. */
function tube(points: THREE.Vector3[], r0: number, r1: number, knob = 1) {
  const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal')
  const segments = 12 * Math.max(points.length - 1, 2), around = 10
  const frames = curve.computeFrenetFrames(segments, false)
  const position: number[] = [], uv: number[] = [], tips: number[] = [], index: number[] = []
  const p = new THREE.Vector3()
  const seed = points[0].x * 31 + points[0].y * 17
  for (let s = 0; s <= segments; s++) {
    const t = s / segments
    curve.getPointAt(t, p)
    const N = frames.normals[s], B = frames.binormals[s]
    const taper = THREE.MathUtils.lerp(r0, r1, t ** 1.35)
    for (let k = 0; k <= around; k++) {
      const a = (k / around) * Math.PI * 2
      const lump = 1 + knob * (0.1 * Math.sin(a * 3 + t * 13 + seed) + 0.07 * Math.sin(a * 5 - t * 29 + seed) + 0.08 * Math.sin(t * 41 + seed)) * (1 - t * 0.6)
      const r = taper * lump
      position.push(p.x + (Math.cos(a) * N.x + Math.sin(a) * B.x) * r, p.y + (Math.cos(a) * N.y + Math.sin(a) * B.y) * r, p.z + (Math.cos(a) * N.z + Math.sin(a) * B.z) * r)
      uv.push(t * curve.getLength() * 2 + seed, k / around)
      tips.push(t)
    }
  }
  for (let s = 0; s < segments; s++) {
    for (let k = 0; k < around; k++) {
      const a = s * (around + 1) + k, b = a + 1, c = a + around + 1, d = c + 1
      index.push(a, b, c, b, d, c)
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  geometry.setAttribute('aTip', new THREE.Float32BufferAttribute(tips, 1))
  geometry.setIndex(index)
  geometry.computeVertexNormals()
  return geometry
}

/** The reference's pixels to scene units: the skull is about 125 px tall per unit. */
const X = (px: number) => (px - 330) / 125
const Y = (py: number) => (335 - py) / 125
/** The rack's depth: one smooth field, so tines always meet their beam. */
const rackZ = (x: number, y: number) => 0.0 - 0.11 * Math.abs(x) + 0.13 * Math.sin(x * 2.1 + y * 1.3)

type Branch = { at: number[][]; r: [number, number]; forward?: number }
const ANTLERS: Branch[] = [
  // screen right: the beam climbs to the tall tip
  { at: [[350, 277], [400, 256], [450, 240], [480, 195], [497, 130], [490, 85], [468, 55]], r: [0.098, 0.012] },
  { at: [[398, 257], [416, 216], [420, 185], [408, 150]], r: [0.04, 0.005], forward: 0.16 },
  { at: [[374, 267], [355, 225], [341, 170]], r: [0.04, 0.005], forward: -0.12 },
  { at: [[481, 195], [455, 188], [440, 165], [438, 132]], r: [0.036, 0.005], forward: 0.18 },
  { at: [[470, 212], [520, 190], [530, 160], [522, 130]], r: [0.04, 0.005], forward: -0.14 },
  { at: [[458, 228], [530, 212], [560, 170], [565, 130], [555, 115]], r: [0.045, 0.005], forward: 0.12 },
  { at: [[446, 241], [530, 240], [590, 225], [620, 195], [635, 165]], r: [0.05, 0.005], forward: 0.2 },
  { at: [[578, 229], [584, 208], [582, 192]], r: [0.022, 0.004], forward: -0.08 },
  { at: [[405, 262], [440, 274], [472, 262]], r: [0.026, 0.004], forward: 0.14 },
  // screen left
  { at: [[310, 278], [270, 270], [225, 235], [185, 220], [150, 175], [145, 135], [165, 98]], r: [0.098, 0.012] },
  { at: [[272, 271], [283, 230], [285, 190], [278, 143]], r: [0.042, 0.005], forward: 0.18 },
  { at: [[250, 256], [226, 215], [222, 180], [228, 158]], r: [0.036, 0.005], forward: -0.14 },
  { at: [[224, 234], [198, 190], [175, 150]], r: [0.034, 0.005], forward: 0.14 },
  { at: [[185, 220], [140, 205], [118, 175], [122, 148]], r: [0.04, 0.005], forward: -0.16 },
  { at: [[208, 229], [150, 262], [100, 250], [70, 225], [53, 190]], r: [0.05, 0.005], forward: 0.2 },
  { at: [[98, 249], [93, 228], [88, 217]], r: [0.02, 0.004], forward: -0.08 },
  { at: [[240, 262], [226, 282], [205, 287]], r: [0.022, 0.004], forward: 0.12 },
]

function antlerGeometry() {
  const parts = ANTLERS.map(({ at, r, forward = 0 }) => tube(at.map(([px, py], i) => {
    const x = X(px), y = Y(py), f = i / (at.length - 1)
    return new THREE.Vector3(x, y, rackZ(x, y) + forward * f * f)
  }), r[0] * (r[0] < 0.09 ? 1.5 : 1), r[1]))
  // The knobbly burrs where they leave the skull.
  for (const side of [-1, 1]) {
    const ring: THREE.Vector3[] = []
    for (let i = 0; i <= 14; i++) {
      const a = (i / 14) * Math.PI * 2
      ring.push(new THREE.Vector3(side * 0.165 + Math.cos(a) * 0.085, 0.47 + Math.sin(a) * 0.04, 0.0 + Math.sin(a) * 0.075))
    }
    parts.push(tube(ring, 0.032, 0.032, 2))
  }
  return mergeGeometries(parts)!
}

// --- the hood --------------------------------------------------------------------------------------------------------

/** y, radius, centre z, half-angle of the opening. */
const HOOD = [[0.5, 0.01, -0.22, 1.15], [0.44, 0.17, -0.22, 1.15], [0.34, 0.33, -0.2, 1.15], [0.1, 0.44, -0.2, 1.0], [-0.2, 0.49, -0.16, 0.78], [-0.5, 0.53, -0.1, 0.58],
  [-0.72, 0.56, -0.08, 0.3], [-0.86, 0.62, -0.08, 0], [-1.02, 0.84, -0.06, 0], [-1.25, 1.2, -0.05, 0], [-1.7, 1.6, -0.05, 0], [-2.7, 1.85, -0.05, 0]]
const HOOD_TOP = 0.5, HOOD_LOW = -2.7

function hoodGeometry() {
  const rows = 120, cols = 160
  const position: number[] = [], uv: number[] = [], edges: number[] = [], index: number[] = []
  for (let j = 0; j <= rows; j++) {
    const t = j / rows
    const y = THREE.MathUtils.lerp(HOOD_TOP, HOOD_LOW, t)
    const [, r0, zc, open] = table(HOOD, y)
    const low = 1 - smoothstep(-1.4, -0.5, y)
    for (let i = 0; i <= cols; i++) {
      const u = i / cols
      const theta = open + u * (Math.PI * 2 - open * 2)
      // Heavy folds, deeper lower down; a roll of cloth where the cowl meets the shoulders.
      const fold = (0.05 + 0.1 * low) * Math.sin(theta * 5 + y * 2.3) + (0.03 + 0.05 * low) * Math.sin(theta * 11 - y * 4.1) + 0.016 * Math.sin(theta * 3 + y * 9)
      const r = r0 + r0 * fold + 0.06 * gauss((y + 0.9) / 0.09)
      position.push(r * Math.sin(theta), y, zc + r * 0.92 * Math.cos(theta))
      uv.push(theta / (Math.PI * 2), 1 - t)
      edges.push(open > 0.03 ? Math.min(theta - open, Math.PI * 2 - open - theta) * Math.max(r0, 0.2) : 1)
    }
  }
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const a = j * (cols + 1) + i, b = a + 1, c = a + cols + 1, d = c + 1
      index.push(a, c, b, b, c, d)
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  geometry.setAttribute('aEdge', new THREE.Float32BufferAttribute(edges, 1))
  geometry.setIndex(index)
  geometry.computeVertexNormals()
  return geometry
}

/** Worn leather with seams and big stitches, a patch on the shoulder, moss growing over it, a tear. */
function leather() {
  const size = 1024
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#3f2a1c'
  ctx.fillRect(0, 0, size, size)
  for (let i = 0; i < 2600; i++) {
    const r = 2 + Math.random() ** 2 * 34
    ctx.fillStyle = Math.random() < 0.55 ? `rgba(22,12,7,${0.03 + Math.random() * 0.08})` : `rgba(150,108,72,${0.02 + Math.random() * 0.06})`
    ctx.beginPath()
    ctx.ellipse(Math.random() * size, Math.random() * size, r * (0.3 + Math.random() * 0.5), r, (Math.random() - 0.5) * 0.7, 0, Math.PI * 2)
    ctx.fill()
  }
  // Creases, running mostly down.
  for (let i = 0; i < 170; i++) {
    const x = Math.random() * size, y = Math.random() * size, l = 30 + Math.random() * 170
    ctx.strokeStyle = Math.random() < 0.7 ? `rgba(15,8,4,${0.1 + Math.random() * 0.25})` : `rgba(170,128,90,${0.06 + Math.random() * 0.1})`
    ctx.lineWidth = 0.7 + Math.random() * 1.8
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.quadraticCurveTo(x + (Math.random() - 0.5) * 40, y + l / 2, x + (Math.random() - 0.5) * 50, y + l)
    ctx.stroke()
  }
  const seam = (points: number[][]) => {
    const curve = new THREE.CatmullRomCurve3(points.map(([x, y]) => new THREE.Vector3(x, y, 0)))
    ctx.strokeStyle = 'rgba(14,8,4,0.8)'
    ctx.lineWidth = 3
    ctx.beginPath()
    curve.getPoints(50).forEach((p) => ctx.lineTo(p.x, p.y))
    ctx.stroke()
    const count = Math.floor(curve.getLength() / 22)
    for (let i = 0; i < count; i++) {
      const p = curve.getPointAt(i / count), d = curve.getTangentAt(i / count)
      ctx.strokeStyle = '#7f6a4e'
      ctx.lineWidth = 2.4
      ctx.beginPath()
      ctx.moveTo(p.x - d.y * 10 - d.x * 3, p.y + d.x * 10 - d.y * 3)
      ctx.lineTo(p.x + d.y * 10 + d.x * 3, p.y - d.x * 10 + d.y * 3)
      ctx.stroke()
    }
  }
  seam([[170, 120], [150, 230], [190, 330], [270, 410]])
  seam([[860, 130], [870, 260], [830, 350], [750, 420]])
  seam([[512, 40], [505, 160], [515, 300]])
  seam([[20, 300], [6, 380], [14, 470], [4, 560]])
  // The patch on his right shoulder, screen right, and the moss taking it over.
  const patch = () => {
    ctx.beginPath()
    ctx.moveTo(120, 440); ctx.lineTo(235, 415); ctx.lineTo(265, 500); ctx.lineTo(240, 600); ctx.lineTo(135, 610); ctx.lineTo(105, 520)
    ctx.closePath()
  }
  patch()
  ctx.fillStyle = '#54392a'
  ctx.fill()
  seam([[120, 440], [235, 415], [265, 500], [240, 600], [135, 610], [105, 520], [120, 440]])
  for (let i = 0; i < 1500; i++) {
    const a = Math.random() * Math.PI * 2, d = Math.random() ** 0.6
    const x = 190 + Math.cos(a) * d * 120, y = 575 + Math.sin(a) * d * 95
    ctx.fillStyle = `rgba(${35 + Math.random() * 40},${55 + Math.random() * 50},${14 + Math.random() * 14},0.75)`
    ctx.beginPath()
    ctx.arc(x, y, 1.5 + Math.random() * 4, 0, Math.PI * 2)
    ctx.fill()
  }
  for (const [x, y, n] of [[900, 500, 300], [640, 240, 110], [340, 560, 170]]) {
    for (let i = 0; i < n; i++) {
      ctx.fillStyle = `rgba(${35 + Math.random() * 25},${50 + Math.random() * 35},16,0.55)`
      ctx.beginPath()
      ctx.arc(x + (Math.random() - 0.5) * 110, y + (Math.random() - 0.5) * 80, 1 + Math.random() * 3, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  // A tear.
  ctx.globalCompositeOperation = 'destination-out'
  ctx.beginPath()
  ctx.moveTo(300, 440); ctx.lineTo(322, 462); ctx.lineTo(312, 500); ctx.lineTo(330, 540); ctx.lineTo(296, 505); ctx.lineTo(304, 470)
  ctx.closePath()
  ctx.fill()
  return new THREE.CanvasTexture(canvas)
}

// --- bits --------------------------------------------------------------------------------------------------------------

function soft(inner: string, outer: string) {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 64
  const ctx = canvas.getContext('2d')!
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32)
  g.addColorStop(0, inner)
  g.addColorStop(1, outer)
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 64, 64)
  return new THREE.CanvasTexture(canvas)
}

/** The small skull's painted face; u = 0.25 faces the viewer on a three.js sphere. */
function smallSkullTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 256
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#c9b796'
  ctx.fillRect(0, 0, 512, 256)
  for (let i = 0; i < 900; i++) {
    ctx.fillStyle = `rgba(${Math.random() < 0.6 ? '60,40,22' : '240,225,190'},${0.03 + Math.random() * 0.09})`
    ctx.beginPath()
    ctx.arc(Math.random() * 512, Math.random() * 256, 1 + Math.random() * 11, 0, Math.PI * 2)
    ctx.fill()
  }
  // Soot-dark hollows first, then the holes in them.
  for (const [x, y, r] of [[102, 124, 34], [154, 124, 34], [128, 170, 24]]) {
    const g = ctx.createRadialGradient(x, y, 4, x, y, r)
    g.addColorStop(0, 'rgba(30,18,8,0.7)')
    g.addColorStop(1, 'rgba(30,18,8,0)')
    ctx.fillStyle = g
    ctx.fillRect(x - r, y - r, r * 2, r * 2)
  }
  ctx.fillStyle = '#060402'
  for (const side of [-1, 1]) {
    ctx.beginPath()
    ctx.moveTo(128 + side * 9, 118); ctx.lineTo(128 + side * 34, 112); ctx.quadraticCurveTo(128 + side * 44, 128, 128 + side * 34, 142); ctx.quadraticCurveTo(128 + side * 14, 148, 128 + side * 9, 118)
    ctx.closePath()
    ctx.fill()
  }
  ctx.beginPath()
  ctx.moveTo(128, 150); ctx.lineTo(136, 176); ctx.lineTo(128, 171); ctx.lineTo(120, 176)
  ctx.closePath()
  ctx.fill()
  // Teeth.
  ctx.fillStyle = '#0a0603'
  ctx.fillRect(98, 198, 60, 3)
  ctx.lineWidth = 2
  ctx.strokeStyle = '#1a0f07'
  for (let x = 100; x <= 156; x += 8) {
    ctx.beginPath()
    ctx.moveTo(x, 188)
    ctx.lineTo(x, 212)
    ctx.stroke()
  }
  ctx.strokeStyle = 'rgba(25,14,6,0.7)'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(90, 66); ctx.lineTo(105, 82); ctx.lineTo(100, 96); ctx.moveTo(150, 40); ctx.lineTo(160, 60); ctx.lineTo(180, 70)
  ctx.stroke()
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

/** A long bone, knuckled at both ends, along y. */
function longBone(length: number) {
  const h = length / 2
  const outline = [[0, -h - 0.03], [0.05, -h - 0.025], [0.075, -h + 0.03], [0.05, -h + 0.1], [0.03, -h + 0.2], [0.028, 0], [0.03, h - 0.2], [0.055, h - 0.1], [0.085, h - 0.03], [0.06, h + 0.03], [0, h + 0.04]]
  const curve = new THREE.SplineCurve(outline.map(([r, y]) => new THREE.Vector2(r, y)))
  return new THREE.LatheGeometry(curve.getPoints(50).map((p) => new THREE.Vector2(Math.max(p.x, 0), p.y)), 20)
}

interface Puff {
  position: THREE.Vector3
  velocity: THREE.Vector3
  age: number
  life: number
}

export class WaldHead implements HeadView {
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 60)
  /** Rotates about PIVOT; `crown` inside it undoes the offset, so children use scene coordinates. */
  private head = new THREE.Group()
  private jaw = new THREE.Group()
  private embers: THREE.Sprite[] = []
  private halos: THREE.Sprite[] = []
  private nose = new THREE.Object3D()
  private little = new THREE.Group()
  private littleLook = new THREE.Vector2()
  private turnMatrix = new THREE.Matrix3()
  private forest: THREE.ShaderMaterial
  private wisps: THREE.ShaderMaterial
  private breath: THREE.Points
  private breathMaterial: THREE.ShaderMaterial
  private puffs: Puff[] = []
  private textures: THREE.Texture[] = []
  private gaze: GazeSpring
  private face = { ...FACES.neutral }
  private faceTarget = { ...FACES.neutral }
  private nextBreath = between([1.5, 3])
  private breathUntil = -1
  private nextPuff = 0
  private nextWake = between([9, 15])
  private wakeAt = -100
  private clock = new THREE.Clock()
  private resizeObserver: ResizeObserver
  private canvas: HTMLCanvasElement
  private fps: number
  private raf = 0
  private lastFrame = 0
  private renderedFps = 0
  private fpsCount = 0
  private fpsSince = 0
  private disposed = false

  constructor(canvas: HTMLCanvasElement, opts: HeadViewOptions = {}) {
    this.canvas = canvas
    this.fps = opts.fps ?? 30
    this.gaze = new GazeSpring(opts.stiffness ?? 4, opts.delay ?? 0)

    const attributes: WebGLContextAttributes = { antialias: true, alpha: false, powerPreference: 'high-performance' }
    // A WebGL 1 context handed in keeps three.js on its WebGL 1 path, as on the old iMacs.
    const context = opts.webgl1 ? canvas.getContext('webgl', attributes) ?? undefined : undefined
    this.renderer = new THREE.WebGLRenderer({ canvas, context, ...attributes })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, opts.maxPixelRatio ?? 1.5))
    this.renderer.setClearColor(0x050607, 1)
    this.camera.position.copy(CAM)
    this.camera.lookAt(LOOK)

    // --- the forest -----------------------------------------------------------
    const size = new THREE.Vector2(24, 14)
    this.forest = new THREE.ShaderMaterial({
      uniforms: { uSize: { value: size }, uTime: { value: 0 }, uWake: { value: 0 } },
      vertexShader: PASS_VERTEX,
      fragmentShader: FOREST_FRAGMENT,
      depthWrite: false,
    })
    const backdrop = new THREE.Mesh(new THREE.PlaneGeometry(size.x, size.y), this.forest)
    backdrop.position.z = -6
    backdrop.renderOrder = -10
    this.scene.add(backdrop)
    this.wisps = this.makeWisps()

    this.scene.add(new THREE.HemisphereLight(0xaabbc4, 0x0a0806, 0.9))
    const key = new THREE.DirectionalLight(0xe8ebe4, 1.8)
    key.position.copy(KEY)
    const rim = new THREE.DirectionalLight(0xc8d8e4, 1.1)
    rim.position.set(2, 2, -3)
    this.scene.add(key, rim)

    // --- skull, jaw, antlers ------------------------------------------------------
    const detail = boneDetail()
    this.textures.push(detail)
    const bone = () => new THREE.ShaderMaterial({
      uniforms: { uDetail: { value: detail }, uKey: { value: KEY } },
      vertexShader: BONE_VERTEX,
      fragmentShader: BONE_FRAGMENT,
      side: THREE.DoubleSide,
    })
    const crown = new THREE.Group()
    crown.position.copy(PIVOT).negate()
    this.head.position.copy(PIVOT)
    this.head.add(crown)
    crown.add(new THREE.Mesh(skullGeometry(), bone()))

    // Behind the muzzle: it must not show through the nasal opening.
    const lowerZ = skullZ(-0.38) - 0.25
    const mandible = new THREE.SphereGeometry(1, 28, 20)
    mandible.scale(0.095, 0.2, 0.08)
    mandible.translate(0, -0.5, 0)
    const lower = new THREE.Mesh(bonePaint(mandible, 0.28), bone())
    this.jaw.add(lower)
    this.jaw.position.z = lowerZ
    const teeth: THREE.BufferGeometry[] = []
    for (const x of [-0.085, -0.052, -0.018, 0.018, 0.052, 0.085]) {
      const tooth = new THREE.ConeGeometry(0.017, 0.055, 8)
      tooth.rotateX(Math.PI)
      tooth.translate(x, -0.645 + Math.abs(x) * 0.25, skullZ(-0.62) + 0.075 - Math.abs(x) * 0.5)
      teeth.push(tooth)
    }
    crown.add(this.jaw, new THREE.Mesh(bonePaint(mergeGeometries(teeth)!, 0.12), bone()))

    const horn = new THREE.ShaderMaterial({
      uniforms: { uKey: { value: KEY }, uPale: { value: 1 } },
      vertexShader: BARK_VERTEX,
      fragmentShader: BARK_FRAGMENT,
    })
    crown.add(new THREE.Mesh(antlerGeometry(), horn))
    this.nose.position.set(0, -0.3, skullZ(-0.3) + 0.2)
    crown.add(this.nose)

    // The lights deep in the sockets.
    const glow = soft('rgba(255,255,255,1)', 'rgba(255,255,255,0)')
    this.textures.push(glow)
    for (const side of [-1, 1]) {
      const ember = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: EMBER, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }))
      ember.position.set(side * 0.21, 0.165, 0.1)
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: EMBER, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, transparent: true }))
      halo.position.set(side * 0.21, 0.165, 0.2)
      this.embers.push(ember)
      this.halos.push(halo)
      crown.add(ember, halo)
    }
    this.scene.add(this.head)

    // --- hood and robe ----------------------------------------------------------
    const robe = leather()
    this.textures.push(robe)
    const hood = new THREE.Mesh(hoodGeometry(), new THREE.ShaderMaterial({
      uniforms: { uMap: { value: robe }, uKey: { value: KEY }, uTurn: { value: this.turnMatrix }, uPivot: { value: PIVOT } },
      vertexShader: HOOD_VERTEX,
      fragmentShader: HOOD_FRAGMENT,
      side: THREE.DoubleSide,
    }))
    hood.frustumCulled = false
    this.scene.add(hood)

    // --- the two sticks -----------------------------------------------------------
    const wood = new THREE.ShaderMaterial({
      uniforms: { uKey: { value: KEY }, uPale: { value: 0 } },
      vertexShader: BARK_VERTEX,
      fragmentShader: BARK_FRAGMENT,
    })
    const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)
    const sticks = mergeGeometries([
      // Screen right: the forked branch.
      tube([v(0.98, -1.75, 0.3), v(1.12, -0.86, 0.18), v(1.42, -0.2, 0.08), v(1.72, 0.48, 0)], 0.05, 0.012),
      tube([v(1.43, -0.2, 0.08), v(1.78, -0.1, 0.12), v(2.08, -0.03, 0.08), v(2.2, 0.14, 0.05)], 0.026, 0.006),
      tube([v(1.22, -0.65, 0.15), v(1.44, -0.62, 0.3), v(1.56, -0.5, 0.38)], 0.02, 0.005),
      // Screen left: the staff with its fork.
      tube([v(-1.85, -1.3, 0.65), v(-1.28, -1.07, 0.68), v(-0.76, -1.0, 0.7), v(-0.42, -0.96, 0.68)], 0.042, 0.016),
      tube([v(-0.86, -1.03, 0.69), v(-0.78, -0.86, 0.68), v(-0.74, -0.72, 0.66)], 0.024, 0.012),
      tube([v(-1.02, -1.05, 0.69), v(-1.14, -0.9, 0.7), v(-1.24, -0.76, 0.72)], 0.016, 0.004),
    ])!
    this.scene.add(new THREE.Mesh(sticks, wood))

    // The bone tied across the branch.
    const boneColor = new THREE.MeshPhongMaterial({ color: 0xc9bb9a, shininess: 22, specular: new THREE.Color(0x3a382f) })
    const femur = new THREE.Mesh(longBone(1.08), boneColor)
    femur.position.set(1.8, 0.1, 0.05)
    femur.quaternion.setFromUnitVectors(v(0, 1, 0), v(-1.04, 0.52, 0).normalize())
    const cord = new THREE.MeshPhongMaterial({ color: 0x3d2c1b, shininess: 8 })
    for (let i = 0; i < 4; i++) {
      const wrap = new THREE.Mesh(new THREE.TorusGeometry(0.052, 0.012, 8, 20), cord)
      wrap.position.set(1.61 + i * 0.02, 0.2 - i * 0.02, 0.05)
      wrap.rotation.set(Math.PI / 2, 0.35, 0.5 + i * 0.3)
      this.scene.add(wrap)
    }
    this.scene.add(femur)

    // The little skull on its fork; it watches you, a beat late.
    const face = smallSkullTexture()
    this.textures.push(face)
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.2, 36, 26), new THREE.MeshPhongMaterial({ map: face, shininess: 20, specular: new THREE.Color(0x33302a) }))
    dome.scale.set(0.9, 1.04, 1.06)
    const chin = new THREE.Mesh(new THREE.SphereGeometry(0.11, 20, 14), boneColor)
    chin.scale.set(0.85, 0.55, 0.8)
    chin.position.set(0, -0.165, 0.03)
    this.little.add(dome, chin)
    this.little.position.set(-0.74, -0.53, 0.66)
    this.scene.add(this.little)

    // --- breath ---------------------------------------------------------------------
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(BREATHS * 3), 3))
    geometry.setAttribute('aAge', new THREE.BufferAttribute(new Float32Array(BREATHS).fill(-1), 1))
    this.breathMaterial = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 1 } },
      vertexShader: BREATH_VERTEX,
      fragmentShader: BREATH_FRAGMENT,
      transparent: true,
      depthWrite: false,
    })
    this.breath = new THREE.Points(geometry, this.breathMaterial)
    this.breath.frustumCulled = false
    this.scene.add(this.breath)
    for (let i = 0; i < BREATHS; i++) this.puffs.push({ position: new THREE.Vector3(), velocity: new THREE.Vector3(), age: 2, life: 1 })

    this.resizeObserver = new ResizeObserver(this.resize)
    this.resizeObserver.observe(canvas)
    this.resize()
    document.addEventListener('visibilitychange', this.onVisibility)
    this.tick()
  }

  private makeWisps() {
    const count = 34
    const seed = new Float32Array(count * 4)
    for (let i = 0; i < seed.length; i++) seed[i] = Math.random()
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3))
    geometry.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4))
    const material = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uScale: { value: 1 }, uWake: { value: 0 } },
      vertexShader: WISP_VERTEX,
      fragmentShader: WISP_FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
    const points = new THREE.Points(geometry, material)
    points.frustumCulled = false
    this.scene.add(points)
    return material
  }

  private resize = () => {
    const w = this.canvas.clientWidth || window.innerWidth
    const h = this.canvas.clientHeight || window.innerHeight
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / h
    // Keep the rack (about 5.2 wide) in frame on narrow screens.
    const halfFov = THREE.MathUtils.degToRad(FOV / 2)
    const dist = Math.max(CAM.z, 5.4 / (2 * Math.tan(halfFov) * this.camera.aspect))
    this.camera.position.set(CAM.x, CAM.y, dist)
    this.camera.lookAt(LOOK)
    this.camera.updateProjectionMatrix()
    const scale = this.renderer.getPixelRatio() * h / (2 * Math.tan(halfFov))
    this.wisps.uniforms.uScale.value = scale
    this.breathMaterial.uniforms.uScale.value = scale
  }

  private onVisibility = () => {
    if (document.hidden) {
      cancelAnimationFrame(this.raf)
      this.raf = 0
    } else if (!this.raf && !this.disposed) {
      this.clock.getDelta()
      this.tick()
    }
  }

  setLook(yaw: number, pitch: number) {
    this.gaze.set(yaw, pitch)
  }

  setExpression(expression: Expression) {
    Object.assign(this.faceTarget, FACES[expression])
  }

  private tick = () => {
    if (this.disposed) return
    this.raf = requestAnimationFrame(this.tick)
    const now = performance.now()
    if (now - this.lastFrame < 1000 / this.fps - 2) return
    this.lastFrame = now
    const dt = Math.min(this.clock.getDelta(), 0.1)
    const t = this.clock.elapsedTime

    const k = 1 - Math.exp(-3 * dt)
    for (const key of ['tilt', 'jaw', 'eye'] as const) this.face[key] += (this.faceTarget[key] - this.face[key]) * k

    // The forest wakes: the eyes flare, the jaw drops, the rack shivers.
    if (t > this.nextWake) {
      this.wakeAt = t
      this.nextWake = t + WAKE_LENGTH + between(WAKE_EVERY)
    }
    const age = (t - this.wakeAt) / WAKE_LENGTH
    const wake = age < 1 ? smoothstep(0, 0.2, age) * (1 - smoothstep(0.7, 1, age)) : 0
    const shiver = wake * Math.sin(t * 34) * 0.006

    // Slowly, like something very old. The head rises and sinks a hair as it breathes.
    const pose = this.gaze.update(dt, t)
    this.head.rotation.set(-pose.pitch * 0.55 + wake * 0.05, pose.yaw * TURN, this.face.tilt + shiver + Math.sin(t * 0.31) * 0.012, 'YXZ')
    this.head.position.y = PIVOT.y + Math.sin(t * 0.8) * 0.006
    this.head.updateMatrix()
    this.turnMatrix.setFromMatrix4(this.head.matrix)
    this.head.updateMatrixWorld(true)

    const jaw = Math.max(this.face.jaw, wake)
    this.jaw.position.y = -jaw * 0.2
    this.jaw.rotation.x = jaw * 0.32

    // The lights in the sockets glance ahead of the head, and sink for a moment now and then.
    const glanceX = THREE.MathUtils.clamp((this.gaze.goal.yaw - this.gaze.yaw) * 0.1 + pose.yaw * 0.025, -0.03, 0.03)
    const glanceY = THREE.MathUtils.clamp((this.gaze.goal.pitch - this.gaze.pitch) * 0.1 + pose.pitch * 0.03, -0.03, 0.03)
    const flicker = 0.9 + 0.1 * Math.sin(t * 7.3) * Math.sin(t * 3.1)
    const eye = Math.max(this.face.eye, wake) * flicker
    for (let i = 0; i < this.embers.length; i++) {
      const x = (i ? 0.21 : -0.21) + glanceX
      this.embers[i].position.set(x, 0.165 + glanceY, 0.1)
      this.embers[i].scale.setScalar(0.03 + 0.05 * eye + 0.05 * wake)
      this.embers[i].material.opacity = 0.75 + 0.25 * eye
      this.halos[i].position.set(x, 0.165 + glanceY, 0.2)
      this.halos[i].scale.setScalar(0.12 + 0.45 * wake + 0.06 * eye)
      this.halos[i].material.opacity = 0.03 + 0.06 * eye + 0.3 * wake
    }

    // The little skull follows, a beat late, and shudders when the forest wakes.
    const lag = 1 - Math.exp(-1.6 * dt)
    this.littleLook.x += (this.gaze.goal.yaw * 0.8 + 0.3 - this.littleLook.x) * lag
    this.littleLook.y += (this.gaze.goal.pitch * 0.6 - this.littleLook.y) * lag
    this.little.rotation.set(-this.littleLook.y + 0.08, this.littleLook.x, 0.1 + wake * Math.sin(t * 41) * 0.05 + Math.sin(t * 0.5) * 0.02, 'YXZ')

    // Cold breath from the nose.
    if (t > this.nextBreath) {
      this.breathUntil = t + 1.2
      this.nextBreath = t + 1.2 + between(BREATHE_EVERY)
    }
    if (t < this.breathUntil && t > this.nextPuff) {
      this.nextPuff = t + 0.1
      const puff = this.puffs.find((p) => p.age >= 1)
      if (puff) {
        this.nose.getWorldPosition(puff.position)
        puff.velocity.set((Math.random() - 0.5) * 0.08, -0.1 + Math.random() * 0.05, 0.22 + Math.random() * 0.1)
        puff.age = 0
        puff.life = 2.4 + Math.random()
      }
    }
    const position = this.breath.geometry.attributes.position as THREE.BufferAttribute
    const ages = this.breath.geometry.attributes.aAge as THREE.BufferAttribute
    for (let i = 0; i < this.puffs.length; i++) {
      const p = this.puffs[i]
      if (p.age < 1) {
        p.age += dt / p.life
        p.velocity.multiplyScalar(1 - 0.7 * dt)
        p.velocity.y += 0.07 * dt
        p.position.addScaledVector(p.velocity, dt)
      }
      position.setXYZ(i, p.position.x, p.position.y, p.position.z)
      ages.setX(i, p.age < 1 ? p.age : -1)
    }
    position.needsUpdate = true
    ages.needsUpdate = true

    this.forest.uniforms.uTime.value = t
    this.forest.uniforms.uWake.value = wake
    this.wisps.uniforms.uTime.value = t
    this.wisps.uniforms.uWake.value = wake

    this.renderer.render(this.scene, this.camera)
    this.fpsCount++
    if (now - this.fpsSince > 1000) {
      this.renderedFps = this.fpsCount
      this.fpsCount = 0
      this.fpsSince = now
    }
  }

  debug() {
    return {
      style: 'wald',
      webgl: this.renderer.capabilities.isWebGL2 ? 2 : 1,
      headLoaded: true,
      renderedFps: this.renderedFps,
      yaw: Number(this.gaze.yaw.toFixed(3)),
      pitch: Number(this.gaze.pitch.toFixed(3)),
      goal: { ...this.gaze.goal },
      expression: { ...this.face },
    }
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    cancelAnimationFrame(this.raf)
    this.resizeObserver.disconnect()
    document.removeEventListener('visibilitychange', this.onVisibility)
    this.scene.traverse((object) => {
      if (!(object instanceof THREE.Mesh || object instanceof THREE.Points || object instanceof THREE.Sprite)) return
      object.geometry.dispose()
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) material.dispose()
    })
    for (const texture of this.textures) texture.dispose()
    this.renderer.dispose()
  }
}
