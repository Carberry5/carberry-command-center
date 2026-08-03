import type { FamilyData } from '../types.ts'
import { seed, seedPreflight } from './seed.ts'

/** Colours from the first palette, remapped to the blue/purple/green one. */
const COLOR_MIGRATION: Record<string, string> = {
  '#148F82': '#0F8B8D',
  '#3E6FE1': '#3D6DE8',
  '#E85D8A': '#8B5CF6',
  '#F19A2E': '#31A05F',
  '#4F9D69': '#2E9E6B',
}

/**
 * Brings any stored data up to the current shape: remaps old palette colours,
 * guarantees Patrick exists, re-attaches kid photos, and fills in defaults for
 * anything added after the data was written. Safe to run repeatedly.
 */
export function migrate(input: Partial<FamilyData> | null | undefined): FamilyData {
  if (!input || !input.members || !input.members.length) return seed()
  const base = seed()
  const d = { ...base, ...input } as FamilyData

  d.members = (input.members ?? []).map((m) => ({
    ...m,
    color: COLOR_MIGRATION[m.color] ?? m.color,
    links: m.links ?? [],
  }))

  if (!d.members.some((m) => m.id === 'p' || /^patrick$/i.test(m.name))) {
    d.members.unshift({ id: 'p', name: 'Patrick', role: 'parent', color: '#4A5B8C', links: [] })
  }
  const rowan = d.members.find((m) => /^rowan$/i.test(m.name))
  if (rowan) rowan.photo = 'assets/rowan.png'
  const cannon = d.members.find((m) => /^cannon$/i.test(m.name))
  if (cannon) cannon.photo = 'assets/cannon.png'

  d.settings = { ...base.settings, ...(input.settings ?? {}) }
  d.settings.feeds = (d.settings.feeds ?? []).map((f) => ({
    ...f,
    color: COLOR_MIGRATION[f.color] ?? f.color,
    memberIds: f.memberIds ?? [],
  }))

  d.done = input.done ?? {}
  d.feedEv = input.feedEv ?? {}
  d.mealPlan = input.mealPlan ?? {}
  d.redemptions = input.redemptions ?? []
  d.secrets = input.secrets ?? []

  if (!input.preflight?.kids) {
    d.preflight = seedPreflight(d.members)
  } else {
    d.preflight = {
      ...input.preflight,
      open: input.preflight.open !== false,
      depart: input.preflight.depart ?? '07:30',
    }
  }

  d.fit = { ...base.fit, ...(input.fit ?? {}) }
  d.gl = { ...base.gl, ...(input.gl ?? {}) }

  // Data written before the savings module gets the seed staples and an empty
  // deal book; data that has any savings shape keeps exactly what it has.
  d.savings = input.savings
    ? {
        staples: input.savings.staples ?? [],
        deals: input.savings.deals ?? [],
        status: input.savings.status ?? {},
        plan: input.savings.plan ?? null,
      }
    : base.savings

  return d
}
