/**
 * Refreshes the WHOOP and Oura numbers on the member pages.
 *
 * Both vendors need a server: WHOOP's tokens are OAuth and Oura's personal
 * token would be visible to anyone who opened DevTools. Credentials live in
 * public.oauth_tokens, which the browser roles cannot read at all, and this job
 * reaches them with the service role key.
 *
 * Field mapping, from each vendor's own OpenAPI spec:
 *
 *   WhoopStats.sleep  <- /v2/activity/sleep  records[0].score.sleep_performance_percentage
 *   WhoopStats.strain <- /v2/cycle           records[0].score.strain            (0-21)
 *   OuraStats.sleep   <- /v2/usercollection/daily_sleep     data[last].score    (0-100)
 *   OuraStats.act     <- /v2/usercollection/daily_activity  data[last].score    (0-100)
 *
 *   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… npx tsx scripts/sync-wearables.ts [--dry-run]
 */

import { createClient } from '@supabase/supabase-js'

const DRY_RUN = process.argv.includes('--dry-run')

const WHOOP_API = 'https://api.prod.whoop.com/developer'
const WHOOP_TOKEN_URL = 'https://api.prod.whoop.com/oauth/oauth2/token'
const OURA_API = 'https://api.ouraring.com'

const need = (n: string): string => {
  const v = process.env[n]
  if (!v) {
    console.error(`missing ${n}`)
    process.exit(1)
  }
  return v
}

interface TokenRow {
  id: string
  household_id: string
  provider: string
  member_id: string | null
  access_token: string | null
  refresh_token: string | null
  expires_at: string | null
}

let sb: ReturnType<typeof makeClient>
const makeClient = () =>
  createClient(need('SUPABASE_URL'), need('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  })

async function getJson<T>(url: string, token: string): Promise<T> {
  const res = await fetch(url, {
    headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
    signal: AbortSignal.timeout(30000),
  })
  if (res.status === 401) throw new Error('401 — token rejected; reconnect this account')
  if (!res.ok) throw new Error(`${res.status} from ${new URL(url).pathname}`)
  return (await res.json()) as T
}

// --- WHOOP -----------------------------------------------------------------

/**
 * WHOOP access tokens are short-lived. A refresh needs the same client
 * credentials the authorization used, so the job carries them; without them a
 * token simply expires and the card goes stale.
 */
async function whoopAccessToken(row: TokenRow): Promise<string> {
  const stillValid = row.expires_at && new Date(row.expires_at).getTime() > Date.now() + 120_000
  if (stillValid && row.access_token) return row.access_token

  if (!row.refresh_token) {
    throw new Error('access token expired and no refresh token stored — reconnect')
  }
  const clientId = process.env.WHOOP_CLIENT_ID
  const clientSecret = process.env.WHOOP_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    throw new Error('token expired but WHOOP_CLIENT_ID / WHOOP_CLIENT_SECRET are not set')
  }

  const res = await fetch(WHOOP_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: row.refresh_token,
      client_id: clientId,
      client_secret: clientSecret,
      // WHOOP only reissues a refresh token when `offline` is asked for again.
      // Without it the next run has nothing to refresh with.
      scope: 'offline',
    }),
    signal: AbortSignal.timeout(30000),
  })
  if (!res.ok) throw new Error(`refresh failed: ${res.status} ${await res.text()}`)

  const tok = (await res.json()) as { access_token: string; refresh_token?: string; expires_in: number }
  const expires = new Date(Date.now() + tok.expires_in * 1000).toISOString()
  if (!DRY_RUN) {
    await sb
      .from('oauth_tokens')
      .update({
        access_token: tok.access_token,
        refresh_token: tok.refresh_token ?? row.refresh_token,
        expires_at: expires,
        updated_at: new Date().toISOString(),
      })
      .eq('id', row.id)
  }
  return tok.access_token
}

interface WhoopCycles {
  records: { score?: { strain?: number } }[]
}
interface WhoopSleeps {
  records: { score?: { sleep_performance_percentage?: number } }[]
}

