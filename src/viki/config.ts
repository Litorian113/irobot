/** The head's reference scale: feature anchors are defined for the head at this size, centred on its placement. */
export const REF_SCALE = 0.29

export type HeadStyle = 'lattice' | 'contour' | 'dots' | 'plasma' | 'dust'

export const STYLES: { id: HeadStyle; label: string; hint: string }[] = [
  { id: 'lattice', label: 'Lattice', hint: 'V.I.K.I. — a face inside a cube of light cells' },
  { id: 'contour', label: 'Contour', hint: 'Topographic lines over a black head' },
  { id: 'dots', label: 'Dots', hint: 'LED matrix, warm patches over cool light' },
  { id: 'plasma', label: 'Plasma', hint: 'A blurred silhouette crowned by a colour flame' },
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
  density: number // contour line frequency / dot pitch / dust amount
  lineWidth: number // contour
  flicker: number // dots twinkle / plasma turbulence
  scatter: number // dust edge scatter
  chroma: number // plasma chromatic aberration
  dotSize: number // dust particle size
  cage: number // brightness of the surrounding cube/cage
  autoReturn: boolean // ease back to the front after a drag
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
}

/** Shared shape defaults (the same face in every style). */
const SHAPE_DEFAULTS = {
  autoReturn: true,
  headScale: 0.46,
  headY: -0.55,
  oval: 0.06,
  jawWidth: 0.16,
  chin: 0.14,
  cheek: 0.035,
  browRidge: 0.05,
  noseSize: -0.045,
  hair: 0,
  hairline: 0.88,
  eyeSize: 1.25,
  eyeGlow: 1.0,
  eyeX: 0.216,
  eyeY: 0.49,
  browY: 0.59,
  mouthY: 0.11,
  mouthWidth: 0.15,
  lipFull: 0.22,
}

const APPEARANCE_BASE = {
  cage: 0.5,
  gain: 1,
  cellSize: 1,
  bloom: 0.5,
  fill: 0.05,
  density: 0.5,
  lineWidth: 0.08,
  flicker: 0.5,
  scatter: 0.5,
  chroma: 0.5,
  dotSize: 1,
}

export const STYLE_DEFAULTS: Record<HeadStyle, HeadConfig> = {
  lattice: {
    ...APPEARANCE_BASE,
    ...SHAPE_DEFAULTS,
    // the film look: silver cells on near-black, dark hollow eyes
    colorA: '#31363d',
    colorB: '#c8d1d9',
    colorC: '#ffffff',
    gain: 0.95,
    bloom: 0.45,
    flicker: 0.6,
    eyeGlow: 0.25,
  },
  contour: {
    ...APPEARANCE_BASE,
    ...SHAPE_DEFAULTS,
    colorA: '#f4f6ff',
    colorB: '#05070c',
    colorC: '#cfe4ff',
    density: 0.5,
    lineWidth: 0.06,
    bloom: 0.3,
    gain: 1,
  },
  dots: {
    ...APPEARANCE_BASE,
    ...SHAPE_DEFAULTS,
    colorA: '#2f6cff',
    colorB: '#ff8a1f',
    colorC: '#ffe9c4',
    density: 0.5,
    flicker: 0.5,
    bloom: 0.6,
    gain: 0.85,
  },
  plasma: {
    ...APPEARANCE_BASE,
    ...SHAPE_DEFAULTS,
    colorA: '#2a4dff',
    colorB: '#ff3fa8',
    colorC: '#ffb347',
    flicker: 0.5,
    chroma: 0.5,
    bloom: 0.9,
    gain: 1,
    hair: 0.6,
    hairline: 0.7,
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
      { key: 'eyeSize', label: 'Eye size', min: 0.5, max: 1.8, step: 0.02 },
      { key: 'eyeGlow', label: 'Eye glow', min: 0, max: 1.2, step: 0.02 },
      { key: 'eyeX', label: 'Eye spacing', min: 0.15, max: 0.3, step: 0.002 },
      { key: 'eyeY', label: 'Eye height', min: 0.38, max: 0.62, step: 0.002 },
      { key: 'browY', label: 'Brow height', min: 0.48, max: 0.72, step: 0.002 },
    ],
  },
  {
    title: 'Mouth',
    sliders: [
      { key: 'mouthY', label: 'Height', min: -0.02, max: 0.25, step: 0.002 },
      { key: 'mouthWidth', label: 'Width', min: 0.08, max: 0.24, step: 0.002 },
      { key: 'lipFull', label: 'Lips', min: 0, max: 0.35, step: 0.01 },
    ],
  },
]

/** Appearance group per style. */
export const STYLE_GROUPS: Record<HeadStyle, SliderGroup> = {
  lattice: {
    title: 'Lattice',
    sliders: [
      { key: 'gain', label: 'Face brightness', min: 0.4, max: 2, step: 0.02 },
      { key: 'cellSize', label: 'Cell size', min: 0.5, max: 1.8, step: 0.02 },
      { key: 'bloom', label: 'Bloom', min: 0, max: 1.5, step: 0.02 },
      { key: 'fill', label: 'Interior fill', min: 0, max: 0.2, step: 0.005 },
      { key: 'flicker', label: 'Cell variation', min: 0, max: 1, step: 0.01 },
      { key: 'cage', label: 'Cage brightness', min: 0, max: 1, step: 0.01 },
    ],
  },
  contour: {
    title: 'Contour',
    sliders: [
      { key: 'density', label: 'Line density', min: 0.1, max: 1, step: 0.01 },
      { key: 'lineWidth', label: 'Line width', min: 0.02, max: 0.25, step: 0.005 },
      { key: 'gain', label: 'Brightness', min: 0.4, max: 2, step: 0.02 },
      { key: 'bloom', label: 'Glow', min: 0, max: 1.5, step: 0.02 },
      { key: 'cage', label: 'Cage', min: 0, max: 1, step: 0.01 },
    ],
  },
  dots: {
    title: 'Dots',
    sliders: [
      { key: 'density', label: 'Dot density', min: 0.1, max: 1, step: 0.01 },
      { key: 'flicker', label: 'Flicker', min: 0, max: 1, step: 0.01 },
      { key: 'gain', label: 'Brightness', min: 0.4, max: 2, step: 0.02 },
      { key: 'bloom', label: 'Glow', min: 0, max: 1.5, step: 0.02 },
      { key: 'cage', label: 'Cage', min: 0, max: 1, step: 0.01 },
    ],
  },
  plasma: {
    title: 'Plasma',
    sliders: [
      { key: 'flicker', label: 'Turbulence', min: 0, max: 1, step: 0.01 },
      { key: 'chroma', label: 'Colour split', min: 0, max: 1, step: 0.01 },
      { key: 'gain', label: 'Brightness', min: 0.4, max: 2, step: 0.02 },
      { key: 'bloom', label: 'Blur / glow', min: 0, max: 2, step: 0.02 },
      { key: 'cage', label: 'Cage', min: 0, max: 1, step: 0.01 },
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
  lattice: ['Lattice', 'Face', 'Highlights'],
  contour: ['Lines', 'Body', 'Rim'],
  dots: ['Cool', 'Warm', 'Sparkle'],
  plasma: ['Base', 'Flame', 'Hot'],
  dust: ['Shadow', 'Light', 'Sparkle'],
}

const STORAGE_PREFIX = 'viki.config.v3.'
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
