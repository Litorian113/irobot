import { LipSync } from './lipsync'
import type { MouthSample } from './ParticleFace'
import { SILENCE, VISEMES, VisemeTimeline } from './visemes'
import { decodeVisemeModel } from './visemeModel'

const modules = new WeakMap<AudioContext, Promise<void>>()
const delaySeconds = (ms: number) => Math.min(0.25, Math.max(0.04, Number.isFinite(ms) ? ms / 1000 : 0.1))

/** One audible path and one analysis path, both fed by the assistant's remote track. */
export class SpeechOutput {
  readonly input: GainNode
  private output: GainNode
  private delay: DelayNode
  private detector: AudioWorkletNode | null = null
  private streamSource: MediaStreamAudioSourceNode | null = null
  private pump: HTMLAudioElement | null = null
  private fallback: LipSync | null = null
  private timeline = new VisemeTimeline()
  private abort = new AbortController()
  private disposed = false
  private interrupted = false
  private mode: 'loading' | 'visemes' | 'basic' = 'loading'
  private latency = 0.1
  private detected = 'sil'
  private frameCount = 0
  private generation = 0
  private weights: number[] = []
  private failure: string | null = null
  private ctx: AudioContext
  private onFallback: (message: string) => void

  private constructor(ctx: AudioContext, ms: number, onFallback: (message: string) => void) {
    this.ctx = ctx
    this.onFallback = onFallback
    this.latency = delaySeconds(ms)
    this.input = ctx.createGain()
    this.delay = ctx.createDelay(0.3)
    this.output = ctx.createGain()
    this.delay.delayTime.value = this.latency
    this.input.connect(this.delay)
    this.delay.connect(this.output)
    this.output.connect(ctx.destination)
  }

  static async create(ctx: AudioContext, ms = 100, onFallback: (message: string) => void = () => {}) {
    const speech = new SpeechOutput(ctx, ms, onFallback)
    await speech.prepare()
    return speech
  }

  private async prepare() {
    try {
      const base = import.meta.env.BASE_URL
      if (!this.ctx.audioWorklet) throw new Error('AudioWorklet is unavailable')
      let module = modules.get(this.ctx)
      if (!module) {
        module = this.ctx.audioWorklet.addModule(`${base}audio/viseme-worklet.mjs`)
        modules.set(this.ctx, module)
        void module.catch(() => modules.delete(this.ctx))
      }
      const [_, response] = await Promise.all([
        module,
        fetch(`${base}vendor/headaudio/model-en-mixed.bin`, { signal: this.abort.signal }),
      ])
      if (!response.ok) throw new Error(`Viseme model HTTP ${response.status}`)
      const buffer = await response.arrayBuffer()
      const model = decodeVisemeModel(buffer)
      if (this.disposed) return
      const node = new AudioWorkletNode(this.ctx, 'viki-viseme', {
        numberOfInputs: 1, numberOfOutputs: 0, outputChannelCount: [],
        channelCount: 1, channelCountMode: 'explicit', channelInterpretation: 'speakers',
        parameterData: {
          vadMode: 1, vadGateActiveDb: -48, vadGateInactiveDb: -55,
          vadGateActiveMs: 10, vadGateInactiveMs: 35,
          silMode: 0, speakerMeanHz: 200,
        },
      })
      this.detector = node
      await new Promise<void>((resolve, reject) => {
        const timeout = window.setTimeout(() => reject(new Error('Viseme processor did not initialize')), 5000)
        node.onprocessorerror = () => {
          window.clearTimeout(timeout)
          reject(new Error('Viseme processor failed'))
          this.useFallback('Viseme processor failed')
        }
        node.port.onmessage = ({ data }) => {
          if (this.disposed) return
          if (data.event === 'ready') {
            window.clearTimeout(timeout)
            resolve()
          } else if (!this.interrupted && data.generation === this.generation && Number.isFinite(data.audioTime)) {
            if (data.event === 'viseme' && Number.isInteger(data.viseme)) {
              this.timeline.push(data.viseme, data.audioTime)
              this.detected = VISEMES[data.viseme] ?? 'sil'
              this.frameCount++
            } else if (data.event === 'ended' || data.event === 'end') {
              this.timeline.push(SILENCE, data.audioTime)
              this.detected = 'sil'
            }
          }
        }
        node.port.postMessage({ event: 'model', model }, [buffer])
      })
      if (this.disposed) return
      this.input.connect(node)
      this.mode = 'visemes'
    } catch (error) {
      if (!this.disposed) this.useFallback(error instanceof Error ? error.message : String(error))
    }
  }

