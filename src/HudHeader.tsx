interface Props {
  title: string
  subtitle: string
  statusClass: string
  statusLabel: string
  configOpen: boolean
  onConfigure: () => void
}

/** Brand banner, status lamp and the Configure button. */
export default function HudHeader({ title, subtitle, statusClass, statusLabel, configOpen, onConfigure }: Props) {
  return (
    <header className="hud-top">
      <div className="brand">
        <span className="brand-name">{title}</span>
        <span className="brand-sub">{subtitle}</span>
      </div>
      <div className="actions">
        <div className={`status status-${statusClass}`}>
          <span className="dot" />
          {statusLabel}
        </div>
        {!configOpen && (
          <button type="button" className="btn ghost small" onClick={onConfigure}>
            Configure
          </button>
        )}
      </div>
    </header>
  )
}
