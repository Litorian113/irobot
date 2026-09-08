const smooth = (a: number, b: number, value: number) => {
  const t = Math.max(0, Math.min(1, (value - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/** One reversible clock: the enclosure assembles before the portrait appears. */
export class VikiAssembly {
  progress = 0
  direction = 1
  moving = false
  get cube() { return smooth(0, 0.72, this.progress) }
  get face() { return smooth(0.58, 1, this.progress) }

  update(dt: number, active: boolean, snapshot?: number) {
    const target = active ? 1 : 0
    this.direction = active ? 1 : -1
    if (snapshot !== undefined) this.progress = Math.max(0, Math.min(1, snapshot))
    else {
      const step = Math.max(0, dt) / (active ? 4.6 : 3.4)
      this.progress = active ? Math.min(target, this.progress + step) : Math.max(target, this.progress - step)
    }
    this.moving = this.progress !== target
  }
}

/** Cube-local coordinates keep the descending front continuous across all six windows. */
export const VIKI_ASSEMBLY_GLSL = /* glsl */ `
uniform float uBuild;
float columnSeed(vec2 cell) {
  return fract(sin(dot(cell, vec2(127.1, 311.7))) * 43758.5453);
}
float columnProgress(vec2 xz) {
  vec2 cell = floor(xz * 38.0);
  float delay = columnSeed(cell) * 0.70;
  float duration = 0.24 + columnSeed(cell + vec2(19.0, 43.0)) * 0.30;
  return smoothstep(delay, min(0.99, delay + duration), uBuild);
}
float assemblyFront(vec2 xz) {
  return 1.22 - 2.44 * columnProgress(xz);
}
float assemblyMask(vec3 p) {
  return smoothstep(assemblyFront(p.xz) - 0.045, assemblyFront(p.xz) + 0.045, p.y);
}
`
