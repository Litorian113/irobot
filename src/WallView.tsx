import { useEffect, useState, type CSSProperties } from 'react'
import HeadCell from './HeadCell'
import Promo from './Promo'
import TrackerPanel from './TrackerPanel'
import { publish } from './tracking/bus'
import { PersonTracker, type TrackerState } from './tracking/PersonTracker'
import { slotLabel } from './layout'
import { screenPosition, type Vec3 } from './tracking/gaze'
import { SETTINGS, SLOT_SHIFT, type PlacedScreen, type WallRows } from './wall'

function Screen({ placed, position, style }: { placed: PlacedScreen; position: Vec3; style?: CSSProperties }) {
  const { slot, screen } = placed
  if (screen.kind === 'promo') return <Promo slot={slot} standIn={screen.standIn} position={position} style={style} />
  if (screen.kind === 'head') return <HeadCell slot={slot} head={screen.head} position={position} style={style} />
  return (
    <div className="cell cell-empty" style={style}>
      <span className="cell-empty-num">{screen.design.id}</span>
      <span className="cell-empty-name">{screen.design.name}</span>
      <span className="cell-empty-hint">noch leer · {slotLabel(slot).replace(' (Werbung)', '')}</span>
    </div>
  )
}

/** Where a screen is in the wall frame. The all-screens page is a miniature: only the real shelf has screens off the grid. */
function positionOf(placed: PlacedScreen, row: number) {
  return screenPosition(placed.column, row, SETTINGS.spacing, SETTINGS.wall ? undefined : SLOT_SHIFT[placed.slot])
}

/**
 * A wall: all its screens on one page, laid out like the shelf, or one screen (`slot`) as on an iMac.
 * Camera and detector only run while this is mounted, only on the camera
 * machine, and only if the wall has a head to steer.
 */
export default function WallView({ slot, rows }: { slot: number | null; rows: WallRows }) {
  const hasHeads = rows.flat().some(({ screen }) => screen.kind === 'head' || (screen.kind === 'promo' && screen.standIn !== null))
  const [tracker, setTracker] = useState<PersonTracker | null>(null)
  const [trackerState, setTrackerState] = useState<TrackerState | null>(null)
  const [preview, setPreview] = useState(SETTINGS.preview)

  // Camera + detector: only in the window that owns the camera.
  useEffect(() => {
    if (!SETTINGS.camera || !hasHeads) return
    const instance = new PersonTracker({
      hfov: SETTINGS.hfov,
      cameraPosition: SETTINGS.cameraPosition,
      tilt: SETTINGS.tilt,
      rotate: SETTINGS.rotate,
      enhance: SETTINGS.enhance,
      cameraName: SETTINGS.cameraName,
      onUpdate: (state) => {
        setTrackerState(state)
        publish({ present: state.present, person: state.person, count: state.boxes.length })
      },
    })
    void instance.start()
    // The tracker only exists once mounted; the panel draws its video.
    // oxlint-disable-next-line react/set-state-in-effect
    setTracker(instance)
    return () => instance.stop()
  }, [hasHeads])

  // Testing without a camera: the pointer is the person, just in front of the wall.
  useEffect(() => {
    if (!SETTINGS.mouse) return
    const { spacing } = SETTINGS
    let pointer: { x: number; y: number } | null = null
    const onMove = (event: PointerEvent) => {
      pointer = { x: event.clientX / window.innerWidth, y: event.clientY / window.innerHeight }
    }
    // Sent at a steady rate like the camera, so a resting pointer is not taken for a lost camera.
    const timer = window.setInterval(() => {
      if (!pointer) return
      const wallWidth = (SETTINGS.wall ? 3 : 1) * spacing.x
      const wallHeight = (SETTINGS.wall ? 3 : 1) * spacing.y
      publish({
        present: true,
        person: { x: (pointer.x - 0.5) * wallWidth, y: (0.5 - pointer.y) * wallHeight, z: SETTINGS.wall ? 0.25 : 1.5 },
        count: 1,
      })
    }, 100)
    window.addEventListener('pointermove', onMove)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('pointermove', onMove)
    }
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'd' || event.key === 'D') setPreview((v) => !v)
      if (event.key === 'f' || event.key === 'F') {
        if (document.fullscreenElement) void document.exitFullscreen()
        else void document.documentElement.requestFullscreen().catch(() => {})
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const columns = Math.max(1, ...rows.flat().map((placed) => placed.column + 1))
  const row = slot === null ? -1 : rows.findIndex((r) => r.some((placed) => placed.slot === slot))
  const mine = row < 0 ? null : rows[row].find((placed) => placed.slot === slot)!
  return (
    <main
      className={slot === null ? 'wall' : 'single'}
      style={slot === null ? { gridTemplate: `repeat(${rows.length}, 1fr) / repeat(${columns}, 1fr)` } : undefined}
    >
      {slot === null
        ? rows.flatMap((r, rowIndex) => r.map((placed) => (
          <Screen
            key={placed.slot}
            placed={placed}
            position={positionOf(placed, rowIndex)}
            style={{ gridRow: rowIndex + 1, gridColumn: placed.column + 1 }}
          />
        )))
        : mine
          ? <Screen placed={mine} position={positionOf(mine, row)} />
          : <div className="cell cell-empty"><span className="cell-empty-hint">Platz {slot} gehört nicht zu dieser Wand</span></div>}
      {SETTINGS.camera && hasHeads && preview && <TrackerPanel state={trackerState} video={tracker?.video ?? null} />}
    </main>
  )
}
