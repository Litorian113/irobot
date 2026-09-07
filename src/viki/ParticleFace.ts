import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { FacePass } from './FacePass'
import { STYLE_DEFAULTS, type HeadConfig, type HeadStyle } from './config'
import { applyPlacement, applyShapeConfig, createHeadUniforms } from './headShader'
import { DataCube } from './DataCube'
import { createStyles, type StyleSet } from './styles'
import { SurfacePortrait } from './SurfacePortrait'
import { HeadRig } from './HeadRig'

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
  neutral: { smile: 0.25, brow: 0.08, eyeOpen: 1.0 },
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
  forward: number // 0 resting deep in the cube .. 1 awake and forward
  smile: number
  brow: number
  eyeOpen: number
}

export interface MouthSample {
  open: number
  wide: number
  round?: number
}

const CAM_DIST = 4.2
const FOV = 40
const MAX_PIXEL_RATIO = 1.5
const IDLE_FPS = 20
const ACTIVE_FPS = 60
const TWO_PI = Math.PI * 2
const REVIEW = new URLSearchParams(window.location.search)
const FROZEN = REVIEW.has('freeze')
function reviewNumber(key: string, fallback: number) {
  const value = REVIEW.get(key)
  return value !== null && Number.isFinite(Number(value)) ? Number(value) : fallback
}

/** Bloom radius / threshold per style (strength comes from the config). */
const BLOOM_SHAPE: Record<HeadStyle, { radius: number; threshold: number }> = {
  lattice: { radius: 0.3, threshold: 0.75 },
  contour: { radius: 0.4, threshold: 0.5 },
  dots: { radius: 0.5, threshold: 0.3 },
  plasma: { radius: 0.8, threshold: 0.3 },
  dust: { radius: 0.3, threshold: 0.6 },
}

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
  forward: 1.1,
  smile: 4.0,
  brow: 4.0,
  eyeOpen: 6.0,
}

export class ParticleFace {
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera: THREE.PerspectiveCamera
  private composer: EffectComposer
  private softClamp: ShaderPass
  private dotPass: ShaderPass | null = null
  private chromaPass: ShaderPass | null = null
  private bloom: UnrealBloomPass
  private cube: DataCube
  private headUniforms = createHeadUniforms()
  private facePass = new FacePass(this.headUniforms, 256)
  private styles: StyleSet | null = null
  private portrait: SurfacePortrait | null = null
  private rig: HeadRig | null = null
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
  private style: HeadStyle = 'lattice'
  private config: HeadConfig = { ...STYLE_DEFAULTS.lattice }
  private headLoaded = false

  private current: FaceState = { face: 0.12, turb: 0.0, forward: 0, ...EXPRESSIONS.neutral }
  private target: FaceState = { ...this.current }

  private mouth = { open: 0, wide: 0, round: 0 }
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
    this.cube = new DataCube(v.front.target.texture)
    this.group.add(this.cube.group)
    this.scene.add(this.group)

