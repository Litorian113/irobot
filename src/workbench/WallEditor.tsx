import { useState, type CSSProperties, type DragEvent } from 'react'
import { CATALOG, catalogEntry } from '../heads/catalog'
import { cellColumns, MAX_PER_ROW, MAX_ROWS, slotLabel, type WallCell } from '../layout'
import HeadPicker from './HeadPicker'
import { CheckIcon, PencilIcon, PlusIcon } from './icons'
import { PageButton, PageHeader, SaveBar, Sidebar, StatusLine, Thumb, Tile } from './ui'
import { useWallDraft } from './useWallDraft'

/** Drag payloads: a head from the sidebar, or a screen of the wall (to swap two screens). */
const HEAD = 'application/x-hfg-head'
const SLOT = 'application/x-hfg-slot'

/** One screen of the shelf: its picture, place and head; in edit mode a red minus removes it. */
function ShelfCell({ cell, style, editing, selected, dropTarget, onClick, onClear, onRemove, onDropTarget, onDrop }: {
  cell: WallCell
  /** Where it sits in the grid of the shelf. */
  style: CSSProperties
  editing: boolean
  selected: boolean
  dropTarget: boolean
  onClick: () => void
  onClear: () => void
  onRemove: () => void
  onDropTarget: (on: boolean) => void
  onDrop: (event: DragEvent) => void
}) {
  const entry = catalogEntry(cell.key)
  return (
    <button
      type="button"
      style={style}
      className={`shelf-cell${entry ? '' : ' empty'}${dropTarget ? ' drop' : ''}${selected ? ' selected' : ''}`}
      draggable={Boolean(entry)}
      onClick={onClick}
      onDragStart={(event) => {
        event.dataTransfer.setData(SLOT, String(cell.slot))
        event.dataTransfer.effectAllowed = 'move'
      }}
      onDragOver={(event) => {
        event.preventDefault()
        onDropTarget(true)
      }}
      onDragLeave={() => onDropTarget(false)}
      onDrop={onDrop}
      aria-label={`Platz ${cell.slot}, ${slotLabel(cell.slot)}: ${entry?.name ?? 'leer'}`}
    >
      <span className="shelf-screen">
        {entry ? <Thumb snapshot={entry.key} name={entry.name} /> : <span className="shelf-empty">{editing ? 'leer' : '+ Kopf'}</span>}
      </span>
      <span className="shelf-label">
        <span className="shelf-num">{cell.slot}</span>
        <span className="shelf-name">{entry?.name ?? 'leer'}</span>
      </span>
      {editing ? (
        <span
          className="shelf-delete"
          role="button"
          aria-label={`Bildschirm ${cell.slot} entfernen`}
          onClick={(event) => {
            event.stopPropagation()
            onRemove()
          }}
        />
      ) : entry && (
        <span
          className="shelf-clear"
          role="button"
          aria-label="Leeren"
          onClick={(event) => {
            event.stopPropagation()
            onClear()
          }}
        >×</span>
      )}
    </button>
  )
}

/**
 * Gestalten: build the Live-Wand from all heads, rows of screens laid out like the shelf.
 * Tap a screen to pick its head, or drag heads from the sidebar. "Bearbeiten" changes the
 * shelf itself: add and remove screens and rows, tap two screens to swap them.
 */
