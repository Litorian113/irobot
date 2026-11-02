/// <reference lib="webworker" />
import * as ort from 'onnxruntime-web/webgpu'
import { iou, type Box } from './gaze'
import { SHAPE_H, SHAPE_W } from './silhouette'

/**
 * YOLO person detection, off the main thread. A frame arrives as an ImageBitmap,
 * is letterboxed into the model input, and is closed right after inference:
 * nothing is kept, only the person boxes leave this worker - and, with a segmentation model, a
 * coarse outline of the people (silhouette.ts), for the Silhouette pattern.
 */

export type DetectorRequest =
  /** The first of `modelUrls` that loads is used: the segmentation model if it is there. */
  | { type: 'init'; modelUrls: string[]; size: number }
  /**
   * `rotate`: the camera hangs upside down; the frame is turned upright before detection.
   * `enhance`: stretch contrast and lift a dark frame before detection.
   */
  | { type: 'frame'; bitmap: ImageBitmap; rotate?: boolean; enhance?: boolean }

export type DetectorResponse =
  | { type: 'ready'; provider: string; outlines: boolean }
  /** `light`: how the frame was lifted (contrast gain and gamma), for the preview panel. */
  | { type: 'result'; boxes: Box[]; ms: number; light: { gain: number; gamma: number } | null; shape: Uint8Array | null }
  | { type: 'error'; message: string }

// ONNX Runtime would start its CPU threads as extra workers from *this* bundled
// file, which then never answer and the session hangs. One thread is plenty
// for a 320px nano model, and WebGPU does not need them at all.
ort.env.wasm.numThreads = 1

const PERSON = 0
/** A backend that has not started by then is skipped. */
const START_TIMEOUT_MS = 20000
/** Boxes this sure go out; the tracker asks more of a person it is not following yet. */
const SCORE = 0.25
const NMS_IOU = 0.45
/** People this sure get an outline. */
const OUTLINE_SCORE = 0.4
/** Mask coefficients per detection in a YOLO segmentation model. */
const MASK_COEFFS = 32
/** Auto exposure: the darkest and brightest percent of the frame become black and white. */
const CLIP = 0.01
/** Never amplify contrast more than this (noise), never lift harder than this gamma. */
const MAX_GAIN = 4
const MIN_GAMMA = 0.45
/** Mid-grey the frame's average is lifted towards. */
const TARGET_MEAN = 0.42
/** How fast the exposure follows the frame (0..1 per frame): no flicker from frame to frame. */
const EASE = 0.15

let session: ort.InferenceSession | null = null
let size = 320
let canvas: OffscreenCanvas | null = null
let ctx: OffscreenCanvasRenderingContext2D | null = null
let input: Float32Array | null = null
/** The exposure carried from frame to frame: black point, white point (0..255), gamma. */
let exposure: { lo: number; hi: number; gamma: number } | null = null
const lut = new Float32Array(256)
const histogram = new Uint32Array(256)

const post = (message: DetectorResponse) => self.postMessage(message)

async function init(modelUrls: string[], inputSize: number) {
  size = inputSize
  canvas = new OffscreenCanvas(size, size)
  ctx = canvas.getContext('2d', { willReadFrequently: true })
  input = new Float32Array(3 * size * size)
  let model: Uint8Array | null = null
  for (const url of modelUrls) {
    const response = await fetch(url).catch(() => null)
    // A missing file comes back from the dev server as its HTML page: not a model.
    if (response?.ok && !response.headers.get('content-type')?.includes('text/html')) {
      model = new Uint8Array(await response.arrayBuffer())
      break
    }
  }
  if (!model) throw new Error('Kein Erkennungsmodell gefunden')
  // WebGPU where the browser has it, otherwise WebAssembly on the CPU.
  const providers = 'gpu' in navigator ? ['webgpu', 'wasm'] : ['wasm']
  let lastError: unknown = null
  for (const provider of providers) {
    try {
      session = await withTimeout(start(model, provider), `${provider} did not start`)
      post({ type: 'ready', provider, outlines: session.outputNames.length > 1 })
      return
    } catch (error) {
      lastError = error
      session = null
    }
  }
  throw lastError
}

async function start(model: Uint8Array, provider: string) {
  const created = await ort.InferenceSession.create(model, { executionProviders: [provider], graphOptimizationLevel: 'all' })
  // One warm-up run compiles the GPU kernels before the first real frame.
  await created.run({ [created.inputNames[0]]: new ort.Tensor('float32', input!, [1, 3, size, size]) })
  return created
}

function withTimeout<T>(promise: Promise<T>, message: string) {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), START_TIMEOUT_MS)
    promise.then((value) => { clearTimeout(timer); resolve(value) }, (error: unknown) => { clearTimeout(timer); reject(error) })
  })
}

/**
 * Auto levels on the picture inside the letterbox: a black and white point from the
 * histogram, then a gamma that lifts the average towards mid-grey. Eased over frames.
 * Returns a lookup table from 0..255 to 0..1.
 */
