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
  | { type: 'frame'; bitmap: ImageBitmap }

export type DetectorResponse =
  | { type: 'ready'; provider: string }
  | { type: 'result'; boxes: Box[]; ms: number }
  | { type: 'error'; message: string }

// ONNX Runtime would start its CPU threads as extra workers from *this* bundled
// file, which then never answer and the session hangs. One thread is plenty
// for a 320px nano model, and WebGPU does not need them at all.
ort.env.wasm.numThreads = 1

const PERSON = 0
/** A backend that has not started by then is skipped. */
const START_TIMEOUT_MS = 20000
const SCORE = 0.4
const NMS_IOU = 0.45

let session: ort.InferenceSession | null = null
let size = 320
let canvas: OffscreenCanvas | null = null
let ctx: OffscreenCanvasRenderingContext2D | null = null
let input: Float32Array | null = null

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

async function detect(bitmap: ImageBitmap) {
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
  ctx.drawImage(bitmap, dx, dy, nw, nh)
  bitmap.close()
  const pixels = ctx.getImageData(0, 0, size, size).data
  const plane = size * size
  for (let i = 0, p = 0; i < plane; i++, p += 4) {
    input[i] = pixels[p] / 255
    input[plane + i] = pixels[p + 1] / 255
    input[2 * plane + i] = pixels[p + 2] / 255
  }
  ctx.fillRect(0, 0, size, size) // do not leave the last frame lying around
  const output = await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, size, size]) })
  const tensor = output[session.outputNames[0]]
  const boxes = decode(tensor.data as Float32Array, tensor.dims as number[], { scale, dx, dy, W, H })
  tensor.dispose()
  post({ type: 'result', boxes, ms: performance.now() - started })
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
  const run = message.type === 'init' ? init(message.modelUrl, message.size) : detect(message.bitmap)
  run.catch((error: unknown) => post({ type: 'error', message: error instanceof Error ? error.message : String(error) }))
}
