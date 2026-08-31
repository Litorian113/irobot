import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { FacePass } from './FacePass'
import { DEFAULT_CONFIG, type HeadConfig } from './config'
import { fragmentShader, vertexShader } from './faceShader'

export type Expression =
  | 'neutral'
  | 'happy'
  | 'curious'
  | 'thinking'
  | 'surprised'
  | 'concerned'
  | 'sad'
  | 'stern'

export const EXPRESSIONS: Record<Expression, { smile: number; brow: number; eyeOpen: number }> = {
  neutral: { smile: 0.05, brow: 0.0, eyeOpen: 1.0 },
  happy: { smile: 0.85, brow: 0.25, eyeOpen: 0.85 },
  curious: { smile: 0.2, brow: 0.65, eyeOpen: 1.1 },
  thinking: { smile: -0.05, brow: -0.35, eyeOpen: 0.8 },
  surprised: { smile: 0.1, brow: 0.95, eyeOpen: 1.3 },
  concerned: { smile: -0.45, brow: -0.5, eyeOpen: 0.9 },
  sad: { smile: -0.65, brow: 0.3, eyeOpen: 0.7 },
  stern: { smile: -0.4, brow: -0.9, eyeOpen: 0.8 },
}

export interface FaceState {
  face: number // 0..1 how formed the face is
  turb: number // 0..1 turbulence
  smile: number
  brow: number
  eyeOpen: number
}

export interface MouthSample {
  open: number
  wide: number
}

const GRID_X = 72
const GRID_Y = 88
const GRID_Z = 28
const CAM_DIST = 4.2
const FOV = 40
const MAX_PIXEL_RATIO = 1.5
const IDLE_FPS = 24
const ACTIVE_FPS = 60
const TWO_PI = Math.PI * 2

/**
 * Additive particles can stack far above 1.0 per pixel. This knee compresses everything above
 * `knee` towards `ceiling` before bloom, so the face can never turn into a white blob.
 */
