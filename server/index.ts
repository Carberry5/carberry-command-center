import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { watch } from 'node:fs'
import { mkdir, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { extname, join, normalize, resolve } from 'node:path'
import type { FamilyData } from '../src/types.ts'
import { parseIcs } from '../src/lib/ics.ts'
import { seed } from '../src/data/seed.ts'
import { migrate } from '../src/data/migrate.ts'
import { config, vaultDir } from './config.ts'
import * as vault from './vault.ts'
import * as op from './onepassword.ts'
import * as sidekick from './sidekick.ts'
import * as savings from './savings.ts'
import { isStoreId } from '../src/lib/savings.ts'
import type { Deal, Staple } from '../src/types.ts'

/**
 * The vault sidecar.
 *
 * It owns the family data: reads it out of the Obsidian vault on boot, writes
 * it back on every change, watches the folder so edits made in Obsidian reach
 * every open device, resolves 1Password references, and fetches ICS feeds
 * server-side (which is what makes the school calendar work at all — browsers
 * refuse those requests).
 */

let state: FamilyData = seed()
let rev = 0

const clients = new Set<ServerResponse>()

function broadcast() {
  const payload = `data: ${JSON.stringify({ rev, data: state })}\n\n`
  for (const res of clients) res.write(payload)
}

async function commit(next: FamilyData, { persist = true } = {}) {
  state = next
  rev += 1
  if (persist) await vault.write(state)
  broadcast()
}

async function boot() {
  await mkdir(vaultDir, { recursive: true })
  const fromVault = await vault.read()
  if (fromVault) {
    state = fromVault
    console.log(`[vault] loaded ${state.members.length} people, ${state.events.length} events from ${vaultDir}`)
  } else {
    state = migrate(seed())
    await vault.write(state)
    console.log(`[vault] first run — wrote a starter vault to ${vaultDir}`)
  }
}

// --- watching -------------------------------------------------------------

let reloadTimer: NodeJS.Timeout | null = null

function watchVault() {
  try {
    watch(vaultDir, { recursive: true }, (_evt, filename) => {
      if (!filename || !filename.toString().endsWith('.md')) return
      const path = join(vaultDir, filename.toString())
      if (vault.wasSelfWrite(path)) return
      // Obsidian saves in bursts; settle before re-reading the whole folder.
      if (reloadTimer) clearTimeout(reloadTimer)
      reloadTimer = setTimeout(reloadFromVault, 400)
    })
    console.log(`[vault] watching ${vaultDir}`)
  } catch (err) {
    console.warn('[vault] could not watch the folder — external edits need a refresh:', err)
  }
}

async function reloadFromVault() {
  try {
    const next = await vault.read()
    if (!next) return
    const feedEv = state.feedEv // feed cache is in-memory only
    state = { ...next, feedEv }
    rev += 1
    broadcast()
    console.log('[vault] reloaded after an external edit')
  } catch (err) {
    console.error('[vault] reload failed:', err)
  }
}

// --- http helpers ---------------------------------------------------------

function send(res: ServerResponse, code: number, body: unknown) {
  const json = JSON.stringify(body)
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'access-control-allow-origin': '*',
  })
  res.end(json)
}

async function readJson<T>(req: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > 8 * 1024 * 1024) throw new Error('Payload too large')
    chunks.push(chunk as Buffer)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as T
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
}

async function serveStatic(url: string, res: ServerResponse): Promise<boolean> {
  const root = resolve(process.cwd(), 'dist')
  if (!existsSync(root)) return false
  const rel = normalize(decodeURIComponent(url.split('?')[0])).replace(/^(\.\.[/\\])+/, '')
  let file = join(root, rel)
  if (!file.startsWith(root)) return false
  if (!existsSync(file) || rel === '/' || rel === '\\') file = join(root, 'index.html')
  try {
    const body = await readFile(file)
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' })
    res.end(body)
    return true
  } catch {
    return false
  }
}

// --- routes ---------------------------------------------------------------

