import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { GazeSpring } from '../GazeSpring'
import type { Expression, HeadView, HeadViewOptions } from '../types'
import { BALL_VERTEX, CHEEK_FRAGMENT, EYE_FRAGMENT, MASK_FRAGMENT, MASK_VERTEX, PASS_VERTEX, ROOM_FRAGMENT } from './shaders'

/**
 * B.I.L.L.Y. - the ventriloquist's puppet out of a horror film: a cracked
 * papier-mache mask with heavy brows and a long nose, red eyes glowing in black
 * sockets, red spirals on its cheeks, a red bow tie. The chin is a separate
 * block that drops on its slots as he talks and cackles; the bare bulb above
 * him fails now and then, and only the eyes stay lit.
 * WebGL 1 safe: a displaced mesh with baked paint, plain GLSL ES 1.0.
 */

const FOV = 30
const CAM = new THREE.Vector3(0, -0.06, 4.75)
const LOOK = new THREE.Vector3(0, -0.17, 0)
/** The mask's half-widths: narrower above the eyes' line, longer below it. */
const A = 0.69
const C = 0.6
const TOP = 0.84
const BOTTOM = 1.06
const KEY = new THREE.Vector3(-0.22, 0.62, 0.75).normalize()
const CHEEK_R = 0.215
const EYE_R = 0.112
const EYE = new THREE.Vector3(0.25, 0.145, 0.4)
const CHIN_Y = -0.665
const CHIN_DROP = 0.17

const MOODS: Record<Expression, { laugh: number; ajar: number; tilt: number; pupil: number }> = {
  neutral: { laugh: 0, ajar: 0, tilt: 0, pupil: 0.3 },
  curious: { laugh: 0, ajar: 0.22, tilt: 0.13, pupil: 0.2 },
  happy: { laugh: 1, ajar: 0.1, tilt: -0.04, pupil: 0.36 },
}
/** Now and then he says his line (seconds): chin going in syllables. */
const SPEAK_EVERY = [10, 22]
const SPEAK_LENGTH = 2.6
/** The bulb fails (seconds). */
const FLICKER_EVERY = [7, 18]
const FLICKER_LENGTH = 0.9

