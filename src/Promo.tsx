import { useEffect, useState, type CSSProperties } from 'react'
import HeadCell from './HeadCell'
import { subscribe } from './tracking/bus'
import type { Vec3 } from './tracking/gaze'
import { PROMO_AFTER_MS, PROMO_HOLD_MS, type WallHead } from './wall'

/** All copy of the middle screen in one place. */
const COPY = {
  logo: `${import.meta.env.BASE_URL}images/Gmuend_logo.svg`,
  school: 'Hochschule für Gestaltung Schwäbisch Gmünd',
  idle: ['Hier schaut', 'Gestaltung zurück.'],
  seen: ['Ja, genau du.', 'Wir sehen dich.'],
  url: 'hfg-gmuend.de',
}

const STALE_MS = 2000

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
export default function Promo({ slot = 4, standIn = null, position = { x: 0, y: 0, z: 0 }, style }: {
  slot?: number
  standIn?: WallHead | null
  position?: Vec3
  style?: CSSProperties
}) {
  const present = usePresent()
  const [show, setShow] = useState(false)

  useEffect(() => {
    // Someone arrives: the message after a while. They leave: the head after a moment.
    const timer = window.setTimeout(() => setShow(present), present ? PROMO_AFTER_MS : PROMO_HOLD_MS)
    return () => window.clearTimeout(timer)
  }, [present])

  if (!standIn) return <Message present={present} style={style} />
  return (
    <div className="cell promo-stage" style={style}>
      <HeadCell slot={slot} head={standIn} position={position} />
      <div className={`promo-overlay${show ? ' on' : ''}`} aria-hidden={!show}>
        <Message present={present} />
      </div>
    </div>
  )
}

function Message({ present, style }: { present: boolean; style?: CSSProperties }) {
  const headline = present ? COPY.seen : COPY.idle
  return (
    <div className={`cell promo${present ? ' seen' : ''}`} style={style}>
      <img className="promo-logo" src={COPY.logo} alt={COPY.school} />
      <h1 className="promo-headline" key={headline[0]}>
        {headline[0]}
        <br />
        {headline[1]}
      </h1>
      <p className="promo-url">{COPY.url}</p>
    </div>
  )
}
