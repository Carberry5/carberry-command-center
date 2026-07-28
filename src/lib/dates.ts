/** Date helpers. Everything is local-time and keyed by "YYYY-MM-DD" strings. */

const pad = (n: number) => String(n).padStart(2, '0')

/** Date object → "YYYY-MM-DD". */
export const ymd = (dt: Date) => `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`

/** "YYYY-MM-DD" → Date at local midnight (avoids the UTC shift `new Date(s)` gives). */
export function parseDay(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}

/** Add days to a "YYYY-MM-DD" string. */
export function addDays(s: string, n: number): string {
  const d = parseDay(s)
  d.setDate(d.getDate() + n)
  return ymd(d)
}

export const today = () => ymd(new Date())

/** Day of week for a date string: 0 = Sunday. */
export const dowOf = (s: string) => parseDay(s).getDay()

export const DOW_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** "16:30" → "4:30 PM"; empty → "All day". */
export function fmtTime(hm: string | null | undefined): string {
  if (!hm) return 'All day'
  const h = +hm.slice(0, 2)
  const m = hm.slice(3, 5)
  const ap = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 || 12
  return m === '00' ? `${h12} ${ap}` : `${h12}:${m} ${ap}`
}

/** "2026-07-28" → "Tue, Jul 28". */
export const fmtDate = (s: string) =>
  parseDay(s).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })

/** Whole days between two date strings, never negative. */
export const daysUntil = (from: string, to: string) =>
  Math.max(0, Math.round((parseDay(to).getTime() - parseDay(from).getTime()) / 864e5))

/** Short random id, matching the prototype's format. */
export const uid = () => Math.random().toString(36).slice(2, 9)
