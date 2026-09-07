import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import test from 'node:test'
import { fixedViseme, mapVisemes, SILENCE, VISEMES, VisemeTimeline } from '../src/viki/visemes.ts'
import { decodeVisemeModel } from '../src/viki/visemeModel.ts'

function frames(timeline, id, start, count = 4) {
  for (let i = 0; i < count; i++) timeline.push(id, start + i * 0.016)
}

test('the shipped detector model decodes finite prototypes in the expected Oculus order', async () => {
  const file = await readFile(new URL('../public/vendor/headaudio/model-en-mixed.bin', import.meta.url))
  const bytes = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength)
  const model = decodeVisemeModel(bytes)
  assert.equal(model.length, 39)
  assert.deepEqual([...new Set(model.map((p) => p.viseme))].sort((a, b) => a - b), VISEMES.map((_, i) => i))
  assert.ok(model.every((p) => p.mu.length === 12 && p.sigmaInvLower.length === 78))
  assert.throws(() => decodeVisemeModel(bytes.slice(1)), /size/)
  new DataView(bytes).setUint8(7, 255)
  assert.throws(() => decodeVisemeModel(bytes), /prototype/)
  new DataView(bytes).setUint8(7, 0)
  new Float32Array(bytes, 8, 12)[0] = NaN
  assert.throws(() => decodeVisemeModel(bytes), /prototype/)
})

test('viseme zero is aa; timestamps prevent early playback and do not advance on a paused clock', () => {
  const timeline = new VisemeTimeline()
  frames(timeline, 0, 10)
  assert.ok(timeline.sample(9.9).every((v) => v === 0))
  const pose = timeline.sample(10.06)
  assert.ok(pose[0] > 0.8)
  assert.deepEqual(timeline.sample(10.06), pose)
})

test('single-frame classification jitter is rejected, sustained vowels are blended', () => {
  const timeline = new VisemeTimeline()
  timeline.sample(0)
  frames(timeline, 0, 0.01)
  assert.ok(timeline.sample(0.06)[0] > 0.5)
  timeline.push(3, 0.07)
  timeline.sample(0.075)
  timeline.push(0, 0.086)
  assert.equal(timeline.sample(0.09)[3], 0)
  frames(timeline, 3, 0.10)
  const mixed = timeline.sample(0.15)
  assert.ok(mixed[0] > 0 && mixed[3] > 0)
})

test('bilabial closure reacts faster and overrides a vowel and the smile', () => {
  const timeline = new VisemeTimeline()
  timeline.sample(0)
  frames(timeline, 0, 0.01)
  timeline.sample(0.06)
  frames(timeline, 5, 0.07, 2)
  const closed = timeline.sample(0.11)
  assert.ok(closed[5] > 0.8)
  const { pose, expressionScale } = mapVisemes(fixedViseme('PP'))
  assert.equal(pose.jawOpen, 0)
  assert.ok(pose.mouthPress > 0 && pose.mouthClose > 0)
  assert.equal(expressionScale, 0)
})

test('silence and missing detector frames close the mouth; reset discards queued speech', () => {
  for (const explicitSilence of [false, true]) {
    const timeline = new VisemeTimeline()
    frames(timeline, 3, 0.01)
    timeline.sample(0.07)
    if (explicitSilence) timeline.push(SILENCE, 0.08)
    for (let t = 0.1; t <= 1; t += 0.025) timeline.sample(t)
    assert.ok(timeline.sample(1).every((v) => v === 0))
    frames(timeline, 0, 2)
    timeline.reset()
    assert.ok(timeline.sample(2.1).every((v) => v === 0))
  }
})

test('out-of-order, invalid and non-finite detector messages cannot corrupt animation', () => {
  const timeline = new VisemeTimeline()
  for (const id of [-1, 15, NaN, 0.5]) timeline.push(id, 0)
  timeline.push(0, NaN)
  frames(timeline, 0, 1)
  frames(timeline, 3, 0)
  const pose = timeline.sample(1.06)
  assert.ok(pose[0] > 0)
  assert.equal(pose[3], 0)
})

test('lip articulation distinguishes vowels and consonants while limiting the jaw', () => {
  const pose = (id) => mapVisemes(fixedViseme(id)).pose
  assert.ok(pose('I').mouthWide > pose('aa').mouthWide)
  assert.ok(pose('U').mouthPucker > pose('aa').mouthPucker)
  assert.ok(pose('O').mouthFunnel > pose('I').mouthFunnel)
  assert.ok(pose('FF').lowerLipRoll > 0 && pose('FF').upperLipUp > 0)
  for (const id of VISEMES) assert.ok(pose(id).jawOpen <= 0.27)
  assert.ok(Object.values(pose('sil')).every((v) => v === 0))
  assert.equal(mapVisemes(fixedViseme('sil')).expressionScale, 1)
  assert.equal(fixedViseme('unknown'), null)
  for (const weights of [Array(15).fill(1), [NaN, Infinity, -1]]) {
    const mapped = mapVisemes(weights, Infinity)
    assert.ok(Object.values(mapped.pose).every((v) => Number.isFinite(v) && v >= 0 && v <= 0.5))
  }
})
