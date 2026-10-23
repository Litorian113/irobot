/// <reference lib="webworker" />
import * as ort from 'onnxruntime-web/webgpu'
import { iou, type Box } from './gaze'

/**
 * YOLO person detection, off the main thread. A frame arrives as an ImageBitmap,
 * is letterboxed into the model input, and is closed right after inference:
 * nothing is kept, only the person boxes leave this worker.
 */

export type DetectorRequest =
  | { type: 'init'; modelUrl: string; size: number }
  /**
   * `rotate`: the camera hangs upside down; the frame is turned upright before detection.
   * `enhance`: stretch contrast and lift a dark frame before detection.
   */
  | { type: 'frame'; bitmap: ImageBitmap; rotate?: boolean; enhance?: boolean }

export type DetectorResponse =
  | { type: 'ready'; provider: string }
  /** `light`: how the frame was lifted (contrast gain and gamma), for the preview panel. */
  | { type: 'result'; boxes: Box[]; ms: number; light: { gain: number; gamma: number } | null }
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

async function init(modelUrl: string, inputSize: number) {
  size = inputSize
  canvas = new OffscreenCanvas(size, size)
  ctx = canvas.getContext('2d', { willReadFrequently: true })
  input = new Float32Array(3 * size * size)
  const model = new Uint8Array(await (await fetch(modelUrl)).arrayBuffer())
  // WebGPU where the browser has it, otherwise WebAssembly on the CPU.
  const providers = 'gpu' in navigator ? ['webgpu', 'wasm'] : ['wasm']
  let lastError: unknown = null
  for (const provider of providers) {
    try {
      session = await withTimeout(start(model, provider), `${provider} did not start`)
      post({ type: 'ready', provider })
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
  const tensor = output[session.outputNames[0]]
  const boxes = decode(tensor.data as Float32Array, tensor.dims as number[], { scale, dx, dy, W, H })
  tensor.dispose()
  post({ type: 'result', boxes, ms: performance.now() - started, light })
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
  const run = message.type === 'init' ? init(message.modelUrl, message.size) : detect(message.bitmap, message.rotate, message.enhance)
  run.catch((error: unknown) => post({ type: 'error', message: error instanceof Error ? error.message : String(error) }))
}
