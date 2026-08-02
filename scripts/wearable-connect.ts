/**
 * One-time setup for a wearable account. Writes credentials into
 * public.oauth_tokens, which no browser role can read.
 *
 * Oura — a personal access token, no OAuth involved:
 *
 *   npx tsx scripts/wearable-connect.ts oura --household carberry --member e --token <PAT>
 *
 * WHOOP — OAuth, so two steps. First print the consent URL:
 *
 *   npx tsx scripts/wearable-connect.ts whoop --household carberry --member p
 *
 * open it, approve, then paste the URL you were redirected to back in:
 *
 *   npx tsx scripts/wearable-connect.ts whoop --household carberry --member p \
 *     --redirected 'http://localhost:8910/?code=…'
 *
 * The code is exchanged here rather than in the app because the exchange needs
 * the client secret, which cannot ship in a browser bundle. Run this on your own
 * machine; nothing about it needs to be hosted.
 *
 * Environment: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and for WHOOP
 * WHOOP_CLIENT_ID / WHOOP_CLIENT_SECRET / WHOOP_REDIRECT_URI.
 */

import './env.ts'
import { createClient } from '@supabase/supabase-js'

const WHOOP_AUTH_URL = 'https://api.prod.whoop.com/oauth/oauth2/auth'
const WHOOP_TOKEN_URL = 'https://api.prod.whoop.com/oauth/oauth2/token'

const argv = process.argv.slice(2)
const provider = argv[0]
const flag = (name: string): string | undefined => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 ? argv[i + 1] : undefined
}
const need = (n: string): string => {
  const v = process.env[n]
  if (!v) {
    console.error(`missing ${n}`)
    process.exit(1)
  }
  return v
}
const die = (m: string): never => {
  console.error(m)
  process.exit(1)
}

const household = flag('household') ?? die('--household is required')
const member = flag('member') ?? die('--member is required (the member id, e.g. p or e)')

const sb = createClient(need('SUPABASE_URL'), need('SUPABASE_SERVICE_ROLE_KEY'), {
  auth: { persistSession: false, autoRefreshToken: false },
})

async function store(fields: Record<string, unknown>) {
  const { error } = await sb.from('oauth_tokens').upsert(
    {
      id: `${household}:${provider}`,
      household_id: household,
      provider,
      member_id: member,
      updated_at: new Date().toISOString(),
      ...fields,
    },
    { onConflict: 'household_id,provider' }
  )
  if (error) die(`storing token: ${error.message}`)
  console.log(`stored ${provider} credentials for ${household}/${member}`)
  console.log('run: npx tsx scripts/sync-wearables.ts --dry-run')
}

async function main() {
  if (provider === 'oura') {
    const token = flag('token') ?? die('--token is required (Oura personal access token)')
    // Fail here rather than silently storing a token that never works.
    const probe = await fetch('https://api.ouraring.com/v2/usercollection/personal_info', {
      headers: { authorization: `Bearer ${token}` },
    })
    if (!probe.ok) die(`Oura rejected that token (${probe.status}) — check it and try again`)
    console.log('Oura accepted the token')
    await store({ access_token: token, refresh_token: null, expires_at: null })
    return
  }

  if (provider === 'whoop') {
    const clientId = need('WHOOP_CLIENT_ID')
    const redirectUri = need('WHOOP_REDIRECT_URI')
    const redirected = flag('redirected')

    if (!redirected) {
      const url = new URL(WHOOP_AUTH_URL)
      url.searchParams.set('client_id', clientId)
      url.searchParams.set('redirect_uri', redirectUri)
      url.searchParams.set('response_type', 'code')
      // `offline` is what makes WHOOP issue a refresh token. Without it the
      // connection dies silently when the first access token expires.
      url.searchParams.set('scope', 'offline read:sleep read:cycles')
      url.searchParams.set('state', `${household}-${member}`)
      console.log('\nOpen this, approve, then re-run with --redirected "<the URL you land on>":\n')
      console.log(url.toString())
      console.log()
      return
    }

    const code = new URL(redirected).searchParams.get('code')
    if (!code) die('that URL has no ?code= parameter')

    const res = await fetch(WHOOP_TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: code!,
        client_id: clientId,
        client_secret: need('WHOOP_CLIENT_SECRET'),
        redirect_uri: redirectUri,
      }),
    })
    if (!res.ok) die(`token exchange failed: ${res.status} ${await res.text()}`)

    const tok = (await res.json()) as {
      access_token: string
      refresh_token?: string
      expires_in: number
    }
    if (!tok.refresh_token) {
      console.warn('WARNING: no refresh token returned — the `offline` scope was probably declined.')
      console.warn('This will stop working when the access token expires.')
    }
    await store({
      access_token: tok.access_token,
      refresh_token: tok.refresh_token ?? null,
      expires_at: new Date(Date.now() + tok.expires_in * 1000).toISOString(),
      scope: 'offline read:sleep read:cycles',
    })
    return
  }

  die('first argument must be "oura" or "whoop"')
}

main().catch((err) => {
  console.error(`\nFAILED: ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
})
