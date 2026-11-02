import * as THREE from 'three'
import type { PatternKey } from './state'
import type { Rect } from './geometry'
import { wallRect } from './geometry'

/**
 * Line patterns over the whole wall. Every line is a strip of thin quads; where it runs is a
 * formula of the line, the height, the time (the server's, the same on every screen) and the
 * person in front of the wall. Each screen draws the same pattern through its own window `view`.
 * WebGL 1 safe: GLSL ES 1.0, no textures.
 */

export const PATTERNS: { key: PatternKey; name: string; description: string }[] = [
  { key: 'faeden', name: 'Fäden', description: 'Senkrechte Linien, oben gerade, unten in weichen Wellen; wo jemand steht, lösen sie sich höher' },
  { key: 'falte', name: 'Falte', description: 'Ein Feld aus Linien mit einer Falte, die der Person vor der Wand folgt' },
  { key: 'silhouette', name: 'Silhouette', description: 'Die Menschen vor der Wand, live als Linien quer über ihre Körper auf Weiß, wie ein Spiegel' },
  { key: 'gewirr', name: 'Gewirr', description: 'Die Menschen schwarz auf Weiß, aus ihnen laufen feine Bleistiftlinien in alle Richtungen und verblassen' },
  { key: 'kritzel', name: 'Kritzel', description: 'Eine Bleistiftlinie kritzelt die Menschen vor der Wand, je länger sie stehen, desto dichter; wer bleibt, sieht das Gekritzel zittern, auseinanderfliegen und zu HfG werden' },
  { key: 'figur', name: 'Figur', description: 'Eine gezeichnete 3D-Figur für jede Person vor der Wand, die steht und sich bewegt wie sie' },
  { key: 'schraffur', name: 'Schraffur', description: 'Die Menschen vor der Wand auf Schwarz, in feinen weißen Strichen schraffiert, mit etwas Boden unter den Füßen' },
]

const LINES: Record<Exclude<PatternKey, 'silhouette' | 'schraffur' | 'gewirr' | 'kritzel' | 'figur'>, number> = { faeden: 64, falte: 96 }
const SEGMENTS = 220
/** Line width in metres: about 2.6 mm, a few pixels on an iMac. */
const WIDTH = 0.0026
const PAPER = 0xefece6
const INK = new THREE.Color(0x2a2a2a)
/** The time loops, so that it stays exact as a float; once an hour the pattern jumps a little. */
const LOOP_S = 3600

const VERTEX = /* glsl */ `
uniform float uTime, uWidth, uPattern, uPresent;
uniform vec2 uPerson;
uniform vec4 uWall;
attribute float aLine, aT, aSide;

float hash(float n) { return fract(sin(n * 12.9898) * 43758.5453); }

// Where line l (0..1 across the wall) runs at height t (0 top .. 1 bottom).
vec2 path(float l, float t) {
  float margin = (uWall.z - uWall.x) * 0.04;
  float x = mix(uWall.x + margin, uWall.z - margin, l);
  float y = mix(uWall.w, uWall.y, t);
  float seed = hash(l * 97.0 + 1.3) * 40.0;
  float near = uPresent * exp(-pow((x - uPerson.x) / 0.45, 2.0));
  if (uPattern < 0.5) {
    // Faeden: straight from the top, letting go slowly lower down into long, soft waves.
    float knot = mix(0.45, 0.0, hash(l * 31.0 + 7.0)) * (uWall.w - uWall.y) * 0.5 + near * 0.4;
    float loose = smoothstep(knot, knot - 0.95, y);
    loose *= loose;
    float amp = loose * (0.03 + 0.07 * hash(l * 13.0 + 2.0)) * (1.0 + 0.8 * near);
    x += amp * (sin(y * 2.3 + seed + uTime * 0.12)
      + 0.45 * sin(y * 4.6 + seed * 1.7 - uTime * 0.17));
  } else {
    // Falte: a field of lines, folded along a slanting crease round the person (or a wandering point).
    vec2 at = mix(vec2(sin(uTime * 0.07) * 0.55, cos(uTime * 0.05) * 0.35), uPerson, uPresent);
    vec2 d = vec2(x, y) - at;
    vec2 r = vec2(d.x * 0.87 - d.y * 0.5, d.x * 0.5 + d.y * 0.87);
    float fold = r.y / (0.18 + abs(r.y)) * exp(-r.x * r.x / 0.55 - r.y * r.y / 1.4);
    x += 0.2 * fold;
    x += 0.012 * sin(y * 8.0 + l * 9.0 + uTime * 0.5) + 0.03 * sin(y * 2.2 + uTime * 0.11 + l * 2.0);
  }
  return vec2(x, y);
}

void main() {
  vec2 p = path(aLine, aT);
  vec2 q = path(aLine, aT + 0.002);
  vec2 dir = normalize(q - p + vec2(0.0, -1e-5));
  vec2 side = vec2(-dir.y, dir.x);
  gl_Position = projectionMatrix * viewMatrix * vec4(p + side * aSide * uWidth * 0.5, 0.0, 1.0);
}
`

