import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { FacePass } from './FacePass'
import { SceneBackdrop } from './SceneBackdrop'
import { REF_SCALE, STYLE_DEFAULTS, type HeadConfig, type HeadStyle } from './config'
import { applyPlacement, applyShapeConfig, createHeadUniforms, HEAD_Z_ACTIVE } from './headShader'
import { createStyles, type StyleSet } from './styles'
import { LayeredPortrait } from './LayeredPortrait'
import { HeadRig } from './HeadRig'
import { HeadLight } from './HeadLight'
import { DustRadialBlur } from './DustRadialBlur'
import type { HeadView, HeadViewOptions } from '../heads/types'
import { GazeSpring } from '../heads/GazeSpring'

export type Expression = 'neutral' | 'happy' | 'curious'

export const EXPRESSIONS: Record<Expression, { smile: number; brow: number; eyeOpen: number }> = {
  neutral: { smile: 0.25, brow: 0.08, eyeOpen: 1.0 },
  happy: { smile: 0.85, brow: 0.25, eyeOpen: 0.85 },
  curious: { smile: 0.2, brow: 0.65, eyeOpen: 1.1 },
}

type FaceState = (typeof EXPRESSIONS)[Expression]

export interface FaceOptions extends HeadViewOptions {
  style: HeadStyle
  /** Per-head tweaks on top of the style defaults (shape, colours). */
  config?: Partial<HeadConfig>
}

const CAM_DIST = 4.2
const FOV = 40

