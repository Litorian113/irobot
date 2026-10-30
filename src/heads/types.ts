import type { Expression } from '../viki/ParticleFace'

export type { Expression }

/** What every head on the wall must be able to do. A new head is any class with these methods. */
export interface HeadView {
  /** Where to look: yaw > 0 turns the face to screen-right, pitch > 0 looks up (radians). */
  setLook(yaw: number, pitch: number): void
  setExpression(expression: Expression): void
  /** Dev aid; `webgl` and `renderedFps` are shown with `?stats=1` and in the preview. */
  debug(): { webgl: number; renderedFps: number } & Record<string, unknown>
  dispose(): void
}

export interface HeadViewOptions {
  /** Upper frame rate; several heads on one page share the GPU. */
  fps?: number
  maxPixelRatio?: number
  /** Gaze spring (rad/s) and reaction lag (s). */
  stiffness?: number
  delay?: number
  /** Render with WebGL 1 even where WebGL 2 exists, as on the 2009/2010 iMacs. */
  webgl1?: boolean
}

export type CreateHead = (canvas: HTMLCanvasElement, options: HeadViewOptions) => HeadView

/** The filter above every list of heads. A head can be in several: C.O.L.A.N.I. is a designer made of blocks. */
export type HeadCategory = 'designer' | 'roboter' | 'gruselig' | 'bloecke' | 'kunst'

export interface HeadDesign {
  id: number
  name: string
  categories: HeadCategory[]
  description: string
  /**
   * Screen of the wall this head will live on (0 top-left ... 8 bottom-right, 4 is the promo).
   * null: not on the main wall - in the list and for custom walls only.
   */
  slot: number | null
  /** null while this head is still to be built. */
  create: CreateHead | null
}
