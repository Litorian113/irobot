import * as THREE from 'three'
import { GazeSpring } from '../GazeSpring'
import type { Expression, HeadView, HeadViewOptions } from '../types'
import { BACKDROP_FRAGMENT, PASS_VERTEX, SEAM_FRAGMENT, SHELL_FRAGMENT, SHELL_VERTEX } from './shaders'

/**
 * O.N.Y.X. - a humanoid in a bright grey studio: a glossy black helmet on a
 * knitted neck and shoulders. Its face is a pixel mark of two squares behind
 * the visor; it blinks and glances, its mood shows in the status arc and the
 * light in the seams. The helmet reflects an analytic studio
 * in its shader, so there is no environment map, no post-processing and no
 * float render target. WebGL 1 safe.
 */

const FOV = 28
const CAM_DIST = 5.2
/** Camera height: the helmet in the middle, the neck, the shoulders run out at the bottom. */
const CAM_Y = -0.28

/** Half extents of the helmet before shaping (head units). */
const RX = 0.6
const RY = 0.8
const RZ = 0.75
/** How square the helmet is: 2 is an ellipsoid. */
const SQUARE = 2.4
/**
 * The seam between helmet and knit, a plane on the unit sphere: it runs from
 * the chin up to the back of the skull. In front of it is the shell.
 */
const SEAM_N = new THREE.Vector3(0, 0.6, 0.8)
const SEAM_D = -0.12
const SEAM_E1 = new THREE.Vector3(1, 0, 0)
const SEAM_E2 = new THREE.Vector3().crossVectors(SEAM_N, SEAM_E1)
/** The head and the top of the neck turn around this point. */
const PIVOT = new THREE.Vector3(0, -0.75, -0.12)

const STATUS: Record<Expression, number> = { neutral: 0, curious: 1, happy: 0.7 }
/** The battery runs down over half an hour, then charges for a minute. */
const DRAIN = 1800
const CHARGE = 60

const smooth = (x: number) => {
  const t = THREE.MathUtils.clamp(x, 0, 1)
  return t * t * (3 - 2 * t)
}

/** The helmet's surface for a direction on the unit sphere. */
function shapeHead(dir: THREE.Vector3, out = new THREE.Vector3()) {
  // A superellipsoid: a fuller crown and straighter sides than a sphere.
  const k = Math.pow(Math.abs(dir.x) ** SQUARE + Math.abs(dir.y) ** SQUARE + Math.abs(dir.z) ** SQUARE, 1 / SQUARE)
  const x = dir.x / k, y = dir.y / k, z = dir.z / k
  // An egg: the crown is wider than the chin.
  const taper = 1 - 0.1 * smooth((0.25 - y) / 1.25)
  // The face is flatter than the back of the skull.
  const flat = 1 - 0.14 * (0.5 + 0.5 * Math.tanh(z * 3))
  // The skull leans back, the chin comes forward.
  return out.set(x * taper * RX, y * RY, z * flat * RZ - y * 0.07)
}

const tmpA = new THREE.Vector3()
const tmpB = new THREE.Vector3()
const tmpC = new THREE.Vector3()
const tmpD = new THREE.Vector3()

/** Outward normal of the helmet at a sphere direction, by finite differences. */
function headNormal(dir: THREE.Vector3, out: THREE.Vector3) {
  const t1 = new THREE.Vector3().crossVectors(dir, Math.abs(dir.y) < 0.9 ? THREE.Object3D.DEFAULT_UP : SEAM_E1).normalize()
  const t2 = new THREE.Vector3().crossVectors(dir, t1)
  const e = 1e-3
  const du = shapeHead(tmpA.copy(dir).addScaledVector(t1, e).normalize(), tmpA)
    .sub(shapeHead(tmpB.copy(dir).addScaledVector(t1, -e).normalize(), tmpB))
  const dv = shapeHead(tmpC.copy(dir).addScaledVector(t2, e).normalize(), tmpC)
    .sub(shapeHead(tmpD.copy(dir).addScaledVector(t2, -e).normalize(), tmpD))
  out.crossVectors(du, dv).normalize()
  if (out.dot(dir) < 0) out.negate()
  return out
}

