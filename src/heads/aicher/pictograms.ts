/**
 * Sport pictograms after Otl Aicher's rules for Munich 1972: limbs are bars
 * at 0, 45 or 90 degrees with square ends, the torso a heavier bar, the head
 * a circle with air around it, everything in a square field. Our own figures,
 * not the 1972 set.
 *
 * Drawn once into an atlas for the wall shader: red holds the figures, green
 * the square frames and the numbers under them, as on a sheet of the manual.
 */

/** A turn of the pen: direction in eighths (0 right, 2 down, 4 left, 6 up) and length. */
type Step = [dir: number, length: number]
type Point = [number, number]

/** A limb from the shoulder or the hip, optionally starting a little off it. */
interface Limb {
  from: 'shoulder' | 'hip'
  steps: Step[]
  offset?: Point
}

interface Figure {
  /** Shoulder, and the torso from it down to the hip. */
  shoulder: Point
  torso: Step
  limbs: Limb[]
  /** Props, given the figure's joints and hands; returns the points they reach, for centring. */
  props?: (ctx: CanvasRenderingContext2D, ends: Point[]) => Point[]
}

const DIRS: Point[] = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]].map(([x, y]) => {
  const l = Math.hypot(x, y)
  return [x / l, y / l]
})

const LIMB = 0.085
const TORSO = 0.15
const HEAD = 0.075
/** From the shoulder to the head's centre: radius plus air. */
const NECK = 0.155
/** Arms start a little down the torso, clear of the head. */
const SHOULDER_DROP = 0.04
const THIN = 0.032

const arm = (steps: Step[], offset?: Point): Limb => ({ from: 'shoulder', steps, offset })
const leg = (steps: Step[], offset?: Point): Limb => ({ from: 'hip', steps, offset })

const bar = (ctx: CanvasRenderingContext2D, width: number, points: Point[]) => {
  ctx.lineWidth = width
  ctx.beginPath()
  ctx.moveTo(...points[0])
  for (const p of points.slice(1)) ctx.lineTo(...p)
  ctx.stroke()
}
const disc = (ctx: CanvasRenderingContext2D, [x, y]: Point, r: number) => {
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.fill()
}
const ring = (ctx: CanvasRenderingContext2D, [x, y]: Point, r: number) => {
  ctx.lineWidth = THIN
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.stroke()
}
const along = ([x, y]: Point, dir: number, length: number): Point => [x + DIRS[dir][0] * length, y + DIRS[dir][1] * length]

