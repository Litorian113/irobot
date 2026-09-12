import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createAgentEventRouter, readExpressionTag, stripExpressionTags } from '../src/viki/agentEvents.ts'
import { decodePcm16Base64, encodePcm16Base64, floatToPcm16, resampleLinear } from '../src/viki/pcm.ts'

function harness() {
  const calls = []
  const sent = []
  const drains = []
  const h = {
    onStatus: (s) => calls.push(s),
    onAssistantText: (t, done) => calls.push(`text:${t}${done ? '!' : ''}`),
    onUserText: (t) => calls.push(`user:${t}`),
    onExpression: (e) => calls.push(`expr:${e}`),
    onSpeechStart: () => calls.push('resume'),
    onInterrupt: () => calls.push('interrupt'),
    onError: (m) => calls.push(`error:${m}`),
  }
  const io = {
    send: (ev) => sent.push(ev),
    play: (b64) => calls.push(`play:${b64.length}`),
    flush: () => calls.push('flush'),
    drained: (cb) => drains.push(cb),
    onEnded: () => calls.push('ended'),
    onReady: (id) => calls.push(`ready:${id}`),
  }
  return { route: createAgentEventRouter(h, io), calls, sent, drains }
}

test('a normal turn: listen, think, speak with live captions, drain back to listening', () => {
  const { route, calls, sent, drains } = harness()
  route({ type: 'session.ready', session_id: 's1' })
  route({ type: 'input.speech.started' })
  route({ type: 'transcript.user.delta', text: 'hello' })
  route({ type: 'input.speech.stopped' })
  route({ type: 'transcript.user', text: ' Hello there ' })
  route({ type: 'reply.started', reply_id: 'r1' })
  route({ type: 'reply.audio', data: 'AAAA' })
  route({ type: 'transcript.agent.delta', delta: '[[stern]]', start_ms: 400, end_ms: 400 })
  route({ type: 'transcript.agent.delta', delta: 'Hello' })
  route({ type: 'transcript.agent.delta', delta: 'Detective' })
  route({ type: 'transcript.agent.delta', delta: '.' })
  route({ type: 'transcript.agent', text: '[[stern]] Hello Detective.' })
  route({ type: 'reply.done', reply_id: 'r1', status: 'completed' })
  assert.deepEqual(calls, [
    'ready:s1', 'listening', 'listening', 'thinking', 'user:Hello there', 'resume', 'speaking', 'play:4',
    'expr:stern', 'text:Hello', 'text:Hello Detective', 'text:Hello Detective.', 'text:Hello Detective.!',
  ])
  assert.equal(sent.length, 0, 'nothing is sent back for a plain reply')
  assert.equal(drains.length, 1, 'the reply ends only once the scheduled audio has been heard')
  drains[0]()
  assert.equal(calls.at(-1), 'listening')
})

test('barge-in flushes playback, mutes and drops pending tool results', () => {
  const { route, calls, sent } = harness()
  route({ type: 'session.ready', session_id: 's1' })
  route({ type: 'reply.audio', data: 'AAAA' })
  route({ type: 'tool.call', call_id: 'c1', name: 'anything', arguments: {} })
  route({ type: 'input.speech.started' })
  route({ type: 'reply.done', reply_id: 'r1', status: 'interrupted' })
  assert.deepEqual(calls.slice(2), ['resume', 'speaking', 'play:4', 'flush', 'interrupt', 'listening'])
  assert.equal(sent.length, 0, 'a stale tool result is never sent after an interruption')
})

test('an unexpected tool call is answered at reply.done so the conversation never stalls', () => {
  const { route, calls, sent, drains } = harness()
  route({ type: 'session.ready', session_id: 's1' })
  route({ type: 'input.speech.stopped' })
  route({ type: 'tool.call', call_id: 'c7', name: 'lookup', arguments: { q: 1 } })
  assert.equal(sent.length, 0, 'held until the tool-call reply is done')
  route({ type: 'reply.done', reply_id: 'fc-c7', status: 'completed' })
  assert.equal(sent.length, 1)
  assert.equal(sent[0].type, 'tool.result')
  assert.equal(sent[0].call_id, 'c7')
  assert.match(sent[0].result, /No tool named lookup/)
  assert.deepEqual(calls, ['ready:s1', 'listening', 'thinking', 'thinking'])
  assert.equal(drains.length, 0, 'a silent tool-call reply never counts as speech')
  // A result that becomes available after reply.done goes out immediately.
  route({ type: 'reply.done', reply_id: 'fc-c8', status: 'completed' })
  route({ type: 'tool.call', call_id: 'c8', name: 'other', arguments: {} })
  assert.equal(sent.length, 2)
})

