import * as THREE from 'three'
import { GazeSpring } from '../GazeSpring'
import type { Expression, HeadView, HeadViewOptions } from '../types'
import { CUBE_FRAGMENT, CUBE_VERTEX, SKY_FRAGMENT, SKY_VERTEX } from './shaders'

/**
 * V.I.L.L.A.G.E.R. - the block-game villager, built from real cubes, one per
 * pixel of his skin: a tall head, the big nose hanging over his chin, one
 * brow over both eyes, a brown robe with his arms folded in front.
 * He goes "hmm" with a nod when someone turns up, shakes his head now and
 * then (no trade today), and green sparkles rise round him while he is happy.
 * WebGL 1 safe: one instanced draw, plain GLSL ES 1.0.
 */

const FOV = 32
const CAM = new THREE.Vector3(0, 0.1, 5.9)
const LOOK_Y = 0.12
/** The size of one pixel of the figure. */
const P = 0.16
const HEAD = { wide: 8, tall: 10, deep: 8 }
const BODY = { wide: 8, deep: 6, rows: 14 }
/** The neck: where the head turns and the robe begins. */
const NECK_Y = -0.46
/** The arms swing up from the shoulders, as in the game. */
const ARMS_TILT = -0.75
const TURN = 0.8
const SPARKLES = 22

/** His skin, as in the picture. */
const PALETTE: Record<string, string> = {
  t: '#b68d74', // the top row, lit
  l: '#b58d76', // light skin
  s: '#ad7d6a', // skin
  e: '#af7c6a', // above the brow
  d: '#896048', // shade: the nose, the jaw's sides
  n: '#b28d79', // the tip of the nose
  x: '#af8475', // a pinker cheek
  m: '#71433a', // the dark spots beside the nose
  b: '#2f2314', // the brow
  w: '#ffffff', // the whites
  g: '#42942d', // the green eyes
}
/** The face, top row first, as in the picture. */
const FACE = [
  'tttttttt',
  'lslsssls',
  'lslsssls',
  'lsssssls',
  'leeeeels',
  'sbbbbbbs',
  'lwgssgwl',
  'dsxddlsd',
  'dsmddmsd',
  'dssddssd',
]
const ROBES = ['#6b534d', '#6d554f', '#6c524d', '#674f48', '#6b534d', '#6e564f']
const ROBE_DARK = '#4f3b31'
/** The V of the collar below his chin: [row, column] of the robe's front. */
const COLLAR = new Set(['0,1', '0,6', '1,2', '1,5', '2,3', '2,4'])

const MOODS: Record<Expression, { sparkle: number }> = {
  neutral: { sparkle: 0 },
  curious: { sparkle: 0 },
  happy: { sparkle: 1 },
}
/** He shakes his head now and then (seconds). */
const SHAKE_EVERY = [12, 26]
const SHAKE_LENGTH = 1.1
/** And says "hmm" with a nod in between. */
const HMM_EVERY = [7, 16]
const HMM_LENGTH = 0.7

const between = ([lo, hi]: number[]) => lo + Math.random() * (hi - lo)
const smoothstep = (a: number, b: number, x: number) => {
  const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1)
  return t * t * (3 - 2 * t)
}

