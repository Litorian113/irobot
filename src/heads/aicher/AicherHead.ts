import * as THREE from 'three'
import { GazeSpring } from '../GazeSpring'
import type { Expression, HeadView, HeadViewOptions } from '../types'
import { BUST_FRAGMENT, BUST_VERTEX, PASS_VERTEX, WALL_FRAGMENT } from './shaders'

/**
 * O.T.L. - Otl Aicher's head, cut into large painted facets: mint where the
 * light falls, teal and blue into indigo in the shadows, on a red wall, the
 * neck running out of the frame into a dark shirt collar. The head turns on
 * the neck, the brows rise and fall, and when he is pleased he smiles until
 * his eyes are slits.
 * The mesh is built by scripts/build_aicher.py; see public/models/AicherHead.json.
 * WebGL 1 safe: facet normals on the CPU, plain GLSL ES 1.0.
 */

const MODEL = `${import.meta.env.BASE_URL}models/AicherHead`
const FOV = 32
// At eye level, like looking at him across a table.
const CAM = new THREE.Vector3(0, 0.45, 3.5)
const LOOK = new THREE.Vector3(0, 0.38, 0)
/** Light from the upper right, a little in front. */
const KEY = new THREE.Vector3(0.75, 0.55, 0.6).normalize()
/** He turns his head a little less than the robots. */
const TURN = 0.75
const BLINK_EVERY = [2.5, 6]
const BLINK_LENGTH = 0.18
/** A band of light passes over the head now and then (seconds). */
const SWEEP_EVERY = [7, 14]
const SWEEP_LENGTH = 2.2

type Morph = 'smile' | 'blink' | 'browUp' | 'browDown'
const FACES: Record<Expression, Record<Exclude<Morph, 'blink'>, number>> = {
  // His resting face: a hint of a smile under heavy brows.
  neutral: { smile: 0.4, browUp: 0, browDown: 0.3 },
  curious: { smile: 0.1, browUp: 0.85, browDown: 0 },
  happy: { smile: 1, browUp: 0.15, browDown: 0 },
}

interface AicherModel {
  vertices: number
  triangles: number
  morphs: Morph[]
}

const between = ([lo, hi]: number[]) => lo + Math.random() * (hi - lo)

