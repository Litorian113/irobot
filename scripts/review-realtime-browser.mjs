// Exercise playback lifecycle events with a fake handshake; never contact OpenAI or open a microphone.
import assert from 'node:assert/strict'
const { default: puppeteer } = await import(process.env.PUPPETEER_MODULE || 'puppeteer-core')
const base = process.env.VIKI_URL || 'http://127.0.0.1:5173'
const browser = await puppeteer.launch({
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' }),
  headless: true, args: ['--enable-unsafe-swiftshader'],
})
try {
  const page = await browser.newPage()
  await page.setRequestInterception(true)
  page.on('request', (r) => new URL(r.url()).origin === new URL(base).origin ? r.continue() : r.abort())
  await page.goto(base)
  const result = await page.evaluate(async () => {
    const { connectRealtime } = await import('/src/viki/realtime.ts')
    const originals = { pc: window.RTCPeerConnection, fetch: window.fetch, mic: navigator.mediaDevices.getUserMedia }
    const calls = [], peers = [], tracks = []
    let failHandshake = false
    class Peer {
      dc = { readyState: 'open', send: () => {}, close: () => {} }
      constructor() { peers.push(this) }
      addTrack(track) { this.track = track; return { replaceTrack: async () => {} } }
      createDataChannel() { return this.dc }
      async createOffer() { return { sdp: 'test-offer' } }
      async setLocalDescription() {}
      async setRemoteDescription() {}
      getSenders() { return [{ track: this.track }] }
      close() { this.closed = true }
    }
    window.RTCPeerConnection = Peer
    navigator.mediaDevices.getUserMedia = async () => {
      const track = { kind: 'audio', label: 'Local test mic', stopped: false, stop() { this.stopped = true } }
      tracks.push(track)
      return { getTracks: () => [track], getAudioTracks: () => [track] }
    }
    window.fetch = async () => {
      if (failHandshake) throw new Error('Test handshake failure')
      return new Response('test-answer', { status: 200 })
    }
    const handlers = {
      onStatus: (s) => calls.push(s), onAssistantText: () => {}, onUserText: () => {}, onExpression: () => {},
      onRemoteStream: () => calls.push('remote'), onSpeechStart: () => calls.push('resume'),
      onInterrupt: () => calls.push('interrupt'), onError: (e) => { throw new Error(e) },
    }
    try {
      const session = await connectRealtime('test-key-unused', handlers)
      const pc = peers[0]
      pc.ontrack({ track: { kind: 'audio' }, streams: [new MediaStream()] })
      for (const type of ['output_audio_buffer.started', 'output_audio_buffer.stopped', 'input_audio_buffer.speech_started', 'output_audio_buffer.started', 'output_audio_buffer.cleared']) {
        pc.dc.onmessage({ data: JSON.stringify({ type }) })
      }
      session.disconnect()
      failHandshake = true
      let failed = false
      try { await connectRealtime('test-key-unused', handlers) } catch { failed = true }
      return { calls, failed, closed: peers.every((p) => p.closed), stopped: tracks.every((t) => t.stopped) }
    } finally {
      window.RTCPeerConnection = originals.pc
      window.fetch = originals.fetch
      navigator.mediaDevices.getUserMedia = originals.mic
    }
  })
  assert.deepEqual(result.calls, ['connecting', 'remote', 'resume', 'speaking', 'listening', 'interrupt', 'listening', 'resume', 'speaking', 'interrupt', 'listening', 'idle', 'connecting'])
  assert.ok(result.failed && result.closed && result.stopped)
  console.log('PASS: remote audio attachment, start/resume, natural end drains, barge-in/clear interrupt, disconnect and handshake-failure cleanup.')
} finally { await browser.close() }
