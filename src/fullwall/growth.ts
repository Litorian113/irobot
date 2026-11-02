/**
 * Geäst: a net of branches growing over the whole wall. Where someone walks past, branches come
 * in from the side they came from and follow them, thick at the root and finer towards the tips;
 * where someone stands still, the branches grow into their outline and flowers open on the twigs.
 * When nobody has been there for a while, it all fades and starts afresh.
 *
 * Growth has chance in it, so it runs in one place only, on the server (vite.config.ts), and every
 * screen gets the same new branches (or, for the preview, in the page itself). Pure logic, no
 * three.js: positions in wall metres, as in geometry.ts.
 */

export interface WallBox { x0: number; y0: number; x1: number; y1: number }

/**
 * The whole wall as the server sees it: geometry.ts with the shelf's default spacing (0.55 m across,
 * 0.5 m up) and an iMac 24" screen (0.518 x 0.324 m). The server cannot read a screen's link.
 */
export const DEFAULT_WALL: WallBox = { x0: -0.55 - 0.259, x1: 0.55 + 0.259, y0: -0.5 - 0.162, y1: 0.5 + 0.162 }

/** What the camera says: where the person is (face, wall metres), and their outline (silhouette.ts) if known. */
export interface GrowthInput {
  person: { x: number; y: number } | null
  cells: Uint8Array | null
  /** The outline grid's size. */
  gridW: number
  gridH: number
}

/**
 * What changed in one step. `segments`: 5 numbers each (x0, y0, x1, y1, width); `flowers`: 4 each
 * (x, y, size, hue 0..1). `fade`: where the whole picture is heading (1 shown, 0 gone); `reset`: start empty.
 */
export interface GrowthDelta {
  segments: number[]
  flowers: number[]
  fade?: number
  reset?: boolean
}

export interface GrowthSnapshot { segments: number[]; flowers: number[]; fade: number }

/** One step of growth, in metres. */
const STEP = 0.015
/** Branches feel the points they grow towards from this far, and reach them at this distance. */
const INFLUENCE = 0.75
const KILL = 0.035
const MAX_SEGMENTS = 7000
const MAX_TIPS = 70
const MAX_FLOWERS = 240
const ROOT_WIDTH = 0.024
/** Thinner than this, a twig stops. */
const MIN_WIDTH = 0.0008
/** Standing this long (s) before flowers open; nobody this long (s) before it fades, and this long to fade. */
const STILL_FOR = 2.5
const EMPTY_FOR = 3.5
const FADE_FOR = 3
/** Slower than this (m/s) counts as standing. */
const STILL_SPEED = 0.18

interface Tip { x: number; y: number; dx: number; dy: number; width: number; idle: number }

const round = (v: number) => Math.round(v * 10000) / 10000

export class Growth {
  private wall: WallBox
  private random: () => number
  private tips: Tip[] = []
  private attractors: { x: number; y: number }[] = []
  private segments: number[] = []
  private flowers: number[] = []
  private roots = 0
  private lastPerson: { x: number; y: number; at: number } | null = null
  private velocityX = 0
  private stillSince = 0
  private seenAt = 0
  private fading: number | null = null
  private fade = 1

  constructor(wall: WallBox, random: () => number = Math.random) {
    this.wall = wall
    this.random = random
  }

  snapshot(): GrowthSnapshot {
    return { segments: [...this.segments], flowers: [...this.flowers], fade: this.fade }
  }

  /** One step, `now` in seconds. */
  step(input: GrowthInput, now: number): GrowthDelta | null {
    const delta: GrowthDelta = { segments: [], flowers: [] }
    const person = input.person
    if (person) {
      this.seenAt = now
      if (this.fading !== null) {
        // Someone came back while it faded: it stays.
        this.fading = null
        this.fade = 1
        delta.fade = 1
      }
      if (this.lastPerson) {
        const dt = Math.max(0.05, now - this.lastPerson.at)
        const vx = (person.x - this.lastPerson.x) / dt
        this.velocityX += (vx - this.velocityX) * 0.3
        const speed = Math.hypot(vx, (person.y - this.lastPerson.y) / dt)
        if (speed > STILL_SPEED) this.stillSince = now
      } else {
        this.stillSince = now
      }
      this.lastPerson = { x: person.x, y: person.y, at: now }
    } else {
      this.lastPerson = null
      if (this.segments.length && this.fading === null && now - this.seenAt > EMPTY_FOR) {
        this.fading = now
        this.fade = 0
        delta.fade = 0
      }
      if (this.fading !== null && now - this.fading > FADE_FOR) {
        this.clear()
        return { segments: [], flowers: [], reset: true, fade: 1 }
      }
    }

    this.updateAttractors(input)
    if (person && this.fading === null) this.plant(person)
    this.grow(person, delta)
    if (person && now - this.stillSince > STILL_FOR) this.bloom(delta)
    return delta.segments.length || delta.flowers.length || delta.fade !== undefined ? delta : null
  }

