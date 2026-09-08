import { useEffect, useState } from 'react'
import { STYLES, type HeadStyle } from './viki/config'

interface Props {
  style: HeadStyle
  onSelect: (s: HeadStyle) => void
  onDocs: () => void
}

const DEG = Math.PI / 180

/** Donut sector between radii r0..r1 spanning angles a0..a1 (degrees, 0 = east, y down). */
function sectorPath(r0: number, r1: number, a0: number, a1: number) {
  const p = (r: number, a: number) => `${(Math.cos(a * DEG) * r).toFixed(2)} ${(Math.sin(a * DEG) * r).toFixed(2)}`
  return `M ${p(r1, a0)} A ${r1} ${r1} 0 0 1 ${p(r1, a1)} L ${p(r0, a1)} A ${r0} ${r0} 0 0 0 ${p(r0, a0)} Z`
}

interface Item {
  id: HeadStyle | 'docs'
  index: string
  label: string
  hint: string
  center: number
}

/** The fan opens around the corner knob, from just below west up to north. */
const CENTERS = [173, 204, 235, 266]

const ITEMS: Item[] = [
  ...STYLES.map((s, i) => ({
    id: s.id as HeadStyle | 'docs',
    index: String(i + 1).padStart(2, '0'),
    label: s.label,
    hint: s.hint,
    center: CENTERS[i],
  })),
  { id: 'docs', index: '04', label: 'Docs', hint: 'About this project', center: CENTERS[3] },
]

/** The style wheel: a dark dial in the bottom-right corner fans open around itself. */
export default function RadialMenu({ style, onSelect, onDocs }: Props) {
  const [phase, setPhase] = useState<'closed' | 'open' | 'closing'>('closed')
  const [hover, setHover] = useState<Item | null>(null)
  const open = phase === 'open'

  // The fan folds back before it leaves the DOM.
  const close = () => {
    setHover(null)
    setPhase((p) => (p === 'open' ? 'closing' : p))
  }

  useEffect(() => {
    if (phase !== 'closing') return
    const id = window.setTimeout(() => setPhase('closed'), 400)
    return () => window.clearTimeout(id)
  }, [phase])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const pick = (item: Item) => {
    close()
    if (item.id === 'docs') onDocs()
    else onSelect(item.id)
  }

  return (
    <>
      {phase !== 'closed' && <div className={`wheel-overlay${phase === 'closing' ? ' closing' : ''}`} onClick={close} />}

      <div className={`wheel-corner${open ? ' open' : ''}`}>
        {phase !== 'closed' && (
          <div className={`wheel-fan${phase === 'closing' ? ' closing' : ''}`} role="menu" aria-label="Head environments">
            <svg viewBox="-160 -160 320 320">
              {ITEMS.map((item, i) => {
                const a0 = item.center - 13.5
                const a1 = item.center + 13.5
                const mid = item.center * DEG
                const cos = Math.cos(mid)
                const tx = cos * 152
                const ty = Math.sin(mid) * 152
                const anchor = cos < -0.3 ? 'end' : cos > 0.3 ? 'start' : 'middle'
                return (
                  <g
                    key={item.id}
                    className={`wheel-seg${item.id === style ? ' active' : ''}${hover?.id === item.id ? ' hover' : ''}`}
                    style={{ ['--i' as string]: i }}
                    role="menuitem"
                    onMouseEnter={() => setHover(item)}
                    onMouseLeave={() => setHover(null)}
                    onClick={() => pick(item)}
                  >
                    <path d={sectorPath(46, 132, a0, a1)} />
                    <line
                      className="seg-line"
                      x1={cos * 134}
                      y1={Math.sin(mid) * 134}
                      x2={cos * 144}
                      y2={Math.sin(mid) * 144}
                    />
                    <text x={tx} y={ty - 4} textAnchor={anchor} className="seg-index">
                      {item.index}
                    </text>
                    <text x={tx} y={ty + 12} textAnchor={anchor} className="seg-label">
                      {item.label.toUpperCase()}
                    </text>
                  </g>
                )
              })}
            </svg>
            {(() => {
              const shown = hover ?? ITEMS.find((i) => i.id === style) ?? ITEMS[0]
              return (
                <div className="wheel-hint" aria-live="polite">
                  <span className="wheel-hint-title">
                    {shown.index} · {shown.label.toUpperCase()}
                  </span>
                  <span className="wheel-hint-text">{shown.hint}</span>
                </div>
              )
            })()}
          </div>
        )}

        <button
          type="button"
          className={`wheel-knob${open ? ' open' : ''}`}
          onClick={() => (open ? close() : setPhase('open'))}
          aria-label="Head style menu"
          aria-expanded={open}
          title="Choose an environment"
        >
          <span className="knob-ring" aria-hidden="true" />
          <svg className="knob-cube" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 2.8 20 7.3v9.4L12 21.2 4 16.7V7.3z" fill="none" />
            <path d="M4 7.3 12 12l8-4.7M12 12v9.2" fill="none" />
          </svg>
        </button>
      </div>
    </>
  )
}
