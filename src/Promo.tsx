import { useEffect, useState, type CSSProperties } from 'react'
import { bannerOf, type Banner } from './banners'
import HeadCell from './HeadCell'
import { PROMO_KEY } from './heads/catalog'
import { subscribe } from './tracking/bus'
import type { Vec3 } from './tracking/gaze'
import { PROMO_AFTER_MS, PROMO_HOLD_MS, type WallHead } from './wall'

/** What every banner says the same; the rest is in banners.ts. */
const COPY = {
  school: 'Hochschule für Gestaltung Schwäbisch Gmünd',
  url: 'hfg-gmuend.de',
}

const STALE_MS = 2000
/** A banner with several lines changes after this long. */
const LINE_MS = 6000

/** Whether someone is in front of the wall right now, from the camera's messages. */
function usePresent() {
  const [present, setPresent] = useState(false)
  useEffect(() => {
    let timer = 0
    const off = subscribe((message) => {
      setPresent(message.present)
      window.clearTimeout(timer)
      timer = window.setTimeout(() => setPresent(false), STALE_MS)
    })
    return () => {
      off()
      window.clearTimeout(timer)
    }
  }, [])
  return present
}

/**
 * The promo screen. With a `standIn` head it shows that head, and the HfG message
 * only fades in once someone has stood in front of the wall for PROMO_AFTER_MS;
 * PROMO_HOLD_MS after they left the head comes back. Without one: just the message.
 */
export default function Promo({ slot = 4, standIn = null, banner = null, position = { x: 0, y: 0, z: 0 }, style }: {
  slot?: number
  standIn?: WallHead | null
  banner?: Banner | null
  position?: Vec3
  style?: CSSProperties
}) {
  const present = usePresent()
  const shown = banner ?? bannerOf(PROMO_KEY)!
  const [show, setShow] = useState(false)

  useEffect(() => {
    // Someone arrives: the message after a while. They leave: the head after a moment.
    const timer = window.setTimeout(() => setShow(present), present ? PROMO_AFTER_MS : PROMO_HOLD_MS)
    return () => window.clearTimeout(timer)
  }, [present])

  if (!standIn) return <Message key={String(present)} banner={shown} present={present} style={style} />
  return (
    <div className="cell promo-stage" style={style}>
      <HeadCell slot={slot} head={standIn} position={position} />
      <div className={`promo-overlay${show ? ' on' : ''}`} aria-hidden={!show}>
        <Message key={String(present)} banner={shown} present={present} />
      </div>
    </div>
  )
}

/** The banner itself, its copy changing by itself. Also the preview in Köpfe. */
export function Message({ banner, present, style }: { banner: Banner; present: boolean; style?: CSSProperties }) {
  const lines = present ? banner.seen : banner.idle
  const [line, setLine] = useState(0)

  useEffect(() => {
    if (lines.length < 2) return
    const timer = window.setInterval(() => setLine((current) => (current + 1) % lines.length), LINE_MS)
    return () => window.clearInterval(timer)
  }, [lines])

  const headline = lines[line % lines.length]
  return (
    <div className={`cell promo promo-${banner.look}${present ? ' seen' : ''}`} style={style}>
      <img className="promo-logo" src={`${import.meta.env.BASE_URL}images/${banner.logo}`} alt={COPY.school} />
      <h1 className="promo-headline" key={headline[0]}>
        {headline[0]}
        <br />
        {headline[1]}
      </h1>
      <p className="promo-url">{COPY.url}</p>
    </div>
  )
}
