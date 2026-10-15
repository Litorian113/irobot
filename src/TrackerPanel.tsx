import { useEffect, useRef } from 'react'
import type { TrackerState } from './tracking/PersonTracker'

/** Live camera preview with the detections, for setting up. Mirrored, like a mirror. */
export default function TrackerPanel({ state, video }: { state: TrackerState | null; video: HTMLVideoElement | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
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
  }, [video])

  const person = state?.person
  return (
    <aside className="tracker-panel">
      <canvas ref={canvasRef} width={320} height={180} />
      <dl>
        <dt>Kamera</dt>
        <dd>{state?.camera ?? '…'}</dd>
        <dt>Detektor</dt>
        <dd>{state?.status === 'error' ? 'Fehler' : state?.provider ? `YOLO26n · ${state.provider} · ${Math.round(state.inferenceMs)} ms` : 'lädt …'}</dd>
        <dt>Personen</dt>
        <dd>{state?.boxes.length ?? 0}</dd>
        <dt>Ziel</dt>
        <dd>{person ? `x ${person.x.toFixed(2)} · y ${person.y.toFixed(2)} · ${person.z.toFixed(1)} m` : '—'}</dd>
      </dl>
      {state?.error && <p className="tracker-error">{state.error}</p>}
      <p className="tracker-hint">D: Vorschau · F: Vollbild</p>
    </aside>
  )
}
