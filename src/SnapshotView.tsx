import { useEffect, useRef } from 'react'
import Promo from './Promo'
import { bannerOf } from './banners'
import { CATALOG, catalogEntry } from './heads/catalog'

/**
 * `?snapshot=<key>`: one head, filling a 16:9 window, slightly turned - what
 * `npm run snapshots` photographs for the lists of the custom wall.
 */
export default function SnapshotView({ entryKey }: { entryKey: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const banner = bannerOf(entryKey)

  // For the script: which heads there are to photograph.
  useEffect(() => {
    ;(window as unknown as { __catalogKeys?: string[] }).__catalogKeys = CATALOG.map((e) => e.key)
  }, [])

  useEffect(() => {
    const debugWindow = window as unknown as { __snapshotHead?: unknown }
    if (banner) {
      // A banner is plain HTML: ready at once.
      debugWindow.__snapshotHead = { debug: () => ({ headLoaded: true }) }
      return () => { delete debugWindow.__snapshotHead }
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
