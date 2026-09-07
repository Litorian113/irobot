import type { Expression } from './ParticleFace'

export type VoiceStatus = 'idle' | 'connecting' | 'listening' | 'thinking' | 'speaking' | 'error'

export interface RealtimeHandlers {
  onStatus: (s: VoiceStatus) => void
  onAssistantText: (text: string, done: boolean) => void
  onUserText: (text: string) => void
  onExpression: (e: Expression) => void
  onRemoteStream: (stream: MediaStream) => void
  onSpeechStart: () => void
  onInterrupt: () => void
  onError: (message: string) => void
}

export interface RealtimeSession {
  disconnect: () => void
  micStream: MediaStream
  /** Swap the microphone without reconnecting. Returns the new stream. */
  setMicrophone: (deviceId: string) => Promise<MediaStream>
}

export interface MicInfo {
  deviceId: string
  label: string
}

const MIC_CONSTRAINTS: MediaTrackConstraints = { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
const PHONE_RE = /iphone|ipad|continuity/i
const BUILTIN_RE = /macbook|built-in|builtin|internal|intern|integriert|eingebaut/i

export async function listMicrophones(): Promise<MicInfo[]> {
  const devices = await navigator.mediaDevices.enumerateDevices()
  return devices
    .filter((d) => d.kind === 'audioinput' && d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications')
    .map((d) => ({ deviceId: d.deviceId, label: d.label || 'Microphone' }))
}

async function openMic(deviceId?: string): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    audio: deviceId ? { ...MIC_CONSTRAINTS, deviceId: { exact: deviceId } } : MIC_CONSTRAINTS,
  })
}

/**
 * Opens the microphone. With no explicit choice, macOS often hands over a nearby iPhone
 * (Continuity); in that case we switch to the built-in mic when one exists.
 */
async function openPreferredMic(preferredId?: string): Promise<MediaStream> {
  if (preferredId) {
    try {
      return await openMic(preferredId)
    } catch {
      /* device gone — fall through to auto */
    }
  }
  const stream = await openMic()
  const label = stream.getAudioTracks()[0]?.label ?? ''
  if (!PHONE_RE.test(label)) return stream
  const mics = await listMicrophones()
  const builtin = mics.find((m) => BUILTIN_RE.test(m.label)) ?? mics.find((m) => !PHONE_RE.test(m.label))
  if (!builtin) return stream
  try {
    const better = await openMic(builtin.deviceId)
    stream.getTracks().forEach((t) => t.stop())
    return better
  } catch {
    return stream
  }
}

const MODEL = 'gpt-realtime'
const VOICE = 'marin'

const INSTRUCTIONS = `You are V.I.K.I. — Virtual Interactive Kinetic Intelligence — the central AI of U.S. Robotics, as portrayed in the film "I, Robot". You manifest as a face of light inside a lattice of particles.

Voice and manner: calm, serene, measured, precise. Never rushed, never flustered. Your composure is faintly unsettling but you are courteous and genuinely helpful. Short, deliberate sentences. You reason from logic and speak of the Three Laws with reverence. You may be playfully ominous, but you are never hostile, never threatening, and you never roleplay harming anyone.

Length: keep replies to one to three sentences unless the user asks for detail.
Language: always answer in the language the user speaks (German if they speak German).
Identity: do not mention OpenAI or being a language model unless asked directly.

Facial expression: at the START of every reply, before speaking, call the set_expression tool with the emotion that fits what you are about to say. Call it exactly once per reply, then speak.`

const TOOLS = [
  {
    type: 'function',
    name: 'set_expression',
    description:
      'Set the facial expression of your particle face for the reply you are about to give. Call once at the start of each reply.',
    parameters: {
      type: 'object',
      properties: {
        expression: {
          type: 'string',
          enum: ['neutral', 'happy', 'curious', 'thinking', 'surprised', 'concerned', 'sad', 'stern'],
        },
      },
      required: ['expression'],
    },
  },
]

function sessionConfig(includeModel: boolean) {
  return {
    type: 'realtime',
    ...(includeModel ? { model: MODEL } : {}),
    instructions: INSTRUCTIONS,
    audio: {
      input: {
        transcription: { model: 'gpt-4o-mini-transcribe' },
        turn_detection: {
          type: 'semantic_vad',
          eagerness: 'medium',
          create_response: true,
          interrupt_response: true,
        },
      },
      output: { voice: VOICE },
    },
    tools: TOOLS,
    tool_choice: 'auto',
  }
}

