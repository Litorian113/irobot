import * as THREE from 'three'
import { GazeSpring } from '../GazeSpring'
import type { Expression, HeadView, HeadViewOptions } from '../types'
import { CUBE_FRAGMENT, CUBE_VERTEX, SKY_FRAGMENT, SKY_VERTEX } from './shaders'

/**
 * C.R.E.E.P.E.R. - a block-game creeper, its head eight real cubes wide. When
 * someone turns up (and now and then anyway) it lights its fuse: it blinks
 * white, faster and faster, swells, and explodes - a white flash, the picture
 * shakes, every cube flies, blocky smoke. A moment of empty sky, then the
 * cubes fly back in from below.
 * WebGL 1 safe: one instanced draw, plain GLSL ES 1.0, paths as formulas.
 */

const FOV = 32
const CAM = new THREE.Vector3(0, 0, 4.5)
/** The size of one pixel of the figure. */
const P = 0.19
const HEAD = 8
/** The body below the head: narrower, not as deep, and long enough to leave the frame. */
const BODY = { wide: 6, deep: 4, rows: 18 }
const HEAD_CENTER_Y = 0.27
const NECK_Y = HEAD_CENTER_Y - (HEAD / 2) * P
const TURN = 0.85

/** The face, seen from the front. */
const FACE = [
  '........',
  '........',
  '.##..##.',
  '.##..##.',
  '...##...',
  '..####..',
  '..####..',
  '..#..#..',
]
const GREENS = ['#0da70b', '#0f8f0d', '#1fb81d', '#2ec22b', '#55c654', '#6bcf69', '#1e7a1e', '#14631a', '#9ccf98', '#b9c9b5', '#c9c9c9', '#6d7a6c']
const WEIGHTS = [5, 5, 5, 4, 4, 3, 3, 2, 1.5, 1, 1, 0.7]
const DARKS = ['#050505', '#0b1f0b', '#123012']
const SMOKE = 46

/** How long each part of the explosion takes (seconds). */
const FUSE = 1.7
const BLAST = 2.3
const GONE = 0.9
const REBUILD = 1.5
/** It goes off by itself every so often; after someone turns up, soon. */
const IDLE_EVERY = [28, 55]
const NOTICE_DELAY = [1.5, 3.5]
/** Not again right after a blast, however many people walk past. */
const COOLDOWN = 14

type Phase = 'idle' | 'fuse' | 'blast' | 'gone' | 'rebuild'

const between = ([lo, hi]: number[]) => lo + Math.random() * (hi - lo)

/** The same creeper every time. */
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
  const random = seeded(7)
  const total = WEIGHTS.reduce((a, b) => a + b, 0)
  const green = () => {
    let r = random() * total
    for (let i = 0; i < GREENS.length; i++) {
      r -= WEIGHTS[i]
      if (r <= 0) return GREENS[i]
    }
    return GREENS[0]
  }
  const home: number[] = [], color: number[] = [], velocity: number[] = [], seed: number[] = [], kind: number[] = []
  const c = new THREE.Color()
  const center = new THREE.Vector3(0, HEAD_CENTER_Y, 0)
  const add = (x: number, y: number, z: number, hex: string, type: number, speed: number) => {
    home.push(x, y, z)
    // Colours are written straight to the screen, as authored.
    c.set(hex).convertLinearToSRGB()
    color.push(c.r, c.g, c.b)
    const out = new THREE.Vector3(x, y, z).sub(center).normalize()
    velocity.push(out.x * speed, out.y * speed + 1.6, out.z * speed)
    seed.push(random(), random(), random(), random())
    kind.push(type)
  }
  // The head: only its shell, the inside never shows.
  for (let row = 0; row < HEAD; row++) for (let x = 0; x < HEAD; x++) for (let z = 0; z < HEAD; z++) {
    if (row > 0 && row < HEAD - 1 && x > 0 && x < HEAD - 1 && z > 0 && z < HEAD - 1) continue
    const dark = z === HEAD - 1 && FACE[row][x] === '#'
    add(
      (x - (HEAD - 1) / 2) * P,
      HEAD_CENTER_Y + ((HEAD - 1) / 2 - row) * P,
      (z - (HEAD - 1) / 2) * P,
      dark ? DARKS[Math.floor(random() * DARKS.length)] : green(),
      1,
      2.2 + random() * 3.6,
    )
  }
  // The body.
  for (let row = 0; row < BODY.rows; row++) for (let x = 0; x < BODY.wide; x++) for (let z = 0; z < BODY.deep; z++) {
    if (x > 0 && x < BODY.wide - 1 && z > 0 && z < BODY.deep - 1) continue
    add((x - (BODY.wide - 1) / 2) * P, NECK_Y - (row + 0.5) * P, (z - (BODY.deep - 1) / 2) * P, green(), 0, 1.6 + random() * 2.6)
  }
  // The smoke starts at the middle of the head and is thrown out.
  for (let i = 0; i < SMOKE; i++) {
    const out = new THREE.Vector3(random() - 0.5, random() - 0.45, (random() - 0.5) * 0.6).normalize()
    const reach = 0.5 + random() * 1.5
    home.push(out.x * 0.3, HEAD_CENTER_Y + out.y * 0.3, out.z * 0.3 + 0.4)
    color.push(1, 1, 1)
    velocity.push(out.x * reach, out.y * reach, out.z * reach)
    seed.push(random(), random(), random(), random())
    kind.push(2)
  }

  const box = new THREE.BoxGeometry(1, 1, 1)
  const geometry = new THREE.InstancedBufferGeometry()
  geometry.setIndex(box.index)
  for (const [name, attribute] of Object.entries(box.attributes)) geometry.setAttribute(name, attribute)
  box.dispose()
  geometry.setAttribute('aHome', new THREE.InstancedBufferAttribute(new Float32Array(home), 3))
  geometry.setAttribute('aColor', new THREE.InstancedBufferAttribute(new Float32Array(color), 3))
  geometry.setAttribute('aVelocity', new THREE.InstancedBufferAttribute(new Float32Array(velocity), 3))
  geometry.setAttribute('aSeed', new THREE.InstancedBufferAttribute(new Float32Array(seed), 4))
  geometry.setAttribute('aKind', new THREE.InstancedBufferAttribute(new Float32Array(kind), 1))
  geometry.instanceCount = kind.length
  return geometry
}

