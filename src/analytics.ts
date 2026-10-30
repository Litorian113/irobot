/**
 * Counting people from the camera's messages, on the server. Only numbers per hour are kept:
 * the camera sends how many people it sees, nothing here knows who they are. So these are
 * estimates: someone lost by the camera for longer than FALL_MS and seen again counts twice.
 */

/** Stays this long: a visitor, not a passer-by. The promo screen fades in after the same time (wall.ts). */
export const VISITOR_AFTER_MS = 8000
/** A person has to be seen this long to count: one frame of a misdetection is nobody. */
const RISE_MS = 1000
/** Gone only after this long: the detector loses people for a moment. Like LINGER_MS in PersonTracker. */
const FALL_MS = 3000
/** Longer stays count as this: a misdetection that never goes away must not swallow the average. */
const MAX_DWELL_MS = 10 * 60 * 1000

export interface HourStats { passers: number; visitors: number }
export interface DayStats extends HourStats {
  /** Time visitors stayed, added up. */
  dwellMs: number
  /** 24 hours, local time of the server. */
  hours: HourStats[]
}
/** By day, `YYYY-MM-DD`. */
export type Stats = Record<string, DayStats>

const pad = (n: number) => String(n).padStart(2, '0')
export const dayKey = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`

export const emptyDay = (): DayStats => ({
  passers: 0,
  visitors: 0,
  dwellMs: 0,
  hours: Array.from({ length: 24 }, () => ({ passers: 0, visitors: 0 })),
})

export class PeopleCounter {
  /** Who is there now: when each came, and whether they count as a visitor yet. */
  private people: { since: number; visitor: boolean }[] = []
  private riseSince: number | null = null
  private riseTo = 0
  private fallSince: number | null = null
  private fallTo = 0
  private stats: Stats

  constructor(stats: Stats) {
    this.stats = stats
  }

  /** How many are in front of the wall, steadied. */
  get present() {
    return this.people.length
  }

  /** The camera sees `seen` people at `now`. Returns whether the numbers changed. */
  update(seen: number, now: number) {
    let changed = false
    const count = this.people.length
    if (seen > count) {
      this.fallSince = null
      if (this.riseSince === null) {
        this.riseSince = now
        this.riseTo = seen
      }
      this.riseTo = Math.min(this.riseTo, seen)
      if (now - this.riseSince >= RISE_MS) {
        for (let i = count; i < this.riseTo; i++) {
          this.people.push({ since: this.riseSince, visitor: false })
          this.count(now, 'passers')
        }
        this.riseSince = null
        changed = true
      }
    } else if (seen < count) {
      this.riseSince = null
      if (this.fallSince === null) {
        this.fallSince = now
        this.fallTo = seen
      }
      this.fallTo = Math.max(this.fallTo, seen)
      if (now - this.fallSince >= FALL_MS) {
        // They left when the camera stopped seeing them, not when that was believed.
        for (const person of this.people.splice(this.fallTo)) {
          if (person.visitor) this.day(now).dwellMs += Math.min(this.fallSince - person.since, MAX_DWELL_MS)
        }
        this.fallSince = null
        changed = true
      }
    } else {
      this.riseSince = null
      this.fallSince = null
    }
    for (const person of this.people) {
      if (!person.visitor && now - person.since >= VISITOR_AFTER_MS) {
        person.visitor = true
        this.count(now, 'visitors')
        changed = true
      }
    }
    return changed
  }

  private day(now: number) {
    const key = dayKey(new Date(now))
    return (this.stats[key] ??= emptyDay())
  }

  private count(now: number, what: keyof HourStats) {
    const day = this.day(now)
    day[what]++
    day.hours[new Date(now).getHours()][what]++
  }
}