  private clear() {
    this.tips = []
    this.attractors = []
    this.segments = []
    this.flowers = []
    this.roots = 0
    this.fading = null
    this.fade = 1
  }

  /** From the outline grid (camera picture, 0..1) to the wall, mirrored, as in silhouette.ts. */
  private cellToWall(gx: number, gy: number, gridW: number, gridH: number) {
    const h = this.wall.y1 - this.wall.y0, w = h * 16 / 9
    const cx = (this.wall.x0 + this.wall.x1) / 2, cy = (this.wall.y0 + this.wall.y1) / 2
    const u = (gx + this.random()) / gridW, v = (gy + this.random()) / gridH
    return { x: cx + (0.5 - u) * w, y: cy + (0.5 - v) * h }
  }

  /** What the branches grow towards: points in the person's outline, or round where they are. */
  private updateAttractors(input: GrowthInput) {
    const { person, cells, gridW, gridH } = input
    if (!person) {
      this.attractors = []
      return
    }
    if (cells) {
      const inside: number[] = []
      for (let i = 0; i < cells.length; i++) if (cells[i]) inside.push(i)
      if (inside.length) {
        // The outline moves with the person: points that left it go, new ones come in.
        const inBody = (p: { x: number; y: number }) => {
          const h = this.wall.y1 - this.wall.y0, w = h * 16 / 9
          const u = 0.5 - (p.x - (this.wall.x0 + this.wall.x1) / 2) / w
          const v = 0.5 - (p.y - (this.wall.y0 + this.wall.y1) / 2) / h
          const gx = Math.floor(u * gridW), gy = Math.floor(v * gridH)
          return gx >= 0 && gy >= 0 && gx < gridW && gy < gridH && cells[gy * gridW + gx] > 0
        }
        this.attractors = this.attractors.filter(inBody)
        for (let n = 0; n < 14 && this.attractors.length < 320; n++) {
          const i = inside[Math.floor(this.random() * inside.length)]
          this.attractors.push(this.cellToWall(i % gridW, Math.floor(i / gridW), gridW, gridH))
        }
        return
      }
    }
    // No outline: a person-shaped cloud under the face.
    this.attractors = this.attractors.filter((a) => Math.abs(a.x - person.x) < 0.3 && a.y < person.y + 0.15 && a.y > person.y - 1.6)
    for (let n = 0; n < 8 && this.attractors.length < 160; n++) {
      this.attractors.push({ x: person.x + (this.random() - 0.5) * 0.4, y: person.y + 0.1 - this.random() * 1.6 })
    }
  }

  /** New roots at the edge the person came from (and now and then from the floor). */
  private plant(person: { x: number; y: number }) {
    if (this.roots >= 5 || this.tips.length > 2) return
    // From the side they came from; standing, from the nearer edge.
    const fromLeft = this.velocityX > 0.05 || (this.velocityX >= -0.05 && person.x < (this.wall.x0 + this.wall.x1) / 2)
    const fromFloor = this.roots > 0 && this.random() < 0.35
    const x = fromFloor ? person.x + (this.random() - 0.5) * 0.8 : fromLeft ? this.wall.x0 : this.wall.x1
    const y = fromFloor ? this.wall.y0 : this.wall.y0 + (this.wall.y1 - this.wall.y0) * (0.1 + this.random() * 0.5)
    const dx = person.x - x, dy = person.y - 0.6 - y, d = Math.hypot(dx, dy) || 1
    this.tips.push({ x, y, dx: dx / d, dy: dy / d, width: ROOT_WIDTH * (0.75 + this.random() * 0.4), idle: 0 })
    this.roots++
  }

