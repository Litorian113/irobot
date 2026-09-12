// Microphone capture for the AssemblyAI Voice Agent API: takes the context's
// native rate, linearly resamples to 24 kHz mono PCM16 and posts ~50 ms chunks.
// The context keeps its default rate on purpose - Firefox only feeds its echo
// canceller from the default graph, and Safari ignores a requested rate.
class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super()
    const { inputSampleRate = sampleRate, targetSampleRate = 24000, chunkSamples = 1200 } = options.processorOptions ?? {}
    this.ratio = inputSampleRate / targetSampleRate
    this.chunkSamples = chunkSamples
    this.pending = new Float32Array(0)
    this.phase = 0
    this.out = new Int16Array(chunkSamples)
    this.fill = 0
    this.stopped = false
    this.port.onmessage = ({ data }) => {
      if (data?.event === 'stop') this.stopped = true
    }
  }

  process(inputs) {
    if (this.stopped) return false
    const input = inputs[0]?.[0]
    if (!input || input.length === 0) return true
    const merged = new Float32Array(this.pending.length + input.length)
    merged.set(this.pending)
    merged.set(input, this.pending.length)
    let pos = this.phase
    while (pos + 1 < merged.length) {
      const i = Math.floor(pos)
      const frac = pos - i
      const sample = merged[i] + (merged[i + 1] - merged[i]) * frac
      this.out[this.fill++] = Math.max(-32768, Math.min(32767, Math.round(sample * 32767)))
      if (this.fill === this.chunkSamples) {
        this.port.postMessage(this.out.buffer, [this.out.buffer])
        this.out = new Int16Array(this.chunkSamples)
        this.fill = 0
      }
      pos += this.ratio
    }
    const keep = Math.floor(pos)
    this.pending = merged.slice(keep)
    this.phase = pos - keep
    return true
  }
}

registerProcessor('viki-pcm-capture', PcmCaptureProcessor)
