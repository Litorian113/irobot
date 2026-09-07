import { COLOR_LABELS, SHAPE_GROUPS, STYLE_GROUPS, STYLES, type HeadConfig, type HeadStyle } from './viki/config'

interface Props {
  style: HeadStyle
  draft: HeadConfig
  dirty: boolean
  testSpeech: boolean
  onChange: (patch: Partial<HeadConfig>) => void
  onTestSpeech: (on: boolean) => void
  onSave: () => void
  onReset: () => void
  onClose: () => void
}

const COLOR_KEYS: (keyof HeadConfig)[] = ['colorA', 'colorB', 'colorC']

export default function ConfigPanel({ style, draft, dirty, testSpeech, onChange, onTestSpeech, onSave, onReset, onClose }: Props) {
  const meta = STYLES.find((s) => s.id === style)
  const groups = [STYLE_GROUPS[style], ...SHAPE_GROUPS]
  return (
    <aside className="config" aria-label="Head configuration">
      <header className="config-head">
        <div>
          <h2>{meta?.label ?? 'Configure'}</h2>
          <p>{meta?.hint}. Changes preview live; Save keeps them for this head, Reset returns to its standard look.</p>
        </div>
        <button type="button" className="btn ghost small" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </header>

      <div className="config-body">
        <section>
          <h3>Colors</h3>
          <div className="colors">
            {COLOR_KEYS.map((key, i) => (
              <label key={key} className="color">
                <input type="color" value={draft[key] as string} onChange={(e) => onChange({ [key]: e.target.value })} />
                <span>{COLOR_LABELS[style][i]}</span>
              </label>
            ))}
          </div>
        </section>

        <section>
          <h3>Lighting</h3>
          <div className="lighting-options" role="group" aria-label="Lighting preset">
            {([
              ['soft', 'Soft portrait', 30, 0.20],
              ['cinema', 'Cinema', 45, 0.035],
              ['butterfly', 'Butterfly', 35, 0.10],
              ['viki', 'VIKI shadows', 50, 0.008],
            ] as const).map(([lighting, label, lightElevation, lightFill]) => (
              <button key={lighting} type="button" className="btn ghost small" aria-pressed={draft.lighting === lighting}
                onClick={() => onChange({ lighting, lightElevation, lightFill })}>{label}</button>
            ))}
          </div>
        </section>

        {groups.map((group) => (
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
