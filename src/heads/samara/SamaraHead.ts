import * as THREE from 'three'
import { GazeSpring } from '../GazeSpring'
import type { Expression, HeadView, HeadViewOptions } from '../types'
import { BACKDROP_FRAGMENT, FACE_GLOW, FACE_PAINT, FACE_PARS, HAIR_MOVE, HAIR_PARS, PASS_VERTEX, TAPE_FRAGMENT, TAPE_VERTEX } from './shaders'

/**
 * S.A.M.A.R.A. - the girl from the well, as a close-up on a worn-out video tape: wet black
 * hair falling over a gaunt, cracked, grey-green face, one pale eye staring out of it, the
 * other lost in the dark. She hardly moves. When the tape skips she jumps, and when someone
 * stays she has come closer with every skip. WebGL 1 safe.
 */

const FOV = 28
const CAM_DIST = 5.25
const CAM_Y = -0.1

/** The head's half-size (head units). */
const HEAD_X = 0.7
const HEAD_Y = 1.06
const HEAD_Z = 0.8
/** The head turns around this point, at the top of the neck. */
const PIVOT = new THREE.Vector3(0, -0.9, 0)
/** Her head stays lowered: she looks up from under the brow. */
const BOW = 0.07
const KEY_LIGHT = 3.1

const MOOD: Record<Expression, { open: number; wide: number; near: number }> = {
  neutral: { open: 0, wide: 0, near: 0 },
  curious: { open: 0.1, wide: 1, near: 0.3 },
  happy: { open: 0.75, wide: 0.55, near: 1 },
}
/** How far she comes towards the glass, at most. */
const NEAR_Z = 0.95
/** One skip of the tape (seconds) and the time between them. */
const SKIP_LENGTH = [0.16, 0.42]
const SKIP_EVERY = [6, 17]
/** With someone there, the next jump towards them comes sooner. */
const STEP_EVERY = [0.7, 1.7]
const between = ([lo, hi]: number[]) => lo + Math.random() * (hi - lo)

/** The same hair every time: it is arranged to leave exactly this much of the face free. */
function seeded(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296
    return seed / 4294967296
  }
}

const smoothstep = THREE.MathUtils.smoothstep

/** The relief of the face on the unit sphere: a scowl, sunken eyes, a long nose. Not quite even. */
function relief(x: number, y: number, z: number) {
  const front = Math.max(z, 0)
  const side = Math.abs(x)
  const bump = (cx: number, cy: number, rx: number, ry: number) => Math.exp(-(((side - cx) / rx) ** 2) - (((y - cy) / ry) ** 2)) * front
  const browY = 0.205 + 0.17 * side // the brow sinks towards the nose
  return 0.1 * Math.exp(-(((side - 0.3) / 0.34) ** 2) - (((y - browY) / 0.07) ** 2)) * front
    - 0.035 * bump(0, 0.33, 0.035, 0.1) // the furrow between the brows
    - 0.16 * bump(0.36, 0.11, 0.17, 0.085) // sockets
    + 0.13 * bump(0, -0.02, 0.085, 0.24) // bridge of the nose
    + 0.09 * bump(0, -0.25, 0.1, 0.07) // its tip
    + 0.025 * bump(0.11, -0.3, 0.05, 0.04) // nostrils
    + 0.045 * bump(0.58, -0.08, 0.16, 0.11) // cheekbones
    - 0.11 * bump(0.5, -0.4, 0.2, 0.17) // hollow cheeks
    + 0.03 * bump(0, -0.45, 0.2, 0.035) // upper lip
    + 0.04 * bump(0, -0.54, 0.17, 0.04) // lower lip
    + 0.065 * bump(0, -0.8, 0.22, 0.1) // chin
}

/** How far the head narrows towards the chin, for a height on the unit sphere. */
const narrowing = (y: number) => smoothstep(-y, 0.2, 1)