/** Bloom radius / threshold per style (strength comes from the config). */
const BLOOM_SHAPE: Record<HeadStyle, { radius: number; threshold: number }> = {
  lattice: { radius: 0.3, threshold: 0.75 },
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

/** Smooth-follow rates per expression parameter (higher = snappier). */
const RATES: Record<keyof FaceState, number> = { smile: 3.0, brow: 3.0, eyeOpen: 6.0 }

/** A single, always-formed head that turns to look at a point. */
export class ParticleFace implements HeadView {
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera: THREE.PerspectiveCamera
  private composer: EffectComposer
  private softClamp: ShaderPass
  private bloom: UnrealBloomPass
  private dustBlur = new DustRadialBlur()
  private sceneBackdrop = new SceneBackdrop()
  private headUniforms = createHeadUniforms()
  private facePass = new FacePass(this.headUniforms, 256)
  private styles: StyleSet | null = null
  private portrait: LayeredPortrait | null = null
  private rig: HeadRig | null = null
  private headLight: HeadLight | null = null
  private group = new THREE.Group()
  private clock = new THREE.Clock()
  private resizeObserver: ResizeObserver
  private raf = 0
  private disposed = false
  private lastFrame = 0
  private frameMs = 0
  private renderedFps = 0
  private fpsCount = 0
  private fpsSince = 0
  private canvas: HTMLCanvasElement
  private style: HeadStyle
  private config: HeadConfig
  private fps: number
  private headLoaded = false

  private current: FaceState = { ...EXPRESSIONS.neutral }
  private target: FaceState = { ...this.current }

  private gaze: GazeSpring
  private lookMatrix = new THREE.Matrix4()
  private pivot = new THREE.Vector3()
  private tmpMatrix = new THREE.Matrix4()
  private tmpEuler = new THREE.Euler(0, 0, 0, 'YXZ')

  private nextBlink = 2
  private blinkUntil = -1

  constructor(canvas: HTMLCanvasElement, opts: FaceOptions) {
    this.canvas = canvas
    this.style = opts.style
    this.config = { ...STYLE_DEFAULTS[opts.style], ...opts.config }
    this.fps = opts.fps ?? 30
    this.gaze = new GazeSpring(opts.stiffness ?? 5, opts.delay ?? 0)
    this.nextBlink = 1 + Math.random() * 4

    const attributes: WebGLContextAttributes = { antialias: false, alpha: false, powerPreference: 'high-performance' }
    // A WebGL 1 context handed in keeps three.js on its WebGL 1 path, as on the old iMacs.
    const context = opts.webgl1 ? canvas.getContext('webgl', attributes) ?? undefined : undefined
    this.renderer = new THREE.WebGLRenderer({ canvas, context, ...attributes })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, opts.maxPixelRatio ?? 1.5))
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 0.95

    this.camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 50)
    this.camera.position.set(0, 0, CAM_DIST)

    this.group.matrixAutoUpdate = false
    this.scene.add(this.group)
    this.scene.add(this.sceneBackdrop.mesh)
    this.sceneBackdrop.setStyle()

    this.composer = new EffectComposer(this.renderer)
    this.composer.addPass(new RenderPass(this.scene, this.camera))
    this.softClamp = new ShaderPass(SoftClampShader)
    this.composer.addPass(this.softClamp)
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.5, 0.3, 0.75)
    this.composer.addPass(this.bloom)
    this.composer.addPass(this.dustBlur)
    this.composer.addPass(new OutputPass())

    const lattice = this.style === 'lattice'
    this.softClamp.enabled = !lattice
    this.bloom.enabled = !lattice
    this.bloom.radius = BLOOM_SHAPE[this.style].radius
    this.bloom.threshold = BLOOM_SHAPE[this.style].threshold
    this.bloom.strength = lattice ? 0 : this.config.bloom
    this.renderer.setClearColor(0x02050c, 1)

    // Every head is formed from the first frame: no assembly, no dissolve.
    this.headUniforms.uFormation.value = 1
    applyShapeConfig(this.headUniforms, this.config)
    applyPlacement(this.headUniforms, this.config, 1)
    this.updatePivot()

    void this.loadHead(`${import.meta.env.BASE_URL}models/VikiHead.glb`).catch((e) => {
      console.error('[head] model failed to load', e)
    })

    this.resizeObserver = new ResizeObserver(this.resize)
    this.resizeObserver.observe(canvas)
    this.resize()
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
    this.headLight = new HeadLight(this.headUniforms, geometry, rig.influences)
    if (this.style === 'lattice') {
      this.portrait = new LayeredPortrait(this.headUniforms, this.facePass.views.front.target.texture, this.facePass.views.back.target.texture)
      this.portrait.applyConfig(this.config)
      this.facePass.setFraming(this.portrait.extent, this.portrait.centerY)
      this.scene.add(this.portrait.group) // the tile slab faces the camera; the head turns inside the capture
    } else {
      const styles = createStyles(this.headUniforms, geometry, CAM_DIST)
      styles.setTransition(false)
      styles.applyConfig(this.config)
      styles.dust.visible = true
      styles.cage.visible = true
      this.styles = styles
      this.group.add(styles.dust, styles.cage)
    }
    rig.bind(this.group)
    this.headLoaded = true
    this.resize()
  }

  /** The head turns around a point in its neck, so the face stays framed. */
  private updatePivot() {
    const sy = this.config.headScale * (1 + this.config.oval)
    this.pivot.set(0, this.config.headY + 0.2 * sy / REF_SCALE, HEAD_Z_ACTIVE)
  }

  private resize = () => {
    const w = this.canvas.clientWidth || window.innerWidth
    const h = this.canvas.clientHeight || window.innerHeight
    const pr = this.renderer.getPixelRatio()
    this.renderer.setSize(w, h, false)
    this.composer.setSize(w, h)
    this.camera.aspect = w / h
    // Keep the head in frame on narrow screens.
    const halfFov = THREE.MathUtils.degToRad(FOV * 0.5)
    this.camera.position.z = Math.max(CAM_DIST, 1.0 + 2.3 / (2 * Math.tan(halfFov) * this.camera.aspect))
    this.camera.updateProjectionMatrix()
    this.styles?.setDustBase(pr * 1.4 * Math.min(1, h / 700 + 0.35))
    this.styles?.setFieldView(this.camera)
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

  setExpression(expr: Expression) {
    Object.assign(this.target, EXPRESSIONS[expr])
  }

  /** Where to look: yaw > 0 turns the face to screen-right, pitch > 0 looks up (radians). */
  setLook(yaw: number, pitch: number) {
    this.gaze.set(yaw, pitch)
  }

  private updateGaze(dt: number, t: number) {
    const pose = this.gaze.update(dt, t)
    this.tmpEuler.set(-pose.pitch, pose.yaw, 0, 'YXZ')
    this.lookMatrix.makeTranslation(this.pivot.x, this.pivot.y, this.pivot.z)
      .multiply(this.tmpMatrix.makeRotationFromEuler(this.tmpEuler))
      .multiply(this.tmpMatrix.makeTranslation(-this.pivot.x, -this.pivot.y, -this.pivot.z))
    if (this.style === 'lattice') this.facePass.setLook(this.lookMatrix)
    else {
      this.group.matrix.copy(this.lookMatrix)
      this.group.matrixWorldNeedsUpdate = true
    }
  }

  private tick = () => {
    if (this.disposed) return
    this.raf = requestAnimationFrame(this.tick)

    const now = performance.now()
    if (now - this.lastFrame < 1000 / this.fps - 2) return
    this.lastFrame = now

    const dt = Math.min(this.clock.getDelta(), 0.1)
    const t = this.clock.elapsedTime

    for (const key of Object.keys(RATES) as (keyof FaceState)[]) {
      const k = 1 - Math.exp(-RATES[key] * dt)
      this.current[key] += (this.target[key] - this.current[key]) * k
    }

    // blink
    if (t > this.nextBlink) {
      this.blinkUntil = t + 0.22
      this.nextBlink = t + 2.5 + Math.random() * 4
    }
    const blinkPhase = THREE.MathUtils.clamp(1 - (this.blinkUntil - t) / 0.22, 0, 1)
    const blink = 1 - Math.pow(Math.sin(blinkPhase * Math.PI), 2)

    const hu = this.headUniforms
    hu.uSmile.value = this.current.smile
    hu.uBrow.value = this.current.brow + Math.sin(t * 0.7) * 0.04
    hu.uEyeOpen.value = this.current.eyeOpen * blink
    this.rig?.update(0, 0, 0, this.current.smile, this.current.brow, this.current.eyeOpen * blink)

    this.updateGaze(dt, t)
    this.styles?.setTime(t)
    this.sceneBackdrop.update(t)
    this.portrait?.update(t)
    const presence = this.style === 'dust' && this.headLoaded ? 1 : 0
    this.dustBlur.setStrength((this.config.radialBlur ?? 0) * presence)
    this.dustBlur.update(hu.uHeadMatrix.value, this.group, this.camera)

    const t0 = performance.now()
    this.headLight?.render(this.renderer, true)
    if (this.style === 'lattice') this.facePass.render(this.renderer, false, true)
    this.composer.render()

    this.frameMs += (performance.now() - t0 - this.frameMs) * 0.1
    this.fpsCount++
    if (now - this.fpsSince > 1000) {
      this.renderedFps = this.fpsCount
      this.fpsCount = 0
      this.fpsSince = now
    }
  }

  /** Snapshot of the animated state (dev aid). */
  debug() {
    return {
      style: this.style,
      webgl: this.renderer.capabilities.isWebGL2 ? 2 : 1,
      headLoaded: this.headLoaded,
      yaw: Number(this.gaze.yaw.toFixed(3)),
      pitch: Number(this.gaze.pitch.toFixed(3)),
      goal: { ...this.gaze.goal },
      expression: { ...this.current },
      renderedFps: this.renderedFps,
      cpuFrameMs: Number(this.frameMs.toFixed(2)),
      shadows: this.headLight?.debug(),
    }
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    cancelAnimationFrame(this.raf)
    this.resizeObserver.disconnect()
    document.removeEventListener('visibilitychange', this.onVisibility)
    this.styles?.dispose()
    this.portrait?.dispose()
    this.rig?.dispose()
    this.headLight?.dispose()
    this.sceneBackdrop.dispose()
    this.facePass.dispose()
    // EffectComposer disposes its own targets, not the passes it contains.
    for (const pass of this.composer.passes) pass.dispose()
    this.bloom.materialHighPassFilter.dispose()
    this.composer.dispose()
    this.renderer.dispose()
  }
}
