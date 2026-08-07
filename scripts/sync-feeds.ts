/**
 * Fetches every household's ICS feeds and writes the events into Supabase.
 *
 * This exists because school calendars refuse browser requests — the app can't
 * fetch them directly at any price, which is what the vault sidecar used to
 * solve. A scheduled GitHub Action solves the same problem without a server to
 * keep running.
 *
 * It uses the service role key, which bypasses RLS. That is appropriate here
 * (it must write on behalf of every household, with no session) and unsafe
 * anywhere a browser can see it — hence a real Actions *secret*, never a
 * VITE_-prefixed variable.
 *
 *   SUPABASE_URL=https://….supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=… \
 *   npx tsx scripts/sync-feeds.ts [--dry-run]
 */

import './env.ts'
import { createClient } from '@supabase/supabase-js'
import { parseIcs } from '../src/lib/ics.ts'
import { isLaunchFeed, launchesApiUrl, launchesToEvents, type LaunchesResponse } from '../src/lib/launches.ts'
import type { FamilyEvent } from '../src/types.ts'

const DRY_RUN = process.argv.includes('--dry-run')

const need = (name: string): string => {
  const v = process.env[name]
  if (!v) {
    console.error(`missing ${name}`)
    process.exit(1)
  }
  return v
}

interface FeedRow {
  id: string
  household_id: string
  name: string
  url: string
  op_ref: string | null
}

/** Feed rows are user-supplied, so the URL is checked before it's fetched. */
function usableUrl(feed: FeedRow): string | null {
  const url = (feed.url ?? '').trim()
  if (!url) return null
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  // webcal:// is how calendars are usually advertised; it is https underneath.
  if (parsed.protocol === 'webcal:') {
    parsed.protocol = 'https:'
    return parsed.toString()
  }
  return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.toString() : null
}

/**
 * Module-scoped so the helpers below don't have to name the client's type,
 * which createClient's generics make awkward to write down accurately.
 */
let sb: ReturnType<typeof makeClient>

const makeClient = () =>
  createClient(need('SUPABASE_URL'), need('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  })

/**
 * One retry on a timeout or a 5xx, because the alternative is a feed that goes
 * red for three hours over a single slow response. Deliberately not a general
 * retry: a 404 or a 401 will not improve by asking again.
 */
async function fetchWithRetry(url: string, timeoutMs: number): Promise<Response> {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(timeoutMs),
      })
      if (res.status >= 500 && attempt === 1) {
        console.log(`    (${res.status}, retrying once)`)
        continue
      }
      return res
    } catch (err) {
      if (attempt > 1) throw err
      console.log(`    (${err instanceof Error ? err.message : String(err)}, retrying once)`)
    }
  }
}

async function main() {
  sb = makeClient()

  const { data: feeds, error } = await sb
    .from('feeds')
    .select('id, household_id, name, url, op_ref')
    .order('household_id')
  if (error) throw new Error(`reading feeds: ${error.message}`)

  if (!feeds?.length) {
    console.log('no feeds configured — nothing to do')
    return
  }

  console.log(`${feeds.length} feed(s)${DRY_RUN ? ' — dry run, nothing will be written' : ''}\n`)
  let failures = 0

  for (const feed of feeds as FeedRow[]) {
    const label = `${feed.household_id}/${feed.name || feed.id}`

    // op:// references resolve through the 1Password CLI, which isn't present
    // in Actions. Those feeds stay a local-sidecar concern for now.
    if (!feed.url && feed.op_ref) {
      console.log(`  ${label}: skipped (url is a 1Password reference)`)
      continue
    }

    // A `spacedevs://launches` feed is not a calendar to fetch — it is the
    // Launch Library 2 API. Handled here rather than as a separate job so it
    // inherits member tagging, the calendar merge and the status line.
    if (isLaunchFeed(feed.url)) {
      try {
        // 90 seconds, and one retry. Launch Library 2 is a free community API
        // and a cold query regularly takes most of a minute — the first live
        // run of this hit exactly the 30s ICS timeout and aborted, which reads
        // like a broken integration when it is only a slow one. A calendar
        // that refreshes every three hours can afford to wait.
        const res = await fetchWithRetry(launchesApiUrl(feed.url), 90000)
        if (!res.ok) throw new Error(`responded ${res.status}`)
        const events = launchesToEvents((await res.json()) as LaunchesResponse)
        console.log(`  ${label}: ${events.length} launch(es)`)
        if (DRY_RUN) continue
        await replaceFeedEvents(feed, events)
        await setStatus(feed, `${events.length} launches · synced ${stamp()}`)
      } catch (err) {
        failures++
        const msg = err instanceof Error ? err.message : String(err)
        console.log(`  ${label}: FAILED — ${msg}`)
        if (!DRY_RUN) await setStatus(feed, `Sync failed: ${msg}`.slice(0, 200))
      }
      continue
    }

    const url = usableUrl(feed)
    if (!url) {
      console.log(`  ${label}: skipped (no usable http(s) url)`)
      await setStatus(feed, 'No usable URL')
      continue
    }

    try {
      const res = await fetch(url, {
        headers: { accept: 'text/calendar,text/plain,*/*' },
        redirect: 'follow',
        signal: AbortSignal.timeout(30000),
      })
      if (!res.ok) throw new Error(`responded ${res.status}`)

      const events = parseIcs(await res.text())
      console.log(`  ${label}: ${events.length} event(s)`)
      if (DRY_RUN) continue

      await replaceFeedEvents(feed, events)
      await setStatus(feed, `${events.length} events · synced ${stamp()}`)
    } catch (err) {
      failures++
      const msg = err instanceof Error ? err.message : String(err)
      console.log(`  ${label}: FAILED — ${msg}`)
      // Surface it in Settings rather than only in a log nobody reads.
      if (!DRY_RUN) await setStatus(feed, `Sync failed: ${msg}`.slice(0, 200))
    }
  }

  if (failures) {
    console.log(`\n${failures} feed(s) failed`)
    // A feed that 404s is the family's problem to fix, not a broken job — but
    // it should still be visible as a red run rather than passing quietly.
    process.exitCode = 1
  } else {
    console.log('\nall feeds synced')
  }
}

const stamp = () =>
  new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

/**
 * Replaces a feed's events wholesale. They're a cache with no user-authored
 * content, so deleting and reinserting avoids trying to diff two sets of events
 * that carry no stable upstream identity.
 */
async function replaceFeedEvents(feed: FeedRow, events: FamilyEvent[]) {
  const { error: delErr } = await sb
    .from('feed_events')
    .delete()
    .eq('household_id', feed.household_id)
    .eq('feed_id', feed.id)
  if (delErr) throw new Error(`clearing old events: ${delErr.message}`)

  if (!events.length) return

  const rows = events.map((e, i) => ({
    // Deterministic per feed and position, so a re-run doesn't churn ids.
    id: `${feed.id}:${i}`,
    household_id: feed.household_id,
    feed_id: feed.id,
    title: e.title,
    date: e.date,
    start_time: e.start,
    dur: e.dur,
    loc: e.loc,
    recur: e.recur,
    sort_order: i,
  }))

  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await sb.from('feed_events').insert(rows.slice(i, i + 500))
    if (error) throw new Error(`writing events: ${error.message}`)
  }
}

async function setStatus(feed: FeedRow, status: string) {
  const { error } = await sb.from('feeds').update({ status }).eq('id', feed.id)
  if (error) console.log(`  (could not update status: ${error.message})`)
}

main().catch((err) => {
  console.error(`\nFAILED: ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
})
