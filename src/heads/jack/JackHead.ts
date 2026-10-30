import * as THREE from 'three'
import { GazeSpring } from '../GazeSpring'
import type { Expression, HeadView, HeadViewOptions } from '../types'
import { DUSK_FRAGMENT, PASS_VERTEX, PUMPKIN_FRAGMENT, PUMPKIN_VERTEX } from './shaders'

/**
 * J.A.C.K. - a gentleman with a jack-o'-lantern for a head: ribbed orange
 * skin, an evil carved face with a candle burning behind it, a black top hat
 * with a rolled brim, coat, white shirt and tie, out in the evening fog. The
 * cut morphs with his mood. A gust nearly blows the candle out now and then;
 * now and then he tips his hat, and light spills from the top of his head.
 * WebGL 1 safe: a painted illusion of the carving, Phong cloth, GLSL ES 1.0.
 */

const FOV = 30
const CAM = new THREE.Vector3(0, 0.26, 4.5)
const LOOK = new THREE.Vector3(0, 0.18, 0)
/** The pumpkin's half-widths (it is rounder than it is tall), its ribs and the shell's thickness. */
const SHAPE = new THREE.Vector3(0.68, 0.53, 0.68)
const RIBS = 12
const SHELL = 0.075
/** The mask covers this many radians either side of the face's middle. */
const RANGE = 1.1
const MASK = 1024
const HAT_Y = 0.43
const KEY = new THREE.Vector3(-0.5, 0.7, 0.5).normalize()
const CANDLE = new THREE.Color('#ff8a2e')

const MOODS: Record<Expression, [number, number, number]> = {
  neutral: [1, 0, 0],
  curious: [0, 1, 0],
  happy: [0, 0, 1],
}
const BLINK_EVERY = [3, 7]
const BLINK_LENGTH = 0.2
/** A gust nearly blows the candle out (seconds). */
const GUST_EVERY = [14, 30]
const GUST_LENGTH = 1.1
/** He tips his hat (seconds). */
const TIP_EVERY = [18, 35]
const TIP_LENGTH = 1.8

const between = ([lo, hi]: number[]) => lo + Math.random() * (hi - lo)
const noise = (step: number, channel: number) => {
  const x = Math.sin(step * 127.1 + channel * 311.7) * 43758.5453
  return x - Math.floor(x)
}
const smoothstep = (a: number, b: number, x: number) => {
  const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1)
  return t * t * (3 - 2 * t)
}

type Points = [number, number][]

/** The carved face, per expression. Radians on the pumpkin: x round it, y up; mirrored parts by `side`. */
const mirrored = (points: Points): Points => points.map(([x, y]) => [-x, y])
const NOSE: Points = [[0, 0.09], [0.1, -0.1], [-0.1, -0.1]]

const NEUTRAL_EYE: Points = [[0.66, 0.54], [0.17, 0.15], [0.6, 0.13]]
const NEUTRAL_MOUTH: Points = [
  [-0.78, -0.12], [-0.56, -0.25], [-0.46, -0.2], [-0.4, -0.33], [-0.2, -0.33], [-0.15, -0.25], [0.15, -0.25], [0.2, -0.33], [0.4, -0.33], [0.46, -0.2], [0.56, -0.25], [0.78, -0.12],
  [0.62, -0.46], [0.42, -0.6], [0.34, -0.48], [0.14, -0.48], [0.09, -0.65], [-0.09, -0.65], [-0.14, -0.48], [-0.34, -0.48], [-0.42, -0.6], [-0.62, -0.46],
]
const CURIOUS_LEFT: Points = [[-0.6, 0.42], [-0.17, 0.42], [-0.38, 0.1]]
const CURIOUS_RIGHT: Points = [[0.62, 0.68], [0.2, 0.5], [0.38, 0.1], [0.66, 0.2]]
const CURIOUS_MOUTH: Points = [[-0.2, -0.26], [0, -0.2], [0.2, -0.26], [0.27, -0.42], [0.18, -0.58], [0, -0.63], [-0.18, -0.58], [-0.27, -0.42]]
const HAPPY_EYE: Points = [[0.62, 0.18], [0.5, 0.42], [0.34, 0.5], [0.2, 0.36], [0.14, 0.14], [0.27, 0.27], [0.38, 0.3], [0.5, 0.26]]
const HAPPY_MOUTH: Points = [
  [-0.92, 0.03], [-0.62, -0.15], [-0.56, -0.05], [-0.42, -0.2], [-0.3, -0.2], [-0.25, -0.1], [-0.12, -0.2], [0.12, -0.2], [0.25, -0.1], [0.3, -0.2], [0.42, -0.2], [0.56, -0.05], [0.62, -0.15], [0.92, 0.03],
  [0.76, -0.4], [0.5, -0.64], [0.42, -0.5], [0.25, -0.54], [0.17, -0.72], [-0.17, -0.72], [-0.25, -0.54], [-0.42, -0.5], [-0.5, -0.64], [-0.76, -0.4],
]