export class AicherHead implements HeadView {
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 60)
  private material: THREE.ShaderMaterial
  private wall: THREE.ShaderMaterial
  private gaze: GazeSpring
  /** Low-poly vertices and their morph deltas, filled once the model is loaded. */
  private base: Float32Array | null = null
  private deltas: Partial<Record<Morph, Float32Array>> = {}
  private indices: Uint16Array | null = null
  private geometry: THREE.BufferGeometry | null = null
  private morphed: Float32Array | null = null
  private weights: Record<Morph, number> = { smile: 0.4, blink: 0, browUp: 0, browDown: 0.3 }
  private applied = ''
  private faceTarget = { ...FACES.neutral }
  private nextBlink = 1.5
  private blinkUntil = -1
  private nextSweep = between([2, 4])
  private sweepAt = -100
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
    this.nextBlink = 1 + Math.random() * 3

    const attributes: WebGLContextAttributes = { antialias: true, alpha: false, powerPreference: 'high-performance' }
    // A WebGL 1 context handed in keeps three.js on its WebGL 1 path, as on the old iMacs.
    const context = opts.webgl1 ? canvas.getContext('webgl', attributes) ?? undefined : undefined
    this.renderer = new THREE.WebGLRenderer({ canvas, context, ...attributes })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, opts.maxPixelRatio ?? 1.5))
    this.renderer.setClearColor(0x5a0a0d, 1)

    this.camera.position.copy(CAM)
    this.camera.lookAt(LOOK)

    this.wall = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: PASS_VERTEX,
      fragmentShader: WALL_FRAGMENT,
      depthWrite: false,
    })
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(16, 9), this.wall)
    wall.position.z = -3
    wall.renderOrder = -10
    this.scene.add(wall)

    this.material = new THREE.ShaderMaterial({
      uniforms: { uYaw: { value: 0 }, uPitch: { value: 0 }, uKey: { value: KEY }, uSweep: { value: -10 }, uTime: { value: 0 } },
      vertexShader: BUST_VERTEX,
      fragmentShader: BUST_FRAGMENT,
      side: THREE.DoubleSide,
    })

    this.resizeObserver = new ResizeObserver(this.resize)
    this.resizeObserver.observe(canvas)
    this.resize()
    document.addEventListener('visibilitychange', this.onVisibility)
    void this.load().catch((error) => console.error('[aicher] model failed to load', error))
    this.tick()
  }

  private async load() {
    const [info, buffer] = await Promise.all([
      fetch(`${MODEL}.json`).then((r) => r.json() as Promise<AicherModel>),
      fetch(`${MODEL}.bin`).then((r) => r.arrayBuffer()),
    ])
    if (this.disposed) return
    const v = info.vertices * 3
    let offset = 0
    const floats = (n: number) => {
      const array = new Float32Array(buffer, offset, n)
      offset += n * 4
      return array
    }
    this.base = floats(v)
    for (const name of info.morphs) this.deltas[name] = floats(v)
    this.indices = new Uint16Array(buffer, offset, info.triangles * 3)
    offset += info.triangles * 6
    const regions = new Uint8Array(buffer, offset, info.triangles)

    // One vertex per corner: every facet keeps its own normal and region.
    const corners = info.triangles * 3
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(corners * 3), 3))
    geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(corners * 3), 3))
    geometry.setAttribute('aRegion', new THREE.BufferAttribute(Float32Array.from({ length: corners }, (_, i) => regions[Math.floor(i / 3)]), 1))
    geometry.setAttribute('aFacet', new THREE.BufferAttribute(Float32Array.from({ length: corners }, (_, i) => Math.floor(i / 3)), 1))
    this.morphed = new Float32Array(v)
    this.geometry = geometry
    this.applyMorphs()
    geometry.computeBoundingSphere()
    this.scene.add(new THREE.Mesh(geometry, this.material))
  }

  /** Blend the morphs and rebuild the facets: positions per corner, one normal per facet. */
  private applyMorphs() {
    const { base, indices, morphed, geometry } = this
    if (!base || !indices || !morphed || !geometry) return
    const key = Object.values(this.weights).map((w) => w.toFixed(3)).join()
    if (key === this.applied) return
    this.applied = key
    morphed.set(base)
    for (const name of Object.keys(this.deltas) as Morph[]) {
      const w = this.weights[name]
      const delta = this.deltas[name]!
      if (w < 0.001) continue
      for (let i = 0; i < morphed.length; i++) morphed[i] += delta[i] * w
    }
    const position = geometry.attributes.position.array as Float32Array
    const normal = geometry.attributes.normal.array as Float32Array
    for (let t = 0; t < indices.length; t += 3) {
      const a = indices[t] * 3, b = indices[t + 1] * 3, c = indices[t + 2] * 3
      const ux = morphed[b] - morphed[a], uy = morphed[b + 1] - morphed[a + 1], uz = morphed[b + 2] - morphed[a + 2]
      const vx = morphed[c] - morphed[a], vy = morphed[c + 1] - morphed[a + 1], vz = morphed[c + 2] - morphed[a + 2]
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx
      const len = Math.hypot(nx, ny, nz) || 1
      nx /= len; ny /= len; nz /= len
      for (let k = 0; k < 3; k++) {
        const src = indices[t + k] * 3, dst = (t + k) * 3
        position[dst] = morphed[src]
        position[dst + 1] = morphed[src + 1]
        position[dst + 2] = morphed[src + 2]
        normal[dst] = nx
        normal[dst + 1] = ny
        normal[dst + 2] = nz
      }
    }
    geometry.attributes.position.needsUpdate = true
    geometry.attributes.normal.needsUpdate = true
  }

  private resize = () => {
    const w = this.canvas.clientWidth || window.innerWidth
    const h = this.canvas.clientHeight || window.innerHeight
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / h
    // Keep the head with its ears (about 1.1 wide) in frame on narrow screens.
    const halfFov = THREE.MathUtils.degToRad(FOV / 2)
    const dist = Math.max(CAM.z, 1.5 / (2 * Math.tan(halfFov) * this.camera.aspect))
    this.camera.position.set(CAM.x, CAM.y, dist)
    this.camera.lookAt(LOOK)
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

    // Expressions ease in; a blink every few seconds.
    const k = 1 - Math.exp(-4 * dt)
    for (const name of ['smile', 'browUp', 'browDown'] as const) {
      this.weights[name] += (this.faceTarget[name] - this.weights[name]) * k
    }
    if (t > this.nextBlink) {
      this.blinkUntil = t + BLINK_LENGTH
      this.nextBlink = t + between(BLINK_EVERY)
    }
    this.weights.blink = Math.pow(Math.sin(THREE.MathUtils.clamp(1 - (this.blinkUntil - t) / BLINK_LENGTH, 0, 1) * Math.PI), 2)
    this.applyMorphs()

    if (t > this.nextSweep) {
      this.sweepAt = t
      this.nextSweep = t + SWEEP_LENGTH + between(SWEEP_EVERY)
    }
    const sweep = (t - this.sweepAt) / SWEEP_LENGTH
    this.material.uniforms.uSweep.value = sweep < 1 ? -0.8 + sweep * 2.4 : -10

    const pose = this.gaze.update(dt, t)
    this.material.uniforms.uYaw.value = pose.yaw * TURN
    this.material.uniforms.uPitch.value = pose.pitch * TURN
    this.material.uniforms.uTime.value = t
    this.wall.uniforms.uTime.value = t

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
      style: 'aicher',
      webgl: this.renderer.capabilities.isWebGL2 ? 2 : 1,
      headLoaded: this.geometry !== null,
      renderedFps: this.renderedFps,
      yaw: Number(this.gaze.yaw.toFixed(3)),
      pitch: Number(this.gaze.pitch.toFixed(3)),
      goal: { ...this.gaze.goal },
      expression: { ...this.weights },
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
      object.geometry.dispose()
    })
    this.material.dispose()
    this.wall.dispose()
    this.renderer.dispose()
  }
}
