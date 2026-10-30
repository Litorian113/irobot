import { ParticleFace } from '../viki/ParticleFace'
import { OnyxHead } from './onyx/OnyxHead'
import { RoboHead } from './robo/RoboHead'
import { PixelHead } from './pixel/PixelHead'
import { WalleHead } from './walle/WalleHead'
import { AicherHead } from './aicher/AicherHead'
import { RamsHead } from './rams/RamsHead'
import { GlassHead } from './glass/GlassHead'
import { AviciiHead } from './avicii/AviciiHead'
import { ColaniHead } from './colani/ColaniHead'
import { FluxHead } from './flux/FluxHead'
import { JackHead } from './jack/JackHead'
import { BillyHead } from './billy/BillyHead'
import { CreeperHead } from './creeper/CreeperHead'
import { HaendchenHead } from './haendchen/HaendchenHead'
import { ArtHead } from './art/ArtHead'
import { WaldHead } from './wald/WaldHead'
import { XenoHead } from './xeno/XenoHead'
import { FrankHead } from './frank/FrankHead'
import { SamaraHead } from './samara/SamaraHead'
import type { HeadDesign } from './types'

/**
 * The eight heads of the wall, one per screen, all built. A new head: give
 * it a name, its categories and a `create` function returning a HeadView (see ./types.ts).
 * It must run on WebGL 1.
 */
