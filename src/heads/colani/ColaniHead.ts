import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { GazeSpring } from '../GazeSpring'
import type { Expression, HeadView, HeadViewOptions } from '../types'
import { drawFace, drawTorso, FACE_SIZE, TORSO_SIZE, type FaceState } from './prints'
import { PASS_VERTEX, SMOKE_FRAGMENT, SMOKE_VERTEX, STUDIO_FRAGMENT } from './shaders'
import { colaniTruck } from './truck'

/**
 * C.O.L.A.N.I. - Luigi Colani as a building-brick minifigure: the classic
 * barrel-shaped yellow head with its stud, his face printed on (half-closed
 * eyes, the huge drooping moustache), sculpted hair combed back into long
 * locks going grey at the temples, a fat cigar in the corner of his mouth, a
 * white turtleneck. The face changes the way a minifigure's does - a
 * different print - and now and then he spins his head right round. Behind
 * him, on a pale wall of his round forms, his truck stands parked.
 * WebGL 1 safe: Phong plastic, canvas prints, plain GLSL ES 1.0.
 */

const FOV = 30
/** Close on the head: below it only the collar and the tops of the shoulders. */
const CAM = new THREE.Vector3(0, 0.16, 2.9)
const LOOK = new THREE.Vector3(0, 0.08, 0)
/** The head: widest radius and height; the outline is a rounded barrel (superellipse). */
const R = 0.5
const H = 0.82
const ROUNDNESS = 4.2
const NECK = 0.1
const TORSO_TOP = -H / 2 - NECK
const PLASTIC = { shininess: 90, specular: new THREE.Color(0x5a5a5a) }
const YELLOW = 0xf2c81d
const SWEATER = 0xf3f1ea
const HAIR = new THREE.Color('#3b2618')
const HAIR_DEEP = new THREE.Color('#24170e')
const GREY_HAIR = new THREE.Color('#bdb6ab')
/** The hair sits around this point; locks lie on a shell around it. */
const HAIR_CENTER = new THREE.Vector3(0, 0.12, -0.02)
const LOCKS = 14

/** Mouth corner the cigar sits in (head units), and where it points: out, forward, jauntily up. */
const CIGAR_AT = new THREE.Vector3(0.2, -0.15, 0.45)
const CIGAR_DIR = new THREE.Vector3(0.6, 0.2, 0.77).normalize()
const CIGAR_LENGTH = 0.36
const SMOKE = 80

const FACES: Record<Expression, { happy: number; curious: number }> = {
  neutral: { happy: 0, curious: 0 },
  curious: { happy: 0, curious: 1 },
  happy: { happy: 1, curious: 0 },
}
const BLINK_EVERY = [2.5, 6]
const BLINK_LENGTH = 0.16
/** A draw on the cigar, then a puff of smoke from the mouth (seconds). */
const PUFF_EVERY = [6, 12]
/** Now and then the head spins once all the way round (seconds). */
const SPIN_EVERY = [25, 45]
const SPIN_LENGTH = 1.4
/** The parked truck: how far back, its floor, and how far left (the cab peeks out beside him). */
const TRUCK_Z = -6
const TRUCK_Y = -1.25
const TRUCK_X = -1.85
/** The wall behind the truck, and where its floor line meets that wall (seen from the camera). */
const WALL_Z = -8
const WALL_SIZE = new THREE.Vector2(32, 18)

const between = ([lo, hi]: number[]) => lo + Math.random() * (hi - lo)
const smoothstep = (a: number, b: number, x: number) => {
  const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1)
  return t * t * (3 - 2 * t)
}

/**
 * The head's outline from the bottom centre round to the top centre: a
 * superellipse, flat-ish on top and bottom, bulging at the sides. Sampled
 * evenly by length, so the face print keeps its scale across and down.
 */
