// API-free speech integration. Optional VIKI_SPEECH_EN / VIKI_SPEECH_DE point to local WAV clips.
import assert from 'node:assert/strict'
import { readFile, mkdir } from 'node:fs/promises'
import path from 'node:path'

const { default: puppeteer } = await import(process.env.PUPPETEER_MODULE || 'puppeteer-core')
const base = process.env.VIKI_URL || 'http://127.0.0.1:5173'
const output = process.env.VIKI_REVIEW_DIR || '/tmp/viki-speech-review'
await mkdir(output, { recursive: true })
const clips = {}
for (const lang of ['en', 'de']) {
  const file = process.env[`VIKI_SPEECH_${lang.toUpperCase()}`]
  if (file) clips[lang] = await readFile(file)
}
const browser = await puppeteer.launch({
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }),
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'],
})
try {
  const page = await browser.newPage()
  const errors = [], external = []
  let failModel = false
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => { if (m.type() === 'error' && !failModel) errors.push(m.text()) })
  await page.setRequestInterception(true)
  page.on('request', (r) => {
    const url = new URL(r.url())
    if (url.protocol === 'data:' || url.protocol === 'blob:') return r.continue()
    if (url.origin !== new URL(base).origin) { external.push(r.url()); return r.abort() }
    if (failModel && url.pathname.endsWith('/model-en-mixed.bin')) return r.respond({ status: 503, body: 'Test: model unavailable' })
    const lang = url.pathname.match(/^\/__speech-(en|de)\.wav$/)?.[1]
    if (clips[lang]) return r.respond({ status: 200, contentType: 'audio/wav', body: clips[lang] })
    return r.continue()
  })
  await page.setViewport({ width: 1280, height: 900 })
  for (const pose of ['sil', 'aa', 'I', 'O', 'U', 'PP', 'FF']) {
    await page.goto(`${base}/?style=lattice&preview=neutral&freeze=1&viseme=${pose}`)
    await page.waitForFunction(() => window.__viki?.().headLoaded)
    await new Promise((r) => setTimeout(r, 350))
    await page.screenshot({ path: path.join(output, `${pose}.png`) })
  }

  // Real AudioWorklet and DelayNode, measuring input/output impulses on the audio clock.
  const timing = await page.evaluate(async () => {
    const { SpeechOutput } = await import('/src/viki/SpeechOutput.ts')
    const ctx = new AudioContext()
    await ctx.resume()
    const notices = [], speech = await SpeechOutput.create(ctx, 100, (m) => notices.push(m))
    const wait = (ms) => new Promise((r) => setTimeout(r, ms))
    const moduleUrl = URL.createObjectURL(new Blob([`
      class Meter extends AudioWorkletProcessor {
        process(inputs) {
          const data = inputs[0]?.[0];
          if (data) for (let i = 0; i < data.length; i++) {
            if (Math.abs(data[i]) > 0.0001) { this.port.postMessage(currentTime + i / sampleRate); break; }
          }
          return true;
        }
      }
      registerProcessor('speech-test-meter', Meter);
    `], { type: 'text/javascript' }))
    await ctx.audioWorklet.addModule(moduleUrl)
    URL.revokeObjectURL(moduleUrl)
    const input = new AudioWorkletNode(ctx, 'speech-test-meter', { numberOfOutputs: 0 })
    const output = new AudioWorkletNode(ctx, 'speech-test-meter', { numberOfOutputs: 0 })
    const dry = [], wet = []
    input.port.onmessage = ({ data }) => dry.push(data)
    output.port.onmessage = ({ data }) => wet.push(data)
    speech.input.connect(input)
    speech.output.connect(output)
    const pulse = () => {
      const source = ctx.createBufferSource()
      source.buffer = ctx.createBuffer(1, 1, ctx.sampleRate)
      source.buffer.getChannelData(0)[0] = 0.1
      source.connect(speech.input)
      source.onended = () => source.disconnect()
      source.start(ctx.currentTime + 0.05)
    }
    pulse()
    await wait(300)
    const delay100 = (wet[0] - dry[0]) * 1000
    speech.setDelay(180)
    await wait(250)
    dry.length = wet.length = 0
    pulse()
    await wait(350)
    const delay180 = (wet[0] - dry[0]) * 1000
    speech.interrupt()
    dry.length = wet.length = 0
    pulse() // This must never leak out on a quick resume.
    await wait(100)
    const interrupted = speech.sample()
    speech.resume()
    await wait(250)
    const leaked = wet.length
    pulse()
    await wait(350)
    const resumedAudible = wet.length > 0
    const state = speech.debug()
    speech.dispose()
    input.port.close(); output.port.close()
    input.disconnect(); output.disconnect()
    await ctx.close()
    return { delay100, delay180, interrupted, leaked, resumedAudible, state, notices }
  })
  assert.equal(timing.state.mode, 'visemes')
  assert.ok(Math.abs(timing.delay100 - 100) < 3, JSON.stringify(timing))
  assert.ok(Math.abs(timing.delay180 - 180) < 3, JSON.stringify(timing))
  assert.equal(timing.leaked, 0)
  assert.equal(timing.resumedAudible, true)
  assert.deepEqual(timing.interrupted.visemes, [])
  assert.deepEqual(timing.notices, [])
  console.log('Playback / interruption:', timing)

  // Remote WebRTC track (local peer pair): no microphone, network API or API key.
  for (const lang of Object.keys(clips)) {
    const result = await page.evaluate(async (lang) => {
      const { SpeechOutput } = await import('/src/viki/SpeechOutput.ts')
      const ctx = new AudioContext()
      await ctx.resume()
      const notices = [], speech = await SpeechOutput.create(ctx, 100, (m) => notices.push(m))
      const buffer = await ctx.decodeAudioData(await (await fetch(`/__speech-${lang}.wav`)).arrayBuffer())
      const source = ctx.createBufferSource(), stream = ctx.createMediaStreamDestination()
      source.buffer = buffer
      source.connect(stream)
      const sender = new RTCPeerConnection(), receiver = new RTCPeerConnection()
      sender.onicecandidate = (e) => { if (e.candidate) void receiver.addIceCandidate(e.candidate) }
      receiver.onicecandidate = (e) => { if (e.candidate) void sender.addIceCandidate(e.candidate) }
      let remote
      receiver.ontrack = (e) => { remote = e.streams[0] ?? new MediaStream([e.track]); speech.attachStream(remote) }
      sender.addTrack(stream.stream.getAudioTracks()[0], stream.stream)
      await sender.setLocalDescription(await sender.createOffer())
      await receiver.setRemoteDescription(sender.localDescription)
      await receiver.setLocalDescription(await receiver.createAnswer())
      await sender.setRemoteDescription(receiver.localDescription)
      const wait = (ms) => new Promise((r) => setTimeout(r, ms))
      for (let i = 0; i < 100 && receiver.connectionState !== 'connected'; i++) await wait(30)
      const connected = receiver.connectionState
      const analyser = ctx.createAnalyser(), pcm = new Float32Array(512)
      analyser.fftSize = 512
      speech.output.connect(analyser)
      const face = window.__vikiFace
      face.setMouthSource(() => speech.sample())
      source.start()
      const ids = new Set(), shapes = new Set()
      let peak = 0
      for (let elapsed = 0; elapsed < buffer.duration * 1000 + 800; elapsed += 25) {
        await wait(25)
        const sample = speech.sample()
        ids.add(speech.debug().detected)
        if (sample.visemes?.some((v) => v > 0.2)) shapes.add(sample.visemes.indexOf(Math.max(...sample.visemes)))
        analyser.getFloatTimeDomainData(pcm)
        for (const v of pcm) peak = Math.max(peak, Math.abs(v))
      }
      const final = speech.sample(), debug = speech.debug()
      face.setMouthSource(null)
      speech.dispose()
      analyser.disconnect(); source.disconnect()
      sender.close(); receiver.close()
      stream.stream.getTracks().forEach((t) => t.stop())
      remote?.getTracks().forEach((t) => t.stop())
      await ctx.close()
      return { lang, connected, ids: [...ids], shapes: [...shapes], peak, final, debug, notices }
    }, lang)
    assert.equal(result.connected, 'connected')
    assert.equal(result.debug.mode, 'visemes')
    assert.ok(result.ids.length >= 6 && result.shapes.length >= 5 && result.debug.frames > 30)
    assert.ok(result.peak > 0.005, 'Remote WebRTC voice reaches the audible output')
    assert.ok(result.final.visemes.every((v) => v < 0.001), 'Lips settle after the delayed final sound')
    assert.deepEqual(result.notices, [])
    console.log('Remote speech:', result)
  }

  failModel = true
  await page.setCacheEnabled(false)
  const fallback = await page.evaluate(async () => {
    const { SpeechOutput } = await import('/src/viki/SpeechOutput.ts')
    const ctx = new AudioContext()
    await ctx.resume()
    const notices = [], speech = await SpeechOutput.create(ctx, 100, (m) => notices.push(m))
    const osc = ctx.createOscillator(), stream = ctx.createMediaStreamDestination(), analyser = ctx.createAnalyser()
    osc.connect(stream)
    osc.frequency.value = 240
    speech.attachStream(stream.stream)
    speech.output.connect(analyser)
    osc.start()
    await new Promise((r) => setTimeout(r, 400))
    const pcm = new Float32Array(analyser.fftSize)
    analyser.getFloatTimeDomainData(pcm)
    const result = { state: speech.debug(), sample: speech.sample(), notices, peak: Math.max(...pcm.map(Math.abs)) }
    osc.stop(); osc.disconnect(); analyser.disconnect()
    speech.dispose(); speech.dispose()
    stream.stream.getTracks().forEach((t) => t.stop())
    await ctx.close()
    return result
  })
  assert.equal(fallback.state.mode, 'basic')
  assert.equal(fallback.notices.length, 1)
  assert.ok(fallback.peak > 0.1 && fallback.sample.open > 0)
  assert.deepEqual(errors, [], 'No runtime / shader errors')
  assert.deepEqual(external, [], 'Everything runs locally')
  console.log('PASS: poses, detector, measured playback delay, interruption/restart, optional remote speech clips, audible fallback.')
} finally {
  await browser.close()
}
