import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { TrackerState } from './tracking/PersonTracker'
import { SETTINGS } from './wall'

const POSITION_KEY = 'hfg.trackerPanel'
const MARGIN = 8

type Position = { x: number; y: number }

function savedPosition(): Position | null {
  try {
    const value = JSON.parse(localStorage.getItem(POSITION_KEY) ?? 'null') as Position | null
    return value && Number.isFinite(value.x) && Number.isFinite(value.y) ? value : null
  } catch {
    return null
  }
}

/** Keep the panel fully on screen, also after the window got smaller. */
function clampToWindow(position: Position, panel: HTMLElement | null): Position {
  const w = panel?.offsetWidth ?? 320, h = panel?.offsetHeight ?? 260
  return {
    x: Math.min(Math.max(MARGIN, position.x), Math.max(MARGIN, window.innerWidth - w - MARGIN)),
    y: Math.min(Math.max(MARGIN, position.y), Math.max(MARGIN, window.innerHeight - h - MARGIN)),
  }
}

/** Live camera preview with the detections, for setting up. Mirrored, like a mirror. Drag it anywhere. */
export default function TrackerPanel({ state, video }: { state: TrackerState | null; video: HTMLVideoElement | null }) {
  const rotate = state?.rotated ?? false
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const panelRef = useRef<HTMLElement>(null)
  // null: the default corner (bottom left), until it is dragged.
  const [position, setPosition] = useState<Position | null>(savedPosition)
  const drag = useRef<{ dx: number; dy: number } | null>(null)
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    const onResize = () => setPosition((p) => (p ? clampToWindow(p, panelRef.current) : p))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const onPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return
    const rect = event.currentTarget.getBoundingClientRect()
    drag.current = { dx: event.clientX - rect.left, dy: event.clientY - rect.top }
    setDragging(true)
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const onPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    if (!drag.current) return
    setPosition(clampToWindow({ x: event.clientX - drag.current.dx, y: event.clientY - drag.current.dy }, panelRef.current))
  }
  const onPointerUp = (event: ReactPointerEvent<HTMLElement>) => {
    if (!drag.current) return
    // Where the pointer let go, not the last rendered position (one move behind).
    const final = clampToWindow({ x: event.clientX - drag.current.dx, y: event.clientY - drag.current.dy }, panelRef.current)
    drag.current = null
    setDragging(false)
    setPosition(final)
    event.currentTarget.releasePointerCapture(event.pointerId)
    try {
      localStorage.setItem(POSITION_KEY, JSON.stringify(final))
    } catch {
      /* storage unavailable: it just starts in the corner next time */
    }
  }
  const stateRef = useRef(state)
  useEffect(() => {
    stateRef.current = state
  }, [state])

  // Drawn every frame, so the picture shows even while the detector is still starting.
  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    let raf = 0
    const draw = () => {
      raf = requestAnimationFrame(draw)
      const w = canvas.width, h = canvas.height
      const current = stateRef.current
      ctx.fillStyle = '#05080d'
      ctx.fillRect(0, 0, w, h)
      if (video && video.videoWidth) {
        ctx.save()
        ctx.translate(w, 0)
        ctx.scale(-1, 1)
        // Upright like the detector sees it, when the camera hangs upside down.
        if (rotate) {
          ctx.translate(w, h)
          ctx.rotate(Math.PI)
        }
        ctx.drawImage(video, 0, 0, w, h)
        ctx.restore()
      }
      for (const box of current?.boxes ?? []) {
        const chosen = box === current?.target
        ctx.strokeStyle = chosen ? '#d58cff' : 'rgba(255,255,255,0.6)'
        ctx.lineWidth = chosen ? 3 : 1.5
        ctx.strokeRect((1 - box.x2) * w, box.y1 * h, (box.x2 - box.x1) * w, (box.y2 - box.y1) * h)
        ctx.fillStyle = ctx.strokeStyle
        ctx.font = '11px ui-monospace, monospace'
        ctx.fillText(`${Math.round(box.score * 100)}%`, (1 - box.x2) * w + 4, box.y1 * h + 13)
      }
    }
    draw()
    return () => cancelAnimationFrame(raf)
  }, [video, rotate])

  const person = state?.person
  return (
    <aside
      ref={panelRef}
      className={`tracker-panel${dragging ? ' dragging' : ''}`}
      style={position ? { left: position.x, top: position.y, bottom: 'auto' } : undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <canvas ref={canvasRef} width={320} height={180} />
      <dl>
        <dt>Kamera</dt>
        <dd>{state?.camera ?? '…'}</dd>
        <dt>Detektor</dt>
        <dd>{state?.status === 'error' ? 'Fehler' : state?.provider ? `YOLO26n · ${state.provider} · ${Math.round(state.inferenceMs)} ms` : 'lädt …'}</dd>
        <dt>Aufhellung</dt>
        <dd>{state?.light ? `Kontrast ×${state.light.gain.toFixed(1)} · Gamma ${state.light.gamma.toFixed(2)}` : 'aus'}</dd>
        <dt>Personen</dt>
        <dd>{state?.boxes.length ?? 0}</dd>
        <dt>Montage</dt>
        <dd>{`x ${SETTINGS.cameraPosition.x.toFixed(2)} · y ${SETTINGS.cameraPosition.y.toFixed(2)} m · ${SETTINGS.tilt}° nach unten${rotate ? ' · gedreht' : ''}`}</dd>
        <dt>Ziel</dt>
        <dd>{person ? `x ${person.x.toFixed(2)} · y ${person.y.toFixed(2)} · ${person.z.toFixed(1)} m` : '—'}</dd>
      </dl>
      {state?.error && <p className="tracker-error">{state.error}</p>}
      <p className="tracker-hint">Ziehen zum Verschieben · D: Vorschau · F: Vollbild</p>
    </aside>
  )
}
