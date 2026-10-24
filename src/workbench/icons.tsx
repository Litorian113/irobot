import type { ReactNode } from 'react'

/** Line icons drawn like SF Symbols, on a 24 x 24 grid, stroked in the current colour. */
function Icon({ children, className }: { children: ReactNode; className?: string }) {
  return <svg className={className} viewBox="0 0 24 24" aria-hidden="true">{children}</svg>
}

export const HeadsIcon = ({ className }: { className?: string }) => (
  <Icon className={className}>
    <circle cx="12" cy="8.5" r="4.2" />
    <path d="M4.5 20.5c1.1-3.9 4.1-6 7.5-6s6.4 2.1 7.5 6" />
  </Icon>
)

export const WallIcon = ({ className }: { className?: string }) => (
  <Icon className={className}>
    <rect x="3" y="4" width="8" height="6.5" rx="1.6" />
    <rect x="13" y="4" width="8" height="6.5" rx="1.6" />
    <rect x="3" y="13.5" width="8" height="6.5" rx="1.6" />
    <rect x="13" y="13.5" width="8" height="6.5" rx="1.6" />
  </Icon>
)

export const LiveIcon = ({ className }: { className?: string }) => (
  <Icon className={className}>
    <circle cx="12" cy="12" r="2" />
    <path d="M8.3 8.3a5.2 5.2 0 0 0 0 7.4M15.7 8.3a5.2 5.2 0 0 1 0 7.4M5.5 5.5a9.2 9.2 0 0 0 0 13M18.5 5.5a9.2 9.2 0 0 1 0 13" />
  </Icon>
)

export const SidebarIcon = ({ className }: { className?: string }) => (
  <Icon className={className}>
    <rect x="3" y="4.5" width="18" height="15" rx="3" />
    <path d="M9.5 4.5v15M5.8 8.5h1.4M5.8 11h1.4M5.8 13.5h1.4" />
  </Icon>
)

export const PencilIcon = ({ className }: { className?: string }) => (
  <Icon className={className}>
    <path d="M14.5 5.5l4 4M4 20l1-4.5L15.8 4.7a1.8 1.8 0 0 1 2.5 0l1 1a1.8 1.8 0 0 1 0 2.5L8.5 19z" />
  </Icon>
)

export const CheckIcon = ({ className }: { className?: string }) => (
  <Icon className={className}>
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </Icon>
)

export const CloseIcon = ({ className }: { className?: string }) => (
  <Icon className={className}>
    <path d="M7 7l10 10M17 7L7 17" />
  </Icon>
)

export const PlusIcon = ({ className }: { className?: string }) => (
  <Icon className={className}>
    <path d="M12 5v14M5 12h14" />
  </Icon>
)
