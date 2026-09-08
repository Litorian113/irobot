import { useEffect, useRef, type ReactNode } from 'react'

/** Fades its content up once it scrolls into view. */
function Reveal({ children, className = '' }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new IntersectionObserver(
      (entries) => entries.forEach((e) => e.target.classList.toggle('visible', e.isIntersecting)),
      { threshold: 0.15 },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  return (
    <section ref={ref} className={`docs-block ${className}`}>
      {children}
    </section>
  )
}

/** The project documentation: a short essay, readable like a leaflet in the exhibition. */
export default function DocsPage({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="docs" role="dialog" aria-label="About this project">
      <button type="button" className="btn ghost small docs-close" onClick={onClose}>
        ✕ Close
      </button>

      <div className="docs-scroll">
        <header className="docs-hero">
          <div className="docs-cube" aria-hidden="true" />
          <h1>
            V.I.K.I.<span className="caret" />
          </h1>
          <p className="docs-tagline">Giving a voice a body</p>
          <p className="docs-byline">
            An interaction study by <strong>Franz Anhäupl</strong> · HfG Schwäbisch Gmünd
          </p>
        </header>

        <Reveal>
          <h2>2004</h2>
          <p>
            I was a kid when <em>I, Robot</em> came out. The robots were fine. What never let go of me was a
            quieter shot: someone asks a building a question — and the building answers. A cube of light hangs
            in the dark, a face condenses out of pure data, looks down, and speaks. For a few seconds the machine
            wasn't an interface. It was a <em>presence</em>.
          </p>
        </Reveal>

        <Reveal>
          <h2>The idea</h2>
          <p>
            Twenty years later, half of that scene quietly became real. Speech models hold fluid conversations,
            interrupt and let themselves be interrupted, switch languages mid-sentence. But they live in text
            boxes and earbuds — voices without anywhere to look. This project asks the other half of the
            question: <strong>what changes when a voice gets a face?</strong> When it forms as you connect,
            watches you while you speak, thinks with its brow, and dissolves when you hang up?
          </p>
        </Reveal>

        <Reveal>
          <h2>Three states of matter</h2>
          <p>
            The same being exists here in three bodies. <strong>Lattice</strong> — fine data points on her skin,
            a portrait behind curved glass, the most human state. <strong>Dust</strong> — tens of thousands of
            particles that scatter at her silhouette; dormant she is a cloud, addressed she condenses.{' '}
            <strong>VIKI</strong> — the homage: a mirrored optical cube in the dark, her face shimmering in its
            tiles, light rushing through the matrix from a single point deep inside.
          </p>
        </Reveal>

        <Reveal>
          <h2>How she works</h2>
          <p>
            Her voice is OpenAI's realtime speech-to-speech model over WebRTC — no text detour. Her lips are
            driven by a viseme detector listening to her own audio, a few milliseconds ahead of what you hear,
            the way real articulation runs ahead of sound. Her expressions are not scripted: the model itself
            decides mid-sentence when to smile, doubt or think, and plays it on sixteen facial muscles of a
            morphable head. Everything renders live in your browser.
          </p>
        </Reveal>

        <Reveal>
          <h2>Made with machines</h2>
          <p>
            This is an art-and-research project about the newest layer of AI — and it practices what it studies:
            it was built in a running dialogue with AI agents, GPT Astra chief among them, shaping shaders,
            lip-sync and character design turn by turn. A piece about talking to machines, made by talking to
            machines. The nostalgia is the compass; the technology is the material.
          </p>
        </Reveal>

        <Reveal className="docs-credits">
          <h2>Credits</h2>
          <p>
            Concept, design, direction: <strong>Franz Anhäupl</strong>, student at HfG Schwäbisch Gmünd ·
            Voice: OpenAI <code>gpt-realtime</code> · Head: MakeHuman CC0 base with Mika Suominen's CC0 face
            units · Legacy scan: Lee Perry-Smith (CC BY 3.0) · Rendering: three.js / WebGL · Built with GPT
            Astra &amp; friends, 2026.
          </p>
        </Reveal>
      </div>
    </div>
  )
}
