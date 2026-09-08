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


/* ---- tiny HUD-style illustrations, all thin white lines and slow light ---- */

function FigCube() {
  return (
    <svg className="docs-figure" viewBox="0 0 320 150" aria-hidden="true">
      <line x1="20" y1="10" x2="300" y2="10" className="fig-line" />
      <polygon points="132,10 188,10 214,140 106,140" className="fig-beam" />
      <line x1="160" y1="10" x2="160" y2="34" className="fig-line" />
      <g className="fig-cube-swing">
        <polygon points="160,34 202,46 202,94 160,110 118,94 118,46" className="fig-line" fill="none" />
        <polyline points="118,46 160,58 202,46" className="fig-line" fill="none" />
        <line x1="160" y1="58" x2="160" y2="110" className="fig-line" />
        <g className="fig-dots">
          <circle cx="135" cy="66" r="1.4" /><circle cx="146" cy="76" r="1.4" /><circle cx="132" cy="86" r="1.4" />
          <circle cx="150" cy="92" r="1.4" /><circle cx="140" cy="99" r="1.4" /><circle cx="172" cy="68" r="1.4" />
          <circle cx="186" cy="75" r="1.4" /><circle cx="178" cy="86" r="1.4" /><circle cx="190" cy="94" r="1.4" />
          <circle cx="170" cy="98" r="1.4" />
        </g>
      </g>
      <line x1="60" y1="140" x2="260" y2="140" className="fig-line dim" />
    </svg>
  )
}

function FigVoiceFace() {
  return (
    <svg className="docs-figure" viewBox="0 0 320 110" aria-hidden="true">
      <g className="fig-eq">
        {[0, 1, 2, 3, 4, 5, 6].map((i) => (
          <rect key={i} x={26 + i * 12} y="35" width="4" height="40" rx="2" style={{ ['--d' as string]: `${i * 0.14}s` }} />
        ))}
      </g>
      <line x1="126" y1="55" x2="196" y2="55" className="fig-flow" />
      <g className="fig-face">
        <path d="M258 20 c22 0 34 16 34 36 c0 22 -14 38 -34 38 c-20 0 -34 -16 -34 -38 c0 -20 12 -36 34 -36 z" className="fig-line" fill="none" />
        <ellipse cx="246" cy="52" rx="5" ry="2.6" />
        <ellipse cx="270" cy="52" rx="5" ry="2.6" />
        <path d="M247 74 q11 6 22 0" className="fig-line" fill="none" />
      </g>
    </svg>
  )
}

function FigStates() {
  const cells = []
  for (let r = 0; r < 5; r++) for (let c = 0; c < 4; c++) cells.push([26 + c * 12, 20 + r * 13])
  return (
    <svg className="docs-figure wide" viewBox="0 0 360 120" aria-hidden="true">
      <g>
        <rect x="12" y="8" width="88" height="88" className="fig-line dim" fill="none" />
        {cells.map(([x, y], i) => (
          <rect key={i} x={x} y={y} width="6" height="4" className={`fig-cell${i % 7 === 0 ? ' bright' : ''}`} style={{ ['--d' as string]: `${(i % 5) * 0.6}s` }} />
        ))}
        <text x="56" y="112" textAnchor="middle" className="fig-label">01 LATTICE</text>
      </g>
      <g className="fig-dust">
        <rect x="136" y="8" width="88" height="88" className="fig-line dim" fill="none" />
        {[...Array(26)].map((_, i) => {
          const a = i * 2.399963
          const rad = 12 + ((i * 37) % 30)
          return <circle key={i} cx={180 + Math.cos(a) * rad * 0.9} cy={50 + Math.sin(a) * rad * 0.75} r={i % 4 ? 1.1 : 1.7} style={{ ['--d' as string]: `${(i % 6) * 0.5}s` }} />
        })}
        <text x="180" y="112" textAnchor="middle" className="fig-label">02 DUST</text>
      </g>
      <g>
        <rect x="260" y="8" width="88" height="88" className="fig-line dim" fill="none" />
        <polygon points="304,22 336,32 336,68 304,82 272,68 272,32" className="fig-line" fill="none" />
        <polyline points="272,32 304,42 336,32" className="fig-line" fill="none" />
        <line x1="304" y1="42" x2="304" y2="82" className="fig-line" />
        <g className="fig-dots">
          <circle cx="288" cy="52" r="1.3" /><circle cx="296" cy="60" r="1.3" /><circle cx="286" cy="68" r="1.3" />
          <circle cx="318" cy="52" r="1.3" /><circle cx="312" cy="62" r="1.3" /><circle cx="322" cy="68" r="1.3" />
        </g>
        <text x="304" y="112" textAnchor="middle" className="fig-label">03 VIKI</text>
      </g>
    </svg>
  )
}

