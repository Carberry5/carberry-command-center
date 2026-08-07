/**
 * Exercises src/lib/launches.ts against a recorded Launch Library 2 response.
 *
 * No network, deliberately: ll.thespacedevs.com is unreachable from the
 * development sandbox and only the scheduled job can actually call it. So the
 * mapping — the part that can be wrong in ways nobody notices — is tested
 * against a fixture, and the job proves the fetch on its first run.
 *
 * The fixture is trimmed real LL2 shape: a firm launch, a TBD one, one that
 * has already flown, one in the small hours UTC that lands on the previous
 * day locally, and one with no time at all.
 *
 *   npx tsx scripts/launches-test.ts
 */

import {
  isLaunchFeed,
  launchTitle,
  launchesApiUrl,
  launchesToEvents,
  launchPlace,
  type LaunchesResponse,
} from '../src/lib/launches.ts'

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

const FIXTURE: LaunchesResponse = {
  count: 5,
  results: [
    {
      id: 'aaa-111',
      name: 'Falcon 9 Block 5 | Starlink Group 10-5',
      net: '2026-08-12T18:45:00Z',
      status: { id: 1, abbrev: 'Go', name: 'Go for Launch' },
      launch_service_provider: { name: 'SpaceX' },
      mission: { name: 'Starlink Group 10-5' },
      pad: { name: 'SLC-40', location: { name: 'Cape Canaveral SFS, FL, USA' } },
    },
    {
      id: 'bbb-222',
      name: 'New Glenn | Blue Moon MK1',
      net: '2026-08-20T09:00:00Z',
      status: { id: 8, abbrev: 'TBC', name: 'To Be Confirmed' },
      launch_service_provider: { name: 'Blue Origin' },
      mission: { name: 'Blue Moon MK1' },
      pad: { name: 'LC-36', location: { name: 'Cape Canaveral SFS, FL, USA' } },
    },
    {
      id: 'ccc-333',
      name: 'Electron | Some Flight',
      net: '2026-08-01T12:00:00Z',
      status: { id: 3, abbrev: 'Success', name: 'Launch Successful' },
      launch_service_provider: { name: 'Rocket Lab' },
      pad: { location: { name: 'Mahia, New Zealand' } },
    },
    {
      // 01:30 UTC on the 15th is 21:30 on the 14th in Virginia. Slicing the
      // ISO string would file this a day late.
      id: 'ddd-444',
      name: 'Atlas V 551 | ViaSat-3',
      net: '2026-08-15T01:30:00Z',
      status: { id: 1, abbrev: 'Go' },
      launch_service_provider: { name: 'ULA' },
      pad: { location: { name: 'Cape Canaveral SFS, FL, USA' } },
    },
    {
      id: 'eee-555',
      name: 'Long March 5 | Unknown Payload',
      status: { id: 2, abbrev: 'TBD' },
      launch_service_provider: { name: 'CASC' },
    },
  ],
}

// ---------------------------------------------------------------------------

section('mapping a recorded response')
{
  const ev = launchesToEvents(FIXTURE, { tz: 'America/New_York' })
  check('the flown launch is dropped', !ev.some((e) => e.title.includes('Some Flight')))
  check('the launch with no time is dropped', !ev.some((e) => e.title.includes('Unknown Payload')))
  check('three launches remain', ev.length === 3, `got ${ev.length}`)
  check('all are read-only-shaped events', ev.every((e) => e.recur === null && e.dur === null))
  check('none is tagged to a member — the feed does that', ev.every((e) => e.memberIds.length === 0))
}

section('the UTC-to-local conversion')
{
  const ev = launchesToEvents(FIXTURE, { tz: 'America/New_York' })
  const starlink = ev.find((e) => e.title.includes('Starlink'))!
  check('an afternoon UTC launch keeps its day', starlink.date === '2026-08-12', starlink.date)
  check('and shifts four hours back', starlink.start === '14:45', String(starlink.start))

  // The one that would be filed a day late by a naive ISO slice.
  const viasat = ev.find((e) => e.title.includes('ViaSat'))!
  check('a 01:30 UTC launch moves to the previous local day', viasat.date === '2026-08-14', viasat.date)
  check('at 9:30 in the evening', viasat.start === '21:30', String(viasat.start))
}

