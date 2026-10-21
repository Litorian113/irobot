import { ParticleFace } from '../viki/ParticleFace'
import type { HeadDesign } from './types'

/**
 * The eight heads of the wall, one per screen. Two are built; the other six
 * are waiting to be designed. A new head: give it a name and a `create`
 * function returning a HeadView (see ./types.ts). It must run on WebGL 1.
 */
export const DESIGNS: HeadDesign[] = [
  {
    id: 1,
    name: 'M.A.X.',
    description: 'Weißer Kopf aus gestapelten Kacheln',
    slot: 0,
    create: (canvas, options) => new ParticleFace(canvas, { ...options, style: 'lattice' }),
  },
  {
    id: 2,
    name: 'D.U.S.T.',
    description: 'Lila Kopf aus Partikeln, die an den Rändern zerfasern',
    slot: 1,
    create: (canvas, options) => new ParticleFace(canvas, { ...options, style: 'dust' }),
  },
  { id: 3, name: 'Kopf 3', description: 'Noch leer', slot: 2, create: null },
  { id: 4, name: 'Kopf 4', description: 'Noch leer', slot: 3, create: null },
  { id: 5, name: 'Kopf 5', description: 'Noch leer', slot: 5, create: null },
  { id: 6, name: 'Kopf 6', description: 'Noch leer', slot: 6, create: null },
  { id: 7, name: 'Kopf 7', description: 'Noch leer', slot: 7, create: null },
  { id: 8, name: 'Kopf 8', description: 'Noch leer', slot: 8, create: null },
]
