import { useEffect, useState } from 'react'
import { bannerOf, PROMO_BANNERS } from '../banners'
import FullWallStage from '../fullwall/FullWallStage'
import { PATTERNS } from '../fullwall/pattern'
import { FULL_WALL_OFF, loadFullWall, saveFullWall, sameFullWall, type FullWall } from '../fullwall/state'
import { DESIGNS } from '../heads/designs'
import { onWallSaved } from '../tracking/bus'
import { CategoryFilter, PageButton, PageHeader, Sidebar, StatusLine, Tile, type Tone } from './ui'
import { inCategory, useCategoryFilter } from './useCategoryFilter'

/** What is picked here, before it goes on the wall. */
function initialPick(): FullWall {
  const params = new URLSearchParams(window.location.search)
  const banner = bannerOf(params.get('banner'))?.key
  return { ...initialMain(params), ...(banner ? { banner } : {}) }
}

function initialMain(params: URLSearchParams): FullWall {
  const pattern = PATTERNS.find((p) => p.key === params.get('pattern'))
  if (pattern) return { mode: 'pattern', pattern: pattern.key }
  const head = params.get('wallhead')
  if (head && DESIGNS.some((d) => `main-${d.id}` === head && d.create)) return { mode: 'head', head }
  return { mode: 'pattern', pattern: 'faeden' }
}

/**
 * Ganze Wand: the nine screens as one picture. A pattern runs over all of them, or one head
 * is spread across the shelf; the two places without a screen yet are counted in. "Auf die Wand"
 * puts it on every iMac instead of the wall from Gestalten; "Aus" gives that back.
 */
