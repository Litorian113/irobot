import { useEffect, useState } from 'react'
import { subscribe, type GazeMessage } from '../tracking/bus'
import type { Vec3 } from '../tracking/gaze'

/** The camera sends many times a second; this long without a message and it is taken as off. */
const STALE_MS = 4000

/** The floor plan in front of the wall: metres to each side of the middle screen, and away from the wall. */
const MAP_HALF_WIDTH = 2
const MAP_DEPTH = 4

/** The last message from the camera on the server, and whether it is recent. */
function useGaze() {
  const [last, setLast] = useState<{ message: GazeMessage; at: number } | null>(null)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const off = subscribe((message) => setLast({ message, at: Date.now() }))
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => {
      off()
      window.clearInterval(timer)
    }
  }, [])
  return { message: last?.message ?? null, live: last !== null && now - last.at < STALE_MS }
}

/**
 * What the camera on the server sees, as numbers and a floor plan seen from above. Only
 * where people are crosses the network, never the picture (see tracking/bus.ts).
 */
export default function CameraCard({ screens }: { screens: Vec3[] }) {
  const { message, live } = useGaze()
  const person = live && message?.present ? message.person : null
  const toX = (x: number) => ((x + MAP_HALF_WIDTH) / (2 * MAP_HALF_WIDTH)) * 100
  const toY = (z: number) => 8 + (Math.min(Math.max(z, 0), MAP_DEPTH) / MAP_DEPTH) * 50

  return (
    <>
      <p className="section-title">Kamera</p>
      <div className="camera-card">
        <div>
          <div className="camera-row">
            <span>Status</span>
            <span className={live ? 'camera-on' : 'camera-off'}>
              <span className="status-dot" aria-hidden="true" />
              {live ? 'Aktiv' : 'Keine Daten'}
            </span>
          </div>
          <div className="camera-row">
            <span>Personen im Bild</span>
            <span>{live && message ? message.count : '–'}</span>
          </div>
          <div className="camera-row">
            <span>Abstand zur Wand</span>
            <span>{person ? `${person.z.toFixed(1).replace('.', ',')} m` : '–'}</span>
          </div>
        </div>
        <svg className="camera-map" viewBox="0 0 100 60" role="img" aria-label="Draufsicht: wo die Kamera jemanden sieht">
          <line className="camera-map-wall" x1="0" y1="4" x2="100" y2="4" />
          {screens.map((s, i) => <rect key={i} className="camera-map-screen" x={toX(s.x) - 5} y="2" width="10" height="4" rx="1" />)}
          {[1, 2, 3].map((m) => <line key={m} className="camera-map-grid" x1="0" x2="100" y1={toY(m)} y2={toY(m)} />)}
          {person && <circle className="camera-map-person" cx={toX(person.x)} cy={toY(person.z)} r="2.6" />}
        </svg>
      </div>
      <p className="page-hint">
        {live
          ? 'Die Köpfe oben schauen, wohin die Kamera am Server jemanden sieht. Das Kamerabild selbst bleibt dort, übers Netz gehen nur Position und Anzahl.'
          : 'Von der Kamera am Server kommt gerade nichts: außerhalb der Zeiten (Mo–Fr 16:55–21:30) ist das normal.'}
      </p>
    </>
  )
}
