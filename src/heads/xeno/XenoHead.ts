import * as THREE from 'three'
import { GazeSpring } from '../GazeSpring'
import type { Expression, HeadView, HeadViewOptions } from '../types'
import { BACKDROP_FRAGMENT, BACKDROP_VERTEX, XENO_FRAGMENT, XENO_VERTEX } from './shaders'

/**
 * X.E.N.O. - a biomechanical creature in a white studio: a long dome of black glass, wet hoses,
 * sinews with real holes between them and a ringed neck. With nobody there it stands in profile
 * and breathes; when someone turns up it swings round to them, and when they stay its second
 * mouth shoots out. WebGL 1 safe: the mesh comes from scripts/build_xeno.mjs, in chunks of at
 * most 65535 points, and everything that moves moves in the vertex shader.
 */

const MODEL = `${import.meta.env.BASE_URL}models/Xeno`
const FOV = 26
const CAM_DIST = 7.4
/** Where the camera looks: the head a little above the middle, the neck runs out at the bottom. */
const CENTRE = new THREE.Vector2(0.05, -0.1)
/** How much of the width it needs, for narrow screens: from the mouth to the middle of the dome. */
const NEEDS_WIDTH = 3.9

/** The pose of the photo, when nobody is there. */
const PROFILE_YAW = 1.12
const PROFILE_PITCH = 0.02

const JAW: Record<Expression, number> = { neutral: 0, curious: -0.12, happy: 0.04 }
/** The strike (seconds, and how far the second mouth travels). */
const STRIKE_OUT = 0.13
const STRIKE_HOLD = 0.28
const STRIKE_BACK = 0.65
const STRIKE_REACH = new THREE.Vector3(0, 0.1, 0.62)
const STRIKE_DELAY = 0.5
const STRIKE_EVERY = [13, 24]
/** With nobody there it only flexes now and then, a shorter way. */
const IDLE_EVERY = [18, 36]

const between = ([lo, hi]: number[]) => lo + Math.random() * (hi - lo)
const ease = (t: number) => t * t * (3 - 2 * t)

interface XenoModel {
  chunks: { vertices: number; indices: number }[]
  hinge: [number, number, number]
  pivot: [number, number, number]
}

