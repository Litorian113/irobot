import { useCallback, useEffect, useRef, useState } from 'react'
import ConfigPanel from './ConfigPanel'
import { EXPRESSIONS, ParticleFace, type Expression } from './viki/ParticleFace'
import {
  clearConfig,
  loadConfig,
  loadStyle,
  saveConfig,
  saveStyle,
  STYLE_DEFAULTS,
  STYLES,
  type HeadConfig,
  type HeadStyle,
} from './viki/config'
import { LipSync } from './viki/lipsync'
import { SpeechOutput } from './viki/SpeechOutput'
import { fixedViseme, VISEMES } from './viki/visemes'
import { connectRealtime, type RealtimeSession, type VoiceStatus } from './viki/realtime'

const API_KEY = import.meta.env.VITE_OPENAI_API_KEY as string | undefined

/** Dev aid: `?preview=happy` forms the face with that expression and fakes speech (no API calls). */
const PREVIEW = new URLSearchParams(window.location.search).get('preview') as Expression | null
/** Dev aid: `?facepass=1` shows the raw head textures (depth/light) the lattice samples. */
const DEBUG_FACE = new URLSearchParams(window.location.search).has('facepass')
/** Dev aid: `?style=viki` (or lattice / dust) opens that tab. */
const STYLE_PARAM = new URLSearchParams(window.location.search).get('style') as HeadStyle | null

function initialStyle(): HeadStyle {
  return STYLE_PARAM && STYLES.some((s) => s.id === STYLE_PARAM) ? STYLE_PARAM : loadStyle()
}

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

