import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { GazeSpring } from '../GazeSpring'
import { addDarkBackdrop, DARK_BACKDROP } from '../darkBackdrop'
import type { Expression, HeadView, HeadViewOptions } from '../types'
import { FACE_GLOW, FACE_PAINT, FACE_PARS, FACE_ROUGHNESS, FILM_FRAGMENT, FILM_VERTEX } from './shaders'

/**
 * F.R.A.N.K. - the monster of the old horror films, on an old film print: a flat-topped
 * square skull with metal clamps where it was opened, a stitched forehead, a heavy brow over
 * half-closed eyes, a long hard mouth, big ears and two bolts in the neck. Everything is grey.
 * The bolts arc now and then, and when someone comes close the lids lift. The hard shadows are
 * baked into the vertices once: too dear to render live on the old iMacs. WebGL 1 safe.
 */

const FOV = 28
const CAM_DIST = 6.3
/** The head a little above the middle, so the neck with its bolts stays in frame. */
const CAM_Y = -0.22

const HEAD_Y = 1.08
/** The head turns around this point, at the top of the neck. */
const PIVOT = new THREE.Vector3(0, -0.85, 0)
/** The neck follows the head by this much. */
const NECK_FOLLOW = 0.35

const SKIN = 0xc4c4bf
/** Hard, from above and a little to one side: the shadows of brow and nose are the whole face. */
const KEY_DIRECTION = new THREE.Vector3(0.3, 0.72, 0.64).normalize()

const MOOD: Record<Expression, { smile: number; wide: number; charge: number }> = {
  neutral: { smile: 0, wide: 0, charge: 0 },
  curious: { smile: 0, wide: 1, charge: 0.5 },
  happy: { smile: 0.7, wide: 0.45, charge: 1 },
}
/** The bolts arc by themselves every so often (seconds). */
const ARC_EVERY = [6, 16]
const between = ([lo, hi]: number[]) => lo + Math.random() * (hi - lo)

const sstep = (lo: number, hi: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - lo) / (hi - lo)))
  return t * t * (3 - 2 * t)
}

/** Smooth interpolation through [y, value] pairs, sorted by y. */
function profile(table: number[][], y: number) {
  for (let i = 1; i < table.length; i++) {
    if (y <= table[i][0]) return table[i - 1][1] + (table[i][1] - table[i - 1][1]) * sstep(table[i - 1][0], table[i][0], y)
  }
  return table[table.length - 1][1]
}

/** Half-width and depth of the head from chin (-1) to crown (1). */
const WIDTH = [[-1, 0.34], [-0.8, 0.45], [-0.6, 0.55], [-0.4, 0.64], [-0.1, 0.685], [0.2, 0.7], [0.5, 0.7], [0.8, 0.66], [1, 0.6]]
const DEPTH = [[-1, 0.56], [-0.7, 0.68], [-0.4, 0.73], [0.1, 0.78], [0.5, 0.78], [0.8, 0.74], [1, 0.66]]

/** Must say the same as `hairlineY` in shaders.ts. */
function hairlineY(side: number, z: number) {
  const front = 0.84 - 0.66 * sstep(0.42, 0.64, side) - 0.06 * Math.exp(-(((side - 0.39) / 0.035) ** 2))
  return -0.75 + (front + 0.75) * sstep(-0.02, 0.2, z)
}

/** How far the face stands out of the plain block at (x, y). */
function relief(x: number, y: number) {
  const side = Math.abs(x)
  const bump = (cx: number, cy: number, rx: number, ry: number) => Math.exp(-(((side - cx) / rx) ** 2) - (((y - cy) / ry) ** 2))
  // The fold from the wing of the nose to the corner of the mouth, cut as a groove.
  const along = THREE.MathUtils.clamp(((side - 0.2) * 0.17 + (y + 0.2) * -0.32) / (0.17 * 0.17 + 0.32 * 0.32), 0, 1)
  const fold = Math.exp(-((Math.hypot(side - (0.2 + 0.17 * along), y - (-0.2 - 0.32 * along)) / 0.028) ** 2))
  return 0.03 * bump(0, 0.6, 0.5, 0.2) // forehead
    + 0.1 * bump(0.27, 0.33, 0.36, 0.08) // the shelf of the brow
    + 0.05 * bump(0, 0.3, 0.12, 0.07) // between the brows
    - 0.14 * bump(0.31, 0.11, 0.2, 0.1) // sockets
    + 0.06 * bump(0.305, 0.095, 0.13, 0.05) // heavy lids
    + 0.022 * bump(0.31, -0.03, 0.14, 0.035) // bags under the eyes
    + 0.15 * bump(0, 0.05, 0.095, 0.24) // bridge of the nose
    + 0.185 * bump(0, -0.12, 0.13, 0.095) // its tip
    + 0.09 * bump(0.16, -0.165, 0.065, 0.06) // its wings
    - 0.05 * bump(0.075, -0.215, 0.04, 0.02) // nostrils
    + 0.055 * bump(0, -0.38, 0.3, 0.14) // the long upper lip
    + 0.03 * bump(0, -0.485, 0.26, 0.03) // lips
    + 0.02 * bump(0, -0.565, 0.2, 0.035)
    - 0.015 * bump(0, -0.66, 0.2, 0.045) // under them
    + 0.13 * bump(0, -0.86, 0.2, 0.13) // chin
    + 0.05 * bump(0.52, -0.02, 0.16, 0.12) // cheekbones
    - 0.1 * bump(0.5, -0.42, 0.17, 0.2) // hollow cheeks
    - 0.03 * fold
}

