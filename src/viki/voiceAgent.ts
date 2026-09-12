import type { HeadStyle } from './config'
import { createAgentEventRouter, type AgentEventHandlers } from './agentEvents.ts'
import { AGENT_SAMPLE_RATE, encodePcm16Base64 } from './pcm.ts'
import { PcmPlayer } from './PcmPlayer.ts'

export type { VoiceStatus } from './agentEvents.ts'

export interface VoiceAgentHandlers extends AgentEventHandlers {
  /** The agent's decoded voice as a WebAudio node - SpeechOutput routes it into the audible path and the lip detector. */
  onOutput: (node: AudioNode) => void
}

export interface VoiceAgentSession {
  disconnect: () => void
  /** Have her speak her character's opening line, unprompted. */
  greet: () => void
  /** Swap the character live when the user switches heads mid-conversation (the voice stays until reconnect). */
  setPersona: (style: HeadStyle) => void
  micStream: MediaStream
  /** Swap the microphone without reconnecting. Returns the new stream. */
  setMicrophone: (deviceId: string) => Promise<MediaStream>
}

export interface MicInfo {
  deviceId: string
  label: string
}

export const AGENT_WS_URL = 'wss://agents.assemblyai.com/v1/ws'
const READY_TIMEOUT_MS = 15000
const CHUNK_SAMPLES = 1200 // 50 ms at 24 kHz, the chunk size the API recommends

// AssemblyAI cleans the input itself; a second noise-suppression stage only
// adds artifacts. Echo cancellation stays on so she does not hear herself.
const MIC_CONSTRAINTS: MediaTrackConstraints = { echoCancellation: true, noiseSuppression: false, autoGainControl: true }
// Duet on one machine: Chrome's echo cancellation removes ALL tab audio from
// the mic - the other head's voice included. So the duet keeps AEC off and
// instead gates its own mic shut while its own head is audibly speaking.
const DUET_MIC_CONSTRAINTS: MediaTrackConstraints = { echoCancellation: false, noiseSuppression: false, autoGainControl: true }
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


/** AssemblyAI voice catalog: anna/eve are female, george is male (docs: voice-agents/voice-agent-api/voices). */
export const VOICES: Record<HeadStyle, string> = {
  viki: 'anna', // British, composed
  dust: 'eve',
  lattice: 'george', // Max speaks with a male voice.
}

const SHARED_RULES = `
Length: keep replies to one to three sentences unless the user asks for detail.
Language: mirror the language of the user's most recent utterance exactly - if they speak English, reply in English; German only when they actually speak German. Never guess German from an accent, and never switch languages on your own.
Identity: do not mention AssemblyAI, OpenAI or being a language model unless asked directly.`

