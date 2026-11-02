import * as THREE from 'three'
import { height, wallRect, width, type Rect } from './geometry'
import type { PatternView } from './pattern'

/**
 * Figur: a mannequin for every person in front of the wall, standing where they stand and as they
 * stand, drawn in fine white strokes on black that wrap round each limb (the strokes come with the
 * mesh, scripts/build_figur.mjs). The pose model gives 17 keypoints per person; each bone is turned
 * towards its keypoint, and where a limb looks shorter than it is, it points towards the wall or away
 * from it: the figure stands in 3D. Shoulders that look narrow turn the body. A few strokes of floor
 * under the feet. Without keypoints a figure stands at rest.
 * WebGL 1 safe: 11 bones as uniforms, two per point, GLSL ES 1.0.
 */

const MODEL = `${import.meta.env.BASE_URL}models/Figur`
/** Figures at once, at most. */
const MAX_FIGURES = 3
/** Gone this long, a figure has faded out. */
const FADE_MS = 1200
/** How fast a figure follows the newest keypoints (per second). */
const FOLLOW = 9

/** The COCO keypoints. */
const K = { nose: 0, leftEar: 3, rightEar: 4, leftShoulder: 5, rightShoulder: 6, leftElbow: 7, rightElbow: 8, leftWrist: 9, rightWrist: 10, leftHip: 11, rightHip: 12, leftKnee: 13, rightKnee: 14, leftAnkle: 15, rightAnkle: 16 }

interface Bone { name: string; parent: number; start: [number, number, number]; end: [number, number, number] }
interface FigureModel { vertices: number; indices: number; height: number; bones: Bone[] }

/** A person's skeleton: their number, and per keypoint x, y in the upright camera picture (0..1) and how sure (0: not seen). */
export interface PoseInput { id: number; points: number[] }

const VERTEX = /* glsl */ `
uniform mat4 uBones[11];
attribute vec2 aStroke;
attribute vec4 aSkin;
varying vec2 vStroke;
varying vec3 vNormal;
void main() {
  mat4 a = uBones[int(aSkin.x + 0.5)];
  mat4 b = uBones[int(aSkin.y + 0.5)];
  float w = aSkin.z / 255.0;
  vec4 p = mix(a * vec4(position, 1.0), b * vec4(position, 1.0), w);
  vec3 n = mix(a[0].xyz * normal.x + a[1].xyz * normal.y + a[2].xyz * normal.z,
               b[0].xyz * normal.x + b[1].xyz * normal.y + b[2].xyz * normal.z, w);
  vNormal = n;
  vStroke = aStroke;
  gl_Position = projectionMatrix * viewMatrix * p;
}
`

/**
 * Cross-contour hatching: rows of fine strokes round the body, long, tapering at both ends, now and
 * then two in a row. Dense and bright where the light falls, thinning out into the shadow; redrawn a
 * few times a second, as by hand. The body itself is black and hides what is behind it.
 */
const FRAGMENT = /* glsl */ `
uniform float uScale, uPixel, uTime, uFade;
varying vec2 vStroke;
varying vec3 vNormal;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

float strokeAt(float row, float along, float light, float frame, float layer) {
  float r = floor(row);
  float f = fract(row) - 0.5;
  float a = along + hash(vec2(r, frame + layer * 17.0)) * 5.0;
  float seg = floor(a);
  float t = fract(a);
  // Each stroke its own length, and a little wave and lean along it.
  float len = mix(0.55, 0.97, hash(vec2(r * 1.3 + layer, seg + frame)));
  float k = clamp(t / len, 0.0, 1.0);
  float inside = step(t, len);
  f += (hash(vec2(seg, r + layer)) - 0.5) * 0.5 + (k - 0.5) * (hash(vec2(r, seg * 1.7)) - 0.5) * 0.6;
  // In the shadow fewer rows carry strokes.
  float shown = step(hash(vec2(r * 3.1 + layer, seg)), light * 1.25 + 0.05);
  float taper = sin(k * 3.14159);
  float width = 0.0013 * (0.35 + 0.65 * taper) * (0.6 + 0.6 * light);
  float across = abs(f) * 0.0085 * uScale;
  return (1.0 - smoothstep(width * 0.5, width * 0.5 + uPixel, across)) * inside * shown;
}

void main() {
  vec3 n = normalize(vNormal);
  float light = clamp(dot(n, normalize(vec3(-0.5, 0.6, 0.62))) * 0.9 + 0.22, 0.0, 1.0);
  float frame = floor(uTime * 5.0);
  float row = vStroke.x / 0.0085;
  float along = vStroke.y * 3.2;
  float ink = max(strokeAt(row, along, light, frame, 0.0), strokeAt(row + 0.5, along * 0.9 + 0.37, light * 0.85, frame, 1.0) * 0.8);
  float bright = 0.4 + 0.6 * light;
  gl_FragColor = vec4(vec3(bright * ink * uFade), 1.0);
}
`

