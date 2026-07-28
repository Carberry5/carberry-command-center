import type { CSSProperties } from 'react'
import type { Member } from '../types.ts'
import { today } from '../lib/dates.ts'
import { kidConfig, preflightRows } from '../lib/preflight.ts'
import { BLUE, CHECK, INK, line } from '../lib/theme.ts'
import { useFamily } from '../store/FamilyStore.tsx'
import { Avatar } from './Avatar.tsx'
import { CheckBox, InfoBox } from './CheckBox.tsx'
import { Icon, PATHS } from './Icon.tsx'

/** "Leave by 7:30 AM" → amber inside the last hour → pulsing red at 15 minutes. */
export function DepartureChip() {
  const { data, now } = useFamily()
  const depart = data.preflight.depart ?? '07:30'
  const [hh, mm] = depart.split(':')
  const departMins = Number(hh) * 60 + Number(mm)
  const nowDate = new Date(now)
  const left = departMins - (nowDate.getHours() * 60 + nowDate.getMinutes())

  const hour12 = ((Number(hh) + 11) % 12) + 1
  const display = `${hour12}:${mm} ${Number(hh) >= 12 ? 'PM' : 'AM'}`

  let label = `Leave by ${display}`
  let tone: CSSProperties = { color: line(0.6), background: 'rgba(35,42,61,.07)' }

  if (left <= 0 && left > -180) {
    label = `Departed · ${display}`
  } else if (left > 0 && left <= 15) {
    label = `Leave in ${left} min!`
    tone = { color: '#FFF', background: '#D9435B', animation: 'pulseRing 1.6s infinite' }
  } else if (left > 0 && left <= 60) {
    label = `Leave in ${left} min · ${display}`
    tone = { color: '#8A5A1E', background: 'rgba(226,146,74,.2)' }
  }

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        fontWeight: 800,
        fontSize: '.82em',
        borderRadius: 999,
        padding: '5px 12px',
        ...tone,
      }}
    >
      <Icon d={PATHS.clock} size={13} strokeWidth={2.4} />
      {label}
    </span>
  )
}

/** The checklist rows for one kid on today's weekday. */
export function PreflightRows({ member, compact = false }: { member: Member; compact?: boolean }) {
  const { data, update } = useFamily()
  const td = today()
  const dow = new Date().getDay()
  const rows = preflightRows(kidConfig(data.preflight, member.id), dow)

  const toggle = (key: string) =>
    update((d) => {
      d.done[td] = d.done[td] ?? {}
      const k = `${key}|${member.id}`
      if (d.done[td][k]) delete d.done[td][k]
      else d.done[td][k] = 1
    })

  return (
    <>
      {rows.map((row, i) => {
        const on = !!row.key && !!data.done[td]?.[`${row.key}|${member.id}`]
        return (
          <div
            key={row.key ?? `info-${i}`}
            onClick={row.key ? () => toggle(row.key!) : undefined}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '6px 3px',
              borderRadius: 12,
              minHeight: 40,
              cursor: row.key ? 'pointer' : 'default',
            }}
          >
            {row.key ? <CheckBox on={on} /> : <InfoBox />}
            <div
              style={{
                flex: 1,
                fontWeight: 700,
                fontSize: compact ? '.86em' : '.92em',
                lineHeight: 1.3,
                textDecoration: on ? 'line-through' : 'none',
                opacity: on ? 0.55 : row.key ? 1 : 0.6,
              }}
            >
              {row.text}
            </div>
            {row.badge ? (
              <span
                style={{
                  fontWeight: 800,
                  fontSize: '.62em',
                  letterSpacing: '.08em',
                  borderRadius: 999,
                  padding: '3px 8px',
                  color: '#FFF',
                  background: row.badge === 'GYM' ? CHECK : BLUE,
                }}
              >
                {row.badge}
              </span>
            ) : null}
          </div>
        )
      })}
    </>
  )
}

/** The whole-family pre-flight card at the top of Today. */
export function PreflightPanel() {
  const { data } = useFamily()
  const td = today()
  const dow = new Date().getDay()
  const kids = data.members.filter((m) => m.role === 'kid')

  let done = 0
  let total = 0
  const perKid = kids.map((k) => {
    const rows = preflightRows(kidConfig(data.preflight, k.id), dow).filter((r) => r.key)
    const kidDone = rows.filter((r) => data.done[td]?.[`${r.key}|${k.id}`]).length
    done += kidDone
    total += rows.length
    return { kid: k, count: rows.length, done: kidDone }
  })

  return (
    <div
      style={{
        background: '#FFFFFF',
        border: `1px solid ${line(0.1)}`,
        borderRadius: 22,
        boxShadow: '0 8px 24px -18px rgba(35,42,61,.3)',
        padding: '14px 16px',
        marginBottom: 12,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 9, flexWrap: 'wrap' }}>
        <Icon d={PATHS.paperPlane} size={21} color={BLUE} />
        <h2 style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 600, fontSize: '1.18em', margin: 0 }}>
          Morning pre-flight
        </h2>
        <span style={{ fontWeight: 600, fontSize: '.82em', color: line(0.5) }}>School-day checklist</span>
        <div style={{ flex: 1 }} />
        <DepartureChip />
        <span
          style={{
            fontWeight: 800,
            fontSize: '.82em',
            color: '#2A4FB8',
            background: 'rgba(61,109,232,.12)',
            borderRadius: 999,
            padding: '5px 12px',
          }}
        >
          {done}/{total} ready
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(210px,1fr))', gap: 10 }}>
        {perKid.map(({ kid, count, done: kidDone }) => {
          const ready = count > 0 && kidDone === count
          return (
            <div key={kid.id} style={{ border: `1.5px solid ${kid.color}55`, borderRadius: 16, padding: '8px 10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 3 }}>
                <Avatar member={kid} size={30} fontSize=".9em" />
                <div style={{ fontWeight: 700, flex: 1 }}>{kid.name}</div>
                <span
                  style={{
                    fontWeight: 800,
                    fontSize: '.78em',
                    borderRadius: 999,
                    padding: '4px 10px',
                    ...(ready
                      ? { color: '#FFF', background: CHECK }
                      : { color: line(0.6), background: 'rgba(35,42,61,.07)' }),
                  }}
                >
                  {ready ? 'Ready!' : `${kidDone}/${count}`}
                </span>
              </div>
              <PreflightRows member={kid} compact />
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** The single-kid version shown on a member's own page. */
export function PreflightMemberCard({ member }: { member: Member }) {
  return (
    <div
      style={{
        background: '#FFFFFF',
        border: `1.5px solid rgba(61,109,232,.3)`,
        borderRadius: 22,
        boxShadow: '0 8px 24px -18px rgba(35,42,61,.3)',
        padding: '20px 22px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <Icon d={PATHS.paperPlane} size={19} color={BLUE} />
        <h2 style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 600, fontSize: '1.18em', margin: 0, color: INK }}>
          Morning pre-flight
        </h2>
        <div style={{ flex: 1 }} />
        <DepartureChip />
      </div>
      <PreflightRows member={member} />
    </div>
  )
}
