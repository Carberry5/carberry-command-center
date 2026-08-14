import type { CSSProperties } from 'react'
import type { PageId } from '../types.ts'
import { CREAM, INK, line } from '../lib/theme.ts'
import { useFamily, useLayout } from '../store/FamilyStore.tsx'
import { Avatar } from './Avatar.tsx'
import { Icon, NAV_ICONS } from './Icon.tsx'
import { Logo } from './Logo.tsx'

const PAGES: [PageId, string][] = [
  ['today', 'Today'],
  ['calendar', 'Calendar'],
  ['chores', 'Chores'],
  ['meals', 'Meals'],
  ['savings', 'Grocery'],
  ['lists', 'Lists'],
  ['countdowns', 'Countdowns'],
  ['pickem', "Pick'em"],
  ['sidekick', 'Sidekick'],
  ['settings', 'Settings'],
]

/**
 * Skylight-style navigation: a sidebar rail that becomes bottom tabs on a phone.
 *
 * The desktop rail is deliberately narrow — icon with its label underneath, one
 * column of glyphs, no wordmark. The wide version spent 236px on nine words
 * that the icons already say, and that width comes straight off the calendar,
 * which is the screen this app is for.
 */
export function Rail() {
  const { data, page, go, openMember } = useFamily()
  const { narrow } = useLayout()

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
        width: 82,
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: 3,
        padding: '16px 7px 12px',
        borderRight: `1px solid ${line(0.1)}`,
        // A faint warm wash rather than flat white, so the selected item —
        // which is white — reads as lifted off the rail.
        background: 'linear-gradient(180deg, rgba(255,255,255,.72), rgba(46,42,38,.05))',
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
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 4,
          padding: '9px 2px',
          borderRadius: 14,
          cursor: 'pointer',
          fontSize: '.58em',
          fontWeight: 700,
          lineHeight: 1.15,
          textAlign: 'center',
          width: '100%',
          // Selected is a white card, not an ink slab: at this width a filled
          // dark block is the loudest thing on the screen, and the calendar
          // beside it should be.
          background: on ? '#FFFFFF' : 'none',
          color: on ? INK : line(0.55),
          border: `1px solid ${on ? line(0.08) : 'transparent'}`,
          boxShadow: on ? '0 4px 14px -9px rgba(46,42,38,.7)' : 'none',
        }

  return (
    <nav style={railStyle}>
      {!narrow ? (
        // The mark alone. The wordmark needs ~150px to sit on one line and the
        // header already titles every page; the logo is enough to say whose
        // house this is.
        <div style={{ display: 'flex', justifyContent: 'center', padding: '4px 0 14px' }}>
          <Logo size={38} style={{ flexShrink: 0 }} />
        </div>
      ) : null}

      {PAGES.map(([id, label]) => (
        <button key={id} onClick={() => go(id)} style={buttonStyle(page === id)} title={label}>
          <Icon d={NAV_ICONS[id]} size={narrow ? 23 : 21} style={{ flexShrink: 0 }} />
          <span>{label}</span>
        </button>
      ))}

      {!narrow ? (
        <div
          style={{
            display: 'flex',
            gap: 5,
            flexWrap: 'wrap',
            justifyContent: 'center',
            marginTop: 'auto',
            padding: '14px 2px 2px',
          }}
        >
          {data.members.map((m) => (
            <Avatar key={m.id} member={m} size={28} fontSize={12} onClick={() => openMember(m.id)} />
          ))}
        </div>
      ) : null}
    </nav>
  )
}