/** The front of the head as a grid of depths: for the baked shadows and to set things on the skin. */
class DepthGrid {
  private static CELL = 0.02
  private static COLS = 96
  private static ROWS = 126
  private cells = new Float32Array(DepthGrid.COLS * DepthGrid.ROWS)

  constructor(position: THREE.BufferAttribute) {
    const { COLS, ROWS, CELL } = DepthGrid
    for (let i = 0; i < position.count; i++) {
      const z = position.getZ(i)
      if (z <= 0) continue
      const col = Math.round(position.getX(i) / CELL + COLS / 2), row = Math.round(position.getY(i) / CELL + ROWS / 2)
      if (col < 0 || row < 0 || col >= COLS || row >= ROWS) continue
      this.cells[row * COLS + col] = Math.max(this.cells[row * COLS + col], z)
    }
    // Close the gaps where vertices lie further apart than a cell.
    const filled = this.cells.slice()
    for (let row = 1; row < ROWS - 1; row++) {
      for (let col = 1; col < COLS - 1; col++) {
        if (this.cells[row * COLS + col]) continue
        filled[row * COLS + col] = Math.max(this.cells[row * COLS + col - 1], this.cells[row * COLS + col + 1], this.cells[(row - 1) * COLS + col], this.cells[(row + 1) * COLS + col])
      }
    }
    this.cells = filled
  }

  /** Depth of the skin at (x, y), bilinear. */
  at(x: number, y: number) {
    const { COLS, ROWS, CELL } = DepthGrid
    const u = x / CELL + COLS / 2, v = y / CELL + ROWS / 2
    const col = Math.floor(u), row = Math.floor(v)
    if (col < 0 || row < 0 || col >= COLS - 1 || row >= ROWS - 1) return 0
    const a = this.cells[row * COLS + col], b = this.cells[row * COLS + col + 1]
    const c = this.cells[(row + 1) * COLS + col], d = this.cells[(row + 1) * COLS + col + 1]
    const fx = u - col, fy = v - row
    return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy
  }
}

/**
 * A square block with a flat top and a long jaw, its vertices crowded onto the face. UVs seen
 * from the front. Comes with the grid of its depths.
 */
function headGeometry() {
  const geometry = new THREE.SphereGeometry(1, 160, 170)
  // The seam of the sphere goes to the back.
  geometry.rotateY(-Math.PI / 2)
  const position = geometry.attributes.position as THREE.BufferAttribute
  const uv = geometry.attributes.uv as THREE.BufferAttribute
  for (let i = 0; i < position.count; i++) {
    const unitY = position.getY(i)
    const around = Math.atan2(position.getX(i), position.getZ(i))
    const angle = around - 0.58 * Math.sin(around)
    const ring = Math.hypot(position.getX(i), position.getZ(i))
    // Square seen from above, flat on top, rounder towards the chin.
    const box = (Math.abs(Math.sin(angle)) ** 3 + Math.abs(Math.cos(angle)) ** 3) ** (-1 / 3)
    const power = unitY > 0 ? 5 : 3.6
    const scale = (ring ** power + Math.abs(unitY) ** power) ** (-1 / power)
    const y = unitY * scale
    const px = Math.sin(angle) * box * ring * scale
    const pz = Math.cos(angle) * box * ring * scale
    const back = pz < 0 ? 1.05 * (1 - 0.65 * sstep(0.3, 0.9, -y)) : 1
    let sx = px * profile(WIDTH, y)
    const sy = y * HEAD_Y
    let sz = pz * profile(DEPTH, y) * back + relief(sx, sy) * sstep(0.15, 0.6, pz)
    // The hair lies on the skull as a thick mat, with an edge over the forehead.
    const cap = sstep(-0.035, 0.035, sy - hairlineY(Math.abs(sx), sz))
    sz += cap * 0.03 * Math.max(pz, 0)
    sx += cap * 0.022 * Math.sign(sx) * Math.min(1, Math.abs(px) * 1.5)
    position.setXYZ(i, sx, sy, sz)
    uv.setXY(i, sx / 1.6 + 0.5, sy / 2.16 + 0.5)
  }
  geometry.computeVertexNormals()
  const depth = new DepthGrid(position)
  bakeShadows(geometry, depth)
  return { geometry, depth }
}

