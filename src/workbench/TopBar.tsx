import { CalendarIcon, ChartIcon, SidebarIcon } from './icons'
import { TABS, type View } from './tabs'

const EXTRA_VIEWS = [
  { id: 'schedule', label: 'Zeitplan', Icon: CalendarIcon },
  { id: 'analytics', label: 'Analytics', Icon: ChartIcon },
] as const

/**
 * The bar with the tabs: on top as a segmented control on a tablet or desktop, at the
 * bottom with icons on a phone (workbench.css). Left of it, the button that folds the
 * sidebar away, where the view has one.
 */
export default function TopBar({ view, onChoose, sidebarClosed, onToggleSidebar }: {
  view: View
  onChoose: (view: View) => void
  sidebarClosed: boolean
  /** Left out where the view has no sidebar. */
  onToggleSidebar?: () => void
}) {
  return (
    <header className="topbar">
      <div className="topbar-lead">
        {onToggleSidebar && (
          <button
            type="button"
            className="sidebar-toggle"
            aria-pressed={!sidebarClosed}
            aria-label={sidebarClosed ? 'Liste der Köpfe einblenden' : 'Liste der Köpfe ausblenden'}
            title={sidebarClosed ? 'Liste einblenden' : 'Liste ausblenden'}
            onClick={onToggleSidebar}
          >
            <SidebarIcon />
          </button>
        )}
        <span className="brand">HfG Köpfe</span>
      </div>
      <nav className="tabs" role="tablist">
        {TABS.map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={view === id}
            className={view === id ? 'active' : ''}
            onClick={() => onChoose(id)}
          >
            <Icon className="tab-icon" />
            <span>{label}</span>
          </button>
        ))}
      </nav>
      <div className="topbar-actions">
        {EXTRA_VIEWS.map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            className={`analytics-button${view === id ? ' active' : ''}`}
            aria-pressed={view === id}
            aria-label={label}
            title={label}
            onClick={() => onChoose(id)}
          >
            <Icon className="tab-icon" />
            <span>{label}</span>
          </button>
        ))}
      </div>
    </header>
  )
}
