/**
 * Exercises cloudSync against the real Supabase project — the layer local
 * Postgres can't reach: PostgREST reads and writes, RLS under an actual JWT,
 * and Realtime.
 *
 * It signs in with email + password using the *anon* key, exactly as the app
 * will. It deliberately does not use the service role key, because that
 * bypasses RLS and would prove nothing about whether the app's own writes are
 * permitted.
 *
 *   export VITE_SUPABASE_URL=https://rdmlrmilkgalixiafbfg.supabase.co
 *   export VITE_SUPABASE_ANON_KEY=…
 *   export CC_EMAIL=you@example.com CC_PASSWORD=…
 *
 *   npx tsx scripts/cloud-smoke.ts           # read-only
 *   npx tsx scripts/cloud-smoke.ts --write   # + write / delete / realtime
 *   npx tsx scripts/cloud-smoke.ts --seed    # + seed an empty household
 *
 * --write creates one scratch list and removes it again. --seed only fires
 * when the household has no members, unless you add --force.
 */

import assert from 'node:assert/strict'
import { migrate } from '../src/data/migrate.ts'
import { seed } from '../src/data/seed.ts'
import {
  configureCloud,
  currentHouseholdId,
  loadSnapshot,
  pushChanges,
  subscribe,
} from '../src/store/cloudSync.ts'
import type { FamilyData } from '../src/types.ts'

const argv = new Set(process.argv.slice(2))
const WRITE = argv.has('--write') || argv.has('--seed')
const SEED = argv.has('--seed')
const FORCE = argv.has('--force')

const die = (msg: string): never => {
  console.error(msg)
  process.exit(1)
}

const need = (name: string): string => {
  const v = process.env[name]
  if (!v) die(`missing ${name} — see the header of this file`)
  // Catches a pasted placeholder, which otherwise fails much later and much
  // less legibly (Supabase just says "Invalid API key").
  if (/^(PASTE|YOUR|<|…|\.\.\.)/i.test(v!) || /_HERE$/i.test(v!)) {
    die(`${name} is still a placeholder ("${v}") — replace it with the real value`)
  }
  return v!
}