/** A point on the seam circle of the unit sphere: phi = pi/2 is the back of the skull, -pi/2 the chin. */
function seamDir(phi: number, out = new THREE.Vector3()) {
  const r = Math.sqrt(1 - SEAM_D * SEAM_D)
  return out.copy(SEAM_N).multiplyScalar(SEAM_D)
    .addScaledVector(SEAM_E1, Math.cos(phi) * r)
    .addScaledVector(SEAM_E2, Math.sin(phi) * r)
}

/** Index a (nu + 1) x (nv + 1) vertex grid, each triangle facing along the vertex normals. */
function gridIndex(nu: number, nv: number, positions: number[], normals: number[]) {
  const index: number[] = []
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const a = j * (nu + 1) + i, b = a + nu + 1
      index.push(a, b, a + 1, b, b + 1, a + 1)
    }
  }
  // Check the winding on a triangle in the middle of the grid; flip all if it faces inwards.
  const k = (Math.floor(nv / 2) * nu + Math.floor(nu / 2)) * 6
  const p = (i: number) => new THREE.Vector3().fromArray(positions, index[k + i] * 3)
  const face = new THREE.Vector3().crossVectors(p(1).sub(p(0)), p(2).sub(p(0)))
  if (face.dot(new THREE.Vector3().fromArray(normals, index[k] * 3)) < 0) {
    for (let i = 0; i < index.length; i += 3) [index[i + 1], index[i + 2]] = [index[i + 2], index[i + 1]]
  }
  return index
}

/**
 * The part of the helmet around `axis` up to the seam: the shell (axis in
 * front of the seam) or the knit at the back of the skull (`scale` sets it a
 * little inside the shell, the seam tube hides the step).
 */
