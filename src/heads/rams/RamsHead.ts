import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { GazeSpring } from '../GazeSpring'
import type { Expression, HeadView, HeadViewOptions } from '../types'
import { BACKDROP_FRAGMENT, DIAL_FRAGMENT, PASS_VERTEX, SHADOW_FRAGMENT } from './shaders'

/**
 * R.A.M.S. - Dieter Rams as one of his Braun devices. The head is a white
 * housing split like the TP 1, his round black glasses are two dials with
 * turned aluminium eyes, the mouth a row of keys, the ears speaker grilles,
 * a leather strap on top. Below: black shirt, grey jacket.
 * He smiles with his keys and eyes; a slider on his cheek and a small orange
 * light show his mood. Less, but better: no post-processing. WebGL 1 safe.
 */

const FOV = 28
const CAM_DIST = 5.8
/** Camera height: the head with its strap in the middle, the shoulders run out at the bottom. */
const CAM_Y = 0.12

/** The housing (head units): front face at z = FRONT. */
const W = 1.1
const H = 1.55
const D = 0.85
const FRONT = D / 2
const CORNER = 0.09
/** The split between the upper part (his white hair) and the lower part. */
const SPLIT = 0.369
/** Eyes: dial centres, the frame's outer and inner radius. */
const EYES = [-0.25, 0.25]
const EYE_Y = 0.08
const RIM_OUT = 0.2
const RIM_IN = 0.152
/** The mouth: five keys in a row. */
const KEYS = [-0.26, -0.13, 0, 0.13, 0.26]
const KEY_Y = -0.42
/** The head turns around this point, at the top of the neck. */
const PIVOT = new THREE.Vector3(0, -0.85, 0)

const HOUSING = new THREE.Color('#ebe8e1')
const HAIR = new THREE.Color('#f5f4f0')
const SIGNAL = new THREE.Color('#ff6a1a')

const MOOD: Record<Expression, { happy: number; curious: number }> = {
  neutral: { happy: 0, curious: 0 },
  curious: { happy: 0, curious: 1 },
  happy: { happy: 1, curious: 0 },
}
/** Now and then a key is pressed, as if by a finger (seconds). */
const PRESS_EVERY = [5, 12]
const PRESS_LENGTH = 0.35

const between = ([lo, hi]: number[]) => lo + Math.random() * (hi - lo)

/** A rounded rectangle centred on the origin. */
function roundedRect(w: number, h: number, r: number, path: THREE.Path = new THREE.Shape()) {
  const x = -w / 2, y = -h / 2
  path.moveTo(x + r, y)
  path.lineTo(x + w - r, y)
  path.absarc(x + w - r, y + r, r, -Math.PI / 2, 0, false)
  path.lineTo(x + w, y + h - r)
  path.absarc(x + w - r, y + h - r, r, 0, Math.PI / 2, false)
  path.lineTo(x + r, y + h)
  path.absarc(x + r, y + h - r, r, Math.PI / 2, Math.PI, false)
  path.lineTo(x, y + r)
  path.absarc(x + r, y + r, r, Math.PI, Math.PI * 1.5, false)
  return path
}

/** A round frame of the glasses: an annulus, extruded towards the viewer. */
function rimGeometry() {
  const shape = new THREE.Shape().absarc(0, 0, RIM_OUT, 0, Math.PI * 2, false)
  shape.holes.push(new THREE.Path().absarc(0, 0, RIM_IN, 0, Math.PI * 2, true))
  return new THREE.ExtrudeGeometry(shape, {
    depth: 0.035, curveSegments: 48, bevelEnabled: true,
    bevelThickness: 0.012, bevelSize: 0.01, bevelSegments: 3,
  })
}

/** Speaker grille, T 3 style: holes on concentric rings. White, so it takes the housing's colour. */
function grilleTexture() {
  const size = 256
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, size, size)
  ctx.fillStyle = '#4a4844'
  const hole = (x: number, y: number) => {
    ctx.beginPath()
    ctx.arc(size / 2 + x, size / 2 + y, 4.2, 0, Math.PI * 2)
    ctx.fill()
  }
  hole(0, 0)
  for (let ring = 1; ring <= 7; ring++) {
    const r = ring * 16
    const count = Math.round((Math.PI * 2 * r) / 15)
    for (let i = 0; i < count; i++) hole(Math.cos((i / count) * Math.PI * 2) * r, Math.sin((i / count) * Math.PI * 2) * r)
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 4
  return texture
}

