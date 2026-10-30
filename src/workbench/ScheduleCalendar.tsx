import { useState } from 'react'
import { type Schedule, type ScheduleException } from '../schedule'

const WEEKDAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']
const pad = (n: number) => String(n).padStart(2, '0')
const dayKey = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
const dayLabel = (day: string) => {
  const [year, month, date] = day.split('-').map(Number)
  return new Date(year, month - 1, date).toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'numeric', year: 'numeric' })
}

/** The days to show for a month: whole weeks, Monday first. */
function weeksOf(year: number, month: number) {
  const first = new Date(year, month, 1)
  const lead = (first.getDay() + 6) % 7
  const count = Math.ceil((lead + new Date(year, month + 1, 0).getDate()) / 7) * 7
  return Array.from({ length: count }, (_, i) => new Date(year, month, 1 + i - lead))
}

/**
 * Choose a span of days in a calendar: first click the first day, then the last, then the time on
 * each of the two. It becomes an exception of the schedule; the days of existing ones are marked.
 */
export default function ScheduleCalendar({ schedule, onAdd }: { schedule: Schedule; onAdd: (exception: ScheduleException) => void }) {
  const today = new Date()
  const todayKey = dayKey(today)
  const [shown, setShown] = useState({ year: today.getFullYear(), month: today.getMonth() })
  const [start, setStart] = useState<string | null>(null)
  const [end, setEnd] = useState<string | null>(null)
  const [kind, setKind] = useState<ScheduleException['kind']>('on')
  const [fromTime, setFromTime] = useState(schedule.week.on)
  const [toTime, setToTime] = useState(schedule.week.off)
  const [note, setNote] = useState('')

  const choose = (day: string) => {
    if (start === null || end !== null) {
      setStart(day)
      setEnd(null)
    } else if (day < start) {
      setEnd(start)
      setStart(day)
    } else {
      setEnd(day)
    }
  }
  const changeKind = (next: ScheduleException['kind']) => {
    setKind(next)
    // Off means whole days as a rule; on means the usual evening.
    setFromTime(next === 'off' ? '00:00' : schedule.week.on)
    setToTime(next === 'off' ? '23:59' : schedule.week.off)
  }
  const move = (by: number) => setShown(({ year, month }) => {
    const next = new Date(year, month + by, 1)
    return { year: next.getFullYear(), month: next.getMonth() }
  })

  const last = end ?? start
  const from = start && `${start}T${fromTime}`
  const to = last && `${last}T${toTime}`
  const ready = Boolean(from && to && fromTime && toTime && from < to)
  const marks = (day: string) => schedule.exceptions.filter((e) => e.from.slice(0, 10) <= day && day <= e.to.slice(0, 10))

  const add = () => {
    if (!from || !to || !ready) return
    onAdd({ kind, from, to, note: note.trim() })
    setStart(null)
    setEnd(null)
    setNote('')
  }

  return (
    <div className="schedule-card schedule-calendar">
      <div className="calendar">
        <div className="calendar-head">
          <button type="button" aria-label="Monat zurück" onClick={() => move(-1)}>‹</button>
          <strong>{new Date(shown.year, shown.month, 1).toLocaleDateString('de-DE', { month: 'long', year: 'numeric' })}</strong>
          <button type="button" aria-label="Monat vor" onClick={() => move(1)}>›</button>
        </div>
        <div className="calendar-grid" role="grid">
          {WEEKDAYS.map((day) => <span key={day} className="calendar-weekday">{day}</span>)}
          {weeksOf(shown.year, shown.month).map((date) => {
            const day = dayKey(date)
            const inRange = start !== null && last !== null && start <= day && day <= last
            const edge = day === start || day === last
            const found = marks(day)
            const className = [
              'calendar-day',
              date.getMonth() !== shown.month && 'other',
              day === todayKey && 'today',
              inRange && 'range',
              edge && 'edge',
            ].filter(Boolean).join(' ')
            return (
              <button key={day} type="button" className={className} aria-pressed={inRange} aria-label={dayLabel(day)} onClick={() => choose(day)}>
                {date.getDate()}
                {found.length > 0 && <i className={`calendar-mark ${found[found.length - 1].kind}`} />}
              </button>
            )
          })}
        </div>
        <p className="schedule-note"><i className="calendar-mark on" /> Ausnahme an <i className="calendar-mark off" /> Ausnahme aus</p>
      </div>

      <div className="calendar-form">
        <p className="calendar-span">
          {start === null ? 'Ersten Tag anklicken.' : end === null ? `${dayLabel(start)}: Jetzt den letzten Tag anklicken (oder denselben noch einmal).` : `${dayLabel(start)} bis ${dayLabel(end)}`}
        </p>
        <label className="schedule-field">
          Wand
          <select value={kind} onChange={(e) => changeKind(e.target.value as ScheduleException['kind'])}>
            <option value="on">an</option>
            <option value="off">aus</option>
          </select>
        </label>
        <div className="calendar-times">
          <label className="schedule-field">
            {start ? `Erster Tag (${start.slice(8)}.${start.slice(5, 7)}.), ab` : 'Erster Tag, ab'}
            <input type="time" value={fromTime} onChange={(e) => setFromTime(e.target.value)} />
          </label>
          <label className="schedule-field">
            {last ? `Letzter Tag (${last.slice(8)}.${last.slice(5, 7)}.), bis` : 'Letzter Tag, bis'}
            <input type="time" value={toTime} onChange={(e) => setToTime(e.target.value)} />
          </label>
        </div>
        <label className="schedule-field">
          Notiz
          <input type="text" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <button type="button" className="page-button calendar-add" disabled={!ready} onClick={add}>Als Ausnahme übernehmen</button>
        {start !== null && (
          <button type="button" className="calendar-reset" onClick={() => { setStart(null); setEnd(null) }}>Auswahl löschen</button>
        )}
      </div>
    </div>
  )
}
