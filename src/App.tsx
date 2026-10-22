import { useState } from 'react'
import CustomWallEditor from './CustomWallEditor'
import CustomWallLive from './CustomWallLive'
import SnapshotView from './SnapshotView'
import Studio from './Studio'
import WallView from './WallView'
import { SCREENS, SETTINGS } from './wall'

type View = 'heads' | 'wall' | 'halloween' | 'custom'

const TABS: { id: View; label: string }[] = [
  { id: 'heads', label: 'Köpfe' },
  { id: 'wall', label: 'Wand' },
  { id: 'halloween', label: 'Halloween' },
  { id: 'custom', label: 'Eigene Wand' },
]

const SNAPSHOT = new URLSearchParams(window.location.search).get('snapshot')

function initialView(): View {
  const view = new URLSearchParams(window.location.search).get('view')
  return TABS.find((tab) => tab.id === view)?.id ?? 'heads'
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
      <div className="app-content">
        {view === 'heads' && <Studio />}
        {view === 'custom' && <CustomWallEditor />}
        {(view === 'wall' || view === 'halloween') && (
          <WallView key={view} slot={null} screens={SCREENS[view === 'halloween' ? 'halloween' : 'main']} />
        )}
      </div>
    </div>
  )
}

export default function App() {
  if (SNAPSHOT) return <SnapshotView entryKey={SNAPSHOT} />
  // `?wall=custom`: the wall built in the editor, whole (no slot) or one screen of it.
  if (SETTINGS.wallSet === 'custom') return <CustomWallLive slot={SETTINGS.slot} />
  // `?slot=N`: one screen of the wall, as the iMacs open it - no tabs.
  return SETTINGS.slot === null
    ? <Workbench />
    : <WallView slot={SETTINGS.slot} screens={SCREENS[SETTINGS.wallSet]} />
}
