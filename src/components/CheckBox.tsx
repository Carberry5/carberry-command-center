import type { CSSProperties } from 'react'
import { CHECK_PATH, check, line } from '../lib/theme.ts'

/** The rounded-square checkbox used by chores, lists, pre-flight and Sidekick. */
export function CheckBox({ on, style }: { on: boolean; style?: CSSProperties }) {
  return (
    <div style={{ ...check(on), ...style }}>
      {on ? (
        <svg
          width={15}
          height={15}
          viewBox="0 0 24 24"
          fill="none"
          stroke="#F7F9FF"
          strokeWidth={3.4}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d={CHECK_PATH} />
        </svg>
      ) : null}
    </div>
  )
}

/** Dashed placeholder for pre-flight rows that are information, not a task. */
export function InfoBox() {
  return (
    <div
      style={{
        width: 26,
        height: 26,
        borderRadius: 9,
        flexShrink: 0,
        border: `2px dashed ${line(0.2)}`,
        background: 'none',
      }}
    />
  )
}