function headPart(axis: THREE.Vector3, cosMax: number, scale: number, uvRepeat: [number, number]) {
  const nu = 160, nv = 90
  const thetaMax = Math.acos(cosMax)
  const e2 = new THREE.Vector3().crossVectors(axis, SEAM_E1)
  const positions: number[] = [], normals: number[] = [], uvs: number[] = []
  const dir = new THREE.Vector3(), p = new THREE.Vector3(), n = new THREE.Vector3()
  for (let j = 0; j <= nv; j++) {
    const theta = Math.max(j / nv, 1e-3) * thetaMax
    for (let i = 0; i <= nu; i++) {
      const phi = (i / nu) * Math.PI * 2
      dir.copy(axis).multiplyScalar(Math.cos(theta))
        .addScaledVector(SEAM_E1, Math.cos(phi) * Math.sin(theta))
        .addScaledVector(e2, Math.sin(phi) * Math.sin(theta))
      shapeHead(dir, p).multiplyScalar(scale)
      headNormal(dir, n)
      positions.push(p.x, p.y, p.z)
      normals.push(n.x, n.y, n.z)
      uvs.push((i / nu) * uvRepeat[0], (j / nv) * uvRepeat[1])
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geometry.setIndex(gridIndex(nu, nv, positions, normals))
  return geometry
}

/** A C1 curve through (y, value) keys, y falling: Catmull-Rom tangents, flat beyond the ends. */
function profile(keys: [number, number][]) {
  const slope = (i: number) => {
    const a = keys[Math.max(i - 1, 0)], b = keys[Math.min(i + 1, keys.length - 1)]
    return (b[1] - a[1]) / (b[0] - a[0])
  }
  return (y: number) => {
    if (y >= keys[0][0]) return keys[0][1]
    for (let i = 1; i < keys.length; i++) {
      const [y0, v0] = keys[i - 1], [y1, v1] = keys[i]
      if (y < y1) continue
      const h = y1 - y0, t = (y - y0) / h, t2 = t * t, t3 = t2 * t
      return (2 * t3 - 3 * t2 + 1) * v0 + (t3 - 2 * t2 + t) * h * slope(i - 1)
        + (-2 * t3 + 3 * t2) * v1 + (t3 - t2) * h * slope(i)
    }
    return keys[keys.length - 1][1]
  }
}

/**
 * Neck and torso in head units, by height: half width, half depth and how
 * square the cross-section is. A short, strong neck into the helmet, then
 * the shoulders slope out to the arms; the chest is flat.
 */
const TORSO_WIDTH = profile([[-0.35, 0.42], [-0.8, 0.4], [-1.1, 0.42], [-1.2, 0.46], [-1.3, 0.68], [-1.42, 1.05], [-1.55, 1.4], [-1.68, 1.66], [-1.85, 1.8], [-2.1, 1.86], [-3.6, 1.84]])
const TORSO_DEPTH = profile([[-0.35, 0.42], [-0.8, 0.41], [-1.1, 0.43], [-1.3, 0.52], [-1.6, 0.64], [-2.2, 0.74], [-3.6, 0.74]])
const TORSO_SQUARE = profile([[-1.1, 2], [-1.5, 2.3], [-2.0, 2.7], [-3.6, 2.7]])

/** One repeat of the knit texture, in head units: 16 stitches. */
const KNIT = 0.32

/** A point on the neck and torso; a = 0 faces forward. The neck leans forward a little. */
function neckPoint(a: number, y: number, out = new THREE.Vector3()) {
  const w = TORSO_WIDTH(y), d = TORSO_DEPTH(y), q = TORSO_SQUARE(y)
  const sx = Math.sin(a), cz = Math.cos(a)
  // A superellipse, |x/w|^q + |z/d|^q = 1, along the direction a: smooth for q >= 2.
  const r = Math.pow(Math.abs(sx / w) ** q + Math.abs(cz / d) ** q, -1 / q)
  const centre = -0.12 + 0.15 * (THREE.MathUtils.clamp(y, -1.5, -0.35) + 0.35)
  return out.set(sx * r, y, centre + cz * r)
}

/** The front of the torso at x, y: where the seam tapes run. */
function frontPoint(x: number, y: number, out = new THREE.Vector3()) {
  const w = TORSO_WIDTH(y), d = TORSO_DEPTH(y), q = TORSO_SQUARE(y)
  const centre = -0.12 + 0.15 * (THREE.MathUtils.clamp(y, -1.5, -0.35) + 0.35)
  return out.set(x, y, centre + d * Math.pow(Math.max(0, 1 - Math.abs(x / w) ** q), 1 / q))
}

const NECK_TOP = -0.35
const NECK_BOTTOM = -3.6

/** Neck and shoulders as one knitted surface; `aBend` says how much of the head's turn each vertex follows. */
function neckGeometry() {
  const na = 128, ny = 150
  const positions: number[] = [], normals: number[] = [], uvs: number[] = [], bend: number[] = []
  const p = new THREE.Vector3(), da = new THREE.Vector3(), dy = new THREE.Vector3(), n = new THREE.Vector3()
  const e = 1e-3
  const row = Array.from({ length: na + 1 }, () => new THREE.Vector3())
  const around: number[] = new Array(na + 1)
  let length = 0
  for (let j = 0; j <= ny; j++) {
    const y = NECK_TOP + (NECK_BOTTOM - NECK_TOP) * (j / ny)
    if (j > 0) length += neckPoint(0, y).distanceTo(neckPoint(0, y + (NECK_TOP - NECK_BOTTOM) / ny))
    // The texture's seam runs down the back; stitches are measured from the front so they keep their size.
    for (let i = 0; i <= na; i++) neckPoint((i / na - 0.5) * Math.PI * 2, y, row[i])
    around[0] = 0
    for (let i = 1; i <= na; i++) around[i] = around[i - 1] + row[i].distanceTo(row[i - 1])
    const front = around[na / 2]
    for (let i = 0; i <= na; i++) {
      const a = (i / na - 0.5) * Math.PI * 2
      p.copy(row[i])
      neckPoint(a + e, y, da).sub(neckPoint(a - e, y, tmpA))
      neckPoint(a, y + e, dy).sub(neckPoint(a, y - e, tmpA))
      n.crossVectors(da, dy).normalize()
      if (n.x * Math.sin(a) + n.z * Math.cos(a) < 0) n.negate()
      positions.push(p.x, p.y, p.z)
      normals.push(n.x, n.y, n.z)
      uvs.push((around[i] - front) / KNIT, length / KNIT)
      // The neck twists along with the head; the shoulders stay put.
      bend.push(smooth((y + 1.2) / 0.5))
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geometry.setAttribute('aBend', new THREE.Float32BufferAttribute(bend, 1))
  geometry.setIndex(gridIndex(na, ny, positions, normals))
  return geometry
}

/** A fine pique knit: rows of raised stitches, offset by half a stitch. */
function knitTexture() {
  const size = 256, count = 16, cell = size / count
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#bdbec0'
  ctx.fillRect(0, 0, size, size)
  for (let row = 0; row < count; row++) {
    for (let col = 0; col <= count; col++) {
      const x = col * cell + (row % 2 ? cell / 2 : 0), y = row * cell + cell / 2
      for (const wrap of [0, -size]) {
        const gradient = ctx.createRadialGradient(x + wrap - 2, y - 2, 1, x + wrap, y, cell * 0.55)
        gradient.addColorStop(0, '#f4f4f4')
        gradient.addColorStop(1, '#e0e1e3')
        ctx.fillStyle = gradient
        ctx.beginPath()
        ctx.ellipse(x + wrap, y, cell * 0.46, cell * 0.4, 0, 0, Math.PI * 2)
        ctx.fill()
      }
    }
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping
  texture.colorSpace = THREE.SRGBColorSpace
  // The stitches are symmetric; not flipping keeps WebGL 2 from warning about its 3D texture unpacking.
  texture.flipY = false
  texture.anisotropy = 8
  return texture
}

export class OnyxHead implements HeadView {
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 60)
  private head = new THREE.Group()
  private turn = new THREE.Group()
  private shell: THREE.ShaderMaterial
  private seamLights: THREE.ShaderMaterial
  private chestLight: THREE.MeshBasicMaterial
  private knit: THREE.Texture
  /** The neck follows the head's turn in its vertex shader: (yaw, pitch). */
  private neckTurn = { value: new THREE.Vector2() }
  private gaze: GazeSpring
  private expression: Expression = 'neutral'
  private status = 0
  private pulseAt = -10
  private nextBlink = 1.5
  private blinkUntil = -1
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
    this.renderer.setClearColor(0xc8c8c8, 1)
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

    // Soft and bright, as in a product shot. The helmet has its own studio in its shader.
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8c8c8c, 1.0))
    const key = new THREE.DirectionalLight(0xffffff, 2.8)
    key.position.set(-3, 5, 4)
    const fill = new THREE.DirectionalLight(0xf2f5ff, 0.7)
    fill.position.set(4, 1, 3)
    const rim = new THREE.DirectionalLight(0xffffff, 1.0)
    rim.position.set(1, 2, -5)
    this.scene.add(key, fill, rim)

    // --- head ---------------------------------------------------------------
    this.knit = knitTexture()
    const knitMaterial = new THREE.MeshStandardMaterial({ color: 0xe4e4e4, map: this.knit, roughness: 0.92, metalness: 0 })
    this.shell = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 }, uBlink: { value: 0 }, uStatus: { value: 0 }, uBattery: { value: 1 },
        uLook: { value: new THREE.Vector2() },
      },
      vertexShader: SHELL_VERTEX,
      fragmentShader: SHELL_FRAGMENT,
    })
    const shell = new THREE.Mesh(headPart(SEAM_N, SEAM_D, 1, [1, 1]), this.shell)
    const back = new THREE.Mesh(headPart(SEAM_N.clone().negate(), -SEAM_D, 0.975, [10, 3]), knitMaterial)

    // The seam: a dark gasket all round, a light in it along both sides.
    const ring: THREE.Vector3[] = []
    for (let i = 0; i < 128; i++) ring.push(shapeHead(seamDir((i / 128) * Math.PI * 2)).multiplyScalar(0.988))
    const gasket = new THREE.Mesh(
      new THREE.TubeGeometry(new THREE.CatmullRomCurve3(ring, true), 256, 0.024, 10, true),
      new THREE.MeshStandardMaterial({ color: 0x0c0c0d, roughness: 0.45, metalness: 0.2 }),
    )
    this.seamLights = new THREE.ShaderMaterial({
      uniforms: { uPulse: { value: -1 }, uLevel: { value: 1 } },
      vertexShader: PASS_VERTEX,
      fragmentShader: SEAM_FRAGMENT,
    })
    const strips: THREE.Mesh[] = []
    for (const side of [1, -1]) {
      // From the back of the skull down to just short of the chin.
      const points: THREE.Vector3[] = []
      const dir = new THREE.Vector3(), normal = new THREE.Vector3()
      for (let i = 0; i <= 48; i++) {
        const phi = THREE.MathUtils.lerp(Math.PI / 2 - 0.3, -Math.PI / 2 + 0.5, i / 48)
        seamDir(side > 0 ? phi : Math.PI - phi, dir)
        // On the outside of the gasket.
        points.push(shapeHead(dir).multiplyScalar(0.988).addScaledVector(headNormal(dir, normal), 0.02))
      }
      strips.push(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 96, 0.009, 6), this.seamLights))
    }

    this.head.add(shell, back, gasket, ...strips)
    // Turn around the top of the neck.
    this.turn.position.copy(PIVOT)
    this.head.position.copy(PIVOT).negate()
    this.turn.add(this.head)

    // --- neck and shoulders -------------------------------------------------
    const neckMaterial = knitMaterial.clone()
    neckMaterial.map = this.knit
    neckMaterial.onBeforeCompile = (shader) => {
      shader.uniforms.uTurn = this.neckTurn
      shader.uniforms.uPivot = { value: PIVOT }
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
attribute float aBend;
uniform vec2 uTurn;
uniform vec3 uPivot;
// The head's Euler 'YXZ' (yaw, -pitch), scaled by how much of it this vertex follows.
mat3 bendMatrix() {
  float y = uTurn.x * aBend, x = -uTurn.y * aBend;
  float cy = cos(y), sy = sin(y), cx = cos(x), sx = sin(x);
  return mat3(cy, 0.0, -sy, 0.0, 1.0, 0.0, sy, 0.0, cy) * mat3(1.0, 0.0, 0.0, 0.0, cx, sx, 0.0, -sx, cx);
}`)
        .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nobjectNormal = bendMatrix() * objectNormal;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed = uPivot + bendMatrix() * (transformed - uPivot);')
    }
    const neck = new THREE.Mesh(neckGeometry(), neckMaterial)

    // A small lilac light at the top of the sternum, breathing slowly.
    this.chestLight = new THREE.MeshBasicMaterial({ color: 0x9d8cff })
    const chest = new THREE.Mesh(new THREE.CapsuleGeometry(0.014, 0.1, 4, 12), this.chestLight)
    chest.rotation.z = Math.PI / 2
    chest.position.copy(neckPoint(0, -1.75)).add(new THREE.Vector3(0, 0, 0.012))

    // Raglan seams: light tapes from the base of the neck out to the armpits.
    const tapeMaterial = new THREE.MeshStandardMaterial({ color: 0xf2f2f3, roughness: 0.7 })
    const tapes: THREE.Mesh[] = []
    for (const side of [-1, 1]) {
      const points: THREE.Vector3[] = []
      for (let i = 0; i <= 24; i++) {
        const t = i / 24
        points.push(frontPoint(side * THREE.MathUtils.lerp(0.5, 1.45, Math.pow(t, 0.8)), THREE.MathUtils.lerp(-1.28, -2.7, t)).add(new THREE.Vector3(0, 0, 0.004)))
      }
      tapes.push(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 64, 0.016, 6), tapeMaterial))
    }

    this.scene.add(this.turn, neck, chest, ...tapes)

    this.resizeObserver = new ResizeObserver(this.resize)
    this.resizeObserver.observe(canvas)
    this.resize()
    document.addEventListener('visibilitychange', this.onVisibility)
    this.tick()
  }

  private resize = () => {
    const w = this.canvas.clientWidth || window.innerWidth
    const h = this.canvas.clientHeight || window.innerHeight
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / h
    // Keep the whole helmet (1.2 wide) and some air in frame on narrow screens.
    const halfFov = THREE.MathUtils.degToRad(FOV / 2)
    this.camera.position.z = Math.max(CAM_DIST, 2.6 / (2 * Math.tan(halfFov) * this.camera.aspect))
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
    // Becoming happy sends a pulse of light down the seams.
    if (expression === 'happy' && this.expression !== 'happy') this.pulseAt = this.clock.elapsedTime
    this.expression = expression
  }

  private tick = () => {
    if (this.disposed) return
    this.raf = requestAnimationFrame(this.tick)
    const now = performance.now()
    if (now - this.lastFrame < 1000 / this.fps - 2) return
    this.lastFrame = now
    const dt = Math.min(this.clock.getDelta(), 0.1)
    const t = this.clock.elapsedTime

    if (t > this.nextBlink) {
      this.blinkUntil = t + 0.14
      this.nextBlink = t + 2.5 + Math.random() * 4
    }
    const blink = Math.pow(Math.sin(THREE.MathUtils.clamp(1 - (this.blinkUntil - t) / 0.14, 0, 1) * Math.PI), 2)
    this.status += (STATUS[this.expression] - this.status) * (1 - Math.exp(-6 * dt))

    // The head turns, the neck twists along; the mark glances ahead of the turn.
    const pose = this.gaze.update(dt, t)
    this.turn.rotation.set(-pose.pitch, pose.yaw, 0, 'YXZ')
    this.neckTurn.value.set(pose.yaw, pose.pitch)
    const glanceX = THREE.MathUtils.clamp((this.gaze.goal.yaw - this.gaze.yaw) * 0.1 + pose.yaw * 0.04, -0.06, 0.06)
    const glanceY = THREE.MathUtils.clamp((this.gaze.goal.pitch - this.gaze.pitch) * 0.1 + pose.pitch * 0.04, -0.04, 0.04)

    const cycle = t % (DRAIN + CHARGE)
    const battery = cycle < DRAIN ? 1 - 0.85 * (cycle / DRAIN) : 0.15 + 0.85 * ((cycle - DRAIN) / CHARGE)

    const u = this.shell.uniforms
    u.uTime.value = t
    u.uBlink.value = blink
    u.uStatus.value = this.status
    u.uBattery.value = battery
    ;(u.uLook.value as THREE.Vector2).set(glanceX, glanceY)
    this.seamLights.uniforms.uPulse.value = (t - this.pulseAt) / 0.9
    this.seamLights.uniforms.uLevel.value = 0.85 + 0.15 * Math.sin(t * 0.9)
    this.chestLight.color.setRGB(0.55, 0.45, 1.0).multiplyScalar(0.9 + 0.5 * (0.5 + 0.5 * Math.sin(t * 1.6)))

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
      style: 'onyx',
      webgl: this.renderer.capabilities.isWebGL2 ? 2 : 1,
      headLoaded: true,
      renderedFps: this.renderedFps,
      yaw: Number(this.gaze.yaw.toFixed(3)),
      pitch: Number(this.gaze.pitch.toFixed(3)),
      goal: { ...this.gaze.goal },
      expression: this.expression,
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
    this.knit.dispose()
    this.renderer.dispose()
  }
}