export default function WallEditor({ onShowLive }: { onShowLive: () => void }) {
  const draft = useWallDraft()
  const [picker, setPicker] = useState<number | null>(null)
  const [dropTarget, setDropTarget] = useState<number | null>(null)
  const [editing, setEditing] = useState(false)
  /** In edit mode, the screen tapped first, waiting for a second one to swap with. */
  const [selected, setSelected] = useState<number | null>(null)

  const { layout } = draft
  if (!layout) {
    return <div className="split"><main className="page"><StatusLine tone={draft.tone} text={draft.status} /></main></div>
  }

  const toggleEditing = () => {
    setEditing((e) => !e)
    setSelected(null)
  }

  const onCellClick = (slot: number) => {
    if (!editing) return setPicker(slot)
    if (selected === null) return setSelected(slot)
    if (selected !== slot) draft.swap(selected, slot)
    setSelected(null)
  }

  const onDrop = (slot: number, event: DragEvent) => {
    event.preventDefault()
    setDropTarget(null)
    const from = event.dataTransfer.getData(SLOT)
    if (from !== '') draft.swap(Number(from), slot)
    else {
      const key = event.dataTransfer.getData(HEAD)
      if (catalogEntry(key)) draft.assign(slot, key)
    }
  }

  // Laid out like the shelf: a screen keeps its column. While editing, a narrow last column
  // holds the "+" of each row.
  const columns = cellColumns(layout)
  const used = Math.max(0, ...columns.map((row) => (row.length ? row[row.length - 1] + 1 : 0)))
  const template = editing ? `repeat(${Math.max(2, used)}, 1fr) minmax(40px, 0.3fr)` : `repeat(${Math.max(3, used)}, 1fr)`

  return (
    <div className={`split editor${editing ? ' editing' : ''}`}>
      <Sidebar label="Alle Köpfe" hint="Auf einen Bildschirm ziehen">
        {CATALOG.map((entry) => (
          <Tile
            key={entry.key}
            name={entry.name}
            snapshot={entry.key}
            title={entry.description}
            draggable
            onDragStart={(event) => {
              event.dataTransfer.setData(HEAD, entry.key)
              event.dataTransfer.effectAllowed = 'copy'
            }}
          />
        ))}
      </Sidebar>

      <main className="page">
        <PageHeader title="Wand gestalten" status={<StatusLine tone={draft.tone} text={draft.status} screens={layout.flat().length} />}>
          <PageButton phone label={editing ? 'Fertig' : 'Bearbeiten'} Icon={editing ? CheckIcon : PencilIcon} aria-pressed={editing} onClick={toggleEditing} />
          <PageButton label="Live ansehen" onClick={onShowLive} />
        </PageHeader>

        <p className="section-title">{editing ? 'Regal bearbeiten' : 'Regal'}</p>
        <div className="card">
          <div className="shelf" style={{ gridTemplateColumns: template }}>
            {layout.map((row, r) => [
              ...row.map((cell, i) => (
                <ShelfCell
                  key={cell.slot}
                  cell={cell}
                  style={{ gridRow: r + 1, gridColumn: columns[r][i] + 1 }}
                  editing={editing}
                  selected={selected === cell.slot}
                  dropTarget={dropTarget === cell.slot}
                  onClick={() => onCellClick(cell.slot)}
                  onClear={() => draft.assign(cell.slot, null)}
                  onRemove={() => {
                    draft.removeScreen(cell.slot)
                    setSelected((s) => (s === cell.slot ? null : s))
                  }}
                  onDropTarget={(on) => setDropTarget((t) => (on ? cell.slot : t === cell.slot ? null : t))}
                  onDrop={(event) => onDrop(cell.slot, event)}
                />
              )),
              editing && row.length < MAX_PER_ROW && (
                <div key={`add-${r}`} className="shelf-row-add" style={{ gridRow: r + 1, gridColumn: (row.length ? columns[r][row.length - 1] + 1 : 0) + 1 }}>
                  <button type="button" onClick={() => draft.addScreen(r)} aria-label={`Bildschirm in Reihe ${r + 1} hinzufügen`} title="Bildschirm in dieser Reihe hinzufügen"><PlusIcon /></button>
                  {row.length === 0 && <button type="button" className="shelf-row-remove" onClick={() => draft.removeRow(r)}>Reihe entfernen</button>}
                </div>
              ),
            ])}
          </div>
        </div>

        {editing && (
          <div className="list-group">
            {layout.length < MAX_ROWS && <button type="button" className="list-row" onClick={draft.addRow}>Reihe hinzufügen</button>}
            <button type="button" className="list-row" onClick={draft.resetToMain}>Wie die Hauptwand belegen</button>
          </div>
        )}

        <p className="page-hint">
          {editing ? (
            <>Zwei Bildschirme nacheinander antippen, um sie zu tauschen. „+“ fügt einer Reihe einen Bildschirm hinzu, das rote Minus entfernt ihn. </>
          ) : (
            <>
              <span className="hint-desk">Klicken zum Auswählen, Köpfe aus der Liste oder Bildschirme untereinander ziehen. </span>
              <span className="hint-touch">Einen Bildschirm antippen, um seinen Kopf zu wählen. </span>
            </>
          )}
          <span className="hint-tech">Die Zahl ist der Platz: der iMac öffnet <code>?wall=custom&amp;slot=N</code></span>
        </p>
      </main>

      <SaveBar show={draft.dirty} onSave={() => void draft.save()} onDiscard={draft.canDiscard ? draft.discard : undefined} />

      {picker !== null && (
        <HeadPicker
          slot={picker}
          current={draft.keyOf(picker)}
          onPick={(key) => {
            draft.assign(picker, key)
            setPicker(null)
          }}
          onClose={() => setPicker(null)}
        />
      )}
    </div>
  )
}
