import { memberById } from '../lib/selectors.ts'
import { today } from '../lib/dates.ts'
import { CHECK, DISPLAY_CAPS, INK, TAUPE, line } from '../lib/theme.ts'
import { weatherIcon } from '../lib/weather.ts'
import { useFamily, useLayout } from '../store/FamilyStore.tsx'
import { useModals } from '../store/ModalStore.tsx'
import { startVoice } from '../lib/voice.ts'
import { Icon, LockIcon, MicIcon } from './Icon.tsx'

const TITLES: Record<string, string> = {
  // Every page titles itself; the brand lives in the rail, so repeating it here
  // would print "Carberry Command Center" twice on the one screen that matters
  // most. On a phone the rail's header is hidden, so the brand comes back —
  // see `title` below.
  today: 'Today',
  calendar: 'Calendar',
  chores: 'Chores & Stars',
  meals: 'Meal Plan',
  savings: 'Grocery',
  lists: 'Lists',
  countdowns: 'Countdowns',
  pickem: "NFL Pick'em",
  sidekick: 'Sidekick',
  settings: 'Settings',
}

export function Header() {
  const family = useFamily()
  const { data, page, memberSel, wx, now, parentUnlocked, toggleParentLock } = family
  const { narrow } = useLayout()
  const modals = useModals()

  const member = memberById(data, memberSel)
  const nowDate = new Date(now)
  const title =
    page === 'member'
      ? `${member?.name ?? 'Family'}'s page`
      : // Bottom tabs replace the rail on a phone, taking the wordmark with
        // them — so Today carries the brand there and nowhere else.
        page === 'today' && narrow
        ? 'Carberry Command Center'
        : TITLES[page] ?? 'Carberry Command Center'

  const dayWx = wx?.dy[today()]
  // On Today the weather already headlines the hero, so the chip would be a repeat.
  const showChip = !!wx && !narrow && page !== 'today'

  return (
    <header
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 11,
        flexWrap: 'wrap',
        padding: narrow ? '16px 16px 10px' : '24px 30px 14px',
        maxWidth: 1560,
        width: '100%',
        margin: '0 auto',
      }}
    >
      <div>
        {/* The "WE BELIEVE…" treatment: tracked serif capitals in greige. */}
        <h1 style={{ ...DISPLAY_CAPS, fontSize: '1.55em', color: TAUPE }}>{title}</h1>
        <div style={{ color: line(0.58), fontWeight: 600, fontSize: '.85em', marginTop: 2 }}>
          {nowDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
        </div>
      </div>

      <div style={{ flex: 1 }} />

      {showChip && wx ? (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 7,
            background: '#FFFFFF',
            border: `1px solid ${line(0.12)}`,
            borderRadius: 999,
            padding: '8px 14px 8px 10px',
            fontWeight: 700,
            fontSize: '.9em',
          }}
        >
          <Icon d={weatherIcon(wx.cur.c)} size={21} color="#E2924A" />
          <span>{wx.cur.t}°</span>
          {dayWx ? (
            <span style={{ color: line(0.5), fontWeight: 600 }}>
              {dayWx.hi}°/{dayWx.lo}°
            </span>
          ) : null}
        </div>
      ) : null}

      <div
        style={{
          fontFamily: "'Outfit', sans-serif",
          fontWeight: 600,
          fontSize: '1.35em',
          background: '#FFFFFF',
          border: `1px solid ${line(0.12)}`,
          borderRadius: 999,
          padding: '6px 16px',
        }}
      >
        {nowDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
      </div>

      <button
        onClick={() => startVoice(family, modals)}
        title="Voice command"
        style={{
          width: 46,
          height: 46,
          borderRadius: '50%',
          border: `1.5px solid ${line(0.16)}`,
          background: '#FFFFFF',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: INK,
        }}
      >
        <MicIcon />
      </button>

      <button
        onClick={toggleParentLock}
        title="Parent lock"
        style={{
          width: 46,
          height: 46,
          borderRadius: '50%',
          border: `1.5px solid ${parentUnlocked ? CHECK : line(0.16)}`,
          background: parentUnlocked ? 'rgba(34,160,107,.1)' : '#FFFFFF',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: parentUnlocked ? CHECK : INK,
        }}
      >
        <LockIcon open={parentUnlocked} />
      </button>
    </header>
  )
}
