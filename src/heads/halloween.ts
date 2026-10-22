import type { HeadDesign } from './types'

/**
 * The Halloween wall: nine screens, all still to be designed - the middle one
 * included, there is no promo on this wall yet. A new head: give it a name
 * and a `create` function returning a HeadView (see ./types.ts). WebGL 1 only.
 */
export const HALLOWEEN: HeadDesign[] = Array.from({ length: 9 }, (_, slot) => ({
  id: slot + 1,
  name: `Halloween ${slot + 1}`,
  description: 'Noch leer',
  slot,
  create: null,
}))
