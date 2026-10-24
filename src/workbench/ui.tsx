import { useState, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { snapshotUrl } from '../heads/catalog'

/*
 * The small building blocks every view of the working page shares: snapshots, the
 * sidebar of tiles, the page header with its status line, and the floating save bar.
 */

/** A head's picture, 16:9 like an iMac: its snapshot (`npm run snapshots`), or its name until there is one. */
export function Thumb({ snapshot, name }: { snapshot: string | null; name: string }) {
  const [failed, setFailed] = useState<string | null>(null)
  return (
    <span className="thumb">
      {snapshot === null || failed === snapshot
        ? <span className="thumb-missing">{name}</span>
        : <img src={snapshotUrl(snapshot)} alt="" draggable={false} loading="lazy" onError={() => setFailed(snapshot)} />}
    </span>
  )
}

/** The list beside a view: a gallery of tiles that folds away (Workbench), a library below the head on a phone. */
export function Sidebar({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <aside className="sidebar" aria-label={label}>
      {hint && <p className="sidebar-hint">{hint}</p>}
      <div className="sidebar-grid">{children}</div>
    </aside>
  )
}

/** One head in the sidebar or the picker: its picture and name, a ring when it is the chosen one. */
export function Tile({ name, snapshot, fallback, active = false, ...button }: {
  name: string
  snapshot: string | null
  /** Shown in the picture while there is no snapshot; the name by default. */
  fallback?: string
  active?: boolean
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" className={`tile${active ? ' active' : ''}`} aria-current={active} {...button}>
      <Thumb snapshot={snapshot} name={fallback ?? name} />
      <span className="tile-name">{name}</span>
    </button>
  )
}

/** Green: what the wall shows; orange: changes not saved yet; red: something failed. */
export type Tone = 'live' | 'dirty' | 'error' | null

export function StatusLine({ tone, text, screens }: { tone: Tone; text: string; screens?: number }) {
  return (
    <p className={`status${tone ? ` ${tone}` : ''}`}>
      <span className="status-dot" aria-hidden="true" />
      {text}
      {screens !== undefined && <span className="status-count"> · {screens} {screens === 1 ? 'Bildschirm' : 'Bildschirme'}</span>}
    </p>
  )
}

/** A large title with its status below and the page's buttons beside it (on a phone: one button top right). */
export function PageHeader({ title, status, children }: { title: string; status: ReactNode; children?: ReactNode }) {
  return (
    <header className="page-header">
      <div className="page-title">
        <h2>{title}</h2>
        {status}
      </div>
      {children && <div className="page-actions">{children}</div>}
    </header>
  )
}

/** Floats at the bottom while there is something to save, centred over the content. */
export function SaveBar({ show, onSave, onDiscard }: { show: boolean; onSave: () => void; onDiscard?: () => void }) {
  return (
    <div className={`save-bar${show ? ' show' : ''}`} aria-hidden={!show}>
      {onDiscard && <button type="button" className="save-discard" disabled={!show} onClick={onDiscard}>Verwerfen</button>}
      <button type="button" className="save-primary" disabled={!show} onClick={onSave}>Speichern</button>
    </div>
  )
}
