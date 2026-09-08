import type { Ref } from 'react'

interface Props {
  /** A session is running (listening / thinking / speaking). */
  connected: boolean
  /** The link is being established. */
  busy: boolean
  /** Hide everything but the status (used by the URL preview mode). */
  hidePreview: boolean
  previewSpeech: boolean
  /** The mic-level effect writes --level onto this element. */
  orbRef: Ref<HTMLButtonElement>
  onToggle: () => void
  onTogglePreview: () => void
}

/** The single voice control: the mic orb wakes her up and shuts her down; Preview is the debug side door. */
export default function MicControl({ connected, busy, hidePreview, previewSpeech, orbRef, onToggle, onTogglePreview }: Props) {
  return (
    <>
      <div className="controls">
        {!hidePreview && (
          <button
            type="button"
            ref={orbRef}
            className={`mic-orb${connected ? ' live' : ''}${busy ? ' busy' : ''}`}
            onClick={onToggle}
            aria-label={connected || busy ? 'Shut her down' : 'Wake her up'}
            title={connected || busy ? 'Shut her down' : 'Wake her up'}
          >
            <span className="ring r1" aria-hidden="true" />
            <span className="ring r2" aria-hidden="true" />
            <span className="pulse" aria-hidden="true" />
            <span className="tick tn" aria-hidden="true" />
            <span className="tick te" aria-hidden="true" />
            <span className="tick ts" aria-hidden="true" />
            <span className="tick tw" aria-hidden="true" />
            <svg className="mic-glyph" viewBox="0 0 24 24" aria-hidden="true">
              <rect x="9" y="3" width="6" height="11" rx="3" />
              <path d="M6 11a6 6 0 0 0 12 0" fill="none" />
              <line x1="12" y1="17" x2="12" y2="20.5" />
            </svg>
          </button>
        )}
        {!connected && !busy && !hidePreview && (
          <button type="button" className="btn ghost small preview-toggle" aria-pressed={previewSpeech} onClick={onTogglePreview}>
            {previewSpeech ? 'Stop preview' : 'Preview'}
          </button>
        )}
      </div>
      <p className="hint">
        {connected
          ? 'Speak. She is listening. Drag to turn the cube.'
          : busy
            ? 'Establishing link…'
            : 'Tap the mic to wake her. Drag to turn the cube.'}
      </p>
    </>
  )
}
