import { useState } from 'react'
import { DOW_NAMES, addDays, fmtTime, parseDay, today, ymd } from '../lib/dates.ts'
import { eventColor, eventsOn, memberDots } from '../lib/selectors.ts'
import { CREAM, FAM, GREEN, INK, chip, line, primaryBtn } from '../lib/theme.ts'
import { useFamily } from '../store/FamilyStore.tsx'
import { useModals } from '../store/ModalStore.tsx'
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
    <section style={{ animation: 'fadeUp .35s ease both' }}>
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

        <button onClick={() => setFilter(null)} style={chip(!filter)}>
          <span style={{ width: 10, height: 10, borderRadius: '50%', display: 'inline-block', background: FAM }} />
          Everyone
        </button>
        {data.members.map((m) => (
          <button key={m.id} onClick={() => toggleFilter(m.id)} style={chip(!!filter?.includes(m.id))}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', display: 'inline-block', background: m.color }} />
            {m.name}
          </button>
        ))}
        <button onClick={() => newEvent(td)} style={primaryBtn}>
          + Add event
        </button>
      </div>

      {view === 'week' ? (
        <div
          className="scroll-x"
          style={{ display: 'grid', gridTemplateColumns: 'repeat(7,minmax(148px,1fr))', gap: 10, paddingBottom: 6 }}
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

                <div style={{ display: 'flex', flexDirection: 'column', gap: 7, padding: '0 9px 10px', minHeight: 130 }}>
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
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 6 }}>
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
