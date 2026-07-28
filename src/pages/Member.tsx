import { DOW_NAMES, daysUntil, dowOf, addDays, fmtDate, today } from '../lib/dates.ts'
import { kidTheme } from '../lib/kidThemes.ts'
import { preflightActive } from '../lib/preflight.ts'
import { balances, choresFor, eventsOn, memberById, money } from '../lib/selectors.ts'
import {
  CREAM,
  FAM,
  GREENLIGHT,
  HEADING,
  INK,
  PURPLE,
  PURPLE_TEXT,
  cardPad,
  h2,
  line,
  linkBtn,
} from '../lib/theme.ts'
import { useFamily, useLayout } from '../store/FamilyStore.tsx'
import { useModals } from '../store/ModalStore.tsx'
import { AgendaRow } from '../components/AgendaRow.tsx'
import { CheckBox } from '../components/CheckBox.tsx'
import { Icon, PATHS, Star } from '../components/Icon.tsx'
import { PreflightMemberCard } from '../components/Preflight.tsx'
import { avatarInitial, avatarStyle } from '../lib/selectors.ts'
import { integrationStatus } from '../store/sync.ts'

/** A person's own page — themed for the kids, wearable stats for the parents. */
export function MemberPage() {
  const { data, memberSel, now, update, toast, requirePin } = useFamily()
  const { narrow, mid } = useLayout()
  const { setRedeem, setIntegration } = useModals()

  const member = memberById(data, memberSel) ?? data.members[0]
  if (!member) return null

  const td = today()
  const dow = new Date(now).getDay()
  const isKid = member.role === 'kid'
  const theme = kidTheme(member)
  const bal = balances(data)[member.id] ?? 0

  const agenda = eventsOn(data, td, null).filter((e) => !e.memberIds?.length || e.memberIds.includes(member.id))
  const chores = choresFor(data, member.id, dow)
  const greenlight = isKid ? data.gl[member.id] : undefined
  const fit = !isKid ? data.fit[member.id] : undefined

  const countdowns = data.countdowns
    .map((c) => ({ ...c, days: daysUntil(td, c.date) }))
    .filter((c) => c.date >= td && (!c.memberId || c.memberId === member.id))
    .sort((a, b) => a.days - b.days)
    .slice(0, 4)

  const toggleChore = (choreId: string, stars: number, on: boolean) => {
    update((d) => {
      d.done[td] = d.done[td] ?? {}
      const key = `${choreId}|${member.id}`
      if (d.done[td][key]) delete d.done[td][key]
      else d.done[td][key] = 1
    })
    if (!on) toast(`+${stars} ★ for ${member.name} — nice!`)
  }

  const doneToday = chores.filter((c) => data.done[td]?.[`${c.id}|${member.id}`]).length
  const meta =
    (member.role === 'parent' ? 'Parent' : `Age ${member.age ?? '—'}`) +
    (isKid && chores.length ? ` · ${doneToday}/${chores.length} chores today` : '')

  // Last seven days of stars, for the little bar chart.
  const week = Array.from({ length: 7 }, (_, i) => {
    const ds = addDays(td, -(6 - i))
    let earned = 0
    Object.keys(data.done[ds] ?? {}).forEach((key) => {
      const [choreId, memberId] = key.split('|')
      if (memberId !== member.id) return
      earned += data.chores.find((c) => c.id === choreId)?.stars ?? 0
    })
    return { ds, earned, label: DOW_NAMES[dowOf(ds)][0] }
  })

  return (
    <section style={{ animation: 'fadeUp .35s ease both' }}>
      {/* Hero */}
      <div
        style={{
          background: theme ? theme.bg : `linear-gradient(120deg,#FFFFFF,${member.color}22)`,
          border: `1px solid ${line(0.1)}`,
          borderRadius: 24,
          padding: '22px 26px',
          display: 'flex',
          alignItems: 'center',
          gap: 18,
          flexWrap: 'wrap',
          marginBottom: 18,
          position: 'relative',
          overflow: 'hidden',
          color: theme ? theme.fg : INK,
        }}
      >
        {theme?.deco.map((d) => (
          <svg
            key={d.key}
            viewBox="0 0 24 24"
            fill={d.filled ? 'currentColor' : 'none'}
            stroke="currentColor"
            strokeWidth={1.6}
            strokeLinecap="round"
            strokeLinejoin="round"
            style={d.style}
          >
            <path d={d.d} />
          </svg>
        ))}

        <div
          style={avatarStyle(member, {
            width: 72,
            height: 72,
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: CREAM,
            fontFamily: "'Outfit', sans-serif",
            fontWeight: 600,
            fontSize: '2em',
            position: 'relative',
            zIndex: 1,
            border: `2.5px solid rgba(255,255,255,${theme ? 0.6 : 0})`,
          })}
        >
          {avatarInitial(member)}
        </div>

        <div style={{ flex: 1, minWidth: 180, position: 'relative', zIndex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ ...HEADING, fontSize: '1.9em', lineHeight: 1.1 }}>{member.name}</div>
            {theme ? (
              <div
                style={{
                  fontWeight: 700,
                  fontSize: '.68em',
                  letterSpacing: '.09em',
                  textTransform: 'uppercase',
                  borderRadius: 999,
                  padding: '5px 12px',
                  background: 'rgba(247,249,255,.16)',
                  border: '1px solid rgba(247,249,255,.4)',
                }}
              >
                {theme.tag}
              </div>
            ) : null}
          </div>
          <div style={{ color: theme ? theme.sub : line(0.6), fontWeight: 600, marginTop: 3 }}>{meta}</div>
        </div>

        {isKid ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontWeight: 800,
              fontSize: '1.3em',
              color: PURPLE_TEXT,
              borderRadius: 999,
              padding: '10px 20px',
              position: 'relative',
              zIndex: 1,
              background: theme ? 'rgba(247,249,255,.94)' : 'rgba(124,92,224,.16)',
            }}
          >
            <Star size={20} />
            {bal}
          </div>
        ) : null}
      </div>

      <div
        style={{
          display: 'grid',
          gap: 12,
          gridTemplateColumns: narrow || mid ? '1fr' : '1.6fr 1fr',
          alignItems: 'start',
        }}
      >
        <div style={{ display: 'grid', gap: 18 }}>
          <div style={cardPad}>
            <h2 style={{ ...h2, margin: '0 0 12px' }}>{member.name}'s day</h2>
            {agenda.length ? (
              agenda.map((e) => <AgendaRow key={`${e.id}-${e.date}`} event={e} showRides={false} showDots={false} />)
            ) : (
              <div style={{ color: line(0.55), fontWeight: 600, padding: '14px 6px', textAlign: 'center' }}>
                Nothing on the calendar today.
              </div>
            )}
          </div>

          {preflightActive(data.preflight, dow) && isKid ? <PreflightMemberCard member={member} /> : null}

          {isKid ? (
            <div style={cardPad}>
              <h2 style={{ ...h2, margin: '0 0 8px' }}>Today's chores</h2>
              {chores.length ? (
                chores.map((c) => {
                  const on = !!data.done[td]?.[`${c.id}|${member.id}`]
                  return (
                    <div
                      key={c.id}
                      onClick={() => toggleChore(c.id, c.stars, on)}
                      className="row-hover"
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 11,
                        padding: '9px 8px',
                        borderRadius: 14,
                        cursor: 'pointer',
                        minHeight: 46,
                      }}
                    >
                      <CheckBox on={on} />
                      <div
                        style={{
                          flex: 1,
                          fontWeight: 700,
                          fontSize: '.95em',
                          textDecoration: on ? 'line-through' : 'none',
                          opacity: on ? 0.5 : 1,
                        }}
                      >
                        {c.title}
                      </div>
                      <div style={{ fontWeight: 800, fontSize: '.78em', color: PURPLE_TEXT }}>+{c.stars} ★</div>
                    </div>
                  )
                })
              ) : (
                <div style={{ color: line(0.55), fontWeight: 600, padding: '12px 4px', textAlign: 'center' }}>
                  No chores today — free pass!
                </div>
              )}
            </div>
          ) : null}
        </div>

        <div style={{ display: 'grid', gap: 18 }}>
          {greenlight ? (
            <div style={cardPad}>
              <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div
                    style={{
                      width: 26,
                      height: 26,
                      borderRadius: 8,
                      background: GREENLIGHT,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Icon d={PATHS.dollar} size={15} color="#FFFFFF" strokeWidth={2.2} />
                  </div>
                  <h2 style={h2}>Greenlight</h2>
                </div>
                <div style={{ flex: 1 }} />
                <button
                  onClick={() =>
                    requirePin(
                      () =>
                        setIntegration({
                          type: 'gl',
                          mem: member.id,
                          vals: {
                            bal: greenlight.bal,
                            allow: greenlight.allow,
                            goal: greenlight.goal,
                            goalCost: greenlight.goalCost,
                            saved: greenlight.saved,
                          },
                        }),
                      'Parent PIN to edit'
                    )
                  }
                  style={linkBtn}
                >
                  Edit
                </button>
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <div style={{ ...HEADING, fontSize: '2em', color: GREENLIGHT }}>{money(greenlight.bal)}</div>
                <div style={{ fontWeight: 600, fontSize: '.82em', color: line(0.55) }}>balance</div>
              </div>
              <div style={{ fontWeight: 600, fontSize: '.85em', color: line(0.6), marginTop: 2 }}>
                Allowance {money(greenlight.allow)}/week · paid Friday
              </div>

              <div
                style={{
                  marginTop: 12,
                  padding: '12px 14px',
                  border: `1px solid ${line(0.09)}`,
                  borderRadius: 16,
                  background: 'rgba(24,169,87,.06)',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontWeight: 700, fontSize: '.9em' }}>
                  <span>{greenlight.goal}</span>
                  <span style={{ color: GREENLIGHT, whiteSpace: 'nowrap' }}>
                    {money(greenlight.saved)} / {money(greenlight.goalCost)}
                  </span>
                </div>
                <div style={{ height: 9, borderRadius: 99, background: line(0.09), marginTop: 7, overflow: 'hidden' }}>
                  <div
                    style={{
                      height: '100%',
                      borderRadius: 99,
                      background: GREENLIGHT,
                      transition: 'width .4s',
                      width: `${Math.min(100, (greenlight.saved / Math.max(1, greenlight.goalCost)) * 100)}%`,
                    }}
                  />
                </div>
                <div style={{ fontWeight: 600, fontSize: '.75em', color: line(0.55), marginTop: 4 }}>
                  {money(Math.max(0, greenlight.goalCost - greenlight.saved))} to go — about{' '}
                  {Math.max(
                    1,
                    Math.ceil(Math.max(0, greenlight.goalCost - greenlight.saved) / Math.max(1, greenlight.allow))
                  )}{' '}
                  allowance weeks
                </div>
              </div>

              <div style={{ marginTop: 8 }}>
                {greenlight.pay.map((p, i) => (
                  <div
                    key={`${p.d}-${i}`}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '7px 2px',
                      borderBottom: `1px solid ${line(0.06)}`,
                    }}
                  >
                    <div style={{ width: 34, fontWeight: 700, fontSize: '.72em', color: line(0.5) }}>{p.d}</div>
                    <div style={{ flex: 1, fontWeight: 700, fontSize: '.88em' }}>{p.for}</div>
                    <div style={{ fontWeight: 800, fontSize: '.88em', color: GREENLIGHT }}>+{money(p.amt)}</div>
                  </div>
                ))}
              </div>

              <ConnectButton provider="greenlight" label="Greenlight" />
            </div>
          ) : null}

          {isKid ? (
            <>
              <div style={cardPad}>
                <h2 style={{ ...h2, margin: '0 0 6px' }}>Reward goals</h2>
                {data.rewards.map((r) => (
                  <div
                    key={r.id}
                    onClick={() => setRedeem(r)}
                    style={{ padding: '9px 4px', borderBottom: `1px solid ${line(0.07)}`, cursor: 'pointer' }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: '.92em' }}>
                      <span>{r.title}</span>
                      <span style={{ color: PURPLE_TEXT }}>{r.cost} ★</span>
                    </div>
                    <div style={{ height: 8, borderRadius: 99, background: 'rgba(35,42,61,.08)', marginTop: 6, overflow: 'hidden' }}>
                      <div
                        style={{
                          height: '100%',
                          borderRadius: 99,
                          background: PURPLE,
                          transition: 'width .4s',
                          width: `${Math.min(100, Math.round((bal / r.cost) * 100))}%`,
                        }}
                      />
                    </div>
                    <div style={{ fontWeight: 600, fontSize: '.75em', color: line(0.55), marginTop: 3 }}>
                      {bal >= r.cost ? 'Ready to redeem — tap!' : `${r.cost - bal} more ★ to go`}
                    </div>
                  </div>
                ))}
              </div>

              <div style={cardPad}>
                <h2 style={{ ...h2, margin: '0 0 10px' }}>Stars this week</h2>
                <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', height: 84, paddingTop: 6 }}>
                  {week.map((w) => (
                    <div
                      key={w.ds}
                      style={{
                        flex: 1,
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: 4,
                        justifyContent: 'flex-end',
                      }}
                    >
                      <div style={{ fontWeight: 700, fontSize: '.66em', color: line(0.55) }}>
                        {w.earned ? `+${w.earned}` : ''}
                      </div>
                      <div
                        style={{
                          width: '100%',
                          maxWidth: 26,
                          borderRadius: '8px 8px 4px 4px',
                          background: member.color,
                          height: w.earned ? Math.min(46, 10 + w.earned * 5) : 4,
                          opacity: w.earned ? 1 : 0.25,
                        }}
                      />
                      <div style={{ fontWeight: 700, fontSize: '.68em', color: w.ds === td ? INK : line(0.45) }}>
                        {w.label}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          ) : null}

          {fit ? (
            <div
              style={{
                background: 'linear-gradient(135deg,#171B26,#232A3D)',
                borderRadius: 22,
                boxShadow: '0 10px 26px -18px rgba(35,42,61,.55)',
                padding: '20px 22px',
                color: CREAM,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', marginBottom: 14 }}>
                <div>
                  <div
                    style={{
                      fontWeight: 700,
                      fontSize: '.68em',
                      letterSpacing: '.16em',
                      color: fit.kind === 'whoop' ? '#35E3A0' : '#79C7E3',
                    }}
                  >
                    {fit.kind === 'whoop' ? 'WHOOP' : 'ŌURA RING'}
                  </div>
                  <h2 style={{ ...h2, margin: '2px 0 0' }}>
                    {member.name}
                    {fit.kind === 'whoop' ? "'s recovery" : "'s readiness"}
                  </h2>
                </div>
                <div style={{ flex: 1 }} />
                <button
                  onClick={() =>
                    requirePin(
                      () =>
                        setIntegration({
                          type: fit.kind,
                          mem: member.id,
                          vals:
                            fit.kind === 'whoop'
                              ? { sleep: fit.sleep, strain: fit.strain }
                              : { sleep: fit.sleep, act: fit.act },
                        }),
                      'Parent PIN to edit'
                    )
                  }
                  style={{ ...linkBtn, color: 'rgba(247,249,255,.65)' }}
                >
                  Edit
                </button>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                {fitStats(fit).map((s) => (
                  <div
                    key={s.key}
                    style={{
                      background: 'rgba(247,249,255,.07)',
                      border: '1px solid rgba(247,249,255,.12)',
                      borderRadius: 16,
                      padding: '12px 14px',
                    }}
                  >
                    <div style={{ fontWeight: 700, fontSize: '.68em', letterSpacing: '.07em', color: 'rgba(247,249,255,.6)' }}>
                      {s.label}
                    </div>
                    <div style={{ ...HEADING, fontSize: '1.55em', marginTop: 2, color: s.color }}>{s.value}</div>
                    <div style={{ height: 7, borderRadius: 99, background: 'rgba(247,249,255,.12)', marginTop: 8, overflow: 'hidden' }}>
                      <div style={{ height: '100%', borderRadius: 99, transition: 'width .4s', background: s.color, width: s.width }} />
                    </div>
                    <div style={{ fontWeight: 600, fontSize: '.72em', color: 'rgba(247,249,255,.55)', marginTop: 5 }}>
                      {s.note}
                    </div>
                  </div>
                ))}
              </div>

              <ConnectButton provider={fit.kind} label={fit.kind === 'whoop' ? 'WHOOP' : 'Oura'} dark />
            </div>
          ) : null}

          <div style={cardPad}>
            <h2 style={{ ...h2, margin: '0 0 10px' }}>Counting down</h2>
            {countdowns.length ? (
              countdowns.map((c) => (
                <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '5px 0' }}>
                  <div
                    style={{
                      minWidth: 52,
                      textAlign: 'center',
                      ...HEADING,
                      borderRadius: 12,
                      padding: '5px 7px',
                      color: CREAM,
                      background: c.memberId ? member.color : FAM,
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
              ))
            ) : (
              <div style={{ color: line(0.55), fontWeight: 600, padding: '10px 4px', textAlign: 'center' }}>
                No countdowns yet.
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}

interface FitStat {
  key: string
  label: string
  value: string
  color: string
  width: string
  note: string
}

function fitStats(fit: { kind: 'whoop'; sleep: number; strain: number } | { kind: 'oura'; sleep: number; act: number }): FitStat[] {
  if (fit.kind === 'whoop') {
    return [
      {
        key: 'sleep',
        label: 'SLEEP PERFORMANCE',
        value: `${Math.round(fit.sleep)}%`,
        color: '#35E3A0',
        width: `${Math.min(100, fit.sleep)}%`,
        note: fit.sleep >= 85 ? 'Great recovery fuel' : fit.sleep >= 70 ? 'Solid night' : 'Early bedtime tonight?',
      },
      {
        key: 'strain',
        label: 'DAY STRAIN',
        value: (Math.round(fit.strain * 10) / 10).toFixed(1),
        color: '#5FB8FF',
        width: `${Math.min(100, (fit.strain / 21) * 100)}%`,
        note: fit.strain < 10 ? 'Light day so far' : fit.strain < 15 ? 'Moderate effort' : 'Big output day',
      },
    ]
  }
  return [
    {
      key: 'sleep',
      label: 'SLEEP SCORE',
      value: `${Math.round(fit.sleep)}`,
      color: '#79C7E3',
      width: `${Math.min(100, fit.sleep)}%`,
      note: fit.sleep >= 85 ? 'Excellent' : fit.sleep >= 70 ? 'Good' : 'Take it easy today',
    },
    {
      key: 'act',
      label: 'ACTIVITY GOAL',
      value: `${Math.round(fit.act)}%`,
      color: '#B9A6F1',
      width: `${Math.min(100, fit.act)}%`,
      note: fit.act >= 100 ? 'Goal crushed!' : 'Keep moving',
    },
  ]
}

/**
 * Reports whether this integration's API token is actually reachable in
 * 1Password. It never shows the token — just whether the sidecar could read it.
 */
function ConnectButton({ provider, label, dark = false }: { provider: string; label: string; dark?: boolean }) {
  const { toast } = useFamily()

  const check = async () => {
    const status = await integrationStatus()
    if (!status) {
      toast('The vault sidecar is not running — start it with `npm run dev`')
      return
    }
    if (!status.cli) {
      toast('Install the 1Password CLI (`op`) to connect live data')
      return
    }
    const entry = status.integrations[provider]
    if (!entry?.configured) {
      toast(`Add OP_${provider.toUpperCase()}_REF to .env pointing at the ${label} token in 1Password`)
      return
    }
    toast(
      entry.ok
        ? `${label} token found in 1Password — live sync lands when ${label} opens its API to us. Tap Edit meanwhile.`
        : `Could not read the ${label} token: ${entry.reason ?? 'unknown error'}`
    )
  }

  return (
    <button
      onClick={() => void check()}
      style={{
        marginTop: dark ? 14 : 12,
        width: '100%',
        border: `1.5px dashed ${dark ? 'rgba(247,249,255,.35)' : line(0.25)}`,
        background: 'none',
        borderRadius: 14,
        padding: dark ? 11 : 10,
        fontWeight: 700,
        cursor: 'pointer',
        color: dark ? 'rgba(247,249,255,.75)' : line(0.6),
        fontSize: '.85em',
      }}
    >
      Connect {label} → <span style={{ fontWeight: 600, opacity: 0.7 }}>check 1Password</span>
    </button>
  )
}