let passed = 0
const ok = (label: string) => {
  passed++
  console.log(`  ok: ${label}`)
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function main() {
  const url = need('VITE_SUPABASE_URL')
  const anon = need('VITE_SUPABASE_ANON_KEY')
  const email = need('CC_EMAIL')
  const password = need('CC_PASSWORD')

  // Both key generations: legacy JWTs (eyJ… / service_role) and the newer
  // sb_publishable_ / sb_secret_ pair.
  if (anon.includes('service_role') || anon.startsWith('sb_secret_')) {
    die('that is the secret / service_role key — use the anon (publishable) one')
  }
  if (!anon.startsWith('eyJ') && !anon.startsWith('sb_publishable_')) {
    die(
      `VITE_SUPABASE_ANON_KEY does not look like a Supabase key (starts "${anon.slice(0, 8)}"). ` +
        'Copy it from Project Settings -> API.'
    )
  }

  const sb = configureCloud(url, anon, { persistSession: false })
  console.log(`\ntarget: ${url}`)
  console.log(`mode:   ${SEED ? 'seed' : WRITE ? 'write' : 'read-only'}\n`)

  // --- auth ------------------------------------------------------------------

  console.log('auth')
  const { data: auth, error: authErr } = await sb.auth.signInWithPassword({ email, password })
  if (authErr) throw new Error(`sign-in failed: ${authErr.message}`)
  assert(auth.session, 'no session returned')
  ok(`signed in as ${auth.user?.email}`)

  const hh = await currentHouseholdId()
  assert(hh, 'no household linked to this user — see supabase/README.md')
  ok(`household resolves to "${hh}"`)

  // --- RLS actually applies --------------------------------------------------

  console.log('\nrls')
  const foreign = await sb.from('members').select('id').neq('household_id', hh).limit(1)
  assert.equal(foreign.error, null, `unexpected error: ${foreign.error?.message}`)
  assert.equal(foreign.data?.length ?? 0, 0, 'saw members outside our household')
  ok('cannot see members of any other household')

  const tokens = await sb.from('oauth_tokens').select('id').limit(1)
  assert(tokens.error, 'oauth_tokens was readable from the browser role')
  ok(`oauth_tokens refused: ${tokens.error.code ?? tokens.error.message}`)

  // --- read ------------------------------------------------------------------

  console.log('\nread')
  const base = migrate(seed())
  let snapshot = await loadSnapshot(hh, base)
  ok(
    `loadSnapshot: ${snapshot.members.length} members, ${snapshot.events.length} events, ` +
      `${snapshot.lists.length} lists, ${Object.keys(snapshot.done).length} logged days`
  )

  if (!WRITE) {
    console.log(`\n${passed} checks passed (read-only — pass --write to exercise writes)`)
    await sb.auth.signOut()
    return
  }

  // --- seed ------------------------------------------------------------------

  if (SEED) {
    console.log('\nseed')
    if (snapshot.members.length && !FORCE) {
      console.log('  skipped: household already has members (use --force to overwrite)')
    } else {
      const desired = migrate(seed())
      const mutations = await pushChanges(snapshot, desired, hh)
      const rows = mutations.reduce((n, m) => n + m.upsert.length + m.remove.length, 0)
      ok(`pushed ${rows} rows across ${mutations.length} tables`)

      snapshot = await loadSnapshot(hh, base)
      for (const key of Object.keys(desired) as (keyof FamilyData)[]) {
        if (key === 'feedEv') continue
        assert.deepEqual(snapshot[key], desired[key], `"${key}" did not survive the round trip`)
      }
      ok('every field read back identical to what was written')
    }
  }

  // --- write / update / delete ----------------------------------------------

  console.log('\nwrite')

  // A run that fails before cleanup leaves its scratch list behind, and they
  // accumulate. Sweep any strays from earlier runs first.
  const strays = snapshot.lists.filter((l) => l.id.startsWith('smoke-'))
  if (strays.length) {
    const swept = structuredClone(snapshot)
    swept.lists = swept.lists.filter((l) => !l.id.startsWith('smoke-'))
    await pushChanges(snapshot, swept, hh)
    snapshot = swept
    ok(`swept ${strays.length} leftover scratch list${strays.length === 1 ? '' : 's'}`)
  }

  const scratchId = `smoke-${Date.now()}`

  const withList = structuredClone(snapshot)
  withList.lists.push({
    id: scratchId,
    name: 'Smoke test',
    items: [
      { id: `${scratchId}-a`, text: 'first', done: false, by: snapshot.members[0]?.id ?? 'p' },
      { id: `${scratchId}-b`, text: 'second', done: false, by: snapshot.members[0]?.id ?? 'p' },
    ],
  })
  await pushChanges(snapshot, withList, hh)
  let after = await loadSnapshot(hh, base)
  const created = after.lists.find((l) => l.id === scratchId)
  assert(created, 'scratch list was not created')
  assert.equal(created.items.length, 2)
  ok('insert: list + 2 items round-tripped')

  const edited = structuredClone(after)
  const target = edited.lists.find((l) => l.id === scratchId)!
  target.items[0].done = true
  target.items[0].text = 'first (edited)'
  const editMutations = await pushChanges(after, edited, hh)
  assert.equal(editMutations.length, 1, 'editing one item should touch one table')
  assert.equal(editMutations[0].table, 'list_items')
  assert.equal(editMutations[0].upsert.length, 1, 'should upsert exactly one row')
  after = await loadSnapshot(hh, base)
  const reread = after.lists.find((l) => l.id === scratchId)!
  assert.equal(reread.items[0].done, true)
  assert.equal(reread.items[0].text, 'first (edited)')
  ok('update: one edited item -> one row written, read back correct')

  // Composite-key path: chore_log. This is the delete filter local Postgres
  // could only check the shape of.
  const today = new Date().toISOString().slice(0, 10)
  const logged = structuredClone(after)
  ;(logged.done[today] ??= {})[`${scratchId}|smoke`] = 1
  await pushChanges(after, logged, hh)
  after = await loadSnapshot(hh, base)
  assert.equal(after.done[today]?.[`${scratchId}|smoke`], 1, 'chore_log row missing')
  ok('composite-key insert: chore_log entry written')

  const unlogged = structuredClone(after)
  delete unlogged.done[today][`${scratchId}|smoke`]
  await pushChanges(after, unlogged, hh)
  after = await loadSnapshot(hh, base)
  assert.equal(after.done[today]?.[`${scratchId}|smoke`], undefined, 'chore_log row survived delete')
  ok('composite-key delete: PostgREST or=(and(…)) filter works')

  // --- realtime --------------------------------------------------------------

  console.log('\nrealtime')
  let fired = 0
  let status = 'pending'
  const unsubscribe = subscribe(hh, () => void fired++, {
    onStatus: (s) => {
      status = s
    },
  })

  const deadline = Date.now() + 20000
  while (status !== 'SUBSCRIBED' && Date.now() < deadline) await sleep(250)
  assert.equal(status, 'SUBSCRIBED', `channel never subscribed (last status: ${status})`)
  ok('channel reached SUBSCRIBED')

  const waitForEvent = async (from: number, label: string, ms = 15000) => {
    const deadline = Date.now() + ms
    while (fired === from && Date.now() < deadline) await sleep(250)
    assert(fired > from, label)
  }

  const ping = structuredClone(after)
  ping.lists.find((l) => l.id === scratchId)!.name = 'Smoke test (poked)'
  await pushChanges(after, ping, hh)
  after = ping

  await waitForEvent(
    0,
    'no realtime event arrived for an UPDATE. If the channel reached SUBSCRIBED, ' +
      'the socket is probably unauthenticated — Realtime evaluates RLS as the ' +
      'subscribing user and silently matches nothing.'
  )
  ok(`update notification received (${fired} event${fired === 1 ? '' : 's'})`)

  // --- cleanup, which doubles as the DELETE notification check ---------------

  console.log('\ncleanup')
  const beforeDelete = fired
  const cleaned = structuredClone(after)
  cleaned.lists = cleaned.lists.filter((l) => l.id !== scratchId)
  await pushChanges(after, cleaned, hh)

  const final = await loadSnapshot(hh, base)
  assert(!final.lists.some((l) => l.id === scratchId), 'scratch list survived cleanup')
  ok('cascade delete: scratch list and its items removed')

  // Deletes are the case default replica identity breaks: only the primary key
  // reaches the WAL, so household_id is missing and a household-filtered
  // subscription drops the event. Inserts and updates still arrive, which makes
  // this easy to miss.
  await waitForEvent(
    beforeDelete,
    'UPDATE notifications arrive but DELETE ones do not — the watched tables ' +
      'need REPLICA IDENTITY FULL, otherwise household_id is absent from the ' +
      'delete record and the household filter cannot match it.'
  )
  ok('delete notification received (replica identity is FULL)')

  unsubscribe()

  await sb.auth.signOut()
  console.log(`\nALL ${passed} CLOUD CHECKS PASSED`)
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(`\nFAILED: ${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
  })
