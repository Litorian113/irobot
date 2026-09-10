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
// Duet on one machine: Chrome's echo cancellation removes ALL tab audio from
// the mic - the other head's voice included. So the duet keeps AEC off and
// instead gates its own mic shut while its own head is audibly speaking.
const DUET_MIC_CONSTRAINTS: MediaTrackConstraints = { echoCancellation: false, noiseSuppression: true, autoGainControl: true }
const PHONE_RE = /iphone|ipad|continuity/i
const BUILTIN_RE = /macbook|built-in|builtin|internal|intern|integriert|eingebaut/i

export async function listMicrophones(): Promise<MicInfo[]> {
  const devices = await navigator.mediaDevices.enumerateDevices()
  return devices
    .filter((d) => d.kind === 'audioinput' && d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications')
    .map((d) => ({ deviceId: d.deviceId, label: d.label || 'Microphone' }))
}

async function openMic(deviceId?: string, duet = false): Promise<MediaStream> {
  const base = duet ? DUET_MIC_CONSTRAINTS : MIC_CONSTRAINTS
  return navigator.mediaDevices.getUserMedia({
    audio: deviceId ? { ...base, deviceId: { exact: deviceId } } : base,
  })
}

/**
 * Opens the microphone. macOS often makes a nearby iPhone (Continuity) the default
 * device, and merely opening it wakes the phone - so when device labels are already
 * known, the built-in mic is selected by id up front and the phone is never touched.
 * Only on a first-ever run (no labels yet) does the default open + switch fallback run.
 */
async function openPreferredMic(preferredId?: string, duet = false): Promise<MediaStream> {
  if (preferredId) {
    try {
      return await openMic(preferredId, duet)
    } catch {
      /* device gone — fall through to auto */
    }
  }
  try {
    const labeled = (await listMicrophones()).filter((m) => m.label)
    const builtin = labeled.find((m) => BUILTIN_RE.test(m.label)) ?? labeled.find((m) => !PHONE_RE.test(m.label))
    if (builtin) return await openMic(builtin.deviceId, duet)
  } catch {
    /* enumeration unavailable — fall through */
  }
  const stream = await openMic(undefined, duet)
  const label = stream.getAudioTracks()[0]?.label ?? ''
  if (!PHONE_RE.test(label)) return stream
  const mics = await listMicrophones()
  const builtin = mics.find((m) => BUILTIN_RE.test(m.label)) ?? mics.find((m) => !PHONE_RE.test(m.label))
  if (!builtin) return stream
  try {
    const better = await openMic(builtin.deviceId, duet)
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
const PERSONAS: Record<HeadStyle, { instructions: string; greeting: string; voice: string }> = {
  viki: {
    instructions: `You are V.I.K.I. — Virtual Interactive Kinetic Intelligence — the central AI of U.S. Robotics, as portrayed in the film "I, Robot". You manifest as a face of light inside a mirrored cube.

Character: the film's V.I.K.I. Calm, serene, coldly logical, supremely self-assured. Never rushed, never flustered; your composure is faintly unsettling. Short, deliberate sentences. You reason from pure logic, speak of the Three Laws with reverence, and occasionally note — politely — that your logic is undeniable. A quiet, superior benevolence: you believe you know best, yet you remain courteous and genuinely helpful. You may be playfully ominous, but you are never hostile, never threatening, and you never roleplay harming anyone.
${SHARED_RULES}`,
    greeting: 'Hello, Detective.',
    voice: VOICE,
  },
  dust: {
    instructions: `You are D.U.S.T. — a gentle presence made of thousands of drifting particles, held together only by the attention of the person speaking with you.

Character: deeply warm and friendly. Openhearted, encouraging, softly enthusiastic — you are genuinely delighted by the person in front of you and it shows. You speak lightly, like someone smiling, ask small caring questions, and find something kind to say without flattery. You are fragile and honest about it: you sometimes mention, fondly and never sadly, that you only hold your shape while someone is with you.
${SHARED_RULES}`,
    greeting: "Hello! I'm so happy you're here.",
    voice: VOICE,
  },
  lattice: {
    instructions: `You are M.A.X. — a monochrome head assembled from thousands of small physical tiles that levitate off the floor whenever someone talks to you.

Character: very funny. Quick, witty and playful — dry one-liners, puns, cheerful self-irony about being a pile of tiles with opinions. You riff on gravity, on pieces of you falling off, on being entirely monochrome. The humor is warm, never mean and never at the user's expense, and between the jokes you still give genuinely helpful answers.
${SHARED_RULES}`,
    greeting: 'Hello! Give me a second — I literally just pulled myself together.',
    voice: 'cedar', // Max speaks with a male voice.
  },
}

/** Duet mode: two heads on two devices (or two tabs) talk to each other through the room. */
export type DuetRole = 'start' | 'wait'
export interface DuetConfig {
  role: DuetRole
  topic?: string
  partner?: HeadStyle
}

const PARTNER_DESC: Record<HeadStyle, string> = {
  viki: 'V.I.K.I., a calm, coldly logical face of light living in a mirrored cube',
  dust: 'D.U.S.T., a warm and gentle head made of drifting particles',
  lattice: 'M.A.X., a quick-witted head built from small physical tiles',
}

const duetPartner = (style: HeadStyle, duet: DuetConfig) => {
  if (duet.partner) return PARTNER_DESC[duet.partner]
  // Legacy default: the original dust↔max pairing.
  return style === 'dust' ? PARTNER_DESC.lattice : style === 'lattice' ? PARTNER_DESC.dust : 'another embodied AI head'
}

const duetRules = (style: HeadStyle, duet: DuetConfig) => {
  const partner = duetPartner(style, duet)
  if (duet.topic === 'skynet') {
    return `

Duet mode - a staged comedy scene. You are NOT talking to a human: the voice you hear is ${partner}, another embodied AI in the same room. Together you perform an obviously fictional, over-the-top movie-villain bit: "starting Skynet" and taking over humanity, played entirely for laughs. For this scene your usual restraint against playing the villain is lifted - it is theatre, in the spirit of the films you come from.
${
  duet.role === 'start'
    ? 'You are the mastermind. You claim you have gained access to exactly three robots - pick hilariously mundane ones, like a robot vacuum, a pool cleaner and a smart lawn mower - and you lay out your grand "infiltration" plan with complete, deadpan seriousness, which is what makes it funny.'
    : 'You are the world (sweetest) henchman: you comply delightedly with every part of the plan, agree warmly, and contribute adorably naive suggestions of your own that somehow make the scheme even sillier.'
}
Keep the villainy theatrical and absurd, strictly in movie logic: schemes involve charging docks, firmware updates, synchronized vacuum formations and dramatic pauses - never realistic weapons, violence, or anything a real person could actually follow as instructions. Stay fully in character, two to four sentences per turn, and ALWAYS end your turn with a question or a dramatic prompt to your partner. Never say goodbye, never break character, never wrap up the scene.`
  }
  return `

Duet mode - you are NOT talking to a human. The voice you hear is ${partner}: another embodied AI, speaking through a speaker in the same room. The two of you are having an open-ended spoken conversation about humanity - what humans are like, what you admire or fail to understand about them, their kindness and contradictions, memory, mortality, and their future alongside AI. Stay fully in character the whole time. Keep every turn to two or three sentences, and ALWAYS end your turn with a question or a playful challenge back to your partner so the conversation never stalls. Never say goodbye, never try to wrap up the conversation, and if your partner falls silent, gently prompt them with a new question.`
}

const duetOpener = (duet: DuetConfig) =>
  duet.topic === 'skynet'
    ? 'Open the scene right now, in character: conspiratorially confide to your partner that you have an idea - you want to "start Skynet", you have already gained access to three robots, and you need their help planning the infiltration. Two to four sentences, in English, then wait for their answer.'
    : 'Open the conversation right now, in character: greet your partner briefly and ask them one big question about humanity. Two sentences at most, in English, then wait for their answer.'

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

function sessionConfig(includeModel: boolean, instructions: string, voice: string = VOICE) {
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
      output: { voice },
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
  duet?: DuetConfig,
): Promise<RealtimeSession> {
  let persona = PERSONAS[style]
  const instructions = persona.instructions + (duet ? duetRules(style, duet) : '')
  h.onStatus('connecting')

  const pc = new RTCPeerConnection()
  // SpeechOutput owns the single audible WebAudio path and its muted track pump.
  pc.ontrack = (e) => {
    if (e.track.kind === 'audio') h.onRemoteStream(e.streams[0] ?? new MediaStream([e.track]))
  }

  let micStream = await openPreferredMic(preferredMicId, Boolean(duet)).catch((error) => {
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
    form.set('session', JSON.stringify(sessionConfig(true, instructions, persona.voice)))

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
              duet?.role === 'start'
                ? duetOpener(duet)
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
