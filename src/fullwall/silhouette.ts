import * as THREE from 'three'
import { SHAPE_H, SHAPE_W } from '../tracking/silhouette'
import { height, wallRect, width, type Rect } from './geometry'
import type { PatternView } from './pattern'

/**
 * Silhouette: the people in front of the wall, drawn back on it as lines across their bodies on
 * white, like a mirror: the lines bow with the body, thicker parts more. The camera picture is laid
 * over the whole wall, its height to the wall's, mirrored. Only a coarse outline arrives
 * (tracking/silhouette.ts); it is smoothed here, so the people seem to flow rather than flicker.
 * WebGL 1 safe: one quad, a 64 x 36 texture, GLSL ES 1.0 without derivatives.
 */

const PAPER = 0xefece6
const INK = new THREE.Color(0x1e1e1e)
/** Distance between the lines and their width, in metres. */
const SPACING = 0.024
const WIDTH = 0.0034
/** How far the lines bow over the thickest part of a body, in metres. */
const BOW = 0.05
/** How fast the shown outline follows a new one (per second): fast enough to follow, slow enough to flow. */
const FOLLOW = 7

const VERTEX = /* glsl */ `
varying vec2 vWall;
void main() {
  vec4 wall = modelMatrix * vec4(position, 1.0);
  vWall = wall.xy;
  gl_Position = projectionMatrix * viewMatrix * wall;
}
`

const FRAGMENT = /* glsl */ `
uniform sampler2D uShape;
uniform vec3 uInk;
uniform vec4 uFrame;   // centre x, centre y, width, height of the camera picture on the wall
uniform float uSpacing, uWidth, uBow, uPixel, uTime;
varying vec2 vWall;
void main() {
  // Mirrored: someone on the left of the street sees themselves on the left of the wall.
  vec2 uv = vec2(0.5 - (vWall.x - uFrame.x) / uFrame.z, 0.5 - (vWall.y - uFrame.y) / uFrame.w);
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) discard;
  vec4 shape = texture2D(uShape, uv);
  float body = smoothstep(0.44, 0.56, shape.r);
  if (body <= 0.0) discard;
  // The lines sag where the body is thick, and breathe a little.
  float y = vWall.y + uBow * shape.g + 0.004 * sin(vWall.x * 9.0 + uTime * 0.8);
  float d = abs(fract(y / uSpacing) - 0.5) * uSpacing;
  float ink = (1.0 - smoothstep(uWidth * 0.5, uWidth * 0.5 + uPixel, d)) * body;
  if (ink <= 0.01) discard;
  gl_FragColor = vec4(uInk, ink);
}
`

/** Box blur, in place, `radius` cells wide: soft edges from the coarse grid, and the body's thickness. */
function blur(values: Float32Array, radius: number) {
  const out = new Float32Array(values.length)
  for (const horizontal of [true, false]) {
    for (let y = 0; y < SHAPE_H; y++) for (let x = 0; x < SHAPE_W; x++) {
      let sum = 0, n = 0
      for (let d = -radius; d <= radius; d++) {
        const xx = horizontal ? x + d : x, yy = horizontal ? y : y + d
        if (xx < 0 || yy < 0 || xx >= SHAPE_W || yy >= SHAPE_H) continue
        sum += values[yy * SHAPE_W + xx]
        n++
      }
      out[y * SHAPE_W + x] = sum / n
    }
    values.set(out)
  }
  return values
}

/** Draw the silhouettes into `canvas`, showing the part `view` of the wall. */
export function createSilhouette(canvas: HTMLCanvasElement, view: Rect, options: { now: () => number; fps?: number; maxPixelRatio?: number }): PatternView & { setShape(cells: Uint8Array | null): void } {
  const attributes: WebGLContextAttributes = { antialias: true, alpha: false, powerPreference: 'high-performance' }
  const renderer = new THREE.WebGLRenderer({ canvas, ...attributes })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, options.maxPixelRatio ?? 1.5))
  renderer.setClearColor(PAPER, 1)
  const scene = new THREE.Scene()
  const camera = new THREE.OrthographicCamera(view.x0, view.x1, view.y1, view.y0, -1, 1)
  const wall = wallRect()
  // The camera picture, 16:9, as high as the wall, in its middle.
  const frameHeight = height(wall)
  const frame = new THREE.Vector4((wall.x0 + wall.x1) / 2, (wall.y0 + wall.y1) / 2, frameHeight * 16 / 9, frameHeight)

  const data = new Uint8Array(SHAPE_W * SHAPE_H * 4)
  const texture = new THREE.DataTexture(data, SHAPE_W, SHAPE_H, THREE.RGBAFormat)
  texture.magFilter = THREE.LinearFilter
  texture.minFilter = THREE.LinearFilter
  texture.needsUpdate = true
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uShape: { value: texture },
      uInk: { value: INK },
      uFrame: { value: frame },
      uSpacing: { value: SPACING },
      uWidth: { value: WIDTH },
      uBow: { value: BOW },
      uPixel: { value: 0.001 },
      uTime: { value: 0 },
    },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    transparent: true,
  })
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(width(view), height(view)), material)
  quad.position.set((view.x0 + view.x1) / 2, (view.y0 + view.y1) / 2, 0)
  quad.frustumCulled = false
  scene.add(quad)

  const target = new Float32Array(SHAPE_W * SHAPE_H)
  const shown = new Float32Array(SHAPE_W * SHAPE_H)
  let raf = 0, last = performance.now(), frames = 0, since = last, renderedFps = 0, disposed = false
  const fps = options.fps ?? 30

  const resize = () => {
    const w = canvas.clientWidth || 1
    renderer.setSize(w, canvas.clientHeight || 1, false)
    material.uniforms.uPixel.value = width(view) / (w * renderer.getPixelRatio())
  }
  const observer = new ResizeObserver(resize)
  observer.observe(canvas)
  resize()

  const tick = () => {
    if (disposed) return
    raf = requestAnimationFrame(tick)
    const now = performance.now()
    if (now - last < 1000 / fps - 2) return
    const k = Math.min(1, ((now - last) / 1000) * FOLLOW)
    last = now
    for (let i = 0; i < shown.length; i++) shown[i] += (target[i] - shown[i]) * k
    const edge = blur(Float32Array.from(shown), 1)
    const depth = blur(Float32Array.from(shown), 4)
    for (let i = 0; i < shown.length; i++) {
      data[i * 4] = Math.round(edge[i] * 255)
      data[i * 4 + 1] = Math.round(Math.min(1, depth[i] * 1.25) * 255)
      data[i * 4 + 3] = 255
    }
    texture.needsUpdate = true
    material.uniforms.uTime.value = (options.now() / 1000) % 3600
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
    setShape(cells) {
      if (cells) for (let i = 0; i < target.length; i++) target[i] = cells[i]
      else target.fill(0)
    },
    setPerson() {},
    debug: () => ({ webgl: renderer.capabilities.isWebGL2 ? 2 : 1, renderedFps, headLoaded: true, pattern: 'silhouette', cells: target.reduce((a, b) => a + b, 0) }),
    dispose() {
      disposed = true
      cancelAnimationFrame(raf)
      observer.disconnect()
      quad.geometry.dispose()
      material.dispose()
      texture.dispose()
      renderer.dispose()
    },
  }
}
