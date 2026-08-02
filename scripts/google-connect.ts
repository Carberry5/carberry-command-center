/**
 * One-time setup for the family's Google account. Writes the refresh token into
 * public.oauth_tokens, which no browser role can read, and records which Google
 * task list feeds which of the family's lists.
 *
 * Three steps, because the middle one happens in a browser:
 *
 *   1.  npx tsx scripts/google-connect.ts auth --household carberry --member e
 *
 *       Prints a consent URL. Open it, approve, and the browser will land on a
 *       localhost address that refuses to connect — that is expected, nothing
 *       is listening. The URL bar is the point.
 *
 *   2.  npx tsx scripts/google-connect.ts auth --household carberry --member e \
 *         --redirected 'http://localhost:8910/?code=…'
 *
 *       Exchanges the code and stores the tokens, then prints the Google task
 *       lists on the account.
 *
 *   3.  npx tsx scripts/google-connect.ts link --household carberry \
 *         --tasklist <id from step 2> --list Groceries
 *
 * Also:  npx tsx scripts/google-connect.ts lists   --household carberry
 *
 * The exchange runs here rather than in the app because it needs the client
 * secret, which cannot ship in a browser bundle. Run it on your own machine.
 *
 * Environment: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 *              GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET.
 */

import { createClient } from '@supabase/supabase-js'

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const TASKS_API = 'https://tasks.googleapis.com/tasks/v1'

/**
 * Desktop OAuth clients accept any loopback port, so this is not registered
 * anywhere and does not need to be reachable — the code comes back in the URL.
 */
const REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI ?? 'http://localhost:8910/'

/**
 * tasks covers the grocery list. The other two are here so the Gmail -> Calendar
 * agent does not need a second trip through the consent screen; Google issues
 * one refresh token per client, and re-authorising for extra scopes invalidates
 * what is already stored.
 */
const SCOPES = [
  'https://www.googleapis.com/auth/tasks',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/calendar.events',
]

const argv = process.argv.slice(2)
const cmd = argv[0]
const flag = (name: string): string | undefined => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 ? argv[i + 1] : undefined
}
const die = (m: string): never => {
  console.error(m)
  process.exit(1)
}
const need = (n: string): string => process.env[n] ?? die(`missing ${n}`)