/** Walks from every vertex towards the key light: whatever lies on the way shades it. Vertex colours. */
function bakeShadows(geometry: THREE.BufferGeometry, depth: DepthGrid) {
  const position = geometry.attributes.position as THREE.BufferAttribute
  const normal = geometry.attributes.normal as THREE.BufferAttribute
  const colors = new Float32Array(position.count * 3)
  const L = KEY_DIRECTION
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i), y = position.getY(i), z = position.getZ(i)
    let shade = 1
    if (z > 0.05) {
      let shadow = 0
      for (let s = 0.03; s < 0.9; s += 0.03) {
        const over = depth.at(x + L.x * s, y + L.y * s) - (z + L.z * s) - 0.018
        if (over > 0) shadow = Math.max(shadow, Math.min(1, over / (0.022 + 0.13 * s)))
      }
      // Hollows are dark even out of the light's way: how far the skin lies below its surroundings.
      let around = 0
      for (const [dx, dy] of [[0.07, 0], [-0.07, 0], [0, 0.07], [0, -0.07], [0.05, 0.05], [-0.05, 0.05], [0.05, -0.05], [-0.05, -0.05]]) {
        around += Math.max(0, depth.at(x + dx, y + dy) - z)
      }
      // Round the sides of the head the light does this by itself, and the grid is too coarse.
      const facing = sstep(0.3, 0.62, normal.getZ(i))
      shade = 1 - facing * (1 - (1 - 0.76 * shadow) * (1 - Math.min(0.5, around * 1.2)))
    }
    colors[i * 3] = colors[i * 3 + 1] = colors[i * 3 + 2] = shade
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
}

