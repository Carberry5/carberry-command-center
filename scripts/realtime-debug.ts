/**
 * Works out why Realtime reaches SUBSCRIBED but delivers nothing.
 *
 * Phase 1 asks whether Realtime can deliver at all: two raw channels on
 * public.lists, one filtered by household_id and one not, against an INSERT,
 * an UPDATE and a DELETE.
 *
 * Phase 2 asks which *channel configuration* works, holding auth constant. It
 * subscribes several variants at once — a plain single-binding channel, a
 * topic name containing a colon, one channel carrying a binding for all 21
 * tables, and cloudSync's own subscribe() — then performs one UPDATE and
 * reports which ones woke up. Whatever differs between the variant that fires
 * and the one that doesn't is the bug.
 *
 *   npx tsx scripts/realtime-debug.ts
 *
 * Uses the same env as cloud-smoke.ts. Creates one scratch row and removes it.
 */

import { configureCloud, subscribe, WRITE_ORDER } from '../src/store/cloudSync.ts'
import type { RealtimeChannel } from '@supabase/supabase-js'

const need = (n: string): string => {
  const v = process.env[n]
  if (!v) {
    console.error(`missing ${n}`)
    process.exit(1)
  }
  return v
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

interface Seen {
  event: string
  id: unknown
}

async function main() {
  const sb = configureCloud(need('VITE_SUPABASE_URL'), need('VITE_SUPABASE_ANON_KEY'), {
    persistSession: false,
  })

  const { data: auth, error } = await sb.auth.signInWithPassword({
    email: need('CC_EMAIL'),
    password: need('CC_PASSWORD'),
  })
  if (error) throw new Error(`sign-in: ${error.message}`)
  await sb.realtime.setAuth(auth.session!.access_token)
  console.log(`signed in as ${auth.user?.email}, realtime token set`)

  const { data: hu } = await sb.from('household_users').select('household_id').limit(1).maybeSingle()
  const hh = hu?.household_id as string
  console.log(`household: ${hh}`)

  const filterFor = (table: string) =>
    table === 'households' ? `id=eq.${hh}` : `household_id=eq.${hh}`

  const waitSubscribed = (name: string, ch: RealtimeChannel) =>
    new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`${name}: never subscribed`)), 20000)
      ch.subscribe((s, err) => {
        if (s === 'SUBSCRIBED') {
          clearTimeout(t)
          console.log(`  ${name}: SUBSCRIBED`)
          resolve()
        } else if (s === 'CHANNEL_ERROR' || s === 'TIMED_OUT') {
          clearTimeout(t)
          console.log(`  ${name}: ${s}${err ? ` — ${err.message}` : ''}`)
          resolve() // record the failure, don't abort the whole run
        }
      })
    })

  // =========================================================================
  // Phase 1 — can Realtime deliver these rows at all?
  // =========================================================================

  console.log('\n=== phase 1: delivery ===')
  const filtered: Seen[] = []
  const unfiltered: Seen[] = []
  const idOf = (p: { new?: unknown; old?: unknown }) =>
    (p.new as { id?: string })?.id ?? (p.old as { id?: string })?.id

  const chFiltered = sb.channel('dbg-filtered').on(
    'postgres_changes',
    { event: '*', schema: 'public', table: 'lists', filter: `household_id=eq.${hh}` },
    (p) => filtered.push({ event: p.eventType, id: idOf(p) })
  )
  const chAll = sb
    .channel('dbg-unfiltered')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'lists' }, (p) =>
      unfiltered.push({ event: p.eventType, id: idOf(p) })
    )

  await Promise.all([waitSubscribed('filtered  ', chFiltered), waitSubscribed('unfiltered', chAll)])
  await sleep(1500)

  const id = `rtdbg-${Date.now()}`
  console.log('  traffic: insert, update, delete')
  await sb.from('lists').insert({ id, household_id: hh, name: 'realtime debug', sort_order: 999 })
  await sleep(2000)
  await sb.from('lists').update({ name: 'realtime debug (updated)' }).eq('id', id)
  await sleep(2000)
  await sb.from('lists').delete().eq('id', id)
  await sleep(2500)

  const mine = (s: Seen[]) => s.filter((e) => e.id === id || e.id === undefined)
  const f = mine(filtered)
  const u = mine(unfiltered)
  console.log(`  filtered  : ${f.length ? f.map((e) => e.event).join(', ') : 'NOTHING'}`)
  console.log(`  unfiltered: ${u.length ? u.map((e) => e.event).join(', ') : 'NOTHING'}`)

  await sb.removeChannel(chFiltered)
  await sb.removeChannel(chAll)

  if (!f.length && !u.length) {
    console.log('\nverdict: Realtime cannot read these rows at all — RLS or publication.')
    console.log('Phase 2 would tell us nothing while that is true. Stopping here.')
    await sb.auth.signOut()
    process.exit(0)
  }

  // =========================================================================
  // Phase 2 — which channel configuration actually receives?
  // =========================================================================

  console.log('\n=== phase 2: channel configuration ===')
  const hits: Record<string, number> = {
    'plain name, 1 binding': 0,
    'colon in topic name': 0,
    'plain name, 21 bindings': 0,
    'cloudSync.subscribe()': 0,
  }

  const chPlain = sb
    .channel('dbg-plain')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'lists', filter: filterFor('lists') },
      () => void hits['plain name, 1 binding']++
    )

  // supabase-js already prefixes the topic with "realtime:", so a second colon
  // may confuse topic routing. The name must not be one cloudSync itself uses,
  // or sb.channel() hands back this same already-subscribed channel and
  // subscribe() throws on .on().
  const chColon = sb
    .channel(`dbg:colon:${hh}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'lists', filter: filterFor('lists') },
      () => void hits['colon in topic name']++
    )

  let chMany = sb.channel('dbg-many')
  for (const table of WRITE_ORDER) {
    chMany = chMany.on(
      'postgres_changes',
      { event: '*', schema: 'public', table, filter: filterFor(table) },
      () => void hits['plain name, 21 bindings']++
    )
  }

  await Promise.all([
    waitSubscribed('plain     ', chPlain),
    waitSubscribed('colon     ', chColon),
    waitSubscribed('21 binding', chMany),
  ])

  // The real thing, exactly as the app calls it. subscribe() does its channel
  // setup in a detached async block, so a throw in there surfaces as an
  // unhandled rejection rather than here — catch it so the variant table still
  // gets printed.
  let subStatus = 'pending'
  let subError: string | null = null
  const onUnhandled = (err: unknown) => {
    subError = err instanceof Error ? err.message : String(err)
  }
  process.on('unhandledRejection', onUnhandled)
  process.on('uncaughtException', onUnhandled)

  const unsubscribe = subscribe(hh, () => void hits['cloudSync.subscribe()']++, {
    debounceMs: 50,
    onStatus: (s) => {
      subStatus = s
    },
  })
  const deadline = Date.now() + 20000
  while (subStatus !== 'SUBSCRIBED' && !subError && Date.now() < deadline) await sleep(250)
  console.log(`  cloudSync : ${subError ? `THREW — ${subError}` : subStatus}`)

  await sleep(2000)

  const id2 = `rtdbg2-${Date.now()}`
  console.log('  traffic: insert + update on public.lists')
  await sb.from('lists').insert({ id: id2, household_id: hh, name: 'variant probe', sort_order: 998 })
  await sleep(2000)
  await sb.from('lists').update({ name: 'variant probe (updated)' }).eq('id', id2)
  await sleep(4000)
  await sb.from('lists').delete().eq('id', id2)
  await sleep(2000)

  console.log('\nresults')
  for (const [label, n] of Object.entries(hits)) {
    console.log(`  ${n > 0 ? 'FIRED  ' : 'silent '} ${label}  (${n})`)
  }

  console.log('\nverdict')
  if (hits['plain name, 1 binding'] && !hits['colon in topic name']) {
    console.log('  The colon in the topic name breaks it. Rename the channel.')
  } else if (hits['plain name, 1 binding'] && !hits['plain name, 21 bindings']) {
    console.log('  Too many postgres_changes bindings on one channel. Split them,')
    console.log('  or use one channel per table.')
  } else if (hits['plain name, 21 bindings'] && !hits['cloudSync.subscribe()']) {
    console.log('  The configuration is fine — the bug is elsewhere in subscribe():')
    console.log('  timing, the auth token, or the unsubscribe path.')
  } else if (Object.values(hits).every((n) => n > 0)) {
    console.log('  Every variant received. subscribe() works here — so the failure in')
    console.log('  cloud-smoke is about when it subscribes relative to the write.')
  } else {
    console.log('  Mixed result — see the table above.')
  }

  process.off('unhandledRejection', onUnhandled)
  process.off('uncaughtException', onUnhandled)
  unsubscribe()
  await sb.removeAllChannels()
  await sb.auth.signOut()
  process.exit(0)
}

main().catch((e) => {
  console.error(`\nFAILED: ${e instanceof Error ? e.message : String(e)}`)
  process.exit(1)
})
