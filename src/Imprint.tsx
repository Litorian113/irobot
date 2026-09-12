import { useEffect, useState } from 'react'

/** Small legal notice, tucked into the bottom-left corner. */
export default function Imprint() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <>
      <button type="button" className="imprint-link" onClick={() => setOpen(true)}>
        Imprint
      </button>
      {open && (
        <div className="imprint-overlay" onClick={() => setOpen(false)}>
          <div className="imprint-panel" role="dialog" aria-label="Imprint" onClick={(e) => e.stopPropagation()}>
            <h2>Imprint</h2>
            <p>
              <strong>V.I.K.I. — Giving a Voice a Body</strong>
              <br />A private, non-commercial project.
            </p>
            <p>
              Franz Anhäupl
              <br />
              <a href="mailto:franz.anhaeupl@hfg-gmuend.de">franz.anhaeupl@hfg-gmuend.de</a>
            </p>
            <p className="imprint-fine">
              <em>I, Robot</em> is a film by 20th Century Fox; this project is an unaffiliated homage. Voice
              conversations are processed by AssemblyAI's Voice Agent API. Head model: MakeHuman (CC0) with face units
              by Mika Suominen (CC0); prototype scan by Lee Perry-Smith / Infinite-Realities (CC BY 3.0).
              Rendering: three.js.
            </p>
            <button type="button" className="btn ghost small" onClick={() => setOpen(false)}>
              Close
            </button>
          </div>
        </div>
      )}
    </>
  )
}
