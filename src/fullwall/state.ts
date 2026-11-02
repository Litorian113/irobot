/**
 * What the whole wall shows when it is one picture: off (every screen its own head, as in Gestalten),
 * a pattern, or one head spread over all screens; and maybe an HfG banner over the middle screen,
 * fading in when someone stands there. Stored on the server (vite.config.ts), shared by every screen.
 * Kept free of three.js and of other modules: the server checks it too.
 */


export const PATTERN_KEYS = ['faeden', 'falte', 'silhouette', 'schraffur', 'gewirr', 'figur'] as const
export type PatternKey = (typeof PATTERN_KEYS)[number]

export type FullWall = (
  | { mode: 'off' }
  | { mode: 'pattern'; pattern: PatternKey }
  | { mode: 'head'; head: string }
) & {
  /** A banner (banners.ts) over the middle screen. */
  banner?: string
}

export const FULL_WALL_OFF: FullWall = { mode: 'off' }

export function isFullWall(value: unknown): value is FullWall {
  const v = value as { mode?: unknown; pattern?: unknown; head?: unknown; banner?: unknown } | null
  if (!v || typeof v !== 'object') return false
  // A banner's key (banners.ts); one that does not exist (any more) is simply not shown.
  if (v.banner !== undefined && (typeof v.banner !== 'string' || !/^promo(-[a-z0-9]+){0,3}$/.test(v.banner))) return false
  if (v.mode === 'off') return true
  if (v.mode === 'pattern') return PATTERN_KEYS.includes(v.pattern as PatternKey)
  if (v.mode === 'head') return typeof v.head === 'string' && /^main-\d{1,4}$/.test(v.head)
  return false
}

export const sameFullWall = (a: FullWall | null, b: FullWall | null) => JSON.stringify(a) === JSON.stringify(b)

const API = '/api/full-wall'

export async function loadFullWall(): Promise<FullWall> {
  const response = await fetch(API, { cache: 'no-store' })
  if (!response.ok) return FULL_WALL_OFF
  const saved = (await response.json()) as unknown
  return isFullWall(saved) ? saved : FULL_WALL_OFF
}

/** Saves it; every screen of the wall reloads and shows it. */
export async function saveFullWall(state: FullWall) {
  const response = await fetch(API, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(state) })
  if (!response.ok) throw new Error(`Fehler ${response.status}`)
}
