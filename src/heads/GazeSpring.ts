/** Limits of the neck, in radians. */
const MAX_YAW = 0.95
const MAX_PITCH = 0.42

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/**
 * How every head turns: a critically damped spring per axis follows a delayed
 * copy of the target, plus a slow sway - a living head never holds still.
 */
export class GazeSpring {
  yaw = 0
  pitch = 0
  /** The target the spring is heading for right now (after the delay). */
  readonly goal = { yaw: 0, pitch: 0 }
  private yawVel = 0
  private pitchVel = 0
  private queue: { at: number; yaw: number; pitch: number }[] = []
  private stiffness: number
  private delay: number

  /** `stiffness`: angular frequency in rad/s; `delay`: seconds of reaction lag. */
  constructor(stiffness = 5, delay = 0) {
    this.stiffness = stiffness
    this.delay = delay
  }

  /** yaw > 0 turns the face to screen-right, pitch > 0 looks up. */
  set(yaw: number, pitch: number) {
    this.queue.push({ at: performance.now() / 1000 + this.delay, yaw: clamp(yaw, -MAX_YAW, MAX_YAW), pitch: clamp(pitch, -MAX_PITCH, MAX_PITCH) })
    if (this.queue.length > 240) this.queue.splice(0, this.queue.length - 240)
  }

  /** Advance by `dt` seconds; returns the pose including the sway at time `t`. */
  update(dt: number, t: number) {
    const now = performance.now() / 1000
    while (this.queue.length && this.queue[0].at <= now) {
      const next = this.queue.shift()!
      this.goal.yaw = next.yaw
      this.goal.pitch = next.pitch
    }
    // Quick to start, no overshoot, frame-rate independent.
    const w = this.stiffness
    const steps = Math.max(1, Math.ceil(dt / (1 / 120)))
    const h = dt / steps
    for (let i = 0; i < steps; i++) {
      this.yawVel += (w * w * (this.goal.yaw - this.yaw) - 2 * w * this.yawVel) * h
      this.pitchVel += (w * w * (this.goal.pitch - this.pitch) - 2 * w * this.pitchVel) * h
      this.yaw += this.yawVel * h
      this.pitch += this.pitchVel * h
    }
    return {
      yaw: this.yaw + Math.sin(t * 0.37 + this.delay * 9) * 0.015,
      pitch: this.pitch + Math.sin(t * 0.23 + this.delay * 5) * 0.01,
    }
  }
}