async function readWhoop(row: TokenRow) {
  const token = await whoopAccessToken(row)
  // limit=1 — the most recent cycle and sleep are all the cards show.
  const [cycles, sleeps] = await Promise.all([
    getJson<WhoopCycles>(`${WHOOP_API}/v2/cycle?limit=1`, token),
    getJson<WhoopSleeps>(`${WHOOP_API}/v2/activity/sleep?limit=1`, token),
  ])
  const strain = cycles.records?.[0]?.score?.strain
  const sleep = sleeps.records?.[0]?.score?.sleep_performance_percentage
  // score is absent while WHOOP is still scoring (PENDING_SCORE) or can't.
  if (strain == null && sleep == null) throw new Error('no scored cycle or sleep yet')
  return { kind: 'whoop' as const, sleep: round(sleep), strain: round(strain, 1) }
}

// --- Oura ------------------------------------------------------------------

interface OuraDaily {
  data: { day: string; score: number | null }[]
}

async function readOura(row: TokenRow) {
  if (!row.access_token) throw new Error('no personal access token stored')
  // Oura publishes a day's summary some hours after it ends, so a short window
  // back is necessary — asking only for today usually returns nothing.
  const end = new Date()
  const start = new Date(end.getTime() - 6 * 864e5)
  const range = `start_date=${iso(start)}&end_date=${iso(end)}`

  const [sleep, activity] = await Promise.all([
    getJson<OuraDaily>(`${OURA_API}/v2/usercollection/daily_sleep?${range}`, row.access_token),
    getJson<OuraDaily>(`${OURA_API}/v2/usercollection/daily_activity?${range}`, row.access_token),
  ])
  const latest = (d: OuraDaily) =>
    [...(d.data ?? [])].filter((x) => x.score != null).sort((a, b) => (a.day < b.day ? -1 : 1)).pop()
      ?.score ?? undefined

  const s = latest(sleep)
  const a = latest(activity)
  if (s == null && a == null) throw new Error('no scored day in the last week')
  return { kind: 'oura' as const, sleep: round(s), act: round(a) }
}

const iso = (d: Date) => d.toISOString().slice(0, 10)
const round = (n: number | undefined, dp = 0) =>
  n == null ? 0 : Math.round(n * 10 ** dp) / 10 ** dp

// --- main ------------------------------------------------------------------

async function main() {
  sb = makeClient()

  const { data: tokens, error } = await sb
    .from('oauth_tokens')
    .select('id, household_id, provider, member_id, access_token, refresh_token, expires_at')
    .in('provider', ['whoop', 'oura'])
  if (error) throw new Error(`reading oauth_tokens: ${error.message}`)

  if (!tokens?.length) {
    console.log('no wearable accounts connected — nothing to do')
    console.log('connect one with scripts/wearable-connect.ts')
    return
  }

  console.log(`${tokens.length} account(s)${DRY_RUN ? ' — dry run, nothing will be written' : ''}\n`)
  let failures = 0

  for (const row of tokens as TokenRow[]) {
    const label = `${row.household_id}/${row.member_id ?? '?'} ${row.provider}`
    if (!row.member_id) {
      console.log(`  ${label}: skipped (no member_id — which family member is this?)`)
      continue
    }
    try {
      const stats = row.provider === 'whoop' ? await readWhoop(row) : await readOura(row)
      console.log(`  ${label}: ${JSON.stringify(stats)}`)
      if (DRY_RUN) continue

      const { error: upErr } = await sb.from('fit_stats').upsert(
        {
          household_id: row.household_id,
          member_id: row.member_id,
          kind: stats.kind,
          sleep: stats.sleep,
          strain: stats.kind === 'whoop' ? stats.strain : null,
          act: stats.kind === 'oura' ? stats.act : null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'household_id,member_id' }
      )
      if (upErr) throw new Error(`writing fit_stats: ${upErr.message}`)
    } catch (err) {
      failures++
      console.log(`  ${label}: FAILED — ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  if (failures) {
    console.log(`\n${failures} account(s) failed`)
    process.exitCode = 1
  } else {
    console.log('\nall wearables synced')
  }
}

main().catch((err) => {
  console.error(`\nFAILED: ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
})
