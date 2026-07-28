import { useState } from 'react'
import { DOW_NAMES, today } from '../lib/dates.ts'
import { avatarInitial, avatarStyle, balances, choresFor, memberById } from '../lib/selectors.ts'
import { CREAM, HEADING, INK, PURPLE_TEXT, card, line } from '../lib/theme.ts'
import { useFamily } from '../store/FamilyStore.tsx'
import { useModals } from '../store/ModalStore.tsx'
import { CheckBox } from '../components/CheckBox.tsx'
import { Star } from '../components/Icon.tsx'

/** Per-kid chore columns, star balances, and the reward shop. */
export function ChoresPage() {
  const { data, now, update, toast, requirePin, openMember } = useFamily()
  const { setRedeem, setChore, setReward } = useModals()
  const [managing, setManaging] = useState(false)

  const td = today()
  const dow = new Date(now).getDay()
  const bal = balances(data)
  const kids = data.members.filter((m) => m.role === 'kid')

  const toggle = (choreId: string, kidId: string, stars: number, kidName: string, on: boolean) => {
    update((d) => {
      d.done[td] = d.done[td] ?? {}
      const key = `${choreId}|${kidId}`
      if (d.done[td][key]) delete d.done[td][key]
      else d.done[td][key] = 1
    })
    if (!on) toast(`+${stars} ★ for ${kidName} — nice!`)
  }

  const recent = data.redemptions
    .slice(-3)
    .reverse()
    .map((r) => `${memberById(data, r.kidId)?.name ?? '?'} — ${r.title}`)
    .join(' · ')

  return (
    <section style={{ animation: 'fadeUp .35s ease both' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(250px,1fr))', gap: 16 }}>
        {kids.map((k) => {
          const chores = choresFor(data, k.id, dow)
          const done = chores.filter((c) => data.done[td]?.[`${c.id}|${k.id}`]).length
          const pct = chores.length ? done / chores.length : 0
          return (
            <div key={k.id} style={{ ...card, padding: 18 }}>
              <div
                onClick={() => openMember(k.id)}
                style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10, cursor: 'pointer' }}
              >
                <div style={{ position: 'relative', width: 64, height: 64, flexShrink: 0 }}>
                  <svg width={64} height={64} viewBox="0 0 64 64">
                    <circle cx={32} cy={32} r={26} fill="none" stroke={line(0.1)} strokeWidth={7} />
                    <circle
                      cx={32}
                      cy={32}
                      r={26}
                      fill="none"
                      strokeWidth={7}
                      strokeLinecap="round"
                      transform="rotate(-90 32 32)"
                      stroke={k.color}
                      strokeDasharray={`${(pct * 163.4).toFixed(1)} 999`}
                    />
                  </svg>
                  <div
                    style={avatarStyle(k, {
                      position: 'absolute',
                      inset: 10,
                      borderRadius: '50%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: CREAM,
                      fontFamily: "'Outfit', sans-serif",
                      fontWeight: 600,
                      fontSize: '1.25em',
                    })}
                  >
                    {avatarInitial(k)}
                  </div>
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ ...HEADING, fontSize: '1.2em' }}>{k.name}</div>
                  <div style={{ color: line(0.55), fontWeight: 700, fontSize: '.8em' }}>
                    {k.age ? `Age ${k.age} · ` : ''}
                    {done}/{chores.length} today
                  </div>
                </div>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 5,
                    fontWeight: 800,
                    fontSize: '1em',
                    color: PURPLE_TEXT,
                    background: 'rgba(124,92,224,.14)',
                    borderRadius: 999,
                    padding: '7px 13px',
                  }}
                >
                  <Star size={16} />
                  {bal[k.id] ?? 0}
                </div>
              </div>

              {chores.map((c) => {
                const on = !!data.done[td]?.[`${c.id}|${k.id}`]
                return (
                  <div
                    key={c.id}
                    onClick={() => toggle(c.id, k.id, c.stars, k.name, on)}
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
                        transition: 'opacity .2s',
                        textDecoration: on ? 'line-through' : 'none',
                        opacity: on ? 0.5 : 1,
                      }}
                    >
                      {c.title}
                    </div>
                    <div style={{ fontWeight: 800, fontSize: '.78em', color: PURPLE_TEXT }}>+{c.stars} ★</div>
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '26px 0 12px' }}>
        <h2 style={{ ...HEADING, fontSize: '1.25em' }}>Reward shop</h2>
        <div style={{ flex: 1 }} />
        <button
          onClick={() => requirePin(() => setManaging((m) => !m), 'Managing chores is parent-only')}
          style={{
            border: `1px solid ${line(0.16)}`,
            background: '#FFFFFF',
            borderRadius: 999,
            padding: '9px 16px',
            fontWeight: 700,
            cursor: 'pointer',
            fontSize: '.85em',
            color: INK,
          }}
        >
          {managing ? 'Done managing' : 'Manage (parent)'}
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))', gap: 12 }}>
        {data.rewards.map((r) => (
          <button
            key={r.id}
            onClick={() => setRedeem(r)}
            className="reward-hover"
            style={{
              textAlign: 'left',
              background: '#FFFFFF',
              border: `1.5px solid rgba(124,92,224,.4)`,
              borderRadius: 18,
              padding: '14px 16px',
              cursor: 'pointer',
              minHeight: 44,
            }}
          >
            <div style={{ fontWeight: 700, fontSize: '.95em', color: INK }}>{r.title}</div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                marginTop: 6,
                fontWeight: 800,
                color: PURPLE_TEXT,
                fontSize: '.9em',
              }}
            >
              <Star />
              {r.cost} · tap to redeem
            </div>
          </button>
        ))}
      </div>

      {managing ? (
        <div
          style={{
            marginTop: 22,
            background: 'rgba(35,42,61,.04)',
            border: `1.5px dashed ${line(0.2)}`,
            borderRadius: 20,
            padding: '16px 18px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <h3 style={{ ...HEADING, fontSize: '1.05em' }}>Manage chores &amp; rewards</h3>
            <div style={{ flex: 1 }} />
            <button
              onClick={() =>
                setChore({ t: '', mems: kids.map((k) => k.id), days: [0, 1, 2, 3, 4, 5, 6], stars: 1 })
              }
              style={smallPrimary}
            >
              + Chore
            </button>
            <button onClick={() => setReward({ t: '', cost: 10 })} style={smallPrimary}>
              + Reward
            </button>
          </div>

          {data.chores.map((c) => (
            <div
              key={c.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '7px 4px',
                borderBottom: `1px solid ${line(0.08)}`,
              }}
            >
              <div style={{ flex: 1, fontWeight: 700, fontSize: '.9em' }}>
                {c.title}
                <span style={{ color: line(0.5), fontWeight: 600, fontSize: '.85em' }}>
                  {' '}
                  — {c.memberIds.map((id) => memberById(data, id)?.name).filter(Boolean).join(', ')} ·{' '}
                  {c.days.length === 7 ? 'daily' : c.days.map((i) => DOW_NAMES[i]).join(' ')} · {c.stars}★
                </span>
              </div>
              <button
                onClick={() => setChore({ id: c.id, t: c.title, mems: [...c.memberIds], days: [...c.days], stars: c.stars })}
                style={{
                  border: 'none',
                  background: 'rgba(35,42,61,.07)',
                  borderRadius: 10,
                  padding: '7px 12px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  fontSize: '.8em',
                  color: INK,
                }}
              >
                Edit
              </button>
              <button
                onClick={() =>
                  requirePin(() => {
                    update((d) => {
                      d.chores = d.chores.filter((x) => x.id !== c.id)
                    })
                    toast('Chore removed')
                  })
                }
                style={{
                  border: 'none',
                  background: 'rgba(217,91,67,.12)',
                  color: '#B23B22',
                  borderRadius: 10,
                  padding: '7px 12px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  fontSize: '.8em',
                }}
              >
                Delete
              </button>
            </div>
          ))}

          {recent ? (
            <div style={{ marginTop: 10, color: line(0.55), fontWeight: 600, fontSize: '.85em' }}>
              Recent redemptions: {recent}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}

const smallPrimary = {
  background: INK,
  color: CREAM,
  border: 'none',
  borderRadius: 999,
  padding: '8px 14px',
  fontWeight: 700,
  cursor: 'pointer',
  fontSize: '.82em',
} as const
