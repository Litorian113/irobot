import * as THREE from 'three'
import { GazeSpring } from '../GazeSpring'
import { addDarkBackdrop, DARK_BACKDROP } from '../darkBackdrop'
import type { Expression, HeadView, HeadViewOptions } from '../types'
import { HAND_FRAGMENT, HAND_VERTEX } from './shaders'

/**
 * H.Ä.N.D.C.H.E.N. - a stitched-together hand with no body, standing on its fingertips,
 * drumming them and turning towards whoever walks past. When someone turns up (and now
 * and then anyway) it crouches, somersaults onto its wrist and shows them the peace sign.
 * WebGL 1 safe: 17 bones as uniforms, the mesh comes from scripts/build_haendchen.mjs.
 */

const MODEL = `${import.meta.env.BASE_URL}models/Haendchen`
const FOV = 30
/** Close on its fingers, further back when the sign needs the height. */
const CAM_Z = { stand: 6.6, peace: 8.0 }
/** How much of the width it needs, for narrow screens. */
const NEEDS_WIDTH = 3.5
const TURN = 0.8

/** Where it stands, and how it leans, on its fingers and on its wrist. */
const STAND = { y: 0.42, tilt: -0.82, yaw: -0.5 }
const PEACE = { y: -0.3, tilt: -Math.PI + 0.1, roll: -0.1 }

/** How long each part of the gesture takes (seconds). */
const CROUCH = 0.38
const FLIP = 0.8
const HOLD = 3.4
const RETURN = 0.85
/** It does it by itself every so often; after someone turns up, soon. */
const IDLE_EVERY = [30, 60]
const NOTICE_DELAY = [1.2, 3]
/** Not again right after, however many people walk past. */
const COOLDOWN = 14

type Phase = 'idle' | 'crouch' | 'flip' | 'peace' | 'return'

/** Flex (about the finger's hinge), spread (about z) and roll (about the bone itself) added to the pose it was modelled in, radians. */
type Pose = Record<string, [flex: number, spread: number, roll?: number]>

/** On its fingertips, as on the prop: fingers nearly straight below a tilted palm. */
const POSE_STAND: Pose = {
  wrist: [0.72, 0],
  index0: [0.1, 0.02], index1: [0.2, 0], index2: [0.05, 0],
  middle0: [0.1, -0.2], middle1: [0.2, 0], middle2: [0.05, 0],
  ring0: [0.14, -0.42], ring1: [0.15, 0], ring2: [0.05, 0],
  pinky0: [0.2, -0.68], pinky1: [0.12, 0], pinky2: [0.05, 0],
  thumb0: [0.05, 0.5], thumb1: [0.08, -0.08], thumb2: [-0.05, 0],
}
/** Peace: index and middle straight in a V, the thumb holding down the other two. */
const POSE_PEACE: Pose = {
  wrist: [0, 0],
  index0: [-0.44, 0.22], index1: [-0.35, 0], index2: [-0.17, 0],
  middle0: [-0.44, -0.2], middle1: [-0.35, 0], middle2: [-0.17, 0],
  ring0: [1.02, 0.05], ring1: [1.5, 0], ring2: [0.75, 0],
  pinky0: [1.02, 0.22], pinky1: [1.5, 0], pinky2: [0.75, 0],
  thumb0: [0.42, -0.85], thumb1: [0.0, -0.35, -1.0], thumb2: [0.0, -0.05, -0.8],
}

const FINGER_ORDER = ['pinky', 'ring', 'middle', 'index']

const between = ([lo, hi]: number[]) => lo + Math.random() * (hi - lo)
const ease = (t: number) => t * t * (3 - 2 * t)
/** Runs a little past the end and settles. */
const overshoot = (t: number) => 1 + 2.2 * Math.pow(t - 1, 3) + 1.2 * Math.pow(t - 1, 2)

interface Bone {
  name: string
  parent: number
  joint: [number, number, number]
  hinge: [number, number, number]
  tip?: [number, number, number]
}
interface HandModel {
  vertices: number
  indices: number
  bones: Bone[]
}

