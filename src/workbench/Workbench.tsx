import { useState } from 'react'
import AnalyticsView from './AnalyticsView'
import LiveView from './LiveView'
import Studio from './Studio'
import { TABS, type View } from './tabs'
import TopBar from './TopBar'
import WallEditor from './WallEditor'
import './workbench.css'

/** Whether the sidebar beside Köpfe and Gestalten is folded away; remembered in this browser only. */
const SIDEBAR_KEY = 'hfg-sidebar-closed'

function initialView(): View {
  const param = new URLSearchParams(window.location.search).get('view')
  // `?view=wall` was the old all-screens tab; the Live tab took its place.
  const view = param === 'wall' ? 'live' : param
  // On a phone (from the QR code in the WLAN) the wall editor first, not a 3D head.
  const phone = window.matchMedia('(max-width: 720px)').matches
  if (view === 'analytics') return view
  return TABS.find((tab) => tab.id === view)?.id ?? (phone ? 'custom' : 'heads')
}

function initialSidebarClosed() {
  try {
    return window.localStorage.getItem(SIDEBAR_KEY) === '1'
  } catch {
    return false
  }
}

/** The working page: look at the heads, build the wall, watch it live - one WebGL page at a time. */
export default function Workbench() {
  const [view, setView] = useState<View>(initialView)
  const [sidebarClosed, setSidebarClosed] = useState(initialSidebarClosed)

  const choose = (next: View) => {
    setView(next)
    const url = new URL(window.location.href)
    url.searchParams.set('view', next)
    window.history.replaceState(null, '', url)
  }

  const toggleSidebar = () => {
    const closed = !sidebarClosed
    setSidebarClosed(closed)
    try {
      window.localStorage.setItem(SIDEBAR_KEY, closed ? '1' : '0')
    } catch {
      /* private window: just not remembered */
    }
  }

  return (
    <div className={`app view-${view}${sidebarClosed ? ' sidebar-closed' : ''}`}>
      <TopBar
        view={view}
        onChoose={choose}
        sidebarClosed={sidebarClosed}
        onToggleSidebar={view === 'heads' || view === 'custom' ? toggleSidebar : undefined}
      />
      <div className="app-content">
        {view === 'heads' && <Studio />}
        {view === 'custom' && <WallEditor onShowLive={() => choose('live')} />}
        {view === 'live' && <LiveView onEdit={() => choose('custom')} />}
        {view === 'analytics' && <AnalyticsView />}
      </div>
    </div>
  )
}
