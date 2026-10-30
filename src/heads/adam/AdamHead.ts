import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { GazeSpring } from '../GazeSpring'
import type { Expression, HeadView, HeadViewOptions } from '../types'
import { BACKDROP_FRAGMENT, FACE_GLOW, FACE_PAINT, FACE_PARS, PASS_VERTEX } from './shaders'

/**
 * A.D.A.M. - the creature as Mary Shelley's novel (1818) describes him: sallow skin that
 * barely covers what lies beneath, long flowing black hair, watery eyes in dun sockets,
 * thin dark lips and teeth of a pearly white. The seams and the copper electrodes at his
 * temples are ours. He stands in a storm; the electrodes spark with the lightning, and when
 * someone comes close. WebGL 1 safe.
 */

const FOV = 28
const CAM_DIST = 6.1
/** The head in the middle, the shoulders run out at the bottom. */
const CAM_Y = -0.12

/** The head's half-size (head units). */
const HEAD_X = 0.72
const HEAD_Y = 1.08
const HEAD_Z = 0.82
/** The head turns around this point, at the top of the neck. */
const PIVOT = new THREE.Vector3(0, -0.9, 0)

const SKIN = 0xb3a982
const COPPER = 0xa8622f

const MOOD: Record<Expression, { smile: number; wide: number; charge: number }> = {
  neutral: { smile: 0, wide: 0, charge: 0 },
  curious: { smile: 0.1, wide: 1, charge: 0.5 },
  happy: { smile: 0.85, wide: 0.25, charge: 1 },
}
/** Lightning every so often (seconds). */
const FLASH_EVERY = [7, 20]
const between = ([lo, hi]: number[]) => lo + Math.random() * (hi - lo)

/** A long gaunt head with a heavy brow, deep sockets, a straight nose and a hard jaw. UVs seen from the front. */
function headGeometry() {
  const geometry = new THREE.SphereGeometry(1, 128, 96)
  const position = geometry.attributes.position as THREE.BufferAttribute
  const uv = geometry.attributes.uv as THREE.BufferAttribute
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i), y = position.getY(i), z = position.getZ(i)
    const chin = THREE.MathUtils.smoothstep(-y, 0.2, 1)
    const front = Math.max(z, 0)
    const side = Math.abs(x)
    const bump = (cx: number, cy: number, rx: number, ry: number) => Math.exp(-(((side - cx) / rx) ** 2) - (((y - cy) / ry) ** 2)) * front
    const relief = 0.1 * bump(0.33, 0.33, 0.38, 0.08) // brow
      - 0.15 * bump(0.37, 0.16, 0.16, 0.1) // sockets
      + 0.13 * bump(0, 0.02, 0.085, 0.2) // bridge of the nose
      + 0.1 * bump(0, -0.22, 0.1, 0.08) // its tip
      + 0.06 * bump(0.6, -0.08, 0.18, 0.12) // cheekbones
      - 0.1 * bump(0.56, -0.42, 0.2, 0.17) // hollow cheeks
      + 0.035 * bump(0, -0.51, 0.25, 0.055) // lips
      + 0.07 * bump(0, -0.8, 0.26, 0.1) // chin
    const sx = x * HEAD_X * (1 - 0.2 * chin)
    const sy = y * HEAD_Y
    const sz = (z * HEAD_Z + relief) * (1 - 0.06 * chin)
    position.setXYZ(i, sx, sy, sz)
    uv.setXY(i, sx / (2 * HEAD_X) + 0.5, sy / (2 * HEAD_Y) + 0.5)
  }
  geometry.computeVertexNormals()
  return geometry
}

