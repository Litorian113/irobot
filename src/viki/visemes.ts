/** HeadAudio / Oculus ordering. Zero is the open vowel, not silence. */
export const VISEMES = ['aa', 'E', 'I', 'O', 'U', 'PP', 'SS', 'TH', 'DD', 'FF', 'kk', 'nn', 'RR', 'CH', 'sil'] as const
export const SILENCE = 14
export const SPEECH_MORPHS = ['jawOpen', 'mouthWide', 'mouthClose', 'mouthPress', 'mouthPucker', 'mouthFunnel', 'upperLipUp', 'lowerLipDown', 'lowerLipRoll'] as const
export type SpeechPose = Record<(typeof SPEECH_MORPHS)[number], number>

// Authored for VikiHead. Jaw movement stays modest; articulation comes from lips.
const POSES: Partial<SpeechPose>[] = [
  { jawOpen: 0.27, lowerLipDown: 0.12 },
  { jawOpen: 0.13, mouthWide: 0.30, upperLipUp: 0.10, lowerLipDown: 0.09 },
  { jawOpen: 0.055, mouthWide: 0.48, upperLipUp: 0.08 },
  { jawOpen: 0.17, mouthFunnel: 0.38, mouthPucker: 0.12 },
  { jawOpen: 0.065, mouthFunnel: 0.16, mouthPucker: 0.50 },
  { mouthClose: 0.18, mouthPress: 0.38 },
  { jawOpen: 0.04, mouthWide: 0.25, upperLipUp: 0.10 },
  { jawOpen: 0.075, lowerLipDown: 0.20, upperLipUp: 0.09 },
  { jawOpen: 0.08, mouthWide: 0.15, upperLipUp: 0.09 },
  { jawOpen: 0.04, upperLipUp: 0.23, lowerLipRoll: 0.40, mouthWide: 0.08 },
  { jawOpen: 0.14, upperLipUp: 0.10 },
  { jawOpen: 0.05, mouthClose: 0.04, mouthWide: 0.08 },
  { jawOpen: 0.09, mouthFunnel: 0.18, mouthPucker: 0.12 },
  { jawOpen: 0.065, mouthFunnel: 0.22, mouthPucker: 0.18, upperLipUp: 0.08 },
  {},
]
const unit = (v: number) => Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0

export function mapVisemes(weights: readonly number[], strength = 1) {
  const clean = VISEMES.map((_, i) => unit(weights[i] ?? 0))
  const sum = clean.reduce((a, b) => a + b, 0)
  const scale = 1 / Math.max(1, sum)
  const gain = Number.isFinite(strength) ? Math.min(1.5, Math.max(0, strength)) : 1
  const pose = Object.fromEntries(SPEECH_MORPHS.map((name) => [name, 0])) as SpeechPose
  for (let i = 0; i < SILENCE; i++) {
    for (const name of SPEECH_MORPHS) pose[name] += (POSES[i][name] ?? 0) * clean[i] * scale * gain
  }
  const activity = clean.slice(0, SILENCE).reduce((a, b) => a + b, 0) * scale
  // Closed consonants must win over the conversational smile.
  const expressionScale = 1 - Math.min(1, activity * 0.8 + clean[5] * scale * 0.2)
  return { pose, expressionScale }
}

export function fixedViseme(name: string): number[] | null {
  const index = VISEMES.findIndex((v) => v.toLowerCase() === name.toLowerCase())
  return index < 0 ? null : VISEMES.map((_, i) => i === index ? 1 : 0)
}

/** Timestamped detector frames, sampled against the audible audio clock. */
export class VisemeTimeline {
  private frames: { id: number; time: number }[] = []
  private weights = VISEMES.map(() => 0)
  private candidate = SILENCE
  private candidateSince = 0
  private active = SILENCE
  private lastFrame = -Infinity
  private lastSample: number | null = null

  push(id: number, time: number) {
    if (!Number.isInteger(id) || id < 0 || id > SILENCE || !Number.isFinite(time)) return
    if (time < (this.frames.at(-1)?.time ?? this.lastFrame)) return
    this.frames.push({ id, time })
    if (this.frames.length > 256) this.frames.shift()
  }

  sample(time: number): number[] {
    // Audio context time pauses with the context; rendering frequency is irrelevant.
    const dt = this.lastSample === null ? 1 / 60 : Math.max(0, Math.min(0.1, time - this.lastSample))
    this.lastSample = time
    while (this.frames.length && this.frames[0].time <= time) {
      const frame = this.frames.shift()!
      this.lastFrame = frame.time
      if (frame.id !== this.candidate) {
        this.candidate = frame.id
        this.candidateSince = frame.time
      }
      // Two/three 16 ms observations reject isolated classification flicker.
      const hold = frame.id === 5 ? 0.015 : 0.030
      if (frame.id === SILENCE || frame.time - this.candidateSince >= hold) this.active = frame.id
    }
    if (time - this.lastFrame > 0.14) this.active = SILENCE
    for (let i = 0; i < this.weights.length; i++) {
      const target = i === this.active && i !== SILENCE ? 1 : 0
      const tau = this.active === 5 ? 0.022 : target > this.weights[i] ? 0.040 : 0.055
      this.weights[i] += (target - this.weights[i]) * (1 - Math.exp(-dt / tau))
      if (this.weights[i] < 0.0001) this.weights[i] = 0
    }
    return this.weights.slice()
  }

  reset() {
    this.frames = []
    this.weights.fill(0)
    this.active = this.candidate = SILENCE
    this.lastFrame = -Infinity
    this.lastSample = null
  }
}