function levels(pixels: Uint8ClampedArray, x0: number, y0: number, w: number, h: number) {
  histogram.fill(0)
  let count = 0
  // Every second pixel in both directions is plenty for a histogram.
  for (let y = y0; y < y0 + h; y += 2) {
    for (let x = x0; x < x0 + w; x += 2) {
      const p = (y * size + x) * 4
      histogram[(pixels[p] * 77 + pixels[p + 1] * 150 + pixels[p + 2] * 29) >> 8]++
      count++
    }
  }
  let lo = 0, hi = 255, seen = 0
  for (let v = 0; v < 256; v++) { seen += histogram[v]; if (seen >= count * CLIP) { lo = v; break } }
  seen = 0
  for (let v = 255; v >= 0; v--) { seen += histogram[v]; if (seen >= count * CLIP) { hi = v; break } }
  hi = Math.max(hi, lo + 255 / MAX_GAIN)
  // The average after stretching decides the gamma.
  let sum = 0
  for (let v = 0; v < 256; v++) sum += histogram[v] * Math.min(1, Math.max(0, (v - lo) / (hi - lo)))
  const mean = Math.max(1e-3, sum / Math.max(1, count))
  const gamma = Math.min(1, Math.max(MIN_GAMMA, Math.log(TARGET_MEAN) / Math.log(mean)))
  exposure = exposure
    ? { lo: exposure.lo + (lo - exposure.lo) * EASE, hi: exposure.hi + (hi - exposure.hi) * EASE, gamma: exposure.gamma + (gamma - exposure.gamma) * EASE }
    : { lo, hi, gamma }
  for (let v = 0; v < 256; v++) lut[v] = Math.pow(Math.min(1, Math.max(0, (v - exposure.lo) / (exposure.hi - exposure.lo))), exposure.gamma)
  return { gain: 255 / (exposure.hi - exposure.lo), gamma: exposure.gamma }
}

async function detect(bitmap: ImageBitmap, rotate = false, enhance = true) {
  if (!session || !ctx || !input) { bitmap.close(); return }
  const started = performance.now()
  const W = bitmap.width
  const H = bitmap.height
  const scale = size / Math.max(W, H)
  const nw = Math.round(W * scale)
  const nh = Math.round(H * scale)
  const dx = Math.floor((size - nw) / 2)
  const dy = Math.floor((size - nh) / 2)
  ctx.fillStyle = 'rgb(114,114,114)'
  ctx.fillRect(0, 0, size, size)
  if (rotate) {
    // Turned about the centre of its letterbox: the boxes come out upright, in the same frame.
    ctx.save()
    ctx.translate(dx + nw, dy + nh)
    ctx.rotate(Math.PI)
    ctx.drawImage(bitmap, 0, 0, nw, nh)
    ctx.restore()
  } else {
    ctx.drawImage(bitmap, dx, dy, nw, nh)
  }
  bitmap.close()
  const pixels = ctx.getImageData(0, 0, size, size).data
  const plane = size * size
  const light = enhance ? levels(pixels, dx, dy, nw, nh) : null
  for (let i = 0, p = 0; i < plane; i++, p += 4) {
    const x = i % size, y = (i - x) / size
    // The letterbox padding stays the grey the model was trained with.
    if (light && x >= dx && x < dx + nw && y >= dy && y < dy + nh) {
      input[i] = lut[pixels[p]]
      input[plane + i] = lut[pixels[p + 1]]
      input[2 * plane + i] = lut[pixels[p + 2]]
    } else {
      input[i] = pixels[p] / 255
      input[plane + i] = pixels[p + 1] / 255
      input[2 * plane + i] = pixels[p + 2] / 255
    }
  }
  ctx.fillRect(0, 0, size, size) // do not leave the last frame lying around
  const output = await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, size, size]) })
  const tensors = session.outputNames.map((name) => output[name])
  const frame = { scale, dx, dy, W, H }
  const protos = tensors.find((t) => t.dims.length === 4)
  const head = tensors.find((t) => t.dims.length === 3) ?? tensors[0]
  let boxes: Box[]
  let shape: Uint8Array | null = null
  if (protos) {
    const people = decodeSegmentation(head.data as Float32Array, head.dims as number[])
    boxes = people.map((p) => toFrame(p, frame))
    shape = outline(people.filter((p) => p.score >= OUTLINE_SCORE), protos.data as Float32Array, protos.dims as number[], frame)
  } else {
    boxes = decode(head.data as Float32Array, head.dims as number[], frame)
  }
  for (const tensor of tensors) tensor.dispose()
  post({ type: 'result', boxes, ms: performance.now() - started, light, shape })
}

/** A person found by a segmentation model, still in input pixels, with its mask coefficients. */
interface Person { x1: number; y1: number; x2: number; y2: number; score: number; coeffs: Float32Array }
type Frame = { scale: number; dx: number; dy: number; W: number; H: number }