export class CreeperHead implements HeadView {
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 60)
  private material: THREE.ShaderMaterial
  private sky: THREE.ShaderMaterial
  private gaze: GazeSpring
  private camZ = CAM.z
  private turn = new THREE.Matrix3()
  private turnMatrix = new THREE.Matrix4()
  private euler = new THREE.Euler(0, 0, 0, 'YXZ')
  private center = new THREE.Vector3()
  private pivot = new THREE.Vector3(0, NECK_Y, 0)
  private phase: Phase = 'idle'
  private phaseAt = 0
  private lastBlast = -100
  private nextBlast = between([10, 20])
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
    this.renderer.setClearColor(0x9dbcf0, 1)

    this.camera.position.copy(CAM)

    this.sky = new THREE.ShaderMaterial({
      uniforms: { uFlash: { value: 0 } },
      vertexShader: SKY_VERTEX,
      fragmentShader: SKY_FRAGMENT,
      depthWrite: false,
    })
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(30, 16), this.sky)
    wall.position.z = -6
    wall.renderOrder = -10
    this.scene.add(wall)

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTurn: { value: this.turn },
        uPivot: { value: this.pivot },
        uCenter: { value: this.center },
        uSize: { value: P * 1.002 },
        uSwell: { value: 1 },
        uBoom: { value: -1 },
        uReturn: { value: 1 },
        uFlash: { value: 0 },
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
    // Keep the head, turned, in frame on narrow screens.
    const halfFov = THREE.MathUtils.degToRad(FOV / 2)
    this.camZ = Math.max(CAM.z, 2.4 / (2 * Math.tan(halfFov) * this.camera.aspect))
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

  /** It has no face to change. But someone turning up is what lights the fuse. */
  setExpression(expression: Expression) {
    if (expression === this.expression) return
    const noticed = this.expression === 'neutral' && expression !== 'neutral'
    this.expression = expression
    if (noticed) {
      this.nextBlast = Math.min(this.nextBlast, Math.max(this.clock.elapsedTime + between(NOTICE_DELAY), this.lastBlast + COOLDOWN))
    }
  }

  /** Light the fuse now (if it is not already going off). */
  explode() {
    if (this.phase === 'idle') this.enter('fuse', this.clock.elapsedTime)
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

    // The explosion's timeline.
    if (this.phase === 'idle' && t > this.nextBlast) this.enter('fuse', t)
    let age = t - this.phaseAt
    if (this.phase === 'fuse' && age > FUSE) {
      this.lastBlast = t
      this.enter('blast', t)
    } else if (this.phase === 'blast' && age > BLAST) {
      this.enter('gone', t)
    } else if (this.phase === 'gone' && age > GONE) {
      this.enter('rebuild', t)
    } else if (this.phase === 'rebuild' && age > REBUILD) {
      this.enter('idle', t)
      this.nextBlast = t + between(IDLE_EVERY)
    }
    age = t - this.phaseAt

    const u = this.material.uniforms
    let swell = 1, flash = 0, boom = -1, back = 1, shake = 0, skyFlash = 0
    if (this.phase === 'fuse') {
      const f = age / FUSE
      // Blinking white, faster and faster.
      flash = Math.sin(age * (9 + 34 * f)) > 0 ? 0.55 + 0.35 * f : 0
      swell = 1 + 0.32 * f * f * f + 0.012 * Math.sin(age * 40) * f
    } else if (this.phase === 'blast') {
      boom = age
      swell = 1.32
      skyFlash = Math.exp(-age * 7)
      flash = skyFlash
      shake = Math.exp(-age * 4.5) * 0.09
    } else if (this.phase === 'gone') {
      back = 0
    } else if (this.phase === 'rebuild') {
      back = age / REBUILD
    }
    u.uSwell.value = swell
    u.uFlash.value = flash
    u.uBoom.value = boom
    u.uReturn.value = back
    this.sky.uniforms.uFlash.value = skyFlash
    this.camera.position.set((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake, this.camZ)

    const pose = this.gaze.update(dt, t)
    this.euler.set(-pose.pitch, pose.yaw, 0, 'YXZ')
    this.turnMatrix.makeRotationFromEuler(this.euler)
    this.turn.setFromMatrix4(this.turnMatrix)
    this.center.set(0, HEAD_CENTER_Y - NECK_Y, 0).applyMatrix3(this.turn).add(this.pivot)

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
      style: 'creeper',
      webgl: this.renderer.capabilities.isWebGL2 ? 2 : 1,
      headLoaded: true,
      renderedFps: this.renderedFps,
      yaw: Number(this.gaze.yaw.toFixed(3)),
      pitch: Number(this.gaze.pitch.toFixed(3)),
      goal: { ...this.gaze.goal },
      phase: this.phase,
      // For the snapshot script: never photograph it mid-blast.
      glitch: this.phase !== 'idle',
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
