import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js'
import { GazeSpring } from '../GazeSpring'
import type { Expression, HeadView, HeadViewOptions } from '../types'
import { BACKDROP_FRAGMENT, GEL_FRAGMENT, GEL_VERTEX, PASS_VERTEX } from './shaders'

/**
 * F.L.U.X. - a smooth porcelain mannequin head; around its eyes a box drawn
 * in thin blue lines, full of red gel. The lumps drift and wobble, slosh
 * behind when the head turns, a few drops escape through the walls. The gel
 * glows warmer when he is pleased and churns faster when he is curious.
 * The head is VikiHead.glb (CC0, see its LICENSE), bent in its vertex
 * shader so the head turns while the shoulders stay. WebGL 1 safe.
 */

const MODEL = `${import.meta.env.BASE_URL}models/VikiHead.glb`
/** Model units to head units. */
const SCALE = 0.3
const FOV = 28
const CAM_DIST = 4.2
/** Camera height: the box at eye level a little above the middle, the shoulders at the bottom. */
const CAM_Y = 0.42
/** The head and the box turn around this point (head units), at the top of the neck. */
const PIVOT = new THREE.Vector3(0, -0.05, -0.12)
/** The box: centre, half extents and tilt, in head units. It reaches far in front of the face. */
const BOX_CENTER = new THREE.Vector3(0, 0.5, 0.2)
const BOX_HALF = new THREE.Vector3(0.62, 0.13, 0.85)
const BOX_TILT = -0.07
const LUMPS = 52
const DROPS = 10
const KEY = new THREE.Vector3(-0.5, 0.75, 0.45).normalize()

const SKIN = new THREE.Color('#e9e6f0')
const LINE = new THREE.Color('#5359ff')

const FACES: Record<Expression, { happy: number; curious: number }> = {
  neutral: { happy: 0, curious: 0 },
  curious: { happy: 0, curious: 1 },
  happy: { happy: 1, curious: 0 },
}

/** Stable pseudo-random 0..1. */
const hash = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453
  return x - Math.floor(x)
}

/** An irregular lump of gel around the origin, radius about `size`. */
function lump(size: number, seed: number) {
  const geometry = mergeVertices(new THREE.IcosahedronGeometry(1, 3).deleteAttribute('normal').deleteAttribute('uv'))
  const position = geometry.attributes.position as THREE.BufferAttribute
  const p = new THREE.Vector3()
  const a = hash(seed) * 6.3, b = hash(seed + 1) * 6.3, c = hash(seed + 2) * 6.3
  // Squashed a little, then bumpy at two scales.
  const stretch = new THREE.Vector3(1 + hash(seed + 3) * 0.6, 0.7 + hash(seed + 4) * 0.4, 1 + hash(seed + 5) * 0.5)
  for (let i = 0; i < position.count; i++) {
    p.fromBufferAttribute(position, i)
    const bumps = 0.28 * Math.sin(p.x * 2.1 + a) * Math.sin(p.y * 1.7 + b) * Math.sin(p.z * 2.3 + c)
      + 0.1 * Math.sin(p.x * 5.3 + c) * Math.sin(p.y * 4.7 + a) * Math.sin(p.z * 5.9 + b)
    p.multiplyScalar(size * (1 + bumps)).multiply(stretch)
    position.setXYZ(i, p.x, p.y, p.z)
  }
  geometry.computeVertexNormals()
  return geometry
}

