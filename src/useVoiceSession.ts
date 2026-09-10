import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import type { Expression, ParticleFace } from './viki/ParticleFace'
import { LipSync } from './viki/lipsync'
import { SpeechOutput } from './viki/SpeechOutput'
import { connectRealtime, type DuetConfig, type RealtimeSession, type VoiceStatus } from './viki/realtime'
import type { HeadStyle } from './viki/config'

const API_KEY = import.meta.env.VITE_OPENAI_API_KEY as string | undefined

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
 * Local development uses the .env key directly. The deployed site instead asks
 * our serverless endpoint for a short-lived client secret (ek_...), so the
 * real API key never reaches the browser.
 */
async function obtainKey(): Promise<string | null> {
  if (API_KEY) return API_KEY
  try {
    const res = await fetch('/api/token', { method: 'POST' })
    if (!res.ok) return null
    const data = (await res.json()) as { value?: string }
    return data.value ?? null
  } catch {
    return null
  }
}

/**
 * Owns the whole voice link: WebRTC session, audio context, speech output with
 * viseme detection, microphone level, connection epochs and teardown.
 * The face only receives expressions and (through `lipRef`) mouth poses.
 */
export function useVoiceSession(faceRef: RefObject<ParticleFace | null>, speechDelay: number, style: HeadStyle) {
  const sessionRef = useRef<RealtimeSession | null>(null)
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
      const key = await obtainKey()
      if (!key) throw new Error(OFFLINE_MESSAGE)
      if (epoch !== connectionEpoch.current) return
      const speech = await SpeechOutput.create(ctx, speechDelay, (message) => {
        if (epoch === connectionEpoch.current) setError(message)
      })
      if (epoch !== connectionEpoch.current) { speech.dispose(); return }
      lipRef.current = speech
      ;(window as unknown as { __vikiSpeech?: () => unknown }).__vikiSpeech = () => speech.debug()
      let latestStatus: VoiceStatus = 'connecting'
      const session = await connectRealtime(
        key,
        {
          onStatus: (s) => {
            latestStatus = s
            if (epoch === connectionEpoch.current) setStatus(s)
          },
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
      const greetTimer = window.setInterval(() => {
        if (epoch !== connectionEpoch.current) {
          window.clearInterval(greetTimer)
          return
        }
        if (!faceRef.current?.isFormed()) return
        window.clearInterval(greetTimer)
        // A waiting duet partner says nothing until the other head speaks.
        if (latestStatus === 'listening' && DUET?.role !== 'wait') session.greet()
      }, 250)
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
