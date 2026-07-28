import type { FamilyEvent } from '../types.ts'
import { addDays, today, uid } from './dates.ts'

/**
 * Minimal read-only ICS reader: unfolds continuation lines, pulls DTSTART /
 * SUMMARY / LOCATION / RRULE, and keeps a window around today so a decade of
 * school history doesn't end up in the calendar.
 */
export function parseIcs(txt: string): FamilyEvent[] {
  const lines = txt.replace(/\r/g, '').replace(/\n[ \t]/g, '').split('\n')
  const events: FamilyEvent[] = []
  const lo = addDays(today(), -30)
  const hi = addDays(today(), 180)
  let cur: { date?: string; start?: string; title?: string; loc?: string; recur?: 'weekly' } | null = null

  for (const ln of lines) {
    if (ln === 'BEGIN:VEVENT') {
      cur = {}
      continue
    }
    if (ln === 'END:VEVENT') {
      if (cur?.date && cur.title && ((cur.date >= lo && cur.date <= hi) || cur.recur)) {
        events.push({
          id: uid(),
          title: cur.title,
          date: cur.date,
          start: cur.start ?? null,
          dur: null,
          memberIds: [],
          loc: cur.loc ?? '',
          recur: cur.recur ?? null,
        })
      }
      cur = null
      continue
    }
    if (!cur) continue

    const ci = ln.indexOf(':')
    if (ci < 0) continue
    const key = ln.slice(0, ci).split(';')[0]
    const val = ln.slice(ci + 1)

    if (key === 'DTSTART') {
      const m = val.match(/(\d{4})(\d{2})(\d{2})(T(\d{2})(\d{2}))?/)
      if (m) {
        cur.date = `${m[1]}-${m[2]}-${m[3]}`
        if (m[4]) cur.start = `${m[5]}:${m[6]}`
      }
    }
    if (key === 'SUMMARY') cur.title = val.replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\n/g, ' ')
    if (key === 'LOCATION') cur.loc = val.replace(/\\,/g, ',')
    if (key === 'RRULE' && /FREQ=WEEKLY/.test(val)) cur.recur = 'weekly'
  }

  return events.slice(0, 300)
}
