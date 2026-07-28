import type { FamilyData, SyncEnvelope } from '../types.ts'
import { migrate } from '../data/migrate.ts'
import { seed } from '../data/seed.ts'

/**
 * Talks to the vault sidecar, and degrades to localStorage when it isn't
 * running so the app still works on a device that's off the home wifi.
 */

const LOCAL_KEY = 'carberry.command.center.v1'

export type SyncMode = 'connecting' | 'vault' | 'local'

export interface Health {
  ok: boolean
  rev: number
  vault: string
  vaultExists: boolean
  onePassword: boolean
}

export async function health(): Promise<Health | null> {
  try {
    const res = await fetch('/api/health', { cache: 'no-store' })
    if (!res.ok) return null
    return (await res.json()) as Health
  } catch {
    return null
  }
}

export function loadLocal(): FamilyData {
  try {
    const raw = localStorage.getItem(LOCAL_KEY)
    if (raw) return migrate(JSON.parse(raw) as FamilyData)
  } catch {
    /* corrupt or blocked storage — fall through to a fresh seed */
  }
  return migrate(seed())
}

export function saveLocal(d: FamilyData) {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(d))
  } catch {
    /* private browsing / quota — nothing useful to do */
  }
}

export async function fetchState(): Promise<SyncEnvelope | null> {
  try {
    const res = await fetch('/api/state', { cache: 'no-store' })
    if (!res.ok) return null
    return (await res.json()) as SyncEnvelope
  } catch {
    return null
  }
}

export type PushResult =
  | { status: 'ok'; envelope: SyncEnvelope }
  | { status: 'conflict'; envelope: SyncEnvelope }
  | { status: 'offline' }

export async function pushState(baseRev: number, data: FamilyData): Promise<PushResult> {
  try {
    const res = await fetch('/api/state', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ baseRev, data }),
    })
    const envelope = (await res.json()) as SyncEnvelope
    if (res.status === 409) return { status: 'conflict', envelope }
    if (!res.ok) return { status: 'offline' }
    return { status: 'ok', envelope }
  } catch {
    return { status: 'offline' }
  }
}

/** Subscribes to vault changes. Returns an unsubscribe function. */
export function subscribe(onEnvelope: (env: SyncEnvelope) => void, onDrop: () => void): () => void {
  let source: EventSource | null = null
  let closed = false

  const connect = () => {
    if (closed) return
    source = new EventSource('/events')
    source.onmessage = (evt) => {
      try {
        onEnvelope(JSON.parse(evt.data) as SyncEnvelope)
      } catch {
        /* ignore a malformed frame */
      }
    }
    source.onerror = () => {
      source?.close()
      source = null
      onDrop()
      if (!closed) setTimeout(connect, 3000)
    }
  }
  connect()

  return () => {
    closed = true
    source?.close()
  }
}

export interface IntegrationStatus {
  cli: boolean
  integrations: Record<string, { configured: boolean; ok: boolean; reason?: string }>
}

export async function integrationStatus(): Promise<IntegrationStatus | null> {
  try {
    const res = await fetch('/api/integrations')
    if (!res.ok) return null
    return (await res.json()) as IntegrationStatus
  } catch {
    return null
  }
}

export async function revealSecret(id: string, pin: string): Promise<{ value?: string; error?: string }> {
  try {
    const res = await fetch('/api/secrets/reveal', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id, pin }),
    })
    return (await res.json()) as { value?: string; error?: string }
  } catch {
    return { error: 'The sidecar is not reachable' }
  }
}

/** Asks the sidecar to fetch an ICS feed (no CORS problem server-side). */
export async function syncFeedOnServer(id: string): Promise<{ count?: number; error?: string }> {
  try {
    const res = await fetch('/api/feeds/sync', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    return (await res.json()) as { count?: number; error?: string }
  } catch {
    return { error: 'The sidecar is not reachable' }
  }
}
