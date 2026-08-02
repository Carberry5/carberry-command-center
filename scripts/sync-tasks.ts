/**
 * Keeps a Google Tasks list and one of the family's lists in step.
 *
 * All the decisions live in src/lib/gtasks.ts, which is pure and tested offline
 * by scripts/gtasks-test.ts. This file is only the parts that need a network: a
 * token refresh, four Google Tasks calls, and a write through cloudSync's
 * existing diff so the app's own path does the persisting.
 *
 *   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… \
 *   GOOGLE_CLIENT_ID=… GOOGLE_CLIENT_SECRET=… \
 *     npx tsx scripts/sync-tasks.ts [--dry-run] [--household carberry]
 *
 * Connect an account first with scripts/google-connect.ts.
 *
 * The service role key bypasses RLS, which is what lets a scheduled job write
 * for every household with no session. It must be an Actions *secret* — never a
 * VITE_ variable, which would be compiled into the browser bundle.
 */

import './env.ts'
import { createClient } from '@supabase/supabase-js'
import { seed } from '../src/data/seed.ts'
import {
  applyPlan,
  describePlan,
  planIsEmpty,
  planSync,
  type GoogleTask,
} from '../src/lib/gtasks.ts'
import { configureCloud, loadSnapshot, pushChanges } from '../src/store/cloudSync.ts'
import type { FamilyData } from '../src/types.ts'

const DRY_RUN = process.argv.includes('--dry-run')
const ONLY = (() => {
  const i = process.argv.indexOf('--household')
  return i >= 0 ? process.argv[i + 1] : undefined
})()

const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const TASKS_API = 'https://tasks.googleapis.com/tasks/v1'

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
  member_id: string | null
  access_token: string | null
  refresh_token: string | null
  expires_at: string | null
  config: { lists?: Record<string, string> } | null
}

let sb: ReturnType<typeof makeClient>
const makeClient = () =>
  createClient(need('SUPABASE_URL'), need('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  })

// --- Google ----------------------------------------------------------------

async function accessToken(row: TokenRow): Promise<string> {
  const fresh = row.expires_at && new Date(row.expires_at).getTime() > Date.now() + 120_000
  if (fresh && row.access_token) return row.access_token
  if (!row.refresh_token) throw new Error('no refresh token stored — reconnect with google-connect.ts')

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: row.refresh_token,
      client_id: need('GOOGLE_CLIENT_ID'),
      client_secret: need('GOOGLE_CLIENT_SECRET'),
    }),
    signal: AbortSignal.timeout(30000),
  })
  if (!res.ok) {
    const body = await res.text()
    // A refresh token is revoked when the password changes, the grant is
    // removed at myaccount.google.com/permissions, or — the one that catches
    // people out — the OAuth client is left in "Testing", where refresh tokens
    // expire after 7 days.
    if (res.status === 400 || res.status === 401) {
      throw new Error(`refresh rejected (${res.status}) — reconnect with google-connect.ts. ${body}`)
    }
    throw new Error(`refresh failed: ${res.status} ${body}`)
  }

  const tok = (await res.json()) as { access_token: string; expires_in: number }
  if (!DRY_RUN) {
    await sb
      .from('oauth_tokens')
      .update({
        access_token: tok.access_token,
        expires_at: new Date(Date.now() + tok.expires_in * 1000).toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', row.id)
  }
  return tok.access_token
}

async function google<T>(path: string, token: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${TASKS_API}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(30000),
  })
  if (!res.ok) throw new Error(`${res.status} from ${path}: ${(await res.text()).slice(0, 200)}`)
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T)
}

/**
 * Every incomplete task on a list. Paged: the API returns 20 by default and
 * caps at 100, so a long list would silently arrive truncated — and a truncated
 * pull looks exactly like "everything else was bought", which would empty the
 * family's list.
 */
