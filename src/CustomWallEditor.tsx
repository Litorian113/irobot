import { useEffect, useState, type DragEvent } from 'react'
import { loadCustomWall, saveCustomWall } from './customWall'
import { CATALOG, catalogEntry, DEFAULT_WALL, snapshotUrl, type CatalogEntry } from './heads/catalog'
import { cellColumns, MAX_PER_ROW, MAX_ROWS, nextSlot, slotLabel, type WallLayout } from './layout'

/** Drag payloads: a head from the list, or a screen of the wall (to swap two screens). */
const HEAD = 'application/x-hfg-head'
const SLOT = 'application/x-hfg-slot'

const slotName = (slot: number) => slotLabel(slot).replace(' (Werbung)', '')

/** A small picture of a head or the promo: its snapshot (`npm run snapshots`), or its name until there is one. */
function Thumb({ entry }: { entry: CatalogEntry }) {
  const [missing, setMissing] = useState(false)
  return (
    <span className="thumb">
      {missing
        ? <span className="thumb-missing">{entry.name}</span>
        : <img src={snapshotUrl(entry.key)} alt="" draggable={false} onError={() => setMissing(true)} />}
    </span>
  )
}

function Picker({ slot, current, onPick, onRemove, onClose }: {
  slot: number
  current: string | null
  onPick: (key: string | null) => void
  onRemove: () => void
  onClose: () => void
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="picker-backdrop" onClick={onClose}>
      <div className="picker" role="dialog" aria-modal="true" aria-label={`Bildschirm ${slot} belegen`} onClick={(e) => e.stopPropagation()}>
        <header className="picker-head">
          <h3>Platz {slot} · {slotName(slot)}</h3>
          <button type="button" className="picker-remove" onClick={onRemove}>Bildschirm entfernen</button>
          <button type="button" className="picker-close" onClick={onClose} aria-label="Schließen">×</button>
        </header>
        <div className="picker-list">
          {CATALOG.map((entry) => (
            <button
              key={entry.key}
              type="button"
              className={`picker-item${entry.key === current ? ' active' : ''}`}
              onClick={() => onPick(entry.key)}
            >
              <Thumb key={entry.key} entry={entry} />
              <span className="picker-name">{entry.name}</span>
            </button>
          ))}
          <button type="button" className={`picker-item picker-empty${current === null ? ' active' : ''}`} onClick={() => onPick(null)}>
            <span className="thumb"><span className="thumb-missing">leer</span></span>
            <span className="picker-name">Leer lassen</span>
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * Build a wall from all heads: rows of screens laid out like the shelf. Drag heads onto
 * screens, or click a screen to pick one; "+" adds a screen to a row, "+ Reihe" a row.
 * Saved on the server.
 */
export default function CustomWallEditor() {
  const [layout, setLayout] = useState<WallLayout | null>(null)
  const [savedLayout, setSavedLayout] = useState<WallLayout | null>(null)
  const [picker, setPicker] = useState<number | null>(null)
  const [dropTarget, setDropTarget] = useState<number | null>(null)
  const [status, setStatus] = useState<string>('lädt …')

  useEffect(() => {
    loadCustomWall().then(
      ({ layout, saved }) => {
        setLayout(layout)
        setSavedLayout(saved ? layout : null)
        setStatus(saved ? 'gespeichert' : 'noch nie gespeichert – Startpunkt ist die Hauptwand')
      },
      (error: unknown) => setStatus(`Fehler beim Laden: ${String(error)}`),
    )
  }, [])

  if (!layout) return <div className="custom"><p className="custom-status">{status}</p></div>

  const dirty = JSON.stringify(layout) !== JSON.stringify(savedLayout)
  const keyOf = (slot: number) => layout.flat().find((cell) => cell.slot === slot)?.key ?? null
  const update = (change: (current: WallLayout) => WallLayout) => setLayout((current) => current && change(current))
  const assign = (slot: number, key: string | null) =>
    update((rows) => rows.map((row) => row.map((cell) => (cell.slot === slot ? { ...cell, key } : cell))))
  const swap = (a: number, b: number) => update((rows) => {
    const ka = rows.flat().find((cell) => cell.slot === a)?.key ?? null
    const kb = rows.flat().find((cell) => cell.slot === b)?.key ?? null
    return rows.map((row) => row.map((cell) => (cell.slot === a ? { ...cell, key: kb } : cell.slot === b ? { ...cell, key: ka } : cell)))
  })
  const addScreen = (rowIndex: number) => update((rows) => rows.map((row, r) => (r === rowIndex ? [...row, { slot: nextSlot(rows), key: null }] : row)))
  const removeScreen = (slot: number) => update((rows) => rows.map((row) => row.filter((cell) => cell.slot !== slot)))
  const addRow = () => update((rows) => [...rows, []])
  const removeRow = (rowIndex: number) => update((rows) => rows.filter((_, r) => r !== rowIndex))

  const onDrop = (slot: number, event: DragEvent) => {
    event.preventDefault()
    setDropTarget(null)
    const from = event.dataTransfer.getData(SLOT)
    if (from !== '') swap(Number(from), slot)
    else {
      const key = event.dataTransfer.getData(HEAD)
      if (catalogEntry(key)) assign(slot, key)
    }
  }

  const save = async () => {
    setStatus('speichert …')
    try {
      await saveCustomWall(layout)
      setSavedLayout(layout)
      setStatus('gespeichert – alle Bildschirme mit ?wall=custom laden neu')
    } catch (error) {
      setStatus(`Fehler beim Speichern: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  // Laid out like the shelf: a screen keeps its column, "+" sits right of the last one.
  const columns = cellColumns(layout)
  const width = Math.max(3, ...columns.map((row) => (row.length ? row[row.length - 1] + 2 : 1)))

  return (
    <div className="custom">
      <aside className="custom-list" aria-label="Alle Köpfe">
        <p className="custom-list-hint">Auf einen Bildschirm ziehen</p>
        {CATALOG.map((entry) => (
          <div
            key={entry.key}
            className="custom-item"
            draggable
            onDragStart={(event) => {
              event.dataTransfer.setData(HEAD, entry.key)
              event.dataTransfer.effectAllowed = 'copy'
            }}
            title={entry.description}
          >
            <Thumb key={entry.key} entry={entry} />
            <span className="custom-item-text">
              <span className="custom-item-name">{entry.name}</span>
              <span className="custom-item-desc">{entry.description}</span>
            </span>
          </div>
        ))}
      </aside>

      <section className="custom-main">
        <header className="custom-bar">
          <div>
            <h2>Eigene Wand</h2>
            <p className={`custom-status${dirty ? ' dirty' : ''}`}>{dirty ? 'nicht gespeichert' : status}</p>
          </div>
          <div className="custom-actions">
            <button type="button" onClick={() => setLayout(structuredClone(DEFAULT_WALL))}>Wie Hauptwand</button>
            <button type="button" disabled={!dirty || !savedLayout} onClick={() => savedLayout && setLayout(savedLayout)}>Verwerfen</button>
            <a href="?wall=custom" target="_blank" rel="noreferrer">Live ansehen ↗</a>
            <button type="button" className="primary" disabled={!dirty} onClick={() => void save()}>Speichern</button>
          </div>
        </header>

        <div className="custom-grid" style={{ gridTemplateColumns: `repeat(${width}, 1fr)` }}>
          {layout.map((row, r) => [
            ...row.map((cell, i) => {
              const entry = catalogEntry(cell.key)
              return (
                <button
                  key={cell.slot}
                  type="button"
                  style={{ gridRow: r + 1, gridColumn: columns[r][i] + 1 }}
                  className={`custom-cell${entry ? '' : ' empty'}${dropTarget === cell.slot ? ' drop' : ''}`}
                  draggable={Boolean(entry)}
                  onClick={() => setPicker(cell.slot)}
                  onDragStart={(event) => {
                    event.dataTransfer.setData(SLOT, String(cell.slot))
                    event.dataTransfer.effectAllowed = 'move'
                  }}
                  onDragOver={(event) => {
                    event.preventDefault()
                    setDropTarget(cell.slot)
                  }}
                  onDragLeave={() => setDropTarget((t) => (t === cell.slot ? null : t))}
                  onDrop={(event) => onDrop(cell.slot, event)}
                  aria-label={`Platz ${cell.slot}, ${slotName(cell.slot)}: ${entry?.name ?? 'leer'}`}
                >
                  {entry ? <Thumb key={entry.key} entry={entry} /> : <span className="custom-cell-add">+ Kopf wählen</span>}
                  <span className="custom-cell-label">{cell.slot} · {entry?.name ?? 'leer'}</span>
                  {entry && (
                    <span
                      className="custom-cell-clear"
                      role="button"
                      aria-label="Leeren"
                      onClick={(event) => {
                        event.stopPropagation()
                        assign(cell.slot, null)
                      }}
                    >×</span>
                  )}
                </button>
              )
            }),
            row.length < MAX_PER_ROW && (
              <div key={`add-${r}`} className="custom-row-add" style={{ gridRow: r + 1, gridColumn: (row.length ? columns[r][row.length - 1] + 1 : 0) + 1 }}>
                <button type="button" onClick={() => addScreen(r)} title="Bildschirm in dieser Reihe hinzufügen">+</button>
                {row.length === 0 && <button type="button" className="custom-row-remove" onClick={() => removeRow(r)}>Reihe entfernen</button>}
              </div>
            ),
          ])}
        </div>
        {layout.length < MAX_ROWS && <button type="button" className="custom-add-row" onClick={addRow}>+ Reihe</button>}
        <p className="custom-hint">
          Klicken zum Auswählen, Kacheln untereinander ziehen zum Tauschen. Die Zahl ist der Platz: der iMac öffnet <code>?wall=custom&amp;slot=N</code>
        </p>
      </section>

      {picker !== null && (
        <Picker
          slot={picker}
          current={keyOf(picker)}
          onPick={(key) => {
            assign(picker, key)
            setPicker(null)
          }}
          onRemove={() => {
            removeScreen(picker)
            setPicker(null)
          }}
          onClose={() => setPicker(null)}
        />
      )}
    </div>
  )
}