function headGeometry() {
  const geometry = new THREE.SphereGeometry(1, 128, 96)
  const position = geometry.attributes.position as THREE.BufferAttribute
  const uv = geometry.attributes.uv as THREE.BufferAttribute
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i), y = position.getY(i), z = position.getZ(i)
    const chin = narrowing(y)
    const sx = x * HEAD_X * (1 - 0.24 * chin)
    const sy = y * HEAD_Y
    const sz = (z * HEAD_Z + relief(x, y, z)) * (1 - 0.06 * chin)
    position.setXYZ(i, sx, sy, sz)
    uv.setXY(i, sx / (2 * HEAD_X) + 0.5, sy / (2 * HEAD_Y) + 0.5)
  }
  geometry.computeVertexNormals()
  return geometry
}

/** The front of the face at (x, y) in head units: what a strand has to clear. */
function faceZ(x: number, y: number) {
  const ny = THREE.MathUtils.clamp(y / HEAD_Y, -1, 1)
  const chin = narrowing(ny)
  const nx = x / (HEAD_X * (1 - 0.24 * chin))
  const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny))
  return (nz * HEAD_Z + relief(nx, ny, nz)) * (1 - 0.06 * chin)
}

/** The solid hair behind the strands, as wide as this at height y. */
function massRadius(y: number) {
  const top = 1.13
  if (y > 0.4) return 0.98 * Math.sqrt(Math.max(0, 1 - ((y - 0.4) / (top - 0.4)) ** 2))
  return 0.98 + 0.05 * smoothstep(-y, 0.2, 2.2)
}
const MASS_DEPTH = 0.62
const MASS_BACK = 0.24
function massZ(x: number, y: number) {
  const r = massRadius(y)
  return Math.sqrt(Math.max(0, r * r - x * x)) * MASS_DEPTH - MASS_BACK
}

function massGeometry() {
  const points: THREE.Vector2[] = []
  // From the bottom up: that way the lathe's faces look outwards.
  for (let i = 0; i <= 60; i++) {
    const y = -2.97 + (i / 60) * 4.1
    points.push(new THREE.Vector2(massRadius(y), y))
  }
  const geometry = new THREE.LatheGeometry(points, 64)
  geometry.scale(1, 1, MASS_DEPTH)
  geometry.translate(0, 0, -MASS_BACK)
  geometry.computeVertexNormals()
  return geometry
}

/** Straight lines through a table of [y, x], from the top down. */
function table(rows: number[][], y: number) {
  for (let i = 1; i < rows.length; i++) {
    if (y >= rows[i][0]) {
      const [y0, x0] = rows[i - 1], [y1, x1] = rows[i]
      return x1 + (x0 - x1) * ((y - y1) / (y0 - y1))
    }
  }
  return rows[rows.length - 1][1]
}

/** Where the curtain of hair begins, on either side of the face. Over her other eye it closes. */
const OPENING_RIGHT = [[1.1, 0.03], [0.74, 0.07], [0.5, 0.2], [0.2, 0.37], [-0.1, 0.39], [-0.4, 0.33], [-0.75, 0.29], [-1.05, 0.24], [-3, 0.2]]
const OPENING_LEFT = [[1.1, 0.03], [0.74, 0.05], [0.5, 0.11], [0.25, 0.14], [0.05, 0.2], [-0.15, 0.25], [-0.45, 0.27], [-0.75, 0.27], [-1.05, 0.23], [-3, 0.2]]

interface Strand {
  curve: THREE.Curve<THREE.Vector3>
  radius: number
  shade: number
}

