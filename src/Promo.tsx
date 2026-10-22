import { useEffect, useState } from 'react'
import { subscribe } from './tracking/bus'

/** All copy of the middle screen in one place. */
const COPY = {
  logo: `${import.meta.env.BASE_URL}images/Gmuend_logo.svg`,
  school: 'Hochschule für Gestaltung Schwäbisch Gmünd',
  idle: ['Hier schaut', 'Gestaltung zurück.'],
  seen: ['Ja, genau du.', 'Wir sehen dich.'],
  url: 'hfg-gmuend.de',
}

const STALE_MS = 2000

export default function Promo() {
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

  const headline = present ? COPY.seen : COPY.idle
  return (
    <div className={`cell promo${present ? ' seen' : ''}`}>
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