async function incompleteTasks(listId: string, token: string): Promise<GoogleTask[]> {
  const out: GoogleTask[] = []
  let pageToken: string | undefined
  do {
    const qs = new URLSearchParams({ maxResults: '100', showCompleted: 'false', showHidden: 'false' })
    if (pageToken) qs.set('pageToken', pageToken)
    const page = await google<{ items?: GoogleTask[]; nextPageToken?: string }>(
      `/lists/${encodeURIComponent(listId)}/tasks?${qs}`,
      token
    )
    out.push(...(page.items ?? []))
    pageToken = page.nextPageToken
  } while (pageToken)
  return out
}

// --- main ------------------------------------------------------------------

async function syncHousehold(row: TokenRow): Promise<boolean> {
  const mapping = row.config?.lists ?? {}
  const pairs = Object.entries(mapping)
  if (!pairs.length) {
    console.log(`  ${row.household_id}: no task list linked — see google-connect.ts link`)
    return true
  }

  const token = await accessToken(row)
  const base = seed()
  const before = await loadSnapshot(row.household_id, base)
  let after: FamilyData = structuredClone(before)
  let changed = false

  for (const [taskListId, appListName] of pairs) {
    const idx = after.lists.findIndex((l) => l.name.toLowerCase() === appListName.toLowerCase())
    if (idx < 0) {
      console.log(`  ${row.household_id}: no list called "${appListName}" — skipped`)
      continue
    }

    const tasks = await incompleteTasks(taskListId, token)
    const plan = planSync(after.lists[idx].items, tasks)
    console.log(`  ${row.household_id}/${appListName}: ${describePlan(plan)}`)

    if (planIsEmpty(plan)) continue
    if (DRY_RUN) {
      changed = true
      continue
    }

    // Push up first. If creating a task fails we want to have written nothing
    // locally, rather than leaving an item that claims a task id Google never
    // issued.
    const created = new Map<string, string>()
    for (const c of plan.create) {
      const task = await google<GoogleTask>(
        `/lists/${encodeURIComponent(taskListId)}/tasks`,
        token,
        { method: 'POST', body: JSON.stringify({ title: c.title }) }
      )
      created.set(c.itemId, task.id)
    }
    for (const done of plan.complete) {
      await google(
        `/lists/${encodeURIComponent(taskListId)}/tasks/${encodeURIComponent(done.remoteId)}`,
        token,
        { method: 'PATCH', body: JSON.stringify({ status: 'completed' }) }
      )
    }

    after.lists[idx] = {
      ...after.lists[idx],
      items: applyPlan(after.lists[idx].items, plan, created, row.member_id ?? ''),
    }
    changed = true
  }

  if (!changed || DRY_RUN) return true

  // The app's own write path — diffed, minimal, and already tested.
  await pushChanges(before, after, row.household_id)
  return true
}

async function main() {
  sb = makeClient()
  // cloudSync's module client, pointed at the project with the service role key
  // so loadSnapshot and pushChanges work here as they do in the browser.
  configureCloud(need('SUPABASE_URL'), need('SUPABASE_SERVICE_ROLE_KEY'), { persistSession: false })

  let q = sb
    .from('oauth_tokens')
    .select('id, household_id, member_id, access_token, refresh_token, expires_at, config')
    .eq('provider', 'google')
  if (ONLY) q = q.eq('household_id', ONLY)

  const { data: tokens, error } = await q
  if (error) throw new Error(`reading oauth_tokens: ${error.message}`)

  if (!tokens?.length) {
    console.log('no Google account connected — nothing to do')
    console.log('connect one with scripts/google-connect.ts')
    return
  }

  console.log(
    `${tokens.length} account(s)${DRY_RUN ? ' — dry run, nothing will be written' : ''}\n`
  )
  let failures = 0

  for (const row of tokens as TokenRow[]) {
    try {
      await syncHousehold(row)
    } catch (err) {
      failures++
      console.log(`  ${row.household_id}: FAILED — ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  if (failures) {
    console.log(`\n${failures} account(s) failed`)
    process.exitCode = 1
  } else {
    console.log('\ntasks synced')
  }
}

main().catch((err) => {
  console.error(`\nFAILED: ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
})