/** One mesh of thin tapering three-sided tubes; 16-bit indices are plenty, and always there on WebGL 1. */
function strandsGeometry(strands: Strand[]) {
  const SEGMENTS = 20, SIDES = 3
  const ringCount = SEGMENTS + 1
  const vertices = strands.length * ringCount * SIDES
  if (vertices > 65535) throw new Error('S.A.M.A.R.A.: too many strands')
  const positions = new Float32Array(vertices * 3)
  const normals = new Float32Array(vertices * 3)
  const colors = new Float32Array(vertices * 3)
  const indices = new Uint16Array(strands.length * SEGMENTS * SIDES * 6)
  const point = new THREE.Vector3(), tangent = new THREE.Vector3()
  const across = new THREE.Vector3(), other = new THREE.Vector3(), normal = new THREE.Vector3()
  const toViewer = new THREE.Vector3(0, 0, 1)
  let v = 0, n = 0
  for (const { curve, radius, shade } of strands) {
    const first = v
    for (let s = 0; s < ringCount; s++) {
      const u = s / SEGMENTS
      curve.getPoint(u, point)
      curve.getTangent(u, tangent)
      across.crossVectors(tangent, toViewer).normalize()
      other.crossVectors(across, tangent)
      // Thick at the root, wet ends running out to a point. Darker at the root, too.
      const r = radius * (1 - 0.88 * u * u * u)
      const light = shade * (0.6 + 0.4 * smoothstep(u, 0, 0.3))
      for (let side = 0; side < SIDES; side++) {
        const angle = (side / SIDES) * Math.PI * 2
        normal.copy(across).multiplyScalar(Math.cos(angle)).addScaledVector(other, Math.sin(angle))
        positions.set([point.x + normal.x * r, point.y + normal.y * r, point.z + normal.z * r], v * 3)
        normals.set([normal.x, normal.y, normal.z], v * 3)
        colors.set([light * 0.92, light, light], v * 3)
        v++
      }
    }
    for (let s = 0; s < SEGMENTS; s++) {
      for (let side = 0; side < SIDES; side++) {
        const a = first + s * SIDES + side
        const b = first + s * SIDES + (side + 1) % SIDES
        const c = a + SIDES, d = b + SIDES
        indices.set([a, b, c, b, d, c], n)
        n += 6
      }
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3))
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  geometry.setIndex(new THREE.BufferAttribute(indices, 1))
  return geometry
}

/** How high a strand has to stay over whatever is underneath it. */
function clearZ(x: number, y: number, gap: number) {
  let z = massZ(x, y)
  // A look to either side: between two points the strand must not dive into the brow or the nose.
  for (const dy of [-0.09, 0, 0.09]) for (const dx of [-0.04, 0, 0.04]) z = Math.max(z, faceZ(x + dx, y + dy))
  return z + gap
}

