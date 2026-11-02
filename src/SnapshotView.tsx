import { useEffect, useRef } from 'react'
import Promo from './Promo'
import { bannerOf } from './banners'
import { CATALOG, catalogEntry } from './heads/catalog'
import { createPattern, PATTERNS } from './fullwall/pattern'
import { createSilhouette } from './fullwall/silhouette'
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
      if (pattern.key === 'silhouette') {
        const silhouette = createSilhouette(canvasRef.current, view, { now: () => 40_000, maxPixelRatio: 1 })
        silhouette.setShape(syntheticShape(0.5, 0.22, 0.85))
        drawn = silhouette
      } else {
        drawn = createPattern(canvasRef.current, pattern.key, view, { now: () => 40_000, maxPixelRatio: 1 })
      }
      debugWindow.__snapshotHead = drawn
      return () => {
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
