import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { GazeSpring } from '../GazeSpring'
import type { Expression, HeadView, HeadViewOptions } from '../types'
import { BALL_VERTEX, EYE_FRAGMENT, FILM_FRAGMENT, FILM_VERTEX, MASK_FRAGMENT, MASK_VERTEX, PASS_VERTEX, ROOM_FRAGMENT } from './shaders'

/**
 * A.R.T. - the silent clown, on black-and-white film: a tall white latex hood
 * bending towards a tiny black top hat, wrinkled forehead, thin painted brows,
 * spiked black eyes, a long hooked nose and a huge black grin full of crooked
 * teeth. He never makes a sound and he never blinks: he only tilts his head,
 * laughs without a noise and tips his hat.
 * WebGL 1 safe: a displaced mesh with a baked detail map, plain GLSL ES 1.0.
 */

const FOV = 30
const CAM = new THREE.Vector3(0, -0.1, 5.7)
const LOOK = new THREE.Vector3(0, -0.15, 0)
const KEY = new THREE.Vector3(-0.2, 0.34, 0.92).normalize()
/** What the detail map covers in plan: x and y as on the mask. */
const PLAN_W = 1.8
const PLAN_H = 2.8
/** The head's outline, chin to crown: half-width, height. */
const OUTLINE = [
  [0.55, -1.4], [0.56, -1.2], [0.56, -0.98], [0.64, -0.72], [0.75, -0.45], [0.8, -0.2], [0.78, 0], [0.73, 0.25],
  [0.63, 0.5], [0.48, 0.8], [0.3, 1], [0.15, 1.09], [0.0001, 1.12],
]
const MOUTH_W = 0.345
const EYE = new THREE.Vector2(0.28, 0)
const EYE_R = 0.074
/** How far the jaw drops when wide open. */
const JAW_DROP = 0.15
/** He turns round his neck, not round his eyes. */
const NECK_Y = -1.15

const MOODS: Record<Expression, { laugh: number; ajar: number; tilt: number }> = {
  neutral: { laugh: 0, ajar: 0, tilt: 0 },
  curious: { laugh: 0, ajar: 0.2, tilt: 0.2 },
  happy: { laugh: 1, ajar: 0.2, tilt: -0.06 },
}
/** He tilts his head right over, holds it and comes back (seconds). */
const TILT_EVERY = [8, 18]
const TILT_LENGTH = 4.5
/** Silent laughter. */
const LAUGH_EVERY = [13, 28]
const LAUGH_LENGTH = 2.6
/** Tipping the hat. */
const HAT_EVERY = [18, 36]
const HAT_LENGTH = 1.5

const between = ([lo, hi]: number[]) => lo + Math.random() * (hi - lo)
const noise = (step: number, channel: number) => {
  const x = Math.sin(step * 127.1 + channel * 311.7) * 43758.5453
  return x - Math.floor(x)
}
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

/** The upper lip: nearly flat, its corners pulled up. */
const mouthTop = (x: number) => -0.47 + 0.05 * (x / MOUTH_W) ** 2
/** The lower lip: one huge round sag. */
const mouthBottom = (x: number) => mouthTop(x) - 0.46 * (1 - Math.abs(x / MOUTH_W) ** 2.4) ** 0.6

const rings = new THREE.SplineCurve(OUTLINE.map(([w, y]) => new THREE.Vector2(w, y))).getSpacedPoints(210)
function widthAt(y: number) {
  const ring = rings.find((p) => p.y >= y)
  return ring ? ring.x : 0.0001
}
/** Rounder through the skull, flatter through the face. */
const depthRatio = (y: number) => 0.86 + 0.2 * smoothstep(0.2, 0.9, y)
/** The crown leans over towards his hat. */
const bend = (y: number) => 0.11 * smoothstep(0.3, 1.11, y)

