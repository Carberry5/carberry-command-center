/**
 * Mints, lists and revokes the tokens the deals ingest uses — the credential a
 * scheduled Claude session (or anything else that can POST) presents to write
 * extracted grocery deals into a household's Savings page.
 *
 *   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… \
 *     npx tsx scripts/deals-token.ts mint --household carberry
 *
 *   npx tsx scripts/deals-token.ts list   --household carberry
 *   npx tsx scripts/deals-token.ts revoke --id <token id>
 *
 * `mint` prints the token once. Only its SHA-256 is stored, so a lost token
 * cannot be recovered — mint a new one and revoke the old.
 *
 * The token is not a Supabase key. It resolves to exactly one household and
 * can only read that household's staples and rewrite its deals — grocery
 * prices, nothing personal.
 */

import './env.ts'
import { createHash, randomBytes } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

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

const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex')

const sb = createClient(need('SUPABASE_URL'), need('SUPABASE_SERVICE_ROLE_KEY'), {
  auth: { persistSession: false, autoRefreshToken: false },
})

async function mint() {
  const household = flag('household') ?? die('--household is required')
  const label = flag('label') ?? 'Deals from Gmail'

  const { data: hh, error: hhErr } = await sb
    .from('households')
    .select('id')
    .eq('id', household)
    .maybeSingle()
  if (hhErr) die(`reading households: ${hhErr.message}`)
  if (!hh) die(`no household "${household}"`)

  const token = randomBytes(32).toString('base64url')
  const id = `dit_${randomBytes(6).toString('hex')}`

  const { error } = await sb.from('deals_ingest_tokens').insert({
    id,
    household_id: household,
    token_hash: sha256(token),
    label,
  })
  if (error) die(`storing token: ${error.message}`)

  const base = `${need('SUPABASE_URL')}/rest/v1/rpc`
  console.log(`\nminted ${id} — household ${household}\n`)
  console.log('TOKEN (shown once):')
  console.log(`  ${token}\n`)
  console.log('The caller needs the token plus the public sb_publishable_ key:')
  console.log(`  POST ${base}/savings_context   body {"p_token": "<token>"}`)
  console.log(`  POST ${base}/ingest_deals      body {"p_token": "<token>", "p_store": "costco",`)
  console.log('                                       "p_deals": [{"item", "price", "savings",')
  console.log('                                                    "detail", "ends", "stapleId"}, …]}')
  console.log('\nSee docs/grocery-savings.md for the Gmail Routine that uses this.')
}

async function listTokens() {
  const household = flag('household')
  let q = sb
    .from('deals_ingest_tokens')
    .select('id, household_id, label, created_at, last_used_at')
    .order('created_at')
  if (household) q = q.eq('household_id', household)

  const { data, error } = await q
  if (error) die(`reading tokens: ${error.message}`)
  if (!data?.length) {
    console.log('no deals ingest tokens')
    return
  }
  for (const t of data) {
    const used = t.last_used_at ? new Date(t.last_used_at).toLocaleString() : 'never used'
    console.log(`  ${t.id}  ${t.household_id}  ${used}${t.label ? `  — ${t.label}` : ''}`)
  }
}

async function revoke() {
  const id = flag('id') ?? die('--id is required (see: deals-token.ts list)')
  const { data, error } = await sb.from('deals_ingest_tokens').delete().eq('id', id).select('id')
  if (error) die(`revoking: ${error.message}`)
  if (!data?.length) die(`no token "${id}"`)
  console.log(`revoked ${id}`)
}

async function main() {
  if (cmd === 'mint') return mint()
  if (cmd === 'list') return listTokens()
  if (cmd === 'revoke') return revoke()
  die('first argument must be "mint", "list" or "revoke"')
}

main().catch((err) => {
  console.error(`\nFAILED: ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
})
