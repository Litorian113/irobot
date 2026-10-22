import * as THREE from 'three'

/**
 * Colani's truck, parked behind him in profile: a painted cut-out, chrome
 * silver like the real one - the bubble cockpit with its huge wraparound
 * windscreen over a low round nose, the long tanker body rounding off at the
 * back, a side pod along the bottom, a roof rack, the wheels half hidden
 * under the skirts. Cab to the left. Units: the cut-out is WIDTH long; its
 * bottom edge is the ground.
 */

export const TRUCK_WIDTH = 4.4
const W = 2048
const H = 700
/** The ground line on the canvas. */
const GROUND = 660

function draw(ctx: CanvasRenderingContext2D) {
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'

  // A soft shadow on the ground.
  const shadow = ctx.createRadialGradient(1020, GROUND, 40, 1020, GROUND, 1000)
  shadow.addColorStop(0, 'rgba(40,50,60,0.35)')
  shadow.addColorStop(1, 'rgba(40,50,60,0)')
  ctx.save()
  ctx.scale(1, 0.05)
  ctx.fillStyle = shadow
  ctx.beginPath()
  ctx.arc(1020, GROUND / 0.05, 1000, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()

  // Wheels first: the skirts hide their upper halves.
  for (const x of [330, 1260, 1420]) {
    ctx.fillStyle = '#1d2024'
    ctx.beginPath()
    ctx.arc(x, GROUND - 62, 62, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#9aa2aa'
    ctx.beginPath()
    ctx.arc(x, GROUND - 62, 30, 0, Math.PI * 2)
    ctx.fill()
  }

  // The body: one flowing outline, nose to tail.
  const body = new Path2D()
  body.moveTo(130, 610)
  body.bezierCurveTo(40, 600, 20, 520, 62, 470)
  body.bezierCurveTo(92, 432, 108, 400, 118, 360)
  body.bezierCurveTo(140, 250, 236, 168, 384, 148)
  body.bezierCurveTo(470, 138, 556, 146, 606, 172)
  body.bezierCurveTo(650, 158, 700, 150, 770, 150)
  body.lineTo(1830, 150)
  body.bezierCurveTo(1964, 150, 2014, 262, 2004, 384)
  body.bezierCurveTo(1998, 500, 1952, 598, 1862, 610)
  body.closePath()
  const chrome = ctx.createLinearGradient(0, 140, 0, 620)
  chrome.addColorStop(0, '#f4f6f8')
  chrome.addColorStop(0.18, '#d9dfe4')
  chrome.addColorStop(0.42, '#8e979f')
  chrome.addColorStop(0.55, '#c3cad0')
  chrome.addColorStop(0.78, '#e9edf0')
  chrome.addColorStop(1, '#6f777e')
  ctx.fillStyle = chrome
  ctx.fill(body)
  ctx.strokeStyle = 'rgba(60,68,76,0.6)'
  ctx.lineWidth = 4
  ctx.stroke(body)

  // Reflections running the length of the body.
  ctx.save()
  ctx.clip(body)
  ctx.strokeStyle = 'rgba(255,255,255,0.75)'
  ctx.lineWidth = 7
  ctx.beginPath()
  ctx.moveTo(640, 236)
  ctx.bezierCurveTo(1100, 228, 1600, 226, 1960, 246)
  ctx.stroke()
  ctx.strokeStyle = 'rgba(70,80,90,0.35)'
  ctx.lineWidth = 16
  ctx.beginPath()
  ctx.moveTo(620, 360)
  ctx.bezierCurveTo(1100, 352, 1600, 350, 2010, 368)
  ctx.stroke()
  ctx.restore()

  // The side pod along the bottom, between the axles.
  const pod = new Path2D()
  pod.moveTo(560, 470)
  pod.bezierCurveTo(540, 470, 520, 520, 540, 560)
  pod.lineTo(1880, 560)
  pod.bezierCurveTo(1940, 560, 1960, 480, 1900, 470)
  pod.closePath()
  const podShade = ctx.createLinearGradient(0, 470, 0, 560)
  podShade.addColorStop(0, '#eef1f3')
  podShade.addColorStop(0.5, '#a9b1b8')
  podShade.addColorStop(1, '#7c858d')
  ctx.fillStyle = podShade
  ctx.fill(pod)
  ctx.strokeStyle = 'rgba(60,68,76,0.5)'
  ctx.lineWidth = 3
  ctx.stroke(pod)

  // The wraparound windscreen: dark glass with a sky reflection.
  const glass = new Path2D()
  glass.moveTo(84, 452)
  glass.bezierCurveTo(108, 372, 160, 262, 288, 200)
  glass.bezierCurveTo(372, 164, 470, 160, 540, 178)
  glass.bezierCurveTo(520, 250, 500, 300, 470, 336)
  glass.bezierCurveTo(330, 334, 200, 384, 140, 456)
  glass.closePath()
  const tint = ctx.createLinearGradient(80, 180, 520, 460)
  tint.addColorStop(0, '#3b5470')
  tint.addColorStop(0.5, '#121c27')
  tint.addColorStop(1, '#25384c')
  ctx.fillStyle = tint
  ctx.fill(glass)
  ctx.strokeStyle = '#9aa3ab'
  ctx.lineWidth = 6
  ctx.stroke(glass)
  ctx.save()
  ctx.clip(glass)
  ctx.strokeStyle = 'rgba(210,230,250,0.45)'
  ctx.lineWidth = 22
  ctx.beginPath()
  ctx.moveTo(150, 410)
  ctx.bezierCurveTo(220, 290, 330, 220, 500, 200)
  ctx.stroke()
  ctx.restore()

  // The cab's door seam, the nose's headlight, a mirror on its stalk.
  ctx.strokeStyle = 'rgba(60,68,76,0.55)'
  ctx.lineWidth = 4
  ctx.beginPath()
  ctx.moveTo(660, 176)
  ctx.bezierCurveTo(690, 300, 690, 420, 640, 560)
  ctx.stroke()
  ctx.fillStyle = '#fff6d0'
  ctx.beginPath()
  ctx.ellipse(70, 524, 22, 9, -0.25, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = '#8a939b'
  ctx.lineWidth = 6
  ctx.beginPath()
  ctx.moveTo(300, 196)
  ctx.lineTo(262, 150)
  ctx.stroke()
  ctx.fillStyle = '#c9d0d6'
  ctx.beginPath()
  ctx.ellipse(254, 140, 16, 26, 0.3, 0, Math.PI * 2)
  ctx.fill()

  // The roof rack along the tank.
  ctx.strokeStyle = '#b8c0c7'
  ctx.lineWidth = 7
  ctx.beginPath()
  ctx.moveTo(880, 122)
  ctx.lineTo(1800, 122)
  ctx.stroke()
  ctx.lineWidth = 5
  for (let x = 900; x <= 1780; x += 110) {
    ctx.beginPath()
    ctx.moveTo(x, 124)
    ctx.lineTo(x + 10, 150)
    ctx.stroke()
  }
}

/** The cut-out: a plane whose bottom edge stands on the ground, lit by nothing but its paint. */
export function colaniTruck() {
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  draw(canvas.getContext('2d')!)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 4
  const height = TRUCK_WIDTH * H / W
  const geometry = new THREE.PlaneGeometry(TRUCK_WIDTH, height)
  // The canvas's ground line at y = 0.
  geometry.translate(0, height / 2 - (H - GROUND) / H * height, 0)
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false }))
  return { mesh, texture }
}
