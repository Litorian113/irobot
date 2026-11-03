/**
 * Geäst: vines growing over the whole wall, only where people are. Someone walks in: from the edge
 * they came from, swirling vines race after them and grow into the places they passed. Someone stands
 * still: the vines fill their outline and blossoms open on it, until the person stands there again as
 * a figure of flowers. Nobody in front of the wall: it is gone at once, ready for the next.
 *
 * Growth has chance in it, so it runs in one place only, on the server (vite.config.ts), and every
 * screen gets the same new pieces (or, for the preview, in the page itself). Pure logic, no three.js:
 * positions in wall metres, as in geometry.ts.
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

/** One piece of vine, in metres, and pieces per step: fast. */
const STEP = 0.012
const PIECES_PER_STEP = 4
/** Vines feel the points they grow towards from this far, and reach them at this distance. */
const INFLUENCE = 0.6
const KILL = 0.03
const MAX_SEGMENTS = 12000
const MAX_TIPS = 90
const MAX_FLOWERS = 420
/** The places a person passed or stands in: points the vines grow into, the oldest forgotten first. */
const MAX_ATTRACTORS = 700
const ROOT_WIDTH = 0.016
/** Thinner than this, a tendril stops. */
const MIN_WIDTH = 0.0007
/** Standing this long (s) before the blossoms come. */
const STILL_FOR = 1.5
/** Nobody for this long (s): fade, which takes this long (s), then empty. */
const EMPTY_FOR = 0.25
const FADE_FOR = 0.6
/** Slower than this (m/s) counts as standing. */
const STILL_SPEED = 0.18

/** A growing end: where, which way, how thick, and how it curls (radians per piece, drifting). */
interface Tip { x: number; y: number; dx: number; dy: number; width: number; curl: number; idle: number }

const round = (v: number) => Math.round(v * 10000) / 10000

export class Growth {
  private wall: WallBox
  private random: () => number
  private tips: Tip[] = []
  private attractors: { x: number; y: number }[] = []
  /** The person's outline as wall points, for the blossoms. */
  private body: { x: number; y: number }[] = []
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

