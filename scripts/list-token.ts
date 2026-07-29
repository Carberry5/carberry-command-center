/**
 * Mints, lists and revokes the tokens an iOS Shortcut uses to post a Reminders
 * list into a household list.
 *
 *   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… \
 *     npx tsx scripts/list-token.ts mint --household carberry --list Groceries --member e
 *
 *   npx tsx scripts/list-token.ts list   --household carberry
 *   npx tsx scripts/list-token.ts revoke --id <token id>
 *
 * `mint` prints the token once. Only its SHA-256 is stored, so a lost token
 * cannot be recovered — mint a new one and revoke the old.
 *
 * The token is not a Supabase key. It resolves to exactly one household and one
 * list, which is the whole point: the thing that ends up on a phone should not
 * be able to do anything except rewrite a grocery list.
 */

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
  const list = flag('list') ?? 'Groceries'
  const member = flag('member') ?? null
  const label = flag('label') ?? `${list} from Reminders`

  const { data: hh, error: hhErr } = await sb
    .from('households')
    .select('id')
    .eq('id', household)
    .maybeSingle()
  if (hhErr) die(`reading households: ${hhErr.message}`)
  if (!hh) die(`no household "${household}"`)

  if (member) {
    const { data: m } = await sb
      .from('members')
      .select('id')
      .eq('household_id', household)
      .eq('id', member)
      .maybeSingle()
    if (!m) die(`no member "${member}" in household "${household}"`)
  }

  // 32 bytes. The token is the only thing standing between the internet and
  // this list, and it is never typed by hand — there is no reason to be short.
  const token = randomBytes(32).toString('base64url')
  const id = `lit_${randomBytes(6).toString('hex')}`

  const { error } = await sb.from('list_ingest_tokens').insert({
    id,
    household_id: household,
    list_name: list,
    token_hash: sha256(token),
    member_id: member,
    label,
  })
  if (error) die(`storing token: ${error.message}`)

  const url = `${need('SUPABASE_URL')}/rest/v1/rpc/ingest_list`
  console.log(`\nminted ${id} — household ${household}, list "${list}"\n`)
  console.log('TOKEN (shown once):')
  console.log(`  ${token}\n`)
  console.log('Shortcut "Get contents of URL":')
  console.log(`  URL:    ${url}`)
  console.log('  Method: POST')
  console.log('  Headers:')
  console.log('    apikey        <your sb_publishable_… key>')
  console.log('    Content-Type  application/json')
  console.log('  Request body (JSON):')
  console.log(`    p_token  ${token}`)
  console.log('    p_items  <the Reminders names, as a list>\n')
  console.log('See docs/reminders-shortcut.md for the full recipe.')
}

async function listTokens() {
  const household = flag('household')
  let q = sb
    .from('list_ingest_tokens')
    .select('id, household_id, list_name, member_id, label, created_at, last_used_at')
    .order('created_at')
  if (household) q = q.eq('household_id', household)

  const { data, error } = await q
  if (error) die(`reading tokens: ${error.message}`)
  if (!data?.length) {
    console.log('no ingest tokens')
    return
  }
  for (const t of data) {
    const used = t.last_used_at ? new Date(t.last_used_at).toLocaleString() : 'never used'
    console.log(`  ${t.id}  ${t.household_id}/${t.list_name}  ${used}${t.label ? `  — ${t.label}` : ''}`)
  }
}

async function revoke() {
  const id = flag('id') ?? die('--id is required (see: list-token.ts list)')
  const { data, error } = await sb.from('list_ingest_tokens').delete().eq('id', id).select('id')
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
