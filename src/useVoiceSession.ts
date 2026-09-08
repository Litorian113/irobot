import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import type { Expression, ParticleFace } from './viki/ParticleFace'
import { LipSync } from './viki/lipsync'
import { SpeechOutput } from './viki/SpeechOutput'
import { connectRealtime, type RealtimeSession, type VoiceStatus } from './viki/realtime'

const API_KEY = import.meta.env.VITE_OPENAI_API_KEY as string | undefined

/**
 * Owns the whole voice link: WebRTC session, audio context, speech output with
 * viseme detection, microphone level, connection epochs and teardown.
 * The face only receives expressions and (through `lipRef`) mouth poses.
 */
export function useVoiceSession(faceRef: RefObject<ParticleFace | null>, speechDelay: number) {
  const sessionRef = useRef<RealtimeSession | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const lipRef = useRef<SpeechOutput | null>(null)
  const micLipRef = useRef<LipSync | null>(null)
  const connectionEpoch = useRef(0)
  const relaxTimer = useRef<number | undefined>(undefined)
  const orbRef = useRef<HTMLButtonElement>(null)

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
      const speech = await SpeechOutput.create(ctx, speechDelay, (message) => {
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
