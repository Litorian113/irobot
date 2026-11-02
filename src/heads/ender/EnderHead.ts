import * as THREE from 'three'
import { GazeSpring } from '../GazeSpring'
import { addDarkBackdrop, DARK_BACKDROP } from '../darkBackdrop'
import type { Expression, HeadView, HeadViewOptions } from '../types'
import { ENDER_FRAGMENT, ENDER_VERTEX } from './shaders'

/**
 * E.N.D.E.R. - a block-game enderman, its head eight real cubes wide, black with glowing
 * purple eyes, purple dust drifting round it. When someone turns up (and now and then
 * anyway) it stares back: the top of its head lifts, it trembles, and it teleports - it
 * bursts into purple dust and puts itself together somewhere else in the picture.
 * WebGL 1 safe: one instanced draw, plain GLSL ES 1.0, paths as formulas.
 */

const FOV = 32
const CAM = new THREE.Vector3(0, 0, 5.3)
/** The size of one pixel of the figure. */
const P = 0.19
const HEAD = 8
/** The body below the head: as wide as the head, thin, long enough to leave the frame. */
const BODY = { wide: 8, deep: 4, rows: 16 }
const HEAD_CENTER_Y = 0.08
const NECK_Y = HEAD_CENTER_Y - (HEAD / 2) * P
const TURN = 0.85
const DUST = 70

/** The face, seen from the front: E an eye's edge, L its bright middle. */
const FACE = [
  '........',
  '........',
  '........',
  '........',
  '.ELE.ELE',
  '........',
  '........',
  '........',
]
const BLACKS = ['#141416', '#18181b', '#1c1c20', '#202024', '#26262b', '#111113', '#2c2c31']
const EYE = { E: '#cc33ff', L: '#f2c2ff' }
const DUST_COLORS = ['#b84dff', '#d27bff', '#8f2bdb', '#e7a8ff']

/** How long each part takes (seconds). */
const STARE = 1.8
const VANISH = 0.55
const AWAY = 0.35
const APPEAR = 0.6
/** It does it by itself every so often; after someone turns up, soon. */
const IDLE_EVERY = [25, 50]
const NOTICE_DELAY = [1.2, 3]
/** Not again right after, however many people walk past. */
const COOLDOWN = 12
/** Where it may stand: the middle, or off to a side. */
const PLACES = [0, -0.85, 0.85]

type Phase = 'idle' | 'stare' | 'vanish' | 'away' | 'appear'

const between = ([lo, hi]: number[]) => lo + Math.random() * (hi - lo)

