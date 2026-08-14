/**
 * Exercises the feed matcher that guards a destructive delete.
 *
 *   npx tsx scripts/feedmatch-test.ts
 */

import { resolveFeed } from '../src/lib/feedmatch.ts'

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

// The household's real feeds, as the sync job prints them.
const FEEDS = [
  { id: 'f1', name: 'School calendar (LCPS)' },
  { id: 'f2', name: 'Family' },
  { id: 'f3', name: 'MadLax' },
  { id: 'f4', name: 'Launches' },
]

// ---------------------------------------------------------------------------

section('a query that names one feed resolves to it')
{
  const r = resolveFeed(FEEDS, 'School calendar (LCPS)')
  check('exact name matches', r.ok && r.feed.id === 'f1', JSON.stringify(r))
  check('and reports how', r.ok && r.how === 'name')

  const byId = resolveFeed(FEEDS, 'f3')
  check('an id matches', byId.ok && byId.feed.name === 'MadLax')
  check('and reports how', byId.ok && byId.how === 'id')

  const sub = resolveFeed(FEEDS, 'LCPS')
  check('a unique substring matches', sub.ok && sub.feed.id === 'f1', JSON.stringify(sub))
  check('and reports how', sub.ok && sub.how === 'substring')
}

section('case and surrounding whitespace do not matter')
{
  for (const q of ['family', 'FAMILY', '  Family  ', '\tfamily\n']) {
    const r = resolveFeed(FEEDS, q)
    check(`${JSON.stringify(q)} finds Family`, r.ok && r.feed.id === 'f2', JSON.stringify(r))
  }
}

section('an exact name beats a substring — the bug that deletes the wrong calendar')
{
  // "Family" is a whole feed AND a substring of another. Without the tiering,
  // the substring pass would see two hits and refuse, or worse pick one.
  const overlapping = [
    { id: 'a', name: 'Family' },
    { id: 'b', name: 'Family (school)' },
  ]
  const r = resolveFeed(overlapping, 'Family')
  check('exact name wins outright', r.ok && r.feed.id === 'a', JSON.stringify(r))

  const r2 = resolveFeed(overlapping, 'school')
  check('the other is still reachable', r2.ok && r2.feed.id === 'b', JSON.stringify(r2))
}

section('anything less than one certain match is refused')
{
  const none = resolveFeed(FEEDS, 'Schoology')
  check('no match is refused', !none.ok && none.reason === 'no-match', JSON.stringify(none))

  // A substring hitting two feeds must not silently pick the first.
  const many = resolveFeed([...FEEDS, { id: 'f5', name: 'School lunch' }], 'School')
  check('an ambiguous substring is refused', !many.ok && many.reason === 'ambiguous', JSON.stringify(many))
  check('and names the candidates', !many.ok && many.candidates.length === 2,
    JSON.stringify(!many.ok ? many.candidates : []))

  const dupes = resolveFeed([{ id: 'x', name: 'Family' }, { id: 'y', name: 'family' }], 'Family')
  check('two feeds with the same name is ambiguous', !dupes.ok && dupes.reason === 'ambiguous')

  // A tie on an exact name must NOT fall through to the substring pass and get
  // "broken" by coincidence.
  const tie = resolveFeed([{ id: 'x', name: 'Family' }, { id: 'y', name: 'Family' }], 'Family')
  check('a tie is not broken by a weaker tier', !tie.ok && tie.reason === 'ambiguous', JSON.stringify(tie))
}

section('an empty query never matches anything')
{
  // The dangerous one: '' is a substring of every name, so a blank workflow
  // input must be rejected before the substring pass ever runs.
  for (const q of ['', '   ', '\n']) {
    const r = resolveFeed(FEEDS, q)
    check(`${JSON.stringify(q)} is refused`, !r.ok && r.reason === 'empty-query', JSON.stringify(r))
  }
  check('an empty list matches nothing', !resolveFeed([], 'Family').ok)
}

console.log(`\n${checks - failures}/${checks} checks passed`)
if (failures) {
  console.log(`${failures} FAILED`)
  process.exit(1)
}
