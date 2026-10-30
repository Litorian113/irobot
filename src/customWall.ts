import { bannersAsAddOns } from './banners'
import { DEFAULT_WALL } from './heads/catalog'
import { gridLayout, isLayout, isLegacyKeys, type WallLayout } from './layout'

const API = '/api/custom-wall'

/** The saved custom wall from the server, or the main wall as a starting point. A nine-key wall from before rows is read as the 3x3 shelf. */
export async function loadCustomWall(): Promise<{ layout: WallLayout; saved: boolean }> {
  const response = await fetch(API, { cache: 'no-store' })
  if (!response.ok) throw new Error(`Server antwortet mit ${response.status}`)
  const { layout, keys } = (await response.json()) as { layout?: unknown; keys?: unknown }
  if (isLayout(layout)) return { layout: bannersAsAddOns(layout), saved: true }
  if (isLegacyKeys(keys)) return { layout: bannersAsAddOns(gridLayout(keys)), saved: true }
  return { layout: structuredClone(DEFAULT_WALL), saved: false }
}

/** Saves it on the server; every screen showing `?wall=custom` reloads. */
export async function saveCustomWall(layout: WallLayout) {
  const response = await fetch(API, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ layout }),
  })
  if (!response.ok) throw new Error(((await response.json().catch(() => ({}))) as { error?: string }).error ?? `Fehler ${response.status}`)
}