const between = ([lo, hi]: number[]) => lo + Math.random() * (hi - lo)
const noise = (step: number, channel: number) => {
  const x = Math.sin(step * 127.1 + channel * 311.7) * 43758.5453
  return x - Math.floor(x)
}
const smoothstep = (a: number, b: number, x: number) => {
  const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1)
  return t * t * (3 - 2 * t)
}
const gauss = (d: number) => Math.exp(-d * d)
/** Distance from a point to a segment, measured in widths. */
function segment(x: number, y: number, ax: number, ay: number, bx: number, by: number, w: number) {
  const dx = bx - ax, dy = by - ay
  const t = THREE.MathUtils.clamp(((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy), 0, 1)
  return Math.hypot(x - ax - dx * t, y - ay - dy * t) / w
}

/** How far the mask stands out from its plain egg at (x, y); left and right alike, nearly. */
function relief(px: number, y: number) {
  const x = Math.abs(px)
  let h = 0
  // The brows: thick ridges, low at the nose, rising outward - a permanent scowl.
  h += 0.115 * gauss(segment(x, y, 0.075, 0.245, 0.31, 0.335, 0.066))
  h += 0.06 * gauss(segment(x, y, 0.31, 0.335, 0.54, 0.22, 0.07))
  // The knot between them and the dome of the forehead, with its dent down the middle.
  h += 0.05 * gauss(Math.hypot(x / 0.075, (y - 0.42) / 0.14))
  h -= 0.008 * gauss(x / 0.03) * smoothstep(0.42, 0.56, y)
  h += 0.03 * gauss(Math.hypot((x - 0.2) / 0.18, (y - 0.58) / 0.13))
  // The sockets: dug in under the brows.
  h -= 0.13 * gauss(Math.hypot((x - 0.245) / 0.135, (y - 0.14) / 0.1))
  // The long nose, swelling down to a blunt tip, then cut off above the lip.
  const along = THREE.MathUtils.clamp((0.25 - y) / 0.54, 0, 1)
  const nose = (0.05 + 0.25 * along ** 1.15) * gauss(x / (0.07 + 0.036 * along)) * (1 - smoothstep(0.2, 0.32, y)) * smoothstep(-0.325, -0.26, y)
  h += nose
  // Nostril wings, and the grooves running from them to the mouth's corners.
  h += 0.05 * gauss(Math.hypot((x - 0.1) / 0.05, (y + 0.23) / 0.05))
  h -= 0.035 * gauss(segment(x, y, 0.15, -0.1, 0.29, -0.3, 0.05))
  // Hollow under the cheeks; a heavy upper lip, curling up at its ends.
  h -= 0.035 * gauss(Math.hypot((x - 0.38) / 0.12, (y + 0.3) / 0.14))
  h += 0.05 * gauss(segment(x, y, 0, -0.37, 0.31, -0.345, 0.036))
  // The jowls either side of the chin.
  h += 0.03 * gauss(Math.hypot((x - 0.34) / 0.1, (y + 0.55) / 0.16))
  // A little asymmetry: it was made by hand.
  h += 0.006 * Math.sin(px * 9 + y * 5) + 0.004 * Math.sin(px * 21 - y * 17)
  return h
}

/** The mask: an egg pushed out by the relief. uv holds its plan position for the cuts and the print. */
function maskGeometry() {
  const cols = 210, rows = 170
  const position: number[] = [], uv: number[] = [], paint: number[] = [], index: number[] = []
  for (let j = 0; j <= rows; j++) {
    const lat = -Math.PI / 2 + (j / rows) * Math.PI
    const b = lat < 0 ? BOTTOM : TOP
    for (let i = 0; i <= cols; i++) {
      const phi = -Math.PI + (i / cols) * Math.PI * 2
      const dx = Math.sin(phi) * Math.cos(lat), dy = Math.sin(lat), dz = Math.cos(phi) * Math.cos(lat)
      const x = A * dx, y = b * dy, z = C * dz
      // Only the front is carved; the back of the head stays a plain egg.
      const front = smoothstep(-0.05, 0.35, dz)
      const h = relief(x, y) * front
      const s = 1 + h / Math.hypot(x, y, z)
      position.push(x * s, y * s, z * s)
      uv.push(x, y)
      // The paint, baked per vertex.
      const ax = Math.abs(x)
      const soot = gauss(Math.hypot((ax - 0.25) / 0.17, (y - 0.14) / 0.122)) * front
      const lipLine = -0.375 + 0.55 * Math.max(ax - 0.12, 0) ** 1.5
      const lips = gauss((y - lipLine) / (0.05 - 0.07 * Math.max(ax - 0.12, 0))) * (1 - smoothstep(0.34, 0.39, ax)) * front
      const e = 0.05
      const mean = (relief(x + e, y) + relief(x - e, y) + relief(x, y + e) + relief(x, y - e)) / 4
      const crown = smoothstep(0.62, 0.86, y) * 0.7 + (1 - smoothstep(-0.45, -0.05, dz)) * 0.8
      paint.push(soot, lips, Math.max(0, mean - relief(x, y)) * 26 + crown)
    }
  }
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const a = j * (cols + 1) + i, b = a + 1, c = a + cols + 1, d = c + 1
      index.push(a, b, c, b, d, c)
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  geometry.setAttribute('aPaint', new THREE.Float32BufferAttribute(paint, 3))
  geometry.setIndex(index)
  geometry.computeVertexNormals()
  return geometry
}

/** The chin block, bulging slightly, dirty round its edges. */
function chinGeometry() {
  const geometry = new RoundedBoxGeometry(0.42, 0.5, 0.26, 8, 0.07)
  const position = geometry.attributes.position as THREE.BufferAttribute
  const uv = new Float32Array(position.count * 2)
  const paint = new Float32Array(position.count * 3)
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i), y = position.getY(i), z = position.getZ(i)
    // Rounded forwards in the middle, tapering to the jaw line.
    const k = 1 - 0.14 * (1 - smoothstep(-0.25, 0.05, y))
    position.setXYZ(i, x * k, y, z - 0.55 * x * x + 0.025 * Math.sin(y * 9))
    uv[i * 2] = x + 0.1
    uv[i * 2 + 1] = y - 0.55
    paint[i * 3 + 2] = smoothstep(0.13, 0.21, Math.abs(x)) * 0.5 + smoothstep(0.17, 0.25, y) * 0.7
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
  geometry.setAttribute('aPaint', new THREE.BufferAttribute(paint, 3))
  geometry.computeVertexNormals()
  return geometry
}

