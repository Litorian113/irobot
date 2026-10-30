/**
 * When the wall runs: a week, and exceptions to it. Lives in walls/schedule.json on the server, edited on the
 * Zeitplan page. The iMacs cannot be woken over the network, so everything has to be programmed into them while
 * they are on: `imacsProgram` says what, and scripts/windows/plan.ps1 hands it to scripts/imacs.sh program.
 * All times are local time of the server.
 */

export interface Week {
  /** `HH:MM`. A little before the wall should be seen: an iMac takes about five minutes to start. */
  on: string
  off: string
  /** Letters as in pmset: `MTWRFSU`, Monday first. */
  days: string
}

export interface ScheduleException {
  /** `on`: runs through this time, whatever the week says. `off`: stays off. */
  kind: 'on' | 'off'
  /** `YYYY-MM-DDTHH:MM`, as a datetime field gives them. */
  from: string
  to: string
  note: string
}

export interface Schedule {
  week: Week
  exceptions: ScheduleException[]
}

export const DAYS = 'MTWRFSU'

export const DEFAULT_SCHEDULE: Schedule = {
  week: { on: '16:55', off: '21:30', days: 'MTWRF' },
  exceptions: [{ kind: 'off', from: '2026-12-23T00:00', to: '2027-01-06T23:59', note: 'Weihnachten und Neujahr' }],
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/
const DATE_TIME = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T([01]\d|2[0-3]):[0-5]\d$/
/** How far ahead to look for the next change. */
const HORIZON_DAYS = 400

const pad = (n: number) => String(n).padStart(2, '0')
const dateOf = (at: string) => {
  const [day, time] = at.split('T')
  const [year, month, date] = day.split('-').map(Number)
  const [hour, minute] = time.split(':').map(Number)
  return new Date(year, month - 1, date, hour, minute)
}
export const formatDateTime = (date: Date) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`

/** What goes into the file and, from there, into a command line: only exactly these forms. */
export function isSchedule(value: unknown): value is Schedule {
  const schedule = value as Schedule | null
  if (!schedule || typeof schedule !== 'object' || !Array.isArray(schedule.exceptions)) return false
  const { on, off, days } = schedule.week ?? {}
  if (typeof on !== 'string' || typeof off !== 'string' || !TIME.test(on) || !TIME.test(off) || on >= off) return false
  if (typeof days !== 'string' || days.length > 7 || [...days].some((d, i) => !DAYS.includes(d) || days.indexOf(d) !== i)) return false
  return schedule.exceptions.every((e) =>
    (e?.kind === 'on' || e?.kind === 'off')
    && typeof e.from === 'string' && DATE_TIME.test(e.from)
    && typeof e.to === 'string' && DATE_TIME.test(e.to)
    && e.from < e.to
    && typeof e.note === 'string' && e.note.length <= 200)
}

/** Monday is `M`, as in pmset. */
const letterOf = (date: Date) => DAYS[(date.getDay() + 6) % 7]
const at = (date: Date, time: string) => {
  const [hour, minute] = time.split(':').map(Number)
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour, minute)
}

/** The week alone: is this a time it runs? */
function weekRuns(week: Week, date: Date) {
  return week.days.includes(letterOf(date)) && date >= at(date, week.on) && date < at(date, week.off)
}

/** Should the wall be on? Where exceptions overlap, the one that started last counts. */
export function isOn(schedule: Schedule, date: Date) {
  const time = formatDateTime(date)
  const active = schedule.exceptions
    .filter((e) => e.from <= time && time < e.to)
    .sort((a, b) => a.from.localeCompare(b.from))
    .pop()
  return active ? active.kind === 'on' : weekRuns(schedule.week, date)
}

/** Each moment the wall switches after `from`, in order. */
export function changes(schedule: Schedule, from: Date, limit = 6) {
  const candidates = new Set<number>()
  for (const e of schedule.exceptions) {
    candidates.add(dateOf(e.from).getTime())
    candidates.add(dateOf(e.to).getTime())
  }
  for (let d = 0; d <= HORIZON_DAYS; d++) {
    const day = new Date(from.getFullYear(), from.getMonth(), from.getDate() + d)
    if (!schedule.week.days.includes(letterOf(day))) continue
    candidates.add(at(day, schedule.week.on).getTime())
    candidates.add(at(day, schedule.week.off).getTime())
  }
  const found: { at: Date; on: boolean }[] = []
  let state = isOn(schedule, from)
  for (const time of [...candidates].filter((t) => t > from.getTime()).sort((a, b) => a - b)) {
    const on = isOn(schedule, new Date(time))
    if (on === state) continue
    state = on
    found.push({ at: new Date(time), on })
    if (found.length >= limit) break
  }
  return found
}

/** The next time the week alone would reach `time` after `from`. */
function nextOfWeek(week: Week, time: string, from: Date) {
  for (let d = 0; d <= 8; d++) {
    const day = new Date(from.getFullYear(), from.getMonth(), from.getDate() + d)
    if (week.days.includes(letterOf(day)) && at(day, time) > from) return at(day, time)
  }
  return null
}

/**
 * The arguments for `imacs.sh program`: the week as repeating events, wherever it is what happens next, and
 * the next switch as a single event where an exception changes it. Only ever the next on and the next off:
 * the server programs the iMacs again whenever they are on.
 */
export function imacsProgram(schedule: Schedule, now: Date) {
  const { week } = schedule
  const upcoming = changes(schedule, now, 4)
  const nextOn = upcoming.find((c) => c.on)?.at ?? null
  const nextOff = upcoming.find((c) => !c.on)?.at ?? null
  const weekOn = nextOfWeek(week, week.on, now)
  const weekOff = nextOfWeek(week, week.off, now)
  // The week's shutdown must not fire in the middle of an exception that keeps the wall on.
  const repeatOff = weekOff !== null && !isOn(schedule, weekOff)
  const repeatOn = weekOn !== null && nextOn?.getTime() === weekOn.getTime()
  const onceOn = nextOn && !repeatOn ? formatDateTime(nextOn) : '-'
  const onceOff = nextOff && !(repeatOff && nextOff.getTime() === weekOff?.getTime()) ? formatDateTime(nextOff) : '-'
  return `program ${repeatOn ? week.on : '-'} ${repeatOff ? week.off : '-'} ${week.days || '-'} ${onceOn} ${onceOff}`
}
