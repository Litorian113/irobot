import { ParticleFace } from '../viki/ParticleFace'
import { OnyxHead } from './onyx/OnyxHead'
import { RoboHead } from './robo/RoboHead'
import { PixelHead } from './pixel/PixelHead'
import { WalleHead } from './walle/WalleHead'
import { AicherHead } from './aicher/AicherHead'
import { RamsHead } from './rams/RamsHead'
import type { HeadDesign } from './types'

/**
 * The eight heads of the wall, one per screen, all built. A new head: give
 * it a name and a `create` function returning a HeadView (see ./types.ts).
 * It must run on WebGL 1.
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
  {
    id: 3,
    name: 'V.O.L.T.',
    description: 'Kleiner Roboter mit Bildschirmgesicht, gelbgrün leuchtend',
    slot: 2,
    create: (canvas, options) => new RoboHead(canvas, options),
  },
  {
    id: 4,
    name: 'S.T.E.V.E.',
    description: '1-Bit-Pixelporträt als Voxelbüste, flackert und glitcht',
    slot: 3,
    create: (canvas, options) => new PixelHead(canvas, options),
  },
  {
    id: 5,
    name: 'O.N.Y.X.',
    description: 'Glänzender schwarzer Helm mit Pixelzeichen, Strickhals, helles Studio',
    slot: 5,
    create: (canvas, options) => new OnyxHead(canvas, options),
  },
  {
    id: 6,
    name: 'W.A.L.L.·E',
    description: 'Rostiger Müllroboter mit Fernglasaugen; ein Blitz macht ihn kurz böse',
    slot: 6,
    create: (canvas, options) => new WalleHead(canvas, options),
  },
  {
    id: 7,
    name: 'O.T.L.',
    description: 'Otl Aicher als facettierter Kopf, gemalt in Mint und Blau auf Rot',
    slot: 7,
    create: (canvas, options) => new AicherHead(canvas, options),
  },
  {
    id: 8,
    name: 'R.A.M.S.',
    description: 'Dieter Rams als Braun-Gerät: weißes Gehäuse, Brille aus Drehreglern, Tastenmund, Lederhenkel',
    slot: 8,
    create: (canvas, options) => new RamsHead(canvas, options),
  },
]