  /** One step (10 a second), `now` in seconds. */
  step(input: GrowthInput, now: number): GrowthDelta | null {
    const delta: GrowthDelta = { segments: [], flowers: [] }
    const person = input.person
    if (person) {
      this.seenAt = now
      if (this.fading !== null) {
        this.fading = null
        this.fade = 1
        delta.fade = 1
      }
      if (this.lastPerson) {
        const dt = Math.max(0.05, now - this.lastPerson.at)
        const vx = (person.x - this.lastPerson.x) / dt
        this.velocityX += (vx - this.velocityX) * 0.3
        if (Math.hypot(vx, (person.y - this.lastPerson.y) / dt) > STILL_SPEED) this.stillSince = now
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
      return delta.fade !== undefined ? delta : null
    }

    this.updateAttractors(input)
    this.plant(person)
    for (let i = 0; i < PIECES_PER_STEP; i++) this.grow(person, delta)
    if (now - this.stillSince > STILL_FOR) this.bloom(delta)
    return delta.segments.length || delta.flowers.length || delta.fade !== undefined ? delta : null
  }

  private clear() {
    this.tips = []
    this.attractors = []
    this.body = []
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

  /**
   * Where the vines go: into the person's outline, wherever it has been - the places they passed stay
   * in the list until newer ones push them out, so the vines trail their way. Without an outline, a
   * person-shaped cloud under the face.
   */
  private updateAttractors(input: GrowthInput) {
    const { person, cells, gridW, gridH } = input
    if (!person) return
    const fresh: { x: number; y: number }[] = []
    if (cells) {
      const inside: number[] = []
      for (let i = 0; i < cells.length; i++) if (cells[i]) inside.push(i)
      for (let n = 0; n < Math.min(28, inside.length); n++) {
        const i = inside[Math.floor(this.random() * inside.length)]
        fresh.push(this.cellToWall(i % gridW, Math.floor(i / gridW), gridW, gridH))
      }
    }
    if (!fresh.length) {
      for (let n = 0; n < 16; n++) {
        const t = this.random()
        // Narrow at the head, wide at the shoulders, two legs.
        const y = person.y + 0.1 - t * 1.6
        const half = t < 0.12 ? 0.08 : t < 0.55 ? 0.2 : 0.14
        fresh.push({ x: person.x + (this.random() - 0.5) * 2 * half, y })
      }
    }
    // The outline as it is now, for the blossoms.
    this.body = [...fresh, ...this.body].slice(0, 260)
    this.attractors.push(...fresh)
    if (this.attractors.length > MAX_ATTRACTORS) this.attractors.splice(0, this.attractors.length - MAX_ATTRACTORS)
  }

  /** New vines from the edge the person came from, at the height of their body. */
  private plant(person: { x: number; y: number }) {
    if (this.roots >= 4 || this.tips.length > 3) return
    const fromLeft = this.velocityX > 0.05 || (this.velocityX >= -0.05 && person.x < (this.wall.x0 + this.wall.x1) / 2)
    const x = fromLeft ? this.wall.x0 - 0.02 : this.wall.x1 + 0.02
    const y = person.y - 0.15 - this.random() * 1.1
    this.tips.push({ x, y, dx: fromLeft ? 1 : -1, dy: (this.random() - 0.5) * 0.4, width: ROOT_WIDTH * (0.8 + this.random() * 0.4), curl: (this.random() - 0.5) * 0.1, idle: 0 })
    this.roots++
  }

  private grow(person: { x: number; y: number }, delta: GrowthDelta) {
    // Space colonisation: every point pulls only the tip nearest to it, so the vines fan out
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
      // Nothing near: the strong vines race after the person; the fine ones rest.
      if (!felt && tip.width > ROOT_WIDTH * 0.3) {
        const dx = person.x - tip.x, dy = person.y - 0.6 - tip.y, d = Math.hypot(dx, dy)
        if (d > 0.15) { ax = dx / d; ay = dy / d; felt = 1 }
      }
      if (!felt) {
        tip.idle++
        return
      }
      // Sweeping curves: the curl drifts slowly, and the pull steers gently, so the vine swings round.
      tip.curl = Math.max(-0.07, Math.min(0.07, tip.curl + (this.random() - 0.5) * 0.03))
      const c = Math.cos(tip.curl), s = Math.sin(tip.curl)
      let dx = tip.dx * c - tip.dy * s, dy = tip.dx * s + tip.dy * c
      const strength = Math.hypot(ax, ay) || 1
      // Inside the outline it follows the pull more, so the figure fills; on the way it swings freely.
      const steer = pull[i].n > 3 ? 0.4 : 0.2
      dx = dx * (1 - steer) + (ax / strength) * steer
      dy = dy * (1 - steer) + (ay / strength) * steer
      const d = Math.hypot(dx, dy) || 1
      dx /= d
      dy /= d
      const nx = tip.x + dx * STEP, ny = tip.y + dy * STEP
      const piece = [round(tip.x), round(tip.y), round(nx), round(ny), round(tip.width)]
      this.segments.push(...piece)
      delta.segments.push(...piece)
      tip.x = nx
      tip.y = ny
      tip.dx = dx
      tip.dy = dy
      tip.width *= 0.995
      tip.idle = 0
      this.attractors = this.attractors.filter((a) => Math.hypot(a.x - nx, a.y - ny) > KILL)
      // Tendrils branch off and curl the other way, more where there is much to reach.
      const chance = 0.012 + Math.min(0.05, felt * 0.006)
      if (this.tips.length + born.length < MAX_TIPS && tip.width > MIN_WIDTH * 2.5 && this.random() < chance) {
        const angle = (0.45 + this.random() * 0.5) * (this.random() < 0.5 ? -1 : 1)
        const ca = Math.cos(angle), sa = Math.sin(angle)
        born.push({ x: nx, y: ny, dx: dx * ca - dy * sa, dy: dx * sa + dy * ca, width: tip.width * 0.62, curl: -Math.sign(angle) * (0.03 + this.random() * 0.04), idle: 0 })
        tip.width *= 0.9
      }
    })
    const outside = (t: Tip) => t.x < this.wall.x0 - 0.3 || t.x > this.wall.x1 + 0.3 || t.y < this.wall.y0 - 0.3 || t.y > this.wall.y1 + 0.3
    this.tips = [...this.tips, ...born].filter((t) => t.width > MIN_WIDTH && t.idle < 20 && !outside(t))
  }

  /**
   * Blossoms on the person's outline, so that they stand there again as a figure of flowers; a few
   * more on the ends of the tendrils.
   */
  private bloom(delta: GrowthDelta) {
    for (let n = 0; n < 6 && this.flowers.length / 4 < MAX_FLOWERS; n++) {
      let x: number, y: number
      if (this.body.length && this.random() < 0.85) {
        const p = this.body[Math.floor(this.random() * this.body.length)]
        x = p.x
        y = p.y
      } else if (this.tips.length) {
        const t = this.tips[Math.floor(this.random() * this.tips.length)]
        x = t.x
        y = t.y
      } else {
        return
      }
      // Not on top of the last ones: spread over the figure.
      let crowded = false
      for (let i = Math.max(0, this.flowers.length - 160); i < this.flowers.length; i += 4) {
        if (Math.hypot(this.flowers[i] - x, this.flowers[i + 1] - y) < 0.022) { crowded = true; break }
      }
      if (crowded) continue
      const flower = [round(x), round(y), round(0.014 + this.random() * 0.016), round(this.random())]
      this.flowers.push(...flower)
      delta.flowers.push(...flower)
    }
  }
}
