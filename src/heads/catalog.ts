import { PROMO_BANNERS } from '../banners'
import { DESIGNS } from './designs'
import { gridLayout, type WallLayout } from '../layout'
import type { CreateHead, HeadCategory } from './types'

export const HEAD_CATEGORIES: { key: HeadCategory; label: string }[] = [
  { key: 'designer', label: 'Designer' },
  { key: 'roboter', label: 'Roboter' },
  { key: 'gruselig', label: 'Gruselig' },
  { key: 'bloecke', label: 'Blöcke' },
  { key: 'kunst', label: 'Kunst' },
  { key: 'werbung', label: 'Werbung' },
]

/** Everything that can go on a screen of a custom wall: every built head, and the HfG banners. */
export interface CatalogEntry {
  /** Stable id stored in a saved wall, e.g. `main-3` or `promo-halloween`. */
  key: string
  name: string
  description: string
  categories: HeadCategory[]
  /** null for a banner, which is not a head. */
  create: CreateHead | null
}

export const PROMO_KEY = 'promo'

export const CATALOG: CatalogEntry[] = [
  ...PROMO_BANNERS.map(({ key, name, description }) => ({ key, name, description, categories: ['werbung'] as HeadCategory[], create: null })),
  ...DESIGNS.filter((d) => d.create).map((d) => ({ key: `main-${d.id}`, name: d.name, description: d.description, categories: d.categories, create: d.create })),
]

export function catalogEntry(key: string | null | undefined) {
  return key ? CATALOG.find((entry) => entry.key === key) ?? null : null
}

/** A screenshot of each head, made by `npm run snapshots` (public/snapshots). */
export function snapshotUrl(key: string) {
  return `${import.meta.env.BASE_URL}snapshots/${key}.jpg`
}

/** Starting point for a custom wall: the main wall as it is. */
export const DEFAULT_WALL: WallLayout = gridLayout(Array.from({ length: 9 }, (_, slot) => {
  if (slot === 4) return PROMO_KEY
  const design = DESIGNS.find((d) => d.slot === slot && d.create)
  return design ? `main-${design.id}` : null
}))