/** All lumps and drops in one geometry; each vertex knows its lump's centre and seed. */
function gelGeometry() {
  const positions: number[] = [], normals: number[] = [], centers: number[] = [], seeds: number[] = [], kinds: number[] = []
  const index: number[] = []
  const add = (geometry: THREE.BufferGeometry, center: THREE.Vector3, seed: number, kind: number) => {
    const base = positions.length / 3
    const p = geometry.attributes.position, n = geometry.attributes.normal
    const s = [hash(seed + 10), hash(seed + 11), hash(seed + 12), hash(seed + 13)]
    for (let i = 0; i < p.count; i++) {
      positions.push(p.getX(i), p.getY(i), p.getZ(i))
      normals.push(n.getX(i), n.getY(i), n.getZ(i))
      centers.push(center.x, center.y, center.z)
      seeds.push(...s)
      kinds.push(kind)
    }
    const idx = geometry.index!
    for (let i = 0; i < idx.count; i++) index.push(base + idx.getX(i))
    geometry.dispose()
  }
  for (let i = 0; i < LUMPS; i++) {
    // Denser in front of the face, where the eyes would be.
    const z = THREE.MathUtils.lerp(-0.85, 0.85, Math.pow(hash(i * 7.3), 0.7))
    const center = new THREE.Vector3((hash(i * 3.1) * 2 - 1) * 0.56, (hash(i * 5.7) * 2 - 1) * 0.07, z)
    add(lump(0.035 + hash(i * 9.1) * 0.05, i), center, i, 0)
  }
  for (let i = 0; i < DROPS; i++) {
    // On a wall of the box: top, bottom or a side.
    const wall = Math.floor(hash(i * 4.4 + 50) * 3)
    const center = new THREE.Vector3((hash(i * 2.2 + 50) * 2 - 1) * BOX_HALF.x, (hash(i * 6.6 + 50) * 2 - 1) * BOX_HALF.y, (hash(i * 8.8 + 50) * 2 - 1) * BOX_HALF.z)
    if (wall === 0) center.y = BOX_HALF.y
    else if (wall === 1) center.y = -BOX_HALF.y
    else center.x = Math.sign(center.x || 1) * BOX_HALF.x
    add(lump(0.018 + hash(i * 3.3 + 50) * 0.02, i + 100), center, i + 100, 1)
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  geometry.setAttribute('aCenter', new THREE.Float32BufferAttribute(centers, 3))
  geometry.setAttribute('aSeed', new THREE.Float32BufferAttribute(seeds, 4))
  geometry.setAttribute('aKind', new THREE.Float32BufferAttribute(kinds, 1))
  geometry.setIndex(index)
  return geometry
}

/** The box's twelve edges as thin bars, so they keep their width on any screen. */
function boxEdges(material: THREE.Material) {
  const group = new THREE.Group()
  const { x, y, z } = BOX_HALF
  const r = 0.0045
  for (const [a, b] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const alongX = new THREE.Mesh(new THREE.BoxGeometry(2 * x, r, r), material)
    alongX.position.set(0, a * y, b * z)
    const alongY = new THREE.Mesh(new THREE.BoxGeometry(r, 2 * y, r), material)
    alongY.position.set(a * x, 0, b * z)
    const alongZ = new THREE.Mesh(new THREE.BoxGeometry(r, r, 2 * z), material)
    alongZ.position.set(a * x, b * y, 0)
    group.add(alongX, alongY, alongZ)
  }
  return group
}

/** Black shirt over the model's shoulders: a collar round the neck, wide below. */
function shirtGeometry() {
  const curve = new THREE.SplineCurve([
    [0.36, -0.26], [0.4, -0.34], [0.66, -0.44], [1.04, -0.56], [1.2, -0.78], [1.24, -1.2], [1.2, -2.4],
  ].map(([r, y]) => new THREE.Vector2(r, y)))
  const geometry = new THREE.LatheGeometry(curve.getSpacedPoints(60), 96, Math.PI)
  const position = geometry.attributes.position as THREE.BufferAttribute
  for (let i = 0; i < position.count; i++) {
    const r = Math.hypot(position.getX(i), position.getZ(i))
    // Round at the collar, flat at the chest.
    const depth = r / Math.pow(1 + (r / 0.5) ** 4, 0.25)
    position.setZ(i, (r > 0 ? (position.getZ(i) / r) * depth : 0) - 0.15)
  }
  geometry.computeVertexNormals()
  return geometry
}

export class FluxHead implements HeadView {
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 60)
  private head = new THREE.Group()
  private turn = new THREE.Group()
  private gelFront: THREE.ShaderMaterial
  private gelBack: THREE.ShaderMaterial
  private lines: THREE.MeshBasicMaterial
  private glowLight: THREE.PointLight
  /** The model follows the head's turn in its vertex shader: (yaw, pitch). */
  private bendTurn = { value: new THREE.Vector2() }
  private face: THREE.Mesh | null = null
  private morphs: Record<string, number> = {}
  private gaze: GazeSpring
  private mood = { happy: 0, curious: 0 }
  private moodTarget = { happy: 0, curious: 0 }
  private nextBlink = 1.5
  private blinkUntil = -1
  /** The gel lags behind the head's turn: a spring on its angular velocity. */
  private spin = new THREE.Vector3()
  private spinVel = new THREE.Vector3()
  private lastPose = { yaw: 0, pitch: 0 }
  private gelTime = 0
  private headLoaded = false
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
    this.renderer.setClearColor(0x9d989f, 1)
    this.renderer.toneMapping = THREE.NeutralToneMapping

    this.camera.position.set(0, CAM_Y, CAM_DIST)
    this.camera.lookAt(0, CAM_Y, 0)

    // --- studio -------------------------------------------------------------
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(40, 24), new THREE.ShaderMaterial({
      vertexShader: PASS_VERTEX,
      fragmentShader: BACKDROP_FRAGMENT,
      depthWrite: false,
      toneMapped: false,
    }))
    wall.position.z = -8
    wall.renderOrder = -10
    this.scene.add(wall)

    this.scene.add(new THREE.HemisphereLight(0xf4f0ff, 0x6a6470, 1.3))
    const key = new THREE.DirectionalLight(0xffffff, 2.4)
    key.position.copy(KEY).multiplyScalar(6)
    const rim = new THREE.DirectionalLight(0xe6e8ff, 1.6)
    rim.position.set(3, 2, -4)
    this.scene.add(key, rim)

    // --- the box and its gel ------------------------------------------------
    const box = new THREE.Group()
    box.position.copy(BOX_CENTER)
    box.rotation.x = BOX_TILT
    this.lines = new THREE.MeshBasicMaterial({ color: LINE })
    const glass = new THREE.Mesh(
      new THREE.BoxGeometry(BOX_HALF.x * 2, BOX_HALF.y * 2, BOX_HALF.z * 2),
      new THREE.MeshBasicMaterial({ color: 0xb8b4ff, transparent: true, opacity: 0.05, depthWrite: false, side: THREE.DoubleSide }),
    )
    glass.renderOrder = 3
    const gel = gelGeometry()
    const gelMaterial = (back: boolean) => new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 }, uChurn: { value: 1 }, uSpin: { value: this.spin }, uHalf: { value: BOX_HALF },
        uBack: { value: back ? 1 : 0 }, uGlow: { value: 1 }, uKey: { value: KEY },
      },
      vertexShader: GEL_VERTEX,
      fragmentShader: GEL_FRAGMENT,
      transparent: true,
      depthWrite: !back,
      side: back ? THREE.BackSide : THREE.FrontSide,
    })
    this.gelBack = gelMaterial(true)
    this.gelFront = gelMaterial(false)
    const gelBack = new THREE.Mesh(gel, this.gelBack)
    gelBack.renderOrder = 1
    const gelFront = new THREE.Mesh(gel, this.gelFront)
    gelFront.renderOrder = 2
    // The lumps move in the shader; their bounds would be wrong.
    gelBack.frustumCulled = gelFront.frustumCulled = false
    box.add(boxEdges(this.lines), glass, gelBack, gelFront)

    // The gel's red light falls onto the face around it.
    this.glowLight = new THREE.PointLight(0xff3a55, 0.45, 2.2, 1.5)
    this.glowLight.position.set(0, BOX_CENTER.y, 1.25)

    this.head.add(box, this.glowLight)
    this.turn.position.copy(PIVOT)
    this.head.position.copy(PIVOT).negate()
    this.turn.add(this.head)

    const shirt = new THREE.Mesh(shirtGeometry(), new THREE.MeshStandardMaterial({ color: 0x0e0e10, roughness: 0.9, side: THREE.DoubleSide }))
    this.scene.add(this.turn, shirt)
    void this.loadHead().catch((error) => console.error('[flux] model failed to load', error))

    this.resizeObserver = new ResizeObserver(this.resize)
    this.resizeObserver.observe(canvas)
    this.resize()
    document.addEventListener('visibilitychange', this.onVisibility)
    this.tick()
  }

  private async loadHead() {
    const gltf = await new GLTFLoader().loadAsync(MODEL)
    if (this.disposed) return
    // Porcelain for skin and eyes alike: a mannequin. The mouth stays dark.
    const skin = this.bendable(new THREE.MeshStandardMaterial({ color: SKIN, roughness: 0.3, side: THREE.DoubleSide }))
    const mouth = this.bendable(new THREE.MeshStandardMaterial({ color: 0x1a1418, roughness: 0.8, side: THREE.DoubleSide }))
    gltf.scene.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return
      object.material = /mouth/i.test(object.name) ? mouth : skin
      // It bends in the shader; the bounds of the rest pose would cull it wrongly.
      object.frustumCulled = false
      if (object.name === 'Face') this.face = object
    })
    gltf.scene.scale.setScalar(SCALE)
    this.scene.add(gltf.scene)
    this.headLoaded = true
  }

  /** The head turns with the box, the neck twists, the shoulders stay: a weight by height in model units. */
  private bendable(material: THREE.MeshStandardMaterial) {
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uTurn = this.bendTurn
      shader.uniforms.uPivot = { value: PIVOT.clone().divideScalar(SCALE) }
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
uniform vec2 uTurn;
uniform vec3 uPivot;
// The head's Euler 'YXZ' (yaw, -pitch), scaled by how much of it this vertex follows.
mat3 bendMatrix() {
  float w = smoothstep(-1.3, -0.3, position.y);
  float y = uTurn.x * w, x = -uTurn.y * w;
  float cy = cos(y), sy = sin(y), cx = cos(x), sx = sin(x);
  return mat3(cy, 0.0, -sy, 0.0, 1.0, 0.0, sy, 0.0, cy) * mat3(1.0, 0.0, 0.0, 0.0, cx, sx, 0.0, -sx, cx);
}`)
        .replace('#include <morphnormal_vertex>', '#include <morphnormal_vertex>\nobjectNormal = bendMatrix() * objectNormal;')
        .replace('#include <project_vertex>', 'transformed = uPivot + bendMatrix() * (transformed - uPivot);\n#include <project_vertex>')
    }
    return material
  }

  private setMorph(name: string, value: number) {
    const index = this.face?.morphTargetDictionary?.[name]
    if (index !== undefined && this.face?.morphTargetInfluences) this.face.morphTargetInfluences[index] = value
    this.morphs[name] = value
  }

  private resize = () => {
    const w = this.canvas.clientWidth || window.innerWidth
    const h = this.canvas.clientHeight || window.innerHeight
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / h
    // Keep the whole box (1.24 wide) and some air in frame on narrow screens.
    const halfFov = THREE.MathUtils.degToRad(FOV / 2)
    this.camera.position.z = Math.max(CAM_DIST, 1.9 / (2 * Math.tan(halfFov) * this.camera.aspect))
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
    Object.assign(this.moodTarget, FACES[expression])
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
    this.mood.happy += (this.moodTarget.happy - this.mood.happy) * k
    this.mood.curious += (this.moodTarget.curious - this.mood.curious) * k
    if (t > this.nextBlink) {
      this.blinkUntil = t + 0.16
      this.nextBlink = t + 2.5 + Math.random() * 4
    }
    const blink = Math.pow(Math.sin(THREE.MathUtils.clamp(1 - (this.blinkUntil - t) / 0.16, 0, 1) * Math.PI), 2)
    this.setMorph('smile', this.mood.happy * 0.85)
    this.setMorph('browUp', this.mood.curious * 0.8)
    this.setMorph('blinkLeft', blink)
    this.setMorph('blinkRight', blink)

    const pose = this.gaze.update(dt, t)
    this.turn.rotation.set(-pose.pitch, pose.yaw, 0, 'YXZ')
    this.bendTurn.value.set(pose.yaw, pose.pitch)

    // Slosh: the gel's offset springs towards minus the head's angular velocity, in box axes.
    const yawVel = (pose.yaw - this.lastPose.yaw) / Math.max(dt, 1e-3)
    const pitchVel = (pose.pitch - this.lastPose.pitch) / Math.max(dt, 1e-3)
    this.lastPose = { yaw: pose.yaw, pitch: pose.pitch }
    const goal = new THREE.Vector3(pitchVel, -yawVel, 0).multiplyScalar(0.18).clampLength(0, 0.35)
    const steps = Math.max(1, Math.ceil(dt / (1 / 120)))
    for (let i = 0; i < steps; i++) {
      const h = dt / steps
      this.spinVel.addScaledVector(this.spin.clone().sub(goal), -40 * h).multiplyScalar(1 - 3 * h)
      this.spin.addScaledVector(this.spinVel, h)
    }

    // Curious churns the gel, pleased makes it glow.
    this.gelTime += dt * (1 + 1.4 * this.mood.curious)
    for (const gel of [this.gelFront, this.gelBack]) {
      gel.uniforms.uTime.value = this.gelTime
      gel.uniforms.uGlow.value = 1 + 0.6 * this.mood.happy
    }
    this.lines.color.copy(LINE).multiplyScalar(1 + 0.8 * Math.max(this.mood.curious, this.mood.happy))
    this.glowLight.intensity = 0.45 + 0.35 * this.mood.happy

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
      style: 'flux',
      webgl: this.renderer.capabilities.isWebGL2 ? 2 : 1,
      headLoaded: this.headLoaded,
      renderedFps: this.renderedFps,
      yaw: Number(this.gaze.yaw.toFixed(3)),
      pitch: Number(this.gaze.pitch.toFixed(3)),
      goal: { ...this.gaze.goal },
      expression: { ...this.mood },
      morphs: { ...this.morphs },
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
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) material.dispose()
    })
    this.renderer.dispose()
  }
}