function hairStrands() {
  const random = seeded(1998)
  const strands: Strand[] = []
  const HEIGHTS = [1, 0.9, 0.78, 0.63, 0.48, 0.34, 0.2, 0.05, -0.1, -0.25, -0.4, -0.55, -0.72, -0.9, -1.2, -1.6]

  // The curtain: from the parting over the temples, down to the shoulders.
  for (let i = 0; i < 260; i++) {
    const side = i % 2 ? 1 : -1
    const opening = side > 0 ? OPENING_RIGHT : OPENING_LEFT
    const across = Math.pow(random(), 1.15)
    const outer = 0.88 + 0.12 * random()
    const gap = 0.012 + 0.07 * across * random()
    // Wet hair runs together in clumps: strands with the same position share a wave.
    const clump = Math.floor(across * 16)
    const phase = clump * 2.4 + side, reach = 0.012 + 0.018 * across
    const rootZ = 0.08 + 0.46 * random()
    const points = [new THREE.Vector3(
      side * (0.008 + 0.02 * random()),
      HEAD_Y * Math.sqrt(1 - (rootZ / HEAD_Z) ** 2) + 0.018,
      rootZ,
    )]
    for (const y of HEIGHTS) {
      if (y > points[0].y - 0.06) continue
      const inner = table(opening, y)
      const wave = reach * Math.sin(phase + y * 4.3)
      // Over the dome of the skull it can only be as wide as the skull.
      const x = side * Math.min(inner + (outer - inner) * across + wave, massRadius(y) + 0.012)
      points.push(new THREE.Vector3(x, y, clearZ(x, y, gap)))
    }
    const end = -1.9 - 0.8 * random()
    const last = points[points.length - 1]
    points.push(new THREE.Vector3(last.x * (1 + 0.04 * random()), end, last.z))
    strands.push({
      curve: new THREE.CatmullRomCurve3(points),
      radius: 0.01 + 0.019 * random(),
      shade: 0.5 + 1.9 * random() * random(),
    })
  }

  // Loose strands across the face: [x at the forehead, x at the chin, thickness].
  const loose = [
    [0.02, -0.17, 0.011], [-0.03, -0.15, 0.006], [0.06, 0.1, 0.008], [0.09, 0.2, 0.0065],
    [-0.02, 0.05, 0.0055], [0.14, 0.29, 0.009], [0.17, 0.12, 0.0045], [-0.07, -0.2, 0.0095],
    [-0.1, -0.09, 0.005], [0.05, -0.04, 0.0042], [0.12, -0.08, 0.0048], [-0.05, 0.14, 0.0042],
    [0.19, 0.25, 0.0065], [-0.12, -0.26, 0.012], [0.03, 0.17, 0.0048], [-0.15, -0.24, 0.009],
  ]
  for (const [top, bottom, radius] of loose) {
    const rootZ = 0.3 + 0.25 * random()
    const points = [new THREE.Vector3(top * 0.2, HEAD_Y * Math.sqrt(1 - (rootZ / HEAD_Z) ** 2) + 0.016, rootZ)]
    const phase = random() * 6.28
    for (const y of [0.82, 0.64, 0.44, 0.24, 0.04, -0.16, -0.36, -0.56, -0.78, -1, -1.3]) {
      const f = THREE.MathUtils.clamp((0.7 - y) / 1.7, 0, 1)
      const x = top + (bottom - top) * f + 0.014 * Math.sin(phase + y * 6)
      points.push(new THREE.Vector3(x, y, clearZ(x, y, 0.014 + 0.014 * random())))
    }
    strands.push({ curve: new THREE.CatmullRomCurve3(points), radius, shade: 0.8 + 0.9 * random() })
  }

  // Stray hairs round the outside, against the light.
  for (let i = 0; i < 36; i++) {
    const side = i % 2 ? 1 : -1
    const start = 1.08 + 0.1 * random(), wander = 0.05 + 0.1 * random()
    const phase = random() * 6.28
    const points: THREE.Vector3[] = []
    for (let y = 0.7; y > -2.6; y -= 0.4) {
      const x = side * (Math.min(massRadius(y), start) + wander * Math.sin(phase + y * 1.9) + 0.02)
      points.push(new THREE.Vector3(x, y, -0.05 + 0.2 * random()))
    }
    strands.push({ curve: new THREE.CatmullRomCurve3(points), radius: 0.004 + 0.006 * random(), shade: 1 })
  }
  return strands
}

