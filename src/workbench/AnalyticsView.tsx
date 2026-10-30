import { useEffect, useMemo, useState } from 'react'
import { emptyDay, type DayStats, type HourStats, type Stats } from '../analytics'
import { PageHeader, StatusLine } from './ui'

/** The page only reads: the server counts, whether or not anyone looks here. */
const REFRESH_MS = 5000

interface Report {
  days: Stats
  today: string
  present: number
  visitorAfterMs: number
}

type Range = 'today' | 'week' | 'month'
const RANGES: { id: Range; label: string; days: number }[] = [
  { id: 'today', label: 'Heute', days: 1 },
  { id: 'week', label: '7 Tage', days: 7 },
  { id: 'month', label: '30 Tage', days: 30 },
]

/** The days of a range, oldest first, the ones without a count empty. */
function daysOf(report: Report, count: number) {
  const [year, month, day] = report.today.split('-').map(Number)
  return Array.from({ length: count }, (_, i) => {
    const date = new Date(year, month - 1, day - (count - 1 - i))
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
    return { date, stats: report.days[key] ?? emptyDay() }
  })
}

const dateLabel = (date: Date) => `${date.getDate()}.${date.getMonth() + 1}.`
const number = (n: number) => n.toLocaleString('de-DE')

function duration(ms: number) {
  const seconds = Math.round(ms / 1000)
  return seconds < 60 ? `${seconds} s` : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')} min`
}

/** A clean top for the axis, and its ticks. */
function axis(largest: number) {
  const top = Math.max(largest, 4)
  const size = 10 ** Math.floor(Math.log10(top))
  const step = [1, 2, 5, 10].map((f) => (f * size) / 2).find((s) => top / s <= 4) ?? size
  const ticks = Array.from({ length: Math.ceil(top / step) + 1 }, (_, i) => i * step)
  return { top: ticks[ticks.length - 1], ticks }
}

function Tile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      {note && <span className="stat-note">{note}</span>}
    </div>
  )
}

interface Bar extends HourStats {
  /** On the axis. */
  label: string
  /** In the tooltip and the table. */
  title: string
}