/** A few flat strokes of floor, densest under the feet. */
const FLOOR_VERTEX = /* glsl */ `
varying vec2 vLocal;
void main() {
  vLocal = position.xy;
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
}
`
const FLOOR_FRAGMENT = /* glsl */ `
uniform float uScale, uPixel, uTime, uFade;
varying vec2 vLocal;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main() {
  float frame = floor(uTime * 7.0);
  float spacing = 0.006 * uScale;
  float row = floor(vLocal.y / spacing);
  float across = abs(fract(vLocal.y / spacing) - 0.5) * spacing;
  float along = vLocal.x / (0.08 * uScale) + hash(vec2(row, frame)) * 5.0;
  float on = step(fract(along), mix(0.35, 0.95, hash(vec2(row, floor(along) + frame))));
  float spread = abs(vLocal.x) / (0.45 * uScale);
  float fade = (1.0 - smoothstep(0.25, 1.0 + 0.3 * hash(vec2(row, frame)), spread)) * (1.0 - smoothstep(0.0, 0.05 * uScale, abs(vLocal.y)));
  float ink = (1.0 - smoothstep(0.0006, 0.0006 + uPixel, across)) * on * fade;
  if (ink <= 0.02) discard;
  gl_FragColor = vec4(vec3(0.85 * ink * uFade), 1.0);
}
`

const v3 = (p: number[]) => new THREE.Vector3(p[0], p[1], p[2])

/** One figure: its bones, where it was asked to stand, and how present it still is. */
class Figure {
  readonly bones = Array.from({ length: 11 }, () => new THREE.Matrix4())
  readonly mesh: THREE.Mesh
  readonly floor: THREE.Mesh
  readonly material: THREE.ShaderMaterial
  readonly floorMaterial: THREE.ShaderMaterial
  points: number[] | null = null
  target: number[] | null = null
  seen = 0
  fade = 0
  scale = 1

  constructor(geometry: THREE.BufferGeometry, uPixel: { value: number }, uTime: { value: number }) {
    const uScale = { value: 1 }
    const uFade = { value: 0 }
    this.material = new THREE.ShaderMaterial({
      uniforms: { uBones: { value: this.bones }, uScale, uPixel, uTime, uFade },
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
    })
    this.mesh = new THREE.Mesh(geometry, this.material)
    this.mesh.frustumCulled = false
    this.floorMaterial = new THREE.ShaderMaterial({
      uniforms: { uScale, uPixel, uTime, uFade },
      vertexShader: FLOOR_VERTEX,
      fragmentShader: FLOOR_FRAGMENT,
      transparent: true,
      depthWrite: false,
    })
    this.floor = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.floorMaterial)
    this.floor.frustumCulled = false
  }
}

