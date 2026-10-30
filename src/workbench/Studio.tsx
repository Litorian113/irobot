import { useEffect, useRef, useState, type ReactNode } from 'react'
import { bannerOf, PROMO_BANNERS, type Banner } from '../banners'
import { catalogEntry } from '../heads/catalog'
import { DESIGNS } from '../heads/designs'
import type { HeadDesign } from '../heads/types'
import { slotLabel } from '../layout'
import { Message } from '../Promo'
import { isOffline, PROMO_SLOT, SLOTS } from '../wall'
import { CategoryFilter, Sidebar, Tile } from './ui'
import { inCategory, useCategoryFilter } from './useCategoryFilter'

/** First they notice you (brows up), then they smile - as on the wall. */
const NOTICE_MS = 1500

function initialDesign() {
  const id = Number(new URLSearchParams(window.location.search).get('head'))
  return DESIGNS.some((d) => d.id === id) ? id : DESIGNS[0].id
}

function initialBanner() {
  return bannerOf(new URLSearchParams(window.location.search).get('banner'))?.key ?? null
}

/** One fact about the head in the card below the screen: a value, what it means, and maybe a picture or switch. */
function Info({ value, label, before, after, as: Tag = 'div' }: {
  value: ReactNode
  label: string
  before?: ReactNode
  after?: ReactNode
  as?: 'div' | 'label'
}) {
  return (
    <Tag className="studio-info-item">
      {before}
      <span className="studio-info-text">
        <span className="studio-info-value">{value}</span>
        <span className="studio-info-label">{label}</span>
      </span>
      {after}
    </Tag>
  )
}

/** Köpfe: one head or banner at a time, on a 16:9 screen like an iMac's - only one WebGL context runs. */
export default function Studio() {
  const [selected, setSelected] = useState(initialDesign)
  const [selectedBanner, setSelectedBanner] = useState(initialBanner)
  const [category, setCategory] = useCategoryFilter()
  const [webgl1, setWebgl1] = useState(false)
  const [status, setStatus] = useState('lädt …')
  const design = DESIGNS.find((d) => d.id === selected) ?? DESIGNS[0]

  const choose = (id: number) => {
    setSelected(id)
    setSelectedBanner(null)
    const url = new URL(window.location.href)
    url.searchParams.set('head', String(id))
    url.searchParams.delete('banner')
    window.history.replaceState(null, '', url)
  }

  const chooseBanner = (key: string) => {
    setSelectedBanner(key)
    const url = new URL(window.location.href)
    url.searchParams.set('banner', key)
    url.searchParams.delete('head')
    window.history.replaceState(null, '', url)
  }

  const banner = bannerOf(selectedBanner)

  return (
    <div className="split studio">
      <Sidebar label="Köpfe" filter={<CategoryFilter value={category} onChange={setCategory} />}>
        {DESIGNS.filter((d) => inCategory(d, category)).map((d) => (
          <Tile key={d.id} name={d.name} snapshot={d.create ? `main-${d.id}` : null} active={!banner && d.id === selected} onClick={() => choose(d.id)} />
        ))}
        {inCategory({ categories: ['werbung'] }, category) && PROMO_BANNERS.map((b) => (
          <Tile key={b.key} name={b.name} snapshot={b.key} active={b.key === selectedBanner} onClick={() => chooseBanner(b.key)} />
        ))}
      </Sidebar>

      {/* One centred column, as wide as the window's height allows: the name, the screen, what to know about it. */}
      <main className="page">
        {banner ? <BannerDetail banner={banner} /> : (
        <div className="studio-detail">
          <h2 className="studio-title">{design.name}</h2>
          <div className="studio-screen">
            {design.create
              ? <Stage key={`${design.id}-${webgl1}`} design={design} webgl1={webgl1} onStatus={setStatus} />
              : <EmptyHead design={design} />}
          </div>
          <p className="studio-desc">{design.create ? design.description : 'Noch leer.'}</p>
          <div className="studio-info">
            <Info
              before={<SlotMap slot={design.slot} />}
              value={design.slot === null ? 'Nicht auf der Hauptwand' : `Platz ${design.slot}`}
              label={design.slot === null ? 'für die Liste und eigene Wände' : `${slotLabel(design.slot)}${isOffline(design.slot) ? ' · dort zurzeit kein Bildschirm' : ''}`}
            />
            <Info value={design.create ? status : '–'} label="Leistung in diesem Browser" />
            <Info
              as="label"
              value="WebGL 1"
              label="so rendern wie die iMacs"
              after={<input type="checkbox" role="switch" className="switch" checked={webgl1} onChange={(e) => setWebgl1(e.target.checked)} />}
            />
          </div>
          <p className="page-hint">Maus oder Finger über den Bildschirm: der Kopf schaut zu dir. Sonst schaut er umher.</p>
        </div>
        )}
      </main>
    </div>
  )
}