/** Neck to chest, as a lathe: a collar round the neck, shoulders sloping out to the arms. */
function torsoGeometry() {
  const curve = new THREE.SplineCurve([
    [0.31, -0.95], [0.32, -1.05], [0.37, -1.15], [0.65, -1.27], [1.05, -1.38],
    [1.45, -1.5], [1.68, -1.68], [1.78, -1.95], [1.78, -2.6], [1.72, -3.4],
  ].map(([r, y]) => new THREE.Vector2(r, y)))
  // The seam of the lathe at the back.
  const geometry = new THREE.LatheGeometry(curve.getSpacedPoints(120), 128, Math.PI)
  const position = geometry.attributes.position as THREE.BufferAttribute
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i), z = position.getZ(i)
    // Round at the neck, flat at the chest: depth levels off at 0.7.
    const r = Math.hypot(x, z)
    const depth = r / Math.pow(1 + (r / 0.7) ** 4, 0.25)
    position.setZ(i, r > 0 ? (z / r) * depth - 0.05 : z)
  }
  geometry.computeVertexNormals()
  return geometry
}

export class RamsHead implements HeadView {
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 60)
  private head = new THREE.Group()
  private turn = new THREE.Group()
  private strap = new THREE.Group()
  private dials: THREE.ShaderMaterial[] = []
  private keys: THREE.Mesh[] = []
  private knob: THREE.Mesh
  private signal: THREE.MeshBasicMaterial
  private grille: THREE.Texture
  private gaze: GazeSpring
  private face = { happy: 0, curious: 0 }
  private faceTarget = { happy: 0, curious: 0 }
  private mood = 0.2
  private status = 0
  private nextBlink = 1.5
  private blinkUntil = -1
  private nextPress = between(PRESS_EVERY)
  private pressUntil = -1
  private pressKey = 0
  /** The strap swings on its rivets when the head nods. */
  private swing = 0
  private swingVel = 0
  private lastPitch = 0
  private lastPitchVel = 0
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
    this.renderer.setClearColor(0xd8d4cc, 1)
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

    this.scene.add(new THREE.HemisphereLight(0xfffaf2, 0x8a857c, 1.1))
    const key = new THREE.DirectionalLight(0xffffff, 2.6)
    key.position.set(-3, 4, 5)
    const fill = new THREE.DirectionalLight(0xeef2ff, 0.8)
    fill.position.set(4, 1, 3)
    const rim = new THREE.DirectionalLight(0xffffff, 1.2)
    rim.position.set(2, 3, -5)
    this.scene.add(key, fill, rim)

    // --- housing ------------------------------------------------------------
    const housing = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 })
    // Above the split the housing is a little whiter: his hair.
    housing.onBeforeCompile = (shader) => {
      shader.uniforms.uHousing = { value: HOUSING }
      shader.uniforms.uHair = { value: HAIR }
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying float vHeight;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvHeight = position.y;')
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vHeight;\nuniform vec3 uHousing, uHair;')
        .replace('#include <color_fragment>', `#include <color_fragment>\n  diffuseColor.rgb = vHeight > ${SPLIT.toFixed(3)} ? uHair : uHousing;`)
    }
    const dark = new THREE.MeshStandardMaterial({ color: 0x232323, roughness: 0.7 })
    const frame = new THREE.MeshStandardMaterial({ color: 0x0d0d0d, roughness: 0.22 })
    const keyMaterial = new THREE.MeshStandardMaterial({ color: 0xd6d3cc, roughness: 0.45 })
    const alu = new THREE.MeshStandardMaterial({ color: 0xc9ccd0, roughness: 0.35, metalness: 0.2 })
    const leather = new THREE.MeshStandardMaterial({ color: 0x9c6a42, roughness: 0.75 })

    const body = new THREE.Mesh(new RoundedBoxGeometry(W, H, D, 5, CORNER), housing)
    // The split: a thin dark line all round, following the rounded corners.
    const outline = roundedRect(W + 0.003, D + 0.003, CORNER + 0.0015) as THREE.Shape
    outline.holes.push(roundedRect(W - 0.03, D - 0.03, CORNER - 0.015))
    const split = new THREE.Mesh(new THREE.ExtrudeGeometry(outline, { depth: 0.007, bevelEnabled: false, curveSegments: 12 }), dark)
    split.rotation.x = -Math.PI / 2
    split.position.y = SPLIT - 0.0035

    // Upper part: a small aluminium plate and the orange signal light.
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.045, 0.008), alu)
    plate.position.set(0.2, 0.6, FRONT + 0.002)
    this.signal = new THREE.MeshBasicMaterial({ color: SIGNAL })
    const signal = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.012, 24), this.signal)
    signal.rotation.x = Math.PI / 2
    signal.position.set(0.38, 0.6, FRONT + 0.004)

    // --- glasses: frames, bridge, temples; aluminium eyes inside ------------
    const glasses: THREE.Object3D[] = []
    const rimShape = rimGeometry()
    for (let i = 0; i < EYES.length; i++) {
      const frameMesh = new THREE.Mesh(rimShape, frame)
      frameMesh.position.set(EYES[i], EYE_Y, FRONT + 0.012)
      const dial = new THREE.ShaderMaterial({
        uniforms: {
          uLook: { value: new THREE.Vector2() }, uBlink: { value: 0 }, uSmile: { value: 0 },
          uSheen: { value: 0.8 }, uPupil: { value: 0.22 }, uLid: { value: HOUSING.clone().multiplyScalar(0.62) },
        },
        vertexShader: PASS_VERTEX,
        fragmentShader: DIAL_FRAGMENT,
      })
      this.dials.push(dial)
      const eye = new THREE.Mesh(new THREE.CircleGeometry(RIM_IN + 0.002, 48), dial)
      eye.position.set(EYES[i], EYE_Y, FRONT + 0.008)
      const side = Math.sign(EYES[i])
      // Hinge across the corner, then the temple back along the side to the ear.
      const hinge = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.034, 0.034), frame)
      hinge.position.set(side * 0.51, EYE_Y + 0.03, FRONT + 0.03)
      const temple = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.03, 0.46), frame)
      temple.position.set(side * (W / 2 + 0.024), EYE_Y + 0.03, FRONT + 0.03 - 0.23)
      glasses.push(frameMesh, eye, hinge, temple, this.softShadow(EYES[i] + 0.02, EYE_Y - 0.025, 0.56, 0.56, 0.32))
    }
    const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.034, 0.03), frame)
    bridge.position.set(0, EYE_Y + 0.06, FRONT + 0.03)

    // --- mouth: a row of keys; a slider beside it ---------------------------
    for (const x of KEYS) {
      const keyMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.042, 0.05, 32), keyMaterial)
      keyMesh.rotation.x = Math.PI / 2
      keyMesh.position.set(x, KEY_Y, FRONT + 0.01)
      this.keys.push(keyMesh)
    }
    const slot = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.3, 0.01), dark)
    slot.position.set(-0.43, -0.42, FRONT)
    this.knob = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.032, 0.03), alu)
    this.knob.position.set(-0.43, -0.42, FRONT + 0.012)

    // --- ears: speaker grilles ----------------------------------------------
    this.grille = grilleTexture()
    const grilleMaterial = new THREE.MeshStandardMaterial({ color: HOUSING, map: this.grille, roughness: 0.55 })
    const ears: THREE.Mesh[] = []
    for (const side of [-1, 1]) {
      const ear = new THREE.Mesh(new THREE.CircleGeometry(0.2, 48), grilleMaterial)
      ear.rotation.y = side * Math.PI / 2
      ear.position.set(side * (W / 2 + 0.002), -0.02, -0.08)
      ears.push(ear)
    }

    // --- strap: leather over the top, on two rivets -------------------------
    const arc: THREE.Vector3[] = []
    for (let i = 0; i <= 40; i++) {
      const a = (i / 40) * Math.PI
      arc.push(new THREE.Vector3(Math.cos(a) * (W / 2 + 0.025), Math.sin(a) * 0.62, 0))
    }
    const band = new THREE.Shape()
    band.moveTo(-0.012, -0.055).lineTo(0.012, -0.055).lineTo(0.012, 0.055).lineTo(-0.012, 0.055).lineTo(-0.012, -0.055)
    const strap = new THREE.Mesh(new THREE.ExtrudeGeometry(band, { steps: 80, bevelEnabled: false, extrudePath: new THREE.CatmullRomCurve3(arc) }), leather)
    this.strap.add(strap)
    for (const side of [-1, 1]) {
      const rivet = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.02, 24), alu)
      rivet.rotation.z = Math.PI / 2
      rivet.position.set(side * (W / 2 + 0.04), 0, 0)
      this.strap.add(rivet)
    }
    this.strap.position.set(0, 0.6, -0.05)

    this.head.add(
      body, split, plate, signal, ...glasses, bridge, ...this.keys, slot, this.knob, ...ears, this.strap,
      this.softShadow(0.01, KEY_Y - 0.015, 0.72, 0.16, 0.12),
    )
    this.turn.position.copy(PIVOT)
    this.head.position.copy(PIVOT).negate()
    this.turn.add(this.head)

    // --- neck, shirt and jacket ---------------------------------------------
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.28, 0.75, 40), new THREE.MeshStandardMaterial({ color: 0x161616, roughness: 0.85 }))
    neck.position.y = -1.08
    const jacket = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, side: THREE.DoubleSide })
    jacket.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vBody;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBody = position;')
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vBody;')
        .replace('#include <color_fragment>', `#include <color_fragment>
  // Black shirt: a collar round the neck, then the V between the lapels, two light buttons.
  float front = smoothstep(0.0, 0.15, vBody.z);
  float edge = abs(vBody.x) - (0.2 + max(0.0, -1.15 - vBody.y) * 0.28);
  float shirt = max(smoothstep(-1.2, -1.16, vBody.y), front * smoothstep(0.008, -0.008, edge));
  float lapel = front * smoothstep(0.012, 0.0, abs(edge - 0.13)) * step(vBody.y, -1.22);
  float buttons = smoothstep(0.03, 0.022, min(length(vBody.xy - vec2(0.0, -1.55)), length(vBody.xy - vec2(0.0, -1.95)))) * front;
  vec3 cloth = mix(vec3(0.26, 0.25, 0.235) * (1.0 - 0.45 * lapel), vec3(0.012), shirt);
  diffuseColor.rgb = mix(cloth, vec3(0.6), buttons);`)
    }
    const torso = new THREE.Mesh(torsoGeometry(), jacket)

    this.scene.add(this.turn, neck, torso)

    this.resizeObserver = new ResizeObserver(this.resize)
    this.resizeObserver.observe(canvas)
    this.resize()
    document.addEventListener('visibilitychange', this.onVisibility)
    this.tick()
  }

  /** A soft shadow on the front of the housing, centred at (x, y). */
  private softShadow(x: number, y: number, w: number, h: number, strength: number) {
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.ShaderMaterial({
      uniforms: { uStrength: { value: strength } },
      vertexShader: PASS_VERTEX,
      fragmentShader: SHADOW_FRAGMENT,
      transparent: true,
      premultipliedAlpha: true,
      blending: THREE.MultiplyBlending,
      depthWrite: false,
    }))
    shadow.position.set(x, y, FRONT + 0.001)
    return shadow
  }

  private resize = () => {
    const w = this.canvas.clientWidth || window.innerWidth
    const h = this.canvas.clientHeight || window.innerHeight
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / h
    // Keep the whole housing with its rivets and some air in frame on narrow screens.
    const halfFov = THREE.MathUtils.degToRad(FOV / 2)
    this.camera.position.z = Math.max(CAM_DIST, 2.4 / (2 * Math.tan(halfFov) * this.camera.aspect))
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

    // Expressions ease in; the slider and the signal light follow more slowly.
    const k = 1 - Math.exp(-5 * dt)
    this.face.happy += (this.faceTarget.happy - this.face.happy) * k
    this.face.curious += (this.faceTarget.curious - this.face.curious) * k
    const slow = 1 - Math.exp(-2.5 * dt)
    this.mood += (0.2 + 0.4 * this.faceTarget.curious + 0.8 * this.faceTarget.happy - this.mood) * slow
    this.status += (Math.max(this.faceTarget.curious, this.faceTarget.happy) - this.status) * k

    if (t > this.nextBlink) {
      this.blinkUntil = t + 0.15
      this.nextBlink = t + 2.5 + Math.random() * 4
    }
    const blink = Math.pow(Math.sin(THREE.MathUtils.clamp(1 - (this.blinkUntil - t) / 0.15, 0, 1) * Math.PI), 2)
    if (t > this.nextPress) {
      this.pressUntil = t + PRESS_LENGTH
      this.pressKey = Math.floor(Math.random() * KEYS.length)
      this.nextPress = t + between(PRESS_EVERY)
    }
    const press = t < this.pressUntil ? Math.sin(((this.pressUntil - t) / PRESS_LENGTH) * Math.PI) : 0

    // The head turns; the eyes glance ahead of it.
    const pose = this.gaze.update(dt, t)
    this.turn.rotation.set(-pose.pitch, pose.yaw, 0, 'YXZ')
    const glanceX = THREE.MathUtils.clamp((this.gaze.goal.yaw - this.gaze.yaw) * 1.2 + pose.yaw * 0.5, -0.45, 0.45)
    const glanceY = THREE.MathUtils.clamp((this.gaze.goal.pitch - this.gaze.pitch) * 1.2 + pose.pitch * 0.6, -0.35, 0.35)

    for (const dial of this.dials) {
      const u = dial.uniforms
      ;(u.uLook.value as THREE.Vector2).set(glanceX, glanceY)
      u.uBlink.value = blink
      u.uSmile.value = this.face.happy
      u.uPupil.value = 0.22 + 0.07 * this.face.curious
      // The turned aluminium catches the key light at an angle that moves as he turns.
      u.uSheen.value = 0.9 - pose.yaw * 1.5
    }

    // Keys: a smile when happy, the middle one pressed when curious, now and then one by a finger.
    for (let i = 0; i < this.keys.length; i++) {
      const x = KEYS[i] / KEYS[KEYS.length - 1]
      const keyMesh = this.keys[i]
      keyMesh.position.y = KEY_Y + this.face.happy * (0.075 * x * x - 0.025)
      const pressed = (i === 2 ? this.face.curious : 0) + (i === this.pressKey ? press : 0)
      keyMesh.position.z = FRONT + 0.01 - 0.026 * Math.min(pressed, 1)
    }
    this.knob.position.y = THREE.MathUtils.lerp(-0.54, -0.3, this.mood)
    this.signal.color.copy(SIGNAL).multiplyScalar(0.35 + 1.6 * this.status * (0.85 + 0.15 * Math.sin(t * 5)))

    // The strap lags behind a nod and swings back.
    const pitchVel = (pose.pitch - this.lastPitch) / Math.max(dt, 1e-3)
    const pitchAcc = (pitchVel - this.lastPitchVel) / Math.max(dt, 1e-3)
    this.lastPitch = pose.pitch
    this.lastPitchVel = pitchVel
    const steps = Math.max(1, Math.ceil(dt / (1 / 120)))
    for (let i = 0; i < steps; i++) {
      const h = dt / steps
      this.swingVel += (-36 * this.swing - 2.4 * this.swingVel + THREE.MathUtils.clamp(pitchAcc, -30, 30) * 0.8) * h
      this.swing = THREE.MathUtils.clamp(this.swing + this.swingVel * h, -0.5, 0.5)
    }
    this.strap.rotation.x = this.swing

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
      style: 'rams',
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
    this.grille.dispose()
    this.renderer.dispose()
  }
}
