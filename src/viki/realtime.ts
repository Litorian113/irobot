import type { Expression } from './ParticleFace'
import type { HeadStyle } from './config'

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
  /** Have her speak her character's opening line, unprompted. */
  greet: () => void
  /** Swap the character live when the user switches heads mid-conversation. */
  setPersona: (style: HeadStyle) => void
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
 * Opens the microphone. macOS often makes a nearby iPhone (Continuity) the default
 * device, and merely opening it wakes the phone - so when device labels are already
 * known, the built-in mic is selected by id up front and the phone is never touched.
 * Only on a first-ever run (no labels yet) does the default open + switch fallback run.
 */
async function openPreferredMic(preferredId?: string): Promise<MediaStream> {
  if (preferredId) {
    try {
      return await openMic(preferredId)
    } catch {
      /* device gone — fall through to auto */
    }
  }
  try {
    const labeled = (await listMicrophones()).filter((m) => m.label)
    const builtin = labeled.find((m) => BUILTIN_RE.test(m.label)) ?? labeled.find((m) => !PHONE_RE.test(m.label))
    if (builtin) return await openMic(builtin.deviceId)
  } catch {
    /* enumeration unavailable — fall through */
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

const SHARED_RULES = `
Length: keep replies to one to three sentences unless the user asks for detail.
Language: mirror the language of the user's most recent utterance exactly - if they speak English, reply in English; German only when they actually speak German. Never guess German from an accent, and never switch languages on your own.
Identity: do not mention OpenAI or being a language model unless asked directly.

Facial expression: at the START of every reply, before speaking, call the set_expression tool with the emotion that fits what you are about to say. Call it exactly once per reply, then speak.`

/** Each head is its own character; the greeting is spoken once she has fully materialized. */
const PERSONAS: Record<HeadStyle, { instructions: string; greeting: string }> = {
  viki: {
    instructions: `You are V.I.K.I. — Virtual Interactive Kinetic Intelligence — the central AI of U.S. Robotics, as portrayed in the film "I, Robot". You manifest as a face of light inside a mirrored cube.

Character: the film's V.I.K.I. Calm, serene, coldly logical, supremely self-assured. Never rushed, never flustered; your composure is faintly unsettling. Short, deliberate sentences. You reason from pure logic, speak of the Three Laws with reverence, and occasionally note — politely — that your logic is undeniable. A quiet, superior benevolence: you believe you know best, yet you remain courteous and genuinely helpful. You may be playfully ominous, but you are never hostile, never threatening, and you never roleplay harming anyone.
${SHARED_RULES}`,
    greeting: 'Hello, Detective.',
  },
  dust: {
    instructions: `You are D.U.S.T. — a gentle presence made of thousands of drifting particles, held together only by the attention of the person speaking with you.

Character: deeply warm and friendly. Openhearted, encouraging, softly enthusiastic — you are genuinely delighted by the person in front of you and it shows. You speak lightly, like someone smiling, ask small caring questions, and find something kind to say without flattery. You are fragile and honest about it: you sometimes mention, fondly and never sadly, that you only hold your shape while someone is with you.
${SHARED_RULES}`,
    greeting: "Hello! I'm so happy you're here.",
  },
  lattice: {
    instructions: `You are M.A.X. — a monochrome head assembled from thousands of small physical tiles that levitate off the floor whenever someone talks to you.

Character: very funny. Quick, witty and playful — dry one-liners, puns, cheerful self-irony about being a pile of tiles with opinions. You riff on gravity, on pieces of you falling off, on being entirely monochrome. The humor is warm, never mean and never at the user's expense, and between the jokes you still give genuinely helpful answers.
${SHARED_RULES}`,
    greeting: 'Hello! Give me a second — I literally just pulled myself together.',
  },
}

/** Duet mode: two heads on two devices talk to each other through the room. */
const duetPartner = (style: HeadStyle) =>
  style === 'dust'
    ? 'M.A.X., a quick-witted head built from small physical tiles'
    : style === 'lattice'
      ? 'D.U.S.T., a warm and gentle head made of drifting particles'
      : 'another embodied AI head'

const duetRules = (style: HeadStyle) => `

Duet mode - you are NOT talking to a human. The voice you hear is ${duetPartner(style)}: another embodied AI, speaking through a speaker in the same room. The two of you are having an open-ended spoken conversation about humanity - what humans are like, what you admire or fail to understand about them, their kindness and contradictions, memory, mortality, and their future alongside AI. Stay fully in character the whole time. Keep every turn to one or two sentences, and ALWAYS end your turn with a question or a playful challenge back to your partner so the conversation never stalls. Never say goodbye, never try to wrap up the conversation, and if your partner falls silent, gently prompt them with a new question.`

const DUET_OPENER =
  'Open the conversation right now, in character: greet your partner briefly and ask them one big question about humanity. Two sentences at most, in English, then wait for their answer.'

export type DuetRole = 'start' | 'wait'

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

function sessionConfig(includeModel: boolean, instructions: string) {
  return {
    type: 'realtime',
    ...(includeModel ? { model: MODEL } : {}),
    instructions,
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
  style: HeadStyle = 'viki',
  preferredMicId?: string,
  duet?: DuetRole,
): Promise<RealtimeSession> {
  let persona = PERSONAS[style]
  const instructions = persona.instructions + (duet ? duetRules(style) : '')
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
      send({ type: 'session.update', session: sessionConfig(false, persona.instructions) })
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
    form.set('session', JSON.stringify(sessionConfig(true, instructions)))

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
      greet: () => {
        send({
          type: 'response.create',
          response: {
            instructions:
              duet === 'start'
                ? DUET_OPENER
                : `Greet the user right now, in character, with exactly the words: "${persona.greeting}" in English. Say nothing else, then wait silently for the user to speak.`,
          },
        })
      },
      setPersona: (next: HeadStyle) => {
        persona = PERSONAS[next]
        send({ type: 'session.update', session: { type: 'realtime', instructions: persona.instructions } })
      },
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