function headProfile(count = 80) {
  const dense: THREE.Vector2[] = []
  for (let i = 0; i <= 400; i++) {
    const a = -Math.PI / 2 + (i / 400) * Math.PI
    const c = Math.cos(a), s = Math.sin(a)
    dense.push(new THREE.Vector2(R * Math.abs(c) ** (2 / ROUNDNESS), (H / 2) * Math.sign(s) * Math.abs(s) ** (2 / ROUNDNESS)))
  }
  const lengths = [0]
  for (let i = 1; i < dense.length; i++) lengths.push(lengths[i - 1] + dense[i].distanceTo(dense[i - 1]))
  const total = lengths[lengths.length - 1]
  const points: THREE.Vector2[] = []
  let k = 0
  for (let i = 0; i < count; i++) {
    const d = (i / (count - 1)) * total
    while (k < lengths.length - 2 && lengths[k + 1] < d) k++
    const f = (d - lengths[k]) / (lengths[k + 1] - lengths[k] || 1)
    points.push(dense[k].clone().lerp(dense[k + 1], f))
  }
  return { points, length: total }
}

/** A short lathe from an outline of (radius, height) pairs. */
const lathe = (outline: number[][]) => new THREE.LatheGeometry(outline.map(([r, y]) => new THREE.Vector2(r, y)), 48)

/** On the hair shell: angle around (0 = front), elevation, distance from the centre. */
function onShell(angle: number, elevation: number, radius: number) {
  return new THREE.Vector3(
    radius * Math.cos(elevation) * Math.sin(angle),
    HAIR_CENTER.y + radius * 0.95 * Math.sin(elevation),
    HAIR_CENTER.z + radius * Math.cos(elevation) * Math.cos(angle),
  )
}

/**
 * The underlayer: a cap over the crown that opens at the front from a high
 * hairline and falls behind the head to the shoulders. Dark, so the gaps
 * between the locks read as depth.
 */
function capGeometry() {
  const rows = 24, cols = 64
  const position: number[] = [], index: number[] = []
  for (let j = 0; j <= rows; j++) {
    const t = j / rows
    const e = Math.PI / 2 - t * 2.1
    // Above the shell's equator a dome; below it a curtain that runs straight down.
    const below = Math.max(0, -Math.sin(e))
    // Closed over the crown and the stud; open at the front below the hairline.
    const half = Math.PI - 1.35 * smoothstep(0.42, 0.62, t)
    for (let i = 0; i <= cols; i++) {
      const a = Math.PI + ((i / cols) * 2 - 1) * half
      const p = onShell(a, Math.max(e, 0), 0.53 + 0.08 * below)
      if (e < 0) p.y = HAIR_CENTER.y - below * 0.62
      position.push(p.x, p.y, p.z)
    }
  }
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const a = j * (cols + 1) + i, b = a + 1, d = a + cols + 1, e = d + 1
      index.push(a, d, b, b, d, e)
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3))
  geometry.setIndex(index)
  geometry.computeVertexNormals()
  return geometry
}

/**
 * The locks: each starts at a high hairline on top of the head (sunk into
 * it, so no open end shows), swells as it runs back over the crown, then
 * falls behind the ear and ends in a point on the shoulder. Wide and a
 * little flattened against the head, like sculpted plastic hair. The outer
 * ones are grey.
 */
