/**
 * Pure geometry: a person box in the camera frame becomes a point in the room,
 * and every head on the wall gets its own yaw/pitch towards that point.
 *
 * Wall frame (metres): origin = centre of the middle screen, x to the right as
 * seen from the street, y up, z out of the screens towards the passer-by.
 */

export interface Vec3 { x: number; y: number; z: number }

/** A detection, normalised to the camera frame (0..1, origin top-left, not mirrored). */
export interface Box { x1: number; y1: number; x2: number; y2: number; score: number }

export interface CameraModel {
  /** Horizontal field of view in degrees. */
  hfov: number
  /** Frame width / height. */
  aspect: number
  /** Camera position in the wall frame; it faces +z like the screens. */
  position: Vec3
}

/** Rough body measures used to guess distance from box size. */
const PERSON_HEIGHT = 1.7
const SHOULDER_WIDTH = 0.45
const MIN_DISTANCE = 0.5
const MAX_DISTANCE = 15

/**
 * Where a detected person's face is, in the wall frame.
 * Distance comes from the box: height for a whole body, width when the body is cut off.
 */
export function locate(box: Box, cam: CameraModel): Vec3 {
  const tanX = Math.tan((cam.hfov * Math.PI) / 360)
  const tanY = tanX / cam.aspect
  const w = Math.max(1e-3, box.x2 - box.x1)
  const h = Math.max(1e-3, box.y2 - box.y1)
  const byHeight = PERSON_HEIGHT / (2 * tanY * h)
  const byWidth = SHOULDER_WIDTH / (2 * tanX * w)
  const z = clamp(Math.min(byHeight, byWidth), MIN_DISTANCE, MAX_DISTANCE)
  // The face sits near the top of the box; if the top is cut off, it is above the frame edge.
  const faceY = box.y1 + Math.min(0.1 * h, 0.12)
  const cx = (box.x1 + box.x2) / 2
  // The camera faces the street: its image left is the street's right (+x).
  return {
    x: cam.position.x + (0.5 - cx) * 2 * tanX * z,
    y: cam.position.y + (0.5 - faceY) * 2 * tanY * z,
    z: cam.position.z + z,
  }
}

/** Centre of a screen in the 3x3 wall. Slot 0 is top-left, 4 the middle, 8 bottom-right. */
export function slotPosition(slot: number, spacing: { x: number; y: number }): Vec3 {
  const col = slot % 3
  const row = Math.floor(slot / 3)
  return { x: (col - 1) * spacing.x, y: (1 - row) * spacing.y, z: 0 }
}

/** Yaw > 0 turns the face to screen-right, pitch > 0 looks up. */
export function lookAngles(from: Vec3, to: Vec3) {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const dz = Math.max(0.05, to.z - from.z)
  return { yaw: Math.atan2(dx, dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)) }
}

/**
 * Keep watching the same person while they are in view; otherwise take the
 * nearest (largest) one. `previous` is the last chosen box.
 */
export function pickTarget(boxes: readonly Box[], previous: Box | null): Box | null {
  if (!boxes.length) return null
  const area = (b: Box) => (b.x2 - b.x1) * (b.y2 - b.y1)
  if (previous) {
    let best: Box | null = null
    let bestIou = 0.15
    for (const b of boxes) {
      const overlap = iou(b, previous)
      if (overlap > bestIou) { best = b; bestIou = overlap }
    }
    // Only switch when someone clearly closer turns up.
    const largest = boxes.reduce((a, b) => (area(b) > area(a) ? b : a))
    if (best && area(largest) < area(best) * 2.5) return best
  }
  return boxes.reduce((a, b) => (area(b) > area(a) ? b : a))
}

export function iou(a: Box, b: Box) {
  const ix = Math.max(0, Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1))
  const iy = Math.max(0, Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1))
  const inter = ix * iy
  const union = (a.x2 - a.x1) * (a.y2 - a.y1) + (b.x2 - b.x1) * (b.y2 - b.y1) - inter
  return union > 0 ? inter / union : 0
}

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v))
}
