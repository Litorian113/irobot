import assert from 'node:assert/strict'
import test from 'node:test'
import { PeopleCounter, dayKey, VISITOR_AFTER_MS } from '../src/analytics.ts'

const start = new Date(2026, 9, 30, 18, 30).getTime()
const key = dayKey(new Date(start))

/** Feed the camera's count ten times a second for `ms`, from `from`; returns the time after. */
function see(counter, count, from, ms) {
  for (let t = from; t < from + ms; t += 100) counter.update(count, t)
  return from + ms
}

test('someone walking past is a passer-by, not a visitor', () => {
  const stats = {}
  const counter = new PeopleCounter(stats)
  let t = see(counter, 1, start, 3000)
  t = see(counter, 0, t, 4000)
  assert.equal(stats[key].passers, 1)
  assert.equal(stats[key].visitors, 0)
  assert.equal(counter.present, 0)
})

test('someone who stays is a visitor once, with the time they stayed', () => {
  const stats = {}
  const counter = new PeopleCounter(stats)
  let t = see(counter, 1, start, VISITOR_AFTER_MS + 12000)
  t = see(counter, 0, t, 4000)
  assert.equal(stats[key].passers, 1)
  assert.equal(stats[key].visitors, 1)
  assert.ok(Math.abs(stats[key].dwellMs - (VISITOR_AFTER_MS + 12000)) < 300)
})

test('a single frame of a misdetection counts nobody', () => {
  const stats = {}
  const counter = new PeopleCounter(stats)
  let t = see(counter, 0, start, 1000)
  t = see(counter, 1, t, 300)
  see(counter, 0, t, 4000)
  assert.equal(stats[key], undefined)
})

test('the detector losing someone for a moment does not count them twice', () => {
  const stats = {}
  const counter = new PeopleCounter(stats)
  let t = see(counter, 1, start, 3000)
  t = see(counter, 0, t, 1500)
  see(counter, 1, t, 3000)
  assert.equal(stats[key].passers, 1)
})

test('a group counts each person, a second one joining too', () => {
  const stats = {}
  const counter = new PeopleCounter(stats)
  let t = see(counter, 2, start, 3000)
  assert.equal(stats[key].passers, 2)
  t = see(counter, 3, t, 3000)
  assert.equal(stats[key].passers, 3)
  assert.equal(counter.present, 3)
  see(counter, 3, t, VISITOR_AFTER_MS)
  assert.equal(stats[key].visitors, 3)
  assert.equal(stats[key].hours[18].visitors, 3)
})

test('a misdetection that never leaves does not swallow the average', () => {
  const stats = {}
  const counter = new PeopleCounter(stats)
  const hour = 60 * 60 * 1000
  counter.update(1, start)
  counter.update(1, start + 1000)
  counter.update(1, start + hour)
  counter.update(0, start + hour)
  counter.update(0, start + hour + 3000)
  assert.equal(stats[key].dwellMs, 10 * 60 * 1000)
})