/**
 * One channel per expression, blurred: the shader cuts at the half-way level,
 * so the edges stay crisp at any size and blending channels morphs the shapes.
 */
function maskTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = MASK
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, MASK, MASK)
  ctx.globalCompositeOperation = 'lighter'
  ctx.filter = 'blur(5px)'
  const scale = MASK / (2 * RANGE)
  const draw = (color: string, shapes: Points[]) => {
    ctx.fillStyle = color
    for (const shape of shapes) {
      ctx.beginPath()
      shape.forEach(([x, y], i) => {
        if (i === 0) ctx.moveTo(MASK / 2 + x * scale, MASK / 2 - y * scale)
        else ctx.lineTo(MASK / 2 + x * scale, MASK / 2 - y * scale)
      })
      ctx.closePath()
      ctx.fill()
    }
  }
  draw('#f00', [NEUTRAL_EYE, mirrored(NEUTRAL_EYE), NOSE, NEUTRAL_MOUTH])
  draw('#0f0', [CURIOUS_LEFT, CURIOUS_RIGHT, NOSE, CURIOUS_MOUTH])
  draw('#00f', [HAPPY_EYE, mirrored(HAPPY_EYE), NOSE, HAPPY_MOUTH])
  const texture = new THREE.CanvasTexture(canvas)
  texture.anisotropy = 4
  return texture
}

/** A round pumpkin grown from a sphere: rounded lobes with narrow grooves, dimpled at the poles. */
function pumpkinGeometry() {
  const cols = 240, rows = 120
  const position: number[] = [], lobes: number[] = [], index: number[] = []
  for (let j = 0; j <= rows; j++) {
    const lat = -Math.PI / 2 + (j / rows) * Math.PI
    for (let i = 0; i <= cols; i++) {
      // The seam at the back; a lobe in the middle of the face.
      const phi = -Math.PI + (i / cols) * Math.PI * 2
      const lobe = Math.abs(Math.cos(phi * RIBS / 2)) ** 0.42
      const r = (0.89 + 0.11 * lobe) * (1 - 0.2 * Math.abs(Math.sin(lat)) ** 12)
      position.push(SHAPE.x * r * Math.sin(phi) * Math.cos(lat), SHAPE.y * r * Math.sin(lat), SHAPE.z * r * Math.cos(phi) * Math.cos(lat))
      lobes.push(lobe)
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
  geometry.setAttribute('aLobe', new THREE.Float32BufferAttribute(lobes, 1))
  geometry.setIndex(index)
  geometry.computeVertexNormals()
  return geometry
}

/** The hat, from below the brim round to the top: a rolled brim that sweeps up at the sides. */
function hatGeometry() {
  const outline: [number, number][] = [
    [0, -0.02], [0.5, -0.02], [0.7, -0.015], [0.8, 0.005], [0.825, 0.03], [0.81, 0.05], [0.72, 0.035], [0.56, 0.03], [0.48, 0.05],
    [0.462, 0.18], [0.468, 0.42], [0.49, 0.64], [0.503, 0.705], [0.496, 0.73], [0.47, 0.74], [0, 0.745],
  ]
  // Refine the outline so the brim's curl stays smooth.
  const curve = new THREE.SplineCurve(outline.map(([r, y]) => new THREE.Vector2(r, y)))
  const points = curve.getPoints(90).map((p) => new THREE.Vector2(Math.max(p.x, 0), p.y))
  const geometry = new THREE.LatheGeometry(points, 96, Math.PI, Math.PI * 2)
  const position = geometry.attributes.position as THREE.BufferAttribute
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i), y = position.getY(i), z = position.getZ(i)
    const r = Math.hypot(x, z)
    const curl = smoothstep(0.47, 0.82, r) ** 2 * (x * x) / (r * r || 1)
    position.setXYZ(i, x, y + curl * 0.17, z * 0.92)
  }
  geometry.computeVertexNormals()
  return geometry
}

