import type { CSSProperties } from 'react'
import type { FamilyData, Member, ResolvedEvent } from '../types.ts'
import { dowOf } from './dates.ts'
import { FAM } from './theme.ts'

/** Derived reads over FamilyData. Pure — no component state involved. */

/** Star balance per member: everything earned in the log, minus redemptions. */
export function balances(d: FamilyData): Record<string, number> {
  const out: Record<string, number> = {}
  const cost: Record<string, number> = {}
  d.chores.forEach((c) => (cost[c.id] = c.stars))
  Object.values(d.done).forEach((day) =>
    Object.keys(day).forEach((key) => {
      if (!day[key]) return
      const [choreId, memberId] = key.split('|')
      if (cost[choreId]) out[memberId] = (out[memberId] ?? 0) + cost[choreId]
    })
  )
  d.redemptions.forEach((r) => (out[r.kidId] = (out[r.kidId] ?? 0) - r.cost))
  return out
}

/**
 * Every event landing on `ds`, own and from feeds, weekly repeats expanded,
 * sorted by start time and filtered to the selected members.
 */
export function eventsOn(d: FamilyData, ds: string, filter: string[] | null): ResolvedEvent[] {
  const dw = dowOf(ds)
  const hits = (date: string, recur: string | null) =>
    date === ds || (recur === 'weekly' && dowOf(date) === dw && ds >= date)

  const out: ResolvedEvent[] = []
  d.events.forEach((e) => {
    if (hits(e.date, e.recur)) out.push({ ...e, date: ds, feedColor: null, readOnly: false })
  })
  ;(d.settings.feeds ?? []).forEach((f) =>
    (d.feedEv?.[f.id] ?? []).forEach((e) => {
      if (hits(e.date, e.recur)) out.push({ ...e, date: ds, feedColor: f.color, readOnly: true })
    })
  )

  out.sort((a, b) => ((a.start ?? '99') < (b.start ?? '99') ? -1 : 1))
  return filter
    ? out.filter((e) => !e.memberIds?.length || e.memberIds.some((id) => filter.includes(id)))
    : out
}

export const memberById = (d: FamilyData, id: string | null | undefined) =>
  id ? d.members.find((m) => m.id === id) : undefined

/** Colour dots for an event; whole-family events get the single family purple. */
export function memberDots(d: FamilyData, ids: string[] | undefined): string[] {
  if (!ids?.length) return [FAM]
  return ids.slice(0, 4).map((id) => memberById(d, id)?.color ?? FAM)
}

/** The bar/dot colour for an event row. */
export const eventColor = (d: FamilyData, e: ResolvedEvent) => e.feedColor ?? memberDots(d, e.memberIds)[0]

/** Avatar style: the member's colour, overlaid with their photo when they have one. */
export function avatarStyle(m: Member, base: CSSProperties): CSSProperties {
  return {
    ...base,
    background: m.color,
    ...(m.photo
      ? { backgroundImage: `url('${m.photo}')`, backgroundSize: 'cover', backgroundPosition: 'center' }
      : {}),
  }
}

/** Initial to show when there's no photo. */
export const avatarInitial = (m: Member) => (m.photo ? '' : m.name[0] || '?')

/** Chores assigned to a member on a given weekday. */
export const choresFor = (d: FamilyData, memberId: string, dow: number) =>
  d.chores.filter((c) => c.memberIds.includes(memberId) && c.days.includes(dow))

export const isDone = (d: FamilyData, ds: string, key: string, memberId: string) =>
  !!d.done[ds]?.[`${key}|${memberId}`]

export const money = (v: number) => `$${(Math.round(v * 100) / 100).toFixed(2)}`
