import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { GazeSpring } from '../GazeSpring'
import type { Expression, HeadView, HeadViewOptions } from '../types'
import { BACKDROP_FRAGMENT, DUST_FRAGMENT, DUST_VERTEX, LENS_FRAGMENT, PASS_VERTEX } from './shaders'

/**
 * W.A.L.L.·E - the rusty little trash robot: two binocular eyes on an axle,
 * a jointed neck. The eyes tilt, the apertures blink and zoom. Now and then
 * lightning strikes: for a few seconds he turns evil - red glowing irises,
 * narrowed apertures, a glare - until the next flash makes him sweet again.
 * WebGL 1 safe: canvas textures and plain GLSL ES 1.0.
 */

const FOV = 32
const CAM_DIST = 3.7
const CAM_Y = 0.45
const LOOK_Y = 0.3
const EVIL_COLOR = new THREE.Color('#ff2a1f')
/** Lightning now and then; the evil spell lasts until the second flash (seconds). */
const LIGHTNING_EVERY = [12, 25]
const EVIL_LENGTH = [2.5, 4]
const BLINK_EVERY = [2.5, 6]
const BLINK_LENGTH = 0.22
/** The neck, from its pivot below the frame to the bottom of the eye mount. */
const NECK = 1.05
const NECK_BASE = -1.25

/** Pose of the eyes per expression: neck lift, roll (outer side up > 0), aperture. */
const FACES: Record<Expression, { lift: number; roll: number; curious: number; aperture: number }> = {
  neutral: { lift: 0, roll: -0.06, curious: 0, aperture: 0.7 },
  curious: { lift: 0.06, roll: 0, curious: 1, aperture: 0.55 },
  happy: { lift: 0.18, roll: -0.12, curious: 0, aperture: 1 },
}
/** Evil: sunk into the neck, a V-shaped glare, apertures down to a pinpoint. */
const EVIL = { lift: -0.08, roll: 0.2, aperture: 0.2 }

const between = ([lo, hi]: number[]) => lo + Math.random() * (hi - lo)
/** One lightning strike: a bright flash and a weaker second one. */
const strike = (age: number) => age < 0 ? 0 : Math.exp(-age * 16) + (age > 0.14 ? 0.6 * Math.exp(-(age - 0.14) * 11) : 0)

type Point = [number, number]

/** Convex hull, counter-clockwise (monotone chain). */
function hull(points: Point[]) {
  const sorted = [...points].sort((p, q) => p[0] - q[0] || p[1] - q[1])
  const cross = (o: Point, a: Point, b: Point) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const half = (list: Point[]) => {
    const chain: Point[] = []
    for (const p of list) {
      while (chain.length >= 2 && cross(chain[chain.length - 2], chain[chain.length - 1], p) <= 0) chain.pop()
      chain.push(p)
    }
    chain.pop()
    return chain
  }
  return [...half(sorted), ...half([...sorted].reverse())]
}

/**
 * The outline of the right eye (outer side +x), shrunk by `d`: a big round
 * body drawn up into a rounded tip at the top inner corner - a teardrop.
 */
function teardrop(d: number) {
  const points: Point[] = []
  for (const [cx, cy, r] of [[0.05, -0.04, 0.4], [-0.3, 0.26, 0.1]]) {
    for (let i = 0; i < 64; i++) {
      const a = (i / 64) * Math.PI * 2
      points.push([cx + Math.cos(a) * (r - d), cy + Math.sin(a) * (r - d)])
    }
  }
  return hull(points)
}

function toShape(points: Point[], path: THREE.Path = new THREE.Shape()) {
  path.setFromPoints(points.map(([x, y]) => new THREE.Vector2(x, y)))
  return path as THREE.Shape
}

function extrude(shape: THREE.Shape, depth: number, bevel: number) {
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth, curveSegments: 10, bevelEnabled: true,
    bevelThickness: bevel, bevelSize: bevel * 0.9, bevelSegments: 4,
  })
  geometry.translate(0, 0, -depth / 2)
  return geometry
}

