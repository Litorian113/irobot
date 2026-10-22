import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { GazeSpring } from '../GazeSpring'
import type { Expression, HeadView, HeadViewOptions } from '../types'
import { HeadRig } from '../../viki/HeadRig'
import { REF_SCALE, STYLE_DEFAULTS, type HeadConfig } from '../../viki/config'
import { applyPlacement, applyShapeConfig, createHeadUniforms, HEAD_Z_ACTIVE } from '../../viki/headShader'
import { BACKDROP_FRAGMENT, BACKDROP_VERTEX, BODY_FRAGMENT, HEAD_VERTEX, INK_FRAGMENT, SHINE_FRAGMENT, TINT_FRAGMENT } from './shaders'

/**
 * G.L.A.S. - a head of peach-tinted glass, eyes closed like a sculpture, lips,
 * nose and ears in chrome, and dark ink flowing inside from the back of the
 * skull down the neck. The scan head with its morphs, drawn in four layers:
 * ink (opaque), the glass's back wall (multiply), its frosted body (blended)
 * and its shine (add).
 */

const CAM_DIST = 4.2
const FOV = 40
/** Pastel peach glass, a little deeper where it is thick. */
const TINT = new THREE.Color('#f6ddd2')
const DEEP = new THREE.Color('#efc4b2')

const CONFIG: HeadConfig = {
  ...STYLE_DEFAULTS.lattice,
  headScale: 0.52,
  headY: -0.82,
  neck: 1,
  hair: 0,
}

const FACES: Record<Expression, { smile: number; brow: number }> = {
  neutral: { smile: 0.15, brow: 0 },
  curious: { smile: 0.2, brow: 0.7 },
  happy: { smile: 0.75, brow: 0.2 },
}

