import * as THREE from 'three'
import type { GrowthDelta, GrowthSnapshot } from './growth'
import { width, type Rect } from './geometry'
import type { PatternView } from './pattern'

/**
 * Geäst on a screen: the branches the growth (growth.ts) sends, ink black on pale paper, and flowers
 * opening on the twigs, in soft blossom colours. It only draws; it does not grow anything itself.
 * WebGL 1 safe: two instanced draws, GLSL ES 1.0.
 */

const PAPER = 0xf1f0ec
const CAPACITY = 7200
const FLOWER_CAPACITY = 260
/** A flower takes this long (s) to open. */
const OPEN_S = 1.6

const BRANCH_VERTEX = /* glsl */ `
uniform float uPixel;
attribute vec4 aEnds;    // x0, y0, x1, y1
attribute float aWidth;
varying float vAcross, vHalf;
void main() {
  vec2 a = aEnds.xy, b = aEnds.zw;
  vec2 d = b - a;
  float l = max(length(d), 1e-5);
  vec2 dir = d / l, side = vec2(-dir.y, dir.x);
  // Each piece reaches a little past both ends: the joints close.
  float half_ = aWidth * 0.5;
  vec2 p = a - dir * half_ + dir * (l + 2.0 * half_) * position.x + side * position.y * (aWidth + 2.0 * uPixel);
  vAcross = position.y * (aWidth + 2.0 * uPixel);
  vHalf = half_;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 0.0, 1.0);
}
`
const BRANCH_FRAGMENT = /* glsl */ `
uniform float uPixel, uFade;
varying float vAcross, vHalf;
void main() {
  float ink = (1.0 - smoothstep(vHalf, vHalf + uPixel, abs(vAcross))) * uFade;
  if (ink <= 0.01) discard;
  gl_FragColor = vec4(vec3(0.07), ink);
}
`

const FLOWER_VERTEX = /* glsl */ `
uniform float uTime;
attribute vec4 aFlower;  // x, y, size, hue
attribute float aBorn;
varying vec2 vLocal;
varying float vHue, vSeed;
void main() {
  float open = smoothstep(0.0, ${OPEN_S.toFixed(1)}, uTime - aBorn);
  vLocal = position.xy * 2.0;
  vHue = aFlower.w;
  vSeed = fract(aFlower.x * 37.0 + aFlower.y * 11.0);
  vec2 p = aFlower.xy + position.xy * aFlower.z * 2.0 * open;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 0.0, 1.0);
}
`
const FLOWER_FRAGMENT = /* glsl */ `
uniform float uFade;
varying vec2 vLocal;
varying float vHue, vSeed;
void main() {
  float r = length(vLocal);
  float a = atan(vLocal.y, vLocal.x) + vSeed * 6.2831;
  // Five round petals, a darker heart.
  float petal = 0.62 + 0.38 * abs(cos(a * 2.5));
  float inside = 1.0 - smoothstep(petal - 0.06, petal, r);
  if (inside <= 0.01) discard;
  vec3 pink = vec3(0.96, 0.66, 0.74), rose = vec3(0.86, 0.36, 0.48), cream = vec3(0.99, 0.93, 0.86), peach = vec3(0.98, 0.72, 0.58);
  vec3 col = vHue < 0.35 ? mix(pink, rose, vHue / 0.35) : vHue < 0.7 ? mix(cream, pink, (vHue - 0.35) / 0.35) : mix(peach, pink, (vHue - 0.7) / 0.3);
  col *= 0.92 + 0.08 * (1.0 - r);
  // The petals' edges and the heart, drawn in.
  col = mix(col, vec3(0.45, 0.2, 0.22), smoothstep(petal - 0.14, petal - 0.04, r) * 0.35);
  col = mix(col, vec3(0.55, 0.38, 0.12), 1.0 - smoothstep(0.12, 0.2, r));
  gl_FragColor = vec4(col, inside * uFade);
}
`

