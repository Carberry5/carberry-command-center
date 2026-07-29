/**
 * Pushes src/data/seed.ts into a live household.
 *
 * Editing seed.ts only affects a household that is empty — the store
 * deliberately does not run the seed over existing data, because that would
 * substitute demo content for the family's real content. So a change like "add
 * three chores" or "Rowan is 4, not 5" never reaches a household that is
 * already in use. This script is how it gets there without anyone retyping it.
 *
 * It writes through the same tested path the app uses: it loads a snapshot,
 * builds the FamilyData it wants the household to hold, and hands both to
 * cloudSync.pushChanges, which diffs them and sends the minimum. Nothing here
 * invents a write.
 *
 *   SUPABASE_URL=https://….supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=… \
 *   npx tsx scripts/seed-household.ts --household carberry [--mode refresh] [--apply]
 *
 * Nothing is written without --apply. The default is a dry run that prints the
 * exact mutations it would send.
 *
 * Modes, in increasing order of how much they will change:
 *
 *   add-missing   Insert entities the household does not have. Never modifies
 *                 or deletes anything that exists. The safe default.
 *
 *   refresh       add-missing, plus overwrite matched members and countdowns
 *                 from the seed. This is the mode that carries corrections —
 *                 ages, birthdays — onto rows that already exist.
 *
 *   replace       Make the household exactly equal the seed. Deletes everything
 *                 the seed does not contain, including the family's own chore
 *                 history, lists and Greenlight balances. Requires --force.
 *
 * What add-missing and refresh will never seed, because the seed's version is
 * demo content and the household's version is real:
 *
 *   done          chore history — seeded history would invent star balances
 *   redemptions   ditto
 *   mealPlan      what's actually for dinner this week
 *   fit           WHOOP / Oura numbers; scripts/sync-wearables.ts owns these
 *   gl            Greenlight balances are hand-entered real money
 *   settings.pin  never overwritten once set
 *
 * The service role key bypasses RLS, which is what lets this run with no
 * session. Run it from your own machine; it has no business in a browser.
 */

import { pathToFileURL } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import type { Chore, Countdown, FamilyData, FamilyEvent, Member } from '../src/types.ts'
import { seed } from '../src/data/seed.ts'
import { uid } from '../src/lib/dates.ts'
import { configureCloud, diff, loadSnapshot, pushChanges } from '../src/store/cloudSync.ts'

export type Mode = 'add-missing' | 'refresh' | 'replace'

const argv = process.argv.slice(2)
const flag = (name: string): string | undefined => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 ? argv[i + 1] : undefined
}
const has = (name: string) => argv.includes(`--${name}`)
const die = (m: string): never => {
  console.error(m)
  process.exit(1)
}
const need = (n: string): string => process.env[n] ?? die(`missing ${n}`)

// ---------------------------------------------------------------------------
// Natural keys
// ---------------------------------------------------------------------------

/**
 * Matching is by content, not by id. The seed mints a fresh uid() for
 * countdowns and favourites on every call, so an id comparison would insert a
 * duplicate set on every run. Names and titles are what a person would call
 * "the same chore", so they are what we compare.
 */
const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ')

const memberKey = (m: Member) => norm(m.name)
const eventKey = (e: FamilyEvent) => `${e.date}|${norm(e.title)}`
const choreKey = (c: Chore) => norm(c.title)
const countdownKey = (c: Countdown) => norm(c.title)

// ---------------------------------------------------------------------------
// Merge
// ---------------------------------------------------------------------------

interface MergeResult {
  merged: FamilyData
  notes: string[]
}