/** The skin of someone a long time under water: a fine weave, stains, cracks, mud round the mouth. */
function skinTexture() {
  const size = 1024
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')!
  const random = seeded(7)
  const fx = (x: number) => (x / (2 * HEAD_X) + 0.5) * size
  const fy = (y: number) => (0.5 - y / (2 * HEAD_Y)) * size
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, size, size)

  const blotch = (x: number, y: number, r: number, color: string, alpha: number) => {
    const stain = ctx.createRadialGradient(x, y, 0, x, y, r)
    stain.addColorStop(0, `rgba(${color}, ${alpha})`)
    stain.addColorStop(1, `rgba(${color}, 0)`)
    ctx.fillStyle = stain
    ctx.fillRect(x - r, y - r, r * 2, r * 2)
  }
  for (let i = 0; i < 130; i++) {
    blotch(random() * size, random() * size, 18 + random() * 80, i % 4 ? '38, 52, 46' : '62, 58, 42', 0.06 + random() * 0.15)
  }
  // The mud gets denser towards the chin.
  for (let i = 0; i < 90; i++) {
    const x = fx((random() - 0.5) * 0.62), y = fy(-0.42 - random() * 0.62)
    blotch(x, y, 10 + random() * 46, '24, 24, 18', 0.22 + random() * 0.32)
  }
  // The weave, as if she is seen through the mesh of the screen.
  ctx.strokeStyle = 'rgba(20, 30, 28, 0.1)'
  ctx.lineWidth = 1
  ctx.beginPath()
  for (let i = 0; i < size; i += 4) {
    ctx.moveTo(i, 0)
    ctx.lineTo(i, size)
    ctx.moveTo(0, i)
    ctx.lineTo(size, i)
  }
  ctx.stroke()

  const line = (points: number[][], width: number, alpha: number, blur = 0) => {
    ctx.filter = blur ? `blur(${blur}px)` : 'none'
    ctx.strokeStyle = `rgba(14, 20, 18, ${alpha})`
    ctx.lineWidth = width
    ctx.lineCap = 'round'
    ctx.beginPath()
    points.forEach(([x, y], i) => (i ? ctx.lineTo(fx(x), fy(y)) : ctx.moveTo(fx(x), fy(y))))
    ctx.stroke()
    ctx.filter = 'none'
  }
  // The scowl: creases above the nose, furrows across the forehead, deep lines by nose and mouth.
  for (const side of [-1, 1]) {
    line([[side * 0.022, 0.42], [side * 0.042, 0.33], [side * 0.03, 0.22]], 7, 0.75, 2)
    line([[side * 0.075, 0.37], [side * 0.09, 0.28]], 5, 0.5, 2)
    line([[side * 0.09, -0.26], [side * 0.15, -0.38], [side * 0.195, -0.5]], 7, 0.6, 3)
    line([[side * 0.1, 0.04], [side * 0.2, -0.01], [side * 0.3, 0.02]], 6, 0.55, 3)
    line([[side * 0.2, -0.56], [side * 0.17, -0.68]], 6, 0.6, 3)
  }
  for (const y of [0.47, 0.53, 0.59]) line([[-0.26, y - 0.02], [-0.1, y + 0.012], [0.08, y - 0.006], [0.27, y + 0.016]], 3, 0.42, 1.5)

  // Cracks: random walks that split up, starting where the skin is under strain.
  const crack = (x: number, y: number, angle: number, length: number, width: number) => {
    const points = [[x, y]]
    for (let i = 0; i < length; i++) {
      angle += (random() - 0.5) * 1
      x += Math.cos(angle) * 0.022
      y += Math.sin(angle) * 0.022
      points.push([x, y])
      if (random() < 0.13 && width > 1) crack(x, y, angle + (random() < 0.5 ? 1 : -1) * (0.5 + random()), Math.floor(length * 0.55), width * 0.65)
    }
    line(points, width, 0.8)
  }
  for (const [x, y, angle] of [
    [0.1, 0.56, -1.6], [0.17, 0.49, -2.5], [-0.04, 0.52, -1.3], [0.2, 0.34, -0.5], [0.04, 0.44, -0.8],
    [0.3, -0.12, -1.4], [0.24, -0.25, -2.4], [-0.25, -0.12, -1.8], [0.11, -0.62, -1.1], [-0.08, -0.66, -2], [0.2, -0.76, -0.9], [-0.15, -0.82, -2.2],
  ]) crack(x, y, angle, 6 + Math.floor(random() * 7), 2.4)

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 4
  return texture
}

/** Dark trunks and pale gaps, far out of focus. Wraps at the edges; painted once. */
function blurTexture() {
  const size = 256
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')!
  const random = seeded(3)
  ctx.fillStyle = '#000000'
  ctx.fillRect(0, 0, size, size)
  ctx.globalCompositeOperation = 'lighter'
  for (let i = 0; i < 90; i++) {
    const x = random() * size, y = random() * size, r = 8 + random() * 44
    const light = 10 + random() * 34
    for (const dx of [-size, 0, size]) {
      for (const dy of [-size, 0, size]) {
        const puff = ctx.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, r)
        puff.addColorStop(0, `rgb(${light}, ${light}, ${light})`)
        puff.addColorStop(1, 'rgb(0, 0, 0)')
        ctx.fillStyle = puff
        ctx.fillRect(x + dx - r, y + dy - r, r * 2, r * 2)
      }
    }
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping
  return texture
}

