import { useEffect, useMemo, useState } from 'react'
import { DAYS, formatDateTime, isSchedule, type Schedule, type ScheduleException } from '../schedule'
import ScheduleCalendar from './ScheduleCalendar'
import { PageButton, PageHeader, SaveBar, StatusLine, type Tone } from './ui'

const DAY_LABELS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']

interface Report {
  schedule: Schedule
  on: boolean
  changes: { at: number; on: boolean }[]
  command: string
  applied: { command: string; at: string } | null
}

const when = (at: number | Date) => new Date(at).toLocaleString('de-DE', {
  weekday: 'short', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit',
})

/** A new exception: tonight until tomorrow morning, or all of tomorrow. */
function newException(kind: ScheduleException['kind']): ScheduleException {
  const now = new Date()
  const from = new Date(now.getFullYear(), now.getMonth(), now.getDate() + (kind === 'off' ? 1 : 0), kind === 'off' ? 0 : now.getHours() + 1)
  const to = kind === 'off'
    ? new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 23, 59)
    : new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 6)
  return { kind, from: formatDateTime(from), to: formatDateTime(to), note: '' }
}

/** See and change when the wall runs. Stored on the server; the iMacs get it from there (scripts/windows/plan.ps1). */
export default function ScheduleView() {
  const [report, setReport] = useState<Report | null>(null)
  const [draft, setDraft] = useState<Schedule | null>(null)
  const [error, setError] = useState<string | null>(null)

  const take = (next: Report) => {
    setReport(next)
    setDraft(next.schedule)
    setError(null)
  }

  useEffect(() => {
    let stale = false
    const refresh = () => {
      fetch('api/schedule', { cache: 'no-store' })
        .then((r) => r.json() as Promise<Report>)
        .then((next) => {
          if (stale) return
          setReport(next)
          // What someone is typing here stays; only an untouched page follows the server.
          setDraft((current) => current ?? next.schedule)
        })
        .catch(() => { if (!stale) setError('Der Server antwortet nicht.') })
    }
    refresh()
    const timer = window.setInterval(refresh, 15000)
    return () => {
      stale = true
      window.clearInterval(timer)
    }
  }, [])

  const dirty = useMemo(() => Boolean(report && draft && JSON.stringify(report.schedule) !== JSON.stringify(draft)), [report, draft])
  const valid = draft !== null && isSchedule(draft)

  if (!report || !draft) {
    return <div className="split"><main className="page"><PageHeader title="Zeitplan" status={<StatusLine tone={error ? 'error' : null} text={error ?? 'Lädt …'} />} /></main></div>
  }

  const save = () => {
    fetch('api/schedule', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ schedule: draft }) })
      .then(async (r) => {
        if (!r.ok) throw new Error('Nicht gespeichert: Bitte die Zeiten prüfen.')
        take(await r.json() as Report)
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'Nicht gespeichert.'))
  }

  const setWeek = (change: Partial<Schedule['week']>) => setDraft({ ...draft, week: { ...draft.week, ...change } })
  const toggleDay = (letter: string) => {
    const chosen = draft.week.days.includes(letter) ? draft.week.days.replace(letter, '') : draft.week.days + letter
    setWeek({ days: [...DAYS].filter((d) => chosen.includes(d)).join('') })
  }
  const setException = (index: number, change: Partial<ScheduleException>) => setDraft({
    ...draft,
    exceptions: draft.exceptions.map((exception, i) => (i === index ? { ...exception, ...change } : exception)),
  })
  const addException = (kind: ScheduleException['kind']) => setDraft({ ...draft, exceptions: [...draft.exceptions, newException(kind)] })
  const removeException = (index: number) => setDraft({ ...draft, exceptions: draft.exceptions.filter((_, i) => i !== index) })

  const next = report.changes[0]
  const programmed = report.applied?.command === report.command
  const tone: Tone = error ? 'error' : dirty ? 'dirty' : 'live'
  const statusText = error ?? (dirty
    ? valid ? 'Nicht gespeichert' : 'Bitte die Zeiten prüfen: Der Beginn muss vor dem Ende liegen.'
    : `Wand gerade ${report.on ? 'an' : 'aus'}${next ? `, ${next.on ? 'an' : 'aus'} ab ${when(next.at)}` : ''}`)
  const now = formatDateTime(new Date())

  return (
    <div className="split">
      <main className="page">
        <PageHeader title="Zeitplan" status={<StatusLine tone={tone} text={statusText} />} />

        <section className="schedule-section">
          <h3>Woche</h3>
          <div className="schedule-card">
            <div className="schedule-fields">
              <label className="schedule-field">
                An
                <input type="time" value={draft.week.on} onChange={(e) => setWeek({ on: e.target.value })} />
              </label>
              <label className="schedule-field">
                Aus
                <input type="time" value={draft.week.off} onChange={(e) => setWeek({ off: e.target.value })} />
              </label>
              <div className="schedule-field">
                Tage
                <div className="schedule-days" role="group" aria-label="Wochentage">
                  {[...DAYS].map((letter, i) => (
                    <button key={letter} type="button" aria-pressed={draft.week.days.includes(letter)} onClick={() => toggleDay(letter)}>{DAY_LABELS[i]}</button>
                  ))}
                </div>
              </div>
            </div>
            <p className="schedule-note">Ein iMac braucht rund 5 Minuten zum Starten: Bei 16:55 läuft die Wand gegen 17:00.</p>
          </div>
        </section>

        <section className="schedule-section">
          <h3>Zeitraum wählen</h3>
          <ScheduleCalendar schedule={draft} onAdd={(exception) => setDraft({ ...draft, exceptions: [...draft.exceptions, exception] })} />
        </section>

        <section className="schedule-section">
          <h3>Ausnahmen</h3>
          <div className="schedule-card">
            {draft.exceptions.length === 0 && <p className="schedule-empty">Keine Ausnahmen.</p>}
            {draft.exceptions.map((exception, i) => (
              <div className={`schedule-exception${exception.to <= now ? ' past' : ''}`} key={i}>
                <label className="schedule-field">
                  Wand
                  <select value={exception.kind} onChange={(e) => setException(i, { kind: e.target.value as ScheduleException['kind'] })}>
                    <option value="on">an</option>
                    <option value="off">aus</option>
                  </select>
                </label>
                <label className="schedule-field">
                  Von
                  <input type="datetime-local" value={exception.from} onChange={(e) => setException(i, { from: e.target.value })} />
                </label>
                <label className="schedule-field">
                  Bis
                  <input type="datetime-local" value={exception.to} onChange={(e) => setException(i, { to: e.target.value })} />
                </label>
                <label className="schedule-field">
                  Notiz
                  <input type="text" maxLength={200} value={exception.note} onChange={(e) => setException(i, { note: e.target.value })} />
                </label>
                <button type="button" className="schedule-remove" aria-label="Ausnahme löschen" title="Löschen" onClick={() => removeException(i)}>×</button>
              </div>
            ))}
            <div className="schedule-add">
              <PageButton label="Länger an" phone={false} className="page-button" onClick={() => addException('on')} />
              <PageButton label="Aus lassen" phone={false} className="page-button" onClick={() => addException('off')} />
            </div>
          </div>
        </section>

        <section className="schedule-section">
          <h3>Nächste Schaltzeiten</h3>
          <div className="schedule-card">
            {report.changes.length === 0
              ? <p className="schedule-empty">Keine geplant.</p>
              : (
                <ul className="schedule-next">
                  {report.changes.map((change) => (
                    <li key={change.at}><i className={`schedule-dot${change.on ? ' on' : ''}`} />{when(change.at)}: {change.on ? 'an' : 'aus'}</li>
                  ))}
                </ul>
              )}
            <p className="schedule-note">
              {programmed
                ? 'Die iMacs sind so eingestellt.'
                : 'Noch nicht auf den iMacs. Sind sie an, passiert das innerhalb von 2 Minuten, sonst beim nächsten Einschalten. Ein ausgeschalteter iMac wird erst zur alten Zeit wach.'}
            </p>
          </div>
        </section>
      </main>
      <SaveBar show={dirty && valid} onSave={save} onDiscard={() => { setDraft(report.schedule); setError(null) }} />
    </div>
  )
}
