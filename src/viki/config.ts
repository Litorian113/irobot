/** The head's reference scale: feature anchors are defined for the head at this size, centred on its placement. */
export const REF_SCALE = 0.29

/** Everything the configurator can change. Feature positions are head-local (see REF_SCALE). */
export interface HeadConfig {
  // lattice look
  colorDim: string
  colorBright: string
  colorHot: string
  gain: number // face brightness
  cellSize: number // relative cell size
  bloom: number // bloom strength
  fill: number // interior (volumetric) fill
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
  hairline: number // y of the hairline
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

export const DEFAULT_CONFIG: HeadConfig = {
  colorDim: '#24467e',
  colorBright: '#9fd0ff',
  colorHot: '#f2fbff',
  gain: 0.95,
  cellSize: 1.0,
  bloom: 0.5,
  fill: 0.05,
  autoReturn: true,
  headScale: 0.29,
  headY: -0.38,
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

export const SLIDER_GROUPS: SliderGroup[] = [
  {
    title: 'Head',
    sliders: [
      { key: 'headScale', label: 'Size', min: 0.2, max: 0.4, step: 0.005 },
      { key: 'headY', label: 'Height', min: -0.6, max: -0.1, step: 0.01 },
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
  {
    title: 'Lattice',
    sliders: [
      { key: 'gain', label: 'Face brightness', min: 0.4, max: 2, step: 0.02 },
      { key: 'cellSize', label: 'Cell size', min: 0.5, max: 1.8, step: 0.02 },
      { key: 'bloom', label: 'Bloom', min: 0, max: 1.5, step: 0.02 },
      { key: 'fill', label: 'Interior fill', min: 0, max: 0.2, step: 0.005 },
    ],
  },
]

export const COLOR_KEYS: { key: keyof HeadConfig; label: string }[] = [
  { key: 'colorDim', label: 'Lattice' },
  { key: 'colorBright', label: 'Face' },
  { key: 'colorHot', label: 'Highlights' },
]

const STORAGE_KEY = 'viki.config.v2'

export function loadConfig(): HeadConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULT_CONFIG }
    const parsed = JSON.parse(raw) as Partial<HeadConfig>
    return { ...DEFAULT_CONFIG, ...parsed }
  } catch {
    return { ...DEFAULT_CONFIG }
  }
}

export function saveConfig(cfg: HeadConfig) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg))
  } catch {
    /* storage unavailable */
  }
}

export function clearConfig() {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* ignore */
  }
}
