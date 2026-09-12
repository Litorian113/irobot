// Exercise the Voice Agent client against a fake WebSocket: capture worklet, PCM
// playback, status/interruption events, tool round-trip and teardown. Never
// contacts AssemblyAI and never opens a real microphone.
import assert from 'node:assert/strict'
const { default: puppeteer } = await import(process.env.PUPPETEER_MODULE || 'puppeteer-core')
const base = process.env.VIKI_URL || 'http://127.0.0.1:5173'
const browser = await puppeteer.launch({
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }),
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required', '--use-fake-device-for-media-stream', ...(process.env.CHROME_NO_SANDBOX ? ['--no-sandbox'] : [])],
})
try {
  const page = await browser.newPage()
  await page.setRequestInterception(true)
  page.on('request', (r) => new URL(r.url()).origin === new URL(base).origin ? r.continue() : r.abort())
  page.on('pageerror', (e) => console.error('page error:', e.message))
  await page.goto(base)
  const result = await page.evaluate(async () => {
    const { connectVoiceAgent } = await import('/src/viki/voiceAgent.ts')
    const { encodePcm16Base64, floatToPcm16 } = await import('/src/viki/pcm.ts')
    const originals = { ws: window.WebSocket, mic: navigator.mediaDevices.getUserMedia }
    const sockets = []
    const tracks = []
    let refuse = false
    class FakeSocket {
      static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3
      constructor(url) {
        this.url = String(url); this.readyState = 0; this.sent = []; this.audioChunks = 0
        sockets.push(this)
        setTimeout(() => {
          if (refuse) { this.readyState = 3; this.onclose?.({ code: 1006 }); return }
          this.readyState = 1; this.onopen?.({})
          // The server answers the first session.update with session.ready.
          setTimeout(() => this.emit({ type: 'session.ready', session_id: 'sess_test' }), 10)
        }, 5)
      }
      send(raw) {
        const ev = JSON.parse(raw)
        if (ev.type === 'input.audio') { this.audioChunks++; this.lastAudio = ev.audio; return }
        this.sent.push(ev)
      }
      close() { this.readyState = 3; this.onclose?.({ code: 1000 }) }
      emit(ev) { this.onmessage?.({ data: JSON.stringify(ev) }) }
    }
    window.WebSocket = FakeSocket
    const ctx = new AudioContext()
    await ctx.resume()
    // A real MediaStream with a silent-but-live track stands in for the microphone.
    const osc = ctx.createOscillator()
    const dest = ctx.createMediaStreamDestination()
    osc.connect(dest); osc.start()
    navigator.mediaDevices.getUserMedia = async () => {
      const track = dest.stream.getAudioTracks()[0]
      tracks.push(track)
      return dest.stream
    }
    const calls = []
    let outputNode = null
    const handlers = {
      onStatus: (s) => calls.push(s), onAssistantText: (t, done) => { if (done) calls.push(`text:${t}`) },
      onUserText: (t) => calls.push(`user:${t}`), onExpression: (e) => calls.push(`expr:${e}`),
      onOutput: (node) => { outputNode = node; calls.push('output') }, onSpeechStart: () => calls.push('resume'),
      onInterrupt: () => calls.push('interrupt'), onError: (e) => calls.push(`error:${e}`),
    }
    const wait = (ms) => new Promise((r) => setTimeout(r, ms))
    const lastStatus = () => calls.filter((c) => !c.includes(':') && c !== 'output').at(-1)
    try {
      const session = await connectVoiceAgent(ctx, 'test-token', handlers, 'viki')
      const ws = sockets[0]
      if (!ws.url.startsWith('wss://agents.assemblyai.com/v1/ws?token=test-token')) throw new Error(`token must go in the query string: ${ws.url}`)
      const config = ws.sent[0]
      // Mic audio must flow as 24 kHz PCM16 in 50 ms chunks once the session is ready.
      // (Exact pacing is covered by the node test; headless Chrome's audio clock is not real time.)
      await wait(400)
      const chunks = ws.audioChunks
      const chunkBytes = atob(ws.lastAudio).length
      // Analyse the player's output: a 440 Hz tone chunk scheduled through the PCM path must be audible.
      // Headless Chrome's audio clock may run many times faster than wall time, so
      // playback is measured on the render thread by a probe worklet and waits are
      // expressed in audio-clock seconds.
      const probeSrc = `class P extends AudioWorkletProcessor {
        constructor() { super(); this.peak = 0; this.port.onmessage = (e) => { if (e.data === 'reset') this.peak = 0; else this.port.postMessage(this.peak) } }
        process(inputs) { const c = inputs[0]?.[0]; if (c) for (let k = 0; k < c.length; k++) { const v = Math.abs(c[k]); if (v > this.peak) this.peak = v } return true }
      }
      registerProcessor('viki-probe', P)`
      await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([probeSrc], { type: 'text/javascript' })))
      const probe = new AudioWorkletNode(ctx, 'viki-probe', { numberOfInputs: 1, numberOfOutputs: 0 })
      outputNode.connect(probe)
      const probePeak = () => new Promise((r) => { probe.port.onmessage = (e) => r(e.data); probe.port.postMessage('read') })
      const clockWait = async (sec) => { const end = ctx.currentTime + sec; while (ctx.currentTime < end) await wait(20) }
      const clockBefore = ctx.currentTime
      const tone = Float32Array.from({ length: 2400 }, (_, i) => 0.6 * Math.sin((2 * Math.PI * 440 * i) / 24000))
      const b64 = encodePcm16Base64(floatToPcm16(tone))
      ws.emit({ type: 'reply.started', reply_id: 'r1' })
      for (let i = 0; i < 6; i++) ws.emit({ type: 'reply.audio', data: b64 })
      ws.emit({ type: 'transcript.agent.delta', delta: '[[stern]]', start_ms: 400, end_ms: 400 })
      ws.emit({ type: 'transcript.agent.delta', delta: 'Hello' })
      ws.emit({ type: 'transcript.agent.delta', delta: 'Detective.' })
      await clockWait(1.0)
      const peak = await probePeak()
      const clock = { state: ctx.state, advanced: ctx.currentTime - clockBefore, rate: ctx.sampleRate }
      ws.emit({ type: 'transcript.agent', text: '[[stern]] Hello Detective.' })
      ws.emit({ type: 'reply.done', reply_id: 'r1', status: 'completed' })
      const midStatus = lastStatus()
      await wait(1200)
      await clockWait(1.0)
      const afterDrain = lastStatus()
      // A stray tool call is answered so the session cannot stall.
      ws.emit({ type: 'tool.call', call_id: 'c1', name: 'lookup', arguments: {} })
      ws.emit({ type: 'reply.done', reply_id: 'fc-c1', status: 'completed' })
      const toolResult = ws.sent.find((e) => e.type === 'tool.result')
      // Barge-in.
      ws.emit({ type: 'reply.started', reply_id: 'r2' })
      for (let i = 0; i < 20; i++) ws.emit({ type: 'reply.audio', data: b64 })
      ws.emit({ type: 'reply.done', reply_id: 'r2', status: 'interrupted' })
      probe.port.postMessage('reset')
      await clockWait(2.5)
      const peakAfterFlush = await probePeak()
      session.greet()
      const greet = ws.sent.find((e) => e.type === 'reply.create')
      session.setPersona('dust')
      session.disconnect()
      await wait(50)
      const ended = ws.sent.at(-1)
      const chunksAfter = ws.audioChunks
      await wait(300)
      // A refused handshake must reject and leave nothing running.
      refuse = true
      let failed = ''
      try { await connectVoiceAgent(ctx, 'expired', handlers, 'viki') } catch (e) { failed = e.message }
      return {
        calls, config, chunks, chunkBytes, peak, clock, midStatus, afterDrain, toolResult, peakAfterFlush, greet, ended,
        audioStoppedAfterDisconnect: ws.audioChunks === chunksAfter, failed,
        personaUpdate: ws.sent.find((e) => e.type === 'session.update' && e.session.system_prompt?.includes('D.U.S.T.')) !== undefined,
        stopped: tracks.every((t) => t.readyState === 'ended'),
      }
    } finally {
      window.WebSocket = originals.ws
      navigator.mediaDevices.getUserMedia = originals.mic
    }
  })
  assert.equal(result.config.type, 'session.update')
  assert.equal(result.config.session.output.voice, 'anna')
  assert.equal(result.config.session.output.format.sample_rate, 24000)
  assert.equal(result.config.session.tools, undefined, 'no tools: a silent client tool cannot exist on this API')
  assert.ok(result.config.session.system_prompt.includes('V.I.K.I.') && result.config.session.system_prompt.includes('[[curious]]'))
  assert.ok(result.chunks >= 3, `mic audio streams once the session is ready (got ${result.chunks} chunks)`)
  assert.equal(result.chunkBytes, 2400, '1200 samples of PCM16 per chunk')
  assert.ok(result.peak > 0.2, `scheduled PCM must reach the output node (peak ${result.peak}, clock ${JSON.stringify(result.clock)})`)
  assert.equal(result.midStatus, 'speaking', 'reply.done alone does not end speech while audio is still queued')
  assert.equal(result.afterDrain, 'listening')
  assert.equal(result.toolResult?.call_id, 'c1')
  assert.ok(result.peakAfterFlush < 0.05, `barge-in must flush queued audio (peak ${result.peakAfterFlush})`)
  assert.equal(result.greet.type, 'reply.create')
  assert.ok(result.greet.instructions.includes('Hello, Detective.'))
  assert.ok(result.personaUpdate, 'setPersona sends a system_prompt update')
  assert.equal(result.ended.type, 'session.end')
  assert.ok(result.audioStoppedAfterDisconnect && result.stopped, 'mic audio stops and tracks end on disconnect')
  assert.ok(result.failed.includes('refused'), `refused handshake rejects: ${result.failed}`)
  const statuses = result.calls.filter((c) => !c.includes(':') && c !== 'output')
  assert.deepEqual(statuses, ['connecting', 'listening', 'resume', 'speaking', 'listening', 'thinking', 'resume', 'speaking', 'interrupt', 'listening', 'idle', 'connecting'])
  assert.ok(result.calls.includes('text:Hello Detective.') && result.calls.includes('expr:stern'), 'tag becomes an expression and never reaches the captions')
  console.log('PASS: capture worklet streams 24 kHz PCM16, playback reaches the output node, drain/interrupt/tool/greet/persona/teardown and refused handshake.')
} finally { await browser.close() }
