import { useEffect, useState } from 'react'
import { STYLES, type HeadStyle } from './viki/config'

interface Props {
  style: HeadStyle
  onSelect: (s: HeadStyle) => void
  onDocs: () => void
}

const DEG = Math.PI / 180

/** Donut sector between radii r0..r1 spanning angles a0..a1 (degrees, 0 = east). */
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

const ITEMS: Item[] = [
  ...STYLES.map((s, i) => ({
    id: s.id as HeadStyle | 'docs',
    index: String(i + 1).padStart(2, '0'),
    label: s.label,
    hint: s.hint,
    center: -90 + i * 90,
  })),
  { id: 'docs', index: '04', label: 'Docs', hint: 'About this project', center: 180 },
]

/** The style wheel: a knob on the right edge opens a radial selection menu. */
export default function RadialMenu({ style, onSelect, onDocs }: Props) {
  const [open, setOpen] = useState(false)
  const [hover, setHover] = useState<Item | null>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const pick = (item: Item) => {
    setOpen(false)
    setHover(null)
    if (item.id === 'docs') onDocs()
    else onSelect(item.id)
  }

  const shown = hover ?? ITEMS.find((i) => i.id === style) ?? ITEMS[0]

  return (
    <>
      <button
        type="button"
        className={`wheel-knob${open ? ' open' : ''}`}
        onClick={() => setOpen((v) => !v)}
        aria-label="Head style menu"
        aria-expanded={open}
        title="Choose an environment"
      >
        <span className="knob-ring" aria-hidden="true" />
        <span className="knob-face" aria-hidden="true">
          <span className="knob-lines" />
        </span>
      </button>

      {open && (
        <div className="wheel-overlay" onClick={() => setOpen(false)} onPointerDown={(e) => e.stopPropagation()}>
          <div className="wheel" role="menu" aria-label="Head environments" onClick={(e) => e.stopPropagation()}>
            <svg viewBox="-160 -160 320 320">
              {ITEMS.map((item, i) => {
                const a0 = item.center - 40
                const a1 = item.center + 40
                const mid = (item.center * Math.PI) / 180
                const tx = Math.cos(mid) * 106
                const ty = Math.sin(mid) * 106
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
                    <path d={sectorPath(64, 148, a0, a1)} />
                    <text x={tx} y={ty - 7} textAnchor="middle" className="seg-index">
                      {item.index}
                    </text>
                    <text x={tx} y={ty + 12} textAnchor="middle" className="seg-label">
                      {item.label.toUpperCase()}
                    </text>
                  </g>
                )
              })}
            </svg>
            <div className="wheel-center" aria-live="polite">
              <span className="wheel-center-label">{shown.label}</span>
              <span className="wheel-center-hint">{shown.hint}</span>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
