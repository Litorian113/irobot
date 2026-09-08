import assert from 'node:assert/strict'
import { test } from 'node:test'
import { VikiAssembly } from '../src/viki/VikiAssembly.ts'

test('activation builds the enclosure before revealing the head and reaches a finite endpoint', () => {
  const a = new VikiAssembly()
  assert.equal(a.cube, 0)
  a.update(1.5, true)
  assert.ok(a.cube > 0.5)
  assert.equal(a.face, 0, 'The cube arrives before the face')
  a.update(0.85, true)
  assert.equal(a.cube, 1)
  assert.ok(a.face > 0 && a.face < 1)
  a.update(1, true)
  assert.equal(a.progress, 1)
  assert.equal(a.face, 1)
  assert.equal(a.moving, false)
})

test('disconnect reverses from the current amount, retracts upward and leaves no residual cube', () => {
  const a = new VikiAssembly()
  a.update(1.4, true)
  const prior = a.progress
  a.update(0, false)
  assert.equal(a.progress, prior, 'Reversing must not pop or restart the effect')
  assert.equal(a.direction, -1)
  a.update(0.2, false)
  assert.ok(a.progress < prior)
  const partial = a.progress
  a.update(0, true)
  assert.equal(a.progress, partial, 'Reconnecting during dissolve continues from the visible amount')
  a.update(3, false)
  assert.equal(a.cube, 0)
  assert.equal(a.face, 0)
  assert.equal(a.moving, false)
})

test('formation timing is independent of frame rate and snapshots are deterministic', () => {
  const a = new VikiAssembly(), b = new VikiAssembly()
  for (let i = 0; i < 60; i++) a.update(1 / 60, true)
  for (let i = 0; i < 20; i++) b.update(1 / 20, true)
  assert.ok(Math.abs(a.cube - b.cube) < 1e-12)
  a.update(0, true, 0.5)
  b.update(0, false, 0.5)
  assert.equal(a.cube, b.cube)
  assert.equal(a.face, b.face)
  assert.notEqual(a.direction, b.direction)
})
