/**
 * C.O.L.A.N.I.'s prints, drawn on canvases like the pad printing on a real
 * minifigure: Luigi Colani's face on the yellow head, the white sweater with
 * its scarf on the torso. Flat colours, black outlines, white highlights.
 */

/**
 * The head canvas wraps once around the head; the face sits in the middle
 * (u = 0.5). Its height follows the length of the head's outline, so a head
 * unit is faceScale(radius) pixels across and down alike.
 */
export const FACE_WIDTH = 1024
export const faceScale = (radius: number) => FACE_WIDTH / (2 * Math.PI * radius)

export interface FaceState {
  /** 0 neutral, 1 a broad grin with squinting eyes. */
  happy: number
  /** One brow up, that eye wide open. */
  curious: number
  blink: boolean
}

const INK = '#1b1410'
const MOUSTACHE = '#4a2e1c'
const MOUSTACHE_LIGHT = '#8b6a52'
const LINE = 'rgba(120, 70, 10, 0.55)'

export function drawFace(ctx: CanvasRenderingContext2D, state: FaceState, scale: number) {
  const { width: w, height: h } = ctx.canvas
  /** Head units (x right, y up, 0 at the face's centre) to canvas pixels. */
  const px = (x: number, y: number): [number, number] => [w / 2 + x * scale, h / 2 - y * scale]
  ctx.fillStyle = '#f2c81d'
  ctx.fillRect(0, 0, w, h)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  const happy = state.happy > 0.5
  const curious = !happy && state.curious > 0.5

  // Brows: thin, grey-brown, raised in the middle - his slightly amused look.
  for (const side of [-1, 1]) {
    const up = curious && side > 0 ? 0.05 : 0
    const [x0, y0] = px(side * 0.07, 0.15 + up)
    const [x1, y1] = px(side * 0.13, 0.18 + up)
    const [x2, y2] = px(side * 0.2, 0.14 + up * 0.6)
    ctx.strokeStyle = '#5c4a3e'
    ctx.lineWidth = 6
    ctx.beginPath()
    ctx.moveTo(x0, y0)
    ctx.quadraticCurveTo(x1, y1, x2, y2)
    ctx.stroke()
  }

  // Eyes: heavy, half-closed lids; a grin squeezes them to arcs, a blink to lines.
  for (const side of [-1, 1]) {
    const [ex, ey] = px(side * 0.13, 0.065)
    ctx.strokeStyle = INK
    ctx.fillStyle = INK
    if (state.blink || happy) {
      ctx.lineWidth = 5
      ctx.beginPath()
      if (happy) ctx.arc(ex, ey + 6, 13, Math.PI * 1.15, Math.PI * 1.85)
      else { ctx.moveTo(ex - 13, ey + 2); ctx.quadraticCurveTo(ex, ey + 7, ex + 13, ey + 2) }
      ctx.stroke()
    } else {
      const wide = curious && side > 0
      // The pupil, cut off by the lid above it.
      ctx.save()
      ctx.beginPath()
      ctx.rect(ex - 20, ey - (wide ? 14 : 4), 40, 40)
      ctx.clip()
      ctx.beginPath()
      ctx.ellipse(ex, ey + 2, 9, 11, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
      ctx.fillStyle = '#ffffff'
      ctx.beginPath()
      ctx.arc(ex + 3, ey + (wide ? -4 : 1), 2.6, 0, Math.PI * 2)
      ctx.fill()
      // The lid line.
      ctx.lineWidth = 4.5
      ctx.beginPath()
      ctx.moveTo(ex - 15, ey - (wide ? 12 : 2))
      ctx.quadraticCurveTo(ex, ey - (wide ? 20 : 8), ex + 15, ey - (wide ? 12 : 2))
      ctx.stroke()
    }
    // Bags and crow's feet: a life of cigars and long nights at the drawing board.
    ctx.strokeStyle = LINE
    ctx.lineWidth = 2.5
    ctx.beginPath()
    ctx.moveTo(ex - 11, ey + 17)
    ctx.quadraticCurveTo(ex, ey + 22, ex + 11, ey + 17)
    for (const k of [-1, 0, 1]) {
      ctx.moveTo(ex + side * 20, ey + k * 6)
      ctx.lineTo(ex + side * 29, ey + k * 9)
    }
    ctx.stroke()
  }

  // Nose: a curve and two nostrils.
  {
    const [nx, ny] = px(0, -0.02)
    ctx.strokeStyle = INK
    ctx.lineWidth = 4
    ctx.beginPath()
    ctx.moveTo(nx - 9, ny - 2)
    ctx.quadraticCurveTo(nx, ny + 7, nx + 9, ny - 2)
    ctx.stroke()
  }

  // Mouth under the moustache: a small smile, a broad grin when happy.
  {
    const [mx, my] = px(0, -0.135)
    ctx.strokeStyle = INK
    ctx.fillStyle = INK
    ctx.lineWidth = 4
    ctx.beginPath()
    if (happy) {
      ctx.moveTo(mx - 34, my - 4)
      ctx.quadraticCurveTo(mx, my + 34, mx + 34, my - 4)
      ctx.closePath()
      ctx.fill()
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(mx - 22, my - 2, 44, 7)
    } else {
      ctx.moveTo(mx - 20, my)
      ctx.quadraticCurveTo(mx, my + 10, mx + 20, my)
      ctx.stroke()
    }
    // Lines from the nose to the mouth corners.
    ctx.strokeStyle = LINE
    ctx.lineWidth = 3
    ctx.beginPath()
    for (const side of [-1, 1]) {
      ctx.moveTo(mx + side * 22, my - 44)
      ctx.quadraticCurveTo(mx + side * 44, my - 20, mx + side * (happy ? 44 : 38), my + 8)
    }
    ctx.stroke()
  }

  // The moustache: huge, drooping past the mouth corners down to the chin, grey in its brown.
  {
    const [cx, cy] = px(0, -0.075)
    const wing = (side: number) => {
      ctx.moveTo(cx, cy - 6)
      ctx.bezierCurveTo(cx + side * 26, cy - 14, cx + side * 50, cy - 6, cx + side * 58, cy + 18)
      ctx.bezierCurveTo(cx + side * 64, cy + 40, cx + side * 62, cy + 66, cx + side * 54, cy + 84)
      ctx.bezierCurveTo(cx + side * 46, cy + 70, cx + side * 44, cy + 40, cx + side * 34, cy + 20)
      ctx.bezierCurveTo(cx + side * 22, cy + 10, cx + side * 8, cy + 12, cx, cy + 12)
    }
    ctx.fillStyle = MOUSTACHE
    ctx.strokeStyle = INK
    ctx.lineWidth = 3.5
    for (const side of [-1, 1]) {
      ctx.beginPath()
      wing(side)
      ctx.closePath()
      ctx.fill()
      ctx.stroke()
    }
    // Strands: lighter, grey-brown, combed outwards and down.
    ctx.strokeStyle = MOUSTACHE_LIGHT
    ctx.lineWidth = 2.5
    for (const side of [-1, 1]) {
      for (let k = 0; k < 4; k++) {
        ctx.beginPath()
        ctx.moveTo(cx + side * (8 + k * 9), cy + 2 - k)
        ctx.quadraticCurveTo(cx + side * (30 + k * 6), cy + 2 + k * 2, cx + side * (46 + k * 3), cy + 24 + k * 14)
        ctx.stroke()
      }
    }
  }

  // A cleft in the chin.
  {
    const [cx, cy] = px(0, -0.24)
    ctx.strokeStyle = LINE
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.moveTo(cx - 10, cy)
    ctx.quadraticCurveTo(cx, cy + 5, cx + 10, cy)
    ctx.stroke()
  }
}

/** The torso's front: a white knitted turtleneck sweater and a white silk scarf, tied and hanging. */
export const TORSO_SIZE = { w: 512, h: 512 }

export function drawTorso(ctx: CanvasRenderingContext2D) {
  const { w, h } = TORSO_SIZE
  ctx.fillStyle = '#f3f1ea'
  ctx.fillRect(0, 0, w, h)
  // Knit: fine ribs.
  ctx.strokeStyle = 'rgba(150, 145, 130, 0.12)'
  ctx.lineWidth = 2
  for (let x = 6; x < w; x += 12) {
    ctx.beginPath()
    for (let y = 0; y <= h; y += 16) {
      ctx.lineTo(x + (y / 16) % 2 * 3, y)
    }
    ctx.stroke()
  }
  // The scarf: a knot under the collar, two ends hanging down to the left.
  ctx.lineJoin = 'round'
  ctx.fillStyle = '#fbfaf6'
  ctx.strokeStyle = '#6f6a60'
  ctx.lineWidth = 5
  const shape = (points: number[]) => {
    ctx.beginPath()
    ctx.moveTo(points[0], points[1])
    for (let i = 2; i < points.length; i += 6) ctx.bezierCurveTo(points[i], points[i + 1], points[i + 2], points[i + 3], points[i + 4], points[i + 5])
    ctx.closePath()
    ctx.fill()
    ctx.stroke()
  }
  shape([228, 110, 210, 200, 190, 300, 170, 440, 200, 450, 236, 440, 252, 440, 256, 310, 262, 200, 262, 115])
  shape([258, 110, 290, 190, 300, 270, 318, 390, 296, 410, 276, 410, 262, 406, 262, 290, 252, 200, 245, 118])
  shape([196, 26, 230, 16, 290, 16, 320, 28, 302, 90, 272, 120, 250, 120, 220, 115, 204, 80, 196, 26])
  // Folds.
  ctx.strokeStyle = 'rgba(140, 135, 125, 0.6)'
  ctx.lineWidth = 3
  for (const [x0, y0, x1, y1, x2, y2] of [[225, 150, 210, 270, 200, 410], [270, 160, 280, 270, 292, 380], [232, 52, 255, 74, 292, 58]]) {
    ctx.beginPath()
    ctx.moveTo(x0, y0)
    ctx.quadraticCurveTo(x1, y1, x2, y2)
    ctx.stroke()
  }
}
