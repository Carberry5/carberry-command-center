/**
 * Exercises where a personal feed's events are allowed to appear.
 *
 * The rule is small but it has a failure mode in each direction: too strict and
 * Hadley's launches vanish from her own page, too loose and twelve rockets a
 * fortnight are back on the family week. Both are checked here, along with the
 * case that would quietly lose a calendar — personal with nobody to be personal
 * to.
 *
 *   npx tsx scripts/personalfeed-test.ts
 */

import { eventsOn, upcomingFor } from '../src/lib/selectors.ts'
import type { FamilyData, FamilyEvent, Feed } from '../src/types.ts'

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

const HADLEY = 'm-hadley'
const CANNON = 'm-cannon'
const DAY = '2026-09-15'

const ev = (id: string, title: string, date: string, memberIds: string[] = []): FamilyEvent => ({
  id,
  title,
  date,
  start: '19:00',
  dur: 60,
  memberIds,
  loc: '',
  recur: null,
})

/** A household with a launch feed and a school feed, both tagged to Hadley. */
function household(opts: { launchPersonal: boolean; launchMembers?: string[] }): FamilyData {
  const feeds: Feed[] = [
    {
      id: 'f-launch',
      name: 'Launches',
      url: 'spacedevs://launches',
      color: '#3D6DE8',
      status: 'ok',
      memberIds: opts.launchMembers ?? [HADLEY],
      personal: opts.launchPersonal,
    },
    { id: 'f-school', name: 'School', url: 'https://x/y.ics', color: '#31A05F', status: 'ok', memberIds: [HADLEY] },
  ]
  return {
    members: [
      { id: HADLEY, name: 'Hadley', color: '#8B5CF6', role: 'kid' },
      { id: CANNON, name: 'Cannon', color: '#0F8B8D', role: 'kid' },
    ],
    events: [ev('own-1', 'Dinner with Nana', DAY)],
    settings: { feeds },
    feedEv: {
      'f-launch': [ev('l-1', 'Falcon 9 · Starlink', DAY, opts.launchMembers ?? [HADLEY])],
      'f-school': [ev('s-1', 'Early dismissal', DAY, [HADLEY])],
    },
  } as unknown as FamilyData
}

const titles = (d: FamilyData, filter: string[] | null) => eventsOn(d, DAY, filter).map((e) => e.title)

// ---------------------------------------------------------------------------

section('a personal feed stays off the shared calendar')
{
  const d = household({ launchPersonal: true })
  const shared = titles(d, null)
  check('the launch is not on the family week', !shared.includes('Falcon 9 · Starlink'), JSON.stringify(shared))
  check('the school feed still is', shared.includes('Early dismissal'), JSON.stringify(shared))
  check("and so are the family's own events", shared.includes('Dinner with Nana'))
}

section("but appears when the calendar is filtered to whoever it belongs to")
{
  const d = household({ launchPersonal: true })
  const hers = titles(d, [HADLEY])
  check('filtering to Hadley shows it', hers.includes('Falcon 9 · Starlink'), JSON.stringify(hers))

  const his = titles(d, [CANNON])
  check('filtering to Cannon does not', !his.includes('Falcon 9 · Starlink'), JSON.stringify(his))

  // Multi-select: picking both must not hide it, and must not surface it for
  // the sibling either — the feed is in because Hadley is in.
  const both = titles(d, [HADLEY, CANNON])
  check('picking both still shows it', both.includes('Falcon 9 · Starlink'), JSON.stringify(both))
}

section("and on that person's own page")
{
  const d = household({ launchPersonal: true })
  const up = upcomingFor(d, HADLEY, { from: '2026-09-01', days: 30, limit: 10 }).map((e) => e.title)
  check('Hadley’s "coming up" has the launch', up.includes('Falcon 9 · Starlink'), JSON.stringify(up))
  check('and her school event', up.includes('Early dismissal'), JSON.stringify(up))
  check('and whole-family events', up.includes('Dinner with Nana'), JSON.stringify(up))

  const his = upcomingFor(d, CANNON, { from: '2026-09-01', days: 30, limit: 10 }).map((e) => e.title)
  check('Cannon’s does not have the launch', !his.includes('Falcon 9 · Starlink'), JSON.stringify(his))
  check('nor her school event', !his.includes('Early dismissal'), JSON.stringify(his))
  check('but does have whole-family events', his.includes('Dinner with Nana'), JSON.stringify(his))
}

section('a feed that is not personal is unaffected')
{
  const d = household({ launchPersonal: false })
  check('it is on the family week', titles(d, null).includes('Falcon 9 · Starlink'))
  check('and on her page', upcomingFor(d, HADLEY, { from: '2026-09-01', days: 30, limit: 10 })
    .some((e) => e.title === 'Falcon 9 · Starlink'))
  // Tagged to Hadley, so the sibling filter still excludes the event itself.
  check('and still not on Cannon’s filter', !titles(d, [CANNON]).includes('Falcon 9 · Starlink'))
}

section('personal with nobody to be personal to must not disappear')
{
  // The flag needs members to mean anything. If it were honoured with an empty
  // memberIds the feed would satisfy no view at all and the calendar would
  // silently lose it — a checkbox that deletes a feed.
  const d = household({ launchPersonal: true, launchMembers: [] })
  check('it is treated as an ordinary feed', titles(d, null).includes('Falcon 9 · Starlink'),
    JSON.stringify(titles(d, null)))
  check('and is visible under a filter too', titles(d, [CANNON]).includes('Falcon 9 · Starlink'))
  check('and on a page', upcomingFor(d, CANNON, { from: '2026-09-01', days: 30, limit: 10 })
    .some((e) => e.title === 'Falcon 9 · Starlink'))
}

console.log(`\n${checks - failures}/${checks} checks passed`)
if (failures) {
  console.log(`${failures} FAILED`)
  process.exit(1)
}
