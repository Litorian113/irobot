import type { Expression } from './ParticleFace'

export type VoiceStatus = 'idle' | 'connecting' | 'listening' | 'thinking' | 'speaking' | 'error'

/** Everything the UI needs to hear from a running conversation. */
export interface AgentEventHandlers {
  onStatus: (s: VoiceStatus) => void
  onAssistantText: (text: string, done: boolean) => void
  onUserText: (text: string) => void
  /** The expression tag she put in front of her reply; arrives as the first word starts playing. */
  onExpression: (e: Expression) => void
  onSpeechStart: () => void
  onInterrupt: () => void
  onError: (message: string) => void
}

/** What the router needs from the transport and the audio side. Pure, so node tests can drive it. */
export interface AgentEventIO {
  send: (ev: Record<string, unknown>) => void
  /** Queue one base64 PCM chunk for playback. */
  play: (base64: string) => void
  /** Drop queued playback (barge-in). */
  flush: () => void
  /** Run `cb` once everything queued so far has been heard. */
  drained: (cb: () => void) => void
  /** Clean server-side teardown finished (`session.ended`). */
  onEnded?: () => void
  onReady?: (sessionId: string) => void
  log?: (type: string, ev: unknown) => void
}

// Client message errors keep the session alive; everything else ends it.
const RECOVERABLE_ERRORS = new Set([
  'invalid_format', 'invalid_audio', 'invalid_value', 'immutable_field', 'invalid_config', 'agent_id_not_first', 'audio_rate_violation',
])

export const EXPRESSIONS: readonly Expression[] = ['neutral', 'happy', 'curious', 'thinking', 'surprised', 'concerned', 'sad', 'stern']
// She opens every reply with e.g. "[[curious]]": the TTS renders it as a short
// pause, never as a word, but it reaches us through the transcript stream.
const TAG_RE = /\s*\[\[\s*([a-z]+)\s*\]\]\s*/gi
export const stripExpressionTags = (text: string) => text.replace(TAG_RE, ' ').replace(/\s+/g, ' ').trim()
export function readExpressionTag(text: string): Expression | null {
  for (const m of text.matchAll(TAG_RE)) {
    const tag = m[1].toLowerCase() as Expression
    if (EXPRESSIONS.includes(tag)) return tag
  }
  return null
}

const joinWord = (text: string, delta: string) => (text && !/^[\s,.;:!?'")\]]/.test(delta) ? `${text} ${delta}` : text + delta)

/**
 * Maps AssemblyAI Voice Agent events onto the head's status machine.
 * No tools are declared - a silent client tool is impossible here, since every
 * tool.result auto-fires another spoken reply - but should the agent ever call
 * one, it is answered at its reply.done so the conversation cannot stall.
 */
export function createAgentEventRouter(h: AgentEventHandlers, io: AgentEventIO) {
  let speaking = false
  let transcript = ''
  let lastEvent = ''
  let reply = 0
  let pending: { call_id: string; result: Record<string, unknown> }[] = []

  const flushTools = () => {
    if (lastEvent !== 'reply.done' || pending.length === 0) return
    for (const t of pending) io.send({ type: 'tool.result', call_id: t.call_id, result: JSON.stringify(t.result) })
    pending = []
    h.onStatus('thinking')
  }

  const startSpeaking = () => {
    if (speaking) return
    speaking = true
    reply++
    transcript = ''
    h.onSpeechStart()
    h.onStatus('speaking')
  }

  const stopSpeaking = (interrupted: boolean) => {
    if (!speaking) return
    speaking = false
    if (interrupted) {
      io.flush()
      h.onInterrupt()
      h.onStatus('listening')
      return
    }
    const id = reply
    io.drained(() => {
      // A newer reply may have started while the tail was still playing.
      if (id === reply && !speaking) h.onStatus('listening')
    })
  }

  return (ev: any) => {
    const type = String(ev?.type ?? '')
    io.log?.(type, ev)
    switch (type) {
      case 'session.ready':
        io.onReady?.(String(ev.session_id ?? ''))
        h.onStatus('listening')
        break
      case 'input.speech.started':
        lastEvent = type
        if (!speaking) h.onStatus('listening')
        break
      case 'input.speech.stopped':
        if (!speaking) h.onStatus('thinking')
        break
      case 'transcript.user':
        if (ev.text) h.onUserText(String(ev.text).trim())
        break
      case 'reply.started':
        lastEvent = type
        startSpeaking()
        break
      case 'reply.audio':
        startSpeaking()
        if (typeof ev.data === 'string' && ev.data) io.play(ev.data)
        break
      case 'transcript.agent.delta':
        if (typeof ev.delta === 'string') {
          const tag = readExpressionTag(ev.delta)
          if (tag) h.onExpression(tag)
          const word = stripExpressionTags(ev.delta)
          if (word) {
            transcript = joinWord(transcript, word)
            h.onAssistantText(transcript, false)
          }
        }
        break
      case 'transcript.agent':
        transcript = typeof ev.text === 'string' ? stripExpressionTags(ev.text) : transcript
        h.onAssistantText(transcript, true)
        break
      case 'tool.call':
        pending.push({ call_id: String(ev.call_id), result: { error: `No tool named ${String(ev.name)} exists. Answer without it.` } })
        flushTools()
        break
      case 'reply.done':
        lastEvent = type
        if (ev.status === 'interrupted') {
          pending = []
          stopSpeaking(true)
        } else {
          stopSpeaking(false)
          flushTools()
        }
        break
      case 'session.error': {
        const code = String(ev.code ?? '')
        if (RECOVERABLE_ERRORS.has(code)) console.warn('[viki] voice agent:', code, ev.message)
        else h.onError(String(ev.message ?? code ?? 'Voice agent error'))
        break
      }
      case 'session.ended':
        io.onEnded?.()
        break
      default:
        break
    }
  }
}
