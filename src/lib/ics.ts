import type { FamilyEvent } from '../types.ts'
import { addDays, today, uid } from './dates.ts'

/**
 * Minimal read-only ICS reader: unfolds continuation lines, pulls DTSTART /
 * SUMMARY / LOCATION / RRULE, and keeps a window around today so a decade of
 * school history doesn't end up in the calendar.
 */
/**
 * Converts a UTC wall-clock to a named timezone. Only used for DTSTART values
 * ending in `Z`: Schoology and most school calendars emit those, and reading
 * them literally puts a 9:30am picture day at 1:30pm.
 */
function fromUtc(
  y: string, mo: string, d: string, h: string, mi: string, tz: string
): { date: string; start: string } {
  const at = new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi))
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    })
      .formatToParts(at)
      .map((p) => [p.type, p.value])
  )
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    start: `${parts.hour}:${parts.minute}`,
  }
}

/**
 * @param tz IANA zone the calendar's UTC timestamps should be shown in. Feeds
 *   are parsed on a server whose own clock is UTC, so this cannot be left to
 *   the environment — an unset zone would silently keep the UTC times.
 */
export function parseIcs(txt: string, tz = 'America/New_York'): FamilyEvent[] {
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
      const m = val.match(/(\d{4})(\d{2})(\d{2})(T(\d{2})(\d{2})(\d{2})?(Z)?)?/)
      if (m) {
        if (m[4] && m[8]) {
          // A trailing Z means UTC; shift it into the household's zone, which
          // can move the date as well as the time.
          const local = fromUtc(m[1], m[2], m[3], m[5], m[6], tz)
          cur.date = local.date
          cur.start = local.start
        } else {
          // Either an all-day date, or a local/TZID time already in the
          // calendar's own zone — take those at face value.
          cur.date = `${m[1]}-${m[2]}-${m[3]}`
          if (m[4]) cur.start = `${m[5]}:${m[6]}`
        }
      }
    }
    if (key === 'SUMMARY') cur.title = val.replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\n/g, ' ')
    if (key === 'LOCATION') cur.loc = val.replace(/\\,/g, ',')
    if (key === 'RRULE' && /FREQ=WEEKLY/.test(val)) cur.recur = 'weekly'
  }

  return events.slice(0, 300)
}