/** Grease paint in greys: pores, furrows, the brows, the bags under the eyes and the scars. Drawn in head units. */
function skinTexture() {
  const size = 1024
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, size, size)
  const px = (x: number) => (x / 1.6 + 0.5) * size
  const py = (y: number) => (0.5 - y / 2.16) * size

  const trace = (points: number[][]) => {
    ctx.beginPath()
    points.forEach(([x, y], i) => (i ? ctx.lineTo(px(x), py(y)) : ctx.moveTo(px(x), py(y))))
    ctx.stroke()
  }
  /** A crease: dark in the middle, a line of light beside it, so that it reads as cut into the skin. */
  const crease = (points: number[][], width: number, alpha: number, blur = 1.6) => {
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.filter = `blur(${blur}px)`
    ctx.strokeStyle = `rgba(20, 20, 20, ${alpha})`
    ctx.lineWidth = width
    trace(points)
    ctx.filter = 'none'
  }
  const both = (draw: (x: (v: number) => number) => void) => {
    draw((v) => -v)
    draw((v) => v)
  }

  // Pores and blotches.
  for (let i = 0; i < 26000; i++) {
    ctx.fillStyle = `rgba(30, 30, 30, ${0.03 + Math.random() * 0.1})`
    ctx.fillRect(Math.random() * size, Math.random() * size, 1 + Math.random() * 1.6, 1 + Math.random() * 1.6)
  }
  for (let i = 0; i < 70; i++) {
    const x = Math.random() * size, y = Math.random() * size, r = 25 + Math.random() * 90
    const stain = ctx.createRadialGradient(x, y, 0, x, y, r)
    stain.addColorStop(0, `rgba(50, 50, 50, ${0.04 + Math.random() * 0.1})`)
    stain.addColorStop(1, 'rgba(50, 50, 50, 0)')
    ctx.fillStyle = stain
    ctx.fillRect(x - r, y - r, r * 2, r * 2)
  }

  // Furrows across the forehead, a little broken.
  for (const y of [0.52, 0.63]) {
    const points = []
    for (let x = -0.46; x <= 0.46; x += 0.07) points.push([x, y + 0.012 * Math.sin(x * 9 + y * 30) + (Math.random() - 0.5) * 0.008])
    crease(points, 6, 0.16, 3.5)
  }

  both((x) => {
    // The socket falls away dark around the eye, up into the brow; the hollow of the cheek.
    const blob = (cx: number, cy: number, rx: number, ry: number, alpha: number) => {
      ctx.save()
      ctx.translate(px(x(cx)), py(cy))
      ctx.scale(rx / 1.6 * size, ry / 2.16 * size)
      const dark = ctx.createRadialGradient(0, 0, 0, 0, 0, 1)
      dark.addColorStop(0, `rgba(12, 12, 12, ${alpha})`)
      dark.addColorStop(0.55, `rgba(12, 12, 12, ${alpha * 0.7})`)
      dark.addColorStop(1, 'rgba(12, 12, 12, 0)')
      ctx.fillStyle = dark
      ctx.fillRect(-1, -1, 2, 2)
      ctx.restore()
    }
    blob(0.31, 0.13, 0.27, 0.16, 0.58)
    blob(0.52, -0.45, 0.22, 0.3, 0.26)
    blob(0.42, -0.8, 0.2, 0.3, 0.3)
    crease([[x(0.08), 0.3], [x(0.28), 0.315], [x(0.5), 0.27]], 24, 0.42, 7)
    // The brows: a thick dark mass of short hairs along the shelf.
    for (let i = 0; i < 170; i++) {
      const t = Math.random()
      const bx = 0.09 + 0.43 * t
      const by = 0.305 - 0.18 * (t - 0.42) ** 2 + (Math.random() - 0.5) * (0.045 - 0.025 * t)
      ctx.strokeStyle = `rgba(10, 10, 10, ${0.25 + Math.random() * 0.35})`
      ctx.lineWidth = 1.5 + Math.random() * 2
      trace([[x(bx), by], [x(bx + 0.025 + Math.random() * 0.02), by + 0.012 + Math.random() * 0.018]])
    }
    // The crease over the lid, and the wrinkled bags under the eye.
    crease([[x(0.17), 0.125], [x(0.24), 0.155], [x(0.3), 0.165], [x(0.37), 0.155], [x(0.45), 0.115]], 7, 0.8, 2.6)
    for (const [drop, a] of [[0, 0.7], [0.04, 0.34], [0.085, 0.22]]) {
      const points = []
      for (let t = 0; t <= 1; t += 0.1) {
        const across = 2 * t - 1
        points.push([x(0.3 + (0.12 + drop * 0.5) * across), 0.012 - drop + (0.038 + drop * 0.1) * across * across + (Math.random() - 0.5) * 0.005])
      }
      crease(points, 3, a, 1.8)
    }
    for (let i = 0; i < 3; i++) crease([[x(0.45), 0.08 - i * 0.035], [x(0.53), 0.09 - i * 0.055]], 3, 0.22, 2) // crow's feet
    // Beside the nose, the nostril, the fold down to the mouth and on to the jaw.
    crease([[x(0.08), 0.1], [x(0.095), -0.03], [x(0.125), -0.09]], 6, 0.3, 4)
    crease([[x(0.205), -0.12], [x(0.222), -0.17], [x(0.19), -0.22]], 5, 0.45, 2.4)
    crease([[x(0.115), -0.218], [x(0.06), -0.222]], 9, 0.85, 2)
    crease([[x(0.225), -0.2], [x(0.28), -0.3], [x(0.34), -0.42], [x(0.375), -0.56]], 9, 0.42, 4)
    crease([[x(0.36), -0.6], [x(0.34), -0.74], [x(0.26), -0.86]], 6, 0.24, 3.5)
  })
  // The dimple of the upper lip, the shadow over the chin, the crease under the lip.
  crease([[-0.025, -0.28], [-0.03, -0.46]], 3, 0.22, 2.5)
  crease([[0.025, -0.28], [0.03, -0.46]], 3, 0.22, 2.5)
  crease([[-0.17, -0.67], [-0.08, -0.705], [0.08, -0.705], [0.17, -0.67]], 9, 0.5, 4)
  crease([[-0.09, 0.42], [-0.06, 0.32]], 4, 0.45, 2)
  crease([[0.09, 0.42], [0.06, 0.32]], 4, 0.45, 2)

  // The big scar, down from the clamp to the brow, jagged and dark; a cut on the cheek.
  const scar = [[-0.33, 0.78], [-0.32, 0.72], [-0.3, 0.67], [-0.315, 0.62], [-0.29, 0.56], [-0.285, 0.5], [-0.26, 0.44], [-0.25, 0.37]]
  crease(scar, 6, 0.4, 1.6)
  crease(scar, 2.6, 1, 0.5)
  crease([[-0.46, -0.335], [-0.41, -0.385], [-0.37, -0.4]], 4, 0.9, 0.7)
  crease([[0.33, 0.68], [0.36, 0.72], [0.37, 0.78]], 3, 0.6, 1)

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 4
  return texture
}

