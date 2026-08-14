/**
 * Removes a calendar feed, and the events it pulled in, from Supabase.
 *
 * Settings → Integrations already does this from the app, which is the normal
 * way. This exists for the case where the app isn't to hand — the feed sync
 * runs on a schedule with no human present, and a feed that has gone
 * permanently bad (a school calendar whose URL was retired, say) is best
 * removed from wherever you happen to be.
 *
 * It uses the service role key and so bypasses RLS. Two things follow from
 * that, and both are load-bearing:
 *
 *   - the query must identify exactly ONE feed or nothing happens. Matching is
 *     in src/lib/feedmatch.ts, pure and tested, because "delete the feed whose
 *     name contains X" is precisely the kind of thing that quietly takes the
 *     wrong calendar with it.
 *   - it prints what it is about to delete, and --dry-run stops there.
 *
 * feed_events has `on delete cascade` on feed_id, so removing the feed row
 * takes its events with it; the count is read first purely so the log says how
 * much went.
 *
 *   SUPABASE_URL=https://….supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=… \
 *   npx tsx scripts/delete-feed.ts "School calendar (LCPS)" [--dry-run]
 */

import './env.ts'
import { createClient } from '@supabase/supabase-js'
import { resolveFeed } from '../src/lib/feedmatch.ts'

const args = process.argv.slice(2)
const DRY_RUN = args.includes('--dry-run')
const query = args.filter((a) => !a.startsWith('--')).join(' ').trim() || (process.env.FEED ?? '').trim()

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
  status: string
}

async function main() {
  if (!query) {
    console.error('usage: delete-feed.ts "<feed name or id>" [--dry-run]')
    process.exit(1)
  }

  const sb = createClient(need('SUPABASE_URL'), need('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data, error } = await sb.from('feeds').select('id, household_id, name, url, status').order('household_id')
  if (error) throw new Error(`reading feeds: ${error.message}`)
  const feeds = (data ?? []) as FeedRow[]

  console.log(`${feeds.length} feed(s) in the database:`)
  for (const f of feeds) console.log(`  ${f.household_id}/${f.name}  [${f.id}]`)
  console.log()

  const match = resolveFeed(feeds, query)
  if (!match.ok) {
    console.error(`::error::"${query}" ${describe(match.reason)} — nothing deleted`)
    for (const c of match.candidates) console.error(`  candidate: ${c.name} [${c.id}]`)
    process.exit(1)
  }

  const feed = match.feed
  const { count } = await sb
    .from('feed_events')
    .select('id', { count: 'exact', head: true })
    .eq('feed_id', feed.id)

  console.log(`matched by ${match.how}:`)
  console.log(`  name      ${feed.name}`)
  console.log(`  id        ${feed.id}`)
  console.log(`  household ${feed.household_id}`)
  console.log(`  url       ${feed.url}`)
  console.log(`  status    ${feed.status}`)
  console.log(`  events    ${count ?? 'unknown'} (cascade)`)
  console.log()

  if (DRY_RUN) {
    console.log('dry run — nothing deleted')
    return
  }

  const { error: delErr } = await sb.from('feeds').delete().eq('id', feed.id)
  if (delErr) throw new Error(`deleting feed: ${delErr.message}`)

  // Confirm rather than assume: a delete that matched no rows is not an error
  // in PostgREST, so "no error" alone does not mean the row is gone.
  const { data: still } = await sb.from('feeds').select('id').eq('id', feed.id)
  if (still?.length) throw new Error(`feed ${feed.id} is still present after the delete`)

  const { count: leftover } = await sb
    .from('feed_events')
    .select('id', { count: 'exact', head: true })
    .eq('feed_id', feed.id)
  if (leftover) throw new Error(`${leftover} event(s) survived the cascade`)

  console.log(`deleted "${feed.name}" and its ${count ?? 0} event(s)`)
}

const describe = (reason: 'empty-query' | 'no-match' | 'ambiguous') =>
  reason === 'ambiguous' ? 'matches more than one feed' : reason === 'no-match' ? 'matches no feed' : 'is empty'

main().catch((err) => {
  console.error(`\nFAILED: ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
})
