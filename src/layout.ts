/**
 * The shape of a wall: rows of screens, top to bottom, each row left to right.
 * A screen is known by its slot number - what its iMac opens as `?slot=N`.
 * Slots 0-8 are the places of the original 3x3 shelf; added screens get 9, 10, ...
 */

/** One screen of a wall and what it shows: a catalog key (heads/catalog.ts) or nothing yet. */
export interface WallCell {
  slot: number
  key: string | null
}

export type WallLayout = WallCell[][]

/** Places of the 3x3 shelf without a screen right now; they are left out of every wall. */
export const OFFLINE_SLOTS: readonly number[] = [0, 6]
export const isOffline = (slot: number) => OFFLINE_SLOTS.includes(slot)

export const MAX_ROWS = 8
export const MAX_PER_ROW = 8
export const MAX_SLOT = 99

/**
 * Where a cell sits in the shelf grid: its row, and its column. A place of the 3x3
 * shelf keeps its column (a row with a gap stays in line); an added screen stands
 * right of the one before it in its row.
 */
export function cellColumns(layout: WallLayout) {
  return layout.map((row) => {
    let previous = -1
    return row.map((cell) => {
      const column = cell.slot <= 8 ? Math.max(cell.slot % 3, previous + 1) : previous + 1
      previous = column
      return column
    })
  })
}

/** The 3x3 wall as rows: the nine keys of the old format, without the places that have no screen. */
export function gridLayout(keys: readonly (string | null)[]): WallLayout {
  return [0, 1, 2].map((row) => [0, 1, 2]
    .map((col) => row * 3 + col)
    .filter((slot) => !isOffline(slot))
    .map((slot) => ({ slot, key: keys[slot] ?? null })))
}

/** A label for a screen: its place in the 3x3 shelf, or its number for an added one. */
const PLACES = [
  'oben links', 'oben Mitte', 'oben rechts',
  'Mitte links', 'Mitte', 'Mitte rechts',
  'unten links', 'unten Mitte', 'unten rechts',
]
export const slotLabel = (slot: number) => PLACES[slot] ?? `Platz ${slot}`

/** The next free slot number for a new screen. */
export function nextSlot(layout: WallLayout) {
  const used = new Set(layout.flat().map((cell) => cell.slot))
  let slot = 9
  while (used.has(slot)) slot++
  return slot
}

const KEY = /^[a-z0-9-]{1,40}$/

/** A wall as stored: rows of {slot, key}, every slot once. Shared with the server (vite.config.ts). */
export function isLayout(value: unknown): value is WallLayout {
  if (!Array.isArray(value) || value.length > MAX_ROWS) return false
  const seen = new Set<number>()
  return value.every((row) => Array.isArray(row) && row.length <= MAX_PER_ROW && row.every((cell: unknown) => {
    if (!cell || typeof cell !== 'object') return false
    const { slot, key } = cell as { slot?: unknown; key?: unknown }
    if (typeof slot !== 'number' || !Number.isInteger(slot) || slot < 0 || slot > MAX_SLOT || seen.has(slot)) return false
    seen.add(slot)
    return key === null || (typeof key === 'string' && KEY.test(key))
  }))
}

/** A wall saved before rows existed: nine keys or nulls, top-left to bottom-right. */
export function isLegacyKeys(value: unknown): value is (string | null)[] {
  return Array.isArray(value) && value.length === 9 && value.every((key) => key === null || (typeof key === 'string' && KEY.test(key)))
}
