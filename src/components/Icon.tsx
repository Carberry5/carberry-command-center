import type { CSSProperties } from 'react'

/** Single-path line icon, matching the design's 24×24 stroke set. */
export function Icon({
  d,
  size = 24,
  color = 'currentColor',
  strokeWidth = 2,
  fill = 'none',
  style,
}: {
  d: string
  size?: number
  color?: string
  strokeWidth?: number
  fill?: string
  style?: CSSProperties
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={fill}
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={style}
    >
      <path d={d} />
    </svg>
  )
}

/** Solid star — the currency of the whole chore chart. */
export function Star({ size = 14, color = '#7C5CE0' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
      <path d="M12 3.5l2.4 5 5.4.7-4 3.8 1 5.4-4.8-2.6-4.8 2.6 1-5.4-4-3.8 5.4-.7z" />
    </svg>
  )
}

export function LockIcon({ open, size = 20 }: { open: boolean; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="6" y="11" width="12" height="9" rx="2.2" />
      <path d={open ? 'M9 11V8a3 3 0 0 1 5.8-1' : 'M9 11V8a3 3 0 0 1 6 0v3'} />
    </svg>
  )
}

export function MicIcon({ size = 21, color = 'currentColor' }: { size?: number; color?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="9.5" y="3.5" width="5" height="10.5" rx="2.5" />
      <path d="M6.5 11.5a5.5 5.5 0 0 0 11 0M12 17.5V21" />
    </svg>
  )
}

/** Paths used in more than one place. */
export const PATHS = {
  paperPlane: 'M22 2 11 13M22 2l-7 20-4-9-9-4z',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7.5V12l3 2',
  sparkle:
    'M12 4l1.5 4.5L18 10l-4.5 1.5L12 16l-1.5-4.5L6 10l4.5-1.5zM18.5 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z',
  dropOff:
    'M5.5 20a1.7 1.7 0 1 0 0-3.4 1.7 1.7 0 0 0 0 3.4zM18.5 20a1.7 1.7 0 1 0 0-3.4 1.7 1.7 0 0 0 0 3.4zM3 18.2V13l2-4.6A1.6 1.6 0 0 1 6.5 7.5h7a1.6 1.6 0 0 1 1.5 1L17 13h4v5.2M7.5 18.2h9M3.8 13h12.7',
  pickUp:
    'M5.5 20a1.7 1.7 0 1 0 0-3.4 1.7 1.7 0 0 0 0 3.4zM18.5 20a1.7 1.7 0 1 0 0-3.4 1.7 1.7 0 0 0 0 3.4zM3 18.2V13l2-4.6A1.6 1.6 0 0 1 6.5 7.5h7a1.6 1.6 0 0 1 1.5 1L17 13h4v5.2M7.5 18.2h9M12 1.5v4M10.2 3.7L12 5.5l1.8-1.8',
  dollar: 'M12 2.5v19M17 6.5h-7.5a3 3 0 0 0 0 6h5a3 3 0 0 1 0 6H7',
  key: 'M15.5 3.5a5 5 0 1 0-4.4 7.4L9.5 12.5 3.5 18.5v2h2l6-6 1.6-1.6a5 5 0 0 0 2.4-9.4zM16.2 7.8h.02',
}

export const NAV_ICONS: Record<string, string> = {
  today: 'M4 11.5 12 5l8 6.5M6.5 10.5V19h11v-8.5',
  calendar: 'M4 6.5h16v13.5H4zM8 4v4M16 4v4M4 11h16',
  chores: 'M12 3.5l2.4 5 5.4.7-4 3.8 1 5.4-4.8-2.6-4.8 2.6 1-5.4-4-3.8 5.4-.7z',
  meals: 'M7 4v6M4.5 4v3.5a2.5 2.5 0 0 0 5 0V4M7 10v10M16.5 4c-2 1.2-3 3.2-3 5.5 0 2 1.2 3.5 3 3.5V20M16.5 4V20',
  savings: 'M20 12.5 12.8 19.7a2 2 0 0 1-2.8 0L4.3 14a2 2 0 0 1 0-2.8L11.5 4H17a3 3 0 0 1 3 3v5.5zM15.5 8.5h.02',
  lists: 'M9.5 6.5h11M9.5 12h11M9.5 17.5h11M4 6.5l1.2 1.2 2.2-2.4M4 12l1.2 1.2 2.2-2.4M4 17.5l1.2 1.2 2.2-2.4',
  countdowns: 'M7 3.5h10v3.5l-4 5 4 5v3.5H7v-3.5l4-5-4-5z',
  // A football on its point, with the lacing across it.
  pickem: 'M12 3.2c3.4 3 5.4 5.6 5.4 8.8s-2 5.8-5.4 8.8c-3.4-3-5.4-5.6-5.4-8.8S8.6 6.2 12 3.2zM9.4 12h5.2M11 9.8v4.4M13 9.8v4.4',
  sidekick: PATHS.sparkle,
  settings:
    'M12 8.6a3.4 3.4 0 1 0 0 6.8 3.4 3.4 0 0 0 0-6.8M12 2.8v2.4M12 18.8v2.4M4.9 4.9l1.7 1.7M17.4 17.4l1.7 1.7M2.8 12h2.4M18.8 12h2.4M4.9 19.1l1.7-1.7M17.4 6.6l1.7-1.7',
}
