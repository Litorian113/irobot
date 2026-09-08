import * as THREE from 'three'

export const CHAIN_GRID_SIZE = 128
type Cell = readonly [number, number]
export interface PixelChain { path: Cell[]; length: number; offset: number; cadence: number }
const wrap = (n: number, size: number) => ((n % size) + size) % size

/** Closed orthogonal paths: short trails can turn in all four directions without jumping at loop boundaries. */
export function createPixelChains(count = 112): PixelChain[] {
  let seed = 97031
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296)
  const integer = (min: number, max: number) => min + Math.floor(random() * (max - min + 1))
  return Array.from({ length: count }, () => {
    const x = integer(0, 127), y = integer(0, 127), w = integer(4, 10), h = integer(3, 8)
    const a = integer(1, w - 2), b = integer(2, 5), c = integer(2, 5), d = integer(1, h - 1)
    const corners: Cell[] = [[0, 0], [w, 0], [w, h], [w - a, h], [w - a, h + b], [-c, h + b], [-c, d], [0, d], [0, 0]]
    const path: Cell[] = [], rotation = integer(0, 3)
    for (let i = 0; i < corners.length - 1; i++) {
      let [px, py] = corners[i]
      const [endX, endY] = corners[i + 1]
      const dx = Math.sign(endX - px), dy = Math.sign(endY - py)
      while (px !== endX || py !== endY) {
        const [rx, ry] = rotation === 0 ? [px, py] : rotation === 1 ? [-py, px] : rotation === 2 ? [-px, -py] : [py, -px]
        path.push([wrap(rx + x, CHAIN_GRID_SIZE), wrap(ry + y, CHAIN_GRID_SIZE)])
        px += dx; py += dy
      }
    }
    if (random() < 0.5) path.reverse()
    return { path, length: integer(3, 5), offset: integer(0, path.length - 1), cadence: integer(1, 2) }
  })
}

export function chainCells(chain: PixelChain, step: number): Cell[] {
  const head = Math.floor(step / chain.cadence) + chain.offset
  return Array.from({ length: chain.length }, (_, tail) => chain.path[wrap(head - tail, chain.path.length)])
}

// Shared by the head, data particles and inner walls. One tiny lookup replaces per-pixel path searching.
export const PIXEL_CHAINS_GLSL = /* glsl */ `
uniform sampler2D uChains;
uniform float uChainMix;
float chainLight(vec2 cell) {
  vec2 uv = (mod(floor(cell), ${CHAIN_GRID_SIZE.toFixed(1)}) + 0.5) / ${CHAIN_GRID_SIZE.toFixed(1)};
  vec2 steps = texture2D(uChains, uv).rg;
  return mix(steps.r, steps.g, uChainMix);
}
`

/** Two successive chain frames in RG; interpolation stays on the GPU between cell steps. */
export class PixelChains {
  private data = new Uint8Array(CHAIN_GRID_SIZE * CHAIN_GRID_SIZE * 2)
  readonly texture = new THREE.DataTexture(this.data, CHAIN_GRID_SIZE, CHAIN_GRID_SIZE, THREE.RGFormat, THREE.UnsignedByteType)
  readonly uniforms = { uChains: { value: this.texture }, uChainMix: { value: 0 } }
  private chains = createPixelChains()
  private step = -1

  constructor() {
    this.texture.minFilter = this.texture.magFilter = THREE.NearestFilter
    this.texture.generateMipmaps = false
    this.update(0, 1)
  }

  update(time: number, speed: number) {
    const clock = Math.max(0, time * speed * 8), step = Math.floor(clock), phase = clock - step
    this.uniforms.uChainMix.value = phase * phase * (3 - 2 * phase)
    if (step === this.step) return
    this.step = step
    this.data.fill(0)
    for (let channel = 0; channel < 2; channel++) for (const chain of this.chains) {
      const head = Math.floor((step + channel) / chain.cadence) + chain.offset
      for (let tail = 0; tail < chain.length; tail++) {
        const [x, y] = chain.path[wrap(head - tail, chain.path.length)]
        const index = (y * CHAIN_GRID_SIZE + x) * 2 + channel
        this.data[index] = Math.max(this.data[index], Math.round(255 * (1 - tail / (chain.length + 1))))
      }
    }
    this.texture.needsUpdate = true
  }

  dispose() { this.texture.dispose() }
}