/** Fine lines of skin: tiling noise, stored once, read three times a pixel. */
function linesTexture() {
  const SIZE = 256
  const data = new Uint8Array(SIZE * SIZE * 4)
  let seed = 11
  const random = () => {
    seed = (seed * 16807) % 2147483647
    return seed / 2147483647
  }
  const octave = (cells: number) => {
    const lattice = Array.from({ length: cells * cells }, random)
    return (x: number, y: number) => {
      const fx = (x / SIZE) * cells, fy = (y / SIZE) * cells
      const ix = Math.floor(fx), iy = Math.floor(fy)
      const sx = ease(fx - ix), sy = ease(fy - iy)
      const at = (a: number, b: number) => lattice[((iy + b) % cells) * cells + ((ix + a) % cells)]
      return (at(0, 0) * (1 - sx) + at(1, 0) * sx) * (1 - sy) + (at(0, 1) * (1 - sx) + at(1, 1) * sx) * sy
    }
  }
  const coarse = octave(16), middle = octave(32), fine = octave(64), finest = octave(128)
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    const v = coarse(x, y) * 0.15 + middle(x, y) * 0.25 + fine(x, y) * 0.35 + finest(x, y) * 0.25
    const i = (x + y * SIZE) * 4
    data[i] = data[i + 1] = data[i + 2] = Math.round(v * 255)
    data[i + 3] = 255
  }
  const texture = new THREE.DataTexture(data, SIZE, SIZE, THREE.RGBAFormat)
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping
  texture.minFilter = THREE.LinearMipmapLinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.generateMipmaps = true
  texture.needsUpdate = true
  return texture
}