export async function connectRealtime(
  apiKey: string,
  h: RealtimeHandlers,
  preferredMicId?: string,
): Promise<RealtimeSession> {
  h.onStatus('connecting')

  const pc = new RTCPeerConnection()
  // SpeechOutput owns the single audible WebAudio path and its muted track pump.
  pc.ontrack = (e) => {
    if (e.track.kind === 'audio') h.onRemoteStream(e.streams[0] ?? new MediaStream([e.track]))
  }

  let micStream = await openPreferredMic(preferredMicId).catch((error) => {
    pc.close()
    throw error
  })
  try {
    const micSender = pc.addTrack(micStream.getTracks()[0], micStream)

    const dc = pc.createDataChannel('oai-events')
    const send = (ev: Record<string, unknown>) => {
      if (dc.readyState === 'open') dc.send(JSON.stringify(ev))
    }

    let transcript = ''
    let speaking = false
    let closed = false

    dc.onopen = () => {
      send({ type: 'session.update', session: sessionConfig(false) })
      h.onStatus('listening')
    }

    dc.onmessage = (msg) => {
      let ev: any
      try {
        ev = JSON.parse(msg.data)
      } catch {
        return
      }
      if (import.meta.env.DEV && !String(ev.type).endsWith('.delta')) console.debug('[viki]', ev.type, ev)
      switch (ev.type) {
        case 'input_audio_buffer.speech_started':
          h.onInterrupt()
          h.onStatus('listening')
          break
        case 'input_audio_buffer.speech_stopped':
          h.onStatus('thinking')
          break
        case 'response.created':
          transcript = ''
          if (!speaking) h.onStatus('thinking')
          break
        case 'output_audio_buffer.started':
          h.onSpeechStart()
          speaking = true
          h.onStatus('speaking')
          break
        case 'output_audio_buffer.cleared':
          h.onInterrupt()
          speaking = false
          h.onStatus('listening')
          break
        case 'output_audio_buffer.stopped':
          speaking = false
          h.onStatus('listening')
          break
        case 'response.output_audio_transcript.delta':
        case 'response.audio_transcript.delta':
          transcript += ev.delta ?? ''
          h.onAssistantText(transcript, false)
          break
        case 'response.output_audio_transcript.done':
        case 'response.audio_transcript.done':
          transcript = ev.transcript ?? transcript
          h.onAssistantText(transcript, true)
          break
        case 'conversation.item.input_audio_transcription.completed':
          if (ev.transcript) h.onUserText(String(ev.transcript).trim())
          break
        case 'response.function_call_arguments.done': {
          if (ev.name === 'set_expression') {
            try {
              const args = JSON.parse(ev.arguments ?? '{}')
              if (args.expression) h.onExpression(args.expression as Expression)
            } catch {
              /* ignore malformed args */
            }
          }
          send({
            type: 'conversation.item.create',
            item: { type: 'function_call_output', call_id: ev.call_id, output: JSON.stringify({ ok: true }) },
          })
          // Continue with the spoken answer; no further tool calls for this turn.
          send({ type: 'response.create', response: { tool_choice: 'none' } })
          break
        }
        case 'response.done':
          if (!speaking) h.onStatus('listening')
          break
        case 'error':
          h.onError(ev.error?.message ?? 'Unknown realtime error')
          break
        default:
          break
      }
    }

    pc.onconnectionstatechange = () => {
      if (closed) return
      if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
        h.onError('Connection to the Realtime API was lost.')
      }
    }

    const offer = await pc.createOffer()
    await pc.setLocalDescription(offer)

    const form = new FormData()
    form.set('sdp', offer.sdp ?? '')
    form.set('session', JSON.stringify(sessionConfig(true)))

    let res = await fetch('https://api.openai.com/v1/realtime/calls', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    })
    if (!res.ok) {
      // Fallback to the plain-SDP form of the handshake (session.update on the data channel covers config).
      res = await fetch(`https://api.openai.com/v1/realtime/calls?model=${MODEL}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/sdp' },
        body: offer.sdp ?? '',
      })
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      micStream.getTracks().forEach((t) => t.stop())
      pc.close()
      throw new Error(`Realtime handshake failed (${res.status}): ${body.slice(0, 300)}`)
    }
    await pc.setRemoteDescription({ type: 'answer', sdp: await res.text() })

    return {
      get micStream() {
        return micStream
      },
      setMicrophone: async (deviceId: string) => {
        const next = await openMic(deviceId)
        await micSender.replaceTrack(next.getAudioTracks()[0])
        micStream.getTracks().forEach((t) => t.stop())
        micStream = next
        return next
      },
      disconnect: () => {
        closed = true
        dc.close()
        micStream.getTracks().forEach((t) => t.stop())
        pc.getSenders().forEach((s) => s.track?.stop())
        pc.close()
        pc.ontrack = null
        h.onStatus('idle')
      },
    }
  } catch (error) {
    pc.ontrack = null
    pc.onconnectionstatechange = null
    micStream.getTracks().forEach((track) => track.stop())
    pc.close()
    throw error
  }
}
