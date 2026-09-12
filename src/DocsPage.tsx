import { useEffect, useRef, useState, type ReactNode } from 'react'

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

function FigDust() {
  return (
    <svg className="docs-figure" viewBox="0 0 320 130" aria-hidden="true">
      <g className="fig-dust">
        {[...Array(42)].map((_, i) => {
          const a = i * 2.399963
          const rad = 14 + ((i * 37) % 46)
          return (
            <circle
              key={i}
              cx={160 + Math.cos(a) * rad * 1.5}
              cy={62 + Math.sin(a) * rad * 0.85}
              r={i % 4 ? 1.2 : 1.9}
              style={{ ['--d' as string]: `${(i % 6) * 0.5}s` }}
            />
          )
        })}
      </g>
      <g className="fig-dots">
        <circle cx="34" cy="26" r="1.1" /><circle cx="290" cy="100" r="1.1" />
        <circle cx="302" cy="24" r="1.3" /><circle cx="22" cy="106" r="1.3" />
      </g>
    </svg>
  )
}

function FigMax() {
  const rest = [26, 41, 57, 78, 96, 121, 149, 176, 201, 226, 249, 272, 291]
  return (
    <svg className="docs-figure" viewBox="0 0 320 130" aria-hidden="true">
      <line x1="12" y1="112" x2="308" y2="112" className="fig-line dim" />
      {rest.map((x, i) => (
        <rect key={i} x={x} y={105 - (i % 3) * 3} width="7" height="5" className={`fig-cell${i % 5 === 0 ? ' bright' : ''}`} style={{ ['--d' as string]: `${(i % 4) * 0.7}s` }} />
      ))}
      <g className="fig-rise">
        <rect x="120" y="70" width="7" height="5" />
        <rect x="150" y="46" width="7" height="5" />
        <rect x="182" y="60" width="7" height="5" />
        <rect x="165" y="26" width="7" height="5" />
        <rect x="138" y="14" width="7" height="5" />
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
      <text x="172" y="61" textAnchor="middle" className="fig-label">VOICE AGENT</text>
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

const HEADS: {
  id: string
  label: string
  sections: { title: string; text: string; fig?: 'cube' | 'dust' | 'max' }[]
}[] = [
  {
    id: 'viki',
    label: 'V.I.K.I.',
    sections: [
      {
        title: '2004',
        text: `I was a kid when I, Robot came out. The robots were fine. What never let go of me was a quieter
shot: someone asks a building a question - and the building answers. A cube of light hangs in the dark, a face
condenses out of pure data, looks down, and speaks. For a few seconds the machine wasn't an interface. It was
a presence. V.I.K.I. is this project's direct quote of that shot.`,
        fig: 'cube',
      },
      {
        title: 'The homage',
        text: `A mirrored optical cube hanging in a dark hall, her face shimmering across thousands of tiles,
light pouring through the matrix. Scale is the thought here - you are not talking to a device, you are talking
to an institution. She answers from above, unhurried, and the room belongs to her. Presence as architecture.`,
      },
      {
        title: 'Oriented on',
        text: `Built against the film's server-room scene: the hanging mainframe cube, the hall with its single
shaft of light, the crowd of machines below. The palette - silver-blue phosphor on black optical glass - is
pulled from film frames; the two hall backdrops restage that room, and the assembly quotes the shot where the
cube materialises from the ceiling in raining strands.`,
      },
      {
        title: 'In motion',
        text: `The cube builds top-down: the cap first, then matrix strands with glittering tips, the floor
closing last - and it dissolves in reverse, leaving through the ceiling. Every visible window renders its own
perspective of the head inside; pixel chains crawl across the tiles like local refreshes. When the link is up
and the cube stands, she opens with the film line: "Hello, Detective."`,
      },
    ],
  },
  {
    id: 'dust',
    label: 'D.U.S.T.',
    sections: [
      {
        title: 'Held together by attention',
        text: `Dust asks how little body a presence needs. There is no surface here, only tendency: tens of
thousands of particles that lean towards a face while you speak to her, and fray into noise at her
silhouette - the visible edge between being and static. She exists only while she is addressed; hang up and
she lets go of the shape entirely. Fragility as honesty: attention is the only thing holding her together.`,
        fig: 'dust',
      },
      {
        title: 'Oriented on',
        text: `Particle portraits and point-cloud aesthetics - faces that exist only as density, the way a 3D
scan or a swarm suggests a person without ever closing the surface. And the film's quietest horror: a face
dissolving into static. The violet-on-grey palette comes from an early moodboard frame that never left the
project.`,
      },
      {
        title: 'In motion',
        text: `Every particle is sampled off her actual skin and carries the full facial rig, so the cloud
speaks and blinks like the other heads. Scatter grows at the silhouette and with distance from attention:
dormant she is a drifting cloud, addressed she condenses. The edges never close - that is the point.`,
      },
    ],
  },
  {
    id: 'max',
    label: 'M.A.X.',
    sections: [
      {
        title: 'Matter that remembers',
        text: `Max is the physical answer. His tiles have weight: they lie scattered on the floor until the
voice calls, levitate, and assemble into a monochrome sculpture - and what the head does not need simply falls
back down, bounces and comes to rest. When you leave, nothing fades out; it drops. The carpet of tiles on the
ground is not debris but potential: everything she could become, waiting on the floor.`,
        fig: 'max',
      },
      {
        title: 'Oriented on',
        text: `Mechanical mirror installations and kinetic tile walls - portraits assembled from physical
modules that tilt and catch light - and monochrome clay-render sculpture: one material, one light, no colour
to hide behind. Where VIKI is cinema and Dust is a phenomenon, Max wants to feel like an object in the room
with you.`,
      },
      {
        title: 'In motion',
        text: `A GPU simulation owns every tile: levitation with per-tile delays, spring assembly into the
speaking face, and honest gravity for everything else - real bounces, friction, tumbling, and a floor-wide
plane of tiles that rides up with each awakening and rains back down. Depth is quantised into strata, so the
portrait reads as stacked material rather than a screen.`,
      },
    ],
  },
]

const FIGURES = { cube: FigCube, dust: FigDust, max: FigMax }

/** The project documentation: a short essay, readable like a leaflet in the exhibition. */
export default function DocsPage({ onClose }: { onClose: () => void }) {
  const [head, setHead] = useState('viki')
  const active = HEADS.find((h) => h.id === head) ?? HEADS[0]
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
            {active.label}
            <span className="caret" />
          </h1>
          <p className="docs-tagline">Giving a voice a body</p>
          <p className="docs-byline">
            An interaction study by <strong>Franz Anhäupl</strong> · HfG Schwäbisch Gmünd
          </p>
          <div className="docs-toggle" role="tablist" aria-label="The three heads">
            {HEADS.map((h) => (
              <button
                key={h.id}
                type="button"
                role="tab"
                aria-selected={head === h.id}
                className={`docs-toggle-btn${head === h.id ? ' active' : ''}`}
                onClick={() => setHead(h.id)}
              >
                {h.label}
              </button>
            ))}
          </div>
        </header>

        <div key={active.id}>
          {active.sections.map((section) => {
            const Fig = section.fig ? FIGURES[section.fig] : null
            return (
              <Reveal key={section.title}>
                <h2>{section.title}</h2>
                <p>{section.text}</p>
                {Fig && <Fig />}
              </Reveal>
            )
          })}
        </div>

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
          <h2>How she works</h2>
          <p>
            Her voice is AssemblyAI's Voice Agent API: one live connection that listens, thinks and speaks, and
            decides from meaning — not silence — when you are done or when you are interrupting. Her lips are
            driven by a viseme detector listening to her own audio, a few milliseconds ahead of what you hear,
            the way real articulation runs ahead of sound. Her expressions are not scripted: while she is still
            composing, a small model reads what you just said and decides whether she smiles, doubts or thinks,
            played on sixteen facial muscles of a morphable head. Everything renders live in your browser.
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
            Voice: AssemblyAI Voice Agent API · Head: MakeHuman CC0 base with Mika Suominen's CC0 face
            units · First prototype head: a photogrammetry scan by Lee Perry-Smith / Infinite-Realities (CC BY 3.0), still bundled as a fallback · Rendering: three.js / WebGL · Built with GPT
            Astra &amp; friends, 2026.
          </p>
        </Reveal>
      </div>
    </div>
  )
}