function toFrame(p: Person, frame: Frame): Box {
  const toX = (x: number) => Math.min(1, Math.max(0, (x - frame.dx) / frame.scale / frame.W))
  const toY = (y: number) => Math.min(1, Math.max(0, (y - frame.dy) / frame.scale / frame.H))
  return { x1: toX(p.x1), y1: toY(p.y1), x2: toX(p.x2), y2: toY(p.y2), score: p.score }
}

/**
 * Both ways a YOLO segmentation model can be exported: end to end [1, N, 6 + 32] (x1, y1, x2, y2,
 * score, class, coefficients; already without duplicates), or raw [1, 4 + classes + 32, anchors].
 */
function decodeSegmentation(data: Float32Array, dims: number[]): Person[] {
  const [, a, b] = dims
  if (b === 6 + MASK_COEFFS) {
    const found: Person[] = []
    for (let i = 0; i < a; i++) {
      const row = i * b
      if (data[row + 4] < SCORE || Math.round(data[row + 5]) !== PERSON) continue
      found.push({ x1: data[row], y1: data[row + 1], x2: data[row + 2], y2: data[row + 3], score: data[row + 4], coeffs: data.slice(row + 6, row + 6 + MASK_COEFFS) })
    }
    return found
  }
  const channels = a, anchors = b
  const found: Person[] = []
  for (let i = 0; i < anchors; i++) {
    const score = data[(4 + PERSON) * anchors + i]
    if (score < SCORE) continue
    const cx = data[i], cy = data[anchors + i], w = data[2 * anchors + i], h = data[3 * anchors + i]
    const coeffs = new Float32Array(MASK_COEFFS)
    for (let k = 0; k < MASK_COEFFS; k++) coeffs[k] = data[(channels - MASK_COEFFS + k) * anchors + i]
    found.push({ x1: cx - w / 2, y1: cy - h / 2, x2: cx + w / 2, y2: cy + h / 2, score, coeffs })
  }
  found.sort((p, q) => q.score - p.score)
  const kept: Person[] = []
  for (const p of found) if (kept.every((k) => iou(k, p) < NMS_IOU)) kept.push(p)
  return kept
}

/** The people's masks, in a coarse grid over the upright camera picture: one cell, person or not. */
function outline(people: Person[], protos: Float32Array, dims: number[], frame: Frame) {
  const cells = new Uint8Array(SHAPE_W * SHAPE_H)
  const [, k, ph, pw] = dims
  for (const p of people) {
    for (let gy = 0; gy < SHAPE_H; gy++) for (let gx = 0; gx < SHAPE_W; gx++) {
      const ix = ((gx + 0.5) / SHAPE_W) * frame.W * frame.scale + frame.dx
      const iy = ((gy + 0.5) / SHAPE_H) * frame.H * frame.scale + frame.dy
      if (ix < p.x1 || ix > p.x2 || iy < p.y1 || iy > p.y2) continue
      const px = Math.min(pw - 1, Math.floor((ix / size) * pw))
      const py = Math.min(ph - 1, Math.floor((iy / size) * ph))
      let sum = 0
      for (let c = 0; c < k; c++) sum += p.coeffs[c] * protos[(c * ph + py) * pw + px]
      if (sum > 0) cells[gy * SHAPE_W + gx] = 1
    }
  }
  return cells
}

/** YOLO head output [1, 4 + classes, anchors]: cx, cy, w, h in input pixels, then class scores. */
function decode(data: Float32Array, dims: number[], frame: { scale: number; dx: number; dy: number; W: number; H: number }): Box[] {
  const channels = dims[1]
  const anchors = dims[2]
  if (channels < 5) return []
  const found: Box[] = []
  for (let i = 0; i < anchors; i++) {
    const score = data[(4 + PERSON) * anchors + i]
    if (score < SCORE) continue
    const cx = data[i], cy = data[anchors + i], w = data[2 * anchors + i], h = data[3 * anchors + i]
    const toX = (x: number) => Math.min(1, Math.max(0, (x - frame.dx) / frame.scale / frame.W))
    const toY = (y: number) => Math.min(1, Math.max(0, (y - frame.dy) / frame.scale / frame.H))
    found.push({ x1: toX(cx - w / 2), y1: toY(cy - h / 2), x2: toX(cx + w / 2), y2: toY(cy + h / 2), score })
  }
  return nms(found)
}

function nms(boxes: Box[]): Box[] {
  boxes.sort((a, b) => b.score - a.score)
  const kept: Box[] = []
  for (const box of boxes) if (kept.every((k) => iou(k, box) < NMS_IOU)) kept.push(box)
  return kept
}

self.onmessage = (event: MessageEvent<DetectorRequest>) => {
  const message = event.data
  const run = message.type === 'init' ? init(message.modelUrls, message.size) : detect(message.bitmap, message.rotate, message.enhance)
  run.catch((error: unknown) => post({ type: 'error', message: error instanceof Error ? error.message : String(error) }))
}
