/** The head's reference scale: feature anchors are defined for the head at this size, centred on its placement. */
export const REF_SCALE = 0.29

export type HeadStyle = 'lattice' | 'dust'

export const STYLES: { id: HeadStyle; label: string; hint: string }[] = [
  { id: 'lattice', label: 'Lattice', hint: 'A human presence inside a layered cube of light' },
  { id: 'dust', label: 'Dust', hint: 'Fine particles that scatter at the edges' },
]

/** Everything the configurator can change. Feature positions are head-local (see REF_SCALE). */
export interface HeadConfig {
  // appearance (meaning differs per style, see STYLE_GROUPS)
  colorA: string
  colorB: string
  colorC: string
  gain: number // brightness
  cellSize: number // lattice cell size
  bloom: number // bloom strength
  fill: number // lattice interior fill
  density: number // lattice point density / dust amount
  flicker: number // lattice shimmer
  scatter: number // dust edge scatter
  dotSize: number // dust particle size
  cage: number // brightness of the surrounding cube/cage
  cubeDensity: number
  cubeDepth: number
  cubeGap: number
  autoReturn: boolean // ease back to the front after a drag
  lighting: 'soft' | 'cinema' | 'butterfly' | 'viki'
  lightElevation: number
  lightFill: number
  optical: boolean
  refraction: number
  diffusion: number
  glassRibs: number
  filmGrain: number
  // head placement
  headScale: number
  headY: number
  oval: number // taller / narrower skull
  // shape
  jawWidth: number // 0 = scan, higher = narrower jaw & neck
  chin: number // taper
  cheek: number // cheekbone bump
  browRidge: number // how much the brow ridge is softened
  noseSize: number // negative = smaller
  hair: number // hair volume
  hairline: number // y of the hairline (head-local)
  // eyes
  eyeSize: number
  eyeGlow: number
  eyeX: number
  eyeY: number
  browY: number
  // mouth
  mouthY: number
  mouthWidth: number
  lipFull: number
  speechStrength: number
  speechDelay: number // milliseconds of assistant audio buffering for lip sync
}

/** Shared shape defaults (the same face in every style). */
const SHAPE_DEFAULTS = {
  lighting: 'cinema' as const,
  lightElevation: 45,
  lightFill: 0.035,
  autoReturn: true,
  headScale: 0.44,
  headY: -0.43,
  oval: 0.0,
  jawWidth: 0.0,
  chin: 0.0,
  cheek: 0.0,
  browRidge: 0.0,
  noseSize: 0.0,
  hair: 0,
  hairline: 0.88,
  eyeSize: 1.0,
  eyeGlow: 0.3,
  eyeX: 0.176,
  eyeY: 0.49,
  browY: 0.59,
  mouthY: 0.11,
  mouthWidth: 0.15,
  lipFull: 0.0,
  speechStrength: 1.0,
  speechDelay: 100,
}

const APPEARANCE_BASE = {
  optical: false,
  refraction: 0.65,
  diffusion: 0.70,
  glassRibs: 0.65,
  filmGrain: 0.18,
  cage: 0.5,
  cubeDensity: 0.5,
  cubeDepth: 0.9,
  cubeGap: 0.06,
  gain: 1,
  cellSize: 1,
  bloom: 0.5,
  fill: 0.05,
  density: 0.5,
  flicker: 0.5,
  scatter: 0.5,
  dotSize: 1,
}

export const STYLE_DEFAULTS: Record<HeadStyle, HeadConfig> = {
  lattice: {
    ...APPEARANCE_BASE,
    ...SHAPE_DEFAULTS,
    optical: true,
    lighting: 'viki',
    lightElevation: 50,
    lightFill: 0.008,
    // Soft silver-blue surface points, with a quiet data field around them.
    colorA: '#829ba8',
    colorB: '#b6d8e5',
    colorC: '#edf3f3',
    gain: 1.15,
    bloom: 0.18,
    density: 0.85,
    cellSize: 1.0,
    cage: 0.65,
    flicker: 0.2,
  },
  dust: {
    ...APPEARANCE_BASE,
    ...SHAPE_DEFAULTS,
    colorA: '#5b2a8a',
    colorB: '#d58cff',
    colorC: '#8fd7ff',
    density: 0.7,
    dotSize: 1,
    scatter: 0.5,
    bloom: 0.35,
    gain: 1.1,
  },
}

export const DEFAULT_CONFIG: HeadConfig = STYLE_DEFAULTS.lattice

export interface SliderDef {
  key: keyof HeadConfig
  label: string
  min: number
  max: number
  step: number
}

export interface SliderGroup {
  title: string
  sliders: SliderDef[]
}

