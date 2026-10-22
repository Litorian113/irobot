import type { HeadConfig, HeadStyle } from './viki/config'
import type { Vec3 } from './tracking/gaze'
import { DESIGNS } from './heads/designs'
import { HALLOWEEN } from './heads/halloween'
import { catalogEntry, PROMO_KEY, type WallKeys } from './heads/catalog'
import type { CreateHead, HeadDesign } from './heads/types'
import { ParticleFace } from './viki/ParticleFace'

/** The middle screen carries the HfG message instead of a head. */
export const PROMO_SLOT = 4

export const SLOT_NAMES = [
  'oben links', 'oben Mitte', 'oben rechts',
  'Mitte links', 'Mitte (Werbung)', 'Mitte rechts',
  'unten links', 'unten Mitte', 'unten rechts',
]

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
 * the shelf of iMacs with the camera right above the middle (promo) screen.
 */
const spacing = pairParam('spacing', wall ? [0.1, 0.065] : [0.55, 0.5])
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
  cameraPosition: { x: 0, y: cameraY, z: 0 } satisfies Vec3,
  fps: numberParam('fps', wall ? 30 : 60),
  /** Show the rendered frame rate on each head (`?stats=1`). */
  stats: flagParam('stats', false),
  /** `?wall=halloween` loads the Halloween wall instead of the main one. */
  wallSet: ((['halloween', 'custom'] as const).find((w) => w === params.get('wall')) ?? 'main') as WallSet | 'custom',
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

export type WallSet = 'main' | 'halloween'

/** One screen of a wall: the promo, a head, or a place still waiting for its head. */
export type WallScreen =
  | { kind: 'promo' }
  | { kind: 'head'; head: WallHead }
  | { kind: 'empty'; design: HeadDesign }

/** Built once per page, like WALL_HEADS. */
export const SCREENS: Record<WallSet, WallScreen[]> = {
  main: WALL_HEADS.map((head) => (head ? { kind: 'head', head } : { kind: 'promo' })),
  halloween: HALLOWEEN.map((design) => {
    const motion = SLOTS[design.slot] ?? { stiffness: 5, delay: 0.1 }
    return design.create
      ? { kind: 'head', head: { create: design.create, design, stiffness: motion.stiffness, delay: motion.delay } }
      : { kind: 'empty', design }
  }),
}

/** Screens for a custom wall (keys from the catalog, see heads/catalog.ts). Build once per page. */
export function screensFromKeys(keys: WallKeys): WallScreen[] {
  return Array.from({ length: 9 }, (_, slot): WallScreen => {
    const key = keys[slot] ?? null
    if (key === PROMO_KEY) return { kind: 'promo' }
    const entry = catalogEntry(key)
    const motion = SLOTS[slot] ?? { stiffness: 5, delay: 0.1 }
    if (entry?.create) {
      return { kind: 'head', head: { create: entry.create, design: null, stiffness: motion.stiffness, delay: motion.delay } }
    }
    return { kind: 'empty', design: { id: slot + 1, name: 'Leer', description: '', slot, create: null } }
  })
}
