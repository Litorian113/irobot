import { AGENT_SAMPLE_RATE, decodePcm16Base64 } from './pcm.ts'

/**
 * Gapless playback of streamed PCM chunks: every chunk is scheduled right after
 * the previous one on the audio clock, so network jitter never becomes a pop.
 * The player's output node is routed into SpeechOutput's delay line and detector.
 */
export class PcmPlayer {
  readonly output: GainNode
  private nextTime = 0
  private sources = new Set<AudioBufferSourceNode>()
  private lead: number
  private ctx: AudioContext
  private rate: number

  constructor(ctx: AudioContext, rate = AGENT_SAMPLE_RATE, leadSeconds = 0.06) {
    this.ctx = ctx
    this.rate = rate
    this.output = ctx.createGain()
    this.lead = leadSeconds
  }

  playBase64(data: string) {
    this.play(decodePcm16Base64(data))
  }

  play(samples: Float32Array) {
    if (samples.length === 0) return
    const buffer = this.ctx.createBuffer(1, samples.length, this.rate)
    buffer.getChannelData(0).set(samples)
    const src = this.ctx.createBufferSource()
    src.buffer = buffer
    src.connect(this.output)
    const now = this.ctx.currentTime
    // A fresh reply (or a stalled stream) starts a small cushion ahead of "now".
    if (this.nextTime < now + 0.005) this.nextTime = now + this.lead
    src.start(this.nextTime)
    this.nextTime += buffer.duration
    this.sources.add(src)
    src.onended = () => {
      this.sources.delete(src)
      src.disconnect()
    }
  }

  /** Seconds of already scheduled audio still to be heard. */
  remaining() {
    return Math.max(0, this.nextTime - this.ctx.currentTime)
  }

  /** Drop everything queued - the user barged in. */
  flush() {
    for (const src of this.sources) {
      try { src.stop() } catch { /* already ended */ }
      src.disconnect()
    }
    this.sources.clear()
    this.nextTime = 0
  }

  dispose() {
    this.flush()
    this.output.disconnect()
  }
}
