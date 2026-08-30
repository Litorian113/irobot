import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
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
const GRID_Y = 72
const GRID_Z = 28
const CAM_DIST = 4.2
const FOV = 40

/** Smooth-follow per parameter (units of "fraction per second" style time constants). */
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
  private group = new THREE.Group()
  private clock = new THREE.Clock()
  private raf = 0
  private disposed = false

  private current: FaceState = { face: 0.15, turb: 0.35, smile: 0.05, brow: 0, eyeOpen: 1 }
  private target: FaceState = { ...this.current }

  private mouth: MouthSample = { open: 0, wide: 0 }
  private mouthSource: (() => MouthSample | null) | null = null

  private pointer = { x: 0, y: 0 }
  private pointerSmooth = { x: 0, y: 0 }

  private nextBlink = 2
  private blinkUntil = -1
  private canvas: HTMLCanvasElement

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.setClearColor(0x02050c, 1)
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.05

    this.camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 50)
    this.camera.position.set(0, 0, CAM_DIST)

    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uFace: { value: this.current.face },
        uMouthOpen: { value: 0 },
        uMouthWide: { value: 0 },
        uSmile: { value: this.current.smile },
        uBrow: { value: this.current.brow },
        uEyeOpen: { value: this.current.eyeOpen },
        uTurb: { value: this.current.turb },
        uPointBase: { value: 4 },
        uCamDist: { value: CAM_DIST },
        uColorDim: { value: new THREE.Color(0x1d3f8a) },
        uColorBright: { value: new THREE.Color(0x67b4ff) },
        uColorHot: { value: new THREE.Color(0xe8f6ff) },
      },
    })

    const points = new THREE.Points(this.buildGrid(), this.material)
    points.frustumCulled = false
    this.group.add(points)
    this.scene.add(this.group)

    this.composer = new EffectComposer(this.renderer)
    this.composer.addPass(new RenderPass(this.scene, this.camera))
    this.composer.addPass(new ShaderPass(SoftClampShader))
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.55, 0.35, 0.75)
    this.composer.addPass(this.bloom)
    this.composer.addPass(new OutputPass())

    this.resize()
    window.addEventListener('resize', this.resize)
    window.addEventListener('pointermove', this.onPointer)
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
    this.bloom.resolution.set(w, h)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    // device pixels per world unit at the camera's focal distance
    const pxPerUnit = (h * pr) / (2 * CAM_DIST * Math.tan((FOV * Math.PI) / 360))
    this.material.uniforms.uPointBase.value = pxPerUnit * (2 / (GRID_X - 1)) * 1.15
  }

  private onPointer = (e: PointerEvent) => {
    this.pointer.x = (e.clientX / window.innerWidth) * 2 - 1
    this.pointer.y = (e.clientY / window.innerHeight) * 2 - 1
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

  private tick = () => {
    if (this.disposed) return
    this.raf = requestAnimationFrame(this.tick)
    const dt = Math.min(this.clock.getDelta(), 0.05)
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

    // subtle life: micro brow drift, breathing scale
    const u = this.material.uniforms
    u.uTime.value = t
    u.uFace.value = this.current.face
    u.uTurb.value = this.current.turb
    u.uSmile.value = this.current.smile
    u.uBrow.value = this.current.brow + Math.sin(t * 0.7) * 0.04
    u.uEyeOpen.value = this.current.eyeOpen * blink
    u.uMouthOpen.value = this.mouth.open
    u.uMouthWide.value = this.mouth.wide

    // lattice rotation with pointer parallax
    this.pointerSmooth.x += (this.pointer.x - this.pointerSmooth.x) * (1 - Math.exp(-3 * dt))
    this.pointerSmooth.y += (this.pointer.y - this.pointerSmooth.y) * (1 - Math.exp(-3 * dt))
    this.group.rotation.y = Math.sin(t * 0.18) * 0.22 + this.pointerSmooth.x * 0.28
    this.group.rotation.x = Math.sin(t * 0.13) * 0.06 - this.pointerSmooth.y * 0.14
    const breathe = 1 + Math.sin(t * 0.9) * 0.006
    this.group.scale.setScalar(breathe)

    this.composer.render()
  }

  /** Snapshot of the animated state (dev aid). */
  debug() {
    const u = this.material.uniforms
    const uniforms: Record<string, unknown> = {}
    for (const k of Object.keys(u)) if (typeof u[k].value === 'number') uniforms[k] = u[k].value
    return { current: { ...this.current }, target: { ...this.target }, mouth: { ...this.mouth }, uniforms }
  }

  dispose() {
    this.disposed = true
    cancelAnimationFrame(this.raf)
    window.removeEventListener('resize', this.resize)
    window.removeEventListener('pointermove', this.onPointer)
    this.group.traverse((o) => {
      if (o instanceof THREE.Points) o.geometry.dispose()
    })
    this.material.dispose()
    this.composer.dispose()
    this.renderer.dispose()
  }
}
