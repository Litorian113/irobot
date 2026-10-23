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
  /** Degrees the camera looks down (0: level). A camera mounted high is tilted towards the street. */
  tilt?: number
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
  // The ray through the face in camera axes, z along the view: the camera faces the street,
  // so its image left is the street's right (+x).
  const right = (0.5 - cx) * 2 * tanX * z
  const up = (0.5 - faceY) * 2 * tanY * z
  // Tilted down: the view axis drops by `tilt`, the image's up leans towards the street.
  const t = ((cam.tilt ?? 0) * Math.PI) / 180
  return {
    x: cam.position.x + right,
    y: cam.position.y + up * Math.cos(t) - z * Math.sin(t),
    z: cam.position.z + up * Math.sin(t) + z * Math.cos(t),
  }
}

/**
 * Centre of the screen in `column` of `row` (both from 0, top-left). Column 1 of row 1 is the
 * middle of the 3x3 shelf, the origin. `shift` moves it off the grid, e.g. a screen standing a
 * little further out than the others.
 */
export function screenPosition(column: number, row: number, spacing: { x: number; y: number }, shift?: Partial<Vec3>): Vec3 {
  return { x: (column - 1) * spacing.x + (shift?.x ?? 0), y: (1 - row) * spacing.y + (shift?.y ?? 0), z: shift?.z ?? 0 }
}

/** Centre of a screen in the 3x3 wall. Slot 0 is top-left, 4 the middle, 8 bottom-right. */
export function slotPosition(slot: number, spacing: { x: number; y: number }, shift?: Partial<Vec3>): Vec3 {
  return screenPosition(slot % 3, Math.floor(slot / 3), spacing, shift)
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
