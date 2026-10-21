import { useEffect, useRef, useState } from 'react'
import { DESIGNS } from './heads/designs'
import type { HeadDesign } from './heads/types'
import { PROMO_SLOT, SLOT_NAMES, SLOTS } from './wall'

/** First they notice you (brows up), then they smile - as on the wall. */
const NOTICE_MS = 1500

function initialDesign() {
  const id = Number(new URLSearchParams(window.location.search).get('head'))
  return DESIGNS.some((d) => d.id === id) ? id : DESIGNS[0].id
}

/** One head at a time, on a 16:9 screen like an iMac's: only one WebGL context runs. */
export default function Studio() {
  const [selected, setSelected] = useState(initialDesign)
  const [webgl1, setWebgl1] = useState(false)
  const design = DESIGNS.find((d) => d.id === selected) ?? DESIGNS[0]

  const choose = (id: number) => {
    setSelected(id)
    const url = new URL(window.location.href)
    url.searchParams.set('head', String(id))
    window.history.replaceState(null, '', url)
  }

  return (
    <div className="studio">
      <nav className="studio-list" aria-label="Köpfe">
        {DESIGNS.map((d) => (
          <button
            key={d.id}
            type="button"
            className={`studio-item${d.id === selected ? ' active' : ''}${d.create ? '' : ' empty'}`}
            aria-current={d.id === selected}
            onClick={() => choose(d.id)}
          >
            <span className="studio-num">{d.id}</span>
            <span className="studio-text">
              <span className="studio-name">{d.name}</span>
              <span className="studio-desc">{d.create ? d.description : 'noch leer'}</span>
            </span>
            <SlotMap slot={d.slot} />
          </button>
        ))}
      </nav>

      <section className="studio-main">
        <header className="studio-bar">
          <div>
            <h2>{design.id} · {design.name}</h2>
            <p>Platz {design.slot} an der Wand: {SLOT_NAMES[design.slot]}</p>
          </div>
          <label className="studio-toggle">
            <input type="checkbox" checked={webgl1} onChange={(e) => setWebgl1(e.target.checked)} />
            WebGL 1 testen (wie auf den iMacs)
          </label>
        </header>
        <div className="studio-screen">
          {design.create
            ? <Stage key={`${design.id}-${webgl1}`} design={design} webgl1={webgl1} />
            : <EmptyHead design={design} />}
        </div>
        <p className="studio-hint">Maus über den Bildschirm bewegen: der Kopf schaut zu dir. Außerhalb schaut er umher.</p>
      </section>
    </div>
  )
}

function Stage({ design, webgl1 }: { design: HeadDesign; webgl1: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [status, setStatus] = useState('lädt …')

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !design.create) return
    let face: ReturnType<NonNullable<HeadDesign['create']>>
    try {
      face = design.create(canvas, { fps: 60, maxPixelRatio: 1.5, stiffness: 5, delay: 0, webgl1 })
    } catch (error) {
      console.warn(`[studio] ${design.name} konnte nicht starten`, error)
      // The renderer is all this view is; its failure is the message.
      // oxlint-disable-next-line react/set-state-in-effect
      setStatus(`Fehler: ${error instanceof Error ? error.message : String(error)}`)
      return
    }

    let pointer: { x: number; y: number } | null = null
    let since = 0
    const onMove = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect()
      pointer = { x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height }
    }
    const onLeave = () => { pointer = null }
    canvas.addEventListener('pointermove', onMove)
    canvas.addEventListener('pointerleave', onLeave)

    const started = performance.now()
    const steer = () => {
      const now = performance.now()
      if (pointer) {
        since ||= now
        face.setLook((pointer.x - 0.5) * 1.6, (0.5 - pointer.y) * 0.8)
        face.setExpression(now - since < NOTICE_MS ? 'curious' : 'happy')
        return
      }
      since = 0
      const t = (now - started) / 1000
      face.setLook(Math.sin(t * 0.21) * 0.35 + Math.sin(t * 0.067) * 0.2, Math.sin(t * 0.13) * 0.12 - 0.04)
      face.setExpression('neutral')
    }
    const steerTimer = window.setInterval(steer, 1000 / 30)
    const statsTimer = window.setInterval(() => {
      const info = face.debug()
      setStatus(`WebGL ${info.webgl} · ${info.renderedFps} fps`)
    }, 1000)

    return () => {
      window.clearInterval(steerTimer)
      window.clearInterval(statsTimer)
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerleave', onLeave)
      face.dispose()
    }
  }, [design, webgl1])

  return (
    <>
      <canvas ref={canvasRef} />
      <span className="studio-stats">{status}</span>
    </>
  )
}

function EmptyHead({ design }: { design: HeadDesign }) {
  const standIn = SLOTS[design.slot]?.style === 'dust' ? 'D.U.S.T.' : 'M.A.X.'
  return (
    <div className="studio-empty">
      <p className="studio-empty-title">{design.name} ist noch leer.</p>
      <p>Bis er gebaut ist, zeigt die Wand auf Platz {design.slot} eine {standIn}-Variante.</p>
      <p className="studio-empty-code">Neuer Kopf: <code>src/heads/designs.ts</code>, Eintrag {design.id}, muss auf WebGL 1 laufen.</p>
    </div>
  )
}

/** Where on the wall a head lives: a tiny 3x3 map, the promo screen in the middle. */
function SlotMap({ slot }: { slot: number }) {
  return (
    <span className="slot-map" aria-label={`Platz ${slot}`}>
      {Array.from({ length: 9 }, (_, i) => (
        <span key={i} className={i === slot ? 'on' : i === PROMO_SLOT ? 'promo' : ''} />
      ))}
    </span>
  )
}