export class XenoHead implements HeadView {
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 60)
  private material: THREE.ShaderMaterial
  private backdrop: THREE.ShaderMaterial
  private gaze: GazeSpring
  private expression: Expression = 'neutral'
  /** 0: nobody there, in profile. 1: turned to whoever is. */
  private attention = 0
  private jaw = 0
  private strikeAt = -100
  private strikeReach = 1
  private nextStrike = between(IDLE_EVERY)
  private loaded = false
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
    this.renderer.setClearColor(0xf4f4f4, 1)
    this.renderer.toneMapping = THREE.NeutralToneMapping

    this.backdrop = new THREE.ShaderMaterial({
      uniforms: { uFlash: { value: 0 } },
      vertexShader: BACKDROP_VERTEX,
      fragmentShader: BACKDROP_FRAGMENT,
      depthWrite: false,
      depthTest: false,
      toneMapped: false,
    })
    const backdrop = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.backdrop)
    backdrop.frustumCulled = false
    backdrop.renderOrder = -10
    this.scene.add(backdrop)

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTurn: { value: new THREE.Vector2() },
        uJaw: { value: 0 },
        uInner: { value: new THREE.Vector3() },
        uHinge: { value: new THREE.Vector3() },
        uPivot: { value: new THREE.Vector3() },
        uFlash: { value: 0 },
      },
      vertexShader: XENO_VERTEX,
      fragmentShader: XENO_FRAGMENT,
    })
    void this.load()

    this.resizeObserver = new ResizeObserver(this.resize)
    this.resizeObserver.observe(canvas)
    this.resize()
    document.addEventListener('visibilitychange', this.onVisibility)
    this.tick()
  }

  private async load() {
    const [model, buffer] = await Promise.all([
      fetch(`${MODEL}.json`).then((r) => r.json() as Promise<XenoModel>),
      fetch(`${MODEL}.bin`).then((r) => r.arrayBuffer()),
    ])
    if (this.disposed) return
    let at = 0
    // Every array in the file starts on 4 bytes.
    const take = <T>(make: (offset: number) => T, bytes: number) => {
      const part = make(at)
      at += (bytes + 3) & ~3
      return part
    }
    for (const chunk of model.chunks) {
      const n = chunk.vertices
      const geometry = new THREE.BufferGeometry()
      geometry.setAttribute('position', new THREE.BufferAttribute(take((o) => new Float32Array(buffer, o, n * 3), n * 12), 3))
      geometry.setAttribute('normal', new THREE.BufferAttribute(take((o) => new Int16Array(buffer, o, n * 3), n * 6), 3, true))
      geometry.setAttribute('aPaint', new THREE.BufferAttribute(take((o) => new Uint8Array(buffer, o, n * 4), n * 4), 4, true))
      geometry.setAttribute('aRig', new THREE.BufferAttribute(take((o) => new Uint8Array(buffer, o, n * 4), n * 4), 4, true))
      geometry.setIndex(new THREE.BufferAttribute(take((o) => new Uint16Array(buffer, o, chunk.indices), chunk.indices * 2), 1))
      const mesh = new THREE.Mesh(geometry, this.material)
      // It moves in its shader, where three.js cannot see it.
      mesh.frustumCulled = false
      this.scene.add(mesh)
    }
    this.material.uniforms.uHinge.value.fromArray(model.hinge)
    this.material.uniforms.uPivot.value.fromArray(model.pivot)
    this.loaded = true
  }

  private resize = () => {
    const w = this.canvas.clientWidth || window.innerWidth
    const h = this.canvas.clientHeight || window.innerHeight
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / h
    const halfFov = THREE.MathUtils.degToRad(FOV / 2)
    const z = Math.max(CAM_DIST, NEEDS_WIDTH / (2 * Math.tan(halfFov) * this.camera.aspect))
    this.camera.position.set(CENTRE.x, CENTRE.y, z)
    this.camera.lookAt(CENTRE.x, CENTRE.y, 0)
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
    // Whoever stays gets the second mouth, soon.
    if (expression === 'happy' && this.expression !== 'happy') this.nextStrike = this.clock.elapsedTime + STRIKE_DELAY
    this.expression = expression
  }

  private tick = () => {
    if (this.disposed) return
    this.raf = requestAnimationFrame(this.tick)
    const now = performance.now()
    if (now - this.lastFrame < 1000 / this.fps - 2) return
    this.lastFrame = now
    const dt = Math.min(this.clock.getDelta(), 0.1)
    const t = this.clock.elapsedTime
    const present = this.expression !== 'neutral'

    this.attention += ((present ? 1 : 0) - this.attention) * (1 - Math.exp(-(present ? 4 : 0.8) * dt))
    this.jaw += (JAW[this.expression] - this.jaw) * (1 - Math.exp(-5 * dt))

    if (t > this.nextStrike) {
      this.strikeAt = t
      this.strikeReach = present ? 1 : 0.28
      this.nextStrike = t + between(present ? STRIKE_EVERY : IDLE_EVERY)
    }
    const since = t - this.strikeAt
    let strike = 0
    if (since < STRIKE_OUT) strike = ease(since / STRIKE_OUT)
    else if (since < STRIKE_OUT + STRIKE_HOLD) strike = 1
    else if (since < STRIKE_OUT + STRIKE_HOLD + STRIKE_BACK) strike = 1 - ease((since - STRIKE_OUT - STRIKE_HOLD) / STRIKE_BACK)
    strike *= this.strikeReach

    // Slow breath through the open mouth, a shiver in the jaw just before and during a strike.
    const breath = Math.sin(t * 1.15)
    const shiver = strike > 0.01 ? Math.sin(t * 58) * 0.012 : 0

    const pose = this.gaze.update(dt, t)
    const a = this.attention
    const u = this.material.uniforms
    ;(u.uTurn.value as THREE.Vector2).set(
      PROFILE_YAW * (1 - a) + pose.yaw * a + pose.yaw * 0.25 * (1 - a),
      PROFILE_PITCH * (1 - a) + (pose.pitch + 0.1) * a + breath * 0.008 - strike * 0.03,
    )
    u.uJaw.value = this.jaw + breath * 0.016 + strike * 0.14 + shiver
    ;(u.uInner.value as THREE.Vector3).copy(STRIKE_REACH).multiplyScalar(strike)

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
      style: 'xeno',
      webgl: this.renderer.capabilities.isWebGL2 ? 2 : 1,
      headLoaded: this.loaded,
      renderedFps: this.renderedFps,
      yaw: Number(this.gaze.yaw.toFixed(3)),
      pitch: Number(this.gaze.pitch.toFixed(3)),
      goal: { ...this.gaze.goal },
      expression: this.expression,
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
