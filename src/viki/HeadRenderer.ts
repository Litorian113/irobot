import type { ParticleFace } from './ParticleFace'

/** The UI and voice session only need these controls, regardless of scene complexity. */
export type HeadRenderer = Pick<ParticleFace,
  'applyConfig' | 'setTarget' | 'setExpression' | 'setMouthSource' |
  'setActive' | 'setBackdrop' | 'resetView' | 'isFormed' | 'dispose'
> & { debug(): unknown }