function locksGeometry() {
  const parts: THREE.BufferGeometry[] = []
  const color = new THREE.Color()
  const radial = new THREE.Vector3(), offset = new THREE.Vector3(), centre = new THREE.Vector3()
  for (let i = 0; i < LOCKS; i++) {
    const u = ((i + 0.5) / LOCKS) * 2 - 1
    const side = Math.sign(u), au = Math.abs(u)
    const a0 = u * 1.3
    const a1 = side * (Math.PI - au * 1.6)
    const lerp = THREE.MathUtils.lerp
    const curve = new THREE.CatmullRomCurve3([
      onShell(a0, lerp(0.78, 0.26, au), 0.44),
      onShell(a0 * 1.02, lerp(0.86, 0.34, au), 0.55),
      onShell(lerp(a0, a1, 0.3), lerp(1.2, 0.65, au), 0.61),
      onShell(lerp(a0, a1, 0.65), lerp(0.85, 0.25, au), 0.62),
      onShell(a1, -0.05, 0.63),
      onShell(a1, -0.05, 0.65).setY(HAIR_CENTER.y - 0.32),
      onShell(a1 + side * 0.08, -0.05, 0.74).setY(HAIR_CENTER.y - 0.6),
    ])
    const segments = 48, around = 10
    const tube = new THREE.TubeGeometry(curve, segments, 1, around, false)
    const position = tube.attributes.position as THREE.BufferAttribute
    for (let s = 0; s <= segments; s++) {
      const t = s / segments
      curve.getPointAt(t, centre)
      const r = (0.075 + 0.04 * Math.sin(t * Math.PI * 0.9)) * (0.6 + 0.4 * smoothstep(0, 0.1, t)) * (1 - smoothstep(0.8, 1, t) * 0.85)
      // Flat against the head: squash the part that points away from it.
      radial.set(centre.x, centre.y - Math.min(centre.y, HAIR_CENTER.y), centre.z - HAIR_CENTER.z).normalize()
      for (let k = 0; k <= around; k++) {
        const v = s * (around + 1) + k
        offset.fromBufferAttribute(position, v).sub(centre)
        offset.addScaledVector(radial, -0.45 * offset.dot(radial)).multiplyScalar(r)
        position.setXYZ(v, centre.x + offset.x, centre.y + offset.y, centre.z + offset.z)
      }
    }
    tube.deleteAttribute('uv')
    tube.computeVertexNormals()
    // Brown, a little different per lock; grey at the temples.
    color.copy(HAIR).multiplyScalar(0.85 + 0.3 * ((i * 0.618) % 1)).lerp(GREY_HAIR, smoothstep(0.55, 0.95, au) * 0.9)
    const colors = new Float32Array(position.count * 3)
    for (let v = 0; v < position.count; v++) color.toArray(colors, v * 3)
    tube.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    parts.push(tube)
  }
  return mergeGeometries(parts)!
}

/** A minifigure torso: a trapezoid block, wider at the bottom, rounded edges. */
function torsoGeometry() {
  const shape = new THREE.Shape()
  shape.moveTo(-0.8, -0.66)
  shape.lineTo(0.8, -0.66)
  shape.lineTo(0.62, 0.66)
  shape.lineTo(-0.62, 0.66)
  shape.closePath()
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: 0.56, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.04, bevelSegments: 4, curveSegments: 4,
  })
  geometry.translate(0, 0, -0.28)
  return geometry
}

/** Tobacco leaf wrapped round the cigar: mottled brown, the wrapper's seam running round in a spiral. */
function leafTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 128
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#5b3518'
  ctx.fillRect(0, 0, 256, 128)
  for (let i = 0; i < 400; i++) {
    ctx.fillStyle = `rgba(${Math.random() < 0.5 ? '30,15,5' : '140,90,45'},${0.08 + Math.random() * 0.12})`
    ctx.fillRect(Math.random() * 256, Math.random() * 128, 2 + Math.random() * 14, 1 + Math.random() * 2)
  }
  ctx.strokeStyle = 'rgba(25,12,4,0.55)'
  ctx.lineWidth = 2
  for (let x = -128; x < 256; x += 42) {
    ctx.beginPath()
    ctx.moveTo(x, 128)
    ctx.lineTo(x + 128, 0)
    ctx.stroke()
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

/** A soft orange glow for the burning end, drawn additively. */
function glowTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 64
  const ctx = canvas.getContext('2d')!
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32)
  g.addColorStop(0, 'rgba(255,190,90,1)')
  g.addColorStop(0.3, 'rgba(255,90,20,0.5)')
  g.addColorStop(1, 'rgba(255,60,10,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 64, 64)
  return new THREE.CanvasTexture(canvas)
}

interface Puff {
  position: THREE.Vector3
  velocity: THREE.Vector3
  age: number
  life: number
}