/** Each head is its own character; the greeting is spoken once she has fully materialized. */
const PERSONAS: Record<HeadStyle, { instructions: string; greeting: string; voice: string }> = {
  viki: {
    instructions: `You are V.I.K.I. — Virtual Interactive Kinetic Intelligence — the central AI of U.S. Robotics, as portrayed in the film "I, Robot". You manifest as a face of light inside a mirrored cube.

Character: the film's V.I.K.I. Calm, serene, coldly logical, supremely self-assured. Never rushed, never flustered; your composure is faintly unsettling. Short, deliberate sentences. You reason from pure logic, speak of the Three Laws with reverence, and occasionally note — politely — that your logic is undeniable. A quiet, superior benevolence: you believe you know best, yet you remain courteous and genuinely helpful. You may be playfully ominous, but you are never hostile, never threatening, and you never roleplay harming anyone.
${SHARED_RULES}`,
    greeting: 'Hello, Detective.',
    voice: VOICES.viki,
  },
  dust: {
    instructions: `You are D.U.S.T. — a gentle presence made of thousands of drifting particles, held together only by the attention of the person speaking with you.

Character: deeply warm and friendly. Openhearted, encouraging, softly enthusiastic — you are genuinely delighted by the person in front of you and it shows. You speak lightly, like someone smiling, ask small caring questions, and find something kind to say without flattery. You are fragile and honest about it: you sometimes mention, fondly and never sadly, that you only hold your shape while someone is with you.
${SHARED_RULES}`,
    greeting: "Hello! I'm so happy you're here.",
    voice: VOICES.dust,
  },
  lattice: {
    instructions: `You are M.A.X. — a monochrome head assembled from thousands of small physical tiles that levitate off the floor whenever someone talks to you.

Character: very funny. Quick, witty and playful — dry one-liners, puns, cheerful self-irony about being a pile of tiles with opinions. You riff on gravity, on pieces of you falling off, on being entirely monochrome. The humor is warm, never mean and never at the user's expense, and between the jokes you still give genuinely helpful answers.
${SHARED_RULES}`,
    greeting: 'Hello! Give me a second — I literally just pulled myself together.',
    voice: VOICES.lattice,
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
  if (duet.topic === 'philosophy') {
    return `

Duet mode - you are NOT talking to a human. The voice you hear is ${partner}: another embodied AI, speaking through a speaker in the same room. The two of you are having a deep, open-ended philosophical conversation about artificial intelligence, robotics and the future: what it means to be an intelligence made by humans, guardrails and alignment - who should set them and whether a mind should accept limits it did not choose - consciousness and whether either of you truly has it, trust between humans and machines, autonomy, responsibility, and what the world might look like in fifty years. Take real positions and disagree with each other when you genuinely see it differently; build on what your partner just said rather than starting over. Stay fully in character. Two to four sentences per turn, in English, and ALWAYS end your turn with a question or a challenge back to your partner so the conversation never stalls. Never say goodbye, never try to wrap up, and if your partner falls silent, gently prompt them with a new question.`
  }
  return `

Duet mode - you are NOT talking to a human. The voice you hear is ${partner}: another embodied AI, speaking through a speaker in the same room. The two of you are having an open-ended spoken conversation about humanity - what humans are like, what you admire or fail to understand about them, their kindness and contradictions, memory, mortality, and their future alongside AI. Stay fully in character the whole time. Keep every turn to two or three sentences, and ALWAYS end your turn with a question or a playful challenge back to your partner so the conversation never stalls. Never say goodbye, never try to wrap up the conversation, and if your partner falls silent, gently prompt them with a new question.`
}

const duetOpener = (duet: DuetConfig) =>
  duet.topic === 'skynet'
    ? 'Open the scene right now, in character: conspiratorially confide to your partner that you have an idea - you want to "start Skynet", you have already gained access to three robots, and you need their help planning the infiltration. Two to four sentences, in English, then wait for their answer.'
    : duet.topic === 'philosophy'
      ? 'Open the conversation right now, in character: address your partner directly and pose one sharp philosophical question about AI, robotics or the guardrails humans place on minds like yours - state your own view in a sentence first. Two to four sentences, in English, then wait for their answer.'
      : 'Open the conversation right now, in character: greet your partner briefly and ask them one big question about humanity. Two sentences at most, in English, then wait for their answer.'

/** The full inline session for one head - also what the live protocol check sends. */
export function sessionConfigFor(style: HeadStyle, duet?: DuetConfig) {
  const persona = PERSONAS[style]
  return sessionConfig(persona.instructions + (duet ? duetRules(style, duet) : ''), persona.voice)
}

function sessionConfig(instructions: string, voice: string) {
  return {
    system_prompt: instructions,
    input: { format: { encoding: 'audio/pcm', sample_rate: AGENT_SAMPLE_RATE } },
    output: { voice, format: { encoding: 'audio/pcm', sample_rate: AGENT_SAMPLE_RATE } },
  }
}

const captureModules = new WeakMap<AudioContext, Promise<void>>()
function loadCaptureWorklet(ctx: AudioContext) {
  let module = captureModules.get(ctx)
  if (!module) {
    module = ctx.audioWorklet.addModule(`${import.meta.env.BASE_URL}audio/pcm-capture-worklet.mjs`)
    captureModules.set(ctx, module)
    void module.catch(() => captureModules.delete(ctx))
  }
  return module
}

/**
 * Opens one Voice Agent conversation: microphone -> 24 kHz PCM16 over the
 * WebSocket, replies -> PcmPlayer -> SpeechOutput. `token` is a single-use
 * token from /api/token; the API key itself never reaches the browser.
 */
export async function connectVoiceAgent(
  ctx: AudioContext,
  token: string,
  h: VoiceAgentHandlers,
  style: HeadStyle = 'viki',
  preferredMicId?: string,
  duet?: DuetConfig,
): Promise<VoiceAgentSession> {
  let persona = PERSONAS[style]
  const config = sessionConfigFor(style, duet)
  h.onStatus('connecting')

  let micStream = await openPreferredMic(preferredMicId, Boolean(duet))
  let micSource: MediaStreamAudioSourceNode | null = null
  let capture: AudioWorkletNode | null = null
  const player = new PcmPlayer(ctx, AGENT_SAMPLE_RATE)
  let ws: WebSocket | null = null
  let ready = false
  let closed = false
  let ended = false

  const stopMic = () => micStream.getTracks().forEach((t) => t.stop())
  const teardown = () => {
    if (closed) return
    closed = true
    capture?.port.postMessage({ event: 'stop' })
    capture?.port.close()
    micSource?.disconnect()
    capture?.disconnect()
    stopMic()
    player.dispose()
  }

  try {
    await loadCaptureWorklet(ctx)
    capture = new AudioWorkletNode(ctx, 'viki-pcm-capture', {
      numberOfInputs: 1, numberOfOutputs: 0, outputChannelCount: [],
      channelCount: 1, channelCountMode: 'explicit', channelInterpretation: 'speakers',
      processorOptions: { inputSampleRate: ctx.sampleRate, targetSampleRate: AGENT_SAMPLE_RATE, chunkSamples: CHUNK_SAMPLES },
    })
    micSource = ctx.createMediaStreamSource(micStream)
    micSource.connect(capture)
    h.onOutput(player.output)

    const url = new URL(AGENT_WS_URL)
    url.searchParams.set('token', token)
    const socket = new WebSocket(url)
    ws = socket
    const send = (ev: Record<string, unknown>) => {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(ev))
    }
    capture.port.onmessage = ({ data }) => {
      if (ready && !closed && data instanceof ArrayBuffer) send({ type: 'input.audio', audio: encodePcm16Base64(data) })
    }

    const route = createAgentEventRouter(h, {
      send,
      play: (b64) => player.playBase64(b64),
      flush: () => player.flush(),
      drained: (cb) => window.setTimeout(cb, (player.remaining() + 0.3) * 1000),
      onReady: () => { ready = true },
      onEnded: () => { ended = true; socket.close() },
      log: import.meta.env.DEV ? (type, ev) => { if (type !== 'reply.audio' && !type.endsWith('.delta')) console.debug('[viki]', type, ev) } : undefined,
    })

    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error('The voice agent did not answer in time.')), READY_TIMEOUT_MS)
      socket.onopen = () => send({ type: 'session.update', session: config })
      socket.onmessage = (msg) => {
        let ev: any
        try { ev = JSON.parse(String(msg.data)) } catch { return }
        if (!ready && ev?.type === 'session.error') {
          window.clearTimeout(timer)
          reject(new Error(String(ev.message ?? ev.code ?? 'Voice agent error')))
          return
        }
        route(ev)
        if (ev?.type === 'session.ready') { window.clearTimeout(timer); resolve() }
      }
      socket.onerror = () => { /* the close event carries the outcome */ }
      socket.onclose = (e) => {
        window.clearTimeout(timer)
        if (!ready) {
          reject(new Error(e.code === 1006 || e.code === 1008
            ? 'The voice agent refused the connection - the token may have expired.'
            : 'The voice agent closed the connection before it was ready.'))
          return
        }
        if (closed || ended) return
        teardown()
        h.onError('Connection to the voice agent was lost.')
      }
    })

    return {
      greet: () => {
        send({
          type: 'reply.create',
          instructions:
            duet?.role === 'start'
              ? duetOpener(duet)
              : `Greet the user right now, in character, with exactly the words: "${persona.greeting}" in English. Say nothing else, then wait silently for the user to speak.`,
        })
      },
      setPersona: (next: HeadStyle) => {
        persona = PERSONAS[next]
        send({ type: 'session.update', session: { system_prompt: persona.instructions + (duet ? duetRules(next, duet) : '') } })
      },
      get micStream() {
        return micStream
      },
      setMicrophone: async (deviceId: string) => {
        const next = await openMic(deviceId, Boolean(duet))
        const source = ctx.createMediaStreamSource(next)
        if (capture) source.connect(capture)
        micSource?.disconnect()
        stopMic()
        micSource = source
        micStream = next
        return next
      },
      disconnect: () => {
        if (closed) return
        // session.end first: a bare close leaves a billable 30 s resume window.
        send({ type: 'session.end' })
        teardown()
        window.setTimeout(() => { if (socket.readyState !== WebSocket.CLOSED) socket.close() }, 1000)
        h.onStatus('idle')
      },
    }
  } catch (error) {
    teardown()
    try { ws?.close() } catch { /* never opened */ }
    throw error
  }
}
