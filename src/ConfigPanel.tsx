import { COLOR_KEYS, SLIDER_GROUPS, type HeadConfig } from './viki/config'

interface Props {
  draft: HeadConfig
  dirty: boolean
  testSpeech: boolean
  onChange: (patch: Partial<HeadConfig>) => void
  onTestSpeech: (on: boolean) => void
  onSave: () => void
  onReset: () => void
  onClose: () => void
}

export default function ConfigPanel({ draft, dirty, testSpeech, onChange, onTestSpeech, onSave, onReset, onClose }: Props) {
  return (
    <aside className="config" aria-label="Head configuration">
      <header className="config-head">
        <div>
          <h2>Configure</h2>
          <p>Shape her while she is active. Save keeps it, Reset returns to the standard look.</p>
        </div>
        <button type="button" className="btn ghost small" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </header>

      <div className="config-body">
        <section>
          <h3>Colors</h3>
          <div className="colors">
            {COLOR_KEYS.map(({ key, label }) => (
              <label key={key} className="color">
                <input type="color" value={draft[key] as string} onChange={(e) => onChange({ [key]: e.target.value })} />
                <span>{label}</span>
              </label>
            ))}
          </div>
        </section>

        {SLIDER_GROUPS.map((group) => (
          <section key={group.title}>
            <h3>{group.title}</h3>
            {group.sliders.map((s) => {
              const value = draft[s.key] as number
              return (
                <label key={s.key} className="slider">
                  <span className="slider-label">{s.label}</span>
                  <input
                    type="range"
                    min={s.min}
                    max={s.max}
                    step={s.step}
                    value={value}
                    onChange={(e) => onChange({ [s.key]: Number(e.target.value) })}
                  />
                  <span className="slider-value">{value.toFixed(s.step < 0.01 ? 3 : 2)}</span>
                </label>
              )
            })}
          </section>
        ))}

        <section>
          <h3>Behaviour</h3>
          <label className="check">
            <input type="checkbox" checked={draft.autoReturn} onChange={(e) => onChange({ autoReturn: e.target.checked })} />
            <span>Turn back to the front after dragging</span>
          </label>
          <label className="check">
            <input type="checkbox" checked={testSpeech} onChange={(e) => onTestSpeech(e.target.checked)} />
            <span>Test speech (animate the mouth)</span>
          </label>
        </section>
      </div>

      <footer className="config-foot">
        <button type="button" className="btn ghost" onClick={onReset}>
          Reset to standard
        </button>
        <button type="button" className="btn" onClick={onSave} disabled={!dirty}>
          {dirty ? 'Save' : 'Saved'}
        </button>
      </footer>
    </aside>
  )
}