const FIGURES: Figure[] = [
  // sprint
  {
    shoulder: [0.55, 0.3], torso: [3, 0.24],
    limbs: [arm([[1, 0.15], [0, 0.11]]), leg([[0, 0.18], [2, 0.18]]), leg([[3, 0.34]])],
  },
  // swimming
  {
    shoulder: [0.6, 0.48], torso: [4, 0.26],
    limbs: [arm([[6, 0.17], [0, 0.24]]), leg([[4, 0.24]])],
    props: (ctx) => {
      ctx.lineWidth = THIN
      for (let row = 0; row < 3; row++) {
        ctx.beginPath()
        for (let i = 0; i <= 90; i++) {
          const x = 0.06 + i * 0.01, y = 0.62 + row * 0.08 + Math.sin(x * 25) * 0.016
          if (i === 0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        }
        ctx.stroke()
      }
      return [[0.06, 0.62], [0.96, 0.8]]
    },
  },
  // cycling
  {
    shoulder: [0.6, 0.32], torso: [3, 0.22],
    limbs: [arm([[1, 0.22]]), leg([[1, 0.17], [2, 0.14]])],
    props: (ctx) => {
      ring(ctx, [0.27, 0.72], 0.16)
      ring(ctx, [0.8, 0.72], 0.16)
      return [[0.1, 0.55], [0.97, 0.89]]
    },
  },
  // basketball
  {
    shoulder: [0.48, 0.38], torso: [2, 0.24],
    limbs: [arm([[7, 0.2], [6, 0.1]]), arm([[3, 0.16], [2, 0.1]]), leg([[1, 0.2], [2, 0.14]]), leg([[3, 0.2], [2, 0.14]])],
    props: (ctx, [hand]) => {
      const ball = along(hand, 7, 0.1)
      disc(ctx, ball, 0.065)
      return [[ball[0] + 0.065, ball[1] - 0.065]]
    },
  },
  // rowing
  {
    shoulder: [0.3, 0.36], torso: [2, 0.24],
    limbs: [arm([[0, 0.28]]), leg([[0, 0.28]])],
    props: (ctx, [hand]) => {
      bar(ctx, THIN, [along(hand, 5, 0.07), along(hand, 1, 0.45)])
      bar(ctx, 0.06, [[0.12, 0.7], [0.82, 0.7]])
      return [[0.12, 0.7], along(hand, 1, 0.45)]
    },
  },
  // javelin
  {
    shoulder: [0.55, 0.32], torso: [3, 0.23],
    limbs: [arm([[4, 0.16], [5, 0.12]]), arm([[1, 0.17]]), leg([[1, 0.34]]), leg([[3, 0.18], [2, 0.15]])],
    props: (ctx, [hand]) => {
      const tail = along(hand, 3, 0.18), tip = along(hand, 7, 0.55)
      bar(ctx, THIN, [tail, tip])
      return [tail, tip]
    },
  },
  // fencing
  {
    shoulder: [0.38, 0.36], torso: [2, 0.23],
    limbs: [arm([[0, 0.19]]), arm([[4, 0.11], [5, 0.11]]), leg([[1, 0.2], [2, 0.15]]), leg([[3, 0.34]])],
    props: (ctx, [hand]) => {
      const tip = along(hand, 0, 0.33)
      bar(ctx, THIN, [hand, tip])
      return [tip]
    },
  },
  // football
  {
    shoulder: [0.4, 0.3], torso: [2, 0.24],
    limbs: [arm([[3, 0.18]]), arm([[0, 0.17]]), leg([[1, 0.34]]), leg([[3, 0.19], [2, 0.15]])],
    props: (ctx, [, , foot]) => {
      const ball = [foot[0] + 0.1, foot[1] + 0.04] as Point
      disc(ctx, ball, 0.065)
      return [[ball[0] + 0.065, ball[1] + 0.065]]
    },
  },
  // weightlifting
  {
    shoulder: [0.5, 0.44], torso: [2, 0.22],
    limbs: [arm([[4, 0.15], [6, 0.32]]), arm([[0, 0.15], [6, 0.32]]), leg([[3, 0.3]]), leg([[1, 0.3]])],
    props: (ctx, [left]) => {
      const y = left[1]
      bar(ctx, 0.045, [[0.12, y], [0.88, y]])
      ctx.fillRect(0.15, y - 0.11, 0.06, 0.22)
      ctx.fillRect(0.79, y - 0.11, 0.06, 0.22)
      return [[0.12, y - 0.11], [0.88, y + 0.11]]
    },
  },
  // rings
  {
    shoulder: [0.5, 0.4], torso: [2, 0.25],
    limbs: [arm([[4, 0.26]]), arm([[0, 0.26]]), leg([[2, 0.3]], [-0.05, 0]), leg([[2, 0.3]], [0.05, 0])],
    props: (ctx, [left, right]) => {
      for (const hand of [left, right]) {
        const centre: Point = [hand[0], hand[1] - 0.075]
        ring(ctx, centre, 0.05)
        bar(ctx, THIN, [[hand[0], centre[1] - 0.05], [hand[0], 0.04]])
      }
      return [[left[0] - 0.05, 0.04], [right[0] + 0.05, 0.04]]
    },
  },
  // archery
  {
    shoulder: [0.38, 0.36], torso: [2, 0.24],
    limbs: [arm([[0, 0.28]]), arm([[4, 0.12], [3, 0.08]]), leg([[3, 0.32]]), leg([[1, 0.32]])],
    props: (ctx, [hand]) => {
      ctx.lineWidth = THIN
      ctx.beginPath()
      ctx.arc(hand[0] - 0.12, hand[1], 0.24, -1.05, 1.05)
      ctx.stroke()
      const top: Point = [hand[0] - 0.12 + 0.24 * Math.cos(1.05), hand[1] - 0.24 * Math.sin(1.05)]
      bar(ctx, THIN, [top, [top[0], hand[1] + (hand[1] - top[1])]])
      return [[hand[0] + 0.13, hand[1] - 0.21], [hand[0] + 0.13, hand[1] + 0.21]]
    },
  },
  // hurdles
  {
    shoulder: [0.4, 0.28], torso: [2, 0.24],
    limbs: [arm([[0, 0.22]]), arm([[3, 0.16]]), leg([[0, 0.34]]), leg([[4, 0.16], [2, 0.13]])],
    props: (ctx, [, , foot]) => {
      const y = foot[1] + 0.13
      bar(ctx, 0.045, [[foot[0] - 0.24, y], [foot[0] + 0.02, y]])
      bar(ctx, THIN, [[foot[0] - 0.21, y], [foot[0] - 0.21, y + 0.27]])
      bar(ctx, THIN, [[foot[0] - 0.01, y], [foot[0] - 0.01, y + 0.27]])
      return [[foot[0] - 0.24, y + 0.27]]
    },
  },
  // tennis
  {
    shoulder: [0.42, 0.34], torso: [2, 0.24],
    limbs: [arm([[0, 0.11], [7, 0.12]]), arm([[3, 0.16], [2, 0.1]]), leg([[3, 0.32]]), leg([[1, 0.19], [2, 0.14]])],
    props: (ctx, [hand]) => {
      const neck = along(hand, 7, 0.09)
      bar(ctx, THIN, [hand, neck])
      ctx.save()
      ctx.translate(...along(neck, 7, 0.09))
      ctx.rotate(-Math.PI / 4)
      ctx.lineWidth = THIN
      ctx.beginPath()
      ctx.ellipse(0, 0, 0.1, 0.07, 0, 0, Math.PI * 2)
      ctx.stroke()
      ctx.restore()
      const ball: Point = [0.85, 0.2]
      disc(ctx, ball, 0.035)
      return [along(neck, 7, 0.2), [ball[0] + 0.035, ball[1]]]
    },
  },
  // canoe
  {
    shoulder: [0.42, 0.36], torso: [2, 0.24],
    limbs: [arm([[0, 0.17]])],
    props: (ctx, [hand]) => {
      // The paddle through the hand, its blade in the water behind the hull.
      const top = along(hand, 7, 0.16), end = along(hand, 3, 0.44)
      bar(ctx, THIN, [top, end])
      bar(ctx, 0.07, [along(end, 7, 0.03), along(end, 3, 0.08)])
      ctx.beginPath()
      ctx.moveTo(0.1, 0.58)
      ctx.lineTo(0.9, 0.58)
      ctx.lineTo(0.8, 0.67)
      ctx.lineTo(0.2, 0.67)
      ctx.closePath()
      ctx.fill()
      return [[0.1, 0.58], [0.9, 0.67], top, along(end, 3, 0.08)]
    },
  },
  // shot put
  {
    shoulder: [0.45, 0.38], torso: [2, 0.24],
    limbs: [arm([[7, 0.27]]), arm([[4, 0.18]]), leg([[3, 0.32]]), leg([[1, 0.2], [2, 0.13]])],
    props: (ctx, [hand]) => {
      const ball = along(hand, 7, 0.07)
      disc(ctx, ball, 0.06)
      return [[ball[0] + 0.06, ball[1] - 0.06]]
    },
  },
]

export const PICTOGRAMS = FIGURES.length
/** The atlas is a square of ATLAS_CELLS x ATLAS_CELLS cells. */
export const ATLAS_CELLS = 4
const CELL = 256

/** All points of a polyline of steps from `start`. */
function walk(start: Point, steps: Step[]) {
  const points: Point[] = [start]
  for (const [dir, length] of steps) points.push(along(points[points.length - 1], dir, length))
  return points
}

/** Draws a figure; returns its extent, so it can be centred in its field. */
function drawFigure(ctx: CanvasRenderingContext2D, figure: Figure) {
  ctx.lineCap = 'butt'
  ctx.lineJoin = 'miter'
  const shoulder = figure.shoulder
  const hip = along(shoulder, ...figure.torso)
  const [dx, dy] = DIRS[figure.torso[0]]
  const head: Point = [shoulder[0] - dx * NECK, shoulder[1] - dy * NECK]
  disc(ctx, head, HEAD)
  bar(ctx, TORSO, [shoulder, hip])
  const reach: Point[] = [[head[0] - HEAD, head[1] - HEAD], [head[0] + HEAD, head[1] + HEAD], shoulder, hip]
  const ends: Point[] = []
  for (const limb of figure.limbs) {
    const base: Point = limb.from === 'shoulder' ? [shoulder[0] + dx * SHOULDER_DROP, shoulder[1] + dy * SHOULDER_DROP] : hip
    const points = walk([base[0] + (limb.offset?.[0] ?? 0), base[1] + (limb.offset?.[1] ?? 0)], limb.steps)
    bar(ctx, LIMB, points)
    reach.push(...points)
    ends.push(points[points.length - 1])
  }
  reach.push(...(figure.props?.(ctx, ends) ?? []))
  return reach
}

/** Where the figure's extent sits in its field: the shift that centres it. */
function centring(figure: Figure) {
  const probe = document.createElement('canvas').getContext('2d')!
  const reach = drawFigure(probe, figure)
  const xs = reach.map((p) => p[0]), ys = reach.map((p) => p[1])
  return [0.5 - (Math.min(...xs) + Math.max(...xs)) / 2, 0.5 - (Math.min(...ys) + Math.max(...ys)) / 2]
}

/**
 * The atlas canvas: per cell a square frame with its figure and a number
 * below it. Red: figure. Green: frame and number.
 */
export function pictogramAtlas() {
  const size = CELL * ATLAS_CELLS
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, size, size)
  ctx.globalCompositeOperation = 'lighter'
  // The frame square inside a cell, in pixels; the number goes below it.
  const frame = { x: 22, y: 14, size: 196 }
  FIGURES.forEach((figure, i) => {
    const x = (i % ATLAS_CELLS) * CELL, y = Math.floor(i / ATLAS_CELLS) * CELL
    ctx.save()
    ctx.translate(x + frame.x, y + frame.y)
    ctx.strokeStyle = ctx.fillStyle = '#00ff00'
    ctx.lineWidth = 2
    ctx.strokeRect(0, 0, frame.size, frame.size)
    ctx.font = 'italic 17px Helvetica, Arial, sans-serif'
    ctx.fillText(String(29 + i), 1, frame.size + 22)
    // The figure, centred in its field with a margin.
    const [cx, cy] = centring(figure)
    ctx.translate(12, 12)
    ctx.scale(frame.size - 24, frame.size - 24)
    ctx.translate(cx, cy)
    ctx.strokeStyle = ctx.fillStyle = '#ff0000'
    drawFigure(ctx, figure)
    ctx.restore()
  })
  return canvas
}
