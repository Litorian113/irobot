// Timing adapter for the unmodified, MIT-licensed HeadAudio processor.
import { HeadWorklet } from '../vendor/headaudio/headworklet.min.mjs'

class VikiVisemeWorklet extends HeadWorklet {
  constructor(options) {
    super(options)
    this.blockTime = 0
    this.sampleTime = 0
    this.generation = 0
    this.processor.worklet = { port: { postMessage: (event) => {
      // Upstream t counts input samples. Anchor each block to AudioContext time,
      // including gaps, reset, context suspension and remote-track attachment.
      this.port.postMessage({ ...event, generation: this.generation, audioTime: this.blockTime + event.t - this.sampleTime })
    } } }
    const onmessage = this.port.onmessage
    this.port.onmessage = (message) => {
      if (message.data.event === 'generation') {
        this.generation = message.data.generation
        return
      }
      onmessage(message)
      if (message.data.event === 'model') this.port.postMessage({ event: 'ready' })
    }
  }

  process(inputs, outputs, parameters) {
    this.blockTime = currentTime
    this.sampleTime = this.processor.sampleCount / 16000
    return super.process(inputs, outputs, parameters)
  }
}
registerProcessor('viki-viseme', VikiVisemeWorklet)