/** The same enderman every time. */
function seeded(seed: number) {
  let s = seed
  return () => {
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function buildCubes() {
  const random = seeded(11)
  const home: number[] = [], color: number[] = [], seed: number[] = [], kind: number[] = []
  const c = new THREE.Color()
  const add = (x: number, y: number, z: number, hex: string, glow: number, type: number) => {
    home.push(x, y, z)
    // Colours are written straight to the screen, as authored.
    c.set(hex).convertLinearToSRGB()
    color.push(c.r, c.g, c.b, glow)
    seed.push(random(), random(), random(), random())
    kind.push(type)
  }
  const black = () => BLACKS[Math.floor(random() * BLACKS.length)]
  // The head: only its shell. The top four rows lift away when it gets angry.
  for (let row = 0; row < HEAD; row++) for (let x = 0; x < HEAD; x++) for (let z = 0; z < HEAD; z++) {
    if (row > 0 && row < HEAD - 1 && x > 0 && x < HEAD - 1 && z > 0 && z < HEAD - 1) continue
    const pixel = z === HEAD - 1 ? FACE[row][x] : '.'
    const eye = pixel === 'E' || pixel === 'L'
    add(
      (x - (HEAD - 1) / 2) * P,
      HEAD_CENTER_Y + ((HEAD - 1) / 2 - row) * P,
      (z - (HEAD - 1) / 2) * P,
      eye ? EYE[pixel] : black(),
      eye ? 1 : 0,
      row < 4 ? 2 : 1,
    )
  }
  // Under the lid there is more darkness, not a hole.
  for (let x = 1; x < HEAD - 1; x++) for (let z = 1; z < HEAD - 1; z++) {
    add((x - (HEAD - 1) / 2) * P, HEAD_CENTER_Y - 0.5 * P, (z - (HEAD - 1) / 2) * P, '#060607', 0, 1)
  }
  // The body.
  for (let row = 0; row < BODY.rows; row++) for (let x = 0; x < BODY.wide; x++) for (let z = 0; z < BODY.deep; z++) {
    if (x > 0 && x < BODY.wide - 1 && z > 0 && z < BODY.deep - 1) continue
    add((x - (BODY.wide - 1) / 2) * P, NECK_Y - (row + 0.5) * P, (z - (BODY.deep - 1) / 2) * P, black(), 0, 0)
  }
  // Purple dust drifting round it.
  for (let i = 0; i < DUST; i++) {
    const hex = DUST_COLORS[Math.floor(random() * DUST_COLORS.length)]
    add(0, 0, 0, hex, 1, 3)
  }

  const box = new THREE.BoxGeometry(1, 1, 1)
  const geometry = new THREE.InstancedBufferGeometry()
  geometry.setIndex(box.index)
  for (const [name, attribute] of Object.entries(box.attributes)) geometry.setAttribute(name, attribute)
  box.dispose()
  geometry.setAttribute('aHome', new THREE.InstancedBufferAttribute(new Float32Array(home), 3))
  geometry.setAttribute('aColor', new THREE.InstancedBufferAttribute(new Float32Array(color), 4))
  geometry.setAttribute('aSeed', new THREE.InstancedBufferAttribute(new Float32Array(seed), 4))
  geometry.setAttribute('aKind', new THREE.InstancedBufferAttribute(new Float32Array(kind), 1))
  geometry.instanceCount = kind.length
  return geometry
}

export class EnderHead implements HeadView {
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 60)
  private material: THREE.ShaderMaterial
  private backdrop: THREE.ShaderMaterial
  private gaze: GazeSpring
  private camZ = CAM.z
  private turn = new THREE.Matrix3()
  private turnMatrix = new THREE.Matrix4()
  private euler = new THREE.Euler(0, 0, 0, 'YXZ')
  private pivot = new THREE.Vector3(0, NECK_Y, 0)
  private offset = new THREE.Vector3()
  private place = 0
  private nextPlace = 0
  private phase: Phase = 'idle'
  private phaseAt = 0
  private lastPort = -100
  private nextPort = between([12, 20])
  private expression: Expression = 'neutral'
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
    this.renderer.setClearColor(DARK_BACKDROP, 1)
    this.camera.position.copy(CAM)
    this.backdrop = addDarkBackdrop(this.scene)

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTurn: { value: this.turn },
        uPivot: { value: this.pivot },
        uOffset: { value: this.offset },
        uSize: { value: P * 1.002 },
        uJaw: { value: 0 },
        uPort: { value: 0 },
        uTime: { value: 0 },
        uStare: { value: 0 },
      },
      vertexShader: ENDER_VERTEX,
      fragmentShader: ENDER_FRAGMENT,
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
    // Room for it to stand off to a side, on narrow screens too.
    const halfFov = THREE.MathUtils.degToRad(FOV / 2)
    this.camZ = Math.max(CAM.z, 4.6 / (2 * Math.tan(halfFov) * this.camera.aspect))
    this.camera.position.z = this.camZ
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

  /** It has no face to change. But someone turning up is who it stares at. */
  setExpression(expression: Expression) {
    if (expression === this.expression) return
    const noticed = this.expression === 'neutral' && expression !== 'neutral'
    this.expression = expression
    if (noticed) {
      this.nextPort = Math.min(this.nextPort, Math.max(this.clock.elapsedTime + between(NOTICE_DELAY), this.lastPort + COOLDOWN))
    }
  }

  /** Stare and teleport now (if it is not already). */
  teleport() {
    if (this.phase === 'idle') this.enter('stare', this.clock.elapsedTime)
  }

  private enter(phase: Phase, t: number) {
    this.phase = phase
    this.phaseAt = t
  }

  private tick = () => {
    if (this.disposed) return
    this.raf = requestAnimationFrame(this.tick)
    const now = performance.now()
    if (now - this.lastFrame < 1000 / this.fps - 2) return
    this.lastFrame = now
    const dt = Math.min(this.clock.getDelta(), 0.1)
    const t = this.clock.elapsedTime

    if (this.phase === 'idle' && t > this.nextPort) this.enter('stare', t)
    let age = t - this.phaseAt
    if (this.phase === 'stare' && age > STARE) {
      this.lastPort = t
      // Somewhere else: off to a side from the middle, back to the middle from a side.
      this.nextPlace = this.place === 0 ? PLACES[1 + Math.floor(Math.random() * 2)] : 0
      this.enter('vanish', t)
    } else if (this.phase === 'vanish' && age > VANISH) {
      this.place = this.nextPlace
      this.enter('away', t)
    } else if (this.phase === 'away' && age > AWAY) {
      this.enter('appear', t)
    } else if (this.phase === 'appear' && age > APPEAR) {
      this.enter('idle', t)
      this.nextPort = t + between(IDLE_EVERY)
    }
    age = t - this.phaseAt

    let jaw = 0, port = 0, stare = 0, shake = 0
    if (this.phase === 'stare') {
      const f = age / STARE
      jaw = Math.min(1, f * 4)
      stare = jaw
      shake = 0.012 + 0.03 * f
    } else if (this.phase === 'vanish') {
      port = age / VANISH
      jaw = 1
    } else if (this.phase === 'away') {
      port = 1
    } else if (this.phase === 'appear') {
      port = 1 - age / APPEAR
      jaw = Math.max(0, 1 - age / APPEAR)
    }
    const u = this.material.uniforms
    u.uJaw.value = jaw
    u.uPort.value = Math.min(1, Math.max(0, port))
    u.uStare.value = stare
    u.uTime.value = t
    this.offset.set(this.place + (Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake, 0)

    const pose = this.gaze.update(dt, t)
    this.euler.set(-pose.pitch, pose.yaw, 0, 'YXZ')
    this.turnMatrix.makeRotationFromEuler(this.euler)
    this.turn.setFromMatrix4(this.turnMatrix)

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
      style: 'ender',
      webgl: this.renderer.capabilities.isWebGL2 ? 2 : 1,
      headLoaded: true,
      renderedFps: this.renderedFps,
      yaw: Number(this.gaze.yaw.toFixed(3)),
      pitch: Number(this.gaze.pitch.toFixed(3)),
      goal: { ...this.gaze.goal },
      phase: this.phase,
      // For the snapshot script: photograph it standing in the middle, not mid-teleport.
      glitch: this.phase !== 'idle' || this.place !== 0,
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
    this.backdrop.dispose()
    this.renderer.dispose()
  }
}
