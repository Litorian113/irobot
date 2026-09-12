import type { MouthSample } from './ParticleFace'

/**
 * Turns an audio stream into mouth parameters using band energies:
 *  - open  ~ low/mid energy (voiced speech)
 *  - wide  ~ ratio of high-frequency energy (sibilants / "ee" vowels)
 *  - round ~ low-frequency emphasis while the mouth is open
 * These are expressive audio cues, not phoneme recognition.
 */
export class LipSync {
  private analyser: AnalyserNode
  private data: Uint8Array<ArrayBuffer>
  private source: AudioNode
  private owned: boolean
  private binHz: number

  /** Accepts a microphone/remote stream or any WebAudio node (the agent's PCM player). */
  constructor(ctx: AudioContext, input: MediaStream | AudioNode) {
    this.owned = !('connect' in input)
    this.source = 'connect' in input ? input : ctx.createMediaStreamSource(input)
    this.analyser = ctx.createAnalyser()
    this.analyser.fftSize = 1024
    this.analyser.smoothingTimeConstant = 0.4
    this.source.connect(this.analyser)
    this.data = new Uint8Array(this.analyser.frequencyBinCount)
    this.binHz = ctx.sampleRate / this.analyser.fftSize
  }

  private band(lo: number, hi: number): number {
    const a = Math.max(0, Math.floor(lo / this.binHz))
    const b = Math.min(this.data.length - 1, Math.ceil(hi / this.binHz))
    let sum = 0
    for (let i = a; i <= b; i++) sum += this.data[i]
    return sum / ((b - a + 1) * 255)
  }

  sample(): MouthSample {
    this.analyser.getByteFrequencyData(this.data)
    const low = this.band(90, 400)
    const mid = this.band(400, 2000)
    const high = this.band(2000, 5500)
    const voiced = low * 0.5 + mid * 0.7
    // soft curve: quiet consonants barely move the mouth, loud vowels open it fully
    const open = Math.min(1, Math.max(0, (voiced - 0.05) * 1.6) ** 0.8)
    const wide = Math.min(1, (high / (voiced + 0.05)) * 0.8)
    const round = open * (1 - wide) * Math.min(1, low / (mid + 0.08))
    return { open, wide: open > 0.05 ? wide : 0, round }
  }

  /** RMS-ish level 0..1, handy for a mic meter. */
  level(): number {
    this.analyser.getByteFrequencyData(this.data)
    return Math.min(1, this.band(90, 4000) * 2.2)
  }

  dispose() {
    if (this.owned) this.source.disconnect()
    else { try { this.source.disconnect(this.analyser) } catch { /* already detached */ } }
    this.analyser.disconnect()
  }
}