/** Fake speech pattern for previews / the configurator's test mode. */
function fakeTalk(t0: number) {
  const t = (performance.now() - t0) / 1000
  const phrase = t % 5.6 < 4.3 ? 1 : 0
  const talk = Math.max(0, 0.18 + Math.sin(t * 8.4) * 0.35 + Math.sin(t * 13.1) * 0.2)
  const sequence = [5, 0, 11, 2, 9, 1, 12, 3, 5, 4, 6, 1, 8, 0]
  const step = t * 5
  const index = Math.floor(step) % sequence.length
  const mix = Math.min(1, (step % 1) * 4)
  const visemes = VISEMES.map((_, i) => phrase * ((sequence[index] === i ? mix : 0) + (sequence[(index + sequence.length - 1) % sequence.length] === i ? 1 - mix : 0)))
  return { open: talk * phrase, wide: 0.5 + 0.35 * Math.sin(t * 2.1), visemes }
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const faceRef = useRef<ParticleFace | null>(null)
  const sessionRef = useRef<RealtimeSession | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const lipRef = useRef<SpeechOutput | null>(null)
  const connectionEpoch = useRef(0)
  const micLipRef = useRef<LipSync | null>(null)
  const relaxTimer = useRef<number | undefined>(undefined)
  const orbRef = useRef<HTMLButtonElement>(null)

  const [status, setStatus] = useState<VoiceStatus>('idle')
  const [assistantText, setAssistantText] = useState('')
  const [userText, setUserText] = useState('')
  const [error, setError] = useState<string | null>(null)

  // head style tabs + per-style configurator
  const [style, setStyle] = useState<HeadStyle>(initialStyle)
  const [config, setConfig] = useState<HeadConfig>(() => loadConfig(initialStyle()))
  const [draft, setDraft] = useState<HeadConfig>(config)
  const [configOpen, setConfigOpen] = useState(false)
  const [testSpeech, setTestSpeech] = useState(false)
  const [previewSpeech, setPreviewSpeech] = useState(false)
  const dirty = JSON.stringify(draft) !== JSON.stringify(config)

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
    if (PREVIEW) {
      face.setTarget(STATE_FORM.speaking)
      face.setExpression(PREVIEW in EXPRESSIONS ? PREVIEW : 'neutral')
      const t0 = performance.now()
      const mouthParam = new URLSearchParams(window.location.search).get('mouth')
      const fixedMouth = mouthParam === null ? NaN : Number(mouthParam)
      const params = new URLSearchParams(window.location.search)
      const visemes = fixedViseme(params.get('viseme') ?? '')
      const fixed = (key: string, fallback: number) => {
        const value = params.get(key)
        return value !== null && Number.isFinite(Number(value)) ? Math.max(0, Math.min(1, Number(value))) : fallback
      }
      face.setMouthSource(() => (visemes ? { open: 0, wide: 0, visemes } : Number.isFinite(fixedMouth)
        ? { open: fixed('mouth', 0), wide: fixed('wide', 0.4), round: fixed('round', fixed('mouth', 0) * (1 - fixed('wide', 0.4))) }
        : fakeTalk(t0)))
    }
    return () => {
      face.dispose()
      faceRef.current = null
    }
  }, [])

  // Map voice status → formation of the lattice + mouth source.
  // While the configurator is open the face is forced into its active look.
  useEffect(() => {
    const face = faceRef.current
    if (!face || PREVIEW) return
    face.setActive(configOpen || previewSpeech || (status !== 'idle' && status !== 'error'))
    if (configOpen) {
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
  }, [status, configOpen, testSpeech, previewSpeech])

  // Live preview of the draft
  useEffect(() => {
    faceRef.current?.applyConfig(draft)
    lipRef.current?.setDelay(draft.speechDelay)
  }, [draft])

  // Switch tabs: load that head's saved config and make it the current one
  const chooseStyle = useCallback((next: HeadStyle) => {
    const cfg = loadConfig(next)
    setStyle(next)
    setConfig(cfg)
    setDraft(cfg)
    saveStyle(next)
    faceRef.current?.setStyle(next)
    faceRef.current?.applyConfig(cfg)
  }, [])

  const openConfig = useCallback(() => {
    setDraft(config)
    setConfigOpen(true)
  }, [config])

  const closeConfig = useCallback(() => {
    setDraft(config) // discard unsaved changes
    setTestSpeech(false)
    setConfigOpen(false)
  }, [config])

  const saveDraft = useCallback(() => {
    setConfig(draft)
    saveConfig(style, draft)
  }, [draft, style])

  const resetConfig = useCallback(() => {
    clearConfig(style)
    const cfg = { ...STYLE_DEFAULTS[style] }
    setConfig(cfg)
    setDraft(cfg)
    faceRef.current?.resetView()
  }, [style])

  // Mic level drives the orb's glow (writes to the DOM directly: no React re-render per frame)
  useEffect(() => {
    const orb = orbRef.current
    if (status === 'idle' || status === 'error') {
      orb?.style.setProperty('--level', '0')
      return
    }
    const id = window.setInterval(() => {
      orb?.style.setProperty('--level', (micLipRef.current?.level() ?? 0).toFixed(3))
    }, 66)
    return () => window.clearInterval(id)
  }, [status])

  const disconnect = useCallback(() => {
    connectionEpoch.current++
    window.clearTimeout(relaxTimer.current)
    sessionRef.current?.disconnect()
    sessionRef.current = null
    lipRef.current?.dispose()
    lipRef.current = null
    micLipRef.current?.dispose()
    micLipRef.current = null
    audioCtxRef.current?.close().catch(() => {})
    audioCtxRef.current = null
    setStatus('idle')
  }, [])

  const connect = useCallback(async () => {
    disconnect()
    setPreviewSpeech(false)
    if (!API_KEY) {
      setError('VITE_OPENAI_API_KEY is not set in .env')
      setStatus('error')
      return
    }
    setError(null)
    setStatus('connecting')
    setAssistantText('')
    setUserText('')
    const ctx = new AudioContext()
    const epoch = ++connectionEpoch.current
    audioCtxRef.current = ctx

    try {
      await ctx.resume()
      const speech = await SpeechOutput.create(ctx, draft.speechDelay, (message) => {
        if (epoch === connectionEpoch.current) setError(message)
      })
      if (epoch !== connectionEpoch.current) { speech.dispose(); return }
      lipRef.current = speech
      ;(window as unknown as { __vikiSpeech?: () => unknown }).__vikiSpeech = () => speech.debug()
      const session = await connectRealtime(
        API_KEY,
        {
          onStatus: (s) => { if (epoch === connectionEpoch.current) setStatus(s) },
          onAssistantText: (text) => { if (epoch === connectionEpoch.current) setAssistantText(text) },
          onUserText: (text) => { if (epoch === connectionEpoch.current) setUserText(text) },
          onExpression: (e: Expression) => {
            if (epoch !== connectionEpoch.current) return
            faceRef.current?.setExpression(e)
            window.clearTimeout(relaxTimer.current)
            relaxTimer.current = window.setTimeout(() => faceRef.current?.setExpression('neutral'), 9000)
          },
          onRemoteStream: (stream) => {
            if (epoch === connectionEpoch.current) speech.attachStream(stream)
          },
          onSpeechStart: () => speech.resume(),
          onInterrupt: () => speech.interrupt(),
          onError: (msg) => {
            if (epoch !== connectionEpoch.current) return
            disconnect()
            setError(msg)
            setStatus('error')
          },
        },
      )
      if (epoch !== connectionEpoch.current) { session.disconnect(); speech.dispose(); return }
      sessionRef.current = session
      micLipRef.current = new LipSync(ctx, session.micStream)
    } catch (e) {
      if (epoch !== connectionEpoch.current) return
      lipRef.current?.dispose()
      lipRef.current = null
      setError(e instanceof Error ? e.message : String(e))
      setStatus('error')
      await ctx.close().catch(() => {})
      audioCtxRef.current = null
    }
  }, [draft.speechDelay, disconnect])

  useEffect(() => () => disconnect(), [disconnect])

  const connected = status !== 'idle' && status !== 'error' && status !== 'connecting'
  const busy = status === 'connecting'

  return (
    <div className={`hero${style === 'lattice' && draft.optical ? ' film-look' : ''}${configOpen ? ' configuring' : ''}${status === 'idle' && !PREVIEW && !previewSpeech ? ' dormant' : ''}`}>
      <canvas ref={canvasRef} />

      <div className={`hud${configOpen ? ' config-open' : ''}`}>
        <header className="hud-top">
          <div className="brand">
            <span className="brand-name">V.I.K.I.</span>
            <span className="brand-sub">Virtual Interactive Kinetic Intelligence</span>
          </div>
          <div className="actions">
            <div className={`status status-${status}`}>
              <span className="dot" />
              {PREVIEW || previewSpeech ? 'ANIMATION PREVIEW' : STATUS_LABEL[status]}
            </div>
            {!configOpen && (
              <button type="button" className="btn ghost small" onClick={openConfig}>
                Configure
              </button>
            )}
          </div>
        </header>

        <nav className="tabs" aria-label="Head style">
          {STYLES.map((s, i) => (
            <button
              key={s.id}
              type="button"
              className={`tab${s.id === style ? ' active' : ''}`}
              onClick={() => chooseStyle(s.id)}
              title={s.hint}
            >
              <span className="tab-index">{String(i + 1).padStart(2, '0')}</span>
              {s.label}
            </button>
          ))}
        </nav>

        <div className="captions" aria-live="polite">
          {userText && <p className="caption user">{userText}</p>}
          {assistantText && <p className="caption viki">{assistantText}</p>}
        </div>

        <footer className="hud-bottom">
          {error && <p className="error">{error}</p>}
          <div className="controls">
            {!PREVIEW && (
              <button
                type="button"
                ref={orbRef}
                className={`mic-orb${connected ? ' live' : ''}${busy ? ' busy' : ''}`}
                onClick={connected || busy ? disconnect : connect}
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
            {!connected && !busy && !PREVIEW && (
              <button type="button" className="btn ghost small preview-toggle" aria-pressed={previewSpeech} onClick={() => setPreviewSpeech((v) => !v)}>
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
        </footer>

        {configOpen && (
          <ConfigPanel
            style={style}
            draft={draft}
            dirty={dirty}
            testSpeech={testSpeech}
            onChange={(patch) => setDraft((d) => ({ ...d, ...patch }))}
            onTestSpeech={setTestSpeech}
            onSave={saveDraft}
            onReset={resetConfig}
            onClose={closeConfig}
          />
        )}
      </div>

      <div className="corner tl" />
      <div className="corner tr" />
      <div className="corner bl" />
      <div className="corner br" />
    </div>
  )
}
