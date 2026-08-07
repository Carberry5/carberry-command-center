/**
 * Exercises upcomingFor() in src/lib/selectors.ts. No database, no clock — the
 * "from" date is passed in, because a schedule feature that only behaves on the
 * day the suite runs is not tested.
 *
 * This exists because of a real miss: 12 launches synced into feed_events
 * correctly and none of them appeared on Hadley's page, because the member page
 * only ever rendered `eventsOn(data, today)`. The data was right and there was
 * nowhere for it to show. These checks pin the behaviour that was missing.
 *
 *   npx tsx scripts/upcoming-test.ts
 */

import type { FamilyData } from '../src/types.ts'
import { upcomingFor } from '../src/lib/selectors.ts'

let checks = 0
let failures = 0
const check = (name: string, cond: boolean, detail = '') => {
  checks++
  if (cond) console.log(`  ok   ${name}`)
  else {
    failures++
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`)
  }
}
const section = (n: string) => console.log(`\n${n}`)

const FROM = '2026-08-07' // a Friday

const base = (): FamilyData => ({
  members: [
    { id: 'h', name: 'Hadley', role: 'kid', color: '#8B5CF6', links: [] },
    { id: 'c', name: 'Cannon', role: 'kid', color: '#3D6DE8', links: [] },
  ],
  events: [], chores: [], done: {}, rewards: [], redemptions: [], favorites: [],
  mealPlan: {}, lists: [], countdowns: [],
  settings: { pin: '1234', zip: '', lat: 0, lon: 0, place: '', feeds: [] },
  feedEv: {}, preflight: { open: true, depart: '07:30', kids: {} },
  windDown: { open: true, bedtime: '20:30', screensOff: '20:00', steps: [] },
  fit: {}, gl: {}, secrets: [],
  savings: { staples: [], deals: [], status: {}, plan: null },
})

const ev = (id: string, date: string, title: string, memberIds: string[] = [], start = '12:00') => ({
  id, title, date, start, dur: null, memberIds, loc: '', recur: null,
})

// ---------------------------------------------------------------------------

section('the case that was broken: a feed with no member chips')
{
  // This is exactly the launch feed — feed_events carry no member tags, and the
  // feed itself had none either. It must still reach every member's page.
  const d = base()
  d.settings.feeds = [{ id: 'f1', name: 'Launches', url: 'spacedevs://launches', color: '#5B8DEF', status: '', memberIds: [] }]
  d.feedEv = {
    f1: [
      ev('ll2:a', '2026-08-12', '🚀 Starlink Group 10-5'),
      ev('ll2:b', '2026-08-20', '🚀 Blue Moon MK1 (TBD)'),
    ],
  }
  const up = upcomingFor(d, 'h', { from: FROM })
  check('untagged feed events reach a member', up.length === 2, `got ${up.length}`)
  check('and the far one too', up.some((e) => e.title.includes('Blue Moon')))
  check('they carry the feed colour', up.every((e) => e.feedColor === '#5B8DEF'))
  check('and are read-only', up.every((e) => e.readOnly))
  check('her brother sees them too', upcomingFor(d, 'c', { from: FROM }).length === 2)
}

section('a feed tagged to one kid stays on that kid')
{
  const d = base()
  d.settings.feeds = [{ id: 'f2', name: 'MadLax', url: 'https://x.test/l.ics', color: '#31A05F', status: '', memberIds: ['c'] }]
  // fromRows applies the feed's members to its events at read time, so a tagged
  // feed arrives with them already on each event.
  d.feedEv = { f2: [ev('g1', '2026-08-15', 'Lacrosse vs Broad Run', ['c'])] }
  check("it is on Cannon's page", upcomingFor(d, 'c', { from: FROM }).length === 1)
  check("and not on Hadley's", upcomingFor(d, 'h', { from: FROM }).length === 0)
}

section('today is excluded — it is already shown above')
{
  const d = base()
  d.events = [ev('e1', FROM, 'Today thing'), ev('e2', '2026-08-08', 'Tomorrow thing')]
  const up = upcomingFor(d, 'h', { from: FROM })
  check('today is not repeated', !up.some((e) => e.title === 'Today thing'))
  check('tomorrow is included', up.some((e) => e.title === 'Tomorrow thing'))
}

section('ordering, window and limit')
{
  const d = base()
  d.events = [
    ev('e3', '2026-09-01', 'Late'),
    ev('e1', '2026-08-08', 'Soon'),
    ev('e2', '2026-08-15', 'Middle'),
  ]
  const up = upcomingFor(d, 'h', { from: FROM })
  check('soonest first', up.map((e) => e.title).join() === 'Soon,Middle,Late', up.map((e) => e.title).join())

  d.events.push(ev('e4', '2026-12-25', 'Christmas'))
  check('beyond the window is dropped', !upcomingFor(d, 'h', { from: FROM }).some((e) => e.title === 'Christmas'))
  check('a wider window finds it',
    upcomingFor(d, 'h', { from: FROM, days: 200 }).some((e) => e.title === 'Christmas'))
  check('the limit is respected', upcomingFor(d, 'h', { from: FROM, limit: 2 }).length === 2)
  check('nothing scheduled gives an empty list', upcomingFor(base(), 'h', { from: FROM }).length === 0)
}

section('weekly recurrence expands into the window')
{
  const d = base()
  // A Monday swim practice. eventsOn resolves recurrence a day at a time, which
  // is the whole reason upcomingFor walks days rather than filtering a list.
  d.events = [{ ...ev('r1', '2026-08-03', 'Swim practice', ['h'], '16:00'), recur: 'weekly' as const }]
  const up = upcomingFor(d, 'h', { from: FROM, days: 21, limit: 10 })
  check('future Mondays appear', up.length >= 2, `got ${up.length}`)
  check('each on a Monday', up.every((e) => new Date(`${e.date}T00:00:00`).getDay() === 1),
    up.map((e) => e.date).join())
  check('dates are distinct', new Set(up.map((e) => e.date)).size === up.length)
  check('the date is the occurrence, not the original',
    !up.some((e) => e.date === '2026-08-03'))
}

console.log(`\n${checks - failures}/${checks} checks passed`)
if (failures) {
  console.log(`${failures} FAILED`)
  process.exit(1)
}