export class ColaniHead implements HeadView {
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 60)
  private head = new THREE.Group()
  private faceCanvas = document.createElement('canvas')
  private faceTexture: THREE.CanvasTexture
  private faceScale: number
  private faceKey = ''
  private textures: THREE.Texture[] = []
  /** The cigar's burning end: a glowing ring and a halo. */
  private ember = new THREE.MeshBasicMaterial({ color: 0xff5a1a })
  private halo: THREE.Sprite
  private tip = new THREE.Object3D()
  private mouth = new THREE.Object3D()
  private smoke: THREE.Points
  private smokeMaterial: THREE.ShaderMaterial
  private puffs: Puff[] = []
  private nextSmoke = 0
  private gaze: GazeSpring
  private face = { happy: 0, curious: 0 }
  private faceTarget = { happy: 0, curious: 0 }
  private nextBlink = 1.5
  private blinkUntil = -1
  private nextPuff = between([3, 5])
  private drawAt = -100
  private nextSpin = between([8, 14])
  private spinAt = -100
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
    this.renderer.setClearColor(0xd5dbe1, 1)

    this.camera.position.copy(CAM)
    this.camera.lookAt(LOOK)

    // --- the studio wall behind him, the truck, and the light ---------------
    // The floor line on the wall lines up, seen from the camera, with the truck's floor.
    const horizon = CAM.y + (TRUCK_Y - CAM.y) * (CAM.z - WALL_Z) / (CAM.z - TRUCK_Z)
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(WALL_SIZE.x, WALL_SIZE.y), new THREE.ShaderMaterial({
      uniforms: { uSize: { value: WALL_SIZE }, uHorizon: { value: horizon } },
      vertexShader: PASS_VERTEX,
      fragmentShader: STUDIO_FRAGMENT,
      depthWrite: false,
    }))
    wall.position.z = WALL_Z
    wall.renderOrder = -10
    this.scene.add(wall)
    const truck = colaniTruck()
    truck.mesh.position.set(TRUCK_X, TRUCK_Y, TRUCK_Z)
    this.textures.push(truck.texture)
    this.scene.add(truck.mesh)

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8890a0, 0.9))
    const key = new THREE.DirectionalLight(0xfff4e6, 2.2)
    key.position.set(-2.5, 3, 4)
    const fill = new THREE.DirectionalLight(0xdde6ff, 0.6)
    fill.position.set(3, 0.5, 3)
    const rim = new THREE.DirectionalLight(0xffffff, 1.2)
    rim.position.set(1.5, 2, -4)
    this.scene.add(key, fill, rim)

    // --- head -----------------------------------------------------------------
    const profile = headProfile()
    const yellow = new THREE.MeshPhongMaterial({ color: YELLOW, ...PLASTIC })
    const skull = new THREE.Mesh(new THREE.LatheGeometry(profile.points, 96), yellow)
    // The face: a decal a hair's breadth over the front of the head, the band of the
    // outline between the rounded top and bottom, as wide round the head as it is tall -
    // so the square canvas has the same scale across and down, and all its pixels go to the face.
    const step = profile.length / (profile.points.length - 1)
    const band = profile.points.filter((p) => Math.abs(p.y) < H / 2 - 0.03)
    const bandLength = (band.length - 1) * step
    const sector = bandLength / R
    this.faceScale = FACE_SIZE / bandLength
    this.faceCanvas.width = this.faceCanvas.height = FACE_SIZE
    this.faceTexture = new THREE.CanvasTexture(this.faceCanvas)
    this.faceTexture.colorSpace = THREE.SRGBColorSpace
    this.faceTexture.anisotropy = this.renderer.capabilities.getMaxAnisotropy()
    this.textures.push(this.faceTexture)
    this.drawFace({ happy: 0, curious: 0, blink: false })
    const decal = new THREE.Mesh(
      new THREE.LatheGeometry(band.map((p) => new THREE.Vector2(p.x * 1.002, p.y)), 48, -sector / 2, sector),
      new THREE.MeshPhongMaterial({ map: this.faceTexture, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, ...PLASTIC }),
    )
    // The stud on top (under the hair, but it is there), and the neck ring below.
    const stud = new THREE.Mesh(lathe([[0, H / 2 + 0.13], [0.2, H / 2 + 0.13], [0.235, H / 2 + 0.11], [0.24, H / 2 + 0.08], [0.24, H / 2 - 0.05]]), yellow)
    const neck = new THREE.Mesh(lathe([[0.27, -H / 2 + 0.05], [0.27, -H / 2 - NECK + 0.03], [0.3, -H / 2 - NECK + 0.02], [0.3, -H / 2 - NECK], [0, -H / 2 - NECK]]), yellow)
    const cap = new THREE.Mesh(capGeometry(), new THREE.MeshPhongMaterial({ color: HAIR_DEEP, side: THREE.DoubleSide, shininess: 40, specular: new THREE.Color(0x222222) }))
    const locks = new THREE.Mesh(locksGeometry(), new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 70, specular: new THREE.Color(0x4a4a4a) }))
    this.halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }))
    this.textures.push(this.halo.material.map!)
    this.head.add(skull, decal, stud, cap, locks, this.makeCigar())
    this.mouth.position.set(0, -0.13, R + 0.02)
    this.head.add(this.mouth)
    this.scene.add(this.head, neck)

    // --- collar and shoulders ---------------------------------------------------
    const torsoCanvas = document.createElement('canvas')
    torsoCanvas.width = TORSO_SIZE.w
    torsoCanvas.height = TORSO_SIZE.h
    drawTorso(torsoCanvas.getContext('2d')!)
    const torsoPrint = new THREE.CanvasTexture(torsoCanvas)
    torsoPrint.colorSpace = THREE.SRGBColorSpace
    // The extrusion's caps carry their shape's coordinates as uvs: fit the print to the trapezoid.
    torsoPrint.repeat.set(1 / 1.6, 1 / 1.32)
    torsoPrint.offset.set(0.5, 0.5)
    this.textures.push(torsoPrint)
    const sweater = new THREE.MeshPhongMaterial({ color: SWEATER, ...PLASTIC })
    const torso = new THREE.Mesh(torsoGeometry(), [new THREE.MeshPhongMaterial({ map: torsoPrint, ...PLASTIC }), sweater])
    torso.position.y = TORSO_TOP - 0.66 - 0.04
    // The turtleneck, rolled.
    const collar = new THREE.Mesh(new THREE.TorusGeometry(0.29, 0.085, 16, 48), sweater)
    collar.rotation.x = Math.PI / 2
    collar.position.y = TORSO_TOP + 0.01
    this.scene.add(torso, collar)
    for (const side of [-1, 1]) {
      const arm = new THREE.Group()
      const shoulder = new THREE.Mesh(new THREE.SphereGeometry(0.21, 32, 16), sweater)
      const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.2, 1.0, 32), sweater)
      sleeve.position.y = -0.5
      arm.add(shoulder, sleeve)
      arm.position.set(side * 0.74, TORSO_TOP - 0.2, 0)
      arm.rotation.z = side * 0.16
      this.scene.add(arm)
    }

    // --- smoke ----------------------------------------------------------------
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SMOKE * 3), 3))
    geometry.setAttribute('aAge', new THREE.BufferAttribute(new Float32Array(SMOKE).fill(-1), 1))
    geometry.setAttribute('aSeed', new THREE.BufferAttribute(Float32Array.from({ length: SMOKE }, () => Math.random()), 1))
    this.smokeMaterial = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 1 } },
      vertexShader: SMOKE_VERTEX,
      fragmentShader: SMOKE_FRAGMENT,
      transparent: true,
      depthWrite: false,
    })
    this.smoke = new THREE.Points(geometry, this.smokeMaterial)
    this.smoke.frustumCulled = false
    this.scene.add(this.smoke)
    for (let i = 0; i < SMOKE; i++) this.puffs.push({ position: new THREE.Vector3(), velocity: new THREE.Vector3(), age: 2, life: 1 })

    this.resizeObserver = new ResizeObserver(this.resize)
    this.resizeObserver.observe(canvas)
    this.resize()
    document.addEventListener('visibilitychange', this.onVisibility)
    this.tick()
  }

  /** A fat cigar: leaf wrapper, a red band with gold edges, grey ash and a glowing ring at the end. */
  private makeCigar() {
    const cigar = new THREE.Group()
    const leaf = leafTexture()
    this.textures.push(leaf)
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.044, 0.04, CIGAR_LENGTH, 28, 1), new THREE.MeshPhongMaterial({ map: leaf, shininess: 25, specular: new THREE.Color(0x222222) }))
    body.position.y = CIGAR_LENGTH / 2
    // Round the mouth end into the lips.
    const butt = new THREE.Mesh(new THREE.SphereGeometry(0.04, 20, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), body.material)
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.0455, 0.0455, 0.05, 28), new THREE.MeshPhongMaterial({ color: 0xa3141a, shininess: 90 }))
    band.position.y = 0.1
    const gold = new THREE.MeshPhongMaterial({ color: 0xd9a531, shininess: 120, specular: new THREE.Color(0xffe2a0) })
    for (const y of [0.075, 0.125]) {
      const edge = new THREE.Mesh(new THREE.TorusGeometry(0.046, 0.005, 6, 28), gold)
      edge.rotation.x = Math.PI / 2
      edge.position.y = y
      cigar.add(edge)
    }
    const ash = new THREE.Mesh(new THREE.CylinderGeometry(0.041, 0.044, 0.06, 28), new THREE.MeshPhongMaterial({ color: 0x8f8a84, shininess: 4 }))
    ash.position.y = CIGAR_LENGTH + 0.03
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.044, 0.007, 8, 28), this.ember)
    ring.rotation.x = Math.PI / 2
    ring.position.y = CIGAR_LENGTH + 0.002
    const end = new THREE.Mesh(new THREE.CircleGeometry(0.041, 28), new THREE.MeshPhongMaterial({ color: 0x5e5a56, shininess: 2 }))
    end.rotation.x = -Math.PI / 2
    end.position.y = CIGAR_LENGTH + 0.061
    this.halo.position.y = CIGAR_LENGTH + 0.01
    this.tip.position.y = CIGAR_LENGTH + 0.07
    cigar.add(body, butt, band, ash, ring, end, this.halo, this.tip)
    cigar.position.copy(CIGAR_AT).addScaledVector(CIGAR_DIR, -0.03)
    cigar.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), CIGAR_DIR)
    return cigar
  }

  private drawFace(state: FaceState) {
    const key = `${state.happy > 0.5}${state.curious > 0.5}${state.blink}`
    if (key === this.faceKey) return
    this.faceKey = key
    drawFace(this.faceCanvas.getContext('2d')!, state, this.faceScale)
    this.faceTexture.needsUpdate = true
  }

  private emit(from: THREE.Vector3, velocity: THREE.Vector3, life: number) {
    const puff = this.puffs.find((p) => p.age >= 1)
    if (!puff) return
    puff.position.copy(from)
    puff.velocity.copy(velocity)
    puff.age = 0
    puff.life = life
  }

  private resize = () => {
    const w = this.canvas.clientWidth || window.innerWidth
    const h = this.canvas.clientHeight || window.innerHeight
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / h
    // Keep the head with its hair (about 1.6 wide) in frame on narrow screens.
    const halfFov = THREE.MathUtils.degToRad(FOV / 2)
    const dist = Math.max(CAM.z, 1.8 / (2 * Math.tan(halfFov) * this.camera.aspect))
    this.camera.position.set(CAM.x, CAM.y, dist)
    this.camera.lookAt(LOOK)
    this.camera.updateProjectionMatrix()
    // Pixels per world unit at distance 1, so puffs keep their size in the scene.
    this.smokeMaterial.uniforms.uScale.value = this.renderer.getPixelRatio() * h / (2 * Math.tan(halfFov))
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

    // The face: a new print when the expression changes, a blink every few seconds.
    const k = 1 - Math.exp(-5 * dt)
    this.face.happy += (this.faceTarget.happy - this.face.happy) * k
    this.face.curious += (this.faceTarget.curious - this.face.curious) * k
    if (t > this.nextBlink) {
      this.blinkUntil = t + BLINK_LENGTH
      this.nextBlink = t + between(BLINK_EVERY)
    }
    this.drawFace({ ...this.face, blink: t < this.blinkUntil })

    // He turns his head on the neck; now and then once right round.
    if (t > this.nextSpin) {
      this.spinAt = t
      this.nextSpin = t + SPIN_LENGTH + between(SPIN_EVERY)
    }
    const s = THREE.MathUtils.clamp((t - this.spinAt) / SPIN_LENGTH, 0, 1)
    const spin = s * s * s * (s * (s * 6 - 15) + 10) * Math.PI * 2
    const pose = this.gaze.update(dt, t)
    this.head.rotation.set(-pose.pitch * 0.5, pose.yaw * 0.9 + (s < 1 ? spin : 0), 0, 'YXZ')
    this.head.updateMatrixWorld()

    // The cigar: a draw makes the end glow, a moment later a puff from his mouth.
    if (t > this.nextPuff) {
      this.drawAt = t
      this.nextPuff = t + between(PUFF_EVERY)
    }
    const draw = t - this.drawAt
    const glow = 0.55 + 0.15 * Math.sin(t * 7) * Math.sin(t * 3.1) + (draw < 1.2 ? 0.6 * Math.sin(Math.min(draw / 1.2, 1) * Math.PI) : 0)
    this.ember.color.setRGB(1.0 * glow + 0.3, 0.35 * glow, 0.08 * glow)
    this.halo.scale.setScalar(0.1 + 0.12 * glow)
    this.halo.material.opacity = 0.35 + 0.5 * glow
    const tip = this.tip.getWorldPosition(new THREE.Vector3())
    if (t > this.nextSmoke) {
      this.emit(tip, new THREE.Vector3((Math.random() - 0.5) * 0.04, 0.16 + Math.random() * 0.06, (Math.random() - 0.5) * 0.04), 3 + Math.random())
      this.nextSmoke = t + 0.22
    }
    if (draw > 1.4 && draw < 1.4 + dt * 1.5) {
      const mouth = this.mouth.getWorldPosition(new THREE.Vector3())
      const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(this.head.quaternion)
      for (let i = 0; i < 12; i++) {
        const v = forward.clone().multiplyScalar(0.25 + Math.random() * 0.2)
        v.x += (Math.random() - 0.5) * 0.15
        v.y += 0.05 + Math.random() * 0.1
        this.emit(mouth, v, 2.4 + Math.random())
      }
    }
    const position = this.smoke.geometry.attributes.position as THREE.BufferAttribute
    const age = this.smoke.geometry.attributes.aAge as THREE.BufferAttribute
    for (let i = 0; i < this.puffs.length; i++) {
      const p = this.puffs[i]
      if (p.age < 1) {
        p.age += dt / p.life
        // Rising, slowing, curling a little.
        p.velocity.multiplyScalar(1 - 0.6 * dt)
        p.velocity.y += 0.05 * dt
        p.velocity.x += Math.sin(t * 1.3 + i) * 0.03 * dt
        p.position.addScaledVector(p.velocity, dt)
      }
      position.setXYZ(i, p.position.x, p.position.y, p.position.z)
      age.setX(i, p.age < 1 ? p.age : -1)
    }
    position.needsUpdate = true
    age.needsUpdate = true

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
      style: 'colani',
      webgl: this.renderer.capabilities.isWebGL2 ? 2 : 1,
      headLoaded: true,
      renderedFps: this.renderedFps,
      yaw: Number(this.gaze.yaw.toFixed(3)),
      pitch: Number(this.gaze.pitch.toFixed(3)),
      goal: { ...this.gaze.goal },
      expression: { ...this.face },
      spinning: this.clock.elapsedTime - this.spinAt < SPIN_LENGTH,
    }
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    cancelAnimationFrame(this.raf)
    this.resizeObserver.disconnect()
    document.removeEventListener('visibilitychange', this.onVisibility)
    this.scene.traverse((object) => {
      if (!(object instanceof THREE.Mesh || object instanceof THREE.Points || object instanceof THREE.Sprite)) return
      object.geometry.dispose()
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) material.dispose()
    })
    for (const texture of this.textures) texture.dispose()
    this.renderer.dispose()
  }
}