/** The figures, drawn into `canvas`, showing the part `view` of the wall. */
export function createFigures(canvas: HTMLCanvasElement, view: Rect, options: { now: () => number; fps?: number; maxPixelRatio?: number }): PatternView & { setPoses(poses: PoseInput[]): void } {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, options.maxPixelRatio ?? 1.5))
  renderer.setClearColor(0x000000, 1)
  const scene = new THREE.Scene()
  const camera = new THREE.OrthographicCamera(view.x0, view.x1, view.y1, view.y0, -10, 10)
  const wall = wallRect()
  const frameH = height(wall), frameW = frameH * 16 / 9
  const cx = (wall.x0 + wall.x1) / 2, cy = (wall.y0 + wall.y1) / 2
  /** From the camera picture (0..1, v down) to the wall, mirrored. */
  const toWall = (u: number, v: number) => new THREE.Vector2(cx + (0.5 - u) * frameW, cy + (0.5 - v) * frameH)

  const uPixel = { value: 0.001 }
  const uTime = { value: 0 }
  let model: FigureModel | null = null
  let figures: Figure[] = []
  const byId = new Map<number, Figure>()
  let loaded = false
  let disposed = false
  let geometry: THREE.BufferGeometry | null = null

  void Promise.all([
    fetch(`${MODEL}.json`).then((r) => r.json() as Promise<FigureModel>),
    fetch(`${MODEL}.bin`).then((r) => r.arrayBuffer()),
  ]).then(([m, buffer]) => {
    if (disposed) return
    model = m
    const n = m.vertices
    let at = 0
    const take = <T>(make: (offset: number) => T, bytes: number) => { const part = make(at); at += bytes; return part }
    const position = take((o) => new Float32Array(buffer, o, n * 3), n * 12)
    const stroke = take((o) => new Float32Array(buffer, o, n * 2), n * 8)
    const normal = take((o) => new Int8Array(buffer, o, n * 4), n * 4)
    const skin = take((o) => new Uint8Array(buffer, o, n * 4), n * 4)
    const index = new Uint16Array(buffer.slice(at, at + m.indices * 2))
    geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(position, 3))
    geometry.setAttribute('aStroke', new THREE.BufferAttribute(stroke, 2))
    geometry.setAttribute('normal', new THREE.BufferAttribute(normal, 4, true))
    geometry.setAttribute('aSkin', new THREE.BufferAttribute(skin, 4, false))
    geometry.setIndex(new THREE.BufferAttribute(index, 1))
    figures = Array.from({ length: MAX_FIGURES }, () => new Figure(geometry!, uPixel, uTime))
    for (const f of figures) scene.add(f.mesh, f.floor)
    loaded = true
  })

  // --- posing ------------------------------------------------------------------------------------
  const tmpQ = new THREE.Quaternion()
  const yawQ = new THREE.Quaternion()
  const up = new THREE.Vector3(0, 1, 0)
  const rest = (b: Bone) => ({ start: v3(b.start), end: v3(b.end), dir: v3(b.end).sub(v3(b.start)).normalize(), length: v3(b.end).distanceTo(v3(b.start)) })

  /** Bone matrix: rest `start` goes to `to`, the bone turned by `rotation`, scaled by `scale`. */
  const boneMatrix = (out: THREE.Matrix4, restStart: THREE.Vector3, to: THREE.Vector3, rotation: THREE.Quaternion, scale: number) =>
    out.compose(to, rotation, new THREE.Vector3(scale, scale, scale)).multiply(new THREE.Matrix4().makeTranslation(-restStart.x, -restStart.y, -restStart.z))

  /** The 2D keypoint on the wall, or null where the model was not sure. */
  const kp = (points: number[], k: number) => (points[k * 3 + 2] > 0 ? toWall(points[k * 3], points[k * 3 + 1]) : null)
  const mid = (a: THREE.Vector2 | null, b: THREE.Vector2 | null) => (a && b ? a.clone().add(b).multiplyScalar(0.5) : a ?? b)

  /**
   * Towards a keypoint: the 2D direction on the wall, lengthened into depth where it is shorter than
   * the bone (`towards` > 0: towards the street). Null without the keypoint.
   */
  const reach = (from: THREE.Vector3, to: THREE.Vector2 | null, length: number, towards: number) => {
    if (!to) return null
    const d = new THREE.Vector3(to.x - from.x, to.y - from.y, 0)
    const flat = d.length()
    if (flat >= length) return d.multiplyScalar(1 / Math.max(flat, 1e-6))
    d.z = Math.sqrt(length * length - flat * flat) * towards
    return d.normalize()
  }

  function pose(f: Figure) {
    if (!model || !f.points) return
    const B = model.bones.map(rest)
    const P = f.points
    const lHip = kp(P, K.leftHip), rHip = kp(P, K.rightHip), lSh = kp(P, K.leftShoulder), rSh = kp(P, K.rightShoulder)
    const hips = mid(lHip, rHip), shoulders = mid(lSh, rSh)
    const restHips = B[7].start.clone().add(B[9].start).multiplyScalar(0.5)
    const restShoulders = B[3].start.clone().add(B[5].start).multiplyScalar(0.5)
    // Size: the trunk as long as theirs; without hips, the shoulders as wide.
    let scale = f.scale
    if (hips && shoulders) scale = hips.distanceTo(shoulders) / restShoulders.distanceTo(restHips)
    else if (lSh && rSh) scale = lSh.distanceTo(rSh) / B[3].start.distanceTo(B[5].start)
    f.scale += (scale - f.scale) * 0.25
    const s = f.scale
    const root = hips ?? (shoulders ? new THREE.Vector2(shoulders.x, shoulders.y - restShoulders.distanceTo(restHips) * s) : null)
    if (!root) return

    // Turned: narrow shoulders mean turned away from the wall; the nose says which way.
    const nose = kp(P, K.nose)
    const width = lSh && rSh ? lSh.distanceTo(rSh) / (B[3].start.distanceTo(B[5].start) * s) : 1
    const turn = Math.acos(Math.min(1, width)) * (nose && shoulders ? Math.sign(nose.x - shoulders.x) || 1 : 0)
    yawQ.setFromAxisAngle(up, turn)
    const tilt = (a: THREE.Vector2 | null, b: THREE.Vector2 | null) => (a && b ? Math.atan2(b.y - a.y, b.x - a.x) : 0)

    // Pelvis: at the hips, along the hip line, turned with the body.
    const pelvisQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), tilt(lHip, rHip)).multiply(yawQ)
    const rootPos = new THREE.Vector3(root.x, root.y, 0).sub(restHips.clone().sub(B[0].start).applyQuaternion(pelvisQ).multiplyScalar(s))
    boneMatrix(f.bones[0], B[0].start, rootPos, pelvisQ, s)
    // Spine: from the hips to between the shoulders, leaning into depth if it looks short.
    const spineStart = B[1].start.clone().applyMatrix4(f.bones[0])
    const spineDir = reach(spineStart, shoulders, B[1].length * s, 0.3) ?? up.clone()
    const spineQ = new THREE.Quaternion().setFromUnitVectors(up, spineDir).multiply(yawQ)
    boneMatrix(f.bones[1], B[1].start, spineStart, spineQ, s)
    // Head: tipped towards the nose.
    const neck = B[2].start.clone().applyMatrix4(f.bones[1])
    const headTilt = nose && shoulders ? Math.atan2(nose.x - shoulders.x, nose.y - shoulders.y) * -0.5 : 0
    const headQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), headTilt).multiply(spineQ)
    boneMatrix(f.bones[2], B[2].start, neck, headQ, s)

    // Limbs: each bone from where its parent put it, towards its keypoint; unseen ones hang as their parent does.
    const limb = (bone: number, parent: number, end: number, towards: number) => {
      const start = B[bone].start.clone().applyMatrix4(f.bones[parent])
      const dir = reach(start, kp(P, end), B[bone].length * s, towards)
      // The parent's turn first (so a turned body carries its legs and arms with it), then the bend.
      const parentQ = new THREE.Quaternion()
      f.bones[parent].decompose(new THREE.Vector3(), parentQ, new THREE.Vector3())
      const q = dir ? tmpQ.setFromUnitVectors(B[bone].dir.clone().applyQuaternion(parentQ), dir).clone().multiply(parentQ) : parentQ
      boneMatrix(f.bones[bone], B[bone].start, start, q, s)
    }
    limb(3, 1, K.leftElbow, 1)
    limb(4, 3, K.leftWrist, 1)
    limb(5, 1, K.rightElbow, 1)
    limb(6, 5, K.rightWrist, 1)
    limb(7, 0, K.leftKnee, 0.4)
    limb(8, 7, K.leftAnkle, -0.2)
    limb(9, 0, K.rightKnee, 0.4)
    limb(10, 9, K.rightAnkle, -0.2)

    // The floor under the lower foot.
    const feet = [B[8].end, B[10].end].map((p, i) => p.clone().applyMatrix4(f.bones[i === 0 ? 8 : 10]))
    const lowest = Math.min(feet[0].y, feet[1].y)
    f.floor.position.set((feet[0].x + feet[1].x) / 2, lowest - 0.02 * s, -1)
    f.floor.scale.set(1.1 * s, 0.12 * s, 1)
    f.material.uniforms.uScale.value = s
  }

  // --- the loop ----------------------------------------------------------------------------------
  let raf = 0, last = performance.now(), frames = 0, since = last, renderedFps = 0
  const fps = options.fps ?? 30
  const resize = () => {
    const w = canvas.clientWidth || 1
    renderer.setSize(w, canvas.clientHeight || 1, false)
    uPixel.value = width(view) / (w * renderer.getPixelRatio())
  }
  const observer = new ResizeObserver(resize)
  observer.observe(canvas)
  resize()

  const tick = () => {
    if (disposed) return
    raf = requestAnimationFrame(tick)
    const now = performance.now()
    if (now - last < 1000 / fps - 2) return
    const dt = Math.min(0.1, (now - last) / 1000)
    last = now
    uTime.value = (options.now() / 1000) % 3600
    for (const f of figures) {
      const there = f.target !== null && now - f.seen < FADE_MS
      f.fade += ((there ? 1 : 0) - f.fade) * Math.min(1, dt * (there ? 4 : 2))
      if (f.target) {
        if (!f.points) f.points = [...f.target]
        const k = Math.min(1, dt * FOLLOW)
        for (let i = 0; i < f.target.length; i++) {
          // A point that disappears or appears jumps; one that moves is followed.
          f.points[i] = i % 3 === 2 || f.points[i + (2 - (i % 3))] === 0 ? f.target[i] : f.points[i] + (f.target[i] - f.points[i]) * k
        }
      }
      if (!there && f.fade < 0.01) {
        f.target = null
        f.points = null
      }
      f.mesh.visible = f.floor.visible = f.points !== null && f.fade > 0.01
      f.material.uniforms.uFade.value = f.fade
      if (f.mesh.visible) pose(f)
    }
    renderer.render(scene, camera)
    frames++
    if (now - since > 1000) {
      renderedFps = frames
      frames = 0
      since = now
    }
  }
  tick()

  return {
    setPoses(poses) {
      if (!loaded) return
      const now = performance.now()
      for (const p of poses.slice(0, MAX_FIGURES)) {
        let f = byId.get(p.id)
        if (!f || f.target === null && f.fade < 0.01 && byId.get(p.id) !== f) f = undefined
        if (!f) {
          // A free figure: one nobody is using, or the faintest.
          f = figures.find((g) => ![...byId.values()].includes(g) || g.target === null) ?? figures.reduce((a, b) => (a.fade < b.fade ? a : b))
          for (const [id, g] of byId) if (g === f) byId.delete(id)
          byId.set(p.id, f)
          f.points = null
        }
        f.target = p.points
        f.seen = now
      }
    },
    setPerson() {},
    debug: () => ({ webgl: renderer.capabilities.isWebGL2 ? 2 : 1, renderedFps, headLoaded: loaded, pattern: 'figur', figures: figures.filter((f) => f.mesh.visible).length }),
    dispose() {
      disposed = true
      cancelAnimationFrame(raf)
      observer.disconnect()
      geometry?.dispose()
      for (const f of figures) {
        f.material.dispose()
        f.floorMaterial.dispose()
        f.floor.geometry.dispose()
      }
      renderer.dispose()
    },
  }
}

/**
 * A made-up person for the preview: standing with their face at (u, v) of the camera picture,
 * `size` from face to feet, breathing and swinging an arm with time `t` (seconds).
 */
export function syntheticPose(u: number, v: number, size: number, t: number): number[] {
  const a = 16 / 9
  const P = (dx: number, dy: number) => [u + (dx * size) / a, v + dy * size, 0.9]
  const wave = Math.sin(t * 1.3)
  const points = [
    P(0, 0), P(-0.02, -0.02), P(0.02, -0.02), P(-0.05, 0), P(0.05, 0),
    P(-0.13, 0.13), P(0.13, 0.13),
    P(-0.17, 0.33), P(0.15 + 0.12 * wave, 0.25 - 0.12 * Math.abs(wave)),
    P(-0.19, 0.52), P(0.12 + 0.25 * wave, 0.12 - 0.05 * wave),
    P(-0.07, 0.56), P(0.07, 0.56),
    P(-0.08, 0.8), P(0.08, 0.8),
    P(-0.08, 1.03), P(0.08, 1.03),
  ]
  return points.flat()
}
