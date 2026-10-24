import type { HeadConfig, HeadStyle } from './viki/config'
import type { Vec3 } from './tracking/gaze'
import { DESIGNS } from './heads/designs'
import { catalogEntry, PROMO_KEY } from './heads/catalog'
import { cellColumns, gridLayout, type WallLayout } from './layout'
import type { CreateHead, HeadDesign } from './heads/types'
import { ParticleFace } from './viki/ParticleFace'

/** The middle screen carries the HfG message instead of a head. */
export const PROMO_SLOT = 4
/**
 * The head the promo screen shows until someone has stood in front of the wall for
 * PROMO_AFTER_MS; then the HfG message fades in, and out again PROMO_HOLD_MS after they left.
 */
export const PROMO_STAND_IN = 'main-11'
export const PROMO_AFTER_MS = 8000
export const PROMO_HOLD_MS = 4000

// Screens without a working iMac (oben links, unten links) are left out: src/layout.ts, OFFLINE_SLOTS.
export { isOffline } from './layout'

/**
 * Screens that stand off the even grid in the shelf, in metres (x to the right as seen from the
 * street, y up, z towards the street). Mitte links stands further out to the left: measure the extra
 * gap between it and Mitte (centre to centre, minus the normal spacing) and put it here, negative.
 */
export const SLOT_SHIFT: Partial<Record<number, Partial<Vec3>>> = {
  3: { x: 0 },
}

export interface SlotPreset {
  style: HeadStyle
  config?: Partial<HeadConfig>
  /** Gaze spring (rad/s) and reaction lag (s): every head moves a little differently. */
  stiffness: number
  delay: number
}

/**
 * The 3x3 wall, top-left to bottom-right: white Max and purple Dust in a
 * checkerboard, each with its own face so no two heads are the same.
 * They stand in on every screen whose head (src/heads/designs.ts) is not built yet.
 */
export const SLOTS: (SlotPreset | null)[] = [
  { style: 'lattice', stiffness: 5.0, delay: 0.05 },
  { style: 'dust', stiffness: 4.2, delay: 0.18 },
  { style: 'lattice', stiffness: 5.8, delay: 0.1, config: { oval: 0.1, jawWidth: 0.12, chin: 0.1, colorB: '#f2f2f2' } },
  { style: 'dust', stiffness: 5.4, delay: 0.0, config: { oval: 0.08, chin: 0.12, colorA: '#4a1f7a', colorB: '#e09cff', colorC: '#ffd1f5' } },
  null,
  { style: 'dust', stiffness: 4.6, delay: 0.24, config: { cheek: 0.04, hair: 0.5, colorB: '#c4a6ff', colorC: '#9fe8ff' } },
  { style: 'lattice', stiffness: 4.4, delay: 0.2, config: { cheek: 0.04, noseSize: 0.03, lipFull: 0.2, colorB: '#f4efe6' } },
  { style: 'dust', stiffness: 6.2, delay: 0.08, config: { jawWidth: 0.1, noseSize: -0.03, lipFull: 0.25, colorB: '#cf7dff', colorC: '#ff9de2' } },
  { style: 'lattice', stiffness: 5.2, delay: 0.14, config: { browRidge: 0.05, jawWidth: 0.05, noseSize: -0.04, colorB: '#e8eef5' } },
]

const params = new URLSearchParams(window.location.search)

function numberParam(key: string, fallback: number) {
  const value = Number(params.get(key))
  return params.has(key) && Number.isFinite(value) ? value : fallback
}

function flagParam(key: string, fallback: boolean) {
  const value = params.get(key)
  return value === null ? fallback : value !== '0' && value !== 'false'
}

function pairParam(key: string, fallback: [number, number]): [number, number] {
  const parts = (params.get(key) ?? '').split(',').map(Number)
  if (parts.length === 1 && Number.isFinite(parts[0]) && params.has(key)) return [parts[0], parts[0]]
  return parts.length === 2 && parts.every(Number.isFinite) ? [parts[0], parts[1]] : fallback
}

const slotValue = params.has('slot') ? Math.round(numberParam('slot', PROMO_SLOT)) : null
/** `?slot=0..8` shows one screen of the wall; without it the whole wall is on one page. */
const slot = slotValue !== null && slotValue >= 0 && slotValue <= 8 ? slotValue : null
const wall = slot === null

/*
 * Physical layout in metres. The laptop defaults describe a 3x3 grid on a ~30 cm
 * wide laptop screen with the webcam on its top edge; the slot defaults describe
 * the shelf of iMacs, the camera above it. On the camera page all of these can be
 * set in the link to calibrate: ?camerax=&cameray= (metres from the middle screen's
 * centre), ?tilt= (degrees down), ?rotate=0 (not hung upside down), ?spacing=x,y.
 */
const spacing = pairParam('spacing', wall ? [0.1, 0.065] : [0.55, 0.5])
const shelf = pairParam('spacing', [0.55, 0.5])
const cameraX = numberParam('camerax', 0)
const cameraY = numberParam('cameray', wall ? 0.11 : 0.3)

