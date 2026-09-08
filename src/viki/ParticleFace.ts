import * as THREE from 'three'
import { mapVisemes } from './visemes'
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
import { HeadLight } from './HeadLight'
import { OpticalEnclosure } from './OpticalEnclosure'
import { VikiCube } from './VikiCube'
import { VikiAssembly } from './VikiAssembly'

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
  visemes?: readonly number[]
}

const CAM_DIST = 4.2
const FOV = 40
const MAX_PIXEL_RATIO = 1.5
const IDLE_FPS = 20
const ACTIVE_FPS = 30
const DRAG_FPS = 60 // only while the pointer is turning the cube
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
  dust: { radius: 0.3, threshold: 0.6 },
  viki: { radius: 0.45, threshold: 0.35 },
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
  private bloom: UnrealBloomPass
  private cube: DataCube
  private enclosure = new OpticalEnclosure()
  private vikiCube: VikiCube | null = null
  private vikiAssembly = new VikiAssembly()
  private backdropName = 'viki-hall-main'
  private backdrops = new Map<string, THREE.Texture>()
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
  private headLight: HeadLight | null = null

  private current: FaceState = { face: 0, turb: 0.0, forward: 1, ...EXPRESSIONS.neutral }
  private target: FaceState = { ...this.current }

  private mouth = { open: 0, wide: 0, round: 0 }
  private visemes: readonly number[] | undefined
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
    this.group.add(this.cube.group, this.enclosure.mesh)
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
    this.vikiCube?.setGeometry(geometry, rig.influences)
    this.headLight = new HeadLight(this.headUniforms, geometry, rig.influences)
    this.portrait = new SurfacePortrait(this.headUniforms, geometry)
    this.group.add(this.portrait.group)
    const styles = createStyles(this.headUniforms, geometry, CAM_DIST)
    this.styles = styles
    this.group.add(styles.dust, styles.cage)
    rig.bind(this.group)
    this.headLoaded = true
    this.resize()
    this.applyConfig(this.config)
    this.setStyle(this.style)
  }

  private backdropTexture(): THREE.Texture {
    let texture = this.backdrops.get(this.backdropName)
    if (!texture) {
      texture = new THREE.TextureLoader().load(`${import.meta.env.BASE_URL}images/${this.backdropName}.png`, () => this.resize())
      texture.colorSpace = THREE.SRGBColorSpace
      texture.center.set(0.5, 0.5)
      this.backdrops.set(this.backdropName, texture)
    }
    return texture
  }

  /** Choose the hall behind the VIKI scene (file name in /images without extension). */
  setBackdrop(name: string) {
    this.backdropName = name
    if (this.style === 'viki') {
      this.scene.background = this.backdropTexture()
      this.resize()
    }
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
    this.camera.position.z = this.style === 'viki'
      ? Math.max(4.9, 1.42 + 2.65 / (2 * Math.tan(halfFov) * this.camera.aspect))
      : Math.max(CAM_DIST, 1.0 + 2.3 / (2 * Math.tan(halfFov) * this.camera.aspect))
    // Fit the left-side placement only when needed, preserving the established wide-screen shot.
    if (this.style === 'viki') {
      const corner = new THREE.Vector3(), rotation = new THREE.Euler(-0.07, Math.PI / 4, 0, 'YXZ')
      for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) {
        corner.set(x, y, z * this.config.cubeDepth).multiplyScalar(this.config.cubeScale).applyEuler(rotation)
        corner.x += this.config.cubeX; corner.y += this.config.cubeY
        const horizontal = Math.abs(corner.x) / (Math.tan(halfFov) * this.camera.aspect)
        const vertical = Math.abs(corner.y) / Math.tan(halfFov)
        this.camera.position.z = Math.max(this.camera.position.z, corner.z + Math.max(horizontal, vertical) + 0.08)
      }
    }
    this.camera.updateProjectionMatrix()
    // Cover-fit the hall backdrop: crop instead of stretching.
    const backdrop = this.scene.background instanceof THREE.Texture ? this.scene.background : this.backdrops.get(this.backdropName) ?? null
    const image = backdrop?.image as { width?: number; height?: number } | undefined
    if (backdrop && image?.width && image.height) {
      const cover = (w / h) / (image.width / image.height)
      backdrop.repeat.set(Math.min(1, 1 / cover), Math.min(1, cover))
      backdrop.offset.set((1 - backdrop.repeat.x) / 2, (1 - backdrop.repeat.y) / 2)
    }
    this.cube.resize(pr, h)
    this.styles?.setDustBase(pr * 1.4)
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
    const changed = this.style !== style
    this.style = style
    // Allocate the six panels only when requested; other styles keep their original render path.
    if (style === 'viki' && !this.vikiCube) {
      this.vikiCube = new VikiCube(this.headUniforms)
      if (this.rig) this.vikiCube.setGeometry(this.rig.geometry, this.rig.influences)
      this.vikiCube.applyConfig(this.config)
      this.group.add(this.vikiCube.group)
    }
    // The hall backdrop belongs to the VIKI scene only.
    this.scene.background = style === 'viki' ? this.backdropTexture() : null
    if (this.vikiCube) this.vikiCube.group.visible = style === 'viki'
    const s = this.styles
    this.cube.group.visible = style === 'lattice' && !new URLSearchParams(window.location.search).has('inspect')
    if (this.portrait) this.portrait.group.visible = style === 'lattice'
    if (s) {
      s.setTransition(style === 'lattice')
      s.dust.visible = style === 'dust'
      s.cage.visible = style === 'dust'
    }
    this.enclosure.mesh.visible = style === 'lattice' && this.config.optical && !new URLSearchParams(window.location.search).has('inspect')
    const shape = BLOOM_SHAPE[style]
    this.bloom.radius = shape.radius
    this.bloom.threshold = shape.threshold
    if (changed) this.resize()
  }

  /** Apply the configurator's settings for the current style. */
  applyConfig(cfg: HeadConfig) {
    const placementChanged = cfg.cubeScale !== this.config.cubeScale || cfg.cubeX !== this.config.cubeX
      || cfg.cubeY !== this.config.cubeY || cfg.cubeDepth !== this.config.cubeDepth
    this.config = cfg
    if (placementChanged && this.style === 'viki') this.resize()
    applyShapeConfig(this.headUniforms, cfg)
    applyPlacement(this.headUniforms, cfg, this.current.forward)
    this.enclosure.applyConfig(cfg)
    this.enclosure.mesh.visible = this.style === 'lattice' && cfg.optical && !new URLSearchParams(window.location.search).has('inspect')
    this.cube.applyConfig(cfg)
    this.vikiCube?.applyConfig(cfg)
    this.renderer.setClearColor(this.style === 'viki' ? 0x030607 : cfg.optical ? 0x020405 : 0x02050c, 1)
    // VIKI's glow slider diffuses the cube locally; keep the finished hall exposure stable.
    this.bloom.strength = this.style === 'viki' ? 0.46 : cfg.optical ? Math.min(0.25, cfg.bloom) : cfg.bloom
    this.portrait?.applyConfig(cfg)
    this.styles?.applyConfig(cfg)
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
    const transitioning = Math.abs(this.current.face - this.target.face) > 0.002 || (this.style === 'viki' && this.vikiAssembly.moving)
    const fps = this.drag.active ? DRAG_FPS : this.active || this.mouthSource || transitioning ? ACTIVE_FPS : IDLE_FPS
    const minInterval = 1000 / fps - 2
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
    let sample = this.mouthSource?.() ?? null
    this.visemes = sample?.visemes
    if (sample?.visemes && this.rig && !this.rig.rigged) {
      // The optional old scan has no lip targets; retain its procedural motion.
      const { pose } = mapVisemes(sample.visemes, this.config.speechStrength)
      sample = { ...sample, open: pose.jawOpen / 0.6, wide: pose.mouthWide,
        round: pose.mouthFunnel + pose.mouthPucker }
    }
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
    hu.uFormation.value = this.current.face < 0.001 ? 0 : this.current.face > 0.999 ? 1 : this.current.face
    if (this.style === 'viki') {
      const awake = this.active || this.target.face > 0
      this.vikiAssembly.update(dt, awake, FROZEN ? reviewNumber('assembly', awake ? 1 : 0) : undefined)
      hu.uFormation.value *= this.vikiAssembly.face
    }
    hu.uMouthOpen.value = this.mouth.open
    hu.uMouthWide.value = this.mouth.wide
    hu.uSmile.value = this.current.smile
    hu.uBrow.value = this.current.brow + Math.sin(t * 0.7) * 0.04
    hu.uEyeOpen.value = this.current.eyeOpen * blink
    this.rig?.update(this.mouth.open, this.mouth.wide, this.mouth.round, this.current.smile, this.current.brow, this.current.eyeOpen * blink, this.visemes, this.config.speechStrength)
    applyPlacement(hu, this.config, this.current.forward)

    if (this.styles) this.styles.dust.visible = this.style === 'dust' || (this.style === 'lattice' && hu.uFormation.value > 0 && hu.uFormation.value < 1)
    this.cube.update(t, hu.uFormation.value)
    this.styles?.setTime(t)
    this.portrait?.update(t, hu.uFormation.value, this.current.turb)
    if (this.style === 'viki') this.vikiCube?.update(t, hu.uFormation.value, this.vikiAssembly.cube, this.vikiAssembly.direction)

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
    const isViki = this.style === 'viki'
    this.group.rotation.y = FROZEN ? THREE.MathUtils.degToRad(reviewNumber('yaw', isViki ? 45 : 0)) : (isViki ? Math.PI / 4 : this.config.optical ? 0 : Math.sin(t * 0.18) * 0.08) + this.yaw
    this.group.rotation.x = FROZEN ? THREE.MathUtils.degToRad(reviewNumber('pitch', isViki ? -4 : 0)) : (isViki ? -0.07 : this.config.optical ? 0 : Math.sin(t * 0.13) * 0.03) + this.pitch
    this.group.scale.setScalar((FROZEN || this.config.optical || isViki ? 1 : 1 + Math.sin(t * 0.9) * 0.006) * (isViki ? this.config.cubeScale : 1))
    this.group.position.set(isViki ? this.config.cubeX : 0, isViki ? this.config.cubeY : 0, 0)

    const t0 = performance.now()
    this.headLight?.render(this.renderer, isViki)
    if (this.style === 'lattice' || this.debugQuad) this.facePass.render(this.renderer, Boolean(this.debugQuad))
    if (isViki && !this.debugQuad) this.vikiCube?.capture(this.renderer, this.camera)
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
    if (this.enclosure.mesh.visible) {
      this.enclosure.capture(this.renderer, this.scene, this.camera, t)
      // Transmission already contains these objects. Draw only the optical pane
      // in the display pass instead of rendering the head and cube a second time.
      const behind = this.group.children.filter((object) => object !== this.enclosure.mesh && object.visible)
      for (const object of behind) object.visible = false
      try { this.composer.render() } finally { for (const object of behind) object.visible = true }
    } else this.composer.render()
    this.frameMs += (performance.now() - t0 - this.frameMs) * 0.1
  }

  /** True once she is fully there: the VIKI cube finished assembling, or the face finished forming. */
  isFormed() {
    if (this.style === 'viki') return this.vikiAssembly.progress >= 0.999
    return this.current.face >= 0.97
  }

  /** Snapshot of the animated state (dev aid). */
  debug() {
    return {
      style: this.style,
      current: { ...this.current },
      target: { ...this.target },
      mouth: { ...this.mouth },
      visemes: this.visemes?.slice(),
      headLoaded: this.headLoaded,
      rigged: this.rig?.rigged,
      morphs: this.rig?.influences.slice(),
      active: this.active,
      pixelRatio: this.renderer.getPixelRatio(),
      yaw: Number(this.yaw.toFixed(3)),
      pitch: Number(this.pitch.toFixed(3)),
      renderedFps: this.renderedFps,
      cpuFrameMs: Number(this.frameMs.toFixed(2)),
      passes: this.composer.passes.map((p) => `${p.constructor.name}:${p.enabled ? 1 : 0}`),
      cubeVisible: this.cube.group.visible,
      vikiVisible: this.vikiCube?.group.visible ?? false,
      assembly: this.style === 'viki' ? { progress: this.vikiAssembly.progress, cube: this.vikiAssembly.cube, face: this.vikiAssembly.face, direction: this.vikiAssembly.direction } : undefined,
      shadows: this.headLight?.debug(),
    }
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    cancelAnimationFrame(this.raf)
    window.removeEventListener('resize', this.resize)
    this.canvas.removeEventListener('pointerdown', this.onPointerDown)
    window.removeEventListener('pointermove', this.onPointerMove)
    window.removeEventListener('pointerup', this.onPointerUp)
    window.removeEventListener('pointercancel', this.onPointerUp)
    document.removeEventListener('visibilitychange', this.onVisibility)
    this.enclosure.dispose()
    this.vikiCube?.dispose()
    for (const texture of this.backdrops.values()) texture.dispose()
    this.cube.dispose()
    this.styles?.dispose()
    this.portrait?.dispose()
    this.rig?.dispose()
    this.headLight?.dispose()
    this.facePass.dispose()
    // EffectComposer disposes its own targets, not the passes it contains.
    for (const pass of this.composer.passes) pass.dispose()
    this.bloom.materialHighPassFilter.dispose()
    if (this.debugQuad) {
      this.debugQuad.geometry.dispose()
      ;(this.debugQuad.material as THREE.Material).dispose()
    }
    this.composer.dispose()
    this.renderer.dispose()
  }
}
