/** The head's reference scale: feature anchors are defined for the head at this size, centred on its placement. */
export const REF_SCALE = 0.29

/** `lattice` is the white tile head (M.A.X.), `dust` the purple particle head (D.U.S.T.). */
export type HeadStyle = 'lattice' | 'dust'

/** Everything that shapes and colours one head. Feature positions are head-local (see REF_SCALE). */
export interface HeadConfig {
  // appearance (meaning differs per style)
  colorA: string
  colorB: string
  colorC: string
  gain: number // brightness
  cellSize: number // Max: tile fill
  bloom: number // Dust: glow strength
  density: number // Max: tile density / Dust: particle amount
  flicker: number // Max: loose crown fragments
  scatter: number // Dust: edge scatter
  dotSize: number // Dust: particle size
  radialBlur?: number // Dust: outward light trails around a sharp facial center
  cage: number // Dust: brightness of the surrounding cloud
  cubeDepth: number // Max: depth of each tile layer
  lighting: 'soft' | 'cinema' | 'butterfly'
  lightElevation: number
  lightFill: number
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
  /** 0: the portrait ends under the chin; 1: a neck runs down out of the frame (Max). */
  neck?: number
}

/** Shared shape defaults (the same face in every style). */
const SHAPE_DEFAULTS = {
  lighting: 'cinema' as const,
  lightElevation: 45,
  lightFill: 0.035,
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
}

const APPEARANCE_BASE = {
  cage: 0.5,
  cubeDepth: 0.9,
  gain: 1,
  cellSize: 1,
  bloom: 0.5,
  density: 0.5,
  flicker: 0.5,
  scatter: 0.5,
  dotSize: 1,
}

export const STYLE_DEFAULTS: Record<HeadStyle, HeadConfig> = {
  lattice: {
    ...APPEARANCE_BASE,
    ...SHAPE_DEFAULTS,
    lighting: 'cinema',
    lightElevation: 40,
    lightFill: 0.06,
    headScale: 0.5,
    headY: -0.8,
    neck: 1,
    colorA: '#999999',
    colorB: '#eeeeee',
    colorC: '#ffffff',
    gain: 1.15,
    bloom: 0,
    density: 0.85,
    cellSize: 1.0,
    cage: 0,
    flicker: 0.35,
  },
  dust: {
    ...APPEARANCE_BASE,
    ...SHAPE_DEFAULTS,
    // Low and large in the frame: a short neck that runs out of it, like the other heads'.
    headScale: 0.43,
    headY: -0.72,
    neck: 1,
    colorA: '#5b2a8a',
    colorB: '#d58cff',
    colorC: '#8fd7ff',
    density: 0.7,
    dotSize: 1,
    scatter: 0.5,
    bloom: 0.35,
    radialBlur: 0.7,
    gain: 1.1,
  },
}

export const DEFAULT_CONFIG: HeadConfig = STYLE_DEFAULTS.lattice
