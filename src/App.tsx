import { useEffect, useRef, useState } from 'react'
import Captions from './Captions'
import ConfigPanel from './ConfigPanel'
import DocsPage from './DocsPage'
import HudHeader from './HudHeader'
import MicControl from './MicControl'
import RadialMenu from './RadialMenu'
import { applyUrlPreview, fakeTalk, PREVIEW } from './previewMode'
import { useHeadConfig, initialStyle } from './useHeadConfig'
import { useVoiceSession } from './useVoiceSession'
import { ParticleFace } from './viki/ParticleFace'
import { loadConfig, STYLES } from './viki/config'
import type { VoiceStatus } from './viki/realtime'

/** Dev aid: `?facepass=1` shows the raw head textures (depth/light) the lattice samples. */
const DEBUG_FACE = new URLSearchParams(window.location.search).has('facepass')

const STATUS_LABEL: Record<VoiceStatus, string> = {
  idle: 'DORMANT',
  connecting: 'ESTABLISHING LINK',
  listening: 'LISTENING',
  thinking: 'PROCESSING',
  speaking: 'SPEAKING',
  error: 'LINK FAULT',
}

/** How formed / turbulent the lattice is per state. */
const STATE_FORM: Record<VoiceStatus, { face: number; turb: number; forward: number }> = {
  idle: { face: 0, turb: 0.02, forward: 1 },
  connecting: { face: 0, turb: 0.3, forward: 1 },
  listening: { face: 1.0, turb: 0.04, forward: 1 },
  thinking: { face: 1, turb: 0.08, forward: 1 },
  speaking: { face: 1.0, turb: 0.0, forward: 1 },
  error: { face: 0, turb: 0.1, forward: 1 },
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const faceRef = useRef<ParticleFace | null>(null)

  const [testSpeech, setTestSpeech] = useState(false)
  const [previewSpeech, setPreviewSpeech] = useState(false)
  const [docsOpen, setDocsOpen] = useState(false)
  const [backdrop, setBackdrop] = useState(() => {
    try {
      return localStorage.getItem('viki.backdrop') ?? 'viki-hall-main'
    } catch {
      return 'viki-hall-main'
    }
  })

  const backdropRef = useRef('viki-hall-main')
  useEffect(() => {
    backdropRef.current = backdrop
  }, [backdrop])

  const cfg = useHeadConfig(faceRef)
  const voice = useVoiceSession(faceRef, cfg.draft.speechDelay, cfg.style)
  const { status } = voice

  // Renderer lifecycle
  useEffect(() => {
    if (!canvasRef.current) return
    const face = new ParticleFace(canvasRef.current, { debugFace: DEBUG_FACE })
    faceRef.current = face
    const first = initialStyle()
    face.setStyle(first)
    face.applyConfig(loadConfig(first))
    ;(window as unknown as { __viki?: () => unknown; __vikiFace?: unknown }).__viki = () => face.debug()
    ;(window as unknown as { __vikiFace?: unknown }).__vikiFace = face
    applyUrlPreview(face, STATE_FORM.speaking)
    face.setBackdrop(backdropRef.current)
    return () => {
      face.dispose()
      faceRef.current = null
    }
  }, [])

  // Map voice status → formation of the lattice + mouth source.
  // While the configurator is open the face is forced into its active look.
  useEffect(() => {
    const face = faceRef.current
    const lipRef = voice.lipRef
    if (!face || PREVIEW) return
    face.setActive(cfg.configOpen || previewSpeech || (status !== 'idle' && status !== 'error'))
    if (cfg.configOpen) {
      face.setTarget({ face: 1, turb: 0, forward: 1 })
      face.setExpression('neutral')
      const t0 = performance.now()
      face.setMouthSource(
        lipRef.current ? () => lipRef.current?.sample() ?? null : testSpeech ? () => fakeTalk(t0) : null,
      )
      return
    }
    if (previewSpeech) {
      face.setTarget(STATE_FORM.speaking)
      face.setExpression('neutral')
      const t0 = performance.now()
      face.setMouthSource(() => fakeTalk(t0))
      return
    }
    face.setTarget(STATE_FORM[status])
    if (status === 'thinking') face.setExpression('thinking')
    // Audio can still be playing after the server's buffer-stopped event.
    // Let the detector's audio clock carry the final lips and close on silence.
    face.setMouthSource(lipRef.current && !['idle', 'error', 'connecting'].includes(status) ? () => lipRef.current?.sample() ?? null : null)
  }, [status, cfg.configOpen, testSpeech, previewSpeech, voice.lipRef])

  // Flip between the two halls behind the VIKI scene
  const toggleBackdrop = () => {
    const next = backdrop === 'viki-hall-main' ? 'viki-hall' : 'viki-hall-main'
    setBackdrop(next)
    try {
      localStorage.setItem('viki.backdrop', next)
    } catch {
      /* ignore */
    }
    faceRef.current?.setBackdrop(next)
  }

  // The speech delay slider acts on the live output line
  useEffect(() => {
    voice.lipRef.current?.setDelay(cfg.draft.speechDelay)
  }, [cfg.draft.speechDelay, voice.lipRef])

  return (
    <div className={`hero${cfg.style === 'lattice' && cfg.draft.optical ? ' film-look' : ''}${cfg.configOpen ? ' configuring' : ''}${status === 'idle' && !PREVIEW && !previewSpeech ? ' dormant' : ''}`}>
      <canvas ref={canvasRef} />

      <div className={`hud${cfg.configOpen ? ' config-open' : ''}`}>
        <HudHeader
          title={STYLES.find((s) => s.id === cfg.style)?.title ?? 'V.I.K.I.'}
          subtitle={STYLES.find((s) => s.id === cfg.style)?.subtitle ?? ''}
          statusClass={status}
          statusLabel={PREVIEW || previewSpeech ? 'ANIMATION PREVIEW' : STATUS_LABEL[status]}
          configOpen={cfg.configOpen}
          onConfigure={cfg.openConfig}
          onBackdrop={cfg.style === 'viki' ? toggleBackdrop : undefined}
        />

        <RadialMenu style={cfg.style} onSelect={cfg.chooseStyle} onDocs={() => setDocsOpen(true)} />

        <Captions userText={voice.userText} assistantText={voice.assistantText} />

        <footer className="hud-bottom">
          {voice.error && <p className="error">{voice.error}</p>}
          <MicControl
            connected={voice.connected}
            busy={voice.busy}
            hidePreview={Boolean(PREVIEW)}
            previewSpeech={previewSpeech}
            orbRef={voice.orbRef}
            onToggle={
              voice.connected || voice.busy
                ? voice.disconnect
                : () => {
                    setPreviewSpeech(false)
                    void voice.connect()
                  }
            }
            onTogglePreview={() => setPreviewSpeech((v) => !v)}
          />
        </footer>

        {cfg.configOpen && (
          <ConfigPanel
            style={cfg.style}
            draft={cfg.draft}
            dirty={cfg.dirty}
            testSpeech={testSpeech}
            onChange={(patch) => cfg.setDraft((d) => ({ ...d, ...patch }))}
            onTestSpeech={setTestSpeech}
            onSave={cfg.saveDraft}
            onReset={cfg.resetConfig}
            onClose={() => {
              setTestSpeech(false)
              cfg.closeConfig()
            }}
          />
        )}
      </div>

      {docsOpen && <DocsPage onClose={() => setDocsOpen(false)} />}

    </div>
  )
}