/** The same villager every time. */
function seeded(seed: number) {
  let s = seed
  return () => {
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Box of cubes [x0, x1) x [y0, y1) x [z0, z1) in pixels, only its shell; color() picks each cube's colour. */
function shell(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, each: (x: number, y: number, z: number) => void) {
  for (let x = x0; x < x1; x++) for (let y = y0; y < y1; y++) for (let z = z0; z < z1; z++) {
    if (x > x0 && x < x1 - 1 && y > y0 && y < y1 - 1 && z > z0 && z < z1 - 1) continue
    each(x, y, z)
  }
}

function buildCubes() {
  const random = seeded(11)
  const home: number[] = [], color: number[] = [], seed: number[] = [], kind: number[] = []
  const c = new THREE.Color()
  const add = (x: number, y: number, z: number, hex: string, type: number) => {
    // Pixel coordinates (cube corners) to the cube's centre in the scene; y = 0 is the neck.
    home.push((x + 0.5) * P, NECK_Y + (y + 0.5) * P, (z + 0.5) * P)
    // Colours are written straight to the screen, as authored.
    c.set(hex).convertLinearToSRGB()
    color.push(c.r, c.g, c.b)
    seed.push(random(), random(), random(), random())
    kind.push(type)
  }
  const pick = (list: string[]) => list[Math.floor(random() * list.length)]

  // The head: the face at the front, plain skin round the sides, the jaw's sides shaded.
  shell(-4, 4, 0, HEAD.tall, -4, 4, (x, y, z) => {
    const row = HEAD.tall - 1 - y
    let key: string
    if (z === 3) key = FACE[row][x + 4]
    else if (y === HEAD.tall - 1) key = pick(['t', 'l', 't', 's'])
    else if (y === 0) key = 'd'
    else if (row >= 7) key = 'd'
    else key = random() < 0.12 ? 'l' : 's'
    add(x, y, z, PALETTE[key], 1)
  })
  // The nose: two wide, four tall, two deep, hanging one pixel below the chin.
  shell(-1, 1, -1, 3, 4, 6, (x, y, z) => add(x, y, z, PALETTE[y === -1 ? 'n' : 'd'], 1))

  // The robe, with the V of its collar at the front.
  shell(-4, 4, -BODY.rows, 0, -3, 3, (x, y, z) => {
    const row = -1 - y
    const dark = z === 2 && COLLAR.has(`${row},${x + 4}`)
    add(x, y, z, dark ? ROBE_DARK : pick(ROBES), 0)
  })
  // The folded arms, laid out hanging down from the shoulders before they are tilted up:
  // two sleeves and the forearms across between them, his hands in the middle.
  for (const side of [-1, 1]) {
    shell(side < 0 ? -8 : 4, side < 0 ? -4 : 8, -9, -1, -1, 3, (x, y, z) => add(x, y, z, pick(ROBES), 2))
  }
  shell(-4, 4, -9, -5, -1, 3, (x, y, z) => add(x, y, z, Math.abs(x + 0.5) < 2 ? PALETTE[pick(['s', 'l', 's'])] : pick(ROBES), 2))

  // The sparkles: their place is worked out in the shader.
  const green = ['#55ff55', '#3ce03c', '#7dff6a', '#2bc02b']
  for (let i = 0; i < SPARKLES; i++) add(0, 0, 0, green[i % green.length], 3)

  const box = new THREE.BoxGeometry(1, 1, 1)
  const geometry = new THREE.InstancedBufferGeometry()
  geometry.setIndex(box.index)
  for (const [name, attribute] of Object.entries(box.attributes)) geometry.setAttribute(name, attribute)
  box.dispose()
  geometry.setAttribute('aHome', new THREE.InstancedBufferAttribute(new Float32Array(home), 3))
  geometry.setAttribute('aColor', new THREE.InstancedBufferAttribute(new Float32Array(color), 3))
  geometry.setAttribute('aSeed', new THREE.InstancedBufferAttribute(new Float32Array(seed), 4))
  geometry.setAttribute('aKind', new THREE.InstancedBufferAttribute(new Float32Array(kind), 1))
  geometry.instanceCount = kind.length
  return geometry
}

export class VillagerHead implements HeadView {
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 60)
  private material: THREE.ShaderMaterial
  private sky: THREE.ShaderMaterial
  private gaze: GazeSpring
  private turn = new THREE.Matrix3()
  private turnMatrix = new THREE.Matrix4()
  private euler = new THREE.Euler(0, 0, 0, 'YXZ')
  private pivot = new THREE.Vector3(0, NECK_Y, 0)
  private sparkleAt = new THREE.Vector3()
  private sparkle = { value: 0 }
  private time = { value: 0 }
  private mood = { ...MOODS.neutral }
  private moodTarget = { ...MOODS.neutral }
  private expression: Expression = 'neutral'
  private nextShake = between([6, 12])
  private shakeAt = -100
  private nextHmm = between([4, 8])
  private hmmAt = -100
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
    this.renderer.setClearColor(0xb8cdf0, 1)

    this.sky = new THREE.ShaderMaterial({ vertexShader: SKY_VERTEX, fragmentShader: SKY_FRAGMENT, depthWrite: false })
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(30, 16), this.sky)
    wall.position.z = -6
    wall.renderOrder = -10
    this.scene.add(wall)

    const arms = new THREE.Matrix3().setFromMatrix4(new THREE.Matrix4().makeRotationX(ARMS_TILT))
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTurn: { value: this.turn },
        uArms: { value: arms },
        uPivot: { value: this.pivot },
        uArmPivot: { value: new THREE.Vector3(0, NECK_Y - 2 * P, 0.5 * P) },
        uSparkleAt: { value: this.sparkleAt },
        uSize: { value: P * 1.002 },
        uTime: this.time,
        uSparkle: this.sparkle,
      },
      vertexShader: CUBE_VERTEX,
      fragmentShader: CUBE_FRAGMENT,
    })
    const cubes = new THREE.Mesh(buildCubes(), this.material)
    cubes.frustumCulled = false
    this.scene.add(cubes)

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
    // Keep his shoulders in frame on narrow screens.
    const halfFov = THREE.MathUtils.degToRad(FOV / 2)
    const z = Math.max(CAM.z, 2.9 / (2 * Math.tan(halfFov) * this.camera.aspect))
    this.camera.position.set(CAM.x, CAM.y, z)
    this.camera.lookAt(0, LOOK_Y, 0)
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
    this.gaze.set(yaw * TURN, pitch * TURN)
  }

  /** Someone turning up gets a "hmm"; a happy villager sparkles. */
  setExpression(expression: Expression) {
    if (expression === this.expression) return
    if (this.expression === 'neutral') this.hmmAt = this.clock.elapsedTime
    this.expression = expression
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
    this.time.value = t

    this.mood.sparkle += (this.moodTarget.sparkle - this.mood.sparkle) * (1 - Math.exp(-3 * dt))
    this.sparkle.value = this.mood.sparkle

    // No: a quick shake, three times side to side.
    if (t > this.nextShake) {
      this.shakeAt = t
      this.nextShake = t + SHAKE_LENGTH + between(SHAKE_EVERY)
    }
    const shakeF = (t - this.shakeAt) / SHAKE_LENGTH
    const shake = shakeF < 1 ? 0.34 * Math.sin(shakeF * Math.PI * 6) * Math.sin(shakeF * Math.PI) : 0
    // Hmm: a short nod down and back.
    if (t > this.nextHmm) {
      this.hmmAt = t
      this.nextHmm = t + HMM_LENGTH + between(HMM_EVERY)
    }
    const hmmF = (t - this.hmmAt) / HMM_LENGTH
    const hmm = hmmF < 1 ? 0.2 * Math.sin(hmmF * Math.PI) ** 2 * (1 - 0.4 * smoothstep(0.5, 1, hmmF)) : 0
    // Happy: he bobs a little as the sparkles rise.
    const bob = this.mood.sparkle * 0.035 * Math.sin(t * 5)

    const pose = this.gaze.update(dt, t)
    this.euler.set(-pose.pitch + hmm + bob, pose.yaw + shake, 0, 'YXZ')
    this.turnMatrix.makeRotationFromEuler(this.euler)
    this.turn.setFromMatrix4(this.turnMatrix)
    this.sparkleAt.set(0, (HEAD.tall / 2) * P, 0).applyMatrix3(this.turn).add(this.pivot)

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
      style: 'villager',
      webgl: this.renderer.capabilities.isWebGL2 ? 2 : 1,
      headLoaded: true,
      renderedFps: this.renderedFps,
      yaw: Number(this.gaze.yaw.toFixed(3)),
      pitch: Number(this.gaze.pitch.toFixed(3)),
      goal: { ...this.gaze.goal },
      expression: { ...this.mood },
      // For the snapshot script: not in the middle of a head shake.
      glitch: this.clock.elapsedTime - this.shakeAt < SHAKE_LENGTH,
    }
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    cancelAnimationFrame(this.raf)
    this.resizeObserver.disconnect()
    document.removeEventListener('visibilitychange', this.onVisibility)
    this.scene.traverse((object) => {
      if (object instanceof THREE.Mesh) object.geometry.dispose()
    })
    this.material.dispose()
    this.sky.dispose()
    this.renderer.dispose()
  }
}