/** A flat cut-out with a little thickness, for shirt, tie, collar and lapels. */
function plate(points: Points, depth: number) {
  const shape = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)))
  return new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.006, bevelSegments: 2 })
}

function glowTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 64
  const ctx = canvas.getContext('2d')!
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32)
  g.addColorStop(0, 'rgba(255,170,70,1)')
  g.addColorStop(0.4, 'rgba(255,100,20,0.35)')
  g.addColorStop(1, 'rgba(255,70,10,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 64, 64)
  return new THREE.CanvasTexture(canvas)
}

export class JackHead implements HeadView {
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 60)
  private head = new THREE.Group()
  private hat = new THREE.Group()
  private pumpkin: THREE.ShaderMaterial
  private dusk: THREE.ShaderMaterial
  private textures: THREE.Texture[] = []
  private glows: THREE.Sprite[] = []
  private lidGlow: THREE.Sprite
  private candle: THREE.PointLight
  private gaze: GazeSpring
  private mood = new THREE.Vector3(1, 0, 0)
  private moodTarget = new THREE.Vector3(1, 0, 0)
  private nextBlink = 2
  private blinkUntil = -1
  private nextGust = between([8, 14])
  private gustAt = -100
  private nextTip = between([6, 10])
  private tipAt = -100
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
    this.renderer.setClearColor(0x20262c, 1)
    this.camera.position.copy(CAM)
    this.camera.lookAt(LOOK)

    // --- the evening --------------------------------------------------------
    const size = new THREE.Vector2(20, 12)
    this.dusk = new THREE.ShaderMaterial({
      uniforms: { uSize: { value: size }, uTime: { value: 0 }, uFlame: { value: 1 } },
      vertexShader: PASS_VERTEX,
      fragmentShader: DUSK_FRAGMENT,
      depthWrite: false,
    })
    const sky = new THREE.Mesh(new THREE.PlaneGeometry(size.x, size.y), this.dusk)
    sky.position.z = -5
    sky.renderOrder = -10
    this.scene.add(sky)

    this.scene.add(new THREE.HemisphereLight(0x9fb0c0, 0x15110e, 1.1))
    const key = new THREE.DirectionalLight(0xc4d2e0, 1.1)
    key.position.copy(KEY)
    const rim = new THREE.DirectionalLight(0xd8e2ea, 1.6)
    rim.position.set(1.5, 2, -3)
    this.candle = new THREE.PointLight(CANDLE, 1, 5, 2)
    this.candle.position.set(0, -0.2, 1.15)
    this.scene.add(key, rim, this.candle)

    // --- the pumpkin --------------------------------------------------------
    const mask = maskTexture()
    this.textures.push(mask)
    this.pumpkin = new THREE.ShaderMaterial({
      uniforms: {
        uMask: { value: mask }, uShape: { value: SHAPE }, uWeights: { value: this.mood }, uCamera: { value: new THREE.Vector3() }, uKey: { value: KEY },
        uBlink: { value: 0 }, uFlame: { value: 1 }, uLid: { value: 0 }, uTime: { value: 0 }, uRange: { value: RANGE }, uThickness: { value: SHELL / SHAPE.x },
      },
      vertexShader: PUMPKIN_VERTEX,
      fragmentShader: PUMPKIN_FRAGMENT,
    })
    this.head.add(new THREE.Mesh(pumpkinGeometry(), this.pumpkin))

    // A soft halo in front of the cuts: the glow a photograph would catch.
    const halo = glowTexture()
    this.textures.push(halo)
    const sprite = (x: number, y: number, z: number) => {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: halo, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }))
      s.position.set(x, y, z)
      return s
    }
    this.glows = [sprite(-0.27, 0.15, 0.68), sprite(0.27, 0.15, 0.68), sprite(0, -0.22, 0.7)]
    this.head.add(...this.glows)
    this.lidGlow = sprite(0, 0.52, 0)
    this.head.add(this.lidGlow)

    // --- the hat --------------------------------------------------------------
    const felt = new THREE.MeshPhongMaterial({ color: 0x1b1c20, shininess: 18, specular: new THREE.Color(0x30343a) })
    const crown = new THREE.Mesh(hatGeometry(), felt)
    const ribbon = new THREE.Mesh(
      new THREE.LatheGeometry([[0.474, 0.06], [0.476, 0.12], [0.482, 0.25]].map(([r, y]) => new THREE.Vector2(r, y)), 96, Math.PI, Math.PI * 2),
      new THREE.MeshPhongMaterial({ color: 0x0b0b0e, shininess: 60, specular: new THREE.Color(0x8a9098) }),
    )
    ribbon.scale.z = 0.92
    this.hat.add(crown, ribbon)
    this.hat.position.y = HAT_Y
    this.head.add(this.hat)
    this.scene.add(this.head)

    // --- coat, shirt, tie: they stay put while the head turns -----------------
    const coat = new THREE.MeshPhongMaterial({ color: 0x252a35, shininess: 12, specular: new THREE.Color(0x24282e) })
    const torsoOutline: [number, number][] = [[0.3, -0.42], [0.36, -0.58], [0.5, -0.74], [0.78, -0.88], [1.04, -1.04], [1.22, -1.3], [1.32, -1.8], [1.36, -2.8]]
    const torso = new THREE.Mesh(new THREE.LatheGeometry(new THREE.SplineCurve(torsoOutline.map(([r, y]) => new THREE.Vector2(r, y))).getPoints(40), 64), coat)
    torso.scale.z = 0.6
    this.scene.add(torso)
    // The coat's stand-up collar behind his "neck".
    const collar = new THREE.Mesh(
      new THREE.LatheGeometry([[0.4, -0.72], [0.46, -0.58], [0.55, -0.42]].map(([r, y]) => new THREE.Vector2(r, y)), 48, 0.65, Math.PI * 2 - 1.3),
      new THREE.MeshPhongMaterial({ color: 0x252a35, side: THREE.DoubleSide, shininess: 12, specular: new THREE.Color(0x24282e) }),
    )
    collar.scale.z = 0.72
    this.scene.add(collar)
    // Shirt front, lying on the slope of the chest; local y runs down it.
    const front = new THREE.Group()
    front.position.set(0, -0.47, 0.25)
    front.rotation.x = 0.6
    const shirt = new THREE.MeshPhongMaterial({ color: 0xcfcbbf, emissive: 0x3a3833, shininess: 25, specular: new THREE.Color(0x303030) })
    const tie = new THREE.MeshPhongMaterial({ color: 0x2b2d33, shininess: 50, specular: new THREE.Color(0x4a4d52) })
    const lapel = new THREE.MeshPhongMaterial({ color: 0x2c323e, shininess: 22, specular: new THREE.Color(0x30343a) })
    const add = (points: Points, material: THREE.Material, z: number) => {
      const mesh = new THREE.Mesh(plate(points, 0.012), material)
      mesh.position.z = z
      front.add(mesh)
    }
    add([[-0.2, 0.0], [0.2, 0.0], [0.03, -1.3], [-0.03, -1.3]], shirt, 0)
    add([[-0.055, -0.1], [0.055, -0.1], [0.04, -0.2], [-0.04, -0.2]], tie, 0.03)
    add([[-0.04, -0.2], [0.04, -0.2], [0.095, -1.1], [-0.095, -1.1]], tie, 0.024)
    for (const side of [-1, 1]) {
      const m = (points: Points) => (side > 0 ? points : mirrored(points).reverse())
      add(m([[0.02, -0.04], [0.26, 0.08], [0.25, -0.1], [0.1, -0.24]]), shirt, 0.045)
      add(m([[0.25, 0.09], [0.48, 0.0], [0.6, -0.34], [0.46, -0.4], [0.5, -0.56], [0.1, -1.25], [0.04, -1.3]]), lapel, 0.07)
    }
    this.scene.add(front)

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
    // Keep the hat's brim (about 1.7 wide) in frame on narrow screens.
    const halfFov = THREE.MathUtils.degToRad(FOV / 2)
    const dist = Math.max(CAM.z, 2 / (2 * Math.tan(halfFov) * this.camera.aspect))
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
    this.moodTarget.fromArray(MOODS[expression])
  }

  private tick = () => {
    if (this.disposed) return
    this.raf = requestAnimationFrame(this.tick)
    const now = performance.now()
    if (now - this.lastFrame < 1000 / this.fps - 2) return
    this.lastFrame = now
    const dt = Math.min(this.clock.getDelta(), 0.1)
    const t = this.clock.elapsedTime

    // The cut morphs from one mood to the next.
    this.mood.lerp(this.moodTarget, 1 - Math.exp(-5 * dt))
    if (t > this.nextBlink) {
      this.blinkUntil = t + BLINK_LENGTH
      this.nextBlink = t + between(BLINK_EVERY)
    }
    const blink = Math.sin(THREE.MathUtils.clamp(1 - (this.blinkUntil - t) / BLINK_LENGTH, 0, 1) * Math.PI) ** 2

    // The candle: restless, and a gust that nearly blows it out before it catches again.
    if (t > this.nextGust) {
      this.gustAt = t
      this.nextGust = t + between(GUST_EVERY)
    }
    const gust = (t - this.gustAt) / GUST_LENGTH
    const dip = gust < 1 ? Math.sin(Math.min(gust * 1.6, 1) * Math.PI / 2) * (1 - smoothstep(0.65, 1, gust)) : 0
    const sputter = dip > 0.05 ? noise(Math.floor(t * 18), 7) * 0.35 : 0
    const restless = 0.86 + 0.09 * Math.sin(t * 11) * Math.sin(t * 6.3) + 0.09 * noise(Math.floor(t * 13), 3)
    const flame = restless * (1 - 0.9 * dip) + sputter * dip

    // He tips his hat: up, a moment in the air, down again; a little lift when he is pleased.
    if (t > this.nextTip) {
      this.tipAt = t
      this.nextTip = t + between(TIP_EVERY)
    }
    const tip = (t - this.tipAt) / TIP_LENGTH
    const raised = tip < 1 ? smoothstep(0, 0.28, tip) * (1 - smoothstep(0.68, 1, tip)) : 0
    const pleased = this.mood.z
    this.hat.position.y = HAT_Y + raised * 0.14 + pleased * 0.035 + Math.sin(t * 1.1) * 0.003
    this.hat.rotation.z = -0.035 + raised * 0.14 + pleased * 0.03
    this.hat.position.x = raised * 0.06

    const pose = this.gaze.update(dt, t)
    this.head.rotation.set(-pose.pitch * 0.55, pose.yaw * 0.8, 0, 'YXZ')
    this.head.updateMatrixWorld()

    const u = this.pumpkin.uniforms
    u.uBlink.value = blink
    u.uFlame.value = flame
    u.uLid.value = raised
    u.uTime.value = t
    this.head.worldToLocal((u.uCamera.value as THREE.Vector3).copy(this.camera.position))
    this.dusk.uniforms.uTime.value = t
    this.dusk.uniforms.uFlame.value = flame
    this.candle.intensity = 1.1 * flame
    const open = 1 - blink * 0.7
    this.glows[0].scale.setScalar(0.62 + 0.1 * flame)
    this.glows[1].scale.setScalar(0.62 + 0.1 * flame)
    this.glows[2].scale.set(1.2 + 0.1 * flame, 0.62 + 0.08 * flame, 1)
    this.glows[0].material.opacity = this.glows[1].material.opacity = 0.34 * flame * open
    this.glows[2].material.opacity = 0.34 * flame
    this.lidGlow.scale.setScalar(0.3 + raised * 0.75)
    this.lidGlow.material.opacity = raised * flame * 0.8

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
      style: 'jack',
      webgl: this.renderer.capabilities.isWebGL2 ? 2 : 1,
      headLoaded: true,
      renderedFps: this.renderedFps,
      yaw: Number(this.gaze.yaw.toFixed(3)),
      pitch: Number(this.gaze.pitch.toFixed(3)),
      goal: { ...this.gaze.goal },
      expression: { neutral: this.mood.x, curious: this.mood.y, happy: this.mood.z },
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