/**
 * Detail on the mask, projected from the front. Red: lumps of old paper for
 * colour and bump. Green: hairline cracks. Blue: rough noise for the torn edges.
 */
function detailTexture() {
  const size = 1024
  // Lumps on a small canvas: scaled up they are soft, at no cost.
  const small = document.createElement('canvas')
  small.width = small.height = 256
  const lumps = small.getContext('2d')!
  lumps.fillStyle = 'rgb(128,0,128)'
  lumps.fillRect(0, 0, 256, 256)
  for (let i = 0; i < 1800; i++) {
    const r = 0.8 + Math.random() ** 2 * 9
    const light = Math.random() < 0.5
    lumps.fillStyle = light ? `rgba(215,0,190,${0.06 + Math.random() * 0.14})` : `rgba(45,0,60,${0.06 + Math.random() * 0.16})`
    lumps.beginPath()
    lumps.ellipse(Math.random() * 256, Math.random() * 256, r, r * (0.4 + Math.random()), Math.random() * 3, 0, Math.PI * 2)
    lumps.fill()
  }
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingEnabled = true
  ctx.drawImage(small, 0, 0, size, size)
  // Fine paper grain over it.
  for (let i = 0; i < 9000; i++) {
    ctx.fillStyle = Math.random() < 0.5 ? 'rgba(255,0,255,0.09)' : 'rgba(0,0,0,0.1)'
    ctx.fillRect(Math.random() * size, Math.random() * size, 1 + Math.random() * 3, 1 + Math.random() * 3)
  }
  // Cracks wander from a few spots, forking as they go.
  ctx.globalCompositeOperation = 'lighter'
  const plan = (x: number, y: number): [number, number] => [(x / 1.7 + 0.5) * size, (0.5 - y / 2.4) * size]
  const crack = (x: number, y: number, angle: number, length: number, width: number) => {
    ctx.strokeStyle = `rgb(0,${Math.floor(120 + width * 70)},0)`
    ctx.lineWidth = width
    ctx.beginPath()
    ctx.moveTo(x, y)
    for (let i = 0; i < length; i++) {
      angle += (Math.random() - 0.5) * 0.9
      x += Math.cos(angle) * 9
      y += Math.sin(angle) * 9
      ctx.lineTo(x, y)
      if (Math.random() < 0.09 && width > 0.8) {
        ctx.stroke()
        crack(x, y, angle + (Math.random() < 0.5 ? 0.8 : -0.8), length * 0.5, width * 0.7)
        ctx.strokeStyle = `rgb(0,${Math.floor(120 + width * 70)},0)`
        ctx.lineWidth = width
        ctx.beginPath()
        ctx.moveTo(x, y)
      }
    }
    ctx.stroke()
  }
  const starts: [number, number, number, number][] = [[0.2, -0.05, 1.2, 24], [0.42, 0.46, 2.3, 18], [-0.4, 0.5, 0.6, 14], [-0.3, -0.42, -1.2, 12], [0.05, 0.72, 1.6, 14], [0.33, -0.5, 1.4, 10]]
  for (const [x, y, angle, length] of starts) crack(...plan(x, y), angle, length, 2)
  const texture = new THREE.CanvasTexture(canvas)
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping
  return texture
}

/** One wing of the bow: gathered at the knot, pleated, swelling outwards. */
function wingGeometry(side: number) {
  const cols = 28, rows = 18
  const position: number[] = [], index: number[] = []
  for (let j = 0; j <= rows; j++) {
    const v = (j / rows) * 2 - 1
    for (let i = 0; i <= cols; i++) {
      const u = i / cols
      const half = 0.05 + 0.17 * u ** 0.75 + 0.012 * Math.sin(v * 3 + u * 6)
      const pleat = 0.03 * Math.sin(v * 8 + u * 2.4 + Math.sin(u * 5)) * (1 - u * 0.5) + 0.012 * Math.sin(u * 13 + v * 3)
      position.push(side * (0.04 + 0.43 * u + 0.018 * Math.sin(v * 2.5)), v * half + 0.03 * u * side, 0.085 * Math.sin(u * Math.PI * 0.9) * (1 - 0.35 * v * v) + pleat)
    }
  }
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const a = j * (cols + 1) + i, b = a + 1, c = a + cols + 1, d = c + 1
      if (side > 0) index.push(a, b, c, b, d, c)
      else index.push(a, c, b, b, c, d)
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3))
  geometry.setIndex(index)
  geometry.computeVertexNormals()
  return geometry
}

