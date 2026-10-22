import { useEffect, useState, type DragEvent } from 'react'
import { loadCustomWall, saveCustomWall } from './customWall'
import { CATALOG, catalogEntry, DEFAULT_WALL, snapshotUrl, type CatalogEntry, type WallKeys } from './heads/catalog'
import { SLOT_NAMES } from './wall'

/** Drag payloads: a head from the list, or a screen of the grid (to swap two screens). */
const HEAD = 'application/x-hfg-head'
const SLOT = 'application/x-hfg-slot'

const slotName = (slot: number) => SLOT_NAMES[slot].replace(' (Werbung)', '')

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

function Picker({ slot, current, onPick, onClose }: {
  slot: number
  current: string | null
  onPick: (key: string | null) => void
  onClose: () => void
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="picker-backdrop" onClick={onClose}>
      <div className="picker" role="dialog" aria-modal="true" aria-label={`Bildschirm ${slot + 1} belegen`} onClick={(e) => e.stopPropagation()}>
        <header className="picker-head">
          <h3>Bildschirm {slot + 1} · {slotName(slot)}</h3>
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

/** Build a wall from all heads: drag them onto screens, or click a screen to pick one. Saved on the server. */
export default function CustomWallEditor() {
  const [keys, setKeys] = useState<WallKeys | null>(null)
  const [savedKeys, setSavedKeys] = useState<WallKeys | null>(null)
  const [picker, setPicker] = useState<number | null>(null)
  const [dropTarget, setDropTarget] = useState<number | null>(null)
  const [status, setStatus] = useState<string>('lädt …')

  useEffect(() => {
    loadCustomWall().then(
      ({ keys, saved }) => {
        setKeys(keys)
        setSavedKeys(saved ? keys : null)
        setStatus(saved ? 'gespeichert' : 'noch nie gespeichert – Startpunkt ist die Hauptwand')
      },
      (error: unknown) => setStatus(`Fehler beim Laden: ${String(error)}`),
    )
  }, [])

  if (!keys) return <div className="custom"><p className="custom-status">{status}</p></div>

  const dirty = JSON.stringify(keys) !== JSON.stringify(savedKeys)
  const assign = (slot: number, key: string | null) => setKeys((current) => current && current.map((k, i) => (i === slot ? key : k)))
  const swap = (a: number, b: number) => setKeys((current) => {
    if (!current) return current
    const next = [...current]
    ;[next[a], next[b]] = [next[b], next[a]]
    return next
  })

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
      await saveCustomWall(keys)
      setSavedKeys(keys)
      setStatus('gespeichert – alle Bildschirme mit ?wall=custom laden neu')
    } catch (error) {
      setStatus(`Fehler beim Speichern: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

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
            <button type="button" onClick={() => setKeys([...DEFAULT_WALL])}>Wie Hauptwand</button>
            <button type="button" disabled={!dirty || !savedKeys} onClick={() => savedKeys && setKeys(savedKeys)}>Verwerfen</button>
            <a href="?wall=custom" target="_blank" rel="noreferrer">Live ansehen ↗</a>
            <button type="button" className="primary" disabled={!dirty} onClick={() => void save()}>Speichern</button>
          </div>
        </header>

        <div className="custom-grid">
          {keys.map((key, slot) => {
            const entry = catalogEntry(key)
            return (
              <button
                key={slot}
                type="button"
                className={`custom-cell${entry ? '' : ' empty'}${dropTarget === slot ? ' drop' : ''}`}
                draggable={Boolean(entry)}
                onClick={() => setPicker(slot)}
                onDragStart={(event) => {
                  event.dataTransfer.setData(SLOT, String(slot))
                  event.dataTransfer.effectAllowed = 'move'
                }}
                onDragOver={(event) => {
                  event.preventDefault()
                  setDropTarget(slot)
                }}
                onDragLeave={() => setDropTarget((t) => (t === slot ? null : t))}
                onDrop={(event) => onDrop(slot, event)}
                aria-label={`Bildschirm ${slot + 1}, ${slotName(slot)}: ${entry?.name ?? 'leer'}`}
              >
                {entry ? <Thumb key={entry.key} entry={entry} /> : <span className="custom-cell-add">+ Kopf wählen</span>}
                <span className="custom-cell-label">{slot + 1} · {entry?.name ?? 'leer'}</span>
                {entry && (
                  <span
                    className="custom-cell-clear"
                    role="button"
                    aria-label="Leeren"
                    onClick={(event) => {
                      event.stopPropagation()
                      assign(slot, null)
                    }}
                  >×</span>
                )}
              </button>
            )
          })}
        </div>
        <p className="custom-hint">
          Klicken zum Auswählen, Kacheln untereinander ziehen zum Tauschen. Auf den iMacs: <code>?wall=custom&amp;slot=N</code>
        </p>
      </section>

      {picker !== null && (
        <Picker
          slot={picker}
          current={keys[picker]}
          onPick={(key) => {
            assign(picker, key)
            setPicker(null)
          }}
          onClose={() => setPicker(null)}
        />
      )}
    </div>
  )
}
