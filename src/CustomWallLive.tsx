import { useEffect, useMemo, useState } from 'react'
import WallView from './WallView'
import { loadCustomWall } from './customWall'
import type { WallLayout } from './layout'
import { onWallSaved } from './tracking/bus'
import { screensFromLayout } from './wall'

/** `?wall=custom`: the wall from the editor tab; reloads when it is saved again. */
export default function CustomWallLive({ slot }: { slot: number | null }) {
  const [layout, setLayout] = useState<WallLayout | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    loadCustomWall().then(({ layout }) => setLayout(layout), (e: unknown) => setError(String(e)))
    return onWallSaved((wall) => {
      if (wall === 'custom') window.location.reload()
    })
  }, [])

  // Built once per load: new screens would rebuild every head.
  const rows = useMemo(() => (layout ? screensFromLayout(layout) : null), [layout])
  if (error) return <p className="custom-error">Eigene Wand nicht geladen: {error}</p>
  return rows ? <WallView slot={slot} rows={rows} /> : null
}
