import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { GazeSpring } from '../GazeSpring'
import type { Expression, HeadView, HeadViewOptions } from '../types'
import { BACKDROP_FRAGMENT, FLARE_FRAGMENT, PASS_VERTEX, SCREEN_FRAGMENT, SCREEN_VERTEX, SPARK_FRAGMENT, SPARK_VERTEX } from './shaders'

/**
 * V.O.L.T. - a small robot with a TV head and a face on its screen, glowing
 * yellow-green. Built from a handful of rounded solids; the face is a shader,
 * so it blinks, glances and changes expression without any textures.
 * WebGL 1 safe: no derivatives, no float textures in its own shaders.
 */

const GLOW = new THREE.Color('#cfff3d')
/** The colour of a malfunction. */
const ERROR = new THREE.Color('#ff2a1f')
/** A short glitch with red X eyes now and then (seconds). */
const ERROR_EVERY = [12, 25]
const ERROR_LENGTH = 1.4
/** The ear rings flicker like a loose contact (seconds). */
const FLICKER_EVERY = [3, 8]
const FLICKER_LENGTH = 0.6

const between = ([lo, hi]: number[]) => lo + Math.random() * (hi - lo)
/** Stable pseudo-random 0..1 for a step and a channel. */
const noise = (step: number, channel: number) => {
  const x = Math.sin(step * 127.1 + channel * 311.7) * 43758.5453
  return x - Math.floor(x)
}
const FOV = 32
const CAM_DIST = 4.6
/** Camera height: the antennas stay in frame, the neck runs out at the bottom. */
const CAM_Y = 0.12
/** The screen inside the bezel, in head units. */
const SCREEN = { w: 1.26, h: 1.0 }
/** Eye centres on the screen (head units, before the glance offset). */
const EYES = [-0.25, 0.25]
const EYE_Y = 0.08

const FACES: Record<Expression, { happy: number; curious: number }> = {
  neutral: { happy: 0, curious: 0 },
  curious: { happy: 0, curious: 1 },
  happy: { happy: 1, curious: 0 },
}

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

/** A rounded-rectangle slab, centred on z = 0 (bevels included). */
function slab(w: number, h: number, r: number, depth: number, bevel: number, hole?: { w: number; h: number; r: number }) {
  const shape = roundedRect(w, h, r) as THREE.Shape
  if (hole) shape.holes.push(roundedRect(hole.w, hole.h, hole.r, new THREE.Path()))
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth, curveSegments: 20, bevelEnabled: true,
    bevelThickness: bevel, bevelSize: bevel * 0.9, bevelSegments: 6,
  })
  geometry.translate(0, 0, -depth / 2)
  return geometry
}

