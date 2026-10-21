import { useState } from 'react'
import Studio from './Studio'
import WallView from './WallView'
import { SETTINGS } from './wall'

type View = 'heads' | 'wall'

const TABS: { id: View; label: string }[] = [
  { id: 'heads', label: 'Köpfe' },
  { id: 'wall', label: 'Wand' },
]

function initialView(): View {
  return new URLSearchParams(window.location.search).get('view') === 'wall' ? 'wall' : 'heads'
}

/** Working page: one head at a time, or the whole wall with camera - never both. */
function Workbench() {
  const [view, setView] = useState<View>(initialView)

  const choose = (next: View) => {
    setView(next)
    const url = new URL(window.location.href)
    url.searchParams.set('view', next)
    window.history.replaceState(null, '', url)
  }

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">HfG Köpfe</span>
        <nav className="tabs" role="tablist">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={view === tab.id}
              className={view === tab.id ? 'active' : ''}
              onClick={() => choose(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </header>
      <div className="app-content">{view === 'heads' ? <Studio /> : <WallView slot={null} />}</div>
    </div>
  )
}

export default function App() {
  // `?slot=N`: one screen of the wall, as the iMacs open it - no tabs.
  return SETTINGS.slot === null ? <Workbench /> : <WallView slot={SETTINGS.slot} />
}
