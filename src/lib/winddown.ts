import type { WindDown, WindDownStep } from '../types.ts'

export interface WindDownRow {
  /** Done-map key. Every wind-down row is tickable. */
  key: string
  text: string
  /** "HH:MM" it should be done by, when the step carries a deadline. */
  by?: string
}

/**
 * A school night is the night *before* a school day — Sunday through Thursday.
 *
 * This is the one thing about the evening routine that is easy to get backwards
 * and hard to notice: preflightActive() runs Monday–Friday because those are
 * the school mornings, and copying that range here would put the wind-down on
 * Friday night (no school Saturday) and skip Sunday night (school Monday).
 * Exactly wrong at both ends.
 */
export const windDownActive = (wd: WindDown | undefined, dow: number) =>
  !!wd?.open && (dow === 0 || (dow >= 1 && dow <= 4))

export const DEFAULT_BEDTIME = '20:30'
export const DEFAULT_SCREENS_OFF = '20:00'

export function emptyWindDown(): WindDown {
  return {
    open: true,
    bedtime: DEFAULT_BEDTIME,
    screensOff: DEFAULT_SCREENS_OFF,
    steps: [],
  }
}

/**
 * The evening checklist, in the order it happens.
 *
 * The two built-in steps are derived from the household's times rather than
 * stored as rows, so changing bedtime in Settings changes the checklist without
 * a migration. `steps` is whatever the family adds on top.
 *
 * Note the teeth key is 'wdt' and not the 'c1' chore id that the morning
 * pre-flight reuses. Both halves of "Brush teeth (AM & PM)" happen on the same
 * calendar day, and the done-map is keyed by day — so sharing c1 would make
 * ticking one tick the other, and the evening half would look done at
 * breakfast.
 */
export function windDownRows(wd: WindDown | undefined, kidId?: string): WindDownRow[] {
  const cfg = wd ?? emptyWindDown()
  const rows: WindDownRow[] = [
    { key: 'wds', text: 'Screens off', by: cfg.screensOff || DEFAULT_SCREENS_OFF },
    { key: 'wdt', text: 'Brush teeth' },
  ]
  for (const s of cfg.steps ?? []) rows.push({ key: `wdx${s.id}`, text: s.text, ...(s.by ? { by: s.by } : {}) })
  rows.push({ key: 'wdb', text: 'In bed', by: cfg.bedtime || DEFAULT_BEDTIME })
  // kidId is accepted so call sites read symmetrically with preflightRows and
  // so per-kid bedtimes can land here later without touching them.
  void kidId
  return rows
}

/**
 * Minutes until `hhmm`, from a Date. Negative once it has passed.
 *
 * Deliberately not wrapped across midnight: a wind-down countdown is only shown
 * in the evening, and treating 21:00 as "23 hours until 20:00" would turn a
 * missed bedtime into a cheerful all-day timer.
 */
export function minutesUntil(now: Date, hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  if (!Number.isFinite(h) || !Number.isFinite(m)) return 0
  return (h * 60 + m) - (now.getHours() * 60 + now.getMinutes())
}

/**
 * Whether the evening panel should be showing at all.
 *
 * From an hour before screens-off until an hour after bedtime — outside that
 * window a bedtime checklist is clutter, and on a Saturday it is noise.
 */
export function windDownWindow(wd: WindDown | undefined, now: Date): boolean {
  if (!windDownActive(wd, now.getDay())) return false
  const cfg = wd ?? emptyWindDown()
  const toScreens = minutesUntil(now, cfg.screensOff || DEFAULT_SCREENS_OFF)
  const toBed = minutesUntil(now, cfg.bedtime || DEFAULT_BEDTIME)
  return toScreens <= 60 && toBed >= -60
}

export const stepId = (steps: WindDownStep[]) =>
  `wd${steps.length + 1}_${Math.random().toString(36).slice(2, 7)}`