  private grow(person: { x: number; y: number } | null, delta: GrowthDelta) {
    if (this.fading !== null) return
    // Space colonisation: every point pulls only the tip nearest to it, so the branches fan out
    // and fill the outline instead of all heading for the same middle.
    const pull = this.tips.map(() => ({ x: 0, y: 0, n: 0 }))
    for (const a of this.attractors) {
      let best = -1, bestD = INFLUENCE
      this.tips.forEach((t, i) => { const d = Math.hypot(a.x - t.x, a.y - t.y); if (d < bestD) { bestD = d; best = i } })
      if (best < 0 || bestD < 1e-6) continue
      pull[best].x += (a.x - this.tips[best].x) / bestD
      pull[best].y += (a.y - this.tips[best].y) / bestD
      pull[best].n++
    }
    const born: Tip[] = []
    this.tips.forEach((tip, i) => {
      if (this.segments.length / 5 >= MAX_SEGMENTS) return
      let { x: ax, y: ay, n: felt } = pull[i]
      // Nothing near: a long branch heads after the person; the rest wait.
      if (!felt && person && tip.width > ROOT_WIDTH * 0.35) {
        const dx = person.x - tip.x, dy = person.y - 0.7 - tip.y, d = Math.hypot(dx, dy)
        if (d > 0.25) { ax = dx / d; ay = dy / d; felt = 1 }
      }
      if (!felt) {
        tip.idle++
        return
      }
      const strength = Math.hypot(ax, ay) || 1
      // Gnarled: much of where it went before, and a twist of its own.
      const twist = (this.random() - 0.5) * 0.75
      let dx = tip.dx * 0.6 + (ax / strength) * 0.6 - tip.dy * twist * 0.45
      let dy = tip.dy * 0.6 + (ay / strength) * 0.6 + tip.dx * twist * 0.45
      const d = Math.hypot(dx, dy) || 1
      dx /= d
      dy /= d
      const nx = tip.x + dx * STEP, ny = tip.y + dy * STEP
      const width = tip.width
      const piece = [round(tip.x), round(tip.y), round(nx), round(ny), round(width)]
      this.segments.push(...piece)
      delta.segments.push(...piece)
      tip.x = nx
      tip.y = ny
      tip.dx = dx
      tip.dy = dy
      tip.width *= 0.994
      tip.idle = 0
      this.attractors = this.attractors.filter((a) => Math.hypot(a.x - nx, a.y - ny) > KILL)
      // Branching: more of it where there is much to reach, as in a crown.
      const chance = 0.025 + Math.min(0.09, felt * 0.012)
      if (this.tips.length + born.length < MAX_TIPS && tip.width > MIN_WIDTH * 2 && this.random() < chance) {
        const angle = (0.4 + this.random() * 0.6) * (this.random() < 0.5 ? -1 : 1)
        const c = Math.cos(angle), s = Math.sin(angle)
        born.push({ x: nx, y: ny, dx: dx * c - dy * s, dy: dx * s + dy * c, width: width * 0.6, idle: 0 })
        tip.width *= 0.85
      }
    })
    const outside = (t: Tip) => t.x < this.wall.x0 - 0.3 || t.x > this.wall.x1 + 0.3 || t.y < this.wall.y0 - 0.3 || t.y > this.wall.y1 + 0.3
    this.tips = [...this.tips, ...born].filter((t) => t.width > MIN_WIDTH && t.idle < 25 && !outside(t))
  }

  /** Flowers on the twigs: at the tips, and on fine branches near the person. */
  private bloom(delta: GrowthDelta) {
    if (this.flowers.length / 4 >= MAX_FLOWERS || this.fading !== null) return
    for (let n = 0; n < 2; n++) {
      let x: number, y: number
      const thin = this.tips.filter((t) => t.width < ROOT_WIDTH * 0.25)
      if (thin.length && this.random() < 0.6) {
        const t = thin[Math.floor(this.random() * thin.length)]
        x = t.x
        y = t.y
      } else {
        const count = this.segments.length / 5
        if (!count) return
        // A fine branch from the newer half of the net.
        const i = Math.floor(count * (0.5 + this.random() * 0.5)) * 5
        if (this.segments[i + 4] > ROOT_WIDTH * 0.3) continue
        x = this.segments[i + 2]
        y = this.segments[i + 3]
      }
      const flower = [round(x), round(y), round(0.012 + this.random() * 0.018), round(this.random())]
      this.flowers.push(...flower)
      delta.flowers.push(...flower)
    }
  }
}
