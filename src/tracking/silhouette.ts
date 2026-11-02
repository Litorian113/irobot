/**
 * The outline of the people in front of the wall, for the Silhouette and Schraffur patterns: a coarse
 * grid over the camera picture (upright, as the camera sees the street), per cell 0 for nobody or
 * 1-15 for which person, kept the same for a person while the camera follows them. That is all that
 * leaves the camera window besides the position: no picture, nothing kept.
 */

export const SHAPE_W = 64
export const SHAPE_H = 36

/** Who is in each cell (0-15), rows from the top, four bits a cell, into base64 for the relay. */
export function packShape(cells: Uint8Array) {
  const bytes = new Uint8Array(Math.ceil(cells.length / 2))
  for (let i = 0; i < cells.length; i++) bytes[i >> 1] |= (cells[i] & 15) << ((i & 1) * 4)
  let text = ''
  for (const byte of bytes) text += String.fromCharCode(byte)
  return btoa(text)
}

export function unpackShape(text: string): Uint8Array | null {
  try {
    const raw = atob(text)
    const cells = new Uint8Array(SHAPE_W * SHAPE_H)
    if (raw.length === Math.ceil(cells.length / 2)) {
      for (let i = 0; i < cells.length; i++) cells[i] = (raw.charCodeAt(i >> 1) >> ((i & 1) * 4)) & 15
      return cells
    }
    // One bit a cell, from a camera page that does not tell people apart yet: all one person.
    if (raw.length === Math.ceil(cells.length / 8)) {
      for (let i = 0; i < cells.length; i++) cells[i] = (raw.charCodeAt(i >> 3) >> (i & 7)) & 1
      return cells
    }
    return null
  } catch {
    return null
  }
}

/**
 * A made-up person standing with their face at (u, v) of the camera picture (0..1, v down), `size`
 * the face-to-feet height: for the preview, where the pointer stands in for someone.
 */
export function syntheticShape(u: number, v: number, size = 0.75, person = 1, cells = new Uint8Array(SHAPE_W * SHAPE_H)) {
  const aspect = 16 / 9
  for (let gy = 0; gy < SHAPE_H; gy++) for (let gx = 0; gx < SHAPE_W; gx++) {
    // In units of the person's height, x scaled to the picture's aspect.
    const x = (((gx + 0.5) / SHAPE_W - u) * aspect) / size
    const y = ((gy + 0.5) / SHAPE_H - v) / size
    const head = Math.hypot(x / 0.75, y) < 0.13
    const neck = Math.abs(x) < 0.05 && y > 0 && y < 0.2
    const shoulders = y > 0.16 && y < 0.62 && Math.abs(x) < 0.2 - Math.max(0, y - 0.45) * 0.3
    const arms = y > 0.18 && y < 0.62 && Math.abs(x) > 0.2 && Math.abs(x) < 0.27 - (y - 0.18) * 0.05
    const legs = y > 0.6 && y < 1.3 && Math.abs(x) > 0.015 && Math.abs(x) < 0.15 - (y - 0.6) * 0.07
    if (head || neck || shoulders || arms || legs) cells[gy * SHAPE_W + gx] = person
  }
  return cells
}