/** How far the face stands out from the plain hood at (x, y). Left and right alike, nearly. */
function relief(px: number, y: number) {
  const x = Math.abs(px)
  let h = 0
  // A bulging forehead over a heavy bone, with the sockets dug in beneath it.
  h += 0.05 * gauss(Math.hypot(x / 0.4, (y - 0.42) / 0.28))
  h += 0.035 * gauss(segment(x, y, 0.06, 0.17, 0.46, 0.18, 0.05))
  h -= 0.115 * gauss(Math.hypot((x - EYE.x) / 0.135, (y - EYE.y) / 0.11))
  // The long nose, swelling and hooking down to a small bulb right on the lip.
  const along = THREE.MathUtils.clamp((0.14 - y) / 0.58, 0, 1)
  const nose = (0.05 + 0.33 * along ** 1.2) * gauss(x / (0.04 + 0.03 * along)) * (1 - smoothstep(0.08, 0.2, y)) * smoothstep(-0.49, -0.41, y)
  h += nose
  h += 0.06 * gauss(Math.hypot(x / 0.058, (y + 0.4) / 0.05))
  h += 0.035 * gauss(Math.hypot((x - 0.08) / 0.036, (y + 0.37) / 0.036))
  // It stands out because the face falls away either side of it.
  h -= 0.04 * gauss(segment(x, y, 0.11, 0.02, 0.135, -0.27, 0.05))
  // Fat cheeks, shoved up by the grin, and little bags under the eyes.
  h += 0.13 * gauss(Math.hypot((x - 0.41) / 0.17, (y + 0.27) / 0.17))
  h += 0.02 * gauss(segment(x, y, 0.16, -0.15, 0.4, -0.15, 0.03))
  // The deep folds running from the nose round the corners of the mouth.
  const fold = Math.min(segment(x, y, 0.12, -0.3, 0.33, -0.39, 0.05), segment(x, y, 0.33, -0.39, 0.45, -0.62, 0.05))
  h -= 0.06 * gauss(fold)
  // Fat black lips round the hole.
  if (x < MOUTH_W + 0.06) {
    const fade = 1 - smoothstep(MOUTH_W - 0.04, MOUTH_W + 0.06, x)
    h += 0.05 * gauss((y - mouthTop(x)) / 0.05) * fade
    h += 0.065 * gauss((y - mouthBottom(Math.min(x, MOUTH_W * 0.98))) / 0.055) * fade
  }
  // The jutting chin.
  h += 0.2 * gauss(Math.hypot(x / 0.27, (y + 1.07) / 0.095))
  // A little asymmetry: it was made by hand.
  h += 0.005 * Math.sin(px * 9 + y * 5) + 0.003 * Math.sin(px * 21 - y * 17)
  return h
}

/** The surface of the face, seen from the front. */
function faceZ(x: number, y: number) {
  const w = widthAt(y)
  return w * depthRatio(y) * Math.sqrt(Math.max(1 - (x / w) ** 2, 0)) + relief(x, y)
}