  private useFallback(reason: string) {
    if (this.disposed || this.mode === 'basic') return
    this.failure = reason
    this.mode = 'basic'
    if (this.detector) {
      try { this.input.disconnect(this.detector) } catch { /* not connected yet */ }
      this.detector.port.postMessage({ event: 'stop' })
      this.detector.port.close()
      this.detector.disconnect()
      this.detector = null
    }
    this.timeline.reset()
    this.onFallback('Mouth tracking is unavailable. Using basic mouth animation; the voice still works.')
    console.warn('[viki] viseme fallback:', reason)
  }

  attachStream(stream: MediaStream) {
    if (this.disposed) return
    this.streamSource?.disconnect()
    this.fallback?.dispose()
    if (this.pump) { this.pump.pause(); this.pump.srcObject = null }
    // Chrome's remote-track workaround. This element is ALWAYS muted; only
    // the WebAudio delay/output graph is audible, avoiding doubled speech.
    this.pump = new Audio()
    this.pump.muted = true
    this.pump.autoplay = true
    this.pump.srcObject = stream
    void this.pump.play().catch(() => {})
    this.fallback = new LipSync(this.ctx, stream)
    this.streamSource = this.ctx.createMediaStreamSource(stream)
    this.resetDetector()
    this.streamSource.connect(this.input)
  }

  setDelay(ms: number) {
    this.latency = delaySeconds(ms)
    this.delay.delayTime.setTargetAtTime(this.latency, this.ctx.currentTime, 0.025)
  }

  /** Cut buffered audio and queued poses immediately when the user interrupts. */
  interrupt() {
    if (this.disposed) return
    this.interrupted = true
    this.output.gain.cancelScheduledValues(this.ctx.currentTime)
    this.output.gain.setValueAtTime(0, this.ctx.currentTime)
    this.flushDelay()
    this.detector?.port.postMessage({ event: 'stop' })
    this.resetDetector()
  }

  private resetDetector() {
    this.generation++
    this.detector?.port.postMessage({ event: 'generation', generation: this.generation })
    this.detector?.port.postMessage({ event: 'reset' })
    this.timeline.reset()
    this.weights = []
    this.detected = 'sil'
  }

  private flushDelay() {
    this.input.disconnect(this.delay)
    this.delay.disconnect()
    this.delay = this.ctx.createDelay(0.3)
    this.delay.delayTime.value = this.latency
    this.input.connect(this.delay)
    this.delay.connect(this.output)
  }

  resume() {
    if (this.disposed || !this.interrupted) return
    // Discard any remote tail that arrived while muted, including quick restarts.
    this.flushDelay()
    this.interrupted = false
    this.resetDetector()
    this.detector?.port.postMessage({ event: 'start' })
    this.output.gain.setTargetAtTime(1, this.ctx.currentTime, 0.005)
  }

  sample(): MouthSample {
    if (this.disposed || this.interrupted) return { open: 0, wide: 0, round: 0, visemes: [] }
    if (this.mode !== 'visemes') {
      const sample = this.fallback?.sample() ?? { open: 0, wide: 0, round: 0 }
      return { ...sample, open: sample.open * 0.65 }
    }
    const stamp = this.ctx.getOutputTimestamp?.()
    const audibleTime = stamp?.contextTime && stamp.performanceTime
      ? Math.min(this.ctx.currentTime, stamp.contextTime + (performance.now() - stamp.performanceTime) / 1000)
      : this.ctx.currentTime - (this.ctx.baseLatency || 0)
    // A little anticipation allows the lips to travel into the pose before the sound.
    this.weights = this.timeline.sample(audibleTime - this.latency + 0.045)
    return { open: 0, wide: 0, round: 0, visemes: this.weights }
  }

  debug() {
    return { mode: this.mode, delayMs: Math.round(this.latency * 1000), detected: this.detected,
      frames: this.frameCount, weights: this.weights.slice(), interrupted: this.interrupted, failure: this.failure }
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    this.abort.abort()
    this.timeline.reset()
    this.streamSource?.disconnect()
    this.fallback?.dispose()
    if (this.pump) { this.pump.pause(); this.pump.srcObject = null }
    if (this.detector) {
      this.detector.port.postMessage({ event: 'stop' })
      this.detector.port.close()
      this.detector.disconnect()
    }
    this.input.disconnect()
    this.delay.disconnect()
    this.output.disconnect()
  }
}
