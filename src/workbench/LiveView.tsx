import { useEffect, useMemo, useState } from 'react'
import WallView from '../WallView'
import FullWallStage from '../fullwall/FullWallStage'
import { loadFullWall, type FullWall } from '../fullwall/state'
import { loadCustomWall } from '../customWall'
import type { WallLayout } from '../layout'
import { onWallSaved } from '../tracking/bus'
import { screenPosition } from '../tracking/gaze'
import { SETTINGS, SLOT_SHIFT, screensFromLayout, type WallRows } from '../wall'
import CameraCard from './CameraCard'
import { PencilIcon } from './icons'
import { PageButton, PageHeader, StatusLine } from './ui'

/** The screens' places on the real shelf, for the floor plan. */
function shelfPositions(rows: WallRows) {
  return rows.flatMap((row, r) => row.map((placed) => screenPosition(placed.column, r, SETTINGS.shelf, SLOT_SHIFT[placed.slot])))
}

/**
 * The Live tab: the saved Live-Wand as the iMacs show it, steered by the real camera.
 * Loads again whenever someone saves the wall.
 */
export default function LiveView({ onEdit }: { onEdit: () => void }) {
  const [layout, setLayout] = useState<WallLayout | null>(null)
  const [saved, setSaved] = useState(false)
  const [version, setVersion] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [full, setFull] = useState<FullWall | null>(null)

  useEffect(() => {
    const load = () => loadCustomWall().then(
      (result) => {
        setLayout(result.layout)
        setSaved(result.saved)
        setVersion((v) => v + 1)
      },
      (e: unknown) => setError(String(e)),
    )
    const loadFull = () => loadFullWall().then(setFull, () => setFull(null))
    void load()
    void loadFull()
    return onWallSaved((wall) => {
      if (wall !== 'custom') return
      void load()
      void loadFull()
    })
  }, [])

  const rows = useMemo(() => (layout ? screensFromLayout(layout) : null), [layout])
  const columns = rows ? Math.max(1, ...rows.flat().map((placed) => placed.column + 1)) : 3
  const status = error
    ? <StatusLine tone="error" text={`Fehler beim Laden: ${error}`} />
    : <StatusLine tone="live" text={saved ? 'So sieht die Wand gerade aus' : 'Die Hauptwand (noch nie gestaltet)'} screens={rows?.flat().length} />

  return (
    <div className="split">
      <main className="page">
        <PageHeader title="Live" status={status}>
          <PageButton phone label="Gestalten" Icon={PencilIcon} onClick={onEdit} />
        </PageHeader>

        <p className="section-title">Wand</p>
        <div className="card">
          {full && full.mode !== 'off'
            ? <FullWallStage state={full} live />
            : (
              <div className="live-stage" style={{ aspectRatio: rows ? `${columns * 16} / ${rows.length * 9}` : '16 / 9' }}>
                {rows && <WallView key={version} slot={null} rows={rows} watch />}
              </div>
            )}
        </div>

        <CameraCard screens={rows ? shelfPositions(rows) : []} />
      </main>
    </div>
  )
}