/** Skin put together from pieces: each patch its own pallor, seams with stitches between them. */
function skinTexture() {
  const size = 1024
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, size, size)

  /** A seam: a wobbling line through these points (in 0..1), `curve` of it filled with a tint above. */
  const seam = (points: [number, number][], tint?: string) => {
    const path = points.map(([x, y]) => [x * size, y * size])
    if (tint) {
      ctx.fillStyle = tint
      ctx.beginPath()
      ctx.moveTo(path[0][0], 0)
      for (const [x, y] of path) ctx.lineTo(x, y)
      ctx.lineTo(path[path.length - 1][0], 0)
      ctx.fill()
    }
    ctx.strokeStyle = 'rgba(58, 26, 28, 0.85)'
    ctx.lineCap = 'round'
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.moveTo(path[0][0], path[0][1])
    for (const [x, y] of path.slice(1)) ctx.lineTo(x, y)
    ctx.stroke()
    // Stitches across it, spaced along the line.
    ctx.strokeStyle = 'rgba(18, 12, 14, 0.95)'
    ctx.lineWidth = 3.2
    for (let i = 0; i < path.length - 1; i++) {
      const [ax, ay] = path[i], [bx, by] = path[i + 1]
      const length = Math.hypot(bx - ax, by - ay)
      const nx = -(by - ay) / length, ny = (bx - ax) / length
      for (let s = 12; s < length; s += 26) {
        const x = ax + ((bx - ax) * s) / length, y = ay + ((by - ay) * s) / length
        const reach = 9 + Math.random() * 3
        ctx.beginPath()
        ctx.moveTo(x - nx * reach, y - ny * reach)
        ctx.lineTo(x + nx * reach, y + ny * reach)
        ctx.stroke()
      }
    }
  }

  // Canvas y runs down: the forehead is the upper part. Tints first from the largest patch.
  seam([[0.1, 0.27], [0.32, 0.235], [0.5, 0.262], [0.68, 0.225], [0.92, 0.26]], 'rgba(150, 165, 120, 0.28)')
  seam([[0.73, 0.32], [0.64, 0.45], [0.69, 0.6], [0.63, 0.72]])
  seam([[0.24, 0.72], [0.38, 0.86], [0.55, 0.91], [0.72, 0.84]])

  // Age: furrows across the forehead, folds beside nose and mouth, bags under the eyes.
  const fold = (points: [number, number][], width: number, alpha: number) => {
    ctx.strokeStyle = `rgba(40, 32, 24, ${alpha})`
    ctx.lineWidth = width
    ctx.filter = 'blur(2.5px)'
    ctx.beginPath()
    points.forEach(([x, y], i) => (i ? ctx.lineTo(x * size, y * size) : ctx.moveTo(x * size, y * size)))
    ctx.stroke()
    ctx.filter = 'none'
  }
  for (const y of [0.3, 0.335]) fold([[0.3, y + 0.008], [0.42, y - 0.006], [0.58, y - 0.006], [0.7, y + 0.008]], 4, 0.4)
  for (const side of [-1, 1]) {
    const x = (v: number) => 0.5 + side * v
    fold([[x(0.1), 0.6], [x(0.17), 0.67], [x(0.19), 0.74]], 7, 0.55)
    fold([[x(0.12), 0.45], [x(0.2), 0.47], [x(0.28), 0.45]], 6, 0.45)
    fold([[x(0.03), 0.37], [x(0.05), 0.42]], 5, 0.5)
    fold([[x(0.2), 0.76], [x(0.17), 0.84]], 5, 0.35)
  }

  // Bruises and stains on top of everything.
  for (let i = 0; i < 90; i++) {
    const x = Math.random() * size, y = Math.random() * size, r = 25 + Math.random() * 110
    const stain = ctx.createRadialGradient(x, y, 0, x, y, r)
    const color = i % 3 ? '70, 62, 44' : '62, 48, 76'
    stain.addColorStop(0, `rgba(${color}, ${0.05 + Math.random() * 0.13})`)
    stain.addColorStop(1, `rgba(${color}, 0)`)
    ctx.fillStyle = stain
    ctx.fillRect(x - r, y - r, r * 2, r * 2)
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 4
  return texture
}

