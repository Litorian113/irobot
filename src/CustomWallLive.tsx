import { useEffect, useMemo, useState } from 'react'
import WallView from './WallView'
import { loadCustomWall } from './customWall'
import type { WallKeys } from './heads/catalog'
import { onWallSaved } from './tracking/bus'
import { screensFromKeys } from './wall'

/** `?wall=custom`: the wall from the editor tab; reloads when it is saved again. */
export default function CustomWallLive({ slot }: { slot: number | null }) {
  const [keys, setKeys] = useState<WallKeys | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    loadCustomWall().then(({ keys }) => setKeys(keys), (e: unknown) => setError(String(e)))
    return onWallSaved((wall) => {
      if (wall === 'custom') window.location.reload()
    })
  }, [])

  // Built once per load: a new screen list would rebuild every head.
  const screens = useMemo(() => (keys ? screensFromKeys(keys) : null), [keys])
  if (error) return <p className="custom-error">Eigene Wand nicht geladen: {error}</p>
  return screens ? <WallView slot={slot} screens={screens} /> : null
}