async function handle(req: IncomingMessage, res: ServerResponse) {
  const url = req.url ?? '/'
  const path = url.split('?')[0]

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET,PUT,POST,OPTIONS',
      'access-control-allow-headers': 'content-type',
    })
    return res.end()
  }

  // Live updates: one event per revision, whoever caused it.
  if (path === '/events') {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'access-control-allow-origin': '*',
    })
    res.write(`data: ${JSON.stringify({ rev, data: state })}\n\n`)
    const ping = setInterval(() => res.write(': ping\n\n'), 25000)
    clients.add(res)
    req.on('close', () => {
      clearInterval(ping)
      clients.delete(res)
    })
    return
  }

  if (path === '/api/health') {
    return send(res, 200, {
      ok: true,
      rev,
      vault: vaultDir,
      vaultExists: existsSync(vaultDir),
      onePassword: await op.available(),
    })
  }

  if (path === '/api/state' && req.method === 'GET') {
    return send(res, 200, { rev, data: state })
  }

  if (path === '/api/state' && req.method === 'PUT') {
    try {
      const body = await readJson<{ baseRev: number; data: FamilyData }>(req)
      if (typeof body.baseRev === 'number' && body.baseRev !== rev) {
        // Someone else (or Obsidian) moved first. Hand back the truth and let
        // the client re-apply rather than clobbering their edit.
        return send(res, 409, { rev, data: state })
      }
      await commit(migrate(body.data))
      return send(res, 200, { rev, data: state })
    } catch (err) {
      return send(res, 400, { error: err instanceof Error ? err.message : 'Bad request' })
    }
  }

  // Which integrations have a working 1Password reference. Never returns values.
  if (path === '/api/integrations' && req.method === 'GET') {
    const entries = await Promise.all(
      Object.entries(config.opRefs).map(async ([name, ref]) => [name, { configured: !!ref, ...(await op.check(ref)) }] as const)
    )
    return send(res, 200, { cli: await op.available(), integrations: Object.fromEntries(entries) })
  }

  // Reveal one family reference secret. PIN-checked here, not just in the UI.
  if (path === '/api/secrets/reveal' && req.method === 'POST') {
    try {
      const body = await readJson<{ id: string; pin: string }>(req)
      if (body.pin !== state.settings.pin) return send(res, 403, { error: 'Wrong PIN' })
      const entry = state.secrets.find((s) => s.id === body.id)
      if (!entry) return send(res, 404, { error: 'No such reference' })
      const value = await op.read(entry.ref)
      return send(res, 200, { value })
    } catch (err) {
      const code = err instanceof op.OpError ? err.code : 'error'
      return send(res, 400, { error: err instanceof Error ? err.message : 'Could not read', code })
    }
  }

  // Server-side ICS fetch — no CORS, and the url may itself live in 1Password.
  if (path === '/api/feeds/sync' && req.method === 'POST') {
    try {
      const body = await readJson<{ id: string }>(req)
      const feed = state.settings.feeds.find((f) => f.id === body.id)
      if (!feed) return send(res, 404, { error: 'No such feed' })
      const url = feed.opRef ? await op.read(feed.opRef) : feed.url
      if (!/^https?:\/\//i.test(url)) return send(res, 400, { error: 'Feed url must be http(s)' })
      const r = await fetch(url, { headers: { accept: 'text/calendar,text/plain' }, redirect: 'follow' })
      if (!r.ok) return send(res, 502, { error: `Feed responded ${r.status}` })
      const events = parseIcs(await r.text())
      const next: FamilyData = {
        ...state,
        feedEv: { ...state.feedEv, [feed.id]: events },
        settings: {
          ...state.settings,
          feeds: state.settings.feeds.map((f) =>
            f.id === feed.id ? { ...f, status: `${events.length} events · just synced` } : f
          ),
        },
      }
      await commit(next)
      return send(res, 200, { count: events.length, rev })
    } catch (err) {
      return send(res, 502, { error: err instanceof Error ? err.message : 'Sync failed' })
    }
  }

  // Sidekick: the Claude call lives here so the API key never reaches a browser.
  if (path === '/api/sidekick' && req.method === 'POST') {
    try {
      const body = await readJson<{ text: string }>(req)
      if (!body.text?.trim()) return send(res, 400, { error: 'Nothing to read' })
      const names = state.members.map((m) => `${m.name}${m.role === 'parent' ? ' (parent)' : ''}`)
      return send(res, 200, await sidekick.extract(body.text, names))
    } catch (err) {
      return send(res, 502, { error: err instanceof Error ? err.message : 'Sidekick failed' })
    }
  }

  if (path === '/api/sidekick/status' && req.method === 'GET') {
    return send(res, 200, await sidekick.ready())
  }

  // Savings: pull deals out of a store's ad page. Stateless on purpose — the
  // client sends its staples and commits the result through its own store, so
  // this works the same against the vault and against Supabase.
  if (path === '/api/savings/import' && req.method === 'POST') {
    try {
      const body = await readJson<{ store: string; text?: string; staples?: Staple[] }>(req)
      if (!isStoreId(body.store)) return send(res, 400, { error: 'Unknown store' })
      const text = body.text?.trim() || (await savings.fetchStoreText(body.store))
      const deals = await savings.extractDeals(body.store, text, body.staples ?? [])
      return send(res, 200, { deals })
    } catch (err) {
      return send(res, 502, { error: err instanceof Error ? err.message : 'Import failed' })
    }
  }

  // Savings: write the week's shopping strategy from deals + dinners + list.
  if (path === '/api/savings/plan' && req.method === 'POST') {
    try {
      const body = await readJson<{
        staples?: Staple[]
        deals?: Deal[]
        dinners?: { date: string; meal: string }[]
        favorites?: string[]
        groceries?: string[]
      }>(req)
      const plan = await savings.buildPlan({
        staples: body.staples ?? [],
        deals: body.deals ?? [],
        dinners: body.dinners ?? [],
        favorites: body.favorites ?? [],
        groceries: body.groceries ?? [],
      })
      return send(res, 200, plan)
    } catch (err) {
      return send(res, 502, { error: err instanceof Error ? err.message : 'Planning failed' })
    }
  }

  if (path === '/api/savings/status' && req.method === 'GET') {
    return send(res, 200, await savings.ready())
  }

  if (config.serveStatic && req.method === 'GET' && (await serveStatic(path, res))) return

  return send(res, 404, { error: 'Not found' })
}

// --- go -------------------------------------------------------------------

await boot()
watchVault()

createServer((req, res) => {
  handle(req, res).catch((err) => {
    console.error('[sidecar]', err)
    if (!res.headersSent) send(res, 500, { error: 'Internal error' })
  })
}).listen(config.port, () => {
  console.log(`[sidecar] http://localhost:${config.port}  →  vault ${vaultDir}`)
  if (config.serveStatic) console.log('[sidecar] serving the built app from ./dist')
})
