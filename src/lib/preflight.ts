import type { Preflight, PreflightKid } from '../types.ts'

export interface PreflightRow {
  /** Done-map key. `null` for informational rows that can't be ticked. */
  key: string | null
  text: string
  badge?: 'GYM' | 'FULL'
}

export const emptyKidConfig = (): PreflightKid => ({ gym: [], lun: [], bring: [] })

export function kidConfig(pf: Preflight | undefined, kidId: string): PreflightKid {
  return pf?.kids?.[kidId] ?? emptyKidConfig()
}

/**
 * The morning checklist for one kid on one weekday, in the order it's shown:
 * uniform, lunch, bring-alongs, then the daily three.
 *
 * "Brush teeth" deliberately uses the `c1` chore id so ticking it here also
 * earns the star on the chore chart.
 */
export function preflightRows(cfg: PreflightKid, dow: number): PreflightRow[] {
  const rows: PreflightRow[] = []
  const gym = (cfg.gym ?? []).includes(dow)
  rows.push({
    key: 'pfu',
    text: gym ? 'Wear gym uniform' : 'Wear full uniform',
    badge: gym ? 'GYM' : 'FULL',
  })
  if ((cfg.lun ?? []).includes(dow)) rows.push({ key: 'pfl', text: 'Pack lunch' })
  else rows.push({ key: null, text: 'Buying school lunch today' })
  ;(cfg.bring ?? []).forEach((b) => {
    if ((b.days ?? []).includes(dow)) rows.push({ key: `pfb${b.id}`, text: `Bring: ${b.text}` })
  })
  rows.push({ key: 'c1', text: 'Brush teeth' })
  rows.push({ key: 'pfv', text: 'Take vitamins' })
  rows.push({ key: 'pfh', text: 'Brush hair' })
  return rows
}

/** Pre-flight only runs on school mornings, Monday–Friday. */
export const preflightActive = (pf: Preflight | undefined, dow: number) =>
  !!pf?.open && dow >= 1 && dow <= 5