    this.composer = new EffectComposer(this.renderer)
    this.composer.addPass(new RenderPass(this.scene, this.camera))
    this.softClamp = new ShaderPass(SoftClampShader)
    this.composer.addPass(this.softClamp)
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.5, 0.3, 0.75)
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

    void this.loadHead(`${import.meta.env.BASE_URL}models/${new URLSearchParams(window.location.search).get('model') === 'legacy' ? 'LeePerrySmith' : 'VikiHead'}.glb`).catch((e) => {
      console.error('[viki] head model failed to load', e)
    })

    this.applyConfig(this.config)
    this.resize()
    window.addEventListener('resize', this.resize)
    canvas.addEventListener('pointerdown', this.onPointerDown)
    window.addEventListener('pointermove', this.onPointerMove)
    window.addEventListener('pointerup', this.onPointerUp)
    window.addEventListener('pointercancel', this.onPointerUp)
    document.addEventListener('visibilitychange', this.onVisibility)
    this.tick()
  }

  private async loadHead(url: string) {
    const gltf = await new GLTFLoader().loadAsync(url)
    let rig: HeadRig
    try {
      if (this.disposed) return
      rig = new HeadRig(gltf.scene)
    } finally {
      // Only the canonical geometry is retained by the renderer.
      gltf.scene.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return
        object.geometry.dispose()
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
          for (const value of Object.values(material)) if (value instanceof THREE.Texture) value.dispose()
          material.dispose()
        }
      })
    }
    this.rig = rig
    const geometry = rig.geometry
    this.headUniforms.uRigged.value = rig.rigged ? 1 : 0
    this.facePass.setGeometry(geometry, rig.influences)
    this.portrait = new SurfacePortrait(this.headUniforms, geometry)
    this.group.add(this.portrait.group)
    const styles = createStyles(this.headUniforms, geometry, CAM_DIST)
    this.styles = styles
    this.group.add(styles.contour, styles.dots, styles.plasma, styles.dust)
    this.group.add(styles.cages.contour, styles.cages.dots, styles.cages.plasma, styles.cages.dust)
    // post passes owned by styles, inserted between soft clamp and bloom
    const passes = this.composer.passes
    const bloomIndex = passes.indexOf(this.bloom)
    this.dotPass = new ShaderPass(styles.dotMatrix)
    this.chromaPass = new ShaderPass(styles.chroma)
    passes.splice(bloomIndex, 0, this.dotPass)
    passes.splice(passes.indexOf(this.bloom) + 1, 0, this.chromaPass)
    rig.bind(this.group)
    this.headLoaded = true
    this.resize()
    this.applyConfig(this.config)
    this.setStyle(this.style)
  }

  private resize = () => {
    const w = this.canvas.clientWidth || window.innerWidth
    const h = this.canvas.clientHeight || window.innerHeight
    const pr = this.renderer.getPixelRatio()
    this.renderer.setSize(w, h, false)
    this.composer.setSize(w, h)
    this.camera.aspect = w / h
    // Keep the cube's front corners and the portrait in frame on narrow screens.
    const halfFov = THREE.MathUtils.degToRad(FOV * 0.5)
    this.camera.position.z = Math.max(CAM_DIST, 1.0 + 2.3 / (2 * Math.tan(halfFov) * this.camera.aspect))
    this.camera.updateProjectionMatrix()
    this.cube.resize(pr, h)
    this.styles?.setDustBase(pr * 1.4)
    if (this.styles) this.styles.dotMatrix.uniforms.uResolution.value.set(w * pr, h * pr)
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

  /** Switch the head style (tab). */
  setStyle(style: HeadStyle) {
    this.style = style
    const s = this.styles
    this.cube.group.visible = style === 'lattice' && !new URLSearchParams(window.location.search).has('inspect')
    if (this.portrait) this.portrait.group.visible = style === 'lattice'
    if (s) {
      s.contour.visible = style === 'contour'
      s.dots.visible = style === 'dots'
      s.plasma.visible = style === 'plasma'
      s.dust.visible = style === 'dust'
      s.cages.contour.visible = style === 'contour'
      s.cages.dots.visible = style === 'dots'
      s.cages.plasma.visible = style === 'plasma'
      s.cages.dust.visible = style === 'dust'
    }
    this.softClamp.enabled = style === 'lattice' || style === 'dust' || style === 'plasma'
    if (this.dotPass) this.dotPass.enabled = style === 'dots'
    if (this.chromaPass) this.chromaPass.enabled = style === 'plasma'
    const shape = BLOOM_SHAPE[style]
    this.bloom.radius = shape.radius
    this.bloom.threshold = shape.threshold
  }

  /** Apply the configurator's settings for the current style. */
  applyConfig(cfg: HeadConfig) {
    this.config = cfg
    applyShapeConfig(this.headUniforms, cfg)
    applyPlacement(this.headUniforms, cfg, this.current.forward)
    this.cube.applyConfig(cfg)
    this.bloom.strength = cfg.bloom
    this.portrait?.applyConfig(cfg)
    this.styles?.applyConfig(cfg, this.style)
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
    const minInterval = 1000 / (this.active || this.mouthSource ? ACTIVE_FPS : IDLE_FPS) - 2
    if (now - this.lastFrame < minInterval) return
    this.lastFrame = now

    const dt = Math.min(this.clock.getDelta(), 0.1)
    const t = FROZEN ? reviewNumber('time', 0) : this.clock.elapsedTime

    for (const key of Object.keys(RATES) as (keyof FaceState)[]) {
      const k = 1 - Math.exp(-RATES[key] * dt)
      this.current[key] += (this.target[key] - this.current[key]) * (FROZEN ? 1 : k)
    }

    // blink
    if (!FROZEN && t > this.nextBlink) {
      this.blinkUntil = t + 0.22
      this.nextBlink = t + 2.5 + Math.random() * 4
    }
    const blinkPhase = THREE.MathUtils.clamp(1 - (this.blinkUntil - t) / 0.22, 0, 1)
    const blink = FROZEN ? 1 - THREE.MathUtils.clamp(reviewNumber('blink', 0), 0, 1) : 1 - Math.pow(Math.sin(blinkPhase * Math.PI), 2)

    // mouth
    const sample = this.mouthSource?.() ?? null
    const targetOpen = sample ? sample.open : 0
    const targetWide = sample ? sample.wide : 0
    const targetRound = sample ? (sample.round ?? sample.open * (1 - sample.wide)) : 0
    const attack = FROZEN ? 1 : 1 - Math.exp(-28 * dt)
    const release = FROZEN ? 1 : 1 - Math.exp(-12 * dt)
    this.mouth.open += (targetOpen - this.mouth.open) * (targetOpen > this.mouth.open ? attack : release)
    this.mouth.wide += (targetWide - this.mouth.wide) * release
    this.mouth.round += (targetRound - this.mouth.round) * release

    // shared head uniforms (expression + mouth + placement)
    const hu = this.headUniforms
    hu.uMouthOpen.value = this.mouth.open
    hu.uMouthWide.value = this.mouth.wide
    hu.uSmile.value = this.current.smile
    hu.uBrow.value = this.current.brow + Math.sin(t * 0.7) * 0.04
    hu.uEyeOpen.value = this.current.eyeOpen * blink
    this.rig?.update(this.mouth.open, this.mouth.wide, this.mouth.round, this.current.smile, this.current.brow, this.current.eyeOpen * blink)
    applyPlacement(hu, this.config, this.current.forward)

    this.cube.update(t, this.current.face)
    this.styles?.setTime(t)
    this.portrait?.update(t, this.current.face, this.current.turb)

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
      if (this.config.autoReturn) {
        const home = 1 - Math.exp(-0.35 * dt)
        const yawHome = Math.round(this.yaw / TWO_PI) * TWO_PI
        const pitchHome = Math.round(this.pitch / TWO_PI) * TWO_PI
        this.yaw += (yawHome - this.yaw) * home
        this.pitch += (pitchHome - this.pitch) * home
      }
    }
    this.group.rotation.order = 'YXZ'
    this.group.rotation.y = FROZEN ? THREE.MathUtils.degToRad(reviewNumber('yaw', 0)) : Math.sin(t * 0.18) * 0.08 + this.yaw
    this.group.rotation.x = FROZEN ? THREE.MathUtils.degToRad(reviewNumber('pitch', 0)) : Math.sin(t * 0.13) * 0.03 + this.pitch
    this.group.scale.setScalar(FROZEN ? 1 : 1 + Math.sin(t * 0.9) * 0.006)

    const t0 = performance.now()
    if (this.style === 'lattice' || this.debugQuad) this.facePass.render(this.renderer, Boolean(this.debugQuad))
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
    return {
      style: this.style,
      current: { ...this.current },
      target: { ...this.target },
      mouth: { ...this.mouth },
      headLoaded: this.headLoaded,
      rigged: this.rig?.rigged,
      morphs: this.rig?.influences.slice(),
      active: this.active,
      pixelRatio: this.renderer.getPixelRatio(),
      yaw: Number(this.yaw.toFixed(3)),
      pitch: Number(this.pitch.toFixed(3)),
      renderedFps: this.renderedFps,
      cpuFrameMs: Number(this.frameMs.toFixed(2)),
      dotRes: this.styles?.dotMatrix.uniforms.uResolution.value.toArray(),
      dotPassEnabled: this.dotPass?.enabled,
      passes: this.composer.passes.map((p) => `${p.constructor.name}:${p.enabled ? 1 : 0}`),
      cubeVisible: this.cube.group.visible,
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
    this.cube.dispose()
    this.styles?.dispose()
    this.portrait?.dispose()
    this.rig?.dispose()
    this.facePass.dispose()
    this.composer.dispose()
    this.renderer.dispose()
  }
}
