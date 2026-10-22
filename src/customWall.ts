import { DEFAULT_WALL, type WallKeys } from './heads/catalog'

const API = '/api/custom-wall'

function isWall(value: unknown): value is WallKeys {
  return Array.isArray(value) && value.length === 9 && value.every((key) => key === null || typeof key === 'string')
}

/** The saved custom wall from the server, or the main wall as a starting point. */
export async function loadCustomWall(): Promise<{ keys: WallKeys; saved: boolean }> {
  const response = await fetch(API, { cache: 'no-store' })
  if (!response.ok) throw new Error(`Server antwortet mit ${response.status}`)
  const { keys } = (await response.json()) as { keys: unknown }
  return isWall(keys) ? { keys, saved: true } : { keys: [...DEFAULT_WALL], saved: false }
}

/** Saves it on the server; every screen showing `?wall=custom` reloads. */
export async function saveCustomWall(keys: WallKeys) {
  const response = await fetch(API, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ keys }),
  })
  if (!response.ok) throw new Error(((await response.json().catch(() => ({}))) as { error?: string }).error ?? `Fehler ${response.status}`)
}
