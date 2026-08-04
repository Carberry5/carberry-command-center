import { daysUntil, fmtTime, today } from '../lib/dates.ts'
import { kidConfig, preflightActive, preflightRows } from '../lib/preflight.ts'
import { balances, eventColor, eventsOn, isDone } from '../lib/selectors.ts'
import { CREAM, HEADING } from '../lib/theme.ts'
import { weatherIcon } from '../lib/weather.ts'
import { useFamily } from '../store/FamilyStore.tsx'
import { Avatar } from '../components/Avatar.tsx'
import { Star } from '../components/Icon.tsx'

/**
 * Wall-display mode. One screenful, no navigation, no scrolling, nothing to tap.
 *
 * Built for an Echo Show propped on a kitchen counter, where the screen is
 * small, the viewer is across the room, and nobody is going to interact. The
 * ordinary pages assume the opposite of all three: they scroll, they put a
 * navigation rail down the side, and they size type for a phone in your hand.
 *
 * The layout is height-first. Everything is sized from the viewport rather than
 * from content, and each column clips its own overflow, because on a display
 * nobody is scrolling a truncated list is honest and a scrollbar is not.
 */
export function DisplayPage() {
  const { data, wx, now, prefs, setPrefs, mode } = useFamily()

  const td = today()
  const nowDate = new Date(now)
  const agenda = eventsOn(data, td, null)
  const bal = balances(data)
  const kids = data.members.filter((m) => m.role === 'kid')
  const dayWx = wx?.dy[td]
  const dinner = data.mealPlan[td]

  const nextUp = data.countdowns
    .map((c) => ({ ...c, days: daysUntil(td, c.date) }))
    .filter((c) => c.date >= td)
    .sort((a, b) => a.days - b.days)
    .slice(0, 3)

  // Events still to come, then today's earlier ones if there is room. A wall
  // display at 4pm should lead with the 5:30 practice, not with breakfast.
  const hhmm = `${String(nowDate.getHours()).padStart(2, '0')}:${String(nowDate.getMinutes()).padStart(2, '0')}`
  const ahead = agenda.filter((e) => !e.start || e.start >= hhmm)
  const shown = (ahead.length ? ahead : agenda).slice(0, 7)

  // On a school morning the useful number per kid is how far through the
  // checklist they are, not their star balance — "2/6" is what gets somebody
  // moving. Outside those hours the checklist is meaningless, so the same slot
  // shows stars instead. The heading follows the content rather than leading it,
  // which an earlier version of this got wrong: it switched the title on
  // pre-flight being active while always rendering stars underneath.
  const preflight = preflightActive(data.preflight, nowDate.getDay()) && nowDate.getHours() < 12
  const readiness = (kidId: string) => {
    const rows = preflightRows(kidConfig(data.preflight, kidId), nowDate.getDay())
    const tickable = rows.filter((r) => r.key)
    const done = tickable.filter((r) => isDone(data, td, r.key!, kidId)).length
    return { done, total: tickable.length }
  }

  const clock = nowDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  const date = nowDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })

  return (
    <div
      style={{
        // Fixed to the viewport, not the document: this must never scroll, and
        // 100vh alone still scrolls when a child overflows.
        position: 'fixed',
        inset: 0,
        overflow: 'hidden',
        background: 'linear-gradient(140deg,#1B2136,#232A3D 55%,#2C3550)',
        color: CREAM,
        fontFamily: "'Plus Jakarta Sans', sans-serif",
        display: 'flex',
        flexDirection: 'column',
        // Container query units would be neater, but Silk is old enough that
        // vw/vh are the safe way to scale from the screen.
        padding: 'clamp(10px, 2.2vh, 26px) clamp(12px, 2vw, 32px)',
        gap: 'clamp(8px, 1.6vh, 18px)',
      }}
    >
      {/* Clock strip */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 'clamp(10px,1.6vw,24px)', flexShrink: 0 }}>
        <div
          style={{
            ...HEADING,
            color: CREAM,
            fontSize: 'clamp(34px, 8.5vh, 92px)',
            lineHeight: 1,
            letterSpacing: '-.02em',
          }}
        >
          {clock}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontWeight: 700,
              fontSize: 'clamp(13px, 2.9vh, 26px)',
              opacity: 0.92,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {date}
          </div>
          {dinner ? (
            <div style={{ fontWeight: 600, fontSize: 'clamp(11px, 2.2vh, 20px)', opacity: 0.62 }}>
              Dinner · {dinner}
            </div>
          ) : null}
        </div>
        {prefs.showWeather && dayWx ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            <span style={{ fontSize: 'clamp(20px, 4.4vh, 44px)' }}>{weatherIcon(dayWx.c)}</span>
            <span style={{ ...HEADING, color: CREAM, fontSize: 'clamp(18px, 4vh, 40px)' }}>
              {Math.round(dayWx.hi)}°
            </span>
            <span style={{ fontWeight: 700, fontSize: 'clamp(11px, 2.2vh, 20px)', opacity: 0.55 }}>
              {Math.round(dayWx.lo)}°
            </span>
          </div>
        ) : null}
        {mode === 'local' ? (
          <span
            title="This device is not syncing"
            style={{
              flexShrink: 0,
              fontWeight: 800,
              fontSize: 'clamp(10px,1.7vh,16px)',
              letterSpacing: '.08em',
              background: 'rgba(217,91,67,.3)',
              padding: '4px 9px',
              borderRadius: 999,
            }}
          >
            OFFLINE
          </span>
        ) : null}
      </div>

      {/* Columns */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'grid',
          gridTemplateColumns: 'minmax(0,1.35fr) minmax(0,1fr)',
          gap: 'clamp(10px, 1.6vw, 24px)',
        }}
      >
        <Panel title="Today">
          {shown.length ? (
            shown.map((e) => (
              <div
                key={e.id}
                style={{
                  display: 'flex',
                  alignItems: 'baseline',
                  gap: 'clamp(6px,1vw,14px)',
                  padding: 'clamp(3px,.7vh,8px) 0',
                  borderBottom: `1px solid rgba(255,255,255,.07)`,
                }}
              >
                <span
                  style={{
                    width: 'clamp(58px,9vw,132px)',
                    flexShrink: 0,
                    fontWeight: 800,
                    fontSize: 'clamp(12px,2.6vh,26px)',
                    // "10:30 AM" wrapped to two lines once the type scaled up,
                    // which pushed the row height out and cost a whole event.
                    whiteSpace: 'nowrap',
                    opacity: 0.68,
                  }}
                >
                  {fmtTime(e.start)}
                </span>
                <span
                  style={{
                    width: 5,
                    alignSelf: 'stretch',
                    flexShrink: 0,
                    borderRadius: 3,
                    background: eventColor(data, e) ?? '#5B8DEF',
                  }}
                />
                <span
                  style={{
                    flex: 1,
                    minWidth: 0,
                    fontWeight: 700,
                    fontSize: 'clamp(13px,3vh,30px)',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {e.title}
                </span>
              </div>
            ))
          ) : (
            <Empty>Nothing scheduled</Empty>
          )}
        </Panel>

        <div style={{ display: 'grid', gridTemplateRows: '1fr auto', gap: 'clamp(10px,1.6vh,20px)', minHeight: 0 }}>
          <Panel title={preflight ? 'Morning pre-flight' : 'Chore stars'}>
            {kids.length ? (
              kids.map((k) => (
                <div
                  key={k.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'clamp(6px,.9vw,12px)',
                    padding: 'clamp(3px,.7vh,8px) 0',
                  }}
                >
                  <Avatar member={k} size={34} />
                  <span
                    style={{
                      flex: 1,
                      minWidth: 0,
                      fontWeight: 700,
                      fontSize: 'clamp(13px,2.9vh,28px)',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {k.name}
                  </span>
                  {preflight ? (
                    (() => {
                      const { done, total } = readiness(k.id)
                      const ready = total > 0 && done === total
                      return (
                        <span
                          style={{
                            fontWeight: 800,
                            fontSize: 'clamp(13px,2.9vh,28px)',
                            color: ready ? '#4ADE80' : CREAM,
                            opacity: ready ? 1 : 0.75,
                          }}
                        >
                          {done}/{total}
                        </span>
                      )
                    })()
                  ) : (
                    <span
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                        fontWeight: 800,
                        fontSize: 'clamp(13px,2.9vh,28px)',
                        opacity: 0.9,
                      }}
                    >
                      <Star size={14} />
                      {bal[k.id] ?? 0}
                    </span>
                  )}
                </div>
              ))
            ) : (
              <Empty>No kids yet</Empty>
            )}
          </Panel>

          {nextUp.length ? (
            <div style={{ display: 'flex', gap: 'clamp(6px,.9vw,12px)', flexShrink: 0 }}>
              {nextUp.map((c) => (
                <div
                  key={c.id}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    background: 'rgba(255,255,255,.07)',
                    borderRadius: 14,
                    padding: 'clamp(5px,1vh,12px) clamp(6px,.8vw,14px)',
                    textAlign: 'center',
                  }}
                >
                  <div style={{ ...HEADING, color: CREAM, fontSize: 'clamp(16px,3.2vh,32px)', lineHeight: 1 }}>
                    {c.days}
                  </div>
                  <div
                    style={{
                      fontWeight: 700,
                      fontSize: 'clamp(9px,1.6vh,14px)',
                      opacity: 0.6,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {c.title}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      {/*
        The only control. Deliberately small and in a corner: this screen lives
        where a child can reach it, and a prominent "exit" is an invitation.
      */}
      <button
        onClick={() => setPrefs({ display: false })}
        aria-label="Leave display mode"
        style={{
          position: 'absolute',
          left: 6,
          bottom: 4,
          width: 34,
          height: 34,
          borderRadius: 17,
          border: 'none',
          background: 'transparent',
          color: CREAM,
          opacity: 0.18,
          cursor: 'pointer',
          fontSize: 15,
          lineHeight: 1,
        }}
      >
        ✕
      </button>
    </div>
  )
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        background: 'rgba(255,255,255,.055)',
        border: `1px solid rgba(255,255,255,.09)`,
        borderRadius: 18,
        padding: 'clamp(8px,1.5vh,18px) clamp(10px,1.2vw,20px)',
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        // Clipped, not scrolled. Nobody scrolls a wall display, so a list that
        // runs past the bottom should simply stop rather than hide a scrollbar.
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          fontWeight: 800,
          letterSpacing: '.09em',
          textTransform: 'uppercase',
          fontSize: 'clamp(10px,1.7vh,16px)',
          opacity: 0.5,
          marginBottom: 'clamp(3px,.7vh,8px)',
          flexShrink: 0,
        }}
      >
        {title}
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>{children}</div>
    </div>
  )
}

const Empty = ({ children }: { children: React.ReactNode }) => (
  <div style={{ opacity: 0.4, fontWeight: 600, fontSize: 'clamp(12px,2.6vh,26px)' }}>{children}</div>
)