function grainTexture() {
  const size = 128
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
  texture.minFilter = texture.magFilter = THREE.NearestFilter
  texture.generateMipmaps = false
  return texture
}

/** The shoulders of a white nightdress: only the corners of the picture ever see them. */
function dressGeometry() {
  const curve = new THREE.SplineCurve([
    // From the bottom up: that way the lathe's faces look outwards.
    [1.58, -3.4], [1.54, -2.3], [1.42, -1.82], [1.12, -1.55], [0.7, -1.42], [0.3, -1.25],
  ].map(([r, y]) => new THREE.Vector2(r, y)))
  const geometry = new THREE.LatheGeometry(curve.getSpacedPoints(36), 48)
  geometry.scale(1, 1, 0.34)
  geometry.translate(0, 0, -0.2)
  return geometry
}

export class SamaraHead implements HeadView {
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 60)
  /** All of her, coming towards the glass. */
  private body = new THREE.Group()
  private turn = new THREE.Group()
  private textures: THREE.Texture[] = []
  private paint = {
    uLook: { value: new THREE.Vector2() },
    uBlink: { value: 0 },
    uOpen: { value: 0 },
    uWide: { value: 0 },
  }
  private hair = {
    uCounter: { value: new THREE.Vector2() },
    uTime: { value: 0 },
  }
  private tape = {
    uNoise: { value: null as THREE.Texture | null },
    uScale: { value: new THREE.Vector2(1, 1) },
    uOffset: { value: new THREE.Vector2() },
    uSkip: { value: 0 },
    uBand: { value: 0.5 },
    uHeight: { value: 720 },
  }
  private backdrop: THREE.ShaderMaterial
  private key: THREE.DirectionalLight
  private gaze: GazeSpring
  private face = { open: 0, wide: 0 }
  private target = { open: 0, wide: 0, near: 0 }
  /** How far she has come: changes in jumps only, never in between. */
  private near = 0
  private jolt = { x: 0, y: 0, tilt: 0 }
  private nextBlink = 4
  private blinkUntil = -1
  private nextGrain = 0
  private skipUntil = -1
  private nextSkip = 3 + Math.random() * 5
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

    const attributes: WebGLContextAttributes = { antialias: true, alpha: false, powerPreference: 'high-performance' }
    // A WebGL 1 context handed in keeps three.js on its WebGL 1 path, as on the old iMacs.
    const context = opts.webgl1 ? canvas.getContext('webgl', attributes) ?? undefined : undefined
    this.renderer = new THREE.WebGLRenderer({ canvas, context, ...attributes })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, opts.maxPixelRatio ?? 1.5))
    this.renderer.setClearColor(0x020606, 1)
    this.renderer.toneMapping = THREE.NeutralToneMapping

    this.camera.position.set(0, CAM_Y, CAM_DIST)
    this.camera.lookAt(0, CAM_Y, 0)

    // --- the wood behind her --------------------------------------------------------
    const blur = blurTexture()
    this.textures.push(blur)
    this.backdrop = new THREE.ShaderMaterial({
      uniforms: { uBlur: { value: blur }, uTime: { value: 0 }, uFlicker: { value: 1 } },
      vertexShader: PASS_VERTEX,
      fragmentShader: BACKDROP_FRAGMENT,
      depthWrite: false,
      toneMapped: false,
    })
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(26, 15), this.backdrop)
    wall.position.z = -6
    wall.renderOrder = -10
    this.scene.add(wall)

    // A cold flat light from the front and above: sickly on the nose and brow, nothing in the hollows.
    this.scene.add(new THREE.HemisphereLight(0x9fc2bb, 0x050a09, 0.34))
    this.key = new THREE.DirectionalLight(0xd6ece4, KEY_LIGHT)
    this.key.position.set(0.5, 2.6, 4.2)
    const sheen = new THREE.DirectionalLight(0xbfe0dc, 1.6)
    sheen.position.set(-2.6, 3.2, 1.8)
    const rim = new THREE.DirectionalLight(0x7fb0ac, 0.9)
    rim.position.set(3, 1.5, -4)
    this.scene.add(this.key, sheen, rim)

    // --- head --------------------------------------------------------------------------
    const pattern = skinTexture()
    this.textures.push(pattern)
    const skin = new THREE.MeshStandardMaterial({ color: 0xaebfb2, map: pattern, roughness: 0.74 })
    skin.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.paint)
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vFace;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFace = position;')
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${FACE_PARS}`)
        .replace('#include <color_fragment>', `#include <color_fragment>\n${FACE_PAINT}`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${FACE_GLOW}`)
    }
    const head = new THREE.Group()
    head.add(new THREE.Mesh(headGeometry(), skin))

    // --- hair: a solid mass behind, the strands in front of it --------------------------
    const moveHair = (shader: THREE.WebGLProgramParametersWithUniforms) => {
      Object.assign(shader.uniforms, this.hair)
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${HAIR_PARS}`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>\n${HAIR_MOVE}`)
    }
    const massMaterial = new THREE.MeshStandardMaterial({ color: 0x070909, roughness: 0.5 })
    massMaterial.onBeforeCompile = moveHair
    const strandMaterial = new THREE.MeshStandardMaterial({ color: 0x30393a, roughness: 0.3, vertexColors: true })
    strandMaterial.onBeforeCompile = moveHair
    const strands = new THREE.Mesh(strandsGeometry(hairStrands()), strandMaterial)
    strands.frustumCulled = false
    head.add(new THREE.Mesh(massGeometry(), massMaterial), strands)

    head.position.copy(PIVOT).negate()
    this.turn.position.copy(PIVOT)
    this.turn.add(head)
    this.body.add(this.turn)
    // The dress does not turn with the head.
    this.body.add(new THREE.Mesh(dressGeometry(), new THREE.MeshStandardMaterial({ color: 0xa9bdb6, roughness: 0.9 })))
    this.scene.add(this.body)

    // --- the tape ------------------------------------------------------------------------
    const grain = grainTexture()
    this.textures.push(grain)
    this.tape.uNoise.value = grain
    const film = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
      uniforms: this.tape,
      vertexShader: TAPE_VERTEX,
      fragmentShader: TAPE_FRAGMENT,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    }))
    film.frustumCulled = false
    film.renderOrder = 100
    this.scene.add(film)

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
    // Keep the head with its hair in frame on narrow screens.
    const halfFov = THREE.MathUtils.degToRad(FOV / 2)
    this.camera.position.z = Math.max(CAM_DIST, 2.5 / (2 * Math.tan(halfFov) * this.camera.aspect))
    this.camera.updateProjectionMatrix()
    this.tape.uScale.value.set(w / 200, h / 200)
    this.tape.uHeight.value = h
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
    Object.assign(this.target, MOOD[expression])
  }

  /** The tape skips: for a moment she is somewhere else, and may stay nearer when it is over. */
  private skip(t: number) {
    this.skipUntil = t + between(SKIP_LENGTH)
    this.tape.uBand.value = 0.1 + 0.8 * Math.random()
    const gap = this.target.near - this.near
    if (Math.abs(gap) > 0.01) this.near += Math.sign(gap) * Math.min(Math.abs(gap), 0.2 + 0.25 * Math.random())
  }

  private tick = () => {
    if (this.disposed) return
    this.raf = requestAnimationFrame(this.tick)
    const now = performance.now()
    if (now - this.lastFrame < 1000 / this.fps - 2) return
    this.lastFrame = now
    const dt = Math.min(this.clock.getDelta(), 0.1)
    const t = this.clock.elapsedTime

    this.face.open += (this.target.open - this.face.open) * (1 - Math.exp(-1.6 * dt))
    this.face.wide += (this.target.wide - this.face.wide) * (1 - Math.exp(-5 * dt))

    // She hardly ever blinks, and then slowly.
    if (t > this.nextBlink) {
      this.blinkUntil = t + 0.34
      this.nextBlink = t + 7 + Math.random() * 11
    }
    const blink = Math.pow(Math.sin(THREE.MathUtils.clamp(1 - (this.blinkUntil - t) / 0.34, 0, 1) * Math.PI), 2)

    // The tape skips now and then, and at once when she has somewhere to go.
    if (t > this.nextSkip) {
      this.skip(t)
      const moving = Math.abs(this.target.near - this.near) > 0.01
      this.nextSkip = t + between(moving ? STEP_EVERY : SKIP_EVERY)
    } else if (Math.abs(this.target.near - this.near) > 0.01) {
      this.nextSkip = Math.min(this.nextSkip, t + STEP_EVERY[1])
    }
    const skipping = t < this.skipUntil
    this.tape.uSkip.value = skipping ? 0.55 + 0.45 * Math.random() : 0
    if (skipping) {
      this.jolt.x = (Math.random() - 0.5) * 0.11
      this.jolt.y = (Math.random() - 0.5) * 0.05
      this.jolt.tilt = (Math.random() - 0.5) * 0.09
      this.tape.uBand.value = (this.tape.uBand.value + 0.13 + 0.1 * Math.random()) % 1
    } else {
      this.jolt.x = this.jolt.y = this.jolt.tilt = 0
    }
    this.body.position.set(this.jolt.x, this.jolt.y, this.near * NEAR_Z)

    // New grain twelve times a second; the old lamp of the set is not quite steady.
    if (t > this.nextGrain) {
      this.nextGrain = t + 1 / 12
      this.tape.uOffset.value.set(Math.random(), Math.random())
      const flicker = 0.94 + 0.06 * Math.random()
      this.key.intensity = KEY_LIGHT * flicker
      this.backdrop.uniforms.uFlicker.value = flicker
    }
    this.backdrop.uniforms.uTime.value = t
    // A skipping tape holds its picture: the hair stands still until it runs again.
    if (!skipping) this.hair.uTime.value = t

    const pose = this.gaze.update(dt, t)
    // The head follows a little behind the eye, and never quite comes up.
    const yaw = pose.yaw * 0.8
    const pitch = -pose.pitch * 0.7 + BOW
    this.turn.rotation.set(pitch, yaw, -0.025 + 0.012 * Math.sin(t * 0.23) + this.jolt.tilt, 'YXZ')
    this.hair.uCounter.value.set(yaw, pitch)
    this.paint.uLook.value.set(
      THREE.MathUtils.clamp((this.gaze.goal.yaw - this.gaze.yaw) * 1.4 + pose.yaw * 0.6, -1, 1),
      THREE.MathUtils.clamp((this.gaze.goal.pitch - this.gaze.pitch) * 1.4 + pose.pitch * 0.7 + 0.25, -1, 1),
    )
    this.paint.uBlink.value = blink
    this.paint.uOpen.value = this.face.open
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
      style: 'samara',
      webgl: this.renderer.capabilities.isWebGL2 ? 2 : 1,
      headLoaded: true,
      renderedFps: this.renderedFps,
      yaw: Number(this.gaze.yaw.toFixed(3)),
      pitch: Number(this.gaze.pitch.toFixed(3)),
      goal: { ...this.gaze.goal },
      expression: { ...this.face },
      near: Number(this.near.toFixed(2)),
      glitch: this.tape.uSkip.value > 0,
      triangles: this.renderer.info.render.triangles,
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
    this.renderer.dispose()
  }
}
