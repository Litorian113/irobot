import { useEffect, useState } from 'react'
import HeadCell from './HeadCell'
import Promo from './Promo'
import TrackerPanel from './TrackerPanel'
import { publish } from './tracking/bus'
import { PersonTracker, type TrackerState } from './tracking/PersonTracker'
import { PROMO_SLOT, SETTINGS, SLOTS } from './wall'

/** Built once: a new preset object would rebuild that head. */
const PRESETS = SLOTS.map((preset) => (preset && SETTINGS.style ? { ...preset, style: SETTINGS.style, config: undefined } : preset))

function Slot({ slot }: { slot: number }) {
  const preset = PRESETS[slot]
  if (slot === PROMO_SLOT || !preset) return <Promo />
  return <HeadCell slot={slot} preset={preset} />
}

export default function App() {
  const [tracker, setTracker] = useState<PersonTracker | null>(null)
  const [trackerState, setTrackerState] = useState<TrackerState | null>(null)
  const [preview, setPreview] = useState(SETTINGS.preview)

  // Camera + detector: only in the window that owns the camera.
  useEffect(() => {
    if (!SETTINGS.camera) return
    const instance = new PersonTracker({
      hfov: SETTINGS.hfov,
      cameraPosition: SETTINGS.cameraPosition,
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
  }, [])

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

  return (
    <main className={SETTINGS.wall ? 'wall' : 'single'}>
      {SETTINGS.slot === null
        ? SLOTS.map((_, slot) => <Slot key={slot} slot={slot} />)
        : <Slot slot={SETTINGS.slot} />}
      {SETTINGS.camera && preview && <TrackerPanel state={trackerState} video={tracker?.video ?? null} />}
    </main>
  )
}
