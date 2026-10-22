import * as THREE from 'three'
import { GazeSpring } from '../GazeSpring'
import type { Expression, HeadView, HeadViewOptions } from '../types'
import { PORTRAIT } from './portrait'

/**
 * A 1-bit pixel portrait turned into a voxel relief: every pixel is a column
 * whose depth follows the curve of a head. The pixels breathe in waves, pop
 * out now and then, flicker by inverting, and glitch in torn rows. The face
 * blinks, raises its brows and smiles - in pixels.
 * WebGL 1 safe: instanced boxes and plain GLSL ES 1.0.
 */

const PIXEL = 0.04
/** The bitmap row and column at the centre of the head: it turns around this point. */
const CENTER_ROW = 36
const CENTER_COL = 32
/** Where the nose stands out (bitmap row and column). */
const NOSE = { row: 47, col: 35 }
/** Width of the drawn grid line on each pixel's face, like squared paper (share of a pixel). */
const GRID = 0.1
/** Rows from here down are the turtleneck: it stays put while the head turns. */
const COLLAR_ROW = 72
/** The turtleneck continues below the bitmap, so it always leaves the frame. */
const EXTRA_ROWS = 14
const FOV = 32
const CAM_DIST = 7.4
const CAM_Y = -0.1
/** A glitch tears the portrait apart every few seconds (seconds). */
const GLITCH_EVERY = [5, 12]
const GLITCH_LENGTH = 0.45
/** Columns end here at the back: a relief, so the side shows the face's profile. */
const BACK = -0.22
/** Turns a little less than the other heads, so the pixel face always stays readable. */
const TURN = 0.7

const KINDS: Record<string, number> = { '#': 0, '-': 1, e: 2, b: 3, B: 4, s: 5, g: 6 }
const FACES: Record<Expression, { happy: number; curious: number }> = {
  neutral: { happy: 0, curious: 0 },
  curious: { happy: 0, curious: 1 },
  happy: { happy: 1, curious: 0 },
}

const between = ([lo, hi]: number[]) => lo + Math.random() * (hi - lo)

const VERTEX = /* glsl */ `
uniform float uTime, uGlitch, uBlink, uHappy, uCurious;
attribute vec3 aCenter;
attribute vec2 aCell;
attribute float aDepth, aKind;
varying float vShade;
varying vec3 vNormal;
varying vec2 vFace;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void main() {
  // Which pixels are dark depends on the expression.
  float light = 0.0;
  if (aKind > 0.5 && aKind < 1.5) light = 1.0;                 // skin
  else if (aKind < 2.5 && aKind > 1.5) light = step(0.5, uBlink); // eye
  else if (aKind < 3.5 && aKind > 2.5) light = step(0.5, uCurious); // low brow
  else if (aKind < 4.5 && aKind > 3.5) light = 1.0 - step(0.5, uCurious); // high brow
  else if (aKind < 5.5 && aKind > 4.5) light = 1.0 - step(0.5, uHappy); // smile corner
  else if (aKind > 5.5) light = 0.45;                            // grey: stubble, cropped hair

  // Flicker: a few pixels invert for a moment, many more during a glitch.
  float flick = step(0.997 - uGlitch * 0.08, hash(aCell + floor(uTime * 10.0)));
  vShade = abs(light - flick);

  vec3 c = aCenter;
  // Breathing waves across the face.
  c.z += sin(uTime * 1.6 + aCell.y * 0.2 + aCell.x * 0.09) * 0.02;
  // Now and then a single pixel pops out and back.
  float cycle = uTime * 0.7 + hash(aCell * 1.3);
  float pops = step(0.994, hash(aCell * 3.1 + floor(cycle)));
  c.z += pops * sin(fract(cycle) * 3.14159) * 0.35;
  // A glitch tears rows sideways and scatters pixels in depth.
  float tick = floor(uTime * 18.0);
  float torn = step(0.55, hash(vec2(aCell.y, tick)));
  c.x += (hash(vec2(aCell.y * 1.7, tick + 3.0)) - 0.5) * torn * uGlitch * 0.9;
  c.z += (hash(aCell + tick) - 0.5) * uGlitch * 0.6;

  // Pixels touch: a gap would let you look straight through the head along the
  // view axis. The grid is painted on instead (vFace), the turtleneck has none.
  vec3 p = c + position * vec3(${(PIXEL * 1.002).toFixed(4)}, ${(PIXEL * 1.002).toFixed(4)}, aDepth);
  vFace = aCell.y < ${COLLAR_ROW.toFixed(1)} ? position.xy : vec2(0.0);
  vNormal = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`