/** Soft clouds that wrap at the edges, painted once: the backdrop only moves them. */
function cloudTexture() {
  const size = 512
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#000000'
  ctx.fillRect(0, 0, size, size)
  ctx.globalCompositeOperation = 'lighter'
  for (let i = 0; i < 170; i++) {
    const x = Math.random() * size, y = Math.random() * size, r = 18 + Math.random() * 90
    const light = 8 + Math.random() * 22
    for (const dx of [-size, 0, size]) {
      for (const dy of [-size, 0, size]) {
        const puff = ctx.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, r)
        puff.addColorStop(0, `rgb(${light}, ${light}, ${light})`)
        puff.addColorStop(1, 'rgb(0, 0, 0)')
        ctx.fillStyle = puff
        ctx.fillRect(x + dx - r, y + dy - r, r * 2, r * 2)
      }
    }
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping
  return texture
}

/** Long black hair as one mesh: strands from a parting, past the temples, down to the shoulders. */
function hairGeometry() {
  const strands: THREE.BufferGeometry[] = []
  for (let i = 0; i < 300; i++) {
    const side = i % 2 ? 1 : -1
    const t = Math.random()
    // Where it grows: along the crown, from the parting backwards.
    const root = new THREE.Vector3(side * (0.02 + 0.16 * t), HEAD_Y * (0.96 - 0.2 * t * t), 0.42 - 1 * t)
    const out = 0.66 + 0.14 * Math.random()
    const fall = -1.05 - 0.55 * Math.random()
    const back = -0.1 - 0.62 * t - 0.12 * Math.random()
    const curve = new THREE.CatmullRomCurve3([
      root,
      new THREE.Vector3(side * (out * 0.78), 0.74, 0.2 - 0.78 * t),
      // Past the temple, always outside the face.
      new THREE.Vector3(side * (out + 0.03), 0.18, 0.1 + back * 0.75),
      new THREE.Vector3(side * (out + 0.08), -0.5, back),
      new THREE.Vector3(side * (out + 0.13 + 0.12 * Math.random()), fall, back - 0.1),
    ])
    strands.push(new THREE.TubeGeometry(curve, 14, 0.016 + Math.random() * 0.024, 4, false))
  }
  return mergeGeometries(strands)
}

/** A soft spark of light, brightest in the middle. */
function sparkTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 64
  const ctx = canvas.getContext('2d')!
  const glow = ctx.createRadialGradient(32, 32, 0, 32, 32, 32)
  glow.addColorStop(0, 'rgba(235, 244, 255, 1)')
  glow.addColorStop(0.18, 'rgba(150, 195, 255, 0.75)')
  glow.addColorStop(1, 'rgba(70, 120, 255, 0)')
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, 64, 64)
  return new THREE.CanvasTexture(canvas)
}

/** Shoulders of a very large man under a heavy coat. */
function torsoGeometry() {
  const curve = new THREE.SplineCurve([
    [0.42, -1.14], [0.62, -1.3], [1.08, -1.46], [1.52, -1.66],
    [1.76, -2.0], [1.84, -2.6], [1.8, -3.5],
  ].map(([r, y]) => new THREE.Vector2(r, y)))
  return new THREE.LatheGeometry(curve.getSpacedPoints(80), 96)
}

/** The coat's raised collar, open at the front. Lathe angle 0 looks at the viewer. */
function collarGeometry() {
  const curve = new THREE.SplineCurve([
    [0.68, -1.42], [0.56, -1.26], [0.47, -1.08], [0.5, -0.95],
  ].map(([r, y]) => new THREE.Vector2(r, y)))
  return new THREE.LatheGeometry(curve.getSpacedPoints(24), 72, 0.62, Math.PI * 2 - 1.24)
}