export const DESIGNS: HeadDesign[] = [
  {
    id: 1,
    name: 'M.A.X.',
    categories: ['kunst'],
    description: 'Weißer Kopf aus gestapelten Kacheln',
    slot: 0,
    create: (canvas, options) => new ParticleFace(canvas, { ...options, style: 'lattice' }),
  },
  {
    id: 2,
    name: 'D.U.S.T.',
    categories: ['kunst'],
    description: 'Lila Kopf aus Partikeln, die an den Rändern zerfasern',
    slot: 1,
    create: (canvas, options) => new ParticleFace(canvas, { ...options, style: 'dust' }),
  },
  {
    id: 3,
    name: 'V.O.L.T.',
    categories: ['roboter'],
    description: 'Kleiner Roboter mit Bildschirmgesicht, gelbgrün leuchtend',
    slot: 2,
    create: (canvas, options) => new RoboHead(canvas, options),
  },
  {
    id: 4,
    name: 'S.T.E.V.E.',
    categories: ['designer', 'bloecke'],
    description: '1-Bit-Pixelporträt als Voxelbüste, flackert und glitcht',
    slot: 3,
    create: (canvas, options) => new PixelHead(canvas, options),
  },
  {
    id: 5,
    name: 'O.N.Y.X.',
    categories: ['roboter'],
    description: 'Glänzender schwarzer Helm mit Pixelzeichen, Strickhals, helles Studio',
    slot: 5,
    create: (canvas, options) => new OnyxHead(canvas, options),
  },
  {
    id: 6,
    name: 'W.A.L.L.·E',
    categories: ['roboter'],
    description: 'Rostiger Müllroboter mit Fernglasaugen; ein Blitz macht ihn kurz böse',
    slot: 6,
    create: (canvas, options) => new WalleHead(canvas, options),
  },
  {
    id: 7,
    name: 'O.T.L.',
    categories: ['designer'],
    description: 'Otl Aicher als facettierter Kopf, gemalt in Mint und Blau auf Rot',
    slot: 7,
    create: (canvas, options) => new AicherHead(canvas, options),
  },
  {
    id: 8,
    name: 'R.A.M.S.',
    categories: ['designer'],
    description: 'Dieter Rams als Braun-Gerät: weißes Gehäuse, Brille aus Drehreglern, Tastenmund, Lederhenkel',
    slot: 8,
    create: (canvas, options) => new RamsHead(canvas, options),
  },
  {
    id: 9,
    name: 'G.L.A.S.',
    categories: ['kunst'],
    description: 'Kopf aus pfirsichfarbenem Glas, Lippen und Ohren aus Chrom, innen fließt dunkle Tinte',
    // No screen of its own on the main wall: pick it in "Eigene Wand".
    slot: null,
    create: (canvas, options) => new GlassHead(canvas, options),
  },
  {
    id: 10,
    name: 'C.O.L.A.N.I.',
    categories: ['designer', 'bloecke'],
    description: 'Luigi Colani als Bausteinfigur: gelber Kopf, riesiger Schnurrbart, lange Haare, Zigarre, weißer Rollkragen',
    // An example head for the list: pick it in "Eigene Wand".
    slot: null,
    create: (canvas, options) => new ColaniHead(canvas, options),
  },
  {
    id: 11,
    name: 'F.L.U.X.',
    categories: ['kunst'],
    description: 'Glatter Porzellankopf, um die Augen eine Box aus blauen Linien voller rotem Gel',
    // No screen of its own on the main wall: pick it in "Eigene Wand".
    slot: null,
    create: (canvas, options) => new FluxHead(canvas, options),
  },
  {
    id: 12,
    name: 'A.V.I.C.I.I.',
    categories: ['kunst'],
    description: 'Low-Poly-Porträt in Grautönen: Cap verkehrt herum, Facetten blitzen im 128-BPM-Takt',
    slot: null,
    create: (canvas, options) => new AviciiHead(canvas, options),
  },
  {
    id: 13,
    name: 'J.A.C.K.',
    categories: ['gruselig'],
    description: 'Leuchtender Halloween-Kürbis mit Zylinder, Mantel und Krawatte im Abendnebel',
    // For Halloween: pick it in "Eigene Wand".
    slot: null,
    create: (canvas, options) => new JackHead(canvas, options),
  },
  {
    id: 14,
    name: 'C.R.E.E.P.E.R.',
    categories: ['bloecke'],
    description: 'Block-Creeper aus echten Würfeln: blinkt, bläht sich auf und explodiert, wenn jemand auftaucht',
    slot: null,
    create: (canvas, options) => new CreeperHead(canvas, options),
  },
  {
    id: 16,
    name: 'B.I.L.L.Y.',
    categories: ['gruselig'],
    description: 'Horrorpuppe: rissige Pappmaché-Maske, rote Augen, Spiralwangen, klappendes Kinn, flackerndes Licht',
    // For Halloween: pick it in "Eigene Wand".
    slot: null,
    create: (canvas, options) => new BillyHead(canvas, options),
  },
  {
    id: 18,
    name: 'H.Ä.N.D.C.H.E.N.',
    categories: ['gruselig'],
    description: 'Zusammengenähte Hand ohne Körper: trommelt mit den Fingern, macht einen Salto und zeigt das Peacezeichen',
    slot: null,
    create: (canvas, options) => new HaendchenHead(canvas, options),
  },
  {
    id: 19,
    name: 'A.R.T.',
    categories: ['gruselig'],
    description: 'Der stumme Clown in Schwarz-Weiß: faltige Latexmaske, schwarzes Riesengrinsen, Mini-Zylinder. Legt den Kopf schief und lacht lautlos',
    // For Halloween: pick it in "Eigene Wand".
    slot: null,
    create: (canvas, options) => new ArtHead(canvas, options),
  },
  {
    id: 20,
    name: 'W.A.L.D.',
    categories: ['gruselig'],
    description: 'Gruseliger Waldgeist: Hirschschädel mit riesigem Geweih, zerrissene Lederkutte, Knochen am Ast, Irrlichter',
    // For Halloween: pick it in "Eigene Wand".
    slot: null,
    create: (canvas, options) => new WaldHead(canvas, options),
  },
  {
    id: 30,
    name: 'F.R.A.N.K.',
    categories: ['gruselig'],
    description: 'Das Monster aus dem alten Horrorfilm, schwarzweiß mit Filmkorn: Flachschädel, Klammern, Narbe, schwere Lider, Halsbolzen, die Funken schlagen',
    // For Halloween: pick it in "Eigene Wand".
    slot: null,
    create: (canvas, options) => new FrankHead(canvas, options),
  },
  {
    id: 31,
    name: 'S.A.M.A.R.A.',
    categories: ['gruselig'],
    description: 'Das Mädchen aus dem Brunnen: nasses schwarzes Haar vor einem rissigen, grauen Gesicht, ein bleiches Auge. Das Videoband springt, und mit jedem Sprung kommt sie näher',
    // For Halloween: pick it in "Eigene Wand".
    slot: null,
    create: (canvas, options) => new SamaraHead(canvas, options),
  },
  {
    id: 40,
    name: 'X.E.N.O.',
    categories: ['gruselig'],
    description: 'Biomechanische Kreatur: Kuppel aus schwarzem Glas, nasse Schläuche und Sehnen, ein zweiter Kiefer, der hervorschnellt',
    // For Halloween: pick it in "Eigene Wand".
    slot: null,
    create: (canvas, options) => new XenoHead(canvas, options),
  },
]