export class RoboHead implements HeadView {
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 60)
  private composer: EffectComposer
  private bloom: UnrealBloomPass
  private head = new THREE.Group()
  private turn = new THREE.Group()
  private screen: THREE.ShaderMaterial
  private backdrop: THREE.ShaderMaterial
  private sparks: THREE.ShaderMaterial
  private flares: THREE.Mesh[] = []
  private tips: THREE.MeshStandardMaterial
  private rings: THREE.MeshStandardMaterial[] = []
  /** Screen, flares and screen light: yellow-green, red during a glitch. */
  private faceColor = GLOW.clone()
  private glowLight: THREE.PointLight
  private gaze: GazeSpring
  private face = { happy: 0, curious: 0 }
  private faceTarget = { happy: 0, curious: 0 }
  private nextBlink = 1.5
  private blinkUntil = -1
  private nextError = between(ERROR_EVERY)
  private errorUntil = -1
  private nextFlicker = between(FLICKER_EVERY)
  private flickerUntil = -1
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
    this.renderer.setClearColor(0x030405, 1)
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.05

    this.camera.position.set(0, CAM_Y, CAM_DIST)
    this.camera.lookAt(0, CAM_Y, 0)

    // --- room ---------------------------------------------------------------
    this.backdrop = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uGlow: { value: GLOW } },
      vertexShader: PASS_VERTEX,
      fragmentShader: BACKDROP_FRAGMENT,
      depthWrite: false,
    })
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(40, 24), this.backdrop)
    wall.position.z = -6
    wall.renderOrder = -10
    this.scene.add(wall)
    this.sparks = this.makeSparks()

    this.scene.add(new THREE.HemisphereLight(0xdfe6ee, 0x0a0c0f, 0.8))
    const key = new THREE.DirectionalLight(0xffffff, 1.5)
    key.position.set(-3, 4, 5)
    const rim = new THREE.DirectionalLight(GLOW, 0.45)
    rim.position.set(3.5, 1.5, -4)
    const rimLeft = new THREE.DirectionalLight(0x9fb8ff, 0.4)
    rimLeft.position.set(-4, 0.5, -3)
    this.scene.add(key, rim, rimLeft)

    // --- head ---------------------------------------------------------------
    // Satin, not chrome: turning towards the key light must not flare up.
    const shellMaterial = new THREE.MeshStandardMaterial({ color: 0x34373c, roughness: 0.68, metalness: 0.1 })
    const bezelMaterial = new THREE.MeshStandardMaterial({ color: 0x80868e, roughness: 0.6, metalness: 0.3 })
    const darkMaterial = new THREE.MeshStandardMaterial({ color: 0x1b1d20, roughness: 0.6, metalness: 0.2 })
    this.tips = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: GLOW, emissiveIntensity: 2.2 })

    // Shell: a soft TV box. Front face sits at z = 0.56.
    const shell = new THREE.Mesh(slab(1.5, 1.25, 0.45, 0.8, 0.16), shellMaterial)
    // Bezel: a silver frame around the screen.
    const bezel = new THREE.Mesh(slab(1.48, 1.22, 0.43, 0.05, 0.035, { w: 1.2, h: 0.95, r: 0.3 }), bezelMaterial)
    bezel.position.z = 0.56 + 0.06
    // Screen: dark glass with the face, a little behind the bezel's front.
    this.screen = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 }, uGlow: { value: this.faceColor }, uLook: { value: new THREE.Vector2() },
        uError: { value: 0 }, uGlitch: { value: 0 },
        uBlink: { value: 0 }, uHappy: { value: 0 }, uCurious: { value: 0 }, uSize: { value: new THREE.Vector2(SCREEN.w, SCREEN.h) },
      },
      vertexShader: SCREEN_VERTEX,
      fragmentShader: SCREEN_FRAGMENT,
    })
    const screen = new THREE.Mesh(new THREE.ShapeGeometry(roundedRect(SCREEN.w, SCREEN.h, 0.31) as THREE.Shape, 24), this.screen)
    screen.position.z = 0.6

    // Ears: discs with a glowing ring.
    const ears: THREE.Object3D[] = []
    for (const side of [-1, 1]) {
      const ear = new THREE.Group()
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.27, 0.1, 40), bezelMaterial)
      const core = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.14, 32), darkMaterial)
      // Each ear its own material: they flicker independently.
      const ringMaterial = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: GLOW, emissiveIntensity: 1.4 })
      this.rings.push(ringMaterial)
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.215, 0.013, 8, 48), ringMaterial)
      ring.rotation.y = Math.PI / 2
      ring.position.x = side * 0.055
      disc.rotation.z = core.rotation.z = Math.PI / 2
      ear.add(disc, core, ring)
      ear.position.set(side * 0.94, 0.02, -0.02)
      ears.push(ear)
    }

    // Antennas with glowing tips.
    const antennas: THREE.Object3D[] = []
    for (const side of [-1, 1]) {
      const antenna = new THREE.Group()
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.05, 0.3, 16), darkMaterial)
      stem.position.y = 0.15
      const tip = new THREE.Mesh(new THREE.SphereGeometry(0.065, 20, 14), this.tips)
      tip.position.y = 0.33
      antenna.add(stem, tip)
      antenna.position.set(side * 0.46, 0.74, -0.05)
      antenna.rotation.z = -side * 0.28
      antennas.push(antenna)
    }

    // A long neck that always leaves the frame at the bottom: a robot, not a floating head.
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.34, 3, 32), darkMaterial)
    neck.position.y = -0.62 - 1.5

    // Lens flares in front of the eyes: anamorphic streaks plus a soft halo.
    for (let i = 0; i < EYES.length; i++) {
      const streak = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.06), this.flareMaterial(0))
      const halo = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.7), this.flareMaterial(1))
      streak.position.set(EYES[i], EYE_Y, 0.72)
      halo.position.set(EYES[i], EYE_Y, 0.71)
      this.flares.push(streak, halo)
    }

    // The screen's light falls onto the bezel.
    this.glowLight = new THREE.PointLight(this.faceColor, 0.6, 2.0, 2)
    this.glowLight.position.set(0, 0.05, 0.95)

    this.head.add(shell, bezel, screen, ...ears, ...antennas, ...this.flares, this.glowLight)
    // Turn around the neck: the head sits above the pivot.
    this.head.position.y = 0.3
    this.turn.position.y = -0.3
    this.turn.add(this.head)
    this.scene.add(this.turn, neck)

    // --- post ---------------------------------------------------------------
    this.composer = new EffectComposer(this.renderer)
    this.composer.addPass(new RenderPass(this.scene, this.camera))
    // Only what glows blooms (eyes, tips, rings), never a highlight on the shell.
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.55, 0.35, 1.0)
    this.composer.addPass(this.bloom)
    this.composer.addPass(new OutputPass())

    this.resizeObserver = new ResizeObserver(this.resize)
    this.resizeObserver.observe(canvas)
    this.resize()
    document.addEventListener('visibilitychange', this.onVisibility)
    this.tick()
  }

  private flareMaterial(kind: number) {
    return new THREE.ShaderMaterial({
      uniforms: { uGlow: { value: this.faceColor }, uKind: { value: kind }, uIntensity: { value: 0 } },
      vertexShader: PASS_VERTEX,
      fragmentShader: FLARE_FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
  }

  /** Slow yellow-green specks drifting up behind the head. */
  private makeSparks() {
    const count = 220
    const seed = new Float32Array(count * 4)
    for (let i = 0; i < seed.length; i++) seed[i] = Math.random()
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3))
    geometry.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4))
    const material = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uGlow: { value: GLOW }, uScale: { value: 1 } },
      vertexShader: SPARK_VERTEX,
      fragmentShader: SPARK_FRAGMENT,
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
    // Keep the whole head (2.1 wide with ears) in frame on narrow screens.
    const halfFov = THREE.MathUtils.degToRad(FOV / 2)
    this.camera.position.z = Math.max(CAM_DIST, 2.8 / (2 * Math.tan(halfFov) * this.camera.aspect))
    this.camera.updateProjectionMatrix()
    this.sparks.uniforms.uScale.value = this.renderer.getPixelRatio() * h / 700
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
    const k = 1 - Math.exp(-5 * dt)
    this.face.happy += (this.faceTarget.happy - this.face.happy) * k
    this.face.curious += (this.faceTarget.curious - this.face.curious) * k
    if (t > this.nextBlink) {
      this.blinkUntil = t + 0.16
      this.nextBlink = t + 2.2 + Math.random() * 4
    }
    const blink = Math.pow(Math.sin(THREE.MathUtils.clamp(1 - (this.blinkUntil - t) / 0.16, 0, 1) * Math.PI), 2)

    // Now and then a malfunction: the screen glitches, the eyes turn into red X.
    if (t > this.nextError) {
      this.errorUntil = t + ERROR_LENGTH
      this.nextError = t + ERROR_LENGTH + between(ERROR_EVERY)
    }
    const errorAge = ERROR_LENGTH - (this.errorUntil - t)
    const inError = t < this.errorUntil
    // It stutters in and out: a few hard flashes at the start and the end.
    const stutter = errorAge < 0.3 || this.errorUntil - t < 0.15
    const error = inError ? (stutter ? (noise(Math.floor(t * 24), 1) > 0.4 ? 1 : 0) : 1) : 0
    const glitch = inError ? (stutter ? 1 : 0.25) : 0
    this.faceColor.copy(GLOW).lerp(ERROR, error)

    // The ear rings flicker on their own, and always during a malfunction.
    if (t > this.nextFlicker) {
      this.flickerUntil = t + FLICKER_LENGTH
      this.nextFlicker = t + between(FLICKER_EVERY)
    }
    const flickering = inError || t < this.flickerUntil

    // The head turns; the eyes on the screen glance ahead of it.
    const pose = this.gaze.update(dt, t)
    this.turn.rotation.set(-pose.pitch, pose.yaw, 0, 'YXZ')
    const glanceX = THREE.MathUtils.clamp((this.gaze.goal.yaw - this.gaze.yaw) * 0.12 + pose.yaw * 0.06, -0.09, 0.09)
    const glanceY = THREE.MathUtils.clamp((this.gaze.goal.pitch - this.gaze.pitch) * 0.12 + pose.pitch * 0.06, -0.06, 0.06)

    const u = this.screen.uniforms
    u.uTime.value = t
    u.uBlink.value = blink
    u.uHappy.value = this.face.happy
    u.uCurious.value = this.face.curious
    u.uError.value = error
    u.uGlitch.value = glitch
    ;(u.uLook.value as THREE.Vector2).set(glanceX, glanceY)
    this.backdrop.uniforms.uTime.value = t
    this.sparks.uniforms.uTime.value = t

    // Flares follow the eyes and breathe; a blink dims them.
    const flicker = 0.85 + 0.15 * Math.sin(t * 13.0) * Math.sin(t * 7.3)
    for (let i = 0; i < this.flares.length; i++) {
      const flare = this.flares[i]
      flare.position.x = EYES[Math.floor(i / 2)] + glanceX
      flare.position.y = EYE_Y + glanceY
      ;(flare.material as THREE.ShaderMaterial).uniforms.uIntensity.value = (1 - blink) * flicker * (0.8 + 0.3 * this.face.curious)
    }
    const pulse = 0.5 + 0.5 * Math.sin(t * 2.4)
    this.tips.emissiveIntensity = 0.9 + 1.1 * pulse
    for (let side = 0; side < this.rings.length; side++) {
      this.rings[side].emissiveIntensity = flickering
        ? (noise(Math.floor(t * 30), side + 2) > 0.45 ? 1.8 : 0.03)
        : 0.7 + 0.4 * Math.sin(t * 1.3 + 1 + side)
    }
    this.glowLight.intensity = 0.6 * (1 - 0.6 * blink)

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
      style: 'robo',
      webgl: this.renderer.capabilities.isWebGL2 ? 2 : 1,
      headLoaded: true,
      renderedFps: this.renderedFps,
      yaw: Number(this.gaze.yaw.toFixed(3)),
      pitch: Number(this.gaze.pitch.toFixed(3)),
      goal: { ...this.gaze.goal },
      expression: { ...this.face },
      error: this.clock.elapsedTime < this.errorUntil,
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
    for (const pass of this.composer.passes) pass.dispose()
    this.composer.dispose()
    this.renderer.dispose()
  }
}
