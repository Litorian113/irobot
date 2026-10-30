import type { ComponentType } from 'react'
import { HeadsIcon, LiveIcon, WallIcon } from './icons'

/** The views of the working page; `?view=` in the link opens one. */
export type View = 'heads' | 'custom' | 'live' | 'analytics'

/** Analytics is not among them: its button sits apart, top right (TopBar). */
export const TABS: { id: View; label: string; Icon: ComponentType<{ className?: string }> }[] = [
  { id: 'heads', label: 'Köpfe', Icon: HeadsIcon },
  { id: 'custom', label: 'Gestalten', Icon: WallIcon },
  { id: 'live', label: 'Live', Icon: LiveIcon },
]