section('a firm launch reads differently from a guess')
{
  const ev = launchesToEvents(FIXTURE, { tz: 'America/New_York' })
  const go = ev.find((e) => e.title.includes('Starlink'))!
  const tbc = ev.find((e) => e.title.includes('Blue Moon'))!
  check('a Go launch is not marked TBD', !go.title.includes('TBD'), go.title)
  check('an unconfirmed one is', tbc.title.includes('TBD'), tbc.title)
  check('both carry the rocket emoji', go.title.startsWith('🚀') && tbc.title.startsWith('🚀'))
}

section('titles and places are trimmed for a small screen')
{
  check('the mission wins over the rocket',
    launchTitle({ name: 'Falcon 9 Block 5 | Starlink Group 10-5', mission: { name: 'Starlink Group 10-5' } })
      === 'Starlink Group 10-5')
  check('with no mission, the half after the pipe is used',
    launchTitle({ name: 'New Shepard | NS-27' }) === 'NS-27')
  check('a name with no pipe survives whole',
    launchTitle({ name: 'Artemis II' }) === 'Artemis II')
  check('the place drops the state and country',
    launchPlace({ pad: { location: { name: 'Cape Canaveral SFS, FL, USA' } } }) === 'Cape Canaveral SFS',
    launchPlace({ pad: { location: { name: 'Cape Canaveral SFS, FL, USA' } } }))
  check('the pad is the fallback',
    launchPlace({ pad: { name: 'LC-39A' } }) === 'LC-39A')
}

section('ids are derived, so a re-sync is a no-op')
{
  const a = launchesToEvents(FIXTURE, { tz: 'America/New_York' })
  const b = launchesToEvents(FIXTURE, { tz: 'America/New_York' })
  check('two runs produce identical ids', a.map((e) => e.id).join() === b.map((e) => e.id).join())
  check('the id comes from the LL2 id', a[0].id === 'll2:aaa-111', a[0].id)
  const ids = a.map((e) => e.id)
  check('no duplicate ids', new Set(ids).size === ids.length)
}

section('the limit is respected and capped')
{
  check('default limit applies', launchesToEvents(FIXTURE, { limit: 2 }).length === 2)
  check('a feed url with no query gets the default',
    launchesApiUrl('spacedevs://launches').includes('limit=12'))
  check('an explicit limit is honoured',
    launchesApiUrl('spacedevs://launches?limit=5').includes('limit=5'))
  // LL2 rate-limits unauthenticated callers; an unbounded limit is how you
  // get a 429 and a calendar that silently stops updating.
  check('a silly limit is capped at 30',
    launchesApiUrl('spacedevs://launches?limit=500').includes('limit=30'))
  check('a nonsense limit falls back',
    launchesApiUrl('spacedevs://launches?limit=abc').includes('limit=12'))
}

section('feed detection')
{
  check('recognises the scheme', isLaunchFeed('spacedevs://launches'))
  check('case-insensitively', isLaunchFeed('SpaceDevs://launches'))
  check('with a query', isLaunchFeed('spacedevs://launches?limit=6'))
  check('an https ics is not one', !isLaunchFeed('https://example.test/cal.ics'))
  check('empty is not one', !isLaunchFeed(''))
}

section('a malformed response does not throw')
{
  check('no results key', launchesToEvents({}).length === 0)
  check('empty results', launchesToEvents({ results: [] }).length === 0)
  check('a record with an unparseable time is skipped',
    launchesToEvents({ results: [{ id: 'x', name: 'Bad', net: 'not-a-date' }] }).length === 0)
}

console.log(`\n${checks - failures}/${checks} checks passed`)
if (failures) {
  console.log(`${failures} FAILED`)
  process.exit(1)
}
