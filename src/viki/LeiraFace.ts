import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { HeadRig } from './HeadRig'
import type { HeadRenderer } from './HeadRenderer'
import { STYLE_DEFAULTS, type HeadConfig } from './config'
import { EXPRESSIONS, type Expression, type FaceState, type MouthSample } from './ParticleFace'

/** LEIRA's starting point: one mesh, two lights, one direct render, no offscreen passes. */
export class LeiraFace implements HeadRenderer {
  private renderer: THREE.WebGLRenderer
  private canvas: HTMLCanvasElement
  private scene = new THREE.Scene()
  private camera = new THREE.PerspectiveCamera(40, 1, 0.1, 30)
  private group = new THREE.Group()
  private material = new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 18, specular: 0x222222 })
  private key = new THREE.DirectionalLight(0xffffff, 2)
  private fill = new THREE.HemisphereLight(0xddeaff, 0x252333, 1)
  private rig: HeadRig | null = null
  private mesh: THREE.Mesh | null = null
  private config: HeadConfig = { ...STYLE_DEFAULTS.leira }
  private expression = { ...EXPRESSIONS.neutral }
  private target = { ...EXPRESSIONS.neutral }
  private mouth = { open: 0, wide: 0, round: 0 }
  private mouthSource: (() => MouthSample | null) | null = null
  private active = false
  private disposed = false
  private raf = 0
  private lastFrame = 0
  private nextBlink = 0
  private blinkStart = -1
  private drag: { id: number; x: number; y: number } | null = null
  private frames = 0
  private fpsSince = performance.now()
  private renderedFps = 0

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'low-power' })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1))
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.camera.position.z = 4.2
    this.scene.add(this.group, this.key, this.fill)
    this.applyConfig(this.config)
    this.resize()
    window.addEventListener('resize', this.resize)
    canvas.addEventListener('pointerdown', this.onPointerDown)
    canvas.addEventListener('pointermove', this.onPointerMove)
    canvas.addEventListener('pointerup', this.onPointerUp)
    canvas.addEventListener('pointercancel', this.onPointerUp)
    document.addEventListener('visibilitychange', this.onVisibility)
    void this.loadHead().catch(error => {
      if (!this.disposed) console.error('[leira] head model failed to load', error)
    })
    this.tick()
  }

  private async loadHead() {
    const gltf = await new GLTFLoader().loadAsync(`${import.meta.env.BASE_URL}models/VikiHead.glb`)
    try {
      if (this.disposed) return
      this.rig = new HeadRig(gltf.scene)
    } finally {
      gltf.scene.traverse(object => {
        if (!(object instanceof THREE.Mesh)) return
        object.geometry.dispose()
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
          for (const value of Object.values(material)) if (value instanceof THREE.Texture) value.dispose()
          material.dispose()
        }
      })
    }
    const geometry = this.rig.geometry
    geometry.computeBoundingBox()
    const box = geometry.boundingBox!
    const center = box.getCenter(new THREE.Vector3())
    const scale = 1.9 / box.getSize(new THREE.Vector3()).y
    this.mesh = new THREE.Mesh(geometry, this.material)
    this.mesh.scale.setScalar(scale)
    this.mesh.position.copy(center).multiplyScalar(-scale)
    this.group.add(this.mesh)
    this.rig.bind(this.group)
    this.applyConfig(this.config)
  }

  applyConfig(config: HeadConfig) {
    this.config = { ...config }
    this.scene.background = new THREE.Color(config.colorA)
    this.renderer.toneMappingExposure = config.gain
    this.group.scale.setScalar(config.headScale / STYLE_DEFAULTS.leira.headScale)
    this.group.position.y = 0.18 + (config.headY - STYLE_DEFAULTS.leira.headY) * 2
    const elevation = THREE.MathUtils.degToRad(config.lightElevation)
    this.key.position.set(config.lighting === 'butterfly' ? 0 : -2, Math.sin(elevation) * 5, Math.cos(elevation) * 5)
    this.fill.intensity = 0.3 + config.lightFill * 3
    if (!this.rig) return
    const geometry = this.rig.geometry
    const feature = geometry.getAttribute('aFeature')
    const colors = geometry.getAttribute('color') as THREE.BufferAttribute | undefined
    const attribute = colors ?? new THREE.Float32BufferAttribute(new Float32Array(feature.count * 3), 3)
    const skin = new THREE.Color(config.colorB)
    const eyes = new THREE.Color(config.colorC)
    const mouth = new THREE.Color(0x17121a)
    for (let i = 0; i < feature.count; i++) {
      const color = feature.getX(i) === 1 ? eyes : feature.getX(i) === 2 ? mouth : skin
      attribute.setXYZ(i, color.r, color.g, color.b)
    }
    geometry.setAttribute('color', attribute)
    attribute.needsUpdate = true
  }

  setExpression(expression: Expression) { this.target = { ...EXPRESSIONS[expression] } }
  setTarget(state: Partial<FaceState>) {
    for (const key of ['smile', 'brow', 'eyeOpen'] as const) {
      if (state[key] !== undefined) this.target[key] = state[key]
    }
  }
  setMouthSource(source: (() => MouthSample | null) | null) { this.mouthSource = source }
  setActive(active: boolean) { this.active = active }
  setBackdrop(_name: string) { /* LEIRA uses only a solid background. */ }
  isFormed() { return this.rig !== null }
  resetView() { this.group.rotation.set(0, 0, 0) }

  private resize = () => {
    const width = this.canvas.clientWidth || window.innerWidth
    const height = this.canvas.clientHeight || window.innerHeight
    this.renderer.setSize(width, height, false)
    this.camera.aspect = width / height
    this.camera.position.z = Math.max(4.2, 2.6 / this.camera.aspect)
    this.camera.updateProjectionMatrix()
  }

  private onPointerDown = (event: PointerEvent) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    this.drag = { id: event.pointerId, x: event.clientX, y: event.clientY }
    this.canvas.setPointerCapture(event.pointerId)
    this.canvas.style.cursor = 'grabbing'
  }
  private onPointerMove = (event: PointerEvent) => {
    if (!this.drag || event.pointerId !== this.drag.id) return
    this.group.rotation.y += (event.clientX - this.drag.x) * 0.006
    this.group.rotation.x = THREE.MathUtils.clamp(this.group.rotation.x + (event.clientY - this.drag.y) * 0.006, -0.9, 0.9)
    this.drag.x = event.clientX
    this.drag.y = event.clientY
  }
  private onPointerUp = (event: PointerEvent) => {
    if (event.pointerId !== this.drag?.id) return
    if (this.canvas.hasPointerCapture(event.pointerId)) this.canvas.releasePointerCapture(event.pointerId)
    this.drag = null
    this.canvas.style.cursor = 'grab'
  }
  private onVisibility = () => {
    cancelAnimationFrame(this.raf)
    if (!document.hidden && !this.disposed) { this.lastFrame = 0; this.tick() }
  }

  private tick = () => {
    if (this.disposed || document.hidden) return
    this.raf = requestAnimationFrame(this.tick)
    const now = performance.now()
    const fps = this.active || this.mouthSource || this.drag ? 30 : 12
    if (now - this.lastFrame < 1000 / fps - 1) return
    const dt = Math.min((now - this.lastFrame) / 1000, 0.1)
    this.lastFrame = now
    if (now > this.nextBlink) { this.blinkStart = now; this.nextBlink = now + 3000 + Math.random() * 3000 }
    const blink = Math.sin(Math.PI * THREE.MathUtils.clamp((now - this.blinkStart) / 220, 0, 1)) ** 2
    const sample = this.mouthSource?.()
    const blend = 1 - Math.exp(-18 * dt)
    this.mouth.open += ((sample?.open ?? 0) - this.mouth.open) * blend
    this.mouth.wide += ((sample?.wide ?? 0) - this.mouth.wide) * blend
    this.mouth.round += ((sample?.round ?? (sample ? sample.open * (1 - sample.wide) : 0)) - this.mouth.round) * blend
    for (const key of ['smile', 'brow', 'eyeOpen'] as const) this.expression[key] += (this.target[key] - this.expression[key]) * (1 - Math.exp(-5 * dt))
    this.rig?.update(this.mouth.open, this.mouth.wide, this.mouth.round,
      this.expression.smile, this.expression.brow, this.expression.eyeOpen * (1 - blink), sample?.visemes, this.config.speechStrength)
    if (!this.drag && this.config.autoReturn) {
      this.group.rotation.x *= Math.exp(-1.8 * dt)
      this.group.rotation.y *= Math.exp(-1.8 * dt)
    }
    this.renderer.render(this.scene, this.camera)
    this.frames++
    if (now - this.fpsSince >= 1000) {
      this.renderedFps = Math.round(this.frames * 1000 / (now - this.fpsSince))
      this.frames = 0
      this.fpsSince = now
    }
  }

  debug() {
    return {
      style: 'leira', headLoaded: Boolean(this.rig), rigged: this.rig?.rigged,
      active: this.active, mouth: { ...this.mouth }, morphs: this.rig?.influences.slice(),
      pixelRatio: this.renderer.getPixelRatio(), renderedFps: this.renderedFps,
      passes: ['direct'], drawCalls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles, geometries: this.renderer.info.memory.geometries,
      textures: this.renderer.info.memory.textures, disposed: this.disposed,
    }
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    cancelAnimationFrame(this.raf)
    if (this.drag && this.canvas.hasPointerCapture(this.drag.id)) this.canvas.releasePointerCapture(this.drag.id)
    this.canvas.style.cursor = 'grab'
    window.removeEventListener('resize', this.resize)
    document.removeEventListener('visibilitychange', this.onVisibility)
    this.canvas.removeEventListener('pointerdown', this.onPointerDown)
    this.canvas.removeEventListener('pointermove', this.onPointerMove)
    this.canvas.removeEventListener('pointerup', this.onPointerUp)
    this.canvas.removeEventListener('pointercancel', this.onPointerUp)
    this.rig?.dispose()
    this.material.dispose()
    this.renderer.dispose()
  }
}