export class AdamHead implements HeadView {
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 60)
  private turn = new THREE.Group()
  private textures: THREE.Texture[] = []
  private paint = {
    uLook: { value: new THREE.Vector2() },
    uBlink: { value: 0 },
    uSmile: { value: 0 },
    uWide: { value: 0 },
  }
  private sky: THREE.ShaderMaterial
  private flashLight: THREE.DirectionalLight
  private sparks: THREE.MeshBasicMaterial
  private gaze: GazeSpring
  private face = { smile: 0, wide: 0, charge: 0 }
  private faceTarget = { smile: 0, wide: 0, charge: 0 }
  private nextBlink = 2
  private blinkUntil = -1
  private flash = 0
  private nextFlash = 2 + Math.random() * 6
  /** A second, weaker stroke follows the first. */
  private echoAt = -1
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
    this.renderer.setClearColor(0x03050a, 1)
    this.renderer.toneMapping = THREE.NeutralToneMapping

    this.camera.position.set(0, CAM_Y, CAM_DIST)
    this.camera.lookAt(0, CAM_Y, 0)

    // --- the storm: cold moonlight from one side, a little warmth from the other ---
    const clouds = cloudTexture()
    this.textures.push(clouds)
    this.sky = new THREE.ShaderMaterial({
      uniforms: { uClouds: { value: clouds }, uTime: { value: 0 }, uFlash: { value: 0 } },
      vertexShader: PASS_VERTEX,
      fragmentShader: BACKDROP_FRAGMENT,
      depthWrite: false,
      toneMapped: false,
    })
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(40, 24), this.sky)
    wall.position.z = -8
    wall.renderOrder = -10
    this.scene.add(wall)

    this.scene.add(new THREE.HemisphereLight(0x5f6f92, 0x14100c, 0.32))
    // Hard from above and one side: it carves the brow, the nose and the hollow cheeks.
    const moon = new THREE.DirectionalLight(0xc6d6f4, 3.1)
    moon.position.set(3.4, 4.6, 3)
    const warm = new THREE.DirectionalLight(0xc9a27a, 0.28)
    warm.position.set(-4, -1, 3)
    const rim = new THREE.DirectionalLight(0x9db8ff, 1.3)
    rim.position.set(-3, 3, -5)
    this.flashLight = new THREE.DirectionalLight(0xd8e4ff, 0)
    this.flashLight.position.set(-2, 5, 4)
    this.scene.add(moon, warm, rim, this.flashLight)

    // --- head ------------------------------------------------------------------
    const patches = skinTexture()
    this.textures.push(patches)
    const skin = new THREE.MeshStandardMaterial({ color: SKIN, map: patches, roughness: 0.62 })
    skin.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.paint)
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vFace;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFace = position;')
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${FACE_PARS}`)
        .replace('#include <color_fragment>', `#include <color_fragment>\n${FACE_PAINT}`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${FACE_GLOW}`)
    }
    const head = new THREE.Group()
    head.add(new THREE.Mesh(headGeometry(), skin))

    head.add(new THREE.Mesh(hairGeometry(), new THREE.MeshStandardMaterial({ color: 0x100f13, roughness: 0.38 })))

    // The electrodes: a copper disc with a rivet on each temple, a spark jumping on it.
    const copper = new THREE.MeshStandardMaterial({ color: COPPER, roughness: 0.34, metalness: 0.7 })
    const spark = sparkTexture()
    this.textures.push(spark)
    this.sparks = new THREE.MeshBasicMaterial({ map: spark, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })
    for (const side of [-1, 1]) {
      const electrode = new THREE.Group()
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.044, 0.05, 0.03, 24), copper)
      disc.rotation.x = Math.PI / 2
      const rivet = new THREE.Mesh(new THREE.SphereGeometry(0.02, 16, 12), copper)
      rivet.position.z = 0.02
      const glow = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.2), this.sparks)
      glow.position.z = 0.045
      electrode.add(disc, rivet, glow)
      electrode.position.set(side * 0.51, 0.36, 0.48)
      electrode.rotation.set(-0.2, side * 0.8, 0)
      head.add(electrode)
    }

    head.position.copy(PIVOT).negate()
    this.turn.position.copy(PIVOT)
    this.turn.add(head)
    this.scene.add(this.turn)

    // --- neck and coat: they do not turn with the head --------------------------
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.42, 0.8, 32), new THREE.MeshStandardMaterial({ color: 0x6b6a4f, roughness: 0.7 }))
    neck.position.y = -1.08
    const coat = new THREE.MeshStandardMaterial({ color: 0x14151a, roughness: 0.82, side: THREE.DoubleSide })
    this.scene.add(neck, new THREE.Mesh(torsoGeometry(), coat), new THREE.Mesh(collarGeometry(), coat))

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
    // Keep the head with its hair and some air in frame on narrow screens.
    const halfFov = THREE.MathUtils.degToRad(FOV / 2)
    this.camera.position.z = Math.max(CAM_DIST, 2.9 / (2 * Math.tan(halfFov) * this.camera.aspect))
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
    Object.assign(this.faceTarget, MOOD[expression])
  }

  private tick = () => {
    if (this.disposed) return
    this.raf = requestAnimationFrame(this.tick)
    const now = performance.now()
    if (now - this.lastFrame < 1000 / this.fps - 2) return
    this.lastFrame = now
    const dt = Math.min(this.clock.getDelta(), 0.1)
    const t = this.clock.elapsedTime

    // A slow, heavy creature: the smile takes its time to arrive.
    this.face.smile += (this.faceTarget.smile - this.face.smile) * (1 - Math.exp(-1.1 * dt))
    this.face.wide += (this.faceTarget.wide - this.face.wide) * (1 - Math.exp(-4 * dt))
    this.face.charge += (this.faceTarget.charge - this.face.charge) * (1 - Math.exp(-3 * dt))

    if (t > this.nextBlink) {
      this.blinkUntil = t + 0.22
      this.nextBlink = t + 3 + Math.random() * 6
    }
    const blink = Math.pow(Math.sin(THREE.MathUtils.clamp(1 - (this.blinkUntil - t) / 0.22, 0, 1) * Math.PI), 2)

    // Lightning: a stroke, and a weaker one right after it.
    if (t > this.nextFlash) {
      this.flash = 1
      this.echoAt = t + 0.13 + Math.random() * 0.12
      this.nextFlash = t + between(FLASH_EVERY)
    }
    if (this.echoAt > 0 && t > this.echoAt) {
      this.flash = Math.max(this.flash, 0.65)
      this.echoAt = -1
    }
    this.flash *= Math.exp(-7 * dt)
    this.sky.uniforms.uTime.value = t
    this.sky.uniforms.uFlash.value = this.flash
    this.flashLight.intensity = 4 * this.flash

    // Sparks crackle with the storm, and when someone comes close.
    const crackle = Math.random() < 0.2 + 0.25 * this.face.charge ? 1 : 0.08
    this.sparks.opacity = Math.min(1, this.flash * 1.2 + this.face.charge * 0.85 * crackle)

    const pose = this.gaze.update(dt, t)
    this.turn.rotation.set(-pose.pitch, pose.yaw, 0.025 * Math.sin(t * 0.31), 'YXZ')
    this.paint.uLook.value.set(
      THREE.MathUtils.clamp((this.gaze.goal.yaw - this.gaze.yaw) * 1.2 + pose.yaw * 0.5, -1, 1),
      THREE.MathUtils.clamp((this.gaze.goal.pitch - this.gaze.pitch) * 1.2 + pose.pitch * 0.6, -1, 1),
    )
    this.paint.uBlink.value = blink
    this.paint.uSmile.value = this.face.smile
    this.paint.uWide.value = this.face.wide

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
      style: 'adam',
      webgl: this.renderer.capabilities.isWebGL2 ? 2 : 1,
      headLoaded: true,
      renderedFps: this.renderedFps,
      yaw: Number(this.gaze.yaw.toFixed(3)),
      pitch: Number(this.gaze.pitch.toFixed(3)),
      goal: { ...this.gaze.goal },
      expression: { ...this.face },
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
    for (const texture of this.textures) texture.dispose()
    this.renderer.dispose()
  }
}
