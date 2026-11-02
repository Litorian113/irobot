import { useEffect, useMemo, useState } from 'react'
import WallView from './WallView'
import FullWallStage from './fullwall/FullWallStage'
import FullWallTile from './fullwall/FullWallTile'
import { loadFullWall, type FullWall } from './fullwall/state'
import { loadCustomWall } from './customWall'
import type { WallLayout } from './layout'
import { onWallSaved } from './tracking/bus'
import { screensFromLayout } from './wall'

/** `?wall=custom`: the wall from the editor tab; reloads when it is saved again. */
export default function CustomWallLive({ slot }: { slot: number | null }) {
  const [layout, setLayout] = useState<WallLayout | null>(null)
  const [full, setFull] = useState<FullWall | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    loadCustomWall().then(({ layout }) => setLayout(layout), (e: unknown) => setError(String(e)))
    loadFullWall().then(setFull, () => setFull({ mode: 'off' }))
    return onWallSaved((wall) => {
      if (wall === 'custom') window.location.reload()
    })
  }, [])

  // Built once per load: new screens would rebuild every head.
  const rows = useMemo(() => (layout ? screensFromLayout(layout) : null), [layout])
  if (error) return <p className="custom-error">Eigene Wand nicht geladen: {error}</p>
  if (!full) return null
  // The whole wall as one picture (Ganze Wand): each place of the shelf shows its part of it.
  if (full.mode !== 'off') {
    if (slot === null) return <main className="single"><FullWallStage state={full} live /></main>
    return <main className="single">{slot <= 8 ? <FullWallTile slot={slot} state={full} /> : <div className="cell" />}</main>
  }
  return rows ? <WallView slot={slot} rows={rows} /> : null
}
