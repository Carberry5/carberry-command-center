import { useState, type CSSProperties } from 'react'
import { DOW_NAMES, addDays, fmtTime, parseDay, today, ymd } from '../lib/dates.ts'
import { eventColor, eventsOn, memberDots } from '../lib/selectors.ts'
import { CREAM, FAM, GREEN, INK, line, primaryBtn } from '../lib/theme.ts'
import { useFamily } from '../store/FamilyStore.tsx'
import { useModals } from '../store/ModalStore.tsx'
import { Avatar } from '../components/Avatar.tsx'
import { RideTags } from '../components/RideTags.tsx'

/** Week and month views, colour-coded by who each event belongs to. */
export function CalendarPage() {
  const { data, prefs, now } = useFamily()
  const { newEvent, editEvent, setDayDetail } = useModals()

  const [view, setView] = useState<'week' | 'month'>('week')
  const [weekOffset, setWeekOffset] = useState(0)
  const [monthOffset, setMonthOffset] = useState(0)
  const [filter, setFilter] = useState<string[] | null>(null)

  const td = today()
  const nowDate = new Date(now)
  const weekStart = prefs.weekStartMonday ? 1 : 0

  const startOfWeek = (offset: number) => {
    const d = new Date(nowDate)
    d.setDate(d.getDate() - ((d.getDay() - weekStart + 7) % 7) + offset * 7)
    return ymd(d)
  }
  const w0 = startOfWeek(weekOffset)

  const monthBase = new Date(nowDate.getFullYear(), nowDate.getMonth() + monthOffset, 1)
  const gridStart = addDays(ymd(monthBase), -((monthBase.getDay() - weekStart + 7) % 7))

  const label =
    view === 'week'
      ? `${parseDay(w0).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${parseDay(
          addDays(w0, 6)
        ).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
      : monthBase.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

  const toggleFilter = (id: string) =>
    setFilter((prev) => {
      const next = prev ? (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]) : [id]
      return next.length ? next : null
    })

  const circleBtn = {
    width: 40,
    height: 40,
    borderRadius: '50%',
    border: `1px solid ${line(0.15)}`,
    background: '#FFFFFF',
    cursor: 'pointer',
    fontWeight: 800,
    color: INK,
  } as const

  /**
   * How a face reads in the filter row.
   *
   * With no filter set nobody is dimmed — "everyone" is the resting state of
   * the calendar, not a selection, so dimming five of six faces by default
   * would be a lie about what's on screen. Once somebody is picked, the ones
   * left out step back and the picked ones wear a ring in their own colour.
   */
  const faceState = (on: boolean, color: string): CSSProperties => ({
    transition: 'opacity .15s ease, box-shadow .15s ease',
    opacity: !filter || on ? 1 : 0.34,
    boxShadow: on ? `0 0 0 2px ${CREAM}, 0 0 0 4px ${color}` : 'none',
  })

  const viewBtn = (on: boolean) => ({
    border: 'none',
    borderRadius: 999,
    padding: '9px 18px',
    fontWeight: 700,
    cursor: 'pointer',
    fontSize: '.88em',
    background: on ? '#FFFFFF' : 'none',
    color: INK,
    ...(on ? { boxShadow: '0 2px 8px rgba(35,42,61,.15)' } : {}),
  })

  return (
    // The calendar owns the height it is given rather than sizing to its
    // contents: a week of mostly-empty days used to be a strip of short cards
    // with dead space under them. App.tsx makes the page area a flex column
    // for this.
    <section style={{ animation: 'fadeUp .35s ease both', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
        <div style={{ display: 'flex', background: 'rgba(35,42,61,.07)', borderRadius: 999, padding: 4 }}>
          <button onClick={() => setView('week')} style={viewBtn(view === 'week')}>
            Week
          </button>
          <button onClick={() => setView('month')} style={viewBtn(view === 'month')}>
            Month
          </button>
        </div>
        <button
          onClick={() => (view === 'week' ? setWeekOffset((o) => o - 1) : setMonthOffset((o) => o - 1))}
          style={circleBtn}
        >
          ‹
        </button>
        <button
          onClick={() => {
            setWeekOffset(0)
            setMonthOffset(0)
          }}
          style={{
            border: `1px solid ${line(0.15)}`,
            background: '#FFFFFF',
            borderRadius: 999,
            padding: '9px 16px',
            fontWeight: 700,
            cursor: 'pointer',
            fontSize: '.85em',
            color: INK,
          }}
        >
          Today
        </button>
        <button
          onClick={() => (view === 'week' ? setWeekOffset((o) => o + 1) : setMonthOffset((o) => o + 1))}
          style={circleBtn}
        >
          ›
        </button>
        <div style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 600, fontSize: '1.25em', marginLeft: 4 }}>
          {label}
        </div>
        <div style={{ flex: 1 }} />

        {/* Faces, not names. Six name chips wrapped the toolbar onto a second
            line and cost a row of calendar; the photos are both narrower and
            the thing this family actually recognises at a glance. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            onClick={() => setFilter(null)}
            title="Everyone"
            style={{
              width: 38,
              height: 38,
              borderRadius: '50%',
              border: 'none',
              padding: 0,
              cursor: 'pointer',
              background: FAM,
              color: '#FFFFFF',
              fontFamily: "'Outfit', sans-serif",
              fontWeight: 600,
              fontSize: '.72em',
              ...faceState(!filter, FAM),
            }}
          >
            All
          </button>
          {data.members.map((m) => (
            <Avatar
              key={m.id}
              member={m}
              size={38}
              onClick={() => toggleFilter(m.id)}
              title={filter?.includes(m.id) ? `Hide ${m.name}` : `Show only ${m.name}`}
              style={faceState(!!filter?.includes(m.id), m.color)}
            />
          ))}
        </div>
        <button onClick={() => newEvent(td)} style={primaryBtn}>
          + Add event
        </button>
      </div>

      {view === 'week' ? (
        <div
          className="scroll-x"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(7,minmax(148px,1fr))',
            // One row, told to take the whole track. Without this the row is
            // auto-sized to the busiest day and the rest of the space is lost.
            gridAutoRows: '1fr',
            gap: 10,
            paddingBottom: 6,
            flex: 1,
            // A floor for the phone, where the column is inside a scrolling
            // page and there is no spare height to hand out.
            minHeight: 420,
          }}
        >
          {Array.from({ length: 7 }, (_, i) => addDays(w0, i)).map((ds) => {
            const isToday = ds === td
            const d = parseDay(ds)
            const events = eventsOn(data, ds, filter)
            const meal = data.mealPlan[ds]
            return (
              <div
                key={ds}
                style={{
                  background: '#FFFFFF',
                  borderRadius: 18,
                  display: 'flex',
                  flexDirection: 'column',
                  // The card is now taller than its contents, so the corners
                  // have to clip the scroll area rather than the other way round.
                  overflow: 'hidden',
                  minHeight: 0,
                  border: `1.5px solid ${isToday ? INK : line(0.1)}`,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, padding: '10px 12px 6px' }}>
                  <span style={{ fontWeight: 700, fontSize: '.78em', color: line(0.55) }}>
                    {d.toLocaleDateString('en-US', { weekday: 'short' })}
                  </span>
                  <span
                    style={{
                      fontFamily: "'Outfit', sans-serif",
                      fontWeight: 600,
                      fontSize: '1.1em',
                      ...(isToday
                        ? { background: INK, color: CREAM, borderRadius: 99, padding: '1px 9px' }
                        : {}),
                    }}
                  >
                    {d.getDate()}
                  </span>
                  <span style={{ flex: 1 }} />
                  <DayHiLo ds={ds} />
                </div>

                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 7,
                    padding: '0 9px 10px',
                    // Fills the card; a day with more events than fit scrolls
                    // on its own instead of stretching the whole week.
                    flex: 1,
                    minHeight: 0,
                    overflowY: 'auto',
                  }}
                >
                  {events.map((e) => {
                    const color = eventColor(data, e)
                    return (
                      <div
                        key={`${e.id}-${ds}`}
                        onClick={() => editEvent(e)}
                        style={{
                          // Solid colour, white text — the Skylight look. The
                          // previous 8% tint made every kid's events read as
                          // roughly the same pale grey from across a kitchen;
                          // whose day it is should be legible at a glance from
                          // colour alone. Every palette colour is dark enough
                          // to carry white text.
                          borderRadius: 12,
                          padding: '8px 10px',
                          cursor: 'pointer',
                          background: color,
                          color: '#FFFFFF',
                          boxShadow: `0 3px 10px -6px ${color}`,
                        }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 5,
                            fontWeight: 700,
                            fontSize: '.72em',
                            opacity: 0.9,
                          }}
                        >
                          <span>{fmtTime(e.start)}</span>
                          <span style={{ flex: 1 }} />
                          {/* Only worth showing when the event is shared: on a
                              solid block, a lone dot in the same colour is
                              invisible and says nothing. */}
                          {(e.feedColor ? [] : memberDots(data, e.memberIds)).length > 1
                            ? memberDots(data, e.memberIds).map((c, i) => (
                                <span
                                  key={`${c}-${i}`}
                                  style={{
                                    width: 9,
                                    height: 9,
                                    borderRadius: '50%',
                                    display: 'inline-block',
                                    background: c,
                                    boxShadow: '0 0 0 1.5px rgba(255,255,255,.9)',
                                  }}
                                />
                              ))
                            : null}
                        </div>
                        <div style={{ fontWeight: 700, fontSize: '.86em', lineHeight: 1.25, marginTop: 2 }}>{e.title}</div>
                        {e.loc ? (
                          <div style={{ fontWeight: 600, fontSize: '.72em', opacity: 0.8 }}>{e.loc}</div>
                        ) : null}
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 3 }}>
                          <RideTags data={data} event={e} iconSize={11} />
                        </div>
                      </div>
                    )
                  })}
                </div>

                {meal ? (
                  <div
                    style={{
                      borderTop: `1px dashed ${line(0.14)}`,
                      padding: '7px 12px',
                      fontWeight: 700,
                      fontSize: '.74em',
                      color: GREEN,
                    }}
                  >
                    Dinner: {meal}
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 6, marginBottom: 6 }}>
            {Array.from({ length: 7 }, (_, i) => DOW_NAMES[(i + weekStart) % 7]).map((l) => (
              <div key={l} style={{ textAlign: 'center', fontWeight: 700, fontSize: '.78em', color: line(0.5), padding: 4 }}>
                {l}
              </div>
            ))}
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(7,1fr)',
              gridAutoRows: 'minmax(92px,1fr)',
              gap: 6,
              flex: 1,
              minHeight: 0,
              paddingBottom: 6,
            }}
          >
            {Array.from({ length: 42 }, (_, i) => addDays(gridStart, i)).map((ds) => {
              const d = parseDay(ds)
              const inMonth = d.getMonth() === monthBase.getMonth()
              const isToday = ds === td
              const events = eventsOn(data, ds, filter)
              return (
                <div
                  key={ds}
                  onClick={() => setDayDetail(ds)}
                  style={{
                    minHeight: 92,
                    borderRadius: 14,
                    padding: 7,
                    cursor: 'pointer',
                    background: inMonth ? '#FFFFFF' : 'rgba(255,255,255,.4)',
                    border: `1.5px solid ${isToday ? INK : line(0.08)}`,
                  }}
                >
                  <div
                    style={{
                      fontWeight: 700,
                      fontSize: '.82em',
                      marginBottom: 3,
                      ...(isToday
                        ? {
                            color: '#F7F9FF',
                            background: INK,
                            borderRadius: 99,
                            width: 24,
                            height: 24,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }
                        : { color: line(inMonth ? 0.8 : 0.3) }),
                    }}
                  >
                    {d.getDate()}
                  </div>
                  {events.slice(0, 3).map((e) => {
                    const color = eventColor(data, e)
                    return (
                      <div
                        key={`${e.id}-${ds}`}
                        style={{
                          fontWeight: 700,
                          fontSize: '.68em',
                          borderRadius: 7,
                          padding: '2px 6px',
                          marginBottom: 2,
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          color: '#FFFFFF',
                          background: color,
                        }}
                      >
                        {e.title}
                      </div>
                    )
                  })}
                  {events.length > 3 ? (
                    <div style={{ fontWeight: 700, fontSize: '.68em', color: line(0.5) }}>
                      +{events.length - 3} more
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>
        </>
      )}
    </section>
  )
}

/** The day's high/low, shown in the week view header when weather is on. */
function DayHiLo({ ds }: { ds: string }) {
  const { wx } = useFamily()
  const day = wx?.dy[ds]
  if (!day) return null
  return (
    <span style={{ fontWeight: 700, fontSize: '.72em', color: line(0.45) }}>
      {day.hi}°/{day.lo}°
    </span>
  )
}
