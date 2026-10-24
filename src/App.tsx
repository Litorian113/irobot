import CustomWallLive from './CustomWallLive'
import SnapshotView from './SnapshotView'
import WallView from './WallView'
import { SCREENS, SETTINGS } from './wall'
import Workbench from './workbench/Workbench'

const SNAPSHOT = new URLSearchParams(window.location.search).get('snapshot')

export default function App() {
  if (SNAPSHOT) return <SnapshotView entryKey={SNAPSHOT} />
  // `?wall=custom`: the wall built in the editor, whole (no slot) or one screen of it.
  if (SETTINGS.wallSet === 'custom') return <CustomWallLive slot={SETTINGS.slot} />
  // `?slot=N`: one screen of the wall, as the iMacs open it - no tabs.
  return SETTINGS.slot === null
    ? <Workbench />
    : <WallView slot={SETTINGS.slot} rows={SCREENS[SETTINGS.wallSet]} />
}