/** Head and hood in one skin: rings up the outline, packed tighter towards the front. */
function maskGeometry() {
  const cols = 200
  const position: number[] = [], uv: number[] = [], face: number[] = [], index: number[] = []
  for (const ring of rings) {
    const w = ring.x, y = ring.y, d = w * depthRatio(y)
    for (let i = 0; i <= cols; i++) {
      const u = (i / cols) * 2 - 1
      const phi = Math.PI * (0.42 * u + 0.58 * u * u * u)
      const dz = Math.cos(phi)
      const x = w * Math.sin(phi)
      const front = smoothstep(-0.05, 0.4, dz)
      const h = relief(x, y) * front
      // The hood's cloth, gathered in big folds at the sides and under the chin.
      const under = 1 - smoothstep(-1.08, -0.72, y)
      const side = smoothstep(0.75, 1.25, Math.abs(phi)) * (1 - smoothstep(0.35, 0.7, y))
      const cloth = 0.03 * under * Math.sin(y * 21 + phi * 2.4) + 0.022 * side * Math.sin(y * 11 + Math.abs(phi) * 5)
      // The nose hooks down over the lip.
      const hook = 0.06 * gauss(x / 0.085) * gauss((y + 0.43) / (y > -0.43 ? 0.2 : 0.035)) * front
      position.push(x * (1 + cloth) + bend(y), y - hook, d * dz * (1 + cloth) + h)
      uv.push(x, y)
      // Jaw: all below the upper lip, fading out into the cheeks and the neck.
      const jaw = (1 - smoothstep(MOUTH_W - 0.02, MOUTH_W + 0.28, Math.abs(x))) * (1 - smoothstep(-0.6, -0.44, y)) * smoothstep(-1.4, -1.15, y) * front
      // Dirt in the hollows, the shadow under the chin, and the hood's dark sides.
      const e = 0.05
      const mean = (relief(x + e, y) + relief(x - e, y) + relief(x, y + e) + relief(x, y - e)) / 4
      const hollow = Math.max(0, mean - relief(x, y)) * 15 * front
      const throat = 0.72 * gauss((y + 1.25) / 0.09) * (1 - smoothstep(0.36, 0.56, Math.abs(x)))
      face.push(dz, jaw, hollow + throat + (1 - smoothstep(-0.1, 0.55, dz)) * 0.62)
    }
  }
  for (let j = 0; j < rings.length - 1; j++) {
    for (let i = 0; i < cols; i++) {
      const a = j * (cols + 1) + i, b = a + 1, c = a + cols + 1, d = c + 1
      index.push(a, b, c, b, d, c)
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  geometry.setAttribute('aFace', new THREE.Float32BufferAttribute(face, 3))
  geometry.setIndex(index)
  geometry.computeVertexNormals()
  return geometry
}

/** One gray layer of the detail map, drawn in the mask's own plan coordinates. */
function layer(size: number, fill: string, draw: (ctx: CanvasRenderingContext2D) => void) {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = fill
  ctx.fillRect(0, 0, size, size)
  ctx.setTransform(size / PLAN_W, 0, 0, -size / PLAN_H, size / 2, size / 2)
  draw(ctx)
  return ctx.getImageData(0, 0, size, size).data
}

function traceMouth(ctx: CanvasRenderingContext2D) {
  ctx.beginPath()
  const steps = 60
  for (let i = 0; i <= steps; i++) {
    const x = -MOUTH_W + (2 * MOUTH_W * i) / steps
    ctx.lineTo(x, mouthTop(x))
  }
  for (let i = steps; i >= 0; i--) {
    const x = -MOUTH_W + (2 * MOUTH_W * i) / steps
    ctx.lineTo(x, mouthBottom(x))
  }
  ctx.closePath()
}

/** The greasepaint: spiked eyes, thin arched brows, the tip of the nose, the lips. */
function paintLayer(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = ctx.strokeStyle = ctx.shadowColor = '#fff'
  ctx.shadowBlur = 2
  for (const side of [-1, 1]) {
    ctx.save()
    ctx.scale(side, 1)
    ctx.beginPath()
    ctx.ellipse(EYE.x, EYE.y, 0.15, 0.112, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.beginPath()
    ctx.moveTo(0.262, 0.1)
    ctx.lineTo(0.296, 0.2)
    ctx.lineTo(0.318, 0.1)
    ctx.moveTo(0.258, -0.1)
    ctx.lineTo(0.284, -0.18)
    ctx.lineTo(0.31, -0.1)
    ctx.fill()
    ctx.beginPath()
    ctx.moveTo(0.085, 0.11)
    ctx.quadraticCurveTo(0.27, 0.53, 0.505, 0.15)
    ctx.quadraticCurveTo(0.27, 0.485, 0.085, 0.11)
    ctx.fill()
    ctx.restore()
  }
  ctx.beginPath()
  ctx.ellipse(0, -0.408, 0.032, 0.024, 0, 0, Math.PI * 2)
  ctx.fill()
  traceMouth(ctx)
  ctx.lineWidth = 0.075
  ctx.lineJoin = 'round'
  ctx.stroke()
}

/** Dragged through the points: a soft, wide dent with a sharp line down its middle. */
function crease(ctx: CanvasRenderingContext2D, points: number[][], width: number, strength: number) {
  ctx.beginPath()
  ctx.moveTo(points[0][0], points[0][1])
  for (let i = 1; i < points.length - 1; i++) {
    ctx.quadraticCurveTo(points[i][0], points[i][1], (points[i][0] + points[i + 1][0]) / 2, (points[i][1] + points[i + 1][1]) / 2)
  }
  const last = points[points.length - 1]
  ctx.lineTo(last[0], last[1])
  ctx.lineCap = 'round'
  ctx.shadowColor = '#000'
  ctx.shadowBlur = 7
  ctx.strokeStyle = `rgba(0,0,0,${strength * 0.5})`
  ctx.lineWidth = width * 1.4
  ctx.stroke()
  ctx.shadowBlur = 0
  ctx.strokeStyle = `rgba(0,0,0,${strength * 0.35})`
  ctx.lineWidth = width * 0.6
  ctx.stroke()
}

/** The wrinkles. Grey means smooth; darker is a crease, for the bump and for the dirt in it. */
function creaseLayer(ctx: CanvasRenderingContext2D) {
  // Fine grain of the latex.
  for (let i = 0; i < 9000; i++) {
    ctx.fillStyle = Math.random() < 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.06)'
    ctx.fillRect((Math.random() - 0.5) * PLAN_W, (Math.random() - 0.5) * PLAN_H, 0.004 + Math.random() * 0.008, 0.004 + Math.random() * 0.008)
  }
  const wobble = (amount: number) => (Math.random() - 0.5) * amount
  // Across the forehead, one above the other, bowed over the brows.
  for (let i = 0; i < 6; i++) {
    const y = 0.43 + i * 0.062 + wobble(0.016)
    const reach = 0.4 - i * 0.03
    const points: number[][] = []
    for (let k = -4; k <= 4; k++) {
      const x = (k / 4) * reach
      points.push([x + wobble(0.03), y + 0.05 * Math.cos(x * 5.5) - 0.04 + wobble(0.009)])
    }
    crease(ctx, points, 0.008, 0.6 - i * 0.07)
  }
  // Shorter ones between them, so it never looks ruled.
  for (let i = 0; i < 16; i++) {
    const x = wobble(0.7), y = 0.4 + Math.random() * 0.34, l = 0.05 + Math.random() * 0.09
    crease(ctx, [[x - l, y + wobble(0.02)], [x, y + wobble(0.02)], [x + l, y + wobble(0.02)]], 0.006, 0.35)
  }
  // Frown lines, and the pinched bridge of the nose.
  for (const side of [-1, 1]) {
    crease(ctx, [[side * 0.03, 0.15], [side * 0.042, 0.25], [side * 0.03, 0.34]], 0.007, 0.5)
    crease(ctx, [[side * 0.075, 0.2], [side * 0.09, 0.28], [side * 0.075, 0.36]], 0.006, 0.35)
  }
  for (let i = 0; i < 3; i++) crease(ctx, [[-0.055, 0.1 - i * 0.03], [0, 0.085 - i * 0.03], [0.055, 0.1 - i * 0.03]], 0.005, 0.4)
  for (const side of [-1, 1]) {
    ctx.save()
    ctx.scale(side, 1)
    // Crow's feet.
    for (const [a, l] of [[0.5, 0.11], [0.1, 0.13], [-0.3, 0.13], [-0.7, 0.1]]) {
      const x = 0.455, y = 0.0
      crease(ctx, [[x, y], [x + Math.cos(a) * l * 0.5 + wobble(0.012), y + Math.sin(a) * l * 0.5 + wobble(0.012)], [x + Math.cos(a) * l, y + Math.sin(a) * l]], 0.006, 0.5)
    }
    // Rings under the eyes.
    crease(ctx, [[0.14, -0.1], [0.28, -0.215], [0.45, -0.11]], 0.008, 0.55)
    crease(ctx, [[0.17, -0.19], [0.32, -0.29], [0.52, -0.17]], 0.007, 0.4)
    // The big fold from the nose round the mouth, and its echoes out on the cheek.
    crease(ctx, [[0.105, -0.27], [0.34, -0.37], [0.47, -0.62], [0.41, -0.88]], 0.016, 0.85)
    crease(ctx, [[0.3, -0.3], [0.49, -0.43], [0.55, -0.68], [0.47, -0.9]], 0.01, 0.55)
    crease(ctx, [[0.46, -0.28], [0.6, -0.44], [0.62, -0.7]], 0.009, 0.4)
    // Fine lines all over the fat of the cheek.
    for (let i = 0; i < 9; i++) {
      const x = 0.36 + Math.random() * 0.26, y = -0.14 - Math.random() * 0.5, l = 0.04 + Math.random() * 0.06
      crease(ctx, [[x - l * 0.5, y + l], [x + wobble(0.02), y], [x - l * 0.2, y - l]], 0.005, 0.35)
    }
    // Jowls under the corners of the mouth.
    crease(ctx, [[0.33, -0.92], [0.38, -1.04], [0.28, -1.16]], 0.008, 0.45)
    // The cloth of the hood sweeps round from behind the ears to under the chin.
    for (let i = 0; i < 6; i++) {
      const y = -0.72 - i * 0.1
      crease(ctx, [[0.8, y + 0.32], [0.62 + wobble(0.03), y + 0.03], [0.42, y - 0.2 + i * 0.03], [0.24, y - 0.28 + i * 0.03]], 0.018, 0.5)
    }
    ctx.restore()
  }
  // The dent under the lower lip.
  crease(ctx, [[-0.19, -0.965], [0, -1.0], [0.19, -0.965]], 0.012, 0.5)
}

/** Red: paint. Green: the hole of the mouth. Blue: creases. */
function detailTexture() {
  const size = 1024
  const paint = layer(size, '#000', paintLayer)
  const hole = layer(size, '#000', (ctx) => {
    ctx.fillStyle = '#fff'
    traceMouth(ctx)
    ctx.fill()
  })
  const creases = layer(size, '#808080', creaseLayer)
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')!
  const out = ctx.createImageData(size, size)
  for (let i = 0; i < out.data.length; i += 4) {
    out.data[i] = paint[i]
    out.data[i + 1] = hole[i]
    out.data[i + 2] = creases[i]
    out.data[i + 3] = 255
  }
  ctx.putImageData(out, 0, 0)
  const texture = new THREE.CanvasTexture(canvas)
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping
  return texture
}

/** A row of crooked teeth along the lip, dark at the root. up: which way they point. */
function teethGeometry(count: number, reach: number, lip: (x: number) => number, up: number, length: number[], light: number[], channel: number) {
  const parts: THREE.BufferGeometry[] = []
  for (let i = 0; i < count; i++) {
    const n = (c: number) => noise(i + 1, channel + c)
    const x = ((i + 0.5) / count * 2 - 1) * reach + (n(0) - 0.5) * 0.012
    const len = length[0] + n(1) * (length[1] - length[0])
    const wide = 0.025 + n(2) * 0.015
    // Stumps, worn down at different angles.
    const tooth = new THREE.CylinderGeometry(wide * (0.35 + n(7) * 0.45), wide, len, 6, 3)
    const position = tooth.attributes.position as THREE.BufferAttribute
    const colors = new Float32Array(position.count * 3)
    const shade = light[0] + n(3) * (light[1] - light[0])
    for (let k = 0; k < position.count; k++) {
      const v = THREE.MathUtils.clamp(position.getY(k) / len + 0.5, 0, 1)
      // Blunt and bent, not a clean cone.
      position.setXYZ(k, position.getX(k) + (n(4) - 0.5) * 0.024 * v, position.getY(k) + (v > 0.99 ? (position.getX(k) / wide) * (n(8) - 0.5) * 0.03 : 0), position.getZ(k))
      const c = shade * (0.15 + 0.85 * smoothstep(0.05, 0.65, v))
      colors.set([c, c, c], k * 3)
    }
    tooth.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    tooth.computeVertexNormals()
    tooth.rotateZ((n(5) - 0.5) * 0.45)
    if (up < 0) tooth.rotateX(Math.PI)
    tooth.translate(x, lip(x) + (up * len) / 2, 0.47 - 0.75 * x * x + (n(6) - 0.5) * 0.03)
    parts.push(tooth)
  }
  const merged = mergeGeometries(parts)!
  for (const part of parts) part.dispose()
  return merged
}

/** The ruffle round his neck: a wide ring, fluted and hanging down. */
function ruffleGeometry() {
  const cols = 240, rows = 12
  const position: number[] = [], index: number[] = []
  for (let j = 0; j <= rows; j++) {
    const v = j / rows
    for (let i = 0; i <= cols; i++) {
      const a = (i / cols) * Math.PI * 2
      const flute = Math.sin(a * 13 + Math.sin(a * 3) * 1.4) * v
      const r = 0.56 + v * (0.5 + 0.07 * flute)
      position.push(r * Math.sin(a), -1.28 - v * (0.2 + 0.09 * Math.sin(a * 5 + 1) ** 2) + 0.085 * flute, r * Math.cos(a) * 0.82)
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
  geometry.setIndex(index)
  geometry.computeVertexNormals()
  return geometry
}

/** The tiny top hat, standing on y = 0 and open underneath. */
function hatGeometry() {
  const profile = [[0, -0.01], [0.3, -0.01], [0.31, 0], [0.3, 0.018], [0.225, 0.03], [0.215, 0.06], [0.235, 0.5], [0.235, 0.53], [0, 0.535]]
  return new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), 40)
}

export class ArtHead implements HeadView {
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 60)
  private head = new THREE.Group()
  private torso = new THREE.Group()
  private hat = new THREE.Group()
  private hatBase = new THREE.Vector3(0.5, 0.86, 0.02)
  private hatAxis = new THREE.Vector3()
  private eyes: THREE.Mesh[] = []
  private lowerTeeth: THREE.Mesh
  private textures: THREE.Texture[] = []
  private light = { value: 1 }
  private jawDrop = { value: 0 }
  private grainScale = { value: new THREE.Vector2(1, 1) }
  private grainOffset = { value: new THREE.Vector2(0, 0) }
  private key: THREE.DirectionalLight
  private fill: THREE.HemisphereLight
  private gaze: GazeSpring
  private mood = { ...MOODS.neutral }
  private moodTarget = { ...MOODS.neutral }
  private jaw = 0
  private tiltSide = Math.random() < 0.5 ? -1 : 1
  private nextTilt = between([5, 10])
  private tiltAt = -100
  private nextLaugh = between([8, 16])
  private laughAt = -100
  private nextHat = between([10, 20])
  private hatAt = -100
  private nextGrain = 0
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
    this.renderer.setClearColor(0x000000, 1)
    this.camera.position.copy(CAM)
    this.camera.lookAt(LOOK)

    const room = new THREE.Mesh(new THREE.PlaneGeometry(16, 9), new THREE.ShaderMaterial({
      uniforms: { uLight: this.light }, vertexShader: PASS_VERTEX, fragmentShader: ROOM_FRAGMENT, depthWrite: false,
    }))
    room.position.z = -3
    room.renderOrder = -10
    this.scene.add(room)

    this.fill = new THREE.HemisphereLight(0xffffff, 0x101010, 0.55)
    this.key = new THREE.DirectionalLight(0xffffff, 2.2)
    this.key.position.copy(KEY)
    this.scene.add(this.fill, this.key)

    // --- the mask -------------------------------------------------------------
    const detail = detailTexture()
    this.textures.push(detail)
    const face = new THREE.Group()
    face.position.y = -NECK_Y
    this.head.position.y = NECK_Y
    this.head.add(face)
    face.add(new THREE.Mesh(maskGeometry(), new THREE.ShaderMaterial({
      uniforms: { uDetail: { value: detail }, uKey: { value: KEY }, uLight: this.light, uJaw: this.jawDrop },
      vertexShader: MASK_VERTEX,
      fragmentShader: MASK_FRAGMENT,
      side: THREE.DoubleSide,
    })))

    // --- teeth ----------------------------------------------------------------
    const bone = new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 30, specular: new THREE.Color(0x303030) })
    face.add(new THREE.Mesh(teethGeometry(15, 0.285, (x) => mouthTop(x) - 0.085, -1, [0.045, 0.085], [0.1, 0.3], 1), bone))
    this.lowerTeeth = new THREE.Mesh(teethGeometry(12, 0.22, (x) => mouthBottom(x) + 0.03, 1, [0.04, 0.08], [0.03, 0.09], 2), bone)
    face.add(this.lowerTeeth)

    // --- eyes -----------------------------------------------------------------
    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(EYE_R, 32, 22), new THREE.ShaderMaterial({
        uniforms: { uKey: { value: KEY }, uLight: this.light },
        vertexShader: BALL_VERTEX,
        fragmentShader: EYE_FRAGMENT,
      }))
      eye.position.set(side * EYE.x, EYE.y, faceZ(EYE.x, EYE.y) - 0.035)
      this.eyes.push(eye)
      face.add(eye)
    }

    // --- the hat, leaning right over ----------------------------------------------
    const hatMaterial = new THREE.MeshPhongMaterial({ color: 0x030303, shininess: 16, specular: new THREE.Color(0x141414), side: THREE.DoubleSide })
    this.hat.add(new THREE.Mesh(hatGeometry(), hatMaterial))
    this.hat.rotation.set(0.05, 0, -0.78)
    this.hat.scale.setScalar(1.05)
    this.hat.position.copy(this.hatBase)
    this.hatAxis.set(0, 1, 0).applyEuler(this.hat.rotation)
    face.add(this.hat)
    this.scene.add(this.head)

    // --- collar, shoulders: they stay put ------------------------------------------
    const cloth = new THREE.MeshPhongMaterial({ color: 0x8c8c8c, shininess: 6, side: THREE.DoubleSide })
    const dark = new THREE.MeshPhongMaterial({ color: 0x0a0a0a, shininess: 30, specular: new THREE.Color(0x404040) })
    const choker = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.026, 10, 72), dark)
    choker.rotation.x = Math.PI / 2
    choker.scale.set(1, 0.84, 1)
    choker.position.y = -1.275
    const outline = new THREE.SplineCurve([[0.4, -1.42], [0.75, -1.52], [1.15, -1.66], [1.42, -1.95], [1.5, -2.7]].map(([r, y]) => new THREE.Vector2(r, y)))
    const shoulders = new THREE.Mesh(new THREE.LatheGeometry(outline.getPoints(30), 64), cloth)
    shoulders.scale.z = 0.55
    const pompom = new THREE.Mesh(new THREE.SphereGeometry(0.14, 18, 14), dark)
    pompom.position.set(0, -1.66, 0.74)
    this.torso.add(shoulders, new THREE.Mesh(ruffleGeometry(), cloth), choker, pompom)
    this.scene.add(this.torso)

    // --- the film ---------------------------------------------------------------
    const grain = this.grainTexture()
    this.textures.push(grain)
    const film = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
      uniforms: { uNoise: { value: grain }, uScale: this.grainScale, uOffset: this.grainOffset },
      vertexShader: FILM_VERTEX,
      fragmentShader: FILM_FRAGMENT,
      transparent: true,
      depthTest: false,
      depthWrite: false,
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

  private grainTexture() {
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

  private resize = () => {
    const w = this.canvas.clientWidth || window.innerWidth
    const h = this.canvas.clientHeight || window.innerHeight
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / h
    // Keep the head and his hat in frame on narrow screens.
    const halfFov = THREE.MathUtils.degToRad(FOV / 2)
    const dist = Math.max(CAM.z, 2.3 / (2 * Math.tan(halfFov) * this.camera.aspect))
    this.camera.position.set(CAM.x, CAM.y, dist)
    this.camera.lookAt(LOOK)
    this.camera.updateProjectionMatrix()
    this.grainScale.value.set(w / 192, h / 192)
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
    Object.assign(this.moodTarget, MOODS[expression])
  }

  private tick = () => {
    if (this.disposed) return
    this.raf = requestAnimationFrame(this.tick)
    const now = performance.now()
    if (now - this.lastFrame < 1000 / this.fps - 2) return
    this.lastFrame = now
    const dt = Math.min(this.clock.getDelta(), 0.1)
    const t = this.clock.elapsedTime

    // He moves slowly, a mime: only the laugh is quick.
    const k = 1 - Math.exp(-3 * dt)
    for (const key of ['laugh', 'ajar', 'tilt'] as const) this.mood[key] += (this.moodTarget[key] - this.mood[key]) * k

    if (t > this.nextTilt) {
      this.tiltAt = t
      this.tiltSide = -this.tiltSide
      this.nextTilt = t + TILT_LENGTH + between(TILT_EVERY)
    }
    const tiltF = (t - this.tiltAt) / TILT_LENGTH
    const idleTilt = tiltF < 1 ? this.tiltSide * 0.26 * smoothstep(0, 0.3, tiltF) * (1 - smoothstep(0.72, 1, tiltF)) : 0

    if (t > this.nextLaugh) {
      this.laughAt = t
      this.nextLaugh = t + LAUGH_LENGTH + between(LAUGH_EVERY)
    }
    const laughF = (t - this.laughAt) / LAUGH_LENGTH
    const laughing = Math.max(this.mood.laugh, laughF < 1 ? smoothstep(0, 0.12, laughF) * (1 - smoothstep(0.8, 1, laughF)) : 0)
    // Not a sound: the jaw pumps, his head bobs and his shoulders shake.
    const pump = Math.abs(Math.sin(t * 7.5))
    const open = Math.max(this.mood.ajar, laughing * (0.25 + 0.75 * pump))
    this.jaw += (open - this.jaw) * (1 - Math.exp(-22 * dt))
    this.jawDrop.value = this.jaw * JAW_DROP
    this.lowerTeeth.position.set(0, -this.jawDrop.value, -this.jawDrop.value * 0.18)
    this.torso.position.y = laughing * pump * 0.012

    if (t > this.nextHat) {
      this.hatAt = t
      this.nextHat = t + HAT_LENGTH + between(HAT_EVERY)
    }
    const hatF = (t - this.hatAt) / HAT_LENGTH
    const tip = hatF < 1 ? Math.sin(hatF * Math.PI) ** 2 : 0
    this.hat.position.copy(this.hatBase).addScaledVector(this.hatAxis, tip * 0.24 + laughing * pump * 0.022)
    this.hat.rotation.z = -0.78 - tip * 0.16

    // The projector: a slight unsteady light, new grain twelve times a second.
    this.light.value = 0.965 + 0.035 * noise(Math.floor(t * 12), 1)
    this.key.intensity = 2.2 * this.light.value
    this.fill.intensity = 0.55 * this.light.value
    if (t > this.nextGrain) {
      this.nextGrain = t + 1 / 12
      this.grainOffset.value.set(Math.random(), Math.random())
    }

    const pose = this.gaze.update(dt, t)
    const bob = laughing * Math.sin(t * 15) * 0.022
    // His resting pose has the head leaning over to the hat's side.
    this.head.rotation.set(-pose.pitch * 0.6 + bob, pose.yaw * 0.72, -0.05 - this.mood.tilt + idleTilt + Math.sin(t * 0.4) * 0.008, 'YXZ')
    // The eyes get there first, and they are all that moves fast.
    const glanceY = THREE.MathUtils.clamp(this.gaze.goal.yaw - this.gaze.yaw + pose.yaw * 0.35, -0.5, 0.5)
    const glanceX = THREE.MathUtils.clamp(-(this.gaze.goal.pitch - this.gaze.pitch) - pose.pitch * 0.3, -0.3, 0.3)
    for (const eye of this.eyes) eye.rotation.set(glanceX, glanceY, 0)

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
      style: 'art',
      webgl: this.renderer.capabilities.isWebGL2 ? 2 : 1,
      headLoaded: true,
      renderedFps: this.renderedFps,
      yaw: Number(this.gaze.yaw.toFixed(3)),
      pitch: Number(this.gaze.pitch.toFixed(3)),
      goal: { ...this.gaze.goal },
      expression: { ...this.mood },
      jaw: Number(this.jaw.toFixed(2)),
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