/** A banner: as the wall shows it, with or without someone in front of it. */
function BannerDetail({ banner }: { banner: Banner }) {
  const [present, setPresent] = useState(true)
  return (
    <div className="studio-detail">
      <h2 className="studio-title">{banner.name}</h2>
      <div className="studio-screen">
        <Message key={`${banner.key}-${present}`} banner={banner} present={present} />
      </div>
      <p className="studio-desc">{banner.description}</p>
      <div className="studio-info">
        <Info value={catalogEntry(banner.standIn)?.name ?? '–'} label="dieser Kopf läuft, bis jemand stehen bleibt" />
        <Info value={`${banner.seen.length} ${banner.seen.length === 1 ? 'Spruch' : 'Sprüche'}`} label="wechseln, solange jemand davor steht" />
        <Info
          as="label"
          value="Jemand steht davor"
          label="sonst der Text ohne Publikum"
          after={<input type="checkbox" role="switch" className="switch" checked={present} onChange={(e) => setPresent(e.target.checked)} />}
        />
      </div>
      <p className="page-hint">Aktivieren: in Gestalten auf einen Bildschirm ziehen und speichern.</p>
    </div>
  )
}

/** The head itself; tells the page how it runs (WebGL version, frame rate). */
function Stage({ design, webgl1, onStatus }: { design: HeadDesign; webgl1: boolean; onStatus: (status: string) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !design.create) return
    onStatus('lädt …')
    let face: ReturnType<NonNullable<HeadDesign['create']>>
    try {
      face = design.create(canvas, { fps: 60, maxPixelRatio: 1.5, stiffness: 5, delay: 0, webgl1 })
    } catch (error) {
      console.warn(`[studio] ${design.name} konnte nicht starten`, error)
      // The renderer is all this view is; its failure is the message.
      onStatus(`Fehler: ${error instanceof Error ? error.message : String(error)}`)
      return
    }

    // Dev aid, like window.__heads on the wall.
    const debugWindow = window as unknown as { __studioHead?: unknown }
    debugWindow.__studioHead = face

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
      onStatus(`WebGL ${info.webgl} · ${info.renderedFps} fps`)
    }, 1000)

    return () => {
      window.clearInterval(steerTimer)
      window.clearInterval(statsTimer)
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerleave', onLeave)
      if (debugWindow.__studioHead === face) delete debugWindow.__studioHead
      face.dispose()
    }
  }, [design, webgl1, onStatus])

  return <canvas ref={canvasRef} />
}

function EmptyHead({ design }: { design: HeadDesign }) {
  const standIn = design.slot !== null && SLOTS[design.slot]?.style === 'dust' ? 'D.U.S.T.' : 'M.A.X.'
  return (
    <div className="studio-empty">
      <p className="studio-empty-title">{design.name} ist noch leer.</p>
      <p>Bis er gebaut ist, zeigt die Wand auf Platz {design.slot} eine {standIn}-Variante.</p>
      <p className="studio-empty-code">Neuer Kopf: <code>src/heads/designs.ts</code>, Eintrag {design.id}, muss auf WebGL 1 laufen.</p>
    </div>
  )
}

/** Where on the wall a head lives: a tiny 3x3 map, the promo screen in the middle (none lit: not on the wall). */
function SlotMap({ slot }: { slot: number | null }) {
  return (
    <span className="slot-map" aria-label={slot === null ? 'nicht auf der Wand' : `Platz ${slot}`}>
      {Array.from({ length: 9 }, (_, i) => (
        <span key={i} className={i === slot ? 'on' : i === PROMO_SLOT ? 'promo' : isOffline(i) ? 'off' : ''} />
      ))}
    </span>
  )
}