/** A cupped ear with a rim, big and standing out from the head. Inner parts are darkened in its vertex colours. */
function earGeometry() {
  const geometry = new THREE.PlaneGeometry(2, 2, 30, 42)
  const position = geometry.attributes.position as THREE.BufferAttribute
  const colors = new Float32Array(position.count * 3)
  for (let i = 0; i < position.count; i++) {
    const u = position.getX(i), v = position.getY(i)
    // The square onto a disc.
    const dx = u * Math.sqrt(1 - (v * v) / 2), dy = v * Math.sqrt(1 - (u * u) / 2)
    const r = Math.hypot(dx, dy)
    const rim = Math.exp(-(((r - 0.88) / 0.1) ** 2))
    const fold = Math.exp(-(((r - 0.56) / 0.08) ** 2))
    const bowl = Math.exp(-(((r - 0.28) / 0.3) ** 2))
    // Wider at the top, narrowing to the lobe.
    const narrow = 1 - 0.3 * sstep(0.2, -1, dy)
    position.setXYZ(i, dx * 0.2 * narrow, dy * 0.31, 0.04 * rim + 0.018 * fold - 0.05 * bowl)
    const shade = 0.68 * (1 - 0.85 * bowl - 0.3 * Math.exp(-(((r - 0.72) / 0.05) ** 2)))
    colors[i * 3] = colors[i * 3 + 1] = colors[i * 3 + 2] = Math.max(0.05, shade)
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  geometry.computeVertexNormals()
  return geometry
}

/** A long thick neck, folded across, its cords running down to the throat. Under the chin it lies in shadow. */
function neckGeometry() {
  const geometry = new THREE.CylinderGeometry(0.53, 0.6, 1.1, 56, 80, true)
  const position = geometry.attributes.position as THREE.BufferAttribute
  const colors = new Float32Array(position.count * 3)
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i), y = position.getY(i), z = position.getZ(i)
    const around = Math.atan2(x, z)
    const t = (y + 0.55) / 1.1
    const wobble = Math.sin(around * 3.1) * 0.05 + Math.sin(around * 7.3) * 0.02
    // Fine, broken wrinkles, deeper towards the collar.
    const folds = (0.6 * Math.sin((y + wobble) * 96) + 0.4 * Math.sin((y - wobble * 2) * 41 + around * 3)) * Math.sin(around * 2.3 + y * 7) * (0.35 + 0.65 * (1 - t))
    // Two cords from behind the ears to the middle of the throat.
    const cordAt = 1.15 - 0.95 * (1 - t)
    const cord = Math.exp(-(((Math.abs(around) - cordAt) / 0.14) ** 2))
    const out = 1 + 0.005 * folds + 0.05 * cord
    position.setXYZ(i, x * out, y, z * out * 0.84 - 0.08)
    const shadow = sstep(0.22, 0.8, t) * (0.55 + 0.45 * Math.max(0, Math.cos(around)))
    const shade = 0.5 * (1 - 0.97 * shadow) * (0.82 + 0.22 * folds) * (0.72 + 0.28 * cord) * (0.12 + 0.88 * sstep(0.08, 0.3, t)) * (0.5 + 0.5 * sstep(1.75, 0.55, Math.abs(around)))
    colors[i * 3] = colors[i * 3 + 1] = colors[i * 3 + 2] = Math.max(0.015, shade)
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  geometry.computeVertexNormals()
  return geometry
}

/** A neck bolt along +y from the neck outwards, in turned steps. */
function boltGeometry() {
  const steps = [[0, 0], [0.058, 0], [0.058, 0.07], [0.073, 0.078], [0.073, 0.112], [0.05, 0.12], [0.05, 0.14], [0.08, 0.152], [0.085, 0.235], [0.062, 0.25], [0, 0.25]]
  return new THREE.LatheGeometry(steps.map(([r, y]) => new THREE.Vector2(r, y)), 28)
}

/** A clamp: a plate gripping the edge of the scalp, a bent strip from it down the forehead, ending in a rivet. */
function clampGeometry(depth: DepthGrid, side: number) {
  const x = side * 0.39
  const on = (px: number, y: number, lift: number) => new THREE.Vector3(px, y, depth.at(px, y) + lift)
  const hook = new THREE.CatmullRomCurve3([
    on(x - side * 0.01, 0.88, 0.02),
    on(x - side * 0.016, 0.82, 0.03),
    on(x + side * 0.004, 0.76, 0.024),
    on(x + side * 0.02, 0.7, 0.016),
  ])
  const strap = new THREE.TubeGeometry(hook, 14, 0.013, 6, false)
  const plate = new THREE.BoxGeometry(0.075, 0.04, 0.016)
  const grip = on(x - side * 0.01, 0.875, 0.024)
  plate.rotateZ(side * 0.14)
  plate.translate(grip.x, grip.y, grip.z)
  const rivet = new THREE.SphereGeometry(0.019, 10, 8)
  const end = on(x + side * 0.022, 0.692, 0.014)
  rivet.translate(end.x, end.y, end.z)
  return mergeGeometries([strap.toNonIndexed(), plate.toNonIndexed(), rivet.toNonIndexed()])
}

/** Stitches across a seam: short lengths of thread standing off the skin, at these points. */
function stitchGeometry(depth: DepthGrid, seam: number[][]) {
  const parts = seam.map(([x, y], i) => {
    const lean = i % 2 ? 0.008 : -0.006
    const on = (px: number, py: number, lift: number) => new THREE.Vector3(px, py, depth.at(px, py) + lift)
    const thread = new THREE.CatmullRomCurve3([
      on(x - 0.02, y + lean, 0.002),
      on(x - 0.007, y + lean * 0.3, 0.01),
      on(x + 0.007, y - lean * 0.3, 0.01),
      on(x + 0.02, y - lean, 0.002),
    ])
    return new THREE.TubeGeometry(thread, 5, 0.0045, 4, false)
  })
  return mergeGeometries(parts)
}

