import type { CSSProperties } from 'react'
import type { PageId } from '../types.ts'
import { CREAM, INK, line } from '../lib/theme.ts'
import { useFamily, useLayout } from '../store/FamilyStore.tsx'
import { Avatar } from './Avatar.tsx'
import { Icon, NAV_ICONS } from './Icon.tsx'

const PAGES: [PageId, string][] = [
  ['today', 'Today'],
  ['calendar', 'Calendar'],
  ['chores', 'Chores'],
  ['meals', 'Meals'],
  ['savings', 'Savings'],
  ['lists', 'Lists'],
  ['countdowns', 'Countdowns'],
  ['sidekick', 'Sidekick'],
  ['settings', 'Settings'],
]

/** Skylight-style navigation: a sidebar rail that becomes bottom tabs on a phone. */
export function Rail() {
  const { data, page, go, openMember } = useFamily()
  const { narrow, mid } = useLayout()

  const railStyle: CSSProperties = narrow
    ? {
        position: 'fixed',
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(255,255,255,.96)',
        backdropFilter: 'blur(8px)',
        borderTop: `1px solid ${line(0.12)}`,
        display: 'flex',
        flexDirection: 'row',
        padding: '6px 8px calc(6px + env(safe-area-inset-bottom))',
        zIndex: 60,
        boxShadow: '0 -8px 24px -14px rgba(35,42,61,.3)',
      }
    : {
        width: mid ? 86 : 236,
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: 5,
        padding: '20px 14px',
        borderRight: `1px solid ${line(0.1)}`,
        background: 'rgba(255,255,255,.65)',
        position: 'sticky',
        top: 0,
        height: '100vh',
        overflow: 'auto',
      }

  const buttonStyle = (on: boolean): CSSProperties =>
    narrow
      ? {
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 2,
          padding: '7px 6px',
          borderRadius: 14,
          border: 'none',
          cursor: 'pointer',
          flex: 1,
          fontSize: '.6em',
          fontWeight: 700,
          background: on ? INK : 'none',
          color: on ? CREAM : line(0.66),
        }
      : {
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '12px 14px',
          borderRadius: 16,
          border: 'none',
          cursor: 'pointer',
          fontSize: '.93em',
          fontWeight: 700,
          textAlign: 'left',
          minHeight: 47,
          width: '100%',
          ...(mid ? { justifyContent: 'center' } : {}),
          background: on ? INK : 'none',
          color: on ? CREAM : line(0.7),
        }

  return (
    <nav style={railStyle}>
      {!narrow ? (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '6px 8px 18px',
            ...(mid ? { justifyContent: 'center' } : {}),
          }}
        >
          <div
            style={{
              width: 38,
              height: 38,
              borderRadius: 12,
              background: INK,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <svg width={22} height={22} viewBox="0 0 24 24" fill="#7C5CE0">
              <path d="M12 3.5l2.4 5 5.4.7-4 3.8 1 5.4-4.8-2.6-4.8 2.6 1-5.4-4-3.8 5.4-.7z" />
            </svg>
          </div>
          {!mid ? (
            <span style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 600, fontSize: '1.05em', lineHeight: 1.1 }}>
              Carberry
              <br />
              Command Center
            </span>
          ) : null}
        </div>
      ) : null}

      {PAGES.map(([id, label]) => (
        <button key={id} onClick={() => go(id)} style={buttonStyle(page === id)}>
          <Icon d={NAV_ICONS[id]} size={23} style={{ flexShrink: 0 }} />
          {narrow || !mid ? <span>{label}</span> : null}
        </button>
      ))}

      {!narrow ? (
        <div
          style={{
            display: 'flex',
            gap: 6,
            flexWrap: 'wrap',
            marginTop: 'auto',
            padding: '14px 6px 4px',
            ...(mid ? { justifyContent: 'center' } : {}),
          }}
        >
          {data.members.map((m) => (
            <Avatar key={m.id} member={m} size={30} fontSize={13} onClick={() => openMember(m.id)} />
          ))}
        </div>
      ) : null}
    </nav>
  )
}