/** Draw the Geäst into `canvas`, showing the part `view` of the wall. */
export function createGrowthView(canvas: HTMLCanvasElement, view: Rect, options: { fps?: number; maxPixelRatio?: number }): PatternView & {
  apply(delta: GrowthDelta): void
  load(snapshot: GrowthSnapshot): void
} {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, options.maxPixelRatio ?? 1.5))
  renderer.setClearColor(PAPER, 1)
  const scene = new THREE.Scene()
  const camera = new THREE.OrthographicCamera(view.x0, view.x1, view.y1, view.y0, -1, 1)
  const uPixel = { value: 0.001 }
  const uFade = { value: 1 }
  const uTime = { value: 0 }
  let fadeTarget = 1

  const quad = (shift: number) => {
    const plane = new THREE.PlaneGeometry(1, 1)
    plane.translate(shift, 0, 0)
    return plane
  }
  const branchQuad = quad(0.5)
  const branches = new THREE.InstancedBufferGeometry()
  branches.setIndex(branchQuad.index)
  branches.setAttribute('position', branchQuad.attributes.position)
  const ends = new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY * 4), 4)
  const widths = new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY), 1)
  ends.setUsage(THREE.DynamicDrawUsage)
  widths.setUsage(THREE.DynamicDrawUsage)
  branches.setAttribute('aEnds', ends)
  branches.setAttribute('aWidth', widths)
  branches.instanceCount = 0
  const branchMaterial = new THREE.ShaderMaterial({ uniforms: { uPixel, uFade }, vertexShader: BRANCH_VERTEX, fragmentShader: BRANCH_FRAGMENT, transparent: true, depthWrite: false })
  const branchMesh = new THREE.Mesh(branches, branchMaterial)
  branchMesh.frustumCulled = false
  scene.add(branchMesh)

  const flowerQuad = quad(0)
  const flowers = new THREE.InstancedBufferGeometry()
  flowers.setIndex(flowerQuad.index)
  flowers.setAttribute('position', flowerQuad.attributes.position)
  const flowerData = new THREE.InstancedBufferAttribute(new Float32Array(FLOWER_CAPACITY * 4), 4)
  const flowerBorn = new THREE.InstancedBufferAttribute(new Float32Array(FLOWER_CAPACITY), 1)
  flowerData.setUsage(THREE.DynamicDrawUsage)
  flowerBorn.setUsage(THREE.DynamicDrawUsage)
  flowers.setAttribute('aFlower', flowerData)
  flowers.setAttribute('aBorn', flowerBorn)
  flowers.instanceCount = 0
  const flowerMaterial = new THREE.ShaderMaterial({ uniforms: { uFade, uTime }, vertexShader: FLOWER_VERTEX, fragmentShader: FLOWER_FRAGMENT, transparent: true, depthWrite: false })
  const flowerMesh = new THREE.Mesh(flowers, flowerMaterial)
  flowerMesh.frustumCulled = false
  flowerMesh.renderOrder = 1
  scene.add(flowerMesh)

  const clock = () => performance.now() / 1000

  const addSegments = (numbers: number[]) => {
    for (let i = 0; i + 4 < numbers.length && branches.instanceCount < CAPACITY; i += 5) {
      const n = branches.instanceCount
      ends.setXYZW(n, numbers[i], numbers[i + 1], numbers[i + 2], numbers[i + 3])
      widths.setX(n, numbers[i + 4])
      branches.instanceCount = n + 1
    }
    ends.needsUpdate = true
    widths.needsUpdate = true
  }
  const addFlowers = (numbers: number[], born: number) => {
    for (let i = 0; i + 3 < numbers.length && flowers.instanceCount < FLOWER_CAPACITY; i += 4) {
      const n = flowers.instanceCount
      flowerData.setXYZW(n, numbers[i], numbers[i + 1], numbers[i + 2], numbers[i + 3])
      flowerBorn.setX(n, born)
      flowers.instanceCount = n + 1
    }
    flowerData.needsUpdate = true
    flowerBorn.needsUpdate = true
  }
  const clear = () => {
    branches.instanceCount = 0
    flowers.instanceCount = 0
  }

  let raf = 0, last = performance.now(), frames = 0, since = last, renderedFps = 0, disposed = false
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
    uFade.value += (fadeTarget - uFade.value) * Math.min(1, dt * (fadeTarget < uFade.value ? 1 : 4))
    uTime.value = clock()
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
    apply(delta) {
      if (delta.reset) {
        clear()
        uFade.value = 1
      }
      if (delta.fade !== undefined) fadeTarget = delta.fade
      addSegments(delta.segments)
      addFlowers(delta.flowers, clock())
    },
    load(snapshot) {
      clear()
      addSegments(snapshot.segments)
      // Flowers that were open already are open at once.
      addFlowers(snapshot.flowers, clock() - OPEN_S)
      fadeTarget = snapshot.fade
      uFade.value = snapshot.fade
    },
    setPerson() {},
    debug: () => ({ webgl: renderer.capabilities.isWebGL2 ? 2 : 1, renderedFps, headLoaded: true, pattern: 'geaest', branches: branches.instanceCount, flowers: flowers.instanceCount }),
    dispose() {
      disposed = true
      cancelAnimationFrame(raf)
      observer.disconnect()
      branches.dispose()
      flowers.dispose()
      branchQuad.dispose()
      flowerQuad.dispose()
      branchMaterial.dispose()
      flowerMaterial.dispose()
      renderer.dispose()
    },
  }
}
