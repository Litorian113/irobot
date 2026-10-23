import assert from 'node:assert/strict'
import test from 'node:test'
import { locate, lookAngles, pickTarget, slotPosition } from '../src/tracking/gaze.ts'

const camera = { hfov: 70, aspect: 16 / 9, position: { x: 0, y: 0, z: 0 } }
const box = (cx, cy, w, h, score = 0.9) => ({ x1: cx - w / 2, y1: cy - h / 2, x2: cx + w / 2, y2: cy + h / 2, score })

test('a person in the middle of the frame is straight ahead, closer when bigger', () => {
  const far = locate(box(0.5, 0.5, 0.1, 0.4), camera)
  const near = locate(box(0.5, 0.5, 0.2, 0.8), camera)
  assert.ok(Math.abs(far.x) < 1e-9)
  assert.ok(near.z < far.z)
  assert.ok(Math.abs(far.z / near.z - 2) < 1e-6)
})

test('the image left is the street right: the heads turn towards screen-right', () => {
  const person = locate(box(0.2, 0.5, 0.1, 0.4), camera)
  assert.ok(person.x > 0)
  const { yaw } = lookAngles(slotPosition(4, { x: 0.55, y: 0.5 }), person)
  assert.ok(yaw > 0)
})

test('heads on the left of the wall turn further right than those on the right (parallax)', () => {
  const person = { x: 0, y: 0, z: 1 }
  const left = lookAngles(slotPosition(3, { x: 0.55, y: 0.5 }), person)
  const right = lookAngles(slotPosition(5, { x: 0.55, y: 0.5 }), person)
  assert.ok(left.yaw > 0 && right.yaw < 0)
  assert.ok(Math.abs(left.yaw + right.yaw) < 1e-9)
})

test('a screen standing further out turns further towards the middle', () => {
  const person = { x: 0, y: 0, z: 1 }
  const onGrid = lookAngles(slotPosition(3, { x: 0.55, y: 0.5 }), person)
  const shifted = lookAngles(slotPosition(3, { x: 0.55, y: 0.5 }, { x: -0.2 }), person)
  assert.ok(shifted.yaw > onGrid.yaw)
})

test('top row looks down at a face at middle height, bottom row looks up', () => {
  const person = { x: 0, y: 0, z: 2 }
  assert.ok(lookAngles(slotPosition(1, { x: 0.55, y: 0.5 }), person).pitch < 0)
  assert.ok(lookAngles(slotPosition(7, { x: 0.55, y: 0.5 }), person).pitch > 0)
})

test('a camera tilted down sees the middle of its frame below and in front of it', () => {
  const tilted = { ...camera, position: { x: 0, y: 1, z: 0 }, tilt: 30 }
  const level = locate(box(0.5, 0.5, 0.1, 0.4), { ...tilted, tilt: 0 })
  const seen = locate(box(0.5, 0.5, 0.1, 0.4), tilted)
  // Same ray in camera axes (d along the view, up in the image), turned down by 30 degrees.
  const d = level.z, up = level.y - 1, t = Math.PI / 6
  assert.ok(Math.abs(seen.y - (1 + up * Math.cos(t) - d * Math.sin(t))) < 1e-9)
  assert.ok(Math.abs(seen.z - (up * Math.sin(t) + d * Math.cos(t))) < 1e-9)
  assert.ok(seen.y < level.y && seen.z < level.z)
})

test('a body cut off at the bottom is not mistaken for someone far away', () => {
  // Only the upper body is visible: the width keeps the distance plausible.
  const cut = locate({ x1: 0.3, y1: 0.1, x2: 0.7, y2: 1, score: 0.9 }, camera)
  assert.ok(cut.z < 1.5)
})

test('the watched person is kept until someone much closer appears', () => {
  const watched = box(0.3, 0.5, 0.1, 0.4)
  const other = box(0.7, 0.5, 0.12, 0.45)
  assert.equal(pickTarget([other, box(0.31, 0.5, 0.1, 0.4)], watched).x1, box(0.31, 0.5, 0.1, 0.4).x1)
  const close = box(0.7, 0.5, 0.3, 0.9)
  assert.equal(pickTarget([close, box(0.31, 0.5, 0.1, 0.4)], watched), close)
  assert.equal(pickTarget([], watched), null)
})
