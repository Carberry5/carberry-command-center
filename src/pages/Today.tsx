import { useState } from 'react'
import { addDays, daysUntil, fmtDate, today } from '../lib/dates.ts'
import { quoteOfTheWeek } from '../lib/onThisDay.ts'
import { preflightActive } from '../lib/preflight.ts'
import { windDownWindow } from '../lib/winddown.ts'
import { balances, choresFor, eventsOn } from '../lib/selectors.ts'
import { FAM, GREEN, HEADING, INK, PURPLE_TEXT, cardTight, h2, line, linkBtn } from '../lib/theme.ts'
import { weatherIcon } from '../lib/weather.ts'
import { useFamily, useLayout } from '../store/FamilyStore.tsx'
import { useModals } from '../store/ModalStore.tsx'
import { AgendaRow } from '../components/AgendaRow.tsx'
import { Avatar } from '../components/Avatar.tsx'
import { Icon, Star } from '../components/Icon.tsx'
import { PreflightPanel } from '../components/Preflight.tsx'
import { WindDownPanel } from '../components/WindDown.tsx'

/** The default view: everything the family needs before 8am, in one screen. */
export function TodayPage() {
  const { data, wx, now, history, go, openMember } = useFamily()
  const { narrow, mid } = useLayout()
  const { newEvent } = useModals()
  const [factIndex, setFactIndex] = useState(0)

  const td = today()
  const nowDate = new Date(now)
  const dow = nowDate.getDay()
  const hours = nowDate.getHours()
  const agenda = eventsOn(data, td, null)
  const bal = balances(data)
  const kids = data.members.filter((m) => m.role === 'kid')
  const quote = quoteOfTheWeek(now)
  const dayWx = wx?.dy[td]

  const upcoming = data.countdowns
    .map((c) => ({ ...c, days: daysUntil(td, c.date) }))
    .filter((c) => c.date >= td)
    .sort((a, b) => a.days - b.days)

  const fact = history?.length ? history[factIndex % history.length] : null

  const greeting = hours < 12 ? 'Good morning' : hours < 17 ? 'Good afternoon' : 'Good evening'
  const dinnerTonight = data.mealPlan[td]
  const heroSub =
    (agenda.length
      ? `${agenda.length} thing${agenda.length === 1 ? '' : 's'} on the calendar today`
      : 'A wide-open day') + (dinnerTonight ? ` · ${dinnerTonight} tonight` : '')

  return (
    <section style={{ animation: 'fadeUp .35s ease both' }}>
      {/* Hero */}
      <div
        style={{
          background: 'linear-gradient(120deg,#FFFFFF,#EFE9E1)',
          border: `1px solid ${line(0.1)}`,
          borderRadius: 24,
          boxShadow: '0 10px 30px -22px rgba(35,42,61,.35)',
          padding: '12px 18px',
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          flexWrap: 'wrap',
          marginBottom: 12,
        }}
      >
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ ...HEADING, fontSize: '1.45em', lineHeight: 1.15 }}>{greeting}!</div>
          <div style={{ color: line(0.62), fontWeight: 600, marginTop: 1, fontSize: '.9em' }}>{heroSub}</div>
        </div>
        {wx ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              background: 'rgba(255,255,255,.75)',
              border: `1px solid ${line(0.1)}`,
              borderRadius: 14,
              padding: '6px 13px',
            }}
          >
            <Icon d={weatherIcon(wx.cur.c)} size={34} color="#E2924A" strokeWidth={1.8} />
            <div>
              <div style={{ ...HEADING, fontSize: '1.35em', lineHeight: 1 }}>{wx.cur.t}°</div>
              <div style={{ color: line(0.6), fontWeight: 600, fontSize: '.78em', marginTop: 2 }}>
                {dayWx ? `H ${dayWx.hi}° · L ${dayWx.lo}° · ` : ''}
                {data.settings.place}
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {preflightActive(data.preflight, dow) && kids.length ? <PreflightPanel /> : null}
      {/*
        Evening only, and only on a school night. Shown from an hour before
        screens-off until an hour after bedtime — outside that window a bedtime
        checklist is clutter on a page that is already dense.
      */}
      {windDownWindow(data.windDown, nowDate) && kids.length ? <WindDownPanel /> : null}

      <div
        style={{
          display: 'grid',
          gap: 12,
          gridTemplateColumns: narrow || mid ? '1fr' : '1.6fr 1fr',
          alignItems: 'start',
        }}
      >
        {/* Today's plan */}
        <div style={cardTight}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
            <h2 style={h2}>Today's plan</h2>
            <div style={{ flex: 1 }} />
            <button
              onClick={() => newEvent(td)}
              style={{
                background: INK,
                color: '#F7F9FF',
                border: 'none',
                borderRadius: 999,
                padding: '9px 16px',
                fontWeight: 700,
                cursor: 'pointer',
                fontSize: '.85em',
                minHeight: 40,
              }}
            >
              + Add event
            </button>
          </div>
          {agenda.length ? (
            agenda.map((e) => <AgendaRow key={`${e.id}-${e.date}`} event={e} />)
          ) : (
            <div style={{ color: line(0.55), fontWeight: 600, padding: '12px 6px', textAlign: 'center' }}>
              A blank day — how rare! Tap “+ Add event” to fill it in.
            </div>
          )}
        </div>

        <div style={{ display: 'grid', gap: 12 }}>
          {/* Quote of the week */}
          <div
            style={{
              background: 'linear-gradient(140deg,#232A3D,#454FA0)',
              borderRadius: 22,
              padding: '14px 18px',
              color: '#F7F9FF',
              boxShadow: '0 10px 26px -18px rgba(35,42,61,.5)',
            }}
          >
            <div style={{ fontWeight: 700, fontSize: '.72em', letterSpacing: '.14em', color: '#7C5CE0', marginBottom: 5 }}>
              QUOTE OF THE WEEK
            </div>
            <div style={{ ...HEADING, fontWeight: 500, fontSize: '1.02em', lineHeight: 1.4 }}>“{quote.text}”</div>
            <div style={{ fontWeight: 600, fontSize: '.82em', opacity: 0.75, marginTop: 8 }}>— {quote.who}</div>
          </div>

          {/* This day in history */}
          <div style={cardTight}>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
              <h2 style={h2}>This day in history</h2>
              <div style={{ flex: 1 }} />
              {history && history.length > 1 ? (
                <button onClick={() => setFactIndex((i) => i + 1)} style={linkBtn}>
                  New fact →
                </button>
              ) : null}
            </div>
            {fact ? (
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                <div
                  style={{
                    minWidth: 66,
                    textAlign: 'center',
                    ...HEADING,
                    borderRadius: 12,
                    padding: '8px 6px',
                    color: '#8A5A1E',
                    background: 'rgba(226,146,74,.16)',
                  }}
                >
                  <div style={{ fontSize: '1.15em', lineHeight: 1 }}>{fact.year}</div>
                  <div style={{ fontSize: '.55em', fontWeight: 600, opacity: 0.85, letterSpacing: '.05em', marginTop: 3 }}>
                    {nowDate.getFullYear() - fact.year} YRS AGO
                  </div>
                </div>
                <div style={{ flex: 1, fontWeight: 600, fontSize: '.93em', lineHeight: 1.5, color: line(0.85) }}>
                  {fact.text}
                </div>
              </div>
            ) : (
              <div style={{ color: line(0.55), fontWeight: 600, fontSize: '.9em' }}>
                {history ? 'No fact found for today — check back tomorrow!' : 'Digging up a fun fact…'}
              </div>
            )}
          </div>

          {/* Chore stars */}
          <div style={cardTight}>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}>
              <h2 style={h2}>Chore stars</h2>
              <div style={{ flex: 1 }} />
              <button onClick={() => go('chores')} style={linkBtn}>
                Open →
              </button>
            </div>
            {kids.map((k) => {
              const chores = choresFor(data, k.id, dow)
              const done = chores.filter((c) => data.done[td]?.[`${c.id}|${k.id}`]).length
              const pct = chores.length ? Math.round((done / chores.length) * 100) : 0
              return (
                <div
                  key={k.id}
                  onClick={() => openMember(k.id)}
                  style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '5px 0', cursor: 'pointer', borderRadius: 12 }}
                >
                  <Avatar member={k} size={36} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: '.9em' }}>
                      <span>{k.name}</span>
                      <span style={{ color: line(0.55) }}>
                        {done}/{chores.length}
                      </span>
                    </div>
                    <div
                      style={{
                        height: 9,
                        borderRadius: 99,
                        background: 'rgba(35,42,61,.08)',
                        marginTop: 5,
                        overflow: 'hidden',
                      }}
                    >
                      <div style={{ height: '100%', borderRadius: 99, transition: 'width .4s', background: k.color, width: `${pct}%` }} />
                    </div>
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                      fontWeight: 800,
                      color: PURPLE_TEXT,
                      background: 'rgba(124,92,224,.14)',
                      borderRadius: 999,
                      padding: '5px 11px',
                      fontSize: '.85em',
                    }}
                  >
                    <Star />
                    {bal[k.id] ?? 0}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Dinner */}
          <div style={cardTight}>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}>
              <h2 style={h2}>Dinner</h2>
              <div style={{ flex: 1 }} />
              <button onClick={() => go('meals')} style={linkBtn}>
                Plan →
              </button>
            </div>
            <div style={{ fontWeight: 700, fontSize: '1.05em' }}>
              Tonight: <span style={{ color: GREEN }}>{dinnerTonight ?? 'nothing yet — tap Plan!'}</span>
            </div>
            <div style={{ color: line(0.58), fontWeight: 600, fontSize: '.88em', marginTop: 4 }}>
              Tomorrow: {data.mealPlan[addDays(td, 1)] ?? 'open'}
            </div>
          </div>

          {/* Coming up */}
          <div style={cardTight}>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}>
              <h2 style={h2}>Coming up</h2>
              <div style={{ flex: 1 }} />
              <button onClick={() => go('countdowns')} style={linkBtn}>
                All →
              </button>
            </div>
            {upcoming.slice(0, 2).map((c) => {
              const color = c.memberId ? data.members.find((m) => m.id === c.memberId)?.color ?? FAM : FAM
              return (
                <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '5px 0' }}>
                  <div
                    style={{
                      minWidth: 52,
                      textAlign: 'center',
                      ...HEADING,
                      borderRadius: 12,
                      padding: '5px 7px',
                      color: '#F7F9FF',
                      background: color,
                    }}
                  >
                    <div style={{ fontSize: '1.2em', lineHeight: 1 }}>{c.days}</div>
                    <div style={{ fontSize: '.55em', fontWeight: 600, opacity: 0.9 }}>DAYS</div>
                  </div>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '.95em' }}>{c.title}</div>
                    <div style={{ color: line(0.55), fontWeight: 600, fontSize: '.78em' }}>{fmtDate(c.date)}</div>
                  </div>
                </div>
              )
            })}
            {!upcoming.length ? (
              <div style={{ color: line(0.55), fontWeight: 600, fontSize: '.9em', padding: '6px 0' }}>
                Nothing on the horizon yet.
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  )
}
