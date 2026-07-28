/**
 * Works out why Realtime reaches SUBSCRIBED but delivers nothing.
 *
 * Opens two channels on public.lists — one filtered by household_id exactly as
 * cloudSync does, one with no filter at all — then performs an INSERT, an
 * UPDATE and a DELETE, and reports which events each channel saw.
 *
 * The pattern of what arrives identifies the cause:
 *
 *   nothing at all, on either channel   -> Realtime can't read the rows:
 *                                          RLS/auth, or the table isn't
 *                                          actually in the publication
 *   unfiltered sees it, filtered doesn't -> the household_id filter is wrong
 *   INSERT arrives but UPDATE/DELETE don't -> REPLICA IDENTITY is not FULL
 *   everything arrives                   -> the bug is in cloudSync.subscribe
 *
 *   npx tsx scripts/realtime-debug.ts
 *
 * Uses the same env as cloud-smoke.ts. Creates one scratch row and removes it.
 */

import { createClient } from '@supabase/supabase-js'

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
  const sb = createClient(need('VITE_SUPABASE_URL'), need('VITE_SUPABASE_ANON_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })

  const { data: auth, error } = await sb.auth.signInWithPassword({
    email: need('CC_EMAIL'),
    password: need('CC_PASSWORD'),
  })
  if (error) throw new Error(`sign-in: ${error.message}`)
  const token = auth.session!.access_token
  console.log(`signed in as ${auth.user?.email}`)

  // supabase-js normally propagates the session to the realtime socket itself;
  // do it explicitly so an auth-propagation bug can't be the variable.
  await sb.realtime.setAuth(token)
  console.log('realtime auth token set explicitly')

  const { data: hu } = await sb.from('household_users').select('household_id').limit(1).maybeSingle()
  const hh = hu?.household_id as string
  console.log(`household: ${hh}\n`)

  const filtered: Seen[] = []
  const unfiltered: Seen[] = []

  const chFiltered = sb
    .channel('dbg-filtered')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'lists', filter: `household_id=eq.${hh}` },
      (p) => filtered.push({ event: p.eventType, id: (p.new as { id?: string })?.id ?? (p.old as { id?: string })?.id })
    )

  const chAll = sb
    .channel('dbg-unfiltered')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'lists' }, (p) =>
      unfiltered.push({ event: p.eventType, id: (p.new as { id?: string })?.id ?? (p.old as { id?: string })?.id })
    )

  const status = async (name: string, ch: typeof chFiltered) =>
    new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`${name}: never subscribed`)), 20000)
      ch.subscribe((s, err) => {
        console.log(`  ${name}: ${s}${err ? ` (${err.message})` : ''}`)
        if (s === 'SUBSCRIBED') {
          clearTimeout(t)
          resolve()
        }
        if (s === 'CHANNEL_ERROR' || s === 'TIMED_OUT') {
          clearTimeout(t)
          reject(new Error(`${name}: ${s} ${err?.message ?? ''}`))
        }
      })
    })

  console.log('subscribing')
  await Promise.all([status('filtered  ', chFiltered), status('unfiltered', chAll)])

  // Give the socket a moment to settle before generating traffic.
  await sleep(1500)

  const id = `rtdbg-${Date.now()}`
  console.log('\ngenerating traffic')

  const ins = await sb.from('lists').insert({ id, household_id: hh, name: 'realtime debug', sort_order: 999 })
  console.log(`  insert: ${ins.error ? `ERROR ${ins.error.message}` : 'ok'}`)
  await sleep(2500)

  const upd = await sb.from('lists').update({ name: 'realtime debug (updated)' }).eq('id', id)
  console.log(`  update: ${upd.error ? `ERROR ${upd.error.message}` : 'ok'}`)
  await sleep(2500)

  const del = await sb.from('lists').delete().eq('id', id)
  console.log(`  delete: ${del.error ? `ERROR ${del.error.message}` : 'ok'}`)
  await sleep(3000)

  // --- verdict ---------------------------------------------------------------

  const mine = (s: Seen[]) => s.filter((e) => e.id === id || e.id === undefined)
  const f = mine(filtered)
  const u = mine(unfiltered)

  console.log('\nresults')
  console.log(`  filtered   (household_id=eq.${hh}): ${f.length ? f.map((e) => e.event).join(', ') : 'NOTHING'}`)
  console.log(`  unfiltered                        : ${u.length ? u.map((e) => e.event).join(', ') : 'NOTHING'}`)

  console.log('\nverdict')
  const has = (s: Seen[], e: string) => s.some((x) => x.event === e)

  if (!f.length && !u.length) {
    console.log('  Realtime cannot read these rows at all.')
    console.log('  Most likely RLS: Realtime evaluates policies as the subscribing user,')
    console.log('  and an unauthenticated socket matches nothing. Check that public.lists')
    console.log('  is really in the publication, and that the access token reached the')
    console.log('  socket (this script sets it explicitly — cloudSync must too).')
  } else if (u.length && !f.length) {
    console.log('  The household_id filter is the problem — unfiltered works.')
    console.log('  Either correct the filter syntax or drop it and scope client-side.')
  } else {
    // Both channels saw traffic, so the connection and RLS are fine. Anything
    // missing from here is a per-event-type gap.
    if (has(u, 'DELETE') && !has(f, 'DELETE')) {
      console.log('  INSERT and UPDATE arrive on the filtered channel but DELETE does not.')
      console.log('  REPLICA IDENTITY is not FULL: the delete record carries only the')
      console.log('  primary key, so household_id is absent and the filter cannot match.')
      console.log('  Fix: alter table … replica identity full (schema.sql does this).')
    } else if (!has(f, 'UPDATE')) {
      console.log('  INSERT arrives but UPDATE does not — check REPLICA IDENTITY.')
    } else {
      console.log('  Realtime is delivering every event type correctly.')
      console.log('  If cloudSync.subscribe still sees nothing, the fault is there —')
      console.log('  most likely the socket never received the session access token.')
    }
  }

  await sb.removeAllChannels()
  await sb.auth.signOut()
  process.exit(0)
}

main().catch((e) => {
  console.error(`\nFAILED: ${e instanceof Error ? e.message : String(e)}`)
  process.exit(1)
})
