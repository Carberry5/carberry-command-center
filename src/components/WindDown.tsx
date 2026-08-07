import type { CSSProperties } from 'react'
import type { Member } from '../types.ts'
import { today } from '../lib/dates.ts'
import { fmtTime } from '../lib/dates.ts'
import { minutesUntil, windDownRows } from '../lib/winddown.ts'
import { CHECK, INK, PURPLE_TEXT, line } from '../lib/theme.ts'
import { useFamily } from '../store/FamilyStore.tsx'
import { Avatar } from './Avatar.tsx'
import { CheckBox } from './CheckBox.tsx'
import { Icon, PATHS } from './Icon.tsx'

/**
 * The evening counterpart of the morning pre-flight: screens off, teeth, bed.
 *
 * Same shape deliberately — same card, same per-kid columns, same tick-to-earn
 * behaviour — because it is the same ritual at the other end of the day and the
 * family should not have to learn a second interface at bedtime.
 */

/** "In bed by 8:30 PM" → amber inside the last half hour → red once it's past. */
export function BedtimeChip() {
  const { data, now } = useFamily()
  const bedtime = data.windDown?.bedtime ?? '20:30'
  const nowDate = new Date(now)
  const left = minutesUntil(nowDate, bedtime)
  const display = fmtTime(bedtime)

  let label = `Bed by ${display}`
  let tone: CSSProperties = { color: line(0.6), background: 'rgba(35,42,61,.07)' }

  if (left <= 0) {
    label = `Bedtime was ${display}`
    tone = { color: '#FFF', background: '#D9435B' }
  } else if (left <= 10) {
    label = `${left} min to bed!`
    tone = { color: '#FFF', background: '#D9435B', animation: 'pulseRing 1.6s infinite' }
  } else if (left <= 30) {
    label = `${left} min · bed at ${display}`
    tone = { color: '#8A5A1E', background: 'rgba(226,146,74,.2)' }
  }

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        fontWeight: 800,
        fontSize: '.82em',
        borderRadius: 999,
        padding: '5px 12px',
        ...tone,
      }}
    >
      <Icon d={PATHS.clock} size={14} color="currentColor" />
      {label}
    </span>
  )
}

/** The checklist for one kid. */
export function WindDownRows({ member, compact = false }: { member: Member; compact?: boolean }) {
  const { data, update, toast, now } = useFamily()
  const td = today()
  const rows = windDownRows(data.windDown, member.id)
  const nowDate = new Date(now)

  const toggle = (key: string) => {
    update((d) => {
      d.done[td] = d.done[td] ?? {}
      const k = `${key}|${member.id}`
      if (d.done[td][k]) delete d.done[td][k]
      else d.done[td][k] = 1
    })
  }

  return (
    <>
      {rows.map((r) => {
        const on = !!data.done[td]?.[`${r.key}|${member.id}`]
        // Only nag about a deadline that has actually passed, and only while
        // the step is still outstanding — a red "8:00" next to a ticked box is
        // just scolding somebody who already did it.
        const late = !on && !!r.by && minutesUntil(nowDate, r.by) < 0
        return (
          <div
            key={r.key}
            onClick={() => {
              toggle(r.key)
              if (!on && r.key === 'wdb') toast(`${member.name} is in bed — good night!`)
            }}
            className="row-hover"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 9,
              padding: compact ? '5px 4px' : '8px 6px',
              borderRadius: 12,
              cursor: 'pointer',
              minHeight: compact ? 34 : 44,
            }}
          >
            <CheckBox on={on} />
            <span
              style={{
                flex: 1,
                fontWeight: 700,
                fontSize: compact ? '.85em' : '.95em',
                textDecoration: on ? 'line-through' : 'none',
                opacity: on ? 0.5 : 1,
                color: INK,
              }}
            >
              {r.text}
            </span>
            {r.by ? (
              <span
                style={{
                  fontWeight: 800,
                  fontSize: '.75em',
                  borderRadius: 999,
                  padding: '3px 8px',
                  ...(late
                    ? { color: '#FFF', background: '#D9435B' }
                    : { color: PURPLE_TEXT, background: 'rgba(124,92,224,.14)' }),
                }}
              >
                {fmtTime(r.by)}
              </span>
            ) : null}
          </div>
        )
      })}
    </>
  )
}

export function WindDownPanel() {
  const { data } = useFamily()
  const td = today()
  const kids = data.members.filter((m) => m.role === 'kid')

  let done = 0
  let total = 0
  const perKid = kids.map((k) => {
    const rows = windDownRows(data.windDown, k.id)
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
        <Icon d={PATHS.clock} size={21} color={PURPLE_TEXT} />
        <h2 style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 600, fontSize: '1.18em', margin: 0 }}>
          Wind-down
        </h2>
        <span style={{ fontWeight: 600, fontSize: '.82em', color: line(0.5) }}>School-night routine</span>
        <div style={{ flex: 1 }} />
        <BedtimeChip />
        <span
          style={{
            fontWeight: 800,
            fontSize: '.82em',
            color: PURPLE_TEXT,
            background: 'rgba(124,92,224,.14)',
            borderRadius: 999,
            padding: '5px 12px',
          }}
        >
          {done}/{total} done
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(210px,1fr))', gap: 10 }}>
        {perKid.map(({ kid, count, done: kidDone }) => {
          const settled = count > 0 && kidDone === count
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
                    ...(settled
                      ? { color: '#FFF', background: CHECK }
                      : { color: line(0.6), background: 'rgba(35,42,61,.07)' }),
                  }}
                >
                  {settled ? 'Settled' : `${kidDone}/${count}`}
                </span>
              </div>
              <WindDownRows member={kid} compact />
            </div>
          )
        })}
      </div>
    </div>
  )
}