/** Weathered metal, painted on a canvas: speckles, grime, rust runs and scratches. */
function grime(base: string, rust: number, brushed = false) {
  const size = 256
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = base
  ctx.fillRect(0, 0, size, size)
  for (let i = 0; i < 1600; i++) {
    const dark = Math.random() < 0.6
    ctx.fillStyle = dark ? `rgba(40,24,12,${0.04 + Math.random() * 0.12})` : `rgba(230,220,200,${0.03 + Math.random() * 0.06})`
    ctx.beginPath()
    ctx.arc(Math.random() * size, Math.random() * size, 0.5 + Math.random() * 5, 0, Math.PI * 2)
    ctx.fill()
  }
  for (let i = 0; i < 70 * rust; i++) {
    const x = Math.random() * size, y = Math.random() * size, h = 15 + Math.random() * 80
    const run = ctx.createLinearGradient(x, y, x, y + h)
    run.addColorStop(0, `rgba(120,52,18,${0.25 + Math.random() * 0.35})`)
    run.addColorStop(1, 'rgba(120,52,18,0)')
    ctx.fillStyle = run
    ctx.fillRect(x, y, 1 + Math.random() * 4, h)
  }
  for (let i = 0; i < 40 * rust; i++) {
    ctx.fillStyle = `rgba(${130 + Math.random() * 40},${55 + Math.random() * 25},20,${0.15 + Math.random() * 0.3})`
    ctx.beginPath()
    ctx.arc(Math.random() * size, Math.random() * size, 3 + Math.random() * 14, 0, Math.PI * 2)
    ctx.fill()
  }
  // Brushed metal: fine horizontal grain.
  for (let i = 0; brushed && i < 500; i++) {
    const y = Math.random() * size
    ctx.fillStyle = Math.random() < 0.5 ? 'rgba(255,250,240,0.07)' : 'rgba(30,25,20,0.07)'
    ctx.fillRect(Math.random() * size - 60, y, 40 + Math.random() * 160, 0.6 + Math.random() * 0.8)
  }
  ctx.strokeStyle = 'rgba(255,245,225,0.12)'
  for (let i = 0; i < 30; i++) {
    const x = Math.random() * size, y = Math.random() * size, a = Math.random() * Math.PI
    ctx.lineWidth = 0.5 + Math.random()
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.lineTo(x + Math.cos(a) * 30, y + Math.sin(a) * 30)
    ctx.stroke()
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping
  return texture
}

interface Eye {
  group: THREE.Group
  side: number
  lens: THREE.ShaderMaterial
}

export class WalleHead implements HeadView {
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 60)
  private composer: EffectComposer
  private turn = new THREE.Group()
  private neck = new THREE.Group()
  private head = new THREE.Group()
  private eyes: Eye[] = []
  private backdrop: THREE.ShaderMaterial
  private dust: THREE.ShaderMaterial
  private textures: THREE.Texture[] = []
  private key: THREE.DirectionalLight
  private flashLight: THREE.DirectionalLight
  /** The red glow of the evil eyes on the plates. */
  private evilLight: THREE.PointLight
  private gaze: GazeSpring
  private face = { ...FACES.neutral }
  private faceTarget = { ...FACES.neutral }
  /** Idle focusing: the lenses zoom in and out on their own. */
  private zoom = 0
  private zoomTarget = 0
  private nextZoom = 3
  private nextBlink = 1.5
  private blinkUntil = -1
  /** The two flashes of a spell: the first makes him evil, the second sweet again. */
  private nextLightning = between([5, 9])
  private firstFlash = -100
  private secondFlash = -100
  private evil = 0
  /** After the spell: a relieved little lift of the eyes. */
  private relief = 0
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
    this.renderer.setClearColor(0x050403, 1)
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.1

    this.camera.position.set(0, CAM_Y, CAM_DIST)
    this.camera.lookAt(0, LOOK_Y, 0)

    // --- room ---------------------------------------------------------------
    this.backdrop = new THREE.ShaderMaterial({
      uniforms: { uFlash: { value: 0 }, uEvil: { value: 0 } },
      vertexShader: PASS_VERTEX,
      fragmentShader: BACKDROP_FRAGMENT,
      depthWrite: false,
    })
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(40, 24), this.backdrop)
    wall.position.z = -6
    wall.renderOrder = -10
    this.scene.add(wall)
    this.dust = this.makeDust()

    this.scene.add(new THREE.HemisphereLight(0xffe2c0, 0x2a1a10, 0.9))
    // Warm late-afternoon key from the left, a cool rim from behind.
    this.key = new THREE.DirectionalLight(0xffd7a8, 1.9)
    this.key.position.set(-3, 4, 5)
    const rim = new THREE.DirectionalLight(0x9fb8ff, 0.8)
    rim.position.set(3, 2, -4)
    const fill = new THREE.DirectionalLight(0x8090b0, 0.3)
    fill.position.set(3, 1, 4)
    this.flashLight = new THREE.DirectionalLight(0xe8e8ff, 0)
    this.flashLight.position.set(0.5, 4, 3)
    this.scene.add(this.key, rim, fill, this.flashLight)

    // --- materials ----------------------------------------------------------
    const material = (base: string, rust: number, roughness: number, metalness: number, brushed = false) => {
      const map = grime(base, rust, brushed)
      this.textures.push(map)
      return new THREE.MeshStandardMaterial({ map, roughness, metalness })
    }
    const rimMaterial = material('#6e4a34', 1.2, 0.78, 0.3)
    // Worn silver: brushed plates, darker tubes behind them.
    const plateMaterial = material('#c4c0b8', 0.2, 0.5, 0.35, true)
    plateMaterial.map!.repeat.set(2, 2)
    const housingMaterial = material('#77726a', 0.8, 0.6, 0.35, true)
    const darkMaterial = new THREE.MeshStandardMaterial({ color: 0x17140f, roughness: 0.55, metalness: 0.35 })
    const steelMaterial = new THREE.MeshStandardMaterial({ color: 0x9a968e, roughness: 0.4, metalness: 0.45 })
    const gasketMaterial = new THREE.MeshStandardMaterial({ color: 0x0c0b0a, roughness: 0.45, metalness: 0.1 })

    // --- eyes ---------------------------------------------------------------
    for (const side of [-1, 1]) {
      // Mirrored for the left eye, reversed to stay counter-clockwise.
      const outline = (d: number) => side > 0 ? teardrop(d) : teardrop(d).map(([x, y]) => [-x, y] as Point).reverse()
      const housing = new THREE.Group()

      // A deep tube, then one brushed front plate with a thin raised lip all around.
      const shell = new THREE.Mesh(extrude(toShape(outline(0)), 0.55, 0.03), housingMaterial)
      const face = new THREE.Mesh(extrude(toShape(outline(0.02)), 0.02, 0.008), plateMaterial)
      face.position.z = 0.315
      const lipShape = toShape(outline(0))
      lipShape.holes.push(toShape(outline(0.032), new THREE.Path()))
      const lip = new THREE.Mesh(extrude(lipShape, 0.03, 0.012), steelMaterial)
      lip.position.z = 0.33
      housing.add(shell, face, lip)

      // Countersunk screws: by the tip, on the outer curve, at the bottom.
      for (const [x, y] of [[-0.3, 0.25], [0.38, 0.06], [-0.1, -0.33]] as Point[]) {
        const socket = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.01, 14), darkMaterial)
        const screw = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.018, 0.016, 10), steelMaterial)
        socket.rotation.x = screw.rotation.x = Math.PI / 2
        socket.position.set(side * x, y, 0.33)
        screw.position.set(side * x, y, 0.334)
        housing.add(socket, screw)
      }

      // The binocular lens: a barrel, a thick black gasket, the domed glass in front of the barrel's cap.
      const lensAt = new THREE.Vector2(side * 0.01, -0.01)
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.265, 0.275, 0.12, 48), darkMaterial)
      barrel.rotation.x = Math.PI / 2
      barrel.position.set(lensAt.x, lensAt.y, 0.37)
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.25, 0.036, 14, 56), gasketMaterial)
      ring.position.set(lensAt.x, lensAt.y, 0.425)
      const lens = new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 }, uAperture: { value: 0.7 }, uZoom: { value: 0 }, uEvil: { value: 0 },
          uFlash: { value: 0 }, uSide: { value: side }, uTurn: { value: new THREE.Vector2() },
          uEvilColor: { value: EVIL_COLOR },
        },
        vertexShader: PASS_VERTEX,
        fragmentShader: LENS_FRAGMENT,
      })
      const glass = new THREE.Mesh(new THREE.CircleGeometry(0.25, 56), lens)
      glass.position.set(lensAt.x, lensAt.y, 0.436)
      housing.add(barrel, ring, glass)

      // A bracket down to the axle.
      const bracket = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.2, 0.2), darkMaterial)
      bracket.position.set(side * -0.24, -0.4, -0.03)
      housing.add(bracket)

      housing.position.set(side * 0.45, 0.48, -0.02)
      // The eye tilts and rolls around its end of the axle.
      const group = new THREE.Group()
      group.position.x = side * 0.04
      group.add(housing)
      this.eyes.push({ group, side, lens })
      this.head.add(group)
    }

    // The axle the eyes tilt on, and the mount on top of the neck.
    const axle = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 1.0, 20), steelMaterial)
    axle.rotation.z = Math.PI / 2
    axle.position.z = -0.05
    const mount = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.24, 0.3), housingMaterial)
    mount.position.set(0, -0.08, -0.05)
    this.evilLight = new THREE.PointLight(EVIL_COLOR, 0, 2.2, 2)
    this.evilLight.position.set(0, 0.44, 0.75)
    // The little rounded tab between the eyes.
    const tab = new THREE.Mesh(new THREE.CapsuleGeometry(0.07, 0.16, 6, 16), plateMaterial)
    tab.position.set(0, 0.5, 0.05)
    this.head.add(axle, mount, tab, this.evilLight)

    // --- neck ---------------------------------------------------------------
    // Two struts with a joint and a piston; it stretches when he perks up.
    const joint = NECK * 0.55
    const lower = new THREE.Mesh(new THREE.BoxGeometry(0.17, joint, 0.13), rimMaterial)
    lower.position.y = joint / 2
    const knuckle = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.24, 20), steelMaterial)
    knuckle.rotation.z = Math.PI / 2
    knuckle.position.y = joint
    const upper = new THREE.Mesh(new THREE.BoxGeometry(0.14, NECK - joint, 0.11), housingMaterial)
    upper.position.y = (joint + NECK) / 2
    const piston = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, NECK, 12), steelMaterial)
    piston.position.set(0.11, NECK / 2, -0.09)
    const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, joint * 0.8, 12), darkMaterial)
    sleeve.position.set(0.11, joint * 0.4, -0.09)
    this.neck.add(lower, knuckle, upper, piston, sleeve)
    // Below the pivot the neck runs on out of the frame: a robot, not a floating head.
    const column = new THREE.Mesh(new THREE.BoxGeometry(0.19, 2.5, 0.15), rimMaterial)
    column.position.y = -1.25
    this.turn.add(this.neck, column, this.head)
    this.turn.position.set(0, NECK_BASE, -0.1)
    this.scene.add(this.turn)

    // --- post ---------------------------------------------------------------
    this.composer = new EffectComposer(this.renderer)
    this.composer.addPass(new RenderPass(this.scene, this.camera))
    // Only what glows blooms: the evil eyes and the lightning.
    this.composer.addPass(new UnrealBloomPass(new THREE.Vector2(1, 1), 0.6, 0.4, 0.9))
    this.composer.addPass(new OutputPass())

    this.resizeObserver = new ResizeObserver(this.resize)
    this.resizeObserver.observe(canvas)
    this.resize()
    document.addEventListener('visibilitychange', this.onVisibility)
    this.tick()
  }

  /** Warm dust motes floating in the light. */
  private makeDust() {
    const count = 120
    const seed = new Float32Array(count * 4)
    for (let i = 0; i < seed.length; i++) seed[i] = Math.random()
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3))
    geometry.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4))
    const material = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uScale: { value: 1 }, uColor: { value: new THREE.Color('#ffd9a0') } },
      vertexShader: DUST_VERTEX,
      fragmentShader: DUST_FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
    const points = new THREE.Points(geometry, material)
    points.frustumCulled = false
    this.scene.add(points)
    return material
  }

  private resize = () => {
    const w = this.canvas.clientWidth || window.innerWidth
    const h = this.canvas.clientHeight || window.innerHeight
    this.renderer.setSize(w, h, false)
    this.composer.setSize(w, h)
    this.camera.aspect = w / h
    // Keep both eyes (about 2 wide) in frame on narrow screens.
    const halfFov = THREE.MathUtils.degToRad(FOV / 2)
    const dist = Math.max(CAM_DIST, 2.5 / (2 * Math.tan(halfFov) * this.camera.aspect))
    this.camera.position.set(0, CAM_Y, dist)
    this.camera.lookAt(0, LOOK_Y, 0)
    this.camera.updateProjectionMatrix()
    this.dust.uniforms.uScale.value = this.renderer.getPixelRatio() * h / 700
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

    // Expressions ease in; the apertures blink every few seconds.
    const k = 1 - Math.exp(-4 * dt)
    for (const key of ['lift', 'roll', 'curious', 'aperture'] as const) {
      this.face[key] += (this.faceTarget[key] - this.face[key]) * k
    }
    if (t > this.nextBlink) {
      this.blinkUntil = t + BLINK_LENGTH
      this.nextBlink = t + between(BLINK_EVERY)
    }
    const blink = Math.pow(Math.sin(THREE.MathUtils.clamp(1 - (this.blinkUntil - t) / BLINK_LENGTH, 0, 1) * Math.PI), 2)
    if (t > this.nextZoom) {
      this.zoomTarget = Math.random() < 0.5 ? 0 : 0.3 + Math.random() * 0.5
      this.nextZoom = t + 3 + Math.random() * 5
    }
    this.zoom += (Math.max(this.zoomTarget, this.face.curious) - this.zoom) * (1 - Math.exp(-6 * dt))

    // Lightning: the first flash makes him evil, the second one sweet again.
    if (t > this.nextLightning) {
      this.firstFlash = t
      this.secondFlash = t + between(EVIL_LENGTH)
      this.nextLightning = this.secondFlash + between(LIGHTNING_EVERY)
    }
    const flash = strike(t - this.firstFlash) + strike(t - this.secondFlash)
    // He changes while the flash still blinds: a cut, not a fade.
    const spell = t > this.firstFlash + 0.05 && t < this.secondFlash + 0.05
    if (!spell && this.evil > 0.5) this.relief = 1
    this.evil += ((spell ? 1 : 0) - this.evil) * (1 - Math.exp(-14 * dt))
    this.relief *= Math.exp(-dt * 1.2)
    const evil = this.evil
    const relief = this.relief

    // The head turns on its neck; the eyes tilt on their axle to look up and down.
    const pose = this.gaze.update(dt, t)
    const tremble = evil * Math.sin(t * 31) * 0.008
    const lift = THREE.MathUtils.lerp(this.face.lift, EVIL.lift, evil) + relief * 0.12
    const roll = THREE.MathUtils.lerp(this.face.roll, EVIL.roll, evil) - relief * 0.05
    const curious = this.face.curious * (1 - evil)
    this.neck.scale.y = (NECK + lift) / NECK
    this.head.position.y = NECK + 0.2 + lift
    // Evil: he leans in and glares.
    this.head.rotation.x = -pose.pitch * 0.3 + evil * 0.12
    this.turn.rotation.set(0, pose.yaw, curious * 0.1 + tremble, 'YXZ')
    const aperture = THREE.MathUtils.lerp(this.face.aperture, EVIL.aperture, evil) * (1 - 0.92 * blink * (1 - evil))
    for (const eye of this.eyes) {
      // Curious: one eye cocked higher than the other.
      const cock = curious * (eye.side > 0 ? 0.16 : -0.06)
      eye.group.rotation.x = -pose.pitch * 0.7 - cock - relief * 0.08
      eye.group.rotation.z = eye.side * (roll + cock * 0.8)
      // The glare swings the inner corners together: spread the eyes so they never touch.
      eye.group.position.x = eye.side * (0.04 + 0.1 * evil)
      const u = eye.lens.uniforms
      u.uTime.value = t
      u.uAperture.value = THREE.MathUtils.clamp(aperture, 0, 1)
      u.uZoom.value = Math.max(this.zoom, evil)
      u.uEvil.value = evil
      u.uFlash.value = flash
      ;(u.uTurn.value as THREE.Vector2).set(pose.yaw * 0.45, pose.pitch * 0.6)
    }

    this.key.intensity = 1.9 * (1 - 0.55 * evil)
    this.flashLight.intensity = flash * 4
    this.evilLight.intensity = evil * (0.7 + 0.15 * Math.sin(t * 9))
    this.backdrop.uniforms.uFlash.value = flash
    this.backdrop.uniforms.uEvil.value = evil
    this.dust.uniforms.uTime.value = t

    this.composer.render()
    this.fpsCount++
    if (now - this.fpsSince > 1000) {
      this.renderedFps = this.fpsCount
      this.fpsCount = 0
      this.fpsSince = now
    }
  }

  debug() {
    return {
      style: 'walle',
      webgl: this.renderer.capabilities.isWebGL2 ? 2 : 1,
      headLoaded: true,
      renderedFps: this.renderedFps,
      yaw: Number(this.gaze.yaw.toFixed(3)),
      pitch: Number(this.gaze.pitch.toFixed(3)),
      goal: { ...this.gaze.goal },
      expression: { ...this.face },
      evil: Number(this.evil.toFixed(2)),
    }
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    cancelAnimationFrame(this.raf)
    this.resizeObserver.disconnect()
    document.removeEventListener('visibilitychange', this.onVisibility)
    this.scene.traverse((object) => {
      if (!(object instanceof THREE.Mesh || object instanceof THREE.Points)) return
      object.geometry.dispose()
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) material.dispose()
    })
    for (const texture of this.textures) texture.dispose()
    for (const pass of this.composer.passes) pass.dispose()
    this.composer.dispose()
    this.renderer.dispose()
  }
}