const FRAGMENT = /* glsl */ `
uniform vec3 uInk;
void main() { gl_FragColor = vec4(uInk, 1.0); }
`

function linesGeometry(count: number) {
  const vertices = count * (SEGMENTS + 1) * 2
  const line = new Float32Array(vertices), t = new Float32Array(vertices), side = new Float32Array(vertices)
  const index: number[] = []
  let v = 0
  for (let i = 0; i < count; i++) {
    for (let j = 0; j <= SEGMENTS; j++) {
      for (const s of [-1, 1]) {
        line[v] = count > 1 ? i / (count - 1) : 0.5
        t[v] = j / SEGMENTS
        side[v] = s
        v++
      }
      if (j < SEGMENTS) {
        const a = v - 2
        index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
      }
    }
  }
  const geometry = new THREE.BufferGeometry()
  // Positions come from the shader; three.js still wants one.
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(vertices * 3), 3))
  geometry.setAttribute('aLine', new THREE.BufferAttribute(line, 1))
  geometry.setAttribute('aT', new THREE.BufferAttribute(t, 1))
  geometry.setAttribute('aSide', new THREE.BufferAttribute(side, 1))
  geometry.setIndex(vertices > 65535 ? new THREE.Uint32BufferAttribute(index, 1) : new THREE.Uint16BufferAttribute(index, 1))
  return geometry
}

export interface PatternView {
  /** The person in front of the wall, in wall metres, or null. */
  setPerson(person: { x: number; y: number } | null): void
  debug(): { webgl: number; renderedFps: number } & Record<string, unknown>
  dispose(): void
}

/**
 * Draw `key` into `canvas`, showing the part `view` of the wall. `now` gives seconds on the
 * shared clock; `fps` caps the frame rate.
 */
export function createPattern(canvas: HTMLCanvasElement, key: Exclude<PatternKey, 'silhouette' | 'schraffur' | 'gewirr' | 'kritzel' | 'figur'>, view: Rect, options: { now: () => number; fps?: number; webgl1?: boolean; maxPixelRatio?: number }): PatternView {
  const attributes: WebGLContextAttributes = { antialias: true, alpha: false, powerPreference: 'high-performance' }
  const context = options.webgl1 ? canvas.getContext('webgl', attributes) ?? undefined : undefined
  const renderer = new THREE.WebGLRenderer({ canvas, context, ...attributes })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, options.maxPixelRatio ?? 1.5))
  renderer.setClearColor(PAPER, 1)
  const scene = new THREE.Scene()
  const camera = new THREE.OrthographicCamera(view.x0, view.x1, view.y1, view.y0, -1, 1)
  const wall = wallRect()
  // Lines may not reach 32 bits of indices on old GPUs: 96 x 221 x 2 stays under 65536.
  const geometry = linesGeometry(LINES[key])
  const person = new THREE.Vector2()
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uWidth: { value: WIDTH },
      uPattern: { value: key === 'faeden' ? 0 : 1 },
      uPresent: { value: 0 },
      uPerson: { value: person },
      uWall: { value: new THREE.Vector4(wall.x0, wall.y0, wall.x1, wall.y1) },
      uInk: { value: INK },
    },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    side: THREE.DoubleSide,
  })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.frustumCulled = false
  scene.add(mesh)

  let target: { x: number; y: number } | null = null
  let present = 0
  let raf = 0, last = 0, frames = 0, since = performance.now(), renderedFps = 0, disposed = false
  const fps = options.fps ?? 30

  const resize = () => {
    renderer.setSize(canvas.clientWidth || 1, canvas.clientHeight || 1, false)
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
    // Someone there: the pattern turns to them, and lets go slowly when they leave.
    present += ((target ? 1 : 0) - present) * Math.min(1, dt * (target ? 1.6 : 0.5))
    if (target) person.lerp(new THREE.Vector2(target.x, target.y), Math.min(1, dt * 2.5))
    const u = material.uniforms
    u.uPresent.value = present
    u.uTime.value = (options.now() / 1000) % LOOP_S
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
    setPerson(p) {
      if (p && !target) person.set(p.x, p.y)
      target = p
    },
    debug: () => ({ webgl: renderer.capabilities.isWebGL2 ? 2 : 1, renderedFps, headLoaded: true, pattern: key }),
    dispose() {
      disposed = true
      cancelAnimationFrame(raf)
      observer.disconnect()
      geometry.dispose()
      material.dispose()
      renderer.dispose()
    },
  }
}
