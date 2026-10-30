import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULT_SCHEDULE, changes, imacsProgram, isOn, isSchedule } from '../src/schedule.ts'

const week = { on: '16:55', off: '21:30', days: 'MTWRF' }
const plain = { week, exceptions: [] }
// 30.10.2026 is a Friday.
const friday = (hour, minute = 0) => new Date(2026, 9, 30, hour, minute)
const longNight = { week, exceptions: [{ kind: 'on', from: '2026-10-30T16:55', to: '2026-10-31T06:00', note: 'Sonderbetrieb' }] }

test('the week: on between the times, on its days', () => {
  assert.equal(isOn(plain, friday(18)), true)
  assert.equal(isOn(plain, friday(16, 54)), false)
  assert.equal(isOn(plain, friday(21, 30)), false)
  assert.equal(isOn(plain, new Date(2026, 9, 31, 18)), false) // Saturday
})

test('exceptions beat the week, the later one wins', () => {
  assert.equal(isOn(longNight, friday(23)), true)
  assert.equal(isOn(longNight, new Date(2026, 9, 31, 5, 59)), true)
  assert.equal(isOn(longNight, new Date(2026, 9, 31, 6)), false)
  const both = { week, exceptions: [...longNight.exceptions, { kind: 'off', from: '2026-10-30T22:00', to: '2026-10-30T23:00', note: '' }] }
  assert.equal(isOn(both, friday(22, 30)), false)
  assert.equal(isOn(both, friday(23, 30)), true)
})

test('the next changes skip what changes nothing', () => {
  const [off, on, next] = changes(longNight, friday(22, 40))
  assert.deepEqual(off, { at: new Date(2026, 9, 31, 6), on: false })
  assert.deepEqual(on, { at: new Date(2026, 10, 2, 16, 55), on: true })
  assert.deepEqual(next, { at: new Date(2026, 10, 2, 21, 30), on: false })
})

test('a normal evening: only the week', () => {
  assert.equal(imacsProgram(plain, friday(18)), 'program 16:55 21:30 MTWRF - -')
})

test('kept on overnight: no shutdown at the usual time, one at the end, the week wakes it on Monday', () => {
  assert.equal(imacsProgram(longNight, friday(18)), 'program 16:55 - MTWRF - 2026-10-31T06:00')
})

test('before a closure: woken only after it, the evening shutdown stays', () => {
  const christmas = new Date(2026, 11, 22, 18)
  assert.equal(imacsProgram({ week, exceptions: DEFAULT_SCHEDULE.exceptions }, christmas), 'program - 21:30 MTWRF 2027-01-07T16:55 -')
})

test('an extra day on a weekend gets its own wake and shutdown', () => {
  const saturday = { week, exceptions: [{ kind: 'on', from: '2026-11-07T10:00', to: '2026-11-07T18:00', note: '' }] }
  assert.equal(imacsProgram(saturday, new Date(2026, 10, 6, 18)), 'program - 21:30 MTWRF 2026-11-07T10:00 -')
  assert.equal(imacsProgram(saturday, new Date(2026, 10, 7, 12)), 'program 16:55 21:30 MTWRF - 2026-11-07T18:00')
})

test('no days at all: nothing repeats', () => {
  assert.equal(imacsProgram({ week: { ...week, days: '' }, exceptions: [] }, friday(18)), 'program - - - - -')
})

test('only clean values pass: they end up on a command line', () => {
  assert.equal(isSchedule(DEFAULT_SCHEDULE), true)
  assert.equal(isSchedule(longNight), true)
  assert.equal(isSchedule(null), false)
  assert.equal(isSchedule({ ...plain, week: { ...week, on: '16:55; reboot' } }), false)
  assert.equal(isSchedule({ ...plain, week: { ...week, days: 'MM' } }), false)
  assert.equal(isSchedule({ ...plain, week: { ...week, days: 'X' } }), false)
  assert.equal(isSchedule({ ...plain, week: { ...week, on: '22:00' } }), false)
  assert.equal(isSchedule({ week, exceptions: [{ kind: 'on', from: '2026-10-30T16:55$(x)', to: '2026-10-31T06:00', note: '' }] }), false)
  assert.equal(isSchedule({ week, exceptions: [{ kind: 'on', from: '2026-10-31T06:00', to: '2026-10-30T16:55', note: '' }] }), false)
})