export function mergeSeed(live: FamilyData, fresh: FamilyData, mode: Mode): MergeResult {
  const notes: string[] = []
  const merged: FamilyData = structuredClone(live)

  const add = (what: string, n: number) => {
    if (n) notes.push(`  + ${n} ${what}`)
  }
  const upd = (what: string, n: number) => {
    if (n) notes.push(`  ~ ${n} ${what} updated`)
  }

  // --- members ------------------------------------------------------------
  // Everything else references member ids, and the household's ids need not
  // match the seed's presets — a member added in the app carries a uuid. So the
  // first job is a seed-id -> live-id map, and it has to be built before any
  // collection that mentions a member is merged.
  const liveByName = new Map(merged.members.map((m) => [memberKey(m), m]))
  const takenIds = new Set(merged.members.map((m) => m.id))
  const idMap = new Map<string, string>()

  let membersAdded = 0
  let membersUpdated = 0

  for (const sm of fresh.members) {
    const existing = liveByName.get(memberKey(sm))
    if (existing) {
      idMap.set(sm.id, existing.id)
      if (mode !== 'add-missing') {
        // The correction case: age, photo, colour. Name is the match key, and
        // links are the family's own, so neither is touched.
        const before = JSON.stringify([existing.age, existing.photo, existing.color])
        existing.age = sm.age
        existing.color = sm.color
        if (sm.photo) existing.photo = sm.photo
        if (JSON.stringify([existing.age, existing.photo, existing.color]) !== before) membersUpdated++
      }
      continue
    }
    // A preset id ('c', 'h') could already belong to a different person. Minting
    // a new one is cheaper than guessing which of the two is wrong.
    const id = takenIds.has(sm.id) ? uid() : sm.id
    takenIds.add(id)
    idMap.set(sm.id, id)
    merged.members.push({ ...structuredClone(sm), id })
    membersAdded++
  }
  add('member(s)', membersAdded)
  upd('member(s)', membersUpdated)

  /** Seed member ids -> this household's ids, dropping any that didn't resolve. */
  const remap = (ids: string[]) => ids.map((i) => idMap.get(i)).filter((i): i is string => !!i)
  const remapOne = (id: string | null | undefined) => (id ? idMap.get(id) ?? null : null)

  // --- events -------------------------------------------------------------
  const liveEvents = new Set(merged.events.map(eventKey))
  let eventsAdded = 0
  for (const se of fresh.events) {
    if (liveEvents.has(eventKey(se))) continue
    merged.events.push({ ...structuredClone(se), id: uid(), memberIds: remap(se.memberIds) })
    eventsAdded++
  }
  add('event(s)', eventsAdded)

  // --- chores -------------------------------------------------------------
  const liveChores = new Map(merged.chores.map((c) => [choreKey(c), c]))
  const choreIds = new Set(merged.chores.map((c) => c.id))
  let choresAdded = 0
  for (const sc of fresh.chores) {
    if (liveChores.has(choreKey(sc))) continue
    // Chore ids appear in the chore log as "<choreId>|<memberId>", so a
    // collision here would silently credit stars to the wrong task.
    const id = choreIds.has(sc.id) ? uid() : sc.id
    choreIds.add(id)
    merged.chores.push({ ...structuredClone(sc), id, memberIds: remap(sc.memberIds) })
    choresAdded++
  }
  add('chore(s)', choresAdded)

  // --- rewards, favourites, lists ----------------------------------------
  const liveRewards = new Set(merged.rewards.map((r) => norm(r.title)))
  const rewardIds = new Set(merged.rewards.map((r) => r.id))
  let rewardsAdded = 0
  for (const sr of fresh.rewards) {
    if (liveRewards.has(norm(sr.title))) continue
    const id = rewardIds.has(sr.id) ? uid() : sr.id
    rewardIds.add(id)
    merged.rewards.push({ ...sr, id })
    rewardsAdded++
  }
  add('reward(s)', rewardsAdded)

  const liveFavs = new Set(merged.favorites.map((f) => norm(f.name)))
  let favsAdded = 0
  for (const sf of fresh.favorites) {
    if (liveFavs.has(norm(sf.name))) continue
    merged.favorites.push({ ...sf, id: uid() })
    favsAdded++
  }
  add('meal favourite(s)', favsAdded)

  const liveLists = new Map(merged.lists.map((l) => [norm(l.name), l]))
  const listIds = new Set(merged.lists.map((l) => l.id))
  let listsAdded = 0
  let itemsAdded = 0
  for (const sl of fresh.lists) {
    const existing = liveLists.get(norm(sl.name))
    if (existing) {
      // The list is theirs now — only fill in items it doesn't have.
      const texts = new Set(existing.items.map((i) => norm(i.text)))
      for (const si of sl.items) {
        if (texts.has(norm(si.text))) continue
        existing.items.push({ ...si, id: uid(), by: remapOne(si.by) ?? '' })
        itemsAdded++
      }
      continue
    }
    const id = listIds.has(sl.id) ? uid() : sl.id
    listIds.add(id)
    merged.lists.push({
      ...sl,
      id,
      items: sl.items.map((i) => ({ ...i, id: uid(), by: remapOne(i.by) ?? '' })),
    })
    listsAdded++
    itemsAdded += sl.items.length
  }
  add('list(s)', listsAdded)
  add('list item(s)', itemsAdded)

  // --- countdowns ---------------------------------------------------------
  const liveCountdowns = new Map(merged.countdowns.map((c) => [countdownKey(c), c]))
  let countdownsAdded = 0
  let countdownsUpdated = 0
  for (const sc of fresh.countdowns) {
    const existing = liveCountdowns.get(countdownKey(sc))
    if (existing) {
      if (mode !== 'add-missing') {
        // The other correction case: a birthday that was a placeholder offset.
        const before = `${existing.date}|${existing.memberId}`
        existing.date = sc.date
        existing.memberId = remapOne(sc.memberId)
        if (`${existing.date}|${existing.memberId}` !== before) countdownsUpdated++
      }
      continue
    }
    merged.countdowns.push({ ...sc, id: uid(), memberId: remapOne(sc.memberId) })
    countdownsAdded++
  }
  add('countdown(s)', countdownsAdded)
  upd('countdown(s)', countdownsUpdated)

  // --- feeds --------------------------------------------------------------
  // Matched on URL: the same calendar renamed is still the same calendar, and a
  // second copy of a school feed would double every event on the calendar.
  const liveFeeds = new Set(merged.settings.feeds.map((f) => norm(f.url || f.name)))
  const feedIds = new Set(merged.settings.feeds.map((f) => f.id))
  let feedsAdded = 0
  for (const sf of fresh.settings.feeds) {
    if (liveFeeds.has(norm(sf.url || sf.name))) continue
    const id = feedIds.has(sf.id) ? uid() : sf.id
    feedIds.add(id)
    merged.settings.feeds.push({ ...sf, id, memberIds: remap(sf.memberIds ?? []) })
    feedsAdded++
  }
  add('feed(s)', feedsAdded)

  // --- household settings -------------------------------------------------
  // Location only when it's blank; the PIN never. An overwritten PIN locks the
  // family out of their own Settings page.
  if (!merged.settings.zip && !merged.settings.place) {
    merged.settings.zip = fresh.settings.zip
    merged.settings.lat = fresh.settings.lat
    merged.settings.lon = fresh.settings.lon
    merged.settings.place = fresh.settings.place
    notes.push('  + location (was blank)')
  }

  // --- preflight ----------------------------------------------------------
  let preflightAdded = 0
  for (const [seedMemberId, cfg] of Object.entries(fresh.preflight.kids ?? {})) {
    const mid = idMap.get(seedMemberId)
    if (!mid || merged.preflight.kids[mid]) continue
    merged.preflight.kids[mid] = structuredClone(cfg)
    preflightAdded++
  }
  add('pre-flight config(s)', preflightAdded)

  return { merged, notes }
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main() {
  const APPLY = has('apply')
  const FORCE = has('force')
  const household = flag('household') ?? die('--household is required (e.g. --household carberry)')
  const mode = (flag('mode') ?? 'add-missing') as Mode
  if (!['add-missing', 'refresh', 'replace'].includes(mode)) {
    die(`unknown --mode ${mode} (add-missing | refresh | replace)`)
  }
  if (mode === 'replace' && !FORCE) {
    die('--mode replace deletes everything the seed does not contain. Re-run with --force if that is what you want.')
  }

  const url = need('SUPABASE_URL')
  const key = need('SUPABASE_SERVICE_ROLE_KEY')

  // Point cloudSync's module client at the project with the service role key,
  // so loadSnapshot and pushChanges work here exactly as they do in the browser.
  configureCloud(url, key, { persistSession: false })
  const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })

  const { data: hh, error: hhErr } = await sb
    .from('households')
    .select('id')
    .eq('id', household)
    .maybeSingle()
  if (hhErr) throw new Error(`reading households: ${hhErr.message}`)
  if (!hh) {
    die(
      `no household "${household}". Existing ids:\n` +
        ((await sb.from('households').select('id')).data ?? [])
          .map((r) => `  ${r.id}`)
          .join('\n')
    )
  }

  const fresh = seed()
  const live = await loadSnapshot(household, fresh)

  const liveIsEmpty = !live.members.length
  console.log(`household ${household} — ${liveIsEmpty ? 'empty' : `${live.members.length} member(s), ${live.chores.length} chore(s), ${live.countdowns.length} countdown(s)`}`)
  console.log(`mode: ${mode}${APPLY ? '' : '  (dry run — nothing will be written)'}\n`)

  let target: FamilyData
  let notes: string[]
  if (mode === 'replace') {
    target = fresh
    notes = ['  household will be made identical to the seed']
  } else {
    ;({ merged: target, notes } = mergeSeed(live, fresh, mode))
  }

  if (notes.length) console.log(notes.join('\n'))
  else console.log('  nothing to add — the household already matches the seed')

  const mutations = diff(live, target, household)
  if (!mutations.length) {
    console.log('\nno changes')
    return
  }

  console.log('\nmutations:')
  for (const m of mutations) {
    const parts = []
    if (m.upsert.length) parts.push(`${m.upsert.length} upsert`)
    if (m.remove.length) parts.push(`${m.remove.length} delete`)
    console.log(`  ${m.table.padEnd(20)} ${parts.join(', ')}`)
  }

  if (!APPLY) {
    console.log('\ndry run — re-run with --apply to write')
    return
  }

  await pushChanges(live, target, household)
  console.log('\nwritten')

  // Read it back rather than trusting the write. A silent no-op here is exactly
  // the failure this script exists to avoid.
  const after = await loadSnapshot(household, fresh)
  const residual = diff(target, after, household)
  if (residual.length) {
    console.log('\nWARNING: the household does not match what was pushed. Residual difference:')
    for (const m of residual) {
      console.log(`  ${m.table}: ${m.upsert.length} upsert, ${m.remove.length} delete`)
    }
    process.exitCode = 1
  } else {
    console.log(`verified — ${after.members.length} member(s), ${after.chores.length} chore(s), ${after.countdowns.length} countdown(s)`)
  }
}

// Only when run as a script. mergeSeed is exported so scripts/seed-test.ts can
// exercise the merge rules without a database or a household.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(`\nFAILED: ${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
  })
}