/** Shoulders of a very large man in a dark jacket, open at the front. Lathe angle 0 looks at the viewer. */
function jacketGeometry() {
  const curve = new THREE.SplineCurve([
    [0.7, -1.5], [0.98, -1.6], [1.38, -1.76], [1.8, -2.02], [1.96, -2.5], [1.98, -3.4],
  ].map(([r, y]) => new THREE.Vector2(r, y)))
  return new THREE.LatheGeometry(curve.getSpacedPoints(24), 48, 0.62, Math.PI * 2 - 1.24)
}

/** The black sweater: closes round the neck, fills the front of the jacket. */
function sweaterGeometry() {
  const curve = new THREE.SplineCurve([
    [0.6, -1.56], [0.63, -1.52], [0.69, -1.56], [0.92, -1.76], [1.5, -2.2], [1.6, -3.2],
  ].map(([r, y]) => new THREE.Vector2(r, y)))
  return new THREE.LatheGeometry(curve.getSpacedPoints(20), 40)
}

/** Random noise that tiles: the film grain. */
function noiseTexture() {
  const size = 256
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')!
  const image = ctx.createImageData(size, size)
  for (let i = 0; i < image.data.length; i += 4) {
    image.data[i] = image.data[i + 1] = image.data[i + 2] = Math.random() * 255
    image.data[i + 3] = 255
  }
  ctx.putImageData(image, 0, 0)
  const texture = new THREE.CanvasTexture(canvas)
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping
  return texture
}

/** A strip of jagged discharges running to the right, one per row of the atlas: the arcs at the bolts. */
function arcTexture() {
  const width = 256, rows = 4, rowHeight = 64
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = rows * rowHeight
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#000000'
  ctx.fillRect(0, 0, width, canvas.height)
  ctx.lineCap = ctx.lineJoin = 'round'
  for (let row = 0; row < rows; row++) {
    const middle = (row + 0.5) * rowHeight
    for (let branch = 0; branch < 3; branch++) {
      const points: number[][] = [[0, middle]]
      const steps = 7 - branch * 2
      const lean = (Math.random() - 0.5) * 24 * branch
      for (let s = 1; s <= steps; s++) {
        points.push([(s / steps) * (width - branch * 60) * 0.95, middle + lean * (s / steps) + (Math.random() - 0.5) * 34 * Math.sin((s / steps) * Math.PI)])
      }
      for (const [lineWidth, color, blur] of [[9, '#6f6f6f', 6], [2.4, '#ffffff', 0.5]] as const) {
        ctx.filter = `blur(${blur}px)`
        ctx.strokeStyle = color
        ctx.lineWidth = lineWidth * (1 - branch * 0.25)
        ctx.beginPath()
        points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)))
        ctx.stroke()
        ctx.filter = 'none'
      }
    }
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.repeat.set(1, 1 / rows)
  return texture
}