export const SETTINGS = {
  slot,
  wall,
  /**
   * Run the camera + detector in this window. Only where a camera can open at all
   * (http://localhost on the camera machine): a screen reached over the network
   * just shows its slot, whatever the link says.
   */
  camera: flagParam('camera', wall) && window.isSecureContext && Boolean(navigator.mediaDevices),
  /** The pointer stands in for a person (testing without a camera). */
  mouse: flagParam('mouse', false),
  /** Show the camera preview with detections (toggle with D). */
  preview: flagParam('preview', wall),
  /** `?cam=logitech`: use the camera whose name contains this. Default: any external one. */
  cameraName: params.get('cam'),
  /** Horizontal field of view of the camera, degrees. */
  hfov: numberParam('fov', 70),
  spacing: { x: spacing[0], y: spacing[1] },
  /** The real shelf's spacing, also on the all-screens page: the Live tab places its heads as the iMacs stand. */
  shelf: { x: shelf[0], y: shelf[1] },
  cameraPosition: { x: cameraX, y: cameraY, z: 0 } satisfies Vec3,
  /** Degrees the camera looks down. */
  tilt: numberParam('tilt', 0),
  /**
   * Turn the camera image by 180 degrees: `?rotate=180` / `?rotate=0`. Without it the tracker decides
   * by the camera: the external wall camera hangs upside down above the shelf, a laptop's own does not.
   */
  rotate: params.has('rotate') ? numberParam('rotate', 0) === 180 : null,
  /** Lift dark frames and stretch contrast before detection; `?enhance=0` turns it off. */
  enhance: flagParam('enhance', true),
  fps: numberParam('fps', wall ? 30 : 60),
  /** Show the rendered frame rate on each head (`?stats=1`). */
  stats: flagParam('stats', false),
  /** `?wall=custom` shows the live wall from the editor instead of the main one. */
  wallSet: (params.get('wall') === 'custom' ? 'custom' : 'main') as WallSet | 'custom',
  /** `?style=dust` / `lattice` overrides the head of a single slot. */
  style: (['lattice', 'dust'] as const).find((s) => s === params.get('style')) ?? null,
}

/** What one screen of the wall shows. */
export interface WallHead {
  create: CreateHead
  /** The designed head, or null while a Max / Dust variant stands in. */
  design: HeadDesign | null
  stiffness: number
  delay: number
}

/** Built once per page: a new object would rebuild that head. */
export const WALL_HEADS: (WallHead | null)[] = SLOTS.map((preset, slot) => {
  if (!preset) return null
  const design = SETTINGS.style ? undefined : DESIGNS.find((d) => d.slot === slot && d.create)
  const style = SETTINGS.style ?? preset.style
  const config = SETTINGS.style ? undefined : preset.config
  return {
    create: design?.create ?? ((canvas, options) => new ParticleFace(canvas, { ...options, style, config })),
    design: design ?? null,
    stiffness: preset.stiffness,
    delay: preset.delay,
  }
})

export type WallSet = 'main'

/** One screen of a wall: the promo (with the head standing in for it), a head, or a place still waiting for its head. */
export type WallScreen =
  | { kind: 'promo'; standIn: WallHead | null }
  | { kind: 'head'; head: WallHead }
  | { kind: 'empty'; design: HeadDesign }

/** A screen in its place on the wall: its slot, its column in the shelf grid (layout.ts), what it shows. */
export interface PlacedScreen {
  slot: number
  column: number
  screen: WallScreen
}

export type WallRows = PlacedScreen[][]

/** Rows of screens for a layout; `screen` says what each slot shows. */
function place(layout: WallLayout, screen: (slot: number, key: string | null) => WallScreen): WallRows {
  const columns = cellColumns(layout)
  return layout.map((row, r) => row.map((cell, i) => ({ slot: cell.slot, column: columns[r][i], screen: screen(cell.slot, cell.key) })))
}

/** Built once: the head that stands in for the promo. */
const PROMO_HEAD: WallHead | null = (() => {
  const entry = catalogEntry(PROMO_STAND_IN)
  const motion = SLOTS[PROMO_SLOT] ?? { stiffness: 5, delay: 0.1 }
  return entry?.create ? { create: entry.create, design: null, stiffness: motion.stiffness, delay: motion.delay } : null
})()

/** The 3x3 shelf without the places that have no screen. */
const GRID = gridLayout(Array.from({ length: 9 }, () => null))

/** Built once per page, like WALL_HEADS. */
export const SCREENS: Record<WallSet, WallRows> = {
  main: place(GRID, (slot) => {
    const head = WALL_HEADS[slot]
    return head ? { kind: 'head', head } : { kind: 'promo', standIn: PROMO_HEAD }
  }),
}

/** Screens for a custom wall (keys from the catalog, see heads/catalog.ts). Build once per page. */
export function screensFromLayout(layout: WallLayout): WallRows {
  return place(layout, (slot, key): WallScreen => {
    if (key === PROMO_KEY) return { kind: 'promo', standIn: PROMO_HEAD }
    const entry = catalogEntry(key)
    const motion = SLOTS[slot] ?? { stiffness: 5, delay: 0.1 }
    if (entry?.create) {
      return { kind: 'head', head: { create: entry.create, design: null, stiffness: motion.stiffness, delay: motion.delay } }
    }
    return { kind: 'empty', design: { id: slot + 1, name: 'Leer', description: '', slot, create: null } }
  })
}
