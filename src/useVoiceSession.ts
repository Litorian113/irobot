import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import type { Expression, ParticleFace } from './viki/ParticleFace'
import { LipSync } from './viki/lipsync'
import { SpeechOutput } from './viki/SpeechOutput'
import { connectVoiceAgent, type DuetConfig, type VoiceAgentSession, type VoiceStatus } from './viki/voiceAgent'
import type { HeadStyle } from './viki/config'

const OFFLINE_MESSAGE = 'The voice AI is offline right now — no key is connected. Live today from 22:00 to tomorrow 22:00 CEST.'

// Two devices (or two tabs), two heads, one room: ?duet=start opens the
// conversation, ?duet=wait connects silently and only answers what it hears.
// Optional: &topic=skynet (staged villain comedy) and &partner=viki|dust|max
// so each head knows who it is talking to.
const DUET: DuetConfig | undefined = (() => {
  const params = new URLSearchParams(window.location.search)
  const role = params.get('duet')
  if (role !== 'start' && role !== 'wait') return undefined
  const p = params.get('partner')
  const partner = p === 'viki' || p === 'dust' ? p : p === 'lattice' || p === 'max' ? 'lattice' : undefined
  return { role, topic: params.get('topic') ?? undefined, partner }
})()

/**
 * The browser never holds the AssemblyAI key. /api/token (the Vite dev
 * middleware locally, a Vercel function in production) mints a single-use
 * Voice Agent token that only opens this one WebSocket session.
 */
async function obtainToken(): Promise<string | null> {
  try {
    const res = await fetch('/api/token', { method: 'POST' })
    if (!res.ok) return null
    const data = (await res.json()) as { token?: string }
    return data.token ?? null
  } catch {
    return null
  }
}

/**
 * Owns the whole voice link: Voice Agent WebSocket, audio context, speech output with
 * viseme detection, microphone level, connection epochs and teardown.
 * The face only receives expressions and (through `lipRef`) mouth poses.
 */
export function useVoiceSession(faceRef: RefObject<ParticleFace | null>, speechDelay: number, style: HeadStyle) {
  const sessionRef = useRef<VoiceAgentSession | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const lipRef = useRef<SpeechOutput | null>(null)
  const micLipRef = useRef<LipSync | null>(null)
  const connectionEpoch = useRef(0)
  const relaxTimer = useRef<number | undefined>(undefined)
  const orbRef = useRef<HTMLButtonElement>(null)
  const styleRef = useRef(style)
  useEffect(() => {
    styleRef.current = style
  }, [style])

  const [status, setStatus] = useState<VoiceStatus>('idle')
  const [assistantText, setAssistantText] = useState('')
  const [userText, setUserText] = useState('')
  const [error, setError] = useState<string | null>(null)

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
    setError(null)
    setStatus('connecting')
    setAssistantText('')
    setUserText('')
    const ctx = new AudioContext()
    const epoch = ++connectionEpoch.current
    audioCtxRef.current = ctx

    try {
      await ctx.resume()
      const token = await obtainToken()
      if (!token) throw new Error(OFFLINE_MESSAGE)
      if (epoch !== connectionEpoch.current) return
      const speech = await SpeechOutput.create(ctx, speechDelay, (message) => {
        if (epoch === connectionEpoch.current) setError(message)
      })
      if (epoch !== connectionEpoch.current) { speech.dispose(); return }
      lipRef.current = speech
      ;(window as unknown as { __vikiSpeech?: () => unknown }).__vikiSpeech = () => speech.debug()
      let latestStatus: VoiceStatus = 'connecting'
      const showExpression = (e: Expression) => {
        if (epoch !== connectionEpoch.current) return
        faceRef.current?.setExpression(e)
        window.clearTimeout(relaxTimer.current)
        relaxTimer.current = window.setTimeout(() => faceRef.current?.setExpression('neutral'), 9000)
      }
      const session = await connectVoiceAgent(
        ctx,
        token,
        {
          onStatus: (s) => {
            latestStatus = s
            if (epoch === connectionEpoch.current) setStatus(s)
          },
          onAssistantText: (text) => { if (epoch === connectionEpoch.current) setAssistantText(text) },
          onUserText: (text) => { if (epoch === connectionEpoch.current) setUserText(text) },
          onExpression: showExpression,
          onOutput: (node) => {
            if (epoch === connectionEpoch.current) speech.attachNode(node)
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
        styleRef.current,
        undefined,
        DUET,
      )
      if (epoch !== connectionEpoch.current) { session.disconnect(); speech.dispose(); return }
      sessionRef.current = session
      micLipRef.current = new LipSync(ctx, session.micStream)
      if (DUET) {
        // Echo cancellation is off in duet mode, so the mic must close while
        // our own head is audibly speaking - otherwise it hears itself. A short
        // hangover covers the gap between viseme frames and the audio tail.
        ;(window as unknown as { __vikiMicOpen?: () => boolean }).__vikiMicOpen = () =>
          session.micStream.getAudioTracks()[0]?.enabled ?? false
        let lastAudible = 0
        const gate = window.setInterval(() => {
          if (epoch !== connectionEpoch.current) {
            window.clearInterval(gate)
            return
          }
          const s = speech.sample()
          const audible = s.open > 0.03 || (s.visemes?.some((w) => w > 0.05) ?? false)
          if (audible) lastAudible = performance.now()
          const track = session.micStream.getAudioTracks()[0]
          if (track) track.enabled = performance.now() - lastAudible > 400
        }, 80)
      }
      // The film moment: once she has fully materialized and nothing else is
      // happening yet, she opens the conversation herself - then waits.
      // A waiting duet partner says nothing until the other head speaks.
      if (DUET?.role !== 'wait') {
        let formedAt = 0
        const greetTimer = window.setInterval(() => {
          if (epoch !== connectionEpoch.current) {
            window.clearInterval(greetTimer)
            return
          }
          // Without WebGL there is no formation animation to wait for.
          if (faceRef.current && !faceRef.current.isFormed()) return
          if (!formedAt) formedAt = performance.now()
          // Fire once she is formed and idle. Keep retrying instead of giving
          // up: a stray sound can make the turn detector answer first, and the
          // opener - which launches the whole duet scene - must still land. A
          // safety timeout forces it if the line never falls quiet.
          const quiet = latestStatus === 'listening'
          const forced = performance.now() - formedAt > 6000
          if (quiet || forced) {
            window.clearInterval(greetTimer)
            session.greet()
          }
        }, 250)
      }
    } catch (e) {
      if (epoch !== connectionEpoch.current) return
      lipRef.current?.dispose()
      lipRef.current = null
      setError(e instanceof Error ? e.message : String(e))
      setStatus('error')
      await ctx.close().catch(() => {})
      audioCtxRef.current = null
    }
  }, [speechDelay, disconnect, faceRef])

  useEffect(() => () => disconnect(), [disconnect])
  useEffect(() => {
    // Closing the tab must still send session.end, or the agent lingers in a
    // billable 30 s resume window. pagehide fires on mobile Safari too.
    const onHide = () => sessionRef.current?.disconnect()
    window.addEventListener('pagehide', onHide)
    return () => window.removeEventListener('pagehide', onHide)
  }, [])

  return {
    status,
    error,
    assistantText,
    userText,
    connected: status !== 'idle' && status !== 'error' && status !== 'connecting',
    busy: status === 'connecting',
    connect,
    disconnect,
    orbRef,
    lipRef,
  }
}