export class FrankHead implements HeadView {
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 60)
  private turn = new THREE.Group()
  private neck = new THREE.Group()
  private textures: THREE.Texture[] = []
  private paint = {
    uLook: { value: new THREE.Vector2() },
    uBlink: { value: 0 },
    uSmile: { value: 0 },
    uWide: { value: 0 },
  }
  private wall: THREE.ShaderMaterial
  private film: THREE.ShaderMaterial
  private key: THREE.DirectionalLight
  private arcFlash: THREE.PointLight
  private arcMaterial: THREE.MeshBasicMaterial
  private arcTexture: THREE.Texture
  private gaze: GazeSpring
  private face = { smile: 0, wide: 0, charge: 0 }
  private faceTarget = { smile: 0, wide: 0, charge: 0 }
  private nextBlink = 2
  private blinkUntil = -1
  private arcUntil = -1
  private nextArc = 3 + Math.random() * 5
  private scratchUntil = -1
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
    this.gaze = new GazeSpring(opts.stiffness ?? 5, opts.delay ?? 0)
    this.nextBlink = 1 + Math.random() * 3

    const attributes: WebGLContextAttributes = { antialias: true, alpha: false, powerPreference: 'high-performance' }
    // A WebGL 1 context handed in keeps three.js on its WebGL 1 path, as on the old iMacs.
    const context = opts.webgl1 ? canvas.getContext('webgl', attributes) ?? undefined : undefined
    this.renderer = new THREE.WebGLRenderer({ canvas, context, ...attributes })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, opts.maxPixelRatio ?? 1.5))
    this.renderer.setClearColor(DARK_BACKDROP, 1)
    this.renderer.toneMapping = THREE.NeutralToneMapping

    this.camera.position.set(0, CAM_Y, CAM_DIST)
    this.camera.lookAt(0, CAM_Y, 0)

    // --- the studio -------------------------------------------------------------
    this.wall = addDarkBackdrop(this.scene)

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x1c1c1c, 0.46))
    this.key = new THREE.DirectionalLight(0xffffff, 3.9)
    this.key.position.copy(KEY_DIRECTION).multiplyScalar(6)
    const fill = new THREE.DirectionalLight(0xffffff, 0.34)
    fill.position.set(-4, 0, 4)
    const rim = new THREE.DirectionalLight(0xffffff, 1.1)
    rim.position.set(-3, 3, -5)
    this.arcFlash = new THREE.PointLight(0xffffff, 0, 3, 1.4)
    this.arcFlash.position.set(0, -1.15, 0.9)
    this.scene.add(this.key, fill, rim, this.arcFlash)

    // --- head ------------------------------------------------------------------
    const paintedSkin = skinTexture()
    this.textures.push(paintedSkin)
    const skin = new THREE.MeshStandardMaterial({ color: SKIN, map: paintedSkin, roughness: 0.66, vertexColors: true })
    skin.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.paint)
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vFace;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFace = position;')
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${FACE_PARS}`)
        // Painted first: the baked shadows in the vertex colours fall over eyes and hair too.
        .replace('#include <color_fragment>', `${FACE_PAINT}\n#include <color_fragment>`)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n${FACE_ROUGHNESS}`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${FACE_GLOW}`)
    }
    const head = new THREE.Group()
    const { geometry, depth } = headGeometry()
    head.add(new THREE.Mesh(geometry, skin))

    const earSkin = new THREE.MeshStandardMaterial({ color: SKIN, roughness: 0.7, vertexColors: true, side: THREE.DoubleSide })
    const steel = new THREE.MeshStandardMaterial({ color: 0xd2d2d2, roughness: 0.3, metalness: 0.45 })
    const darkSteel = new THREE.MeshStandardMaterial({ color: 0x6a6a6a, roughness: 0.42, metalness: 0.5 })
    for (const side of [-1, 1]) {
      const ear = new THREE.Mesh(earGeometry(), earSkin)
      ear.position.set(side * 0.73, -0.31, -0.08)
      ear.rotation.set(0, side * 0.62, side * -0.09)
      ear.scale.x = side
      head.add(ear)
      head.add(new THREE.Mesh(clampGeometry(depth, side), darkSteel))
    }
    const thread = new THREE.MeshStandardMaterial({ color: 0x1d1d1d, roughness: 0.75 })
    head.add(new THREE.Mesh(stitchGeometry(depth, [
      [-0.312, 0.73], [-0.308, 0.665], [-0.298, 0.595], [-0.287, 0.525], [-0.273, 0.46], [-0.255, 0.395],
      [-0.42, -0.37],
    ]), thread))

    head.position.copy(PIVOT).negate()
    this.turn.position.copy(PIVOT)
    this.turn.add(head)
    this.scene.add(this.turn)

    // --- neck and bolts: they follow the head a little ---------------------------
    const neckSkin = new THREE.MeshStandardMaterial({ color: SKIN, roughness: 0.74, vertexColors: true, side: THREE.DoubleSide })
    const neckMesh = new THREE.Mesh(neckGeometry(), neckSkin)
    neckMesh.position.y = -1.17
    this.neck.add(neckMesh)
    const arcSheet = arcTexture()
    this.arcTexture = arcSheet
    this.textures.push(arcSheet)
    this.arcMaterial = new THREE.MeshBasicMaterial({ map: arcSheet, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })
    for (const side of [-1, 1]) {
      const bolt = new THREE.Group()
      bolt.add(new THREE.Mesh(boltGeometry(), steel))
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.076, 0.076, 0.03, 24), darkSteel)
      band.position.y = 0.095
      bolt.add(band)
      bolt.position.set(side * 0.44, -1.02, 0.02)
      bolt.rotation.z = side * -Math.PI / 2
      this.neck.add(bolt)
      const arc = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.2), this.arcMaterial)
      arc.position.set(side * (0.44 + 0.25 + 0.3), -1.02, 0.03)
      arc.scale.x = side
      arc.renderOrder = 5
      this.neck.add(arc)
    }
    this.scene.add(this.neck)

    // --- jacket and black sweater: they do not turn ------------------------------
    const jacket = new THREE.MeshStandardMaterial({ color: 0x5c5c5c, roughness: 0.84, side: THREE.DoubleSide })
    const sweater = new THREE.MeshStandardMaterial({ color: 0x090909, roughness: 0.9, side: THREE.DoubleSide })
    // As flat as the neck that comes out of it.
    const sweaterMesh = new THREE.Mesh(sweaterGeometry(), sweater)
    sweaterMesh.scale.z = 0.84
    sweaterMesh.position.z = -0.08
    this.scene.add(sweaterMesh, new THREE.Mesh(jacketGeometry(), jacket))

    // --- the film over everything ------------------------------------------------
    const noise = noiseTexture()
    this.textures.push(noise)
    this.film = new THREE.ShaderMaterial({
      uniforms: {
        uNoise: { value: noise },
        uGrainScale: { value: new THREE.Vector2(1, 1) },
        uGrainOffset: { value: new THREE.Vector2() },
        uScratch: { value: -1 },
      },
      vertexShader: FILM_VERTEX,
      fragmentShader: FILM_FRAGMENT,
      transparent: true,
      // Only over the figure: the background stays the same on every scary head.
      depthFunc: THREE.GreaterDepth,
      depthWrite: false,
      toneMapped: false,
    })
    const print = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.film)
    print.frustumCulled = false
    print.renderOrder = 100
    this.scene.add(print)

    this.resizeObserver = new ResizeObserver(this.resize)
    this.resizeObserver.observe(canvas)
    this.resize()
    document.addEventListener('visibilitychange', this.onVisibility)
    this.tick()
  }

  private resize = () => {
    const w = this.canvas.clientWidth || window.innerWidth
    const h = this.canvas.clientHeight || window.innerHeight
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / h
    // Keep the head with its ears and bolts in frame on narrow screens.
    const halfFov = THREE.MathUtils.degToRad(FOV / 2)
    this.camera.position.z = Math.max(CAM_DIST, 2.5 / (2 * Math.tan(halfFov) * this.camera.aspect))
    this.camera.updateProjectionMatrix()
    // The grain stays the same size on every screen: one noise texel per pixel.
    this.film.uniforms.uGrainScale.value.set(w / 256, h / 256)
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
    const before = this.faceTarget.charge
    Object.assign(this.faceTarget, MOOD[expression])
    // Someone came close: it goes through him.
    if (this.faceTarget.charge > before) this.nextArc = 0
  }

  private tick = () => {
    if (this.disposed) return
    this.raf = requestAnimationFrame(this.tick)
    const now = performance.now()
    if (now - this.lastFrame < 1000 / this.fps - 2) return
    this.lastFrame = now
    const dt = Math.min(this.clock.getDelta(), 0.1)
    const t = this.clock.elapsedTime

    // He is slow: the smile takes its time, the lids follow a little faster.
    this.face.smile += (this.faceTarget.smile - this.face.smile) * (1 - Math.exp(-0.9 * dt))
    this.face.wide += (this.faceTarget.wide - this.face.wide) * (1 - Math.exp(-2.5 * dt))
    this.face.charge += (this.faceTarget.charge - this.face.charge) * (1 - Math.exp(-3 * dt))

    if (t > this.nextBlink) {
      this.blinkUntil = t + 0.3
      this.nextBlink = t + 4 + Math.random() * 7
    }
    const blink = Math.pow(Math.sin(THREE.MathUtils.clamp(1 - (this.blinkUntil - t) / 0.3, 0, 1) * Math.PI), 2)

    // The arcs: short bursts, more of them while someone is close.
    if (t > this.nextArc) {
      this.arcUntil = t + 0.35 + Math.random() * 0.5
      this.nextArc = t + between(ARC_EVERY) * (1 - 0.6 * this.face.charge)
    }
    const arcing = t < this.arcUntil
    const crackle = arcing && Math.random() < 0.72 ? 0.65 + Math.random() * 0.35 : 0
    this.arcMaterial.opacity = crackle
    if (crackle) this.arcTexture.offset.y = Math.floor(Math.random() * 4) / 4
    this.arcFlash.intensity = 2.2 * crackle

    // A hand-cranked lamp: the light breathes a little, frame by frame.
    const flicker = 1 + 0.025 * Math.sin(t * 13.7) * Math.sin(t * 7.1) + (Math.random() - 0.5) * 0.03
    this.key.intensity = 3.9 * flicker
    this.film.uniforms.uGrainOffset.value.set(Math.random(), Math.random())
    if (t > this.scratchUntil + 3 && Math.random() < 0.006) {
      this.scratchUntil = t + 0.1 + Math.random() * 0.45
      this.film.uniforms.uScratch.value = 0.1 + Math.random() * 0.8
    }
    if (t > this.scratchUntil) this.film.uniforms.uScratch.value = -1
    else this.film.uniforms.uScratch.value += (Math.random() - 0.5) * 0.002

    const pose = this.gaze.update(dt, t)
    this.turn.rotation.set(-pose.pitch, pose.yaw, 0.02 * Math.sin(t * 0.27), 'YXZ')
    this.neck.rotation.y = pose.yaw * NECK_FOLLOW
    this.paint.uLook.value.set(
      THREE.MathUtils.clamp((this.gaze.goal.yaw - this.gaze.yaw) * 1.2 + pose.yaw * 0.5, -1, 1),
      THREE.MathUtils.clamp((this.gaze.goal.pitch - this.gaze.pitch) * 1.2 + pose.pitch * 0.6, -1, 1),
    )
    this.paint.uBlink.value = blink
    this.paint.uSmile.value = this.face.smile
    this.paint.uWide.value = this.face.wide

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
      style: 'frank',
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
      if (!(object instanceof THREE.Mesh)) return
      object.geometry.dispose()
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) material.dispose()
    })
    for (const texture of this.textures) texture.dispose()
    this.wall.dispose()
    this.renderer.dispose()
  }
}