/** Passers-by per hour or day: the visitors among them at the bottom, the others on top. */
function BarChart({ bars, labelEvery }: { bars: Bar[]; labelEvery: number }) {
  const [hover, setHover] = useState<number | null>(null)
  const { top, ticks } = axis(Math.max(...bars.map((bar) => bar.passers)))
  const shown = hover === null ? null : bars[hover]

  return (
    <div className="chart">
      <div className="chart-legend">
        <span><i className="chart-key visitors" />Besucher</span>
        <span><i className="chart-key others" />Nur vorbeigelaufen</span>
      </div>
      <div className="chart-plot" onPointerLeave={() => setHover(null)}>
        {ticks.map((tick) => (
          <div key={tick} className="chart-grid" style={{ bottom: `${(tick / top) * 100}%` }}>
            <span>{number(tick)}</span>
          </div>
        ))}
        <div className="chart-bars">
          {bars.map((bar, i) => (
            <button
              key={bar.title}
              type="button"
              className={`chart-column${hover === i ? ' hover' : ''}`}
              aria-label={`${bar.title}: ${bar.passers} Passanten, ${bar.visitors} Besucher`}
              onPointerEnter={() => setHover(i)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
            >
              <span className="chart-stack" style={{ height: `${(bar.passers / top) * 100}%` }}>
                {bar.passers > bar.visitors && <span className="chart-part others" style={{ flexGrow: bar.passers - bar.visitors }} />}
                {bar.visitors > 0 && <span className="chart-part visitors" style={{ flexGrow: bar.visitors }} />}
              </span>
            </button>
          ))}
        </div>
        {shown && hover !== null && (
          <div className="chart-tooltip" style={{ left: `${((hover + 0.5) / bars.length) * 100}%` }} data-side={hover > bars.length / 2 ? 'left' : 'right'}>
            <span className="chart-tooltip-title">{shown.title}</span>
            <span><b>{number(shown.visitors)}</b> Besucher</span>
            <span><b>{number(shown.passers - shown.visitors)}</b> nur vorbeigelaufen</span>
          </div>
        )}
      </div>
      <div className="chart-axis">
        {bars.map((bar, i) => <span key={bar.title}>{i % labelEvery === 0 ? bar.label : ''}</span>)}
      </div>
      <details className="chart-table">
        <summary>Als Tabelle</summary>
        <table>
          <thead><tr><th>Zeit</th><th>Passanten</th><th>Besucher</th></tr></thead>
          <tbody>
            {bars.filter((bar) => bar.passers > 0).map((bar) => (
              <tr key={bar.title}><td>{bar.title}</td><td>{number(bar.passers)}</td><td>{number(bar.visitors)}</td></tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  )
}

/** Analytics: how many walked past, and how many stayed long enough for the promo to fade in. */
export default function AnalyticsView() {
  const [report, setReport] = useState<Report | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [range, setRange] = useState<Range>('today')

  useEffect(() => {
    const load = () => fetch('/api/analytics', { cache: 'no-store' })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        return response.json() as Promise<Report>
      })
      .then((next) => {
        setReport(next)
        setError(null)
      })
      .catch((e: unknown) => setError(String(e)))
    void load()
    const timer = window.setInterval(() => void load(), REFRESH_MS)
    return () => window.clearInterval(timer)
  }, [])

  const days = useMemo(() => {
    const count = RANGES.find((r) => r.id === range)?.days ?? 1
    return report ? daysOf(report, count) : []
  }, [report, range])

  const totals = days.reduce<Pick<DayStats, 'passers' | 'visitors' | 'dwellMs'>>(
    (sum, { stats }) => ({ passers: sum.passers + stats.passers, visitors: sum.visitors + stats.visitors, dwellMs: sum.dwellMs + stats.dwellMs }),
    { passers: 0, visitors: 0, dwellMs: 0 },
  )
  const bars: Bar[] = range === 'today'
    ? (days[0]?.stats.hours ?? []).map((hour, h) => ({ ...hour, label: String(h), title: `${h}–${h + 1} Uhr` }))
    : days.map(({ date, stats }) => ({ passers: stats.passers, visitors: stats.visitors, label: dateLabel(date), title: dateLabel(date) }))

  const status = error
    ? <StatusLine tone="error" text={`Fehler beim Laden: ${error}`} />
    : <StatusLine tone="live" text={report ? `Gerade ${report.present === 1 ? '1 Person' : `${report.present} Personen`} vor der Wand` : 'Lädt …'} />
  const seconds = report ? Math.round(report.visitorAfterMs / 1000) : 0

  return (
    <div className="split">
      <main className="page">
        <PageHeader title="Analytics" status={status}>
          <div className="segmented" role="group" aria-label="Zeitraum">
            {RANGES.map(({ id, label }) => (
              <button key={id} type="button" aria-pressed={range === id} onClick={() => setRange(id)}>{label}</button>
            ))}
          </div>
        </PageHeader>

        <div className="stats">
          <Tile label="Passanten" value={number(totals.passers)} />
          <Tile label="Besucher" value={number(totals.visitors)} note={`mind. ${seconds} s geblieben`} />
          <Tile label="Blieben stehen" value={totals.passers ? `${Math.round((totals.visitors / totals.passers) * 100)} %` : '–'} />
          <Tile label="Ø Verweildauer" value={totals.visitors ? duration(totals.dwellMs / totals.visitors) : '–'} note="der Besucher" />
        </div>

        <p className="section-title">{range === 'today' ? 'Heute nach Stunden' : 'Nach Tagen'}</p>
        <div className="card">
          {bars.length > 0 && <BarChart bars={bars} labelEvery={range === 'today' ? 3 : range === 'week' ? 1 : 5} />}
        </div>

        <p className="page-hint">
          Geschätzt aus der Anzahl, die die Kamera sieht: Es werden keine Bilder und keine Personen gespeichert, nur
          Zahlen pro Stunde. Wer kurz aus dem Bild verschwindet, kann doppelt zählen. Gezählt wird, solange die Kamera
          läuft, also auch wenn die iMacs aus sind.
        </p>
      </main>
    </div>
  )
}