test('a newer reply keeps speaking when an older tail drains; errors and teardown are classified', () => {
  const { route, calls, drains } = harness()
  route({ type: 'session.ready', session_id: 's1' })
  route({ type: 'reply.started', reply_id: 'r1' })
  route({ type: 'reply.done', reply_id: 'r1', status: 'completed' })
  route({ type: 'reply.started', reply_id: 'r2' })
  drains[0]()
  assert.equal(calls.at(-1), 'speaking', 'the stale drain callback must not flip a live reply to listening')
  route({ type: 'session.error', code: 'immutable_field', message: 'nope' })
  assert.ok(!calls.some((c) => c.startsWith('error:')), 'recoverable client errors are only logged')
  route({ type: 'session.error', code: 'session_expired', message: 'Session expired' })
  assert.equal(calls.at(-1), 'error:Session expired')
  route({ type: 'session.ended' })
  assert.equal(calls.at(-1), 'ended')
})

test('PCM16 base64 round-trips, clips and resamples linearly', () => {
  const samples = new Float32Array([0, 0.5, -0.5, 1, -1, 2, -2])
  const pcm = floatToPcm16(samples)
  assert.deepEqual(Array.from(pcm), [0, 16384, -16383, 32767, -32767, 32767, -32768])
  const decoded = decodePcm16Base64(encodePcm16Base64(pcm))
  assert.equal(decoded.length, 7)
  for (let i = 0; i < 5; i++) assert.ok(Math.abs(decoded[i] - samples[i]) < 1e-4)
  assert.equal(decodePcm16Base64(encodePcm16Base64(pcm.buffer)).length, 7)
  const big = new Int16Array(40000).fill(-1234)
  assert.equal(decodePcm16Base64(encodePcm16Base64(big)).length, 40000)
  const ramp = Float32Array.from({ length: 48 }, (_, i) => i / 48)
  const down = resampleLinear(ramp, 48000, 24000)
  assert.equal(down.length, 24)
  assert.ok(Math.abs(down[12] - ramp[24]) < 1e-6)
  assert.equal(resampleLinear(ramp, 24000, 24000).length, 48)
})

test('the capture worklet resamples 48 kHz blocks to a continuous 24 kHz PCM16 stream in 1200-sample chunks', async () => {
  // Stand in for the AudioWorklet globals so the shipped processor runs under node.
  const registry = {}
  const posted = []
  globalThis.sampleRate = 48000
  globalThis.AudioWorkletProcessor = class { constructor() { this.port = { onmessage: null, postMessage: (buffer) => posted.push(new Int16Array(buffer)) } } }
  globalThis.registerProcessor = (name, cls) => { registry[name] = cls }
  await import('../public/audio/viseme-worklet.mjs').catch(() => {})
  await import('../public/audio/pcm-capture-worklet.mjs')
  const Processor = registry['viki-pcm-capture']
  assert.ok(Processor, 'registers viki-pcm-capture')
  const proc = new Processor({ processorOptions: { inputSampleRate: 48000, targetSampleRate: 24000, chunkSamples: 1200 } })
  const total = 48000 // one second at 48 kHz, 375 blocks of 128
  for (let start = 0; start < total; start += 128) {
    const block = Float32Array.from({ length: 128 }, (_, i) => 0.5 * Math.sin((2 * Math.PI * 440 * (start + i)) / 48000))
    assert.equal(proc.process([[block]]), true)
  }
  const samples = posted.flatMap((c) => Array.from(c))
  assert.ok(posted.every((c) => c.length === 1200), 'every chunk carries exactly 50 ms')
  assert.ok(Math.abs(samples.length - 24000) <= 1200, `about one second of 24 kHz output, got ${samples.length}`)
  let maxErr = 0
  for (let i = 0; i < samples.length; i++) {
    const expected = 0.5 * Math.sin((2 * Math.PI * 440 * i) / 24000)
    maxErr = Math.max(maxErr, Math.abs(samples[i] / 32767 - expected))
  }
  assert.ok(maxErr < 0.02, `continuous across block boundaries (max error ${maxErr.toFixed(4)})`)
  proc.port.onmessage({ data: { event: 'stop' } })
  assert.equal(proc.process([[new Float32Array(128)]]), false, 'stop ends the processor')
})


test('expression tags are read from her words and never reach the captions', () => {
  assert.equal(readExpressionTag('[[curious]]'), 'curious')
  assert.equal(readExpressionTag('[[ Happy ]]Hello'), 'happy')
  assert.equal(readExpressionTag('[[bogus]] Hello'), null)
  assert.equal(readExpressionTag('Hello'), null)
  assert.equal(stripExpressionTags('[[sad]] I am sorry.'), 'I am sorry.')
  assert.equal(stripExpressionTags('[[sad]]I am [[happy]] sorry.'), 'I am sorry.')
  assert.equal(stripExpressionTags('[[sad]]'), '')
  const { route, calls } = harness()
  route({ type: 'session.ready', session_id: 's1' })
  route({ type: 'reply.started', reply_id: 'r1' })
  route({ type: 'transcript.agent.delta', delta: '[[happy]]Hello,' })
  route({ type: 'transcript.agent.delta', delta: 'Detective.' })
  route({ type: 'transcript.agent.delta', delta: '[[unknown]]' })
  assert.deepEqual(calls.slice(2), ['resume', 'speaking', 'expr:happy', 'text:Hello,', 'text:Hello, Detective.'])
})