const FRAGMENT = /* glsl */ `
varying float vShade;
varying vec3 vNormal;
varying vec2 vFace;
void main() {
  vec3 n = normalize(vNormal);
  // One soft key light from the upper left; the sides of each column fall off.
  float key = max(dot(n, normalize(vec3(-0.45, 0.5, 0.75))), 0.0);
  float light = 0.42 + 0.58 * key;
  vec3 color = mix(vec3(0.07), vec3(0.95, 0.95, 0.93), vShade);
  // A thin grid line along the edges of each pixel's front, like squared paper.
  float edge = max(abs(vFace.x), abs(vFace.y));
  color *= 1.0 - 0.3 * step(${(0.5 - GRID).toFixed(3)}, edge) * step(0.5, n.z);
  gl_FragColor = vec4(color * light, 1.0);
}
`

const BACKDROP_FRAGMENT = /* glsl */ `
varying vec2 vUv;
void main() {
  vec2 p = vUv - 0.5;
  float vignette = 1.0 - dot(p, p) * 0.9;
  gl_FragColor = vec4(vec3(0.93, 0.93, 0.91) * vignette, 1.0);
}
`

const PASS_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

/** Instanced columns for the bitmap rows in [from, to). */
function columns(material: THREE.ShaderMaterial, from: number, to: number) {
  const rows = [...PORTRAIT]
  for (let i = 0; i < EXTRA_ROWS; i++) rows.push(rows[rows.length - 1])
  const width = rows[0].length
  const center: number[] = [], cell: number[] = [], depth: number[] = [], kind: number[] = []
  for (let row = from; row < Math.min(to, rows.length); row++) {
    for (let col = 0; col < width; col++) {
      const char = rows[row][col]
      if (!(char in KINDS)) continue
      const x = (col - CENTER_COL) * PIXEL
      const y = (CENTER_ROW - row) * PIXEL
      let z: number
      if (row < COLLAR_ROW) {
        // A long, narrow head-shaped ellipsoid, with the nose standing out (sizes in pixels).
        const e = 1 - (x / (28 * PIXEL)) ** 2 - (y / (38 * PIXEL)) ** 2
        const nx = (col - NOSE.col) / 3, ny = (row - NOSE.row) / 7
        z = 22 * PIXEL * Math.sqrt(Math.max(e, 0.02)) + 5 * PIXEL * Math.exp(-nx * nx - ny * ny)
      } else {
        // The turtleneck: a broad, flatter cylinder.
        z = 0.55 * Math.sqrt(Math.max(1 - (x / 1.6) ** 2, 0.05))
      }
      const front = Math.max(z, 0.08)
      center.push(x, y, (front + BACK) / 2)
      cell.push(col, row)
      depth.push(front - BACK)
      kind.push(KINDS[char])
    }
  }
  const box = new THREE.BoxGeometry(1, 1, 1)
  const geometry = new THREE.InstancedBufferGeometry()
  geometry.setIndex(box.index)
  for (const [name, attribute] of Object.entries(box.attributes)) geometry.setAttribute(name, attribute)
  box.dispose()
  geometry.setAttribute('aCenter', new THREE.InstancedBufferAttribute(new Float32Array(center), 3))
  geometry.setAttribute('aCell', new THREE.InstancedBufferAttribute(new Float32Array(cell), 2))
  geometry.setAttribute('aDepth', new THREE.InstancedBufferAttribute(new Float32Array(depth), 1))
  geometry.setAttribute('aKind', new THREE.InstancedBufferAttribute(new Float32Array(kind), 1))
  geometry.instanceCount = kind.length
  const mesh = new THREE.Mesh(geometry, material)
  mesh.frustumCulled = false
  return mesh
}