function FigPipeline() {
  const box = (x: number, w: number) => `M ${x + 7} 40 H ${x + w} V 68 L ${x + w - 7} 75 H ${x} V 47 Z`
  return (
    <svg className="docs-figure wide" viewBox="0 0 380 116" aria-hidden="true">
      <path d={box(10, 62)} className="fig-line" fill="none" />
      <text x="41" y="61" textAnchor="middle" className="fig-label">MIC</text>
      <line x1="74" y1="57" x2="118" y2="57" className="fig-flow" />
      <path d={box(120, 104)} className="fig-line" fill="none" />
      <text x="172" y="61" textAnchor="middle" className="fig-label">GPT-REALTIME</text>
      <line x1="226" y1="57" x2="268" y2="57" className="fig-flow" />
      <line x1="247" y1="57" x2="247" y2="20" className="fig-flow" />
      <line x1="247" y1="20" x2="268" y2="20" className="fig-flow" />
      <path d={box(270, 96)} className="fig-line" fill="none" />
      <text x="318" y="61" textAnchor="middle" className="fig-label">15 VISEMES</text>
      <path d={`M 277 8 H 366 V 26 L 359 33 H 270 V 15 Z`} className="fig-line" fill="none" />
      <text x="318" y="24" textAnchor="middle" className="fig-label">VOICE</text>
      <line x1="318" y1="75" x2="318" y2="96" className="fig-flow" />
      <text x="318" y="110" textAnchor="middle" className="fig-label bright">HER FACE</text>
    </svg>
  )
}

function FigLoop() {
  return (
    <svg className="docs-figure" viewBox="0 0 320 100" aria-hidden="true">
      <text x="62" y="54" textAnchor="middle" className="fig-label">HUMAN</text>
      <text x="258" y="54" textAnchor="middle" className="fig-label">MACHINE</text>
      <path d="M 96 38 Q 160 10 224 38" className="fig-flow" fill="none" />
      <path d="M 224 62 Q 160 90 96 62" className="fig-flow" fill="none" />
      <polygon points="224,38 215,31 214,42" className="fig-arrow" />
      <polygon points="96,62 105,69 106,58" className="fig-arrow" />
    </svg>
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
          <FigCube />
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
          <FigVoiceFace />
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
          <FigStates />
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
          <FigPipeline />
        </Reveal>

        <Reveal>
          <h2>Made with machines</h2>
          <p>
            This is an art-and-research project about the newest layer of AI — and it practices what it studies:
            it was built in a running dialogue with AI agents, GPT Astra chief among them, shaping shaders,
            lip-sync and character design turn by turn. A piece about talking to machines, made by talking to
            machines. The nostalgia is the compass; the technology is the material.
          </p>
          <FigLoop />
        </Reveal>

        <Reveal className="docs-credits">
          <h2>Credits</h2>
          <p>
            Concept, design, direction: <strong>Franz Anhäupl</strong>, student at HfG Schwäbisch Gmünd ·
            Voice: OpenAI <code>gpt-realtime</code> · Head: MakeHuman CC0 base with Mika Suominen's CC0 face
            units · First prototype head: a photogrammetry scan by Lee Perry-Smith / Infinite-Realities (CC BY 3.0), still bundled as a fallback · Rendering: three.js / WebGL · Built with GPT
            Astra &amp; friends, 2026.
          </p>
        </Reveal>
      </div>
    </div>
  )
}
