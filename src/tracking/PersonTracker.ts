import { iou, locate, pickTarget, type Box, type CameraModel, type Vec3 } from './gaze'
import type { DetectorRequest, DetectorResponse } from './detector.worker'

export interface TrackerState {
  status: 'starting' | 'running' | 'error'
  error?: string
  /** Name of the camera in use. */
  camera?: string
  provider?: string
  /** Inference time of the last frame, ms. */
  inferenceMs: number
  boxes: Box[]
  target: Box | null
  /** Smoothed face position of the person being watched, wall metres. */
  person: Vec3 | null
  present: boolean
}

export interface TrackerOptions {
  hfov: number
  cameraPosition: Vec3
  /** Part of the camera's name to use; without it an external camera wins over the built-in one. */
  cameraName?: string | null
  /** Frames per second sent to the detector at most. */
  maxFps?: number
  onUpdate: (state: TrackerState) => void
}

const MODEL_URL = `${import.meta.env.BASE_URL}models/yolo26n-320.onnx`
const MODEL_SIZE = 320
/** Keep looking where someone was for this long after they leave the frame. */
const LINGER_MS = 1200
/** Cameras that are part of the laptop or phone, not the one mounted on the wall. */
const BUILT_IN = /facetime|built-in|integrated|integriert|desk view|iphone|ipad/i
const VIDEO = { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } }

/**
 * Camera in, person position out. Frames go straight from the camera to the
 * detector worker and are dropped after inference - nothing is recorded or sent.
 */
export class PersonTracker {
  readonly video = document.createElement('video')
  private worker: Worker | null = null
  private stream: MediaStream | null = null
  private stopped = false
  private busy = false
  private timer = 0
  private lastSent = 0
  private lastSeen = 0
  private opts: TrackerOptions
  private state: TrackerState = { status: 'starting', inferenceMs: 0, boxes: [], target: null, person: null, present: false }

  constructor(opts: TrackerOptions) {
    this.opts = opts
    this.video.muted = true
    this.video.playsInline = true
  }

  async start() {
    try {
      this.worker = new Worker(new URL('./detector.worker.ts', import.meta.url), { type: 'module' })
      this.worker.onmessage = (event: MessageEvent<DetectorResponse>) => this.onWorker(event.data)
      this.worker.onerror = (event) => this.fail(event.message || 'Detector worker failed')
      this.send({ type: 'init', modelUrl: new URL(MODEL_URL, location.href).href, size: MODEL_SIZE })
      this.stream = await navigator.mediaDevices.getUserMedia({ video: VIDEO, audio: false })
      // Camera names are only readable after permission, so choose once the first one is open.
      const wanted = await this.chooseCamera()
      const current = this.stream.getVideoTracks()[0]
      if (wanted && wanted.deviceId !== current?.getSettings().deviceId) {
        this.releaseCamera()
        this.stream = await navigator.mediaDevices.getUserMedia({ video: { ...VIDEO, deviceId: { exact: wanted.deviceId } }, audio: false })
      }
      if (this.stopped) { this.releaseCamera(); return }
      this.update({ camera: this.stream.getVideoTracks()[0]?.label || 'Kamera' })
      this.video.srcObject = this.stream
      await this.video.play()
    } catch (error) {
      this.fail(error instanceof Error ? `${error.name}: ${error.message}` : String(error))
    }
  }

  private async chooseCamera() {
    const cameras = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput')
    const name = this.opts.cameraName?.toLowerCase()
    if (name) return cameras.find((d) => d.label.toLowerCase().includes(name)) ?? null
    return cameras.find((d) => d.label && !BUILT_IN.test(d.label)) ?? null
  }

  stop() {
    this.stopped = true
    clearTimeout(this.timer)
    this.worker?.terminate()
    this.releaseCamera()
  }

  private releaseCamera() {
    for (const track of this.stream?.getTracks() ?? []) track.stop()
    this.stream = null
    this.video.srcObject = null
  }

  private send(message: DetectorRequest, transfer: Transferable[] = []) {
    this.worker?.postMessage(message, transfer)
  }

  private fail(message: string) {
    this.update({ status: 'error', error: message })
  }

  private update(patch: Partial<TrackerState>) {
    this.state = { ...this.state, ...patch }
    this.opts.onUpdate(this.state)
  }

  private onWorker(message: DetectorResponse) {
    if (message.type === 'error') { this.busy = false; this.fail(message.message); return }
    if (message.type === 'ready') { this.update({ status: 'running', provider: message.provider }); this.schedule(); return }
    this.busy = false
    this.track(message.boxes, message.ms)
    this.schedule()
  }

  private schedule() {
    if (this.stopped) return
    const interval = 1000 / (this.opts.maxFps ?? 20)
    this.timer = window.setTimeout(this.grab, Math.max(0, interval - (performance.now() - this.lastSent)))
  }

  private grab = async () => {
    if (this.stopped || this.busy) return
    if (this.video.readyState < 2 || !this.video.videoWidth) { this.timer = window.setTimeout(this.grab, 100); return }
    this.busy = true
    this.lastSent = performance.now()
    try {
      const bitmap = await createImageBitmap(this.video)
      this.send({ type: 'frame', bitmap }, [bitmap])
    } catch {
      this.busy = false
      this.schedule()
    }
  }

  private track(boxes: Box[], ms: number) {
    const now = performance.now()
    const camera: CameraModel = {
      hfov: this.opts.hfov,
      aspect: this.video.videoWidth / Math.max(1, this.video.videoHeight),
      position: this.opts.cameraPosition,
    }
    const target = pickTarget(boxes, this.state.target)
    let person = this.state.person
    if (target) {
      const seen = locate(target, camera)
      // A new person is looked at immediately; the same one is lightly smoothed
      // against detector jitter (the heads add their own easing on top).
      const previous = this.state.present ? this.state.target : null
      const k = !previous || iou(target, previous) < 0.15 ? 1 : 0.5
      person = person ? { x: person.x + (seen.x - person.x) * k, y: person.y + (seen.y - person.y) * k, z: person.z + (seen.z - person.z) * k } : seen
      this.lastSeen = now
    }
    const present = Boolean(target) || now - this.lastSeen < LINGER_MS
    this.update({ boxes, target: target ?? (present ? this.state.target : null), person: present ? person : null, present, inferenceMs: ms })
  }
}