const sb = () =>
  createClient(need('SUPABASE_URL'), need('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  })

interface TokenRow {
  id: string
  household_id: string
  member_id: string | null
  access_token: string | null
  refresh_token: string | null
  expires_at: string | null
  config: Record<string, unknown> | null
}

async function readRow(household: string): Promise<TokenRow> {
  const { data, error } = await sb()
    .from('oauth_tokens')
    .select('id, household_id, member_id, access_token, refresh_token, expires_at, config')
    .eq('household_id', household)
    .eq('provider', 'google')
    .maybeSingle()
  if (error) die(`reading oauth_tokens: ${error.message}`)
  if (!data) die(`household "${household}" has no Google account connected yet — run "auth" first`)
  return data as TokenRow
}

/** A usable access token, refreshing first if the stored one is spent. */
export async function accessToken(row: TokenRow): Promise<string> {
  const fresh = row.expires_at && new Date(row.expires_at).getTime() > Date.now() + 120_000
  if (fresh && row.access_token) return row.access_token
  if (!row.refresh_token) die('no refresh token stored — re-run "auth"')

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: row.refresh_token!,
      client_id: need('GOOGLE_CLIENT_ID'),
      client_secret: need('GOOGLE_CLIENT_SECRET'),
    }),
  })
  if (!res.ok) die(`refresh failed: ${res.status} ${await res.text()}`)
  const tok = (await res.json()) as { access_token: string; expires_in: number }

  await sb()
    .from('oauth_tokens')
    .update({
      access_token: tok.access_token,
      expires_at: new Date(Date.now() + tok.expires_in * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', row.id)

  return tok.access_token
}

async function taskLists(token: string) {
  const res = await fetch(`${TASKS_API}/users/@me/lists`, {
    headers: { authorization: `Bearer ${token}` },
  })
  if (!res.ok) die(`listing task lists: ${res.status} ${await res.text()}`)
  return ((await res.json()) as { items?: { id: string; title: string }[] }).items ?? []
}

// ---------------------------------------------------------------------------

async function auth() {
  const household = flag('household') ?? die('--household is required')
  const member = flag('member') ?? null
  const clientId = need('GOOGLE_CLIENT_ID')
  const redirected = flag('redirected')

  if (!redirected) {
    const url = new URL(AUTH_URL)
    url.searchParams.set('client_id', clientId)
    url.searchParams.set('redirect_uri', REDIRECT_URI)
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('scope', SCOPES.join(' '))
    // access_type=offline is what makes Google issue a refresh token at all,
    // and prompt=consent is what makes it issue one *again* on a re-auth —
    // without it a second run returns only an access token and the sync dies
    // an hour later with nothing to refresh from.
    url.searchParams.set('access_type', 'offline')
    url.searchParams.set('prompt', 'consent')
    url.searchParams.set('state', `${household}:${member ?? ''}`)

    console.log('\n1. Open this and approve:\n')
    console.log(url.toString())
    console.log('\n2. The browser will fail to load a localhost page. That is expected —')
    console.log('   nothing is listening there. Copy the whole URL from the address bar.')
    console.log('\n3. Re-run with --redirected "<that URL>"\n')
    console.log('   If you see "Google hasn\'t verified this app", that is your own')
    console.log('   unverified client: Advanced -> Go to Carberry Command Center.\n')
    return
  }

  // Narrowed by throwing rather than by die(): TypeScript only narrows on a
  // `never` return when the callee has an explicit annotation at the call site.
  const code = new URL(redirected).searchParams.get('code')
  if (!code) throw new Error('that URL has no ?code= parameter — copy the whole address bar')

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: clientId,
      client_secret: need('GOOGLE_CLIENT_SECRET'),
      redirect_uri: REDIRECT_URI,
    }),
  })
  if (!res.ok) die(`token exchange failed: ${res.status} ${await res.text()}`)

  const tok = (await res.json()) as {
    access_token: string
    refresh_token?: string
    expires_in: number
    scope?: string
  }
  if (!tok.refresh_token) {
    die(
      'Google returned no refresh token. That happens when the account has already\n' +
        'granted this client and prompt=consent was not honoured. Remove the app at\n' +
        'https://myaccount.google.com/permissions and run "auth" again.'
    )
  }

  // Keep any list mapping a previous run recorded.
  const { data: existing } = await sb()
    .from('oauth_tokens')
    .select('config')
    .eq('household_id', household)
    .eq('provider', 'google')
    .maybeSingle()

  const { error } = await sb().from('oauth_tokens').upsert(
    {
      id: `${household}:google`,
      household_id: household,
      provider: 'google',
      member_id: member,
      access_token: tok.access_token,
      refresh_token: tok.refresh_token,
      expires_at: new Date(Date.now() + tok.expires_in * 1000).toISOString(),
      scope: tok.scope ?? SCOPES.join(' '),
      config: (existing?.config as Record<string, unknown>) ?? {},
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'household_id,provider' }
  )
  if (error) die(`storing token: ${error.message}`)

  console.log(`\nconnected Google for ${household}${member ? `/${member}` : ''}`)
  console.log(`scopes: ${tok.scope ?? SCOPES.join(' ')}\n`)

  const lists = await taskLists(tok.access_token)
  if (!lists.length) {
    console.log('no task lists on this account — make one in Google Tasks first')
    return
  }
  console.log('task lists on this account:')
  for (const l of lists) console.log(`  ${l.id}  ${l.title}`)
  console.log('\nNow link one:')
  console.log(
    `  npx tsx scripts/google-connect.ts link --household ${household} --tasklist ${lists[0].id} --list Groceries`
  )
}

async function lists() {
  const household = flag('household') ?? die('--household is required')
  const row = await readRow(household)
  const found = await taskLists(await accessToken(row))
  if (!found.length) {
    console.log('no task lists on this account')
    return
  }
  const mapped = (row.config?.lists ?? {}) as Record<string, string>
  for (const l of found) {
    const to = mapped[l.id]
    console.log(`  ${l.id}  ${l.title}${to ? `  ->  ${to}` : ''}`)
  }
}

async function link() {
  const household = flag('household') ?? die('--household is required')
  const tasklist = flag('tasklist') ?? die('--tasklist is required (see: google-connect.ts lists)')
  const appList = flag('list') ?? 'Groceries'

  const row = await readRow(household)
  const found = await taskLists(await accessToken(row))
  const match = found.find((l) => l.id === tasklist)
  if (!match) {
    die(`no task list "${tasklist}" on this account — run "lists" to see the ids`)
  }

  const config = { ...(row.config ?? {}) } as { lists?: Record<string, string> }
  config.lists = { ...(config.lists ?? {}), [tasklist]: appList }

  const { error } = await sb()
    .from('oauth_tokens')
    .update({ config, updated_at: new Date().toISOString() })
    .eq('id', row.id)
  if (error) die(`saving link: ${error.message}`)

  console.log(`linked Google list "${match!.title}" -> the family's "${appList}" list`)
  console.log('\nCheck it without writing anything:')
  console.log('  npx tsx scripts/sync-tasks.ts --dry-run')
}

async function main() {
  if (cmd === 'auth') return auth()
  if (cmd === 'lists') return lists()
  if (cmd === 'link') return link()
  die('first argument must be "auth", "lists" or "link"')
}

main().catch((err) => {
  console.error(`\nFAILED: ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
})