export class BillyHead implements HeadView {
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 60)
  private head = new THREE.Group()
  private chin: THREE.Mesh
  private eyes: THREE.Mesh[] = []
  private textures: THREE.Texture[] = []
  private light = { value: 1 }
  private glow = { value: 1 }
  private pupil = { value: 0.3 }
  private key: THREE.DirectionalLight
  private fill: THREE.HemisphereLight
  private halos: THREE.Sprite[] = []
  private gaze: GazeSpring
  private mood = { ...MOODS.neutral }
  private moodTarget = { ...MOODS.neutral }
  private jaw = 0
  private nextSpeak = between([4, 8])
  private speakAt = -100
  private nextFlicker = between([4, 9])
  private flickerAt = -100
  private clock = new THREE.Clock()
  private resizeObserver: ResizeObserver
  private canvas: HTMLCanvasElement
  private fps: number
  private raf = 0
  private lastFrame = 0
  private renderedFps = 0
  private fpsCount = 0
  private fpsSince = 0
  private disposed = false

  constructor(canvas: HTMLCanvasElement, opts: HeadViewOptions = {}) {
    this.canvas = canvas
    this.fps = opts.fps ?? 30
    this.gaze = new GazeSpring(opts.stiffness ?? 5, opts.delay ?? 0)

    const attributes: WebGLContextAttributes = { antialias: true, alpha: false, powerPreference: 'high-performance' }
    // A WebGL 1 context handed in keeps three.js on its WebGL 1 path, as on the old iMacs.
    const context = opts.webgl1 ? canvas.getContext('webgl', attributes) ?? undefined : undefined
    this.renderer = new THREE.WebGLRenderer({ canvas, context, ...attributes })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, opts.maxPixelRatio ?? 1.5))
    this.renderer.setClearColor(0x000000, 1)
    this.camera.position.copy(CAM)
    this.camera.lookAt(LOOK)

    const room = new THREE.Mesh(new THREE.PlaneGeometry(16, 9), new THREE.ShaderMaterial({
      uniforms: { uLight: this.light }, vertexShader: PASS_VERTEX, fragmentShader: ROOM_FRAGMENT, depthWrite: false,
    }))
    room.position.z = -3
    room.renderOrder = -10
    this.scene.add(room)

    this.fill = new THREE.HemisphereLight(0xc8c8d0, 0x050505, 0.5)
    this.key = new THREE.DirectionalLight(0xfff4e8, 2)
    this.key.position.copy(KEY)
    this.scene.add(this.fill, this.key)

    // --- the mask -------------------------------------------------------------
    const detail = detailTexture()
    this.textures.push(detail)
    const paper = (cut: number) => new THREE.ShaderMaterial({
      uniforms: { uDetail: { value: detail }, uKey: { value: KEY }, uLight: this.light, uEyeGlow: this.glow, uCut: { value: cut } },
      vertexShader: MASK_VERTEX,
      fragmentShader: MASK_FRAGMENT,
      side: THREE.DoubleSide,
    })
    this.head.add(new THREE.Mesh(maskGeometry(), paper(1)))
    this.chin = new THREE.Mesh(chinGeometry(), paper(0))
    this.chin.position.set(0, CHIN_Y, 0.385)
    this.head.add(this.chin)

    // --- cheeks and eyes ------------------------------------------------------
    const ball = new THREE.SphereGeometry(1, 48, 32)
    for (const side of [-1, 1]) {
      const cheek = new THREE.Mesh(ball, new THREE.ShaderMaterial({
        uniforms: { uKey: { value: KEY }, uLight: this.light, uSide: { value: side } },
        vertexShader: BALL_VERTEX,
        fragmentShader: CHEEK_FRAGMENT,
      }))
      cheek.position.set(side * 0.53, -0.075, 0.37)
      cheek.scale.set(CHEEK_R, CHEEK_R, CHEEK_R * 0.8)
      cheek.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(side * 0.62, -0.05, 0.78).normalize())
      this.head.add(cheek)

      const eye = new THREE.Mesh(new THREE.SphereGeometry(EYE_R, 40, 28), new THREE.ShaderMaterial({
        uniforms: { uKey: { value: KEY }, uLight: this.light, uGlow: this.glow, uPupil: this.pupil },
        vertexShader: BALL_VERTEX,
        fragmentShader: EYE_FRAGMENT,
      }))
      eye.position.set(side * EYE.x, EYE.y, EYE.z)
      this.eyes.push(eye)
      this.head.add(eye)
    }
    // A faint red bloom round the eyes.
    const haloCanvas = document.createElement('canvas')
    haloCanvas.width = haloCanvas.height = 64
    const h = haloCanvas.getContext('2d')!
    const g = h.createRadialGradient(32, 32, 0, 32, 32, 32)
    g.addColorStop(0, 'rgba(255,40,20,0.9)')
    g.addColorStop(0.4, 'rgba(200,10,5,0.25)')
    g.addColorStop(1, 'rgba(160,0,0,0)')
    h.fillStyle = g
    h.fillRect(0, 0, 64, 64)
    const halo = new THREE.CanvasTexture(haloCanvas)
    this.textures.push(halo)
    for (const side of [-1, 1]) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: halo, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }))
      s.position.set(side * EYE.x, EYE.y, EYE.z + 0.12)
      s.scale.setScalar(0.44)
      this.halos.push(s)
      this.head.add(s)
    }
    this.scene.add(this.head)

    // --- bow tie, shirt, the dark suit: they stay put ---------------------------
    const satin = new THREE.MeshPhongMaterial({ color: 0xb60a0e, side: THREE.DoubleSide, shininess: 16, specular: new THREE.Color(0x5a1a18) })
    const bow = new THREE.Group()
    bow.add(new THREE.Mesh(wingGeometry(-1), satin), new THREE.Mesh(wingGeometry(1), satin))
    const knot = new THREE.Mesh(new RoundedBoxGeometry(0.11, 0.13, 0.09, 4, 0.035), satin)
    knot.position.z = 0.03
    bow.add(knot)
    bow.position.set(0, -1.08, 0.46)
    bow.rotation.z = 0.05
    const shirt = new THREE.Mesh(new THREE.ShapeGeometry(new THREE.Shape([
      new THREE.Vector2(-0.2, 0), new THREE.Vector2(0.2, 0), new THREE.Vector2(0.08, -0.7), new THREE.Vector2(-0.08, -0.7),
    ])), new THREE.MeshPhongMaterial({ color: 0xb9b6ae, shininess: 10 }))
    shirt.position.set(0, -1.08, 0.36)
    const suit = new THREE.MeshPhongMaterial({ color: 0x0c0c0f, shininess: 18, specular: new THREE.Color(0x24252b) })
    const outline = new THREE.SplineCurve([[0.2, -0.9], [0.34, -1.02], [0.82, -1.12], [1.14, -1.3], [1.3, -1.7], [1.36, -2.6]].map(([r, y]) => new THREE.Vector2(r, y)))
    const shoulders = new THREE.Mesh(new THREE.LatheGeometry(outline.getPoints(30), 64), suit)
    shoulders.scale.z = 0.5
    this.scene.add(shoulders, shirt, bow)

    this.resizeObserver = new ResizeObserver(this.resize)
    this.resizeObserver.observe(canvas)
    this.resize()
    document.addEventListener('visibilitychange', this.onVisibility)
    this.tick()
  }

  private resize = () => {
    const w = this.canvas.clientWidth || window.innerWidth
    const h = this.canvas.clientHeight || window.innerHeight
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / h
    // Keep the cheeks (about 1.6 wide) in frame on narrow screens.
    const halfFov = THREE.MathUtils.degToRad(FOV / 2)
    const dist = Math.max(CAM.z, 1.9 / (2 * Math.tan(halfFov) * this.camera.aspect))
    this.camera.position.set(CAM.x, CAM.y, dist)
    this.camera.lookAt(LOOK)
    this.camera.updateProjectionMatrix()
  }

  private onVisibility = () => {
    if (document.hidden) {
      cancelAnimationFrame(this.raf)
      this.raf = 0
    } else if (!this.raf && !this.disposed) {
      this.clock.getDelta()
      this.tick()
    }
  }

  setLook(yaw: number, pitch: number) {
    this.gaze.set(yaw, pitch)
  }

  setExpression(expression: Expression) {
    Object.assign(this.moodTarget, MOODS[expression])
  }

  private tick = () => {
    if (this.disposed) return
    this.raf = requestAnimationFrame(this.tick)
    const now = performance.now()
    if (now - this.lastFrame < 1000 / this.fps - 2) return
    this.lastFrame = now
    const dt = Math.min(this.clock.getDelta(), 0.1)
    const t = this.clock.elapsedTime

    const k = 1 - Math.exp(-5 * dt)
    for (const key of ['laugh', 'ajar', 'tilt', 'pupil'] as const) this.mood[key] += (this.moodTarget[key] - this.mood[key]) * k

    // The chin: ajar with his mood, in syllables when he speaks, clacking when he laughs.
    if (t > this.nextSpeak) {
      this.speakAt = t
      this.nextSpeak = t + SPEAK_LENGTH + between(SPEAK_EVERY)
    }
    const spoken = t - this.speakAt
    const speaking = spoken < SPEAK_LENGTH
    const syllable = speaking ? noise(Math.floor(spoken * 6.5), 4) * (0.5 + 0.5 * Math.sin(spoken * 20.4) ** 2) : 0
    const cackle = this.mood.laugh * Math.abs(Math.sin(t * 9.5)) * (0.55 + 0.45 * Math.sin(t * 1.7) ** 2)
    const open = Math.max(this.mood.ajar, syllable * 0.95, cackle)
    // Wooden: it snaps open faster than it falls shut.
    this.jaw += (open - this.jaw) * (1 - Math.exp(-(open > this.jaw ? 34 : 20) * dt))
    this.chin.position.y = CHIN_Y - this.jaw * CHIN_DROP

    // The bulb: it stutters and dies for a moment, and only his eyes stay lit.
    if (t > this.nextFlicker) {
      this.flickerAt = t
      this.nextFlicker = t + between(FLICKER_EVERY)
    }
    const f = (t - this.flickerAt) / FLICKER_LENGTH
    const buzz = 0.96 + 0.04 * noise(Math.floor(t * 40), 1)
    const failing = f < 1 ? (noise(Math.floor(t * 22), 2) > 0.45 + 0.4 * Math.sin(f * Math.PI) ? 1 : 0.04) : 1
    const light = buzz * failing
    this.light.value = light
    this.key.intensity = 2 * light
    this.fill.intensity = 0.5 * light
    const dark = 1 - light
    this.glow.value = 0.72 + 0.1 * Math.sin(t * 2.3) + 0.45 * dark
    this.pupil.value = this.mood.pupil - 0.1 * dark
    for (const halo of this.halos) halo.material.opacity = 0.1 + 0.7 * dark

    // A puppet's head: a nod with each word, a jerk in the laugh.
    const pose = this.gaze.update(dt, t)
    const jolt = speaking ? syllable * 0.025 : 0
    const shake = this.mood.laugh * Math.sin(t * 9.5) * 0.025
    this.head.rotation.set(-pose.pitch * 0.6 + jolt + shake, pose.yaw * 0.72, this.mood.tilt + Math.sin(t * 0.5) * 0.008, 'YXZ')
    // The eyes get there first.
    const glanceY = THREE.MathUtils.clamp(this.gaze.goal.yaw - this.gaze.yaw + pose.yaw * 0.35, -0.55, 0.55)
    const glanceX = THREE.MathUtils.clamp(-(this.gaze.goal.pitch - this.gaze.pitch) - pose.pitch * 0.3, -0.35, 0.35)
    for (const eye of this.eyes) eye.rotation.set(glanceX, glanceY, 0)

    this.renderer.render(this.scene, this.camera)
    this.fpsCount++
    if (now - this.fpsSince > 1000) {
      this.renderedFps = this.fpsCount
      this.fpsCount = 0
      this.fpsSince = now
    }
  }

  debug() {
    return {
      style: 'billy',
      webgl: this.renderer.capabilities.isWebGL2 ? 2 : 1,
      headLoaded: true,
      renderedFps: this.renderedFps,
      yaw: Number(this.gaze.yaw.toFixed(3)),
      pitch: Number(this.gaze.pitch.toFixed(3)),
      goal: { ...this.gaze.goal },
      expression: { ...this.mood },
      jaw: Number(this.jaw.toFixed(2)),
      glitch: this.light.value < 0.5,
    }
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    cancelAnimationFrame(this.raf)
    this.resizeObserver.disconnect()
    document.removeEventListener('visibilitychange', this.onVisibility)
    this.scene.traverse((object) => {
      if (!(object instanceof THREE.Mesh || object instanceof THREE.Sprite)) return
      object.geometry.dispose()
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) material.dispose()
    })
    for (const texture of this.textures) texture.dispose()
    this.renderer.dispose()
  }
}
