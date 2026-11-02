import { slotPosition } from '../tracking/gaze'
import { SETTINGS, SLOT_SHIFT } from '../wall'

/**
 * The whole wall as one picture, in metres (x to the right as seen from the street, y up, the middle
 * screen's centre at 0). Every iMac draws only the part its screen covers, so the picture runs on
 * behind the frames and the gaps between them, and over the two places that have no screen yet.
 */

/** The visible picture of an iMac 24" (1920 x 1200), in metres. */
export const SCREEN = { w: 0.518, h: 0.324 }

export interface Rect { x0: number; y0: number; x1: number; y1: number }

/** The picture of the screen in place `slot` (0-8) of the shelf. */
export function tileRect(slot: number): Rect {
  const c = slotPosition(slot, SETTINGS.shelf, SLOT_SHIFT[slot])
  return { x0: c.x - SCREEN.w / 2, y0: c.y - SCREEN.h / 2, x1: c.x + SCREEN.w / 2, y1: c.y + SCREEN.h / 2 }
}

/** All nine places together: the whole picture. */
export function wallRect(): Rect {
  const tiles = Array.from({ length: 9 }, (_, slot) => tileRect(slot))
  return {
    x0: Math.min(...tiles.map((t) => t.x0)),
    y0: Math.min(...tiles.map((t) => t.y0)),
    x1: Math.max(...tiles.map((t) => t.x1)),
    y1: Math.max(...tiles.map((t) => t.y1)),
  }
}

export const width = (r: Rect) => r.x1 - r.x0
export const height = (r: Rect) => r.y1 - r.y0
