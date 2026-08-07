/**
 * Exercises src/lib/winddown.ts. No database, no network, no clock — every
 * check passes an explicit Date, because a bedtime feature that only behaves
 * correctly at the hour the suite happens to run is not tested.
 *
 * What it guards against, worst first:
 *
 *   - the school-night range being copied from preflight (Mon–Fri), which puts
 *     the wind-down on Friday night and skips Sunday night: wrong at both ends
 *   - the evening teeth tick sharing the morning's chore id, so ticking one
 *     ticks the other on the same day
 *   - the panel showing all day, or at 3pm, or on a Saturday
 *   - a missed bedtime reading as "23 hours to go" by wrapping past midnight
 *
 *   npx tsx scripts/winddown-test.ts
 */

import type { WindDown } from '../src/types.ts'
import { preflightRows } from '../src/lib/preflight.ts'
import {
  emptyWindDown,
  minutesUntil,
  windDownActive,
  windDownRows,
  windDownWindow,
} from '../src/lib/winddown.ts'

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

/** 2026-08-02 is a Sunday, so +n lands on a known weekday. */
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const at = (dow: number, hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number)
  return new Date(2026, 7, 2 + dow, h, m)
}

const wd = (over: Partial<WindDown> = {}): WindDown => ({ ...emptyWindDown(), ...over })

// ---------------------------------------------------------------------------

section('school nights are the nights before school days')
{
  // Sun–Thu. Not Fri (no school Saturday), and Sunday must be included
  // (school Monday) — the two ends that a copy of preflight's Mon–Fri gets
  // exactly backwards.
  const expected: Record<number, boolean> = { 0: true, 1: true, 2: true, 3: true, 4: true, 5: false, 6: false }
  for (let d = 0; d <= 6; d++) {
    check(
      `${DAYS[d]} ${expected[d] ? 'is' : 'is not'} a school night`,
      windDownActive(wd(), d) === expected[d]
    )
  }
  check('Friday night is excluded', windDownActive(wd(), 5) === false)
  check('Sunday night is included', windDownActive(wd(), 0) === true)
  check('switched off means never', [0, 1, 2, 3, 4].every((d) => !windDownActive(wd({ open: false }), d)))
}

section('the defaults are what was asked for')
{
  const rows = windDownRows(wd())
  check('bedtime is 8:30pm', emptyWindDown().bedtime === '20:30')
  check('screens off at 8pm', emptyWindDown().screensOff === '20:00')
  check('screens off carries its deadline', rows.find((r) => r.key === 'wds')?.by === '20:00')
  check('in bed carries the bedtime', rows.find((r) => r.key === 'wdb')?.by === '20:30')
  check('teeth are on the list', rows.some((r) => r.text === 'Brush teeth'))
  check('in bed is last', rows[rows.length - 1].key === 'wdb')
}

section('changing the times changes the checklist, with no migration')
{
  const rows = windDownRows(wd({ bedtime: '21:00', screensOff: '19:30' }))
  check('screens-off deadline follows', rows.find((r) => r.key === 'wds')?.by === '19:30')
  check('bedtime deadline follows', rows.find((r) => r.key === 'wdb')?.by === '21:00')
}

section('evening teeth are not the morning tick')
{
  // Both halves of "Brush teeth (AM & PM)" fall on the same calendar day, and
  // the done-map is keyed by day — so a shared key would make the evening box
  // look ticked at breakfast.
  const morning = preflightRows({ gym: [], lun: [1, 2, 3, 4, 5], bring: [] }, 2)
  const evening = windDownRows(wd())
  const mKeys = new Set(morning.map((r) => r.key).filter(Boolean) as string[])
  const eKeys = evening.map((r) => r.key)
  const shared = eKeys.filter((k) => mKeys.has(k))
  check('no key is shared with the morning checklist', shared.length === 0, JSON.stringify(shared))
  check("the morning does use the c1 chore id", mKeys.has('c1'))
  check("the evening does not", !eKeys.includes('c1'))
}

section('extra steps sit between the built-ins')
{
  const rows = windDownRows(wd({ steps: [{ id: 'x1', text: 'Read for 15 minutes' }] }))
  const i = rows.findIndex((r) => r.text === 'Read for 15 minutes')
  check('the step is present', i >= 0)
  check('it is after brush teeth', i > rows.findIndex((r) => r.key === 'wdt'))
  check('and before in bed', i < rows.findIndex((r) => r.key === 'wdb'))
  check('its key is namespaced', rows[i].key === 'wdx1' || rows[i].key.startsWith('wdx'))
}

section('minutesUntil does not wrap past midnight')
{
  check('30 minutes before', minutesUntil(at(1, '20:00'), '20:30') === 30)
  check('exactly on time', minutesUntil(at(1, '20:30'), '20:30') === 0)
  // The bug this pins: wrapping would turn 21:00 into "23h 30m until 20:30"
  // and render a missed bedtime as a relaxed countdown.
  check('after the time is negative', minutesUntil(at(1, '21:00'), '20:30') === -30,
    String(minutesUntil(at(1, '21:00'), '20:30')))
  check('an hour past is -60', minutesUntil(at(1, '21:30'), '20:30') === -60)
}

section('the panel window')
{
  const c = wd()
  check('not at breakfast', !windDownWindow(c, at(1, '07:30')))
  check('not mid-afternoon', !windDownWindow(c, at(1, '15:00')))
  check('opens an hour before screens off', windDownWindow(c, at(1, '19:00')))
  check('not two hours before', !windDownWindow(c, at(1, '18:30')))
  check('showing at screens-off', windDownWindow(c, at(1, '20:00')))
  check('showing at bedtime', windDownWindow(c, at(1, '20:30')))
  check('still showing half an hour late', windDownWindow(c, at(1, '21:00')))
  check('gone by 90 minutes late', !windDownWindow(c, at(1, '22:00')))
  check('never on a Friday night', !windDownWindow(c, at(5, '20:00')))
  check('never on a Saturday night', !windDownWindow(c, at(6, '20:00')))
  check('yes on a Sunday night', windDownWindow(c, at(0, '20:00')))
  check('off means never', !windDownWindow(wd({ open: false }), at(1, '20:00')))
}

section('the window follows custom times')
{
  const late = wd({ bedtime: '21:30', screensOff: '21:00' })
  check('closed at 19:00 when screens off is 21:00', !windDownWindow(late, at(1, '19:00')))
  check('open at 20:00', windDownWindow(late, at(1, '20:00')))
  check('open at 21:30', windDownWindow(late, at(1, '21:30')))
  check('closed at 23:00', !windDownWindow(late, at(1, '23:00')))
}

console.log(`\n${checks - failures}/${checks} checks passed`)
if (failures) {
  console.log(`${failures} FAILED`)
  process.exit(1)
}