export default function FullWallView() {
  const [pick, setPick] = useState<FullWall>(initialPick)
  const [live, setLive] = useState<FullWall | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [category, setCategory] = useCategoryFilter()
  /** Whether the camera can tell outlines and skeletons: the segmentation and pose models are on the server. */
  const [models, setModels] = useState<{ outlines: boolean; poses: boolean } | null>(null)

  useEffect(() => {
    const there = (file: string) => fetch(`${import.meta.env.BASE_URL}models/${file}`, { method: 'HEAD', cache: 'no-store' })
      .then((r) => r.ok && !(r.headers.get('content-type') ?? '').includes('text/html'), () => false)
    void Promise.all([there('yolo26n-seg-320.onnx'), there('yolo26n-pose-320.onnx')]).then(([outlines, poses]) => setModels({ outlines, poses }))
  }, [])

  useEffect(() => {
    const load = () => loadFullWall().then(setLive, () => setLive(FULL_WALL_OFF))
    void load()
    return onWallSaved((wall) => { if (wall === 'custom') void load() })
  }, [])

  /** A new pattern or head keeps the banner; `banner` sets one, null takes it away. */
  const choose = (main: FullWall, banner?: string | null) => {
    const { banner: _old, ...rest } = main
    const kept = banner === undefined ? pick.banner : banner ?? undefined
    const next: FullWall = kept ? { ...rest, banner: kept } : rest
    setPick(next)
    const url = new URL(window.location.href)
    url.searchParams.delete('pattern')
    url.searchParams.delete('wallhead')
    url.searchParams.delete('banner')
    if (next.mode === 'pattern') url.searchParams.set('pattern', next.pattern)
    if (next.mode === 'head') url.searchParams.set('wallhead', next.head)
    if (next.banner) url.searchParams.set('banner', next.banner)
    window.history.replaceState(null, '', url)
  }

  const put = async (state: FullWall) => {
    setBusy(true)
    setError(null)
    try {
      await saveFullWall(state)
      setLive(state)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }

  const onWall = live !== null && sameFullWall(live, pick)
  const anyOnWall = live !== null && live.mode !== 'off'
  const name = pick.mode === 'pattern'
    ? PATTERNS.find((p) => p.key === pick.pattern)?.name
    : pick.mode === 'head' ? DESIGNS.find((d) => `main-${d.id}` === pick.head)?.name : ''
  const description = pick.mode === 'pattern'
    ? PATTERNS.find((p) => p.key === pick.pattern)?.description
    : 'Ein Kopf über alle Bildschirme; die Rahmen und Lücken zwischen ihnen schneiden ihn wie Fenster.'
  const missing = pick.mode !== 'pattern' || !models ? null
    : (pick.pattern === 'silhouette' || pick.pattern === 'schraffur' || pick.pattern === 'gewirr' || pick.pattern === 'kritzel') && !models.outlines ? 'Umrisse: das Modell yolo26n-seg-320.onnx fehlt'
      : pick.pattern === 'figur' && !models.poses ? 'Skelette: das Modell yolo26n-pose-320.onnx fehlt' : null
  const tone: Tone = error ? 'error' : missing ? 'dirty' : onWall ? 'live' : null
  const status = error ?? (missing
    ? `Die Kamera liefert noch keine ${missing} (README, Ganze Wand). Bis dahin bleibt dieses Muster leer.`
    : live === null ? 'Lädt …' : onWall ? 'Läuft gerade auf der Wand' : anyOnWall ? 'Auf der Wand läuft gerade etwas anderes über alle Bildschirme' : 'Die Wand zeigt gerade die Köpfe aus Gestalten')

  return (
    <div className="split full-wall">
      <Sidebar label="Ganze Wand" hint="Muster" filter={null}>
        {PATTERNS.map((p) => (
          <Tile key={p.key} name={p.name} snapshot={`pattern-${p.key}`} title={p.description} active={pick.mode === 'pattern' && pick.pattern === p.key} onClick={() => choose({ mode: 'pattern', pattern: p.key })} />
        ))}
        <p className="sidebar-hint full-wall-heads">Werbung auf dem mittleren Bildschirm, wenn jemand stehen bleibt</p>
        {PROMO_BANNERS.map((b) => (
          <Tile key={b.key} name={b.name} snapshot={b.key} title={b.description} active={pick.banner === b.key} onClick={() => choose(pick, pick.banner === b.key ? null : b.key)} />
        ))}
        <p className="sidebar-hint full-wall-heads">Ein Kopf über die ganze Wand</p>
        <div className="full-wall-filter"><CategoryFilter value={category} onChange={setCategory} /></div>
        {DESIGNS.filter((d) => d.create && inCategory(d, category)).map((d) => (
          <Tile key={d.id} name={d.name} snapshot={`main-${d.id}`} active={pick.mode === 'head' && pick.head === `main-${d.id}`} onClick={() => choose({ mode: 'head', head: `main-${d.id}` })} />
        ))}
      </Sidebar>

      <main className="page">
        <PageHeader title="Ganze Wand" status={<StatusLine tone={tone} text={status} />}>
          {anyOnWall && <PageButton label="Aus" disabled={busy} onClick={() => void put(FULL_WALL_OFF)} />}
          <PageButton phone label={onWall ? 'Läuft auf der Wand' : 'Auf die Wand'} disabled={busy || onWall} onClick={() => void put(pick)} />
        </PageHeader>

        <p className="section-title">{name}</p>
        <div className="card full-wall-card">
          <FullWallStage key={JSON.stringify(pick)} state={pick} />
        </div>
        <p className="page-hint">
          {description}. Maus oder Finger über die Wand: so reagiert sie auf jemanden davor. Alle Plätze des Regals sind eingerechnet, auch die zwei ohne Bildschirm.
          {' '}{pick.banner ? `Auf dem mittleren Bildschirm blendet sich „${bannerOf(pick.banner)?.name}“ ein, wenn jemand stehen bleibt; noch einmal antippen nimmt sie weg.` : 'Eine Werbung links auswählen, dann blendet sie sich in der Mitte ein, wenn jemand stehen bleibt.'}
          {' '}„Aus“ zeigt wieder die Wand aus Gestalten.
        </p>
      </main>
    </div>
  )
}