/** Shape groups shown for every style. */
export const SHAPE_GROUPS: SliderGroup[] = [
  { title: 'Optical enclosure', sliders: [
    { key: 'refraction', label: 'Refraction', min: 0, max: 1.5, step: 0.02 },
    { key: 'diffusion', label: 'Diffusion', min: 0, max: 1.5, step: 0.02 },
    { key: 'glassRibs', label: 'Fine ridges', min: 0, max: 1, step: 0.02 },
    { key: 'filmGrain', label: 'Film grain', min: 0, max: 1, step: 0.02 },
  ] },
  { title: 'Lighting adjustment', sliders: [
    { key: 'lightElevation', label: 'Key elevation', min: 25, max: 65, step: 1 },
    { key: 'lightFill', label: 'Shadow fill', min: 0, max: 0.4, step: 0.01 },
  ] },
  {
    title: 'Head',
    sliders: [
      { key: 'headScale', label: 'Size', min: 0.25, max: 0.6, step: 0.005 },
      { key: 'headY', label: 'Height', min: -0.9, max: -0.2, step: 0.01 },
      { key: 'oval', label: 'Oval skull', min: 0, max: 0.15, step: 0.005 },
      { key: 'jawWidth', label: 'Jaw narrowing', min: 0, max: 0.25, step: 0.005 },
      { key: 'chin', label: 'Chin taper', min: 0, max: 0.25, step: 0.005 },
      { key: 'cheek', label: 'Cheekbones', min: 0, max: 0.06, step: 0.002 },
      { key: 'browRidge', label: 'Soften brow ridge', min: 0, max: 0.07, step: 0.002 },
      { key: 'noseSize', label: 'Nose', min: -0.06, max: 0.06, step: 0.002 },
    ],
  },
  {
    title: 'Hair',
    sliders: [
      { key: 'hair', label: 'Volume', min: 0, max: 1, step: 0.01 },
      { key: 'hairline', label: 'Hairline', min: 0.6, max: 1.1, step: 0.01 },
    ],
  },
  {
    title: 'Eyes & brows',
    sliders: [
      { key: 'eyeSize', label: 'Iris size', min: 0.7, max: 1.3, step: 0.02 },
      { key: 'eyeGlow', label: 'Eye brightness', min: 0, max: 1.2, step: 0.02 },
    ],
  },
  {
    title: 'Mouth',
    sliders: [
      { key: 'mouthWidth', label: 'Width', min: 0.08, max: 0.24, step: 0.002 },
      { key: 'lipFull', label: 'Lips', min: 0, max: 0.35, step: 0.01 },
    ],
  },
  {
    title: 'Speech',
    sliders: [
      { key: 'speechStrength', label: 'Articulation', min: 0.5, max: 1.5, step: 0.05 },
      { key: 'speechDelay', label: 'Voice delay (ms)', min: 40, max: 250, step: 10 },
    ],
  },
]

/** Appearance group per style. */
export const STYLE_GROUPS: Record<HeadStyle, SliderGroup> = {
  lattice: {
    title: 'Lattice',
    sliders: [
      { key: 'gain', label: 'Face brightness', min: 0.4, max: 2, step: 0.02 },
      { key: 'cellSize', label: 'Point size', min: 0.5, max: 1.8, step: 0.02 },
      { key: 'density', label: 'Point density', min: 0.1, max: 1, step: 0.01 },
      { key: 'bloom', label: 'Bloom', min: 0, max: 1.5, step: 0.02 },
      { key: 'flicker', label: 'Shimmer', min: 0, max: 1, step: 0.01 },
      { key: 'cage', label: 'Cube brightness', min: 0, max: 1, step: 0.01 },
      { key: 'cubeDensity', label: 'Cube cells', min: 0, max: 1, step: 0.02 },
      { key: 'cubeDepth', label: 'Cube depth', min: 0.6, max: 1.3, step: 0.02 },
      { key: 'cubeGap', label: 'Cube spacing', min: 0, max: 0.25, step: 0.01 },
    ],
  },
  dust: {
    title: 'Dust',
    sliders: [
      { key: 'density', label: 'Particles', min: 0.15, max: 1, step: 0.01 },
      { key: 'dotSize', label: 'Particle size', min: 0.5, max: 2, step: 0.02 },
      { key: 'scatter', label: 'Edge scatter', min: 0, max: 1, step: 0.01 },
      { key: 'gain', label: 'Brightness', min: 0.4, max: 2, step: 0.02 },
      { key: 'bloom', label: 'Glow', min: 0, max: 1.5, step: 0.02 },
      { key: 'cage', label: 'Cage', min: 0, max: 1, step: 0.01 },
    ],
  },
}

export const COLOR_LABELS: Record<HeadStyle, [string, string, string]> = {
  lattice: ['Cube', 'Face', 'Highlights'],
  dust: ['Shadow', 'Light', 'Sparkle'],
}

// A new portrait preset. Previous v3/v4 settings remain stored, untouched.
const STORAGE_PREFIX = 'viki.config.v5.'
const STYLE_KEY = 'viki.style'

export function loadConfig(style: HeadStyle): HeadConfig {
  const defaults = STYLE_DEFAULTS[style]
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + style)
    if (!raw) return { ...defaults }
    return { ...defaults, ...(JSON.parse(raw) as Partial<HeadConfig>) }
  } catch {
    return { ...defaults }
  }
}

export function saveConfig(style: HeadStyle, cfg: HeadConfig) {
  try {
    localStorage.setItem(STORAGE_PREFIX + style, JSON.stringify(cfg))
  } catch {
    /* storage unavailable */
  }
}

export function clearConfig(style: HeadStyle) {
  try {
    localStorage.removeItem(STORAGE_PREFIX + style)
  } catch {
    /* ignore */
  }
}

export function loadStyle(): HeadStyle {
  try {
    const s = localStorage.getItem(STYLE_KEY) as HeadStyle | null
    return s && STYLES.some((x) => x.id === s) ? s : 'lattice'
  } catch {
    return 'lattice'
  }
}

export function saveStyle(style: HeadStyle) {
  try {
    localStorage.setItem(STYLE_KEY, style)
  } catch {
    /* ignore */
  }
}