export class GlassHead implements HeadView {
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 50)
  private group = new THREE.Group()
  private uniforms = createHeadUniforms()
  private ink: THREE.ShaderMaterial | null = null
  private rig: HeadRig | null = null
  private gaze: GazeSpring
  private pivot = new THREE.Vector3()
  private look = new THREE.Matrix4()
  private tmp = new THREE.Matrix4()
  private euler = new THREE.Euler(0, 0, 0, 'YXZ')
  private face = { smile: 0.15, brow: 0 }
  private faceTarget = { smile: 0.15, brow: 0 }
  private clock = new THREE.Clock()
  private resizeObserver: ResizeObserver
  private canvas: HTMLCanvasElement
  private fps: number
  private raf = 0
  private lastFrame = 0
  private renderedFps = 0
  private fpsCount = 0
  private fpsSince = 0
  private headLoaded = false
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
    this.renderer.setClearColor(0xf2eeea, 1)

    this.camera.position.set(0, 0, CAM_DIST)

    const wall = new THREE.Mesh(
      new THREE.PlaneGeometry(30, 16),
      new THREE.ShaderMaterial({ vertexShader: BACKDROP_VERTEX, fragmentShader: BACKDROP_FRAGMENT, depthWrite: false }),
    )
    wall.position.z = -6
    wall.renderOrder = -10
    this.scene.add(wall)

    const u = this.uniforms
    u.uFormation.value = 1
    applyShapeConfig(u, CONFIG)
    applyPlacement(u, CONFIG, 1)
    const s = CONFIG.headScale / REF_SCALE
    this.pivot.set(0, CONFIG.headY + 0.2 * s, HEAD_Z_ACTIVE)

    this.group.matrixAutoUpdate = false
    this.scene.add(this.group)

    void new GLTFLoader().loadAsync(`${import.meta.env.BASE_URL}models/VikiHead.glb`).then((gltf) => {
      if (this.disposed) return
      const rig = new HeadRig(gltf.scene)
      gltf.scene.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return
        object.geometry.dispose()
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) material.dispose()
      })
      this.rig = rig
      u.uRigged.value = rig.rigged ? 1 : 0
      this.build(rig.geometry)
      rig.bind(this.group)
      this.headLoaded = true
    }).catch((error: unknown) => console.error('[glass] head model failed to load', error))

    this.resizeObserver = new ResizeObserver(this.resize)
    this.resizeObserver.observe(canvas)
    this.resize()
    document.addEventListener('visibilitychange', this.onVisibility)
    this.tick()
  }

  /** Ink first (it writes depth), then the glass: back wall, tint, shine. */
  private build(geometry: THREE.BufferGeometry) {
    const u = this.uniforms
    const core = new THREE.Vector3(0, CONFIG.headY + 0.45 * CONFIG.headScale / REF_SCALE, HEAD_Z_ACTIVE)
    const layer = (fragmentShader: string, extra: Record<string, THREE.IUniform>, options: Partial<THREE.ShaderMaterialParameters>, order: number) => {
      const material = new THREE.ShaderMaterial({
        uniforms: { ...u, uShrink: { value: 1 }, uCore: { value: core }, ...extra },
        vertexShader: HEAD_VERTEX,
        fragmentShader,
        ...options,
      })
      const mesh = new THREE.Mesh(geometry, material)
      mesh.frustumCulled = false
      mesh.renderOrder = order
      this.group.add(mesh)
      return material
    }
    this.ink = layer(INK_FRAGMENT, { uShrink: { value: 0.9 }, uTime: { value: 0 } }, { side: THREE.DoubleSide }, 0)
    const glass = { transparent: true, depthWrite: false }
    layer(TINT_FRAGMENT, { uTint: { value: DEEP }, uBack: { value: 1 } }, { ...glass, side: THREE.BackSide, blending: THREE.MultiplyBlending }, 1)
    // Depth only: the outermost surface. Body and shine then draw just there, so the
    // inner surfaces of the scan (eye sockets, mouth) never show through the glass.
    layer(BODY_FRAGMENT, { uTint: { value: TINT }, uDeep: { value: DEEP } }, { side: THREE.FrontSide, colorWrite: false }, 2)
    const outer = { ...glass, side: THREE.FrontSide, depthFunc: THREE.LessEqualDepth }
    layer(BODY_FRAGMENT, { uTint: { value: TINT }, uDeep: { value: DEEP } }, outer, 3)
    layer(SHINE_FRAGMENT, { uWarm: { value: TINT } }, { ...outer, blending: THREE.AdditiveBlending }, 4)
  }

  private resize = () => {
    const w = this.canvas.clientWidth || window.innerWidth
    const h = this.canvas.clientHeight || window.innerHeight
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / h
    const halfFov = THREE.MathUtils.degToRad(FOV / 2)
    this.camera.position.z = Math.max(CAM_DIST, 1.0 + 2.3 / (2 * Math.tan(halfFov) * this.camera.aspect))
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
    Object.assign(this.faceTarget, FACES[expression])
  }

  private tick = () => {
    if (this.disposed) return
    this.raf = requestAnimationFrame(this.tick)
    const now = performance.now()
    if (now - this.lastFrame < 1000 / this.fps - 2) return
    this.lastFrame = now
    const dt = Math.min(this.clock.getDelta(), 0.1)
    const t = this.clock.elapsedTime

    const k = 1 - Math.exp(-4 * dt)
    this.face.smile += (this.faceTarget.smile - this.face.smile) * k
    this.face.brow += (this.faceTarget.brow - this.face.brow) * k
    // Eyes closed, like a sculpture; the face only smiles and lifts its brows.
    this.rig?.update(0, 0, 0, this.face.smile, this.face.brow + Math.sin(t * 0.6) * 0.03, 0)
    if (this.ink) this.ink.uniforms.uTime.value = t

    const pose = this.gaze.update(dt, t)
    this.euler.set(-pose.pitch, pose.yaw, 0, 'YXZ')
    this.look.makeTranslation(this.pivot.x, this.pivot.y, this.pivot.z)
      .multiply(this.tmp.makeRotationFromEuler(this.euler))
      .multiply(this.tmp.makeTranslation(-this.pivot.x, -this.pivot.y, -this.pivot.z))
    this.group.matrix.copy(this.look)
    this.group.matrixWorldNeedsUpdate = true

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
      style: 'glass',
      webgl: this.renderer.capabilities.isWebGL2 ? 2 : 1,
      headLoaded: this.headLoaded,
      renderedFps: this.renderedFps,
      yaw: Number(this.gaze.yaw.toFixed(3)),
      pitch: Number(this.gaze.pitch.toFixed(3)),
      goal: { ...this.gaze.goal },
    }
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    cancelAnimationFrame(this.raf)
    this.resizeObserver.disconnect()
    document.removeEventListener('visibilitychange', this.onVisibility)
    this.scene.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return
      ;(object.material as THREE.Material).dispose()
      if (object.renderOrder === -10) object.geometry.dispose() // the wall; the head geometry is the rig's
    })
    this.rig?.dispose()
    this.renderer.dispose()
  }
}
