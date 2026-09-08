import { EXPRESSIONS, type Expression, type ParticleFace } from './viki/ParticleFace'
import { fixedViseme, VISEMES } from './viki/visemes'

/** Dev aid: `?preview=happy` forms the face with that expression and fakes speech (no API calls). */
export const PREVIEW = new URLSearchParams(window.location.search).get('preview') as Expression | null

/** Fake speech pattern for previews / the configurator's test mode. */
export function fakeTalk(t0: number) {
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

/**
 * URL-driven preview pose: expression plus a mouth held by `mouth`/`wide`/`round`,
 * a fixed `viseme`, or the animated fake speech.
 */
export function applyUrlPreview(face: ParticleFace, form: { face: number; turb: number; forward: number }) {
  if (!PREVIEW) return
  face.setTarget(form)
  face.setExpression(PREVIEW in EXPRESSIONS ? PREVIEW : 'neutral')
  const t0 = performance.now()
  const params = new URLSearchParams(window.location.search)
  const mouthParam = params.get('mouth')
  const fixedMouth = mouthParam === null ? NaN : Number(mouthParam)
  const visemes = fixedViseme(params.get('viseme') ?? '')
  const fixed = (key: string, fallback: number) => {
    const value = params.get(key)
    return value !== null && Number.isFinite(Number(value)) ? Math.max(0, Math.min(1, Number(value))) : fallback
  }
  face.setMouthSource(() => (visemes ? { open: 0, wide: 0, visemes } : Number.isFinite(fixedMouth)
    ? { open: fixed('mouth', 0), wide: fixed('wide', 0.4), round: fixed('round', fixed('mouth', 0) * (1 - fixed('wide', 0.4))) }
    : fakeTalk(t0)))
}
