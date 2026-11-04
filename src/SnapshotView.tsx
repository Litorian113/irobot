import { useEffect, useRef } from 'react'
import Promo from './Promo'
import { bannerOf } from './banners'
import { CATALOG, catalogEntry } from './heads/catalog'
import { createPattern, PATTERNS } from './fullwall/pattern'
import { createSilhouette } from './fullwall/silhouette'
import { createScribble } from './fullwall/scribble'
import { createFigures, syntheticPose } from './fullwall/figure'
import { Growth } from './fullwall/growth'
import { createGrowthView } from './fullwall/growthView'
import { SHAPE_H, SHAPE_W } from './tracking/silhouette'
import { syntheticShape } from './tracking/silhouette'
import { wallRect } from './fullwall/geometry'

/**
 * `?snapshot=<key>`: one head, filling a 16:9 window, slightly turned - what
 * `npm run snapshots` photographs for the lists of the custom wall.
 */
export default function SnapshotView({ entryKey }: { entryKey: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const banner = bannerOf(entryKey)

  // For the script: which heads there are to photograph.
  useEffect(() => {
    ;(window as unknown as { __catalogKeys?: string[] }).__catalogKeys = [...CATALOG.map((e) => e.key), ...PATTERNS.map((p) => `pattern-${p.key}`)]
  }, [])

  useEffect(() => {
    const debugWindow = window as unknown as { __snapshotHead?: unknown }
    if (banner) {
      // A banner is plain HTML: ready at once.
      debugWindow.__snapshotHead = { debug: () => ({ headLoaded: true }) }
      return () => { delete debugWindow.__snapshotHead }
    }
    const pattern = PATTERNS.find((p) => `pattern-${p.key}` === entryKey)
    if (pattern && canvasRef.current) {
      // The middle of the wall, 16:9 like the other pictures.
      const wall = wallRect()
      const h = (wall.y1 - wall.y0) * 0.62
      const view = { x0: -h * 8 / 9, x1: h * 8 / 9, y0: -h / 2, y1: h / 2 }
      let drawn
      let feed = 0
      if (pattern.key === 'geaest') {
        // Grown ahead, seeded, so the picture is the same every time.
        const branches = createGrowthView(canvasRef.current, view, { maxPixelRatio: 1 })
        let seed = 7
        const growth = new Growth(wallRect(), () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 })
        const shape = syntheticShape(0.5, 0.25, 0.6)
        for (let i = 0; i < 260; i++) {
          const delta = growth.step({ person: { x: 0, y: 0.25 }, cells: shape, gridW: SHAPE_W, gridH: SHAPE_H }, i * 0.1)
          if (delta) branches.apply(delta)
        }
        drawn = branches
      } else if (pattern.key === 'figur') {
        const figures = createFigures(canvasRef.current, view, { now: () => 40_000, maxPixelRatio: 1 })
        // The figure loads first; until then the pose would be dropped.
        feed = window.setInterval(() => figures.setPoses([{ id: 1, points: syntheticPose(0.47, 0.2, 0.75, 1.2) }]), 100)
        drawn = figures
      } else if (pattern.key === 'kritzel') {
        // Someone who has stood a while: the drawing well on its way.
        const scribble = createScribble(canvasRef.current, view, { now: () => 40_000, maxPixelRatio: 1, ahead: 3_000 })
        feed = window.setInterval(() => scribble.setShape(syntheticShape(0.5, 0.25, 0.75, 1)), 100)
        drawn = scribble
      } else if (pattern.key === 'silhouette' || pattern.key === 'schraffur' || pattern.key === 'gewirr') {
        const silhouette = createSilhouette(canvasRef.current, view, { now: () => 40_000, maxPixelRatio: 1, style: pattern.key })
        silhouette.setShape(syntheticShape(0.62, 0.3, 0.6, 2, syntheticShape(0.42, 0.22, 0.85, 1)))
        drawn = silhouette
      } else {
        drawn = createPattern(canvasRef.current, pattern.key, view, { now: () => 40_000, maxPixelRatio: 1 })
      }
      debugWindow.__snapshotHead = drawn
      return () => {
        window.clearInterval(feed)
        delete debugWindow.__snapshotHead
        drawn.dispose()
      }
    }
    const entry = catalogEntry(entryKey)
    if (!canvasRef.current || !entry?.create) return
    const face = entry.create(canvasRef.current, { fps: 60, maxPixelRatio: 1, stiffness: 8, delay: 0 })
    face.setLook(0.22, 0.04)
    face.setExpression('neutral')
    debugWindow.__snapshotHead = face
    return () => {
      delete debugWindow.__snapshotHead
      face.dispose()
    }
  }, [entryKey, banner])

  return (
    <main className="single">
      {banner ? <Promo banner={banner} /> : <div className="cell"><canvas ref={canvasRef} /></div>}
    </main>
  )
}
