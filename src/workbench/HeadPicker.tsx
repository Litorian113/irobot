import { useEffect, useRef, type TouchEvent } from 'react'
import { CATALOG } from '../heads/catalog'
import { slotLabel } from '../layout'
import type { HeadCategory } from '../heads/types'
import { CloseIcon } from './icons'
import { CategoryFilter, Tile } from './ui'
import { inCategory } from './useCategoryFilter'

/** Pulling the sheet down this far closes it. */
const DISMISS_PX = 110

/** Choose the head of one screen: a form sheet on a tablet or desktop, a sheet from the bottom on a phone. */
export default function HeadPicker({ slot, current, currentBanner, category, onCategory, onPick, onClose }: {
  slot: number
  current: string | null
  currentBanner: string | null
  category: HeadCategory | null
  onCategory: (category: HeadCategory | null) => void
  onPick: (key: string | null) => void
  onClose: () => void
}) {
  const sheet = useRef<HTMLDivElement>(null)
  const pull = useRef<number | null>(null)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // The current head in view, not somewhere further down the list.
  useEffect(() => {
    sheet.current?.querySelector('.tile.active')?.scrollIntoView({ block: 'center' })
  }, [])

  // Pull the sheet down by its grabber to close it, as on iOS.
  const offset = (dy: number) => { if (sheet.current) sheet.current.style.transform = dy > 0 ? `translateY(${dy}px)` : '' }
  const onTouchStart = (event: TouchEvent) => { pull.current = event.touches[0].clientY }
  const onTouchMove = (event: TouchEvent) => { if (pull.current !== null) offset(event.touches[0].clientY - pull.current) }
  const onTouchEnd = (event: TouchEvent) => {
    if (pull.current === null) return
    const dy = event.changedTouches[0].clientY - pull.current
    pull.current = null
    if (dy > DISMISS_PX) onClose()
    else offset(0)
  }

  return (
    <div className="picker-backdrop" onClick={onClose}>
      <div ref={sheet} className="picker" role="dialog" aria-modal="true" aria-label={`Bildschirm ${slot} belegen`} onClick={(e) => e.stopPropagation()}>
        <header className="picker-head" onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>
          <span className="picker-grabber" aria-hidden="true" />
          <h3>
            <span>Platz {slot}</span>
            <span className="picker-sub">{slotLabel(slot)}</span>
          </h3>
          <button type="button" className="picker-close" aria-label="Fertig" onClick={onClose}>
            <CloseIcon className="picker-close-icon" />
            <span className="picker-close-label">Fertig</span>
          </button>
        </header>
        <CategoryFilter value={category} onChange={onCategory} />
        {/* The same tiles as the sidebar; "Leer lassen" is the last one. */}
        <div className="picker-list">
          {CATALOG.filter((entry) => inCategory(entry, category)).map((entry) => (
            <Tile
              key={entry.key}
              name={entry.name}
              snapshot={entry.key}
              title={entry.description}
              active={entry.key === current || entry.key === currentBanner}
              onClick={() => onPick(entry.key)}
            />
          ))}
          <Tile name="Leer lassen" snapshot={null} fallback="dunkel" active={current === null} onClick={() => onPick(null)} />
        </div>
      </div>
    </div>
  )
}