export class PixelHead implements HeadView {
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 60)
  private material: THREE.ShaderMaterial
  private turn = new THREE.Group()
  private gaze: GazeSpring
  private face = { happy: 0, curious: 0 }
  private faceTarget = { happy: 0, curious: 0 }
  private nextBlink = 1.5
  private blinkUntil = -1
  private nextGlitch = between(GLITCH_EVERY)
  private glitchUntil = -1
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
    this.renderer.setClearColor(0xecebe7, 1)

    this.camera.position.set(0, CAM_Y, CAM_DIST)
    this.camera.lookAt(0, CAM_Y, 0)

    const wall = new THREE.Mesh(
      new THREE.PlaneGeometry(40, 24),
      new THREE.ShaderMaterial({ vertexShader: PASS_VERTEX, fragmentShader: BACKDROP_FRAGMENT, depthWrite: false }),
    )
    wall.position.z = -6
    this.scene.add(wall)

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 }, uGlitch: { value: 0 }, uBlink: { value: 0 },
        uHappy: { value: 0 }, uCurious: { value: 0 },
      },
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
    })
    // The head turns around the chin; the turtleneck stays.
    const pivotY = (CENTER_ROW - COLLAR_ROW) * PIXEL
    const head = columns(this.material, 0, COLLAR_ROW)
    head.position.y = -pivotY
    this.turn.position.y = pivotY
    this.turn.add(head)
    this.scene.add(this.turn, columns(this.material, COLLAR_ROW, Infinity))

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
    // Keep the whole head (2.8 wide with ears) in frame on narrow screens.
    const halfFov = THREE.MathUtils.degToRad(FOV / 2)
    this.camera.position.z = Math.max(CAM_DIST, 3.6 / (2 * Math.tan(halfFov) * this.camera.aspect))
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

    const k = 1 - Math.exp(-5 * dt)
    this.face.happy += (this.faceTarget.happy - this.face.happy) * k
    this.face.curious += (this.faceTarget.curious - this.face.curious) * k
    if (t > this.nextBlink) {
      this.blinkUntil = t + 0.15
      this.nextBlink = t + 2.2 + Math.random() * 4
    }
    if (t > this.nextGlitch) {
      this.glitchUntil = t + GLITCH_LENGTH
      this.nextGlitch = t + GLITCH_LENGTH + between(GLITCH_EVERY)
    }

    const pose = this.gaze.update(dt, t)
    this.turn.rotation.set(-pose.pitch, pose.yaw, 0, 'YXZ')

    const u = this.material.uniforms
    u.uTime.value = t
    u.uBlink.value = t < this.blinkUntil ? 1 : 0
    u.uGlitch.value = t < this.glitchUntil ? 1 : 0
    u.uHappy.value = this.face.happy
    u.uCurious.value = this.face.curious

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
      style: 'pixel',
      webgl: this.renderer.capabilities.isWebGL2 ? 2 : 1,
      headLoaded: true,
      renderedFps: this.renderedFps,
      yaw: Number(this.gaze.yaw.toFixed(3)),
      pitch: Number(this.gaze.pitch.toFixed(3)),
      goal: { ...this.gaze.goal },
      expression: { ...this.face },
      glitch: this.clock.elapsedTime < this.glitchUntil,
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
      ;(object.material as THREE.Material).dispose()
    })
    this.renderer.dispose()
  }
}