export class HaendchenHead implements HeadView {
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 60)
  private material: THREE.ShaderMaterial
  private backdrop: THREE.ShaderMaterial
  private lines = linesTexture()
  private hand: THREE.Mesh | null = null
  private bones: Bone[] = []
  private boneMatrices = Array.from({ length: 17 }, () => new THREE.Matrix4())
  private gaze: GazeSpring
  private phase: Phase = 'idle'
  private phaseAt = 0
  private lastGesture = -100
  private nextGesture = between([10, 18])
  private nextDrum = 2
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
  private local = new THREE.Matrix4()
  private spin = new THREE.Quaternion()
  private spread = new THREE.Quaternion()
  private axis = new THREE.Vector3()
  private toJoint = new THREE.Matrix4()
  private fromJoint = new THREE.Matrix4()
  private euler = new THREE.Euler(0, 0, 0, 'YXZ')
  private fitZ = 0

  constructor(canvas: HTMLCanvasElement, opts: HeadViewOptions = {}) {
    this.canvas = canvas
    this.fps = opts.fps ?? 30
    this.gaze = new GazeSpring(opts.stiffness ?? 5, opts.delay ?? 0)

    const attributes: WebGLContextAttributes = { antialias: true, alpha: false, powerPreference: 'high-performance' }
    // A WebGL 1 context handed in keeps three.js on its WebGL 1 path, as on the old iMacs.
    const context = opts.webgl1 ? canvas.getContext('webgl', attributes) ?? undefined : undefined
    this.renderer = new THREE.WebGLRenderer({ canvas, context, ...attributes })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, opts.maxPixelRatio ?? 1.5))
    this.renderer.setClearColor(DARK_BACKDROP, 1)

    this.backdrop = addDarkBackdrop(this.scene)

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uBones: { value: this.boneMatrices },
        uLines: { value: this.lines },
      },
      vertexShader: HAND_VERTEX,
      fragmentShader: HAND_FRAGMENT,
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
      fetch(`${MODEL}.json`).then((r) => r.json() as Promise<HandModel>),
      fetch(`${MODEL}.bin`).then((r) => r.arrayBuffer()),
    ])
    if (this.disposed) return
    const n = model.vertices
    let at = 0
    const take = <T>(make: (offset: number) => T, bytes: number) => {
      const part = make(at)
      at += bytes
      return part
    }
    const position = take((o) => new Float32Array(buffer, o, n * 3), n * 12)
    const normal = take((o) => new Int8Array(buffer, o, n * 3), n * 3)
    const color = take((o) => new Uint8Array(buffer, o, n * 4), n * 4)
    const boneIds = take((o) => new Uint8Array(buffer, o, n * 4), n * 4)
    const weights = take((o) => new Uint8Array(buffer, o, n * 4), n * 4)
    const detail = take((o) => new Uint8Array(buffer, o, n * 2), n * 2)
    // Uint16 needs an even offset; the file is written in this order, so copy rather than align.
    const index = new Uint16Array(buffer.slice(at, at + model.indices * 2))

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(position, 3))
    geometry.setAttribute('normal', new THREE.BufferAttribute(normal, 3, true))
    geometry.setAttribute('aColor', new THREE.BufferAttribute(color, 4, true))
    geometry.setAttribute('aBones', new THREE.BufferAttribute(boneIds, 4, false))
    geometry.setAttribute('aWeights', new THREE.BufferAttribute(weights, 4, false))
    geometry.setAttribute('aDetail', new THREE.BufferAttribute(detail, 2, false))
    geometry.setIndex(new THREE.BufferAttribute(index, 1))
    this.bones = model.bones
    this.hand = new THREE.Mesh(geometry, this.material)
    this.hand.frustumCulled = false
    this.hand.matrixAutoUpdate = false
    this.scene.add(this.hand)
  }

  private resize = () => {
    const w = this.canvas.clientWidth || window.innerWidth
    const h = this.canvas.clientHeight || window.innerHeight
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / h
    const halfFov = THREE.MathUtils.degToRad(FOV / 2)
    this.fitZ = NEEDS_WIDTH / (2 * Math.tan(halfFov) * this.camera.aspect)
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

  /** It has no face to change. But someone turning up is who it greets. */
  setExpression(expression: Expression) {
    if (expression === this.expression) return
    const noticed = this.expression === 'neutral' && expression !== 'neutral'
    this.expression = expression
    if (noticed) {
      this.nextGesture = Math.min(this.nextGesture, Math.max(this.clock.elapsedTime + between(NOTICE_DELAY), this.lastGesture + COOLDOWN))
    }
  }

  /** Show the peace sign now (if it is not already). */
  peace() {
    if (this.phase === 'idle') this.enter('crouch', this.clock.elapsedTime)
  }

  private enter(phase: Phase, t: number) {
    this.phase = phase
    this.phaseAt = t
  }

  /** Each bone: its parent's matrix, then a turn about its own joint. */
  private applyPose(amount: number, drum: (finger: string) => number, peaceWave: number) {
    const v = this.axis
    this.boneMatrices[0].identity()
    for (let i = 1; i < this.bones.length; i++) {
      const bone = this.bones[i]
      const from = POSE_STAND[bone.name], to = POSE_PEACE[bone.name]
      let flex = from[0] + (to[0] - from[0]) * amount
      let spread = from[1] + (to[1] - from[1]) * amount
      const finger = bone.name.slice(0, -1)
      if (bone.name.endsWith('0')) {
        flex -= drum(finger)
        // The V opens and closes a little while it holds the sign.
        if (finger === 'index') spread += peaceWave
        if (finger === 'middle') spread -= peaceWave
      }
      this.spin.setFromAxisAngle(v.set(bone.hinge[0], bone.hinge[1], bone.hinge[2]), flex)
      this.spread.setFromAxisAngle(v.set(0, 0, 1), spread)
      this.spin.premultiply(this.spread)
      const roll = (from[2] ?? 0) + ((to[2] ?? 0) - (from[2] ?? 0)) * amount
      if (roll && bone.tip) {
        v.set(bone.tip[0] - bone.joint[0], bone.tip[1] - bone.joint[1], bone.tip[2] - bone.joint[2]).normalize()
        this.spin.multiply(this.spread.setFromAxisAngle(v, roll))
      }
      this.local.makeRotationFromQuaternion(this.spin)
      const [x, y, z] = bone.joint
      this.toJoint.makeTranslation(x, y, z)
      this.fromJoint.makeTranslation(-x, -y, -z)
      this.boneMatrices[i].copy(this.boneMatrices[bone.parent]).multiply(this.toJoint).multiply(this.local).multiply(this.fromJoint)
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

    if (this.phase === 'idle' && t > this.nextGesture) this.enter('crouch', t)
    let age = t - this.phaseAt
    if (this.phase === 'crouch' && age > CROUCH) {
      this.lastGesture = t
      this.enter('flip', t)
    } else if (this.phase === 'flip' && age > FLIP) {
      this.enter('peace', t)
    } else if (this.phase === 'peace' && age > HOLD) {
      this.enter('return', t)
    } else if (this.phase === 'return' && age > RETURN) {
      this.enter('idle', t)
      this.nextGesture = t + between(IDLE_EVERY)
      this.nextDrum = t + 1.5
    }
    age = t - this.phaseAt

    // turned: 0 on its fingers .. 1 on its wrist. fist: how far the fingers have gone into the sign.
    let turned = 0, fist = 0, hop = 0, crouch = 0, wave = 0
    if (this.phase === 'crouch') {
      crouch = ease(age / CROUCH)
    } else if (this.phase === 'flip') {
      const f = age / FLIP
      turned = overshoot(f)
      fist = ease(Math.min(1, f * 1.5))
      hop = Math.sin(Math.min(1, f * 1.1) * Math.PI) * 0.75
      crouch = 1 - ease(Math.min(1, f * 3))
    } else if (this.phase === 'peace') {
      turned = 1
      fist = 1
      wave = Math.sin(age * 7) * 0.05 * Math.min(1, age * 2) * Math.max(0, Math.min(1, (HOLD - age) * 2))
      hop = Math.abs(Math.sin(age * 3.5)) * 0.035
    } else if (this.phase === 'return') {
      const f = age / RETURN
      turned = 1 - ease(f)
      fist = 1 - ease(Math.min(1, f * 1.4))
      hop = Math.sin(f * Math.PI) * 0.65
    }

    // It drums its fingers now and then, little finger first.
    if (this.phase === 'idle' && t > this.nextDrum + 1.2) this.nextDrum = t + between([2.5, 6])
    const drum = (finger: string) => {
      if (this.phase !== 'idle') return 0
      const order = FINGER_ORDER.indexOf(finger)
      if (order < 0) return 0
      const local = (t - this.nextDrum - order * 0.13) / 0.2
      return local > 0 && local < 1 ? Math.sin(local * Math.PI) * 0.34 : 0
    }

    const pose = this.gaze.update(dt, t)
    this.applyPose(fist, drum, wave)

    const mixed = ease(Math.min(1, Math.max(0, turned)))
    // Looking up means something else once it stands the other way round.
    const look = 1 - 2 * mixed
    const breathe = Math.sin(t * 1.3) * 0.012
    this.camera.position.z = Math.max(CAM_Z.stand + (CAM_Z.peace - CAM_Z.stand) * Math.max(mixed, ease(Math.min(1, fist))), this.fitZ)
    const y = STAND.y + (PEACE.y - STAND.y) * mixed + hop - crouch * 0.2 + breathe
    this.euler.set(
      STAND.tilt + (PEACE.tilt - STAND.tilt) * turned - pose.pitch * look * 0.6 + crouch * 0.28,
      pose.yaw + STAND.yaw * (1 - mixed),
      (PEACE.roll * mixed) + pose.yaw * -0.08,
      'YXZ',
    )
    if (this.hand) {
      this.hand.matrix.makeRotationFromEuler(this.euler)
      this.hand.matrix.setPosition(pose.yaw * 0.32, y, 0)
      this.hand.matrixWorldNeedsUpdate = true
    }
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
      style: 'haendchen',
      webgl: this.renderer.capabilities.isWebGL2 ? 2 : 1,
      headLoaded: this.hand !== null,
      renderedFps: this.renderedFps,
      yaw: Number(this.gaze.yaw.toFixed(3)),
      pitch: Number(this.gaze.pitch.toFixed(3)),
      goal: { ...this.gaze.goal },
      phase: this.phase,
      // For the snapshot script: photograph it standing, not mid-somersault.
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
    this.backdrop.dispose()
    this.lines.dispose()
    this.renderer.dispose()
  }
}
