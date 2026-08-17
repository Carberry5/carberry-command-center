/**
 * Exercises the "is that table simply not there yet?" predicate.
 *
 * This one is asymmetric, and the asymmetry is the whole point. Answering
 * `true` too readily is the expensive mistake: loadSnapshot then treats a real
 * failure as an empty table, and the family watches their data appear to
 * vanish. Answering `false` too readily costs a fallback to local mode, which
 * is what we already had.
 *
 * So the cases below lean hard on the errors that must NOT be mistaken for a
 * missing table.
 *
 *   npx tsx scripts/missingtable-test.ts
 */

import { isMissingTable } from '../src/store/cloudSync.ts'

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

// ---------------------------------------------------------------------------

section('a table the database has not got yet')
{
  // Exactly what PostgREST returned when pickem_games shipped ahead of the
  // migration — the incident this predicate exists for.
  check(
    'PGRST205 by code',
    isMissingTable({ code: 'PGRST205', message: "Could not find the table 'public.pickem_games' in the schema cache" })
  )
  check('the message alone is enough', isMissingTable({ message: "Could not find the table 'public.pickem_picks' in the schema cache" }))
  check('case does not matter', isMissingTable({ message: 'COULD NOT FIND THE TABLE public.x' }))
  check('a relation-does-not-exist phrasing', isMissingTable({ message: 'relation "public.pickem_games" does not exist' }))
}

section('everything else must still fail loudly')
{
  // These do not get better by running a migration, so swallowing them as an
  // empty table would hide a real fault behind missing data.
  check('permission denied', !isMissingTable({ code: '42501', message: 'permission denied for table events' }))
  check('RLS refusing the row', !isMissingTable({ code: '42501', message: 'new row violates row-level security policy' }))
  check('a bad JWT', !isMissingTable({ code: 'PGRST301', message: 'JWT expired' }))
  check('a network failure', !isMissingTable({ message: 'Failed to fetch' }))
  check('a timeout', !isMissingTable({ message: 'canceling statement due to statement timeout' }))
  check('a syntax error', !isMissingTable({ code: '42601', message: 'syntax error at or near "select"' }))

  // The near-miss that matters most: a missing *column* is also a schema skew,
  // but the table is there and its rows are real. Reporting the whole table as
  // empty would throw away data that exists.
  check('a missing column is not a missing table',
    !isMissingTable({ code: '42703', message: 'column feeds.personal does not exist' }),
    'this would blank a table that has rows in it')
}

section('degenerate input')
{
  check('null is not a missing table', !isMissingTable(null))
  check('an empty object is not', !isMissingTable({}))
  check('an empty message is not', !isMissingTable({ message: '' }))
}

console.log(`\n${checks - failures}/${checks} checks passed`)
if (failures) {
  console.log(`${failures} FAILED`)
  process.exit(1)
}