const SoftClampShader = {
  uniforms: { tDiffuse: { value: null }, uKnee: { value: 0.55 }, uCeiling: { value: 1.15 } },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uKnee;
    uniform float uCeiling;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      float lum = max(max(c.r, c.g), c.b);
      if (lum > uKnee) {
        float over = lum - uKnee;
        float range = uCeiling - uKnee;
        float compressed = uKnee + range * (1.0 - exp(-over / range));
        c.rgb *= compressed / lum;
      }
      gl_FragColor = c;
    }`,
}

/** Debug view: the four head textures tiled 2x2 (front, back / right, left). Luminance, depth as blue. */
const FaceDebugShader = {
  uniforms: {
    uFront: { value: null as THREE.Texture | null },
    uBack: { value: null as THREE.Texture | null },
    uRight: { value: null as THREE.Texture | null },
    uLeft: { value: null as THREE.Texture | null },
  },
  vertexShader: SoftClampShader.vertexShader,
  fragmentShader: /* glsl */ `
    uniform sampler2D uFront;
    uniform sampler2D uBack;
    uniform sampler2D uRight;
    uniform sampler2D uLeft;
    varying vec2 vUv;
    void main() {
      vec2 t = fract(vUv * 2.0);
      vec4 f;
      if (vUv.y > 0.5) f = vUv.x < 0.5 ? texture2D(uFront, t) : texture2D(uBack, t);
      else f = vUv.x < 0.5 ? texture2D(uRight, t) : texture2D(uLeft, t);
      float depth = (vUv.y > 0.5 ? f.r : f.a) * 0.5 + 0.5;
      gl_FragColor = vec4(vec3(f.g) + vec3(0.0, 0.0, depth * 0.35) * f.b, 1.0);
    }`,
}

/** Smooth-follow rates per parameter (higher = snappier). */
const RATES: Record<keyof FaceState, number> = {
  face: 1.6,
  turb: 3.0,
  smile: 4.0,
  brow: 4.0,
  eyeOpen: 6.0,
}

export class ParticleFace {
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera: THREE.PerspectiveCamera
  private composer: EffectComposer
  private bloom: UnrealBloomPass
  private material: THREE.ShaderMaterial
  private facePass = new FacePass(256)
  private debugQuad: THREE.Mesh | null = null
  private debugCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  private group = new THREE.Group()
  private clock = new THREE.Clock()
  private raf = 0
  private disposed = false
  private active = false
  private lastFrame = 0
  private frameMs = 0
  private renderedFps = 0
  private fpsCount = 0
  private fpsSince = 0
  private canvas: HTMLCanvasElement
  private cellScale = DEFAULT_CONFIG.cellSize
  private autoReturn = DEFAULT_CONFIG.autoReturn

  private current: FaceState = { face: 0.12, turb: 0.0, smile: 0.05, brow: 0, eyeOpen: 1 }
  private target: FaceState = { ...this.current }

  private mouth: MouthSample = { open: 0, wide: 0 }
  private mouthSource: (() => MouthSample | null) | null = null

  // drag-to-rotate: yaw/pitch with inertia, optionally easing back to the front when released
  private drag = { active: false, lastX: 0, lastY: 0, dx: 0, dy: 0, pointerId: -1 }
  private yaw = 0
  private pitch = 0
  private yawVel = 0
  private pitchVel = 0

  private nextBlink = 2
  private blinkUntil = -1

  constructor(canvas: HTMLCanvasElement, opts: { debugFace?: boolean } = {}) {
    this.canvas = canvas
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO))
    this.renderer.setClearColor(0x02050c, 1)
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 0.95

    this.camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 50)
    this.camera.position.set(0, 0, CAM_DIST)

    const v = this.facePass.views
    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uFront: { value: v.front.target.texture },
        uBack: { value: v.back.target.texture },
        uRight: { value: v.right.target.texture },
        uLeft: { value: v.left.target.texture },
        uTime: { value: 0 },
        uFace: { value: this.current.face },
        uTurb: { value: this.current.turb },
        uGain: { value: DEFAULT_CONFIG.gain },
        uFill: { value: DEFAULT_CONFIG.fill },
        uPointBase: { value: 4 },
        uCamDist: { value: CAM_DIST },
        uColorDim: { value: new THREE.Color(DEFAULT_CONFIG.colorDim) },
        uColorBright: { value: new THREE.Color(DEFAULT_CONFIG.colorBright) },
        uColorHot: { value: new THREE.Color(DEFAULT_CONFIG.colorHot) },
      },
    })

    const points = new THREE.Points(this.buildGrid(), this.material)
    points.frustumCulled = false
    this.group.add(points)
    this.scene.add(this.group)

    this.composer = new EffectComposer(this.renderer)
    this.composer.addPass(new RenderPass(this.scene, this.camera))
    this.composer.addPass(new ShaderPass(SoftClampShader))
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), DEFAULT_CONFIG.bloom, 0.3, 0.75)
    this.composer.addPass(this.bloom)
    this.composer.addPass(new OutputPass())

    if (opts.debugFace) {
      const mat = new THREE.ShaderMaterial({ ...FaceDebugShader })
      mat.uniforms.uFront.value = v.front.target.texture
      mat.uniforms.uBack.value = v.back.target.texture
      mat.uniforms.uRight.value = v.right.target.texture
      mat.uniforms.uLeft.value = v.left.target.texture
      this.debugQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat)
    }

    void this.facePass.load(`${import.meta.env.BASE_URL}models/LeePerrySmith.glb`).catch((e) => {
      console.error('[viki] head model failed to load', e)
    })

    this.resize()
    window.addEventListener('resize', this.resize)
    canvas.addEventListener('pointerdown', this.onPointerDown)
    window.addEventListener('pointermove', this.onPointerMove)
    window.addEventListener('pointerup', this.onPointerUp)
    window.addEventListener('pointercancel', this.onPointerUp)
    document.addEventListener('visibilitychange', this.onVisibility)
    this.tick()
  }

  private buildGrid(): THREE.BufferGeometry {
    const count = GRID_X * GRID_Y * GRID_Z
    const pos = new Float32Array(count * 3)
    const seed = new Float32Array(count)
    let i = 0
    for (let z = 0; z < GRID_Z; z++) {
      for (let y = 0; y < GRID_Y; y++) {
        for (let x = 0; x < GRID_X; x++) {
          pos[i * 3] = (x / (GRID_X - 1)) * 2 - 1
          pos[i * 3 + 1] = (y / (GRID_Y - 1)) * 2 - 1
          pos[i * 3 + 2] = (z / (GRID_Z - 1)) * 2 - 1
          seed[i] = Math.random()
          i++
        }
      }
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1))
    return geo
  }

  private resize = () => {
    const w = this.canvas.clientWidth || window.innerWidth
    const h = this.canvas.clientHeight || window.innerHeight
    const pr = this.renderer.getPixelRatio()
    this.renderer.setSize(w, h, false)
    this.composer.setSize(w, h)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    // device pixels per world unit at the camera's focal distance
    const pxPerUnit = (h * pr) / (2 * CAM_DIST * Math.tan((FOV * Math.PI) / 360))
    this.material.uniforms.uPointBase.value = pxPerUnit * (2 / (GRID_X - 1)) * 1.3 * this.cellScale
  }

  private onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return
    this.drag.active = true
    this.drag.pointerId = e.pointerId
    this.drag.lastX = e.clientX
    this.drag.lastY = e.clientY
    this.drag.dx = 0
    this.drag.dy = 0
    this.canvas.setPointerCapture?.(e.pointerId)
    this.canvas.style.cursor = 'grabbing'
  }

  private onPointerMove = (e: PointerEvent) => {
    if (!this.drag.active || e.pointerId !== this.drag.pointerId) return
    this.drag.dx += e.clientX - this.drag.lastX
    this.drag.dy += e.clientY - this.drag.lastY
    this.drag.lastX = e.clientX
    this.drag.lastY = e.clientY
  }

  private onPointerUp = (e: PointerEvent) => {
    if (!this.drag.active || e.pointerId !== this.drag.pointerId) return
    this.drag.active = false
    this.canvas.style.cursor = 'grab'
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

  /** Set expression & formation targets; they ease in over time. */
  setTarget(partial: Partial<FaceState>) {
    Object.assign(this.target, partial)
  }

  setExpression(expr: Expression) {
    this.setTarget(EXPRESSIONS[expr])
  }

  /** Called every frame while speaking; return null to close the mouth. */
  setMouthSource(fn: (() => MouthSample | null) | null) {
    this.mouthSource = fn
  }

  /** Active = a session is running: full frame rate. Idle renders at a low rate to stay cool. */
  setActive(active: boolean) {
    this.active = active
  }

  /** Apply the configurator's settings (colors, shape, hair, eyes, mouth, lattice). */
  applyConfig(cfg: HeadConfig) {
    const u = this.material.uniforms
    ;(u.uColorDim.value as THREE.Color).set(cfg.colorDim)
    ;(u.uColorBright.value as THREE.Color).set(cfg.colorBright)
    ;(u.uColorHot.value as THREE.Color).set(cfg.colorHot)
    u.uGain.value = cfg.gain
    u.uFill.value = cfg.fill
    this.bloom.strength = cfg.bloom
    this.autoReturn = cfg.autoReturn
    if (this.cellScale !== cfg.cellSize) {
      this.cellScale = cfg.cellSize
      this.resize()
    }
    this.facePass.applyConfig(cfg)
  }

  /** Turn the cube back to the front. */
  resetView() {
    this.yaw = 0
    this.pitch = 0
    this.yawVel = 0
    this.pitchVel = 0
  }

  private tick = () => {
    if (this.disposed) return
    this.raf = requestAnimationFrame(this.tick)

    const now = performance.now()
    const minInterval = 1000 / (this.active ? ACTIVE_FPS : IDLE_FPS) - 2
    if (now - this.lastFrame < minInterval) return
    this.lastFrame = now

    const dt = Math.min(this.clock.getDelta(), 0.1)
    const t = this.clock.elapsedTime

    for (const key of Object.keys(RATES) as (keyof FaceState)[]) {
      const k = 1 - Math.exp(-RATES[key] * dt)
      this.current[key] += (this.target[key] - this.current[key]) * k
    }

    // blink
    if (t > this.nextBlink) {
      this.blinkUntil = t + 0.13
      this.nextBlink = t + 2.5 + Math.random() * 4
    }
    const blink = t < this.blinkUntil ? 0.05 : 1

    // mouth
    const sample = this.mouthSource?.() ?? null
    const targetOpen = sample ? sample.open : 0
    const targetWide = sample ? sample.wide : 0
    const attack = 1 - Math.exp(-28 * dt)
    const release = 1 - Math.exp(-12 * dt)
    this.mouth.open += (targetOpen - this.mouth.open) * (targetOpen > this.mouth.open ? attack : release)
    this.mouth.wide += (targetWide - this.mouth.wide) * release

    // head pass uniforms (expression + mouth)
    const fu = this.facePass.uniforms
    fu.uMouthOpen.value = this.mouth.open
    fu.uMouthWide.value = this.mouth.wide
    fu.uSmile.value = this.current.smile
    fu.uBrow.value = this.current.brow + Math.sin(t * 0.7) * 0.04
    fu.uEyeOpen.value = this.current.eyeOpen * blink

    // lattice uniforms
    const u = this.material.uniforms
    u.uTime.value = t
    u.uFace.value = this.current.face
    u.uTurb.value = this.current.turb

    // drag rotation: radians per pixel while dragging, inertia afterwards; fully free
    const perPx = 0.006
    if (this.drag.active) {
      const dYaw = this.drag.dx * perPx
      const dPitch = this.drag.dy * perPx
      this.drag.dx = 0
      this.drag.dy = 0
      this.yaw += dYaw
      this.pitch += dPitch
      this.yawVel = dt > 0 ? dYaw / dt : 0
      this.pitchVel = dt > 0 ? dPitch / dt : 0
    } else {
      const friction = Math.exp(-3.5 * dt)
      this.yawVel *= friction
      this.pitchVel *= friction
      this.yaw += this.yawVel * dt
      this.pitch += this.pitchVel * dt
      if (this.autoReturn) {
        // ease back to the nearest "facing you" orientation
        const home = 1 - Math.exp(-0.35 * dt)
        const yawHome = Math.round(this.yaw / TWO_PI) * TWO_PI
        const pitchHome = Math.round(this.pitch / TWO_PI) * TWO_PI
        this.yaw += (yawHome - this.yaw) * home
        this.pitch += (pitchHome - this.pitch) * home
      }
    }
    this.group.rotation.order = 'YXZ'
    this.group.rotation.y = Math.sin(t * 0.18) * 0.08 + this.yaw
    this.group.rotation.x = Math.sin(t * 0.13) * 0.03 + this.pitch
    this.group.scale.setScalar(1 + Math.sin(t * 0.9) * 0.006)

    const t0 = performance.now()
    this.facePass.render(this.renderer)
    this.fpsCount++
    if (now - this.fpsSince > 1000) {
      this.renderedFps = this.fpsCount
      this.fpsCount = 0
      this.fpsSince = now
    }

    if (this.debugQuad) {
      this.renderer.setRenderTarget(null)
      this.renderer.render(this.debugQuad, this.debugCamera)
      return
    }
    this.composer.render()
    this.frameMs += (performance.now() - t0 - this.frameMs) * 0.1
  }

  /** Snapshot of the animated state (dev aid). */
  debug() {
    const u = this.material.uniforms
    const uniforms: Record<string, unknown> = {}
    for (const k of Object.keys(u)) if (typeof u[k].value === 'number') uniforms[k] = u[k].value
    return {
      current: { ...this.current },
      target: { ...this.target },
      mouth: { ...this.mouth },
      headLoaded: this.facePass.ready,
      active: this.active,
      pixelRatio: this.renderer.getPixelRatio(),
      yaw: Number(this.yaw.toFixed(3)),
      pitch: Number(this.pitch.toFixed(3)),
      renderedFps: this.renderedFps,
      cpuFrameMs: Number(this.frameMs.toFixed(2)),
      uniforms,
    }
  }

  dispose() {
    this.disposed = true
    cancelAnimationFrame(this.raf)
    window.removeEventListener('resize', this.resize)
    this.canvas.removeEventListener('pointerdown', this.onPointerDown)
    window.removeEventListener('pointermove', this.onPointerMove)
    window.removeEventListener('pointerup', this.onPointerUp)
    window.removeEventListener('pointercancel', this.onPointerUp)
    document.removeEventListener('visibilitychange', this.onVisibility)
    this.group.traverse((o) => {
      if (o instanceof THREE.Points) o.geometry.dispose()
    })
    this.material.dispose()
    this.facePass.dispose()
    this.composer.dispose()
    this.renderer.dispose()
  }
}
