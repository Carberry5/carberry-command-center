import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js'
import type {
  Countdown,
  FamilyData,
  FamilyEvent,
  FamilyList,
  Favorite,
  Feed,
  FitStats,
  Greenlight,
  Member,
  Preflight,
  Reward,
  SecretRef,
} from '../types.ts'

/**
 * Supabase replacement for the vault sidecar.
 *
 * The store still calls `update(draft => …)` and hands us a whole FamilyData
 * before and after. We flatten both into table rows, diff them, and send only
 * what actually changed — so the existing call sites keep working untouched
 * while the wire traffic stays proportional to the edit, not the document.
 *
 * The mapping and diffing below are deliberately pure and exported so they can
 * be tested without a network. scripts/cloudsync-test.ts runs them against a
 * real Postgres holding supabase/schema.sql, which proves every column named
 * here exists with a compatible type and that FamilyData survives a round trip
 * unchanged.
 *
 * Still unproven: everything from `supabase()` down. loadSnapshot,
 * applyMutations and subscribe talk to PostgREST and Realtime, which raw
 * Postgres does not provide — so those have been typechecked and reasoned
 * about but never executed. Expect the first run against the live project to
 * turn up something.
 */

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

export type Row = Record<string, unknown>

/** One flattened snapshot of a household, keyed by table name. */
export interface TableRows {
  households: Row[]
  members: Row[]
  member_links: Row[]
  events: Row[]
  event_members: Row[]
  chores: Row[]
  chore_members: Row[]
  chore_log: Row[]
  rewards: Row[]
  redemptions: Row[]
  favorites: Row[]
  meal_plan: Row[]
  lists: Row[]
  list_items: Row[]
  countdowns: Row[]
  feeds: Row[]
  secrets: Row[]
  preflight_kids: Row[]
  preflight_bring: Row[]
  fit_stats: Row[]
  greenlight: Row[]
  greenlight_payouts: Row[]
}

export type TableName = keyof TableRows

/**
 * The real primary key of each table, exactly as declared in
 * supabase/schema.sql. These double as ON CONFLICT targets, so they must match
 * an actual unique index — scripts/cloudsync-test.ts asserts that they all do.
 * Note household_id is part of the key for some tables and not others; that
 * asymmetry is why this is spelled out rather than derived.
 */
export const PRIMARY_KEYS: Record<TableName, string[]> = {
  households: ['id'],
  members: ['id'],
  member_links: ['id'],
  events: ['id'],
  event_members: ['event_id', 'member_id'],
  chores: ['id'],
  chore_members: ['chore_id', 'member_id'],
  chore_log: ['household_id', 'day', 'task_key', 'member_id'],
  rewards: ['id'],
  redemptions: ['id'],
  favorites: ['id'],
  meal_plan: ['household_id', 'day'],
  lists: ['id'],
  list_items: ['id'],
  countdowns: ['id'],
  feeds: ['id'],
  secrets: ['id'],
  preflight_kids: ['household_id', 'member_id'],
  preflight_bring: ['id'],
  fit_stats: ['household_id', 'member_id'],
  greenlight: ['household_id', 'member_id'],
  greenlight_payouts: ['id'],
}

/**
 * Insert/update order. Parents before children, so a new list and its items
 * land in one pass without tripping a foreign key.
 */
export const WRITE_ORDER: TableName[] = [
  'households',
  'members',
  'member_links',
  'events',
  'event_members',
  'chores',
  'chore_members',
  'chore_log',
  'rewards',
  'redemptions',
  'favorites',
  'meal_plan',
  'lists',
  'list_items',
  'countdowns',
  'feeds',
  'secrets',
  'preflight_kids',
  'preflight_bring',
  'fit_stats',
  'greenlight',
  'greenlight_payouts',
]

function emptyRows(): TableRows {
  return {
    households: [], members: [], member_links: [], events: [], event_members: [], chores: [],
    chore_members: [], chore_log: [], rewards: [], redemptions: [], favorites: [],
    meal_plan: [], lists: [], list_items: [], countdowns: [], feeds: [],
    secrets: [], preflight_kids: [], preflight_bring: [], fit_stats: [],
    greenlight: [], greenlight_payouts: [],
  }
}

// ---------------------------------------------------------------------------
// FamilyData -> rows
// ---------------------------------------------------------------------------

export function toRows(data: FamilyData, householdId: string): TableRows {
  const hh = householdId
  const rows = emptyRows()

  rows.households.push({
    id: hh,
    parent_pin: data.settings.pin,
    zip: data.settings.zip,
    lat: data.settings.lat,
    lon: data.settings.lon,
    place: data.settings.place,
    preflight_open: data.preflight.open,
    preflight_depart: data.preflight.depart ?? '07:30',
  })

  data.members.forEach((m, i) => {
    rows.members.push({
      id: m.id,
      household_id: hh,
      name: m.name,
      role: m.role,
      color: m.color,
      age: m.age ?? null,
      photo: m.photo ?? null,
      sort_order: i,
    })
    ;(m.links ?? []).forEach((l, li) => {
      rows.member_links.push({
        id: l.id, household_id: hh, member_id: m.id, label: l.label, url: l.url, sort_order: li,
      })
    })
  })

  data.events.forEach((e, i) => {
    rows.events.push({
      id: e.id,
      household_id: hh,
      title: e.title,
      date: e.date,
      start_time: e.start,
      dur: e.dur,
      loc: e.loc,
      recur: e.recur,
      drop_member_id: e.drop ?? null,
      pick_member_id: e.pick ?? null,
      sort_order: i,
    })
    e.memberIds.forEach((mid, mi) => {
      rows.event_members.push({ event_id: e.id, member_id: mid, household_id: hh, sort_order: mi })
    })
  })

  data.chores.forEach((c, i) => {
    rows.chores.push({
      id: c.id,
      household_id: hh,
      title: c.title,
      days: c.days,
      stars: c.stars,
      sort_order: i,
    })
    c.memberIds.forEach((mid, mi) => {
      rows.chore_members.push({ chore_id: c.id, member_id: mid, household_id: hh, sort_order: mi })
    })
  })

  Object.entries(data.done).forEach(([day, entries]) => {
    Object.keys(entries ?? {}).forEach((key) => {
      // "<task_key>|<member_id>" — split on the last separator so a task key
      // containing a pipe (none do today) can't swallow the member id.
      const cut = key.lastIndexOf('|')
      if (cut < 0) return
      rows.chore_log.push({
        household_id: hh,
        day,
        task_key: key.slice(0, cut),
        member_id: key.slice(cut + 1),
      })
    })
  })

  data.rewards.forEach((r, i) => {
    rows.rewards.push({ id: r.id, household_id: hh, title: r.title, cost: r.cost, sort_order: i })
  })

  data.redemptions.forEach((r, i) => {
    rows.redemptions.push({
      id: r.id, household_id: hh, kid_id: r.kidId, title: r.title, cost: r.cost,
      ts: r.ts, sort_order: i,
    })
  })

  data.favorites.forEach((f, i) => {
    rows.favorites.push({ id: f.id, household_id: hh, name: f.name, tag: f.tag ?? null, sort_order: i })
  })

  Object.entries(data.mealPlan).forEach(([day, meal]) => {
    rows.meal_plan.push({ household_id: hh, day, meal })
  })

  data.lists.forEach((l, i) => {
    rows.lists.push({ id: l.id, household_id: hh, name: l.name, sort_order: i })
    l.items.forEach((it, ii) => {
      rows.list_items.push({
        id: it.id, list_id: l.id, household_id: hh, text: it.text,
        done: it.done, by_member_id: it.by ?? null, source: it.src ?? null,
        remote_id: it.rid ?? null, sort_order: ii,
      })
    })
  })

  data.countdowns.forEach((c, i) => {
    rows.countdowns.push({
      id: c.id, household_id: hh, title: c.title, date: c.date,
      member_id: c.memberId, sort_order: i,
    })
  })

  data.settings.feeds.forEach((f, i) => {
    rows.feeds.push({
      id: f.id, household_id: hh, name: f.name, url: f.url, op_ref: f.opRef ?? null,
      color: f.color, status: f.status, member_ids: f.memberIds ?? [], sort_order: i,
    })
  })

  data.secrets.forEach((s, i) => {
    rows.secrets.push({
      id: s.id, household_id: hh, label: s.label, ref: s.ref, note: s.note ?? null, sort_order: i,
    })
  })

  Object.entries(data.preflight.kids ?? {}).forEach(([memberId, cfg]) => {
    rows.preflight_kids.push({
      household_id: hh, member_id: memberId, gym: cfg.gym ?? [], lun: cfg.lun ?? [],
    })
    ;(cfg.bring ?? []).forEach((b, bi) => {
      rows.preflight_bring.push({
        id: b.id, household_id: hh, member_id: memberId, text: b.text,
        days: b.days, sort_order: bi,
      })
    })
  })

  Object.entries(data.fit ?? {}).forEach(([memberId, stats]) => {
    rows.fit_stats.push({
      household_id: hh,
      member_id: memberId,
      kind: stats.kind,
      sleep: stats.sleep,
      strain: stats.kind === 'whoop' ? stats.strain : null,
      act: stats.kind === 'oura' ? stats.act : null,
    })
  })

  Object.entries(data.gl ?? {}).forEach(([memberId, g]) => {
    rows.greenlight.push({
      household_id: hh, member_id: memberId, bal: g.bal, allow: g.allow,
      goal: g.goal, goal_cost: g.goalCost, saved: g.saved,
    })
    ;(g.pay ?? []).forEach((p, pi) => {
      rows.greenlight_payouts.push({
        // Payouts have no client-side id; derive a stable one so the differ
        // can match them across edits.
        id: `${memberId}:${pi}`,
        household_id: hh,
        member_id: memberId,
        d: p.d,
        for_what: p.for,
        amt: p.amt,
        sort_order: pi,
      })
    })
  })

  return rows
}

// ---------------------------------------------------------------------------
// rows -> FamilyData
// ---------------------------------------------------------------------------

const num = (v: unknown, fallback = 0): number => {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : fallback
}
const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback)
const bySort = (a: Row, b: Row) => num(a.sort_order) - num(b.sort_order)

/** Postgres `date` arrives as "YYYY-MM-DD"; guard against a full timestamp. */
const day = (v: unknown): string => str(v).slice(0, 10)

/**
 * `feedEvents` is passed separately rather than living in TableRows: those rows
 * are written only by the scheduled ICS sync, and keeping them out of the
 * writable set means the differ can never generate a write for them.
 */
export function fromRows(rows: TableRows, base: FamilyData, feedEvents: Row[] = []): FamilyData {
  const hh = rows.households[0] ?? {}

  const linksByMember = new Map<string, Row[]>()
  for (const r of rows.member_links) {
    const list = linksByMember.get(str(r.member_id)) ?? []
    list.push(r)
    linksByMember.set(str(r.member_id), list)
  }

  const members: Member[] = [...rows.members].sort(bySort).map((r) => ({
    id: str(r.id),
    name: str(r.name),
    role: r.role === 'kid' ? 'kid' : 'parent',
    color: str(r.color, '#4A5B8C'),
    ...(r.age == null ? {} : { age: num(r.age) }),
    ...(r.photo == null ? {} : { photo: str(r.photo) }),
    links: (linksByMember.get(str(r.id)) ?? []).sort(bySort).map((l) => ({
      id: str(l.id), label: str(l.label), url: str(l.url),
    })),
  }))

  const eventMembers = new Map<string, string[]>()
  ;[...rows.event_members].sort(bySort).forEach((r) => {
    const list = eventMembers.get(str(r.event_id)) ?? []
    list.push(str(r.member_id))
    eventMembers.set(str(r.event_id), list)
  })

  const events: FamilyEvent[] = [...rows.events].sort(bySort).map((r) => ({
    id: str(r.id),
    title: str(r.title),
    date: day(r.date),
    start: r.start_time == null ? null : str(r.start_time),
    dur: r.dur == null ? null : num(r.dur),
    memberIds: eventMembers.get(str(r.id)) ?? [],
    loc: str(r.loc),
    recur: r.recur === 'weekly' ? 'weekly' : null,
    ...(r.drop_member_id == null ? {} : { drop: str(r.drop_member_id) }),
    ...(r.pick_member_id == null ? {} : { pick: str(r.pick_member_id) }),
  }))

  const choreMembers = new Map<string, string[]>()
  ;[...rows.chore_members].sort(bySort).forEach((r) => {
    const list = choreMembers.get(str(r.chore_id)) ?? []
    list.push(str(r.member_id))
    choreMembers.set(str(r.chore_id), list)
  })

  const chores = [...rows.chores].sort(bySort).map((r) => ({
    id: str(r.id),
    title: str(r.title),
    memberIds: choreMembers.get(str(r.id)) ?? [],
    days: (r.days as number[]) ?? [],
    stars: num(r.stars),
  }))

  const done: FamilyData['done'] = {}
  rows.chore_log.forEach((r) => {
    const d = day(r.day)
    ;(done[d] ??= {})[`${str(r.task_key)}|${str(r.member_id)}`] = 1
  })

  const rewards: Reward[] = [...rows.rewards].sort(bySort).map((r) => ({
    id: str(r.id), title: str(r.title), cost: num(r.cost),
  }))

  const redemptions = [...rows.redemptions].sort(bySort).map((r) => ({
    id: str(r.id), kidId: str(r.kid_id), title: str(r.title),
    cost: num(r.cost), ts: num(r.ts),
  }))

  const favorites: Favorite[] = [...rows.favorites].sort(bySort).map((r) => ({
    id: str(r.id),
    name: str(r.name),
    ...(r.tag == null ? {} : { tag: str(r.tag) }),
  }))

  const mealPlan: Record<string, string> = {}
  rows.meal_plan.forEach((r) => {
    mealPlan[day(r.day)] = str(r.meal)
  })

  const itemsByList = new Map<string, Row[]>()
  rows.list_items.forEach((r) => {
    const list = itemsByList.get(str(r.list_id)) ?? []
    list.push(r)
    itemsByList.set(str(r.list_id), list)
  })

  const lists: FamilyList[] = [...rows.lists].sort(bySort).map((r) => ({
    id: str(r.id),
    name: str(r.name),
    items: (itemsByList.get(str(r.id)) ?? []).sort(bySort).map((it) => ({
      id: str(it.id),
      text: str(it.text),
      done: it.done === true,
      by: str(it.by_member_id),
      // Omitted rather than set to undefined: toRows/diff compare canonicalised
      // objects, and a present-but-undefined key is not the same string as an
      // absent one, which would make every app-typed item look changed.
      ...(it.source == null ? {} : { src: str(it.source) }),
      ...(it.remote_id == null ? {} : { rid: str(it.remote_id) }),
    })),
  }))

  const countdowns: Countdown[] = [...rows.countdowns].sort(bySort).map((r) => ({
    id: str(r.id),
    title: str(r.title),
    date: day(r.date),
    memberId: r.member_id == null ? null : str(r.member_id),
  }))

  const feeds: Feed[] = [...rows.feeds].sort(bySort).map((r) => ({
    id: str(r.id),
    name: str(r.name),
    url: str(r.url),
    ...(r.op_ref == null ? {} : { opRef: str(r.op_ref) }),
    color: str(r.color, '#5B8DEF'),
    status: str(r.status),
    memberIds: (r.member_ids as string[]) ?? [],
  }))

  const secrets: SecretRef[] = [...rows.secrets].sort(bySort).map((r) => ({
    id: str(r.id),
    label: str(r.label),
    ref: str(r.ref),
    ...(r.note == null ? {} : { note: str(r.note) }),
  }))

  const bringByMember = new Map<string, Row[]>()
  rows.preflight_bring.forEach((r) => {
    const list = bringByMember.get(str(r.member_id)) ?? []
    list.push(r)
    bringByMember.set(str(r.member_id), list)
  })

  const preflight: Preflight = {
    open: hh.preflight_open !== false,
    depart: str(hh.preflight_depart, '07:30'),
    kids: {},
  }
  rows.preflight_kids.forEach((r) => {
    const mid = str(r.member_id)
    preflight.kids[mid] = {
      gym: (r.gym as number[]) ?? [],
      lun: (r.lun as number[]) ?? [],
      bring: (bringByMember.get(mid) ?? []).sort(bySort).map((b) => ({
        id: str(b.id), text: str(b.text), days: (b.days as number[]) ?? [],
      })),
    }
  })

  const fit: Record<string, FitStats> = {}
  rows.fit_stats.forEach((r) => {
    const mid = str(r.member_id)
    fit[mid] = r.kind === 'oura'
      ? { kind: 'oura', sleep: num(r.sleep), act: num(r.act) }
      : { kind: 'whoop', sleep: num(r.sleep), strain: num(r.strain) }
  })

  const payByMember = new Map<string, Row[]>()
  rows.greenlight_payouts.forEach((r) => {
    const list = payByMember.get(str(r.member_id)) ?? []
    list.push(r)
    payByMember.set(str(r.member_id), list)
  })

  // Read-only, keyed by feed id, in the shape selectors.ts already merges into
  // the calendar alongside the family's own events.
  const feedMembers = new Map(feeds.map((f) => [f.id, f.memberIds]))
  const feedEv: Record<string, FamilyEvent[]> = {}
  for (const r of [...feedEvents].sort(bySort)) {
    const fid = str(r.feed_id)
    ;(feedEv[fid] ??= []).push({
      id: str(r.id),
      title: str(r.title),
      date: day(r.date),
      start: r.start_time == null ? null : str(r.start_time),
      dur: r.dur == null ? null : num(r.dur),
      // Applied from the feed at read time, not stored per event — retagging a
      // feed takes effect immediately instead of waiting for the next sync.
      memberIds: feedMembers.get(fid) ?? [],
      loc: str(r.loc),
      recur: r.recur === 'weekly' ? 'weekly' : null,
    })
  }

  const gl: Record<string, Greenlight> = {}
  rows.greenlight.forEach((r) => {
    const mid = str(r.member_id)
    gl[mid] = {
      bal: num(r.bal),
      allow: num(r.allow),
      goal: str(r.goal),
      goalCost: num(r.goal_cost),
      saved: num(r.saved),
      pay: (payByMember.get(mid) ?? []).sort(bySort).map((p) => ({
        d: str(p.d), for: str(p.for_what), amt: num(p.amt),
      })),
    }
  })

  return {
    members,
    events,
    chores,
    done,
    rewards,
    redemptions,
    favorites,
    mealPlan,
    lists,
    countdowns,
    settings: {
      pin: str(hh.parent_pin, base.settings.pin),
      zip: str(hh.zip),
      lat: num(hh.lat),
      lon: num(hh.lon),
      place: str(hh.place),
      feeds,
    },
    feedEv,
    preflight,
    fit,
    gl,
    secrets,
  }
}

// ---------------------------------------------------------------------------
// Diffing
// ---------------------------------------------------------------------------

export interface Mutation {
  table: TableName
  upsert: Row[]
  /** Primary key values (household_id excluded) for rows that disappeared. */
  remove: Row[]
}

function keyOf(row: Row, pk: string[]): string {
  return pk.map((c) => String(row[c])).join('\u0000')
}

/** Stable stringify so key order can't fake a change. */
function canon(row: Row): string {
  return JSON.stringify(
    Object.keys(row)
      .sort()
      .map((k) => [k, row[k]])
  )
}

/**
 * Row-level diff of two snapshots. Returns only tables with real changes, so a
 * one-checkbox edit produces one small upsert rather than a full rewrite.
 */
export function diffRows(before: TableRows, after: TableRows): Mutation[] {
  const out: Mutation[] = []

  for (const table of WRITE_ORDER) {
    const pk = PRIMARY_KEYS[table]
    const beforeMap = new Map<string, Row>()
    for (const r of before[table]) beforeMap.set(keyOf(r, pk), r)

    const upsert: Row[] = []
    const seen = new Set<string>()

    for (const r of after[table]) {
      const k = keyOf(r, pk)
      seen.add(k)
      const prev = beforeMap.get(k)
      if (!prev || canon(prev) !== canon(r)) upsert.push(r)
    }

    const remove: Row[] = []
    for (const [k, r] of beforeMap) {
      if (!seen.has(k)) {
        const pkOnly: Row = {}
        for (const c of pk) pkOnly[c] = r[c]
        remove.push(pkOnly)
      }
    }

    if (upsert.length || remove.length) out.push({ table, upsert, remove })
  }

  return out
}

/** Convenience: diff two FamilyData snapshots directly. */
export function diff(before: FamilyData, after: FamilyData, householdId: string): Mutation[] {
  return diffRows(toRows(before, householdId), toRows(after, householdId))
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

interface ViteEnv {
  VITE_SUPABASE_URL?: string
  VITE_SUPABASE_ANON_KEY?: string
}

function env(): ViteEnv {
  try {
    return ((import.meta as unknown as { env?: ViteEnv }).env ?? {}) as ViteEnv
  } catch {
    return {}
  }
}

let client: SupabaseClient | null = null

/**
 * Point this module at a project explicitly rather than at import.meta.env.
 * The browser never needs it — Vite supplies the env — but Node has no Vite,
 * so scripts/cloud-smoke.ts uses this to drive the real client.
 */
export function configureCloud(
  url: string,
  anonKey: string,
  opts: { persistSession?: boolean } = {}
): SupabaseClient {
  const persist = opts.persistSession ?? true
  client = createClient(url, anonKey, {
    auth: {
      persistSession: persist,
      autoRefreshToken: true,
      // Only meaningful in a browser, where the magic link comes back in the URL.
      detectSessionInUrl: persist,
    },
  })
  return client
}

export function supabase(): SupabaseClient {
  if (client) return client
  const { VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY } = env()
  if (!VITE_SUPABASE_URL || !VITE_SUPABASE_ANON_KEY) {
    throw new Error('VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must be set')
  }
  client = createClient(VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  })
  return client
}

/** True when the build has Supabase credentials to talk to at all. */
export function isConfigured(): boolean {
  const e = env()
  return Boolean(e.VITE_SUPABASE_URL && e.VITE_SUPABASE_ANON_KEY)
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/** The caller's household, or null when the session isn't linked to one. */
export async function currentHouseholdId(): Promise<string | null> {
  const { data, error } = await supabase()
    .from('household_users')
    .select('household_id')
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return (data?.household_id as string | undefined) ?? null
}

/**
 * Pulls every household-scoped table in one round of parallel selects and
 * rebuilds FamilyData. At family scale this is a few hundred rows, which is
 * why realtime can simply re-snapshot instead of patching in place.
 */
export async function loadSnapshot(householdId: string, base: FamilyData): Promise<FamilyData> {
  const sb = supabase()
  const rows = emptyRows()

  const results = await Promise.all(
    WRITE_ORDER.map(async (table) => {
      const query = sb.from(table).select('*')
      const { data, error } =
        table === 'households'
          ? await query.eq('id', householdId)
          : await query.eq('household_id', householdId)
      if (error) throw new Error(`${table}: ${error.message}`)
      return [table, (data ?? []) as Row[]] as const
    })
  )

  for (const [table, data] of results) rows[table] = data

  // Read-only: written by the scheduled ICS sync, never by a device.
  const { data: feedEvents, error: feErr } = await sb
    .from('feed_events')
    .select('*')
    .eq('household_id', householdId)
  if (feErr) throw new Error(`feed_events: ${feErr.message}`)

  return fromRows(rows, base, (feedEvents ?? []) as Row[])
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

const CHUNK = 500

function chunked<T>(items: T[], size = CHUNK): T[][] {
  if (items.length <= size) return items.length ? [items] : []
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

/** PostgREST filter literal — quote anything that isn't plainly safe bare. */
function lit(value: unknown): string {
  const s = String(value)
  return /^[A-Za-z0-9_:-]+$/.test(s) ? s : `"${s.replace(/["\\]/g, '\\$&')}"`
}

/**
 * Composite-key delete filter for PostgREST:
 *   or=(and(a.eq.1,b.eq.2),and(a.eq.3,b.eq.4))
 *
 * Exported so it can be unit tested — a syntax slip here would otherwise only
 * surface as a failed delete at runtime.
 */
export function compositeDeleteFilter(rows: Row[], pk: string[]): string {
  return rows
    .map((r) => `and(${pk.map((c) => `${c}.eq.${lit(r[c])}`).join(',')})`)
    .join(',')
}

/**
 * Applies a diff. Upserts run parent-first; deletes run child-first, so a
 * removed list takes its items with it without orphaning a foreign key.
 */
export async function applyMutations(mutations: Mutation[], householdId: string): Promise<void> {
  const sb = supabase()
  const byTable = new Map(mutations.map((m) => [m.table, m]))

  // Deletes, children before parents.
  for (const table of [...WRITE_ORDER].reverse()) {
    const m = byTable.get(table)
    if (!m?.remove.length) continue
    const pk = PRIMARY_KEYS[table]

    for (const batch of chunked(m.remove, 100)) {
      let q = sb.from(table).delete()
      if (table !== 'households') q = q.eq('household_id', householdId)

      if (pk.length === 1) {
        q = q.in(pk[0], batch.map((r) => r[pk[0]] as string))
      } else {
        q = q.or(compositeDeleteFilter(batch, pk))
      }
      const { error } = await q
      if (error) throw new Error(`delete ${table}: ${error.message}`)
    }
  }

  // Upserts, parents before children.
  for (const table of WRITE_ORDER) {
    const m = byTable.get(table)
    if (!m?.upsert.length) continue
    const onConflict = PRIMARY_KEYS[table].join(',')

    for (const batch of chunked(m.upsert)) {
      const { error } = await sb.from(table).upsert(batch, { onConflict })
      if (error) throw new Error(`upsert ${table}: ${error.message}`)
    }
  }
}

/** Diff two snapshots and push the difference. Returns the mutations sent. */
export async function pushChanges(
  before: FamilyData,
  after: FamilyData,
  householdId: string
): Promise<Mutation[]> {
  const mutations = diff(before, after, householdId)
  if (mutations.length) await applyMutations(mutations, householdId)
  return mutations
}

// ---------------------------------------------------------------------------
// Realtime — replaces the vault watcher
// ---------------------------------------------------------------------------

/** Makes each subscription's channel topic unique. See subscribe(). */
let channelSeq = 0

/**
 * Watches every household table and calls `onChange` after things settle.
 *
 * The sidecar pushed a whole envelope on each vault write, and the store was
 * built around that; so rather than patching row events into state, we debounce
 * them and hand back a fresh snapshot. Returns an unsubscribe function.
 *
 * Realtime evaluates RLS as the subscribing user, so the socket needs the
 * session's access token before the channel is created. Without it the socket
 * authenticates with the anon key, matches none of the household policies, and
 * delivers nothing — while still reporting SUBSCRIBED. That failure is
 * completely silent, which is why the token is set explicitly here rather than
 * left to supabase-js, and refreshed when the session rolls over.
 */
export function subscribe(
  householdId: string,
  onChange: () => void,
  opts: { debounceMs?: number; onStatus?: (status: string) => void } = {}
): () => void {
  const debounceMs = opts.debounceMs ?? 150
  const sb = supabase()
  let timer: ReturnType<typeof setTimeout> | null = null
  let channel: RealtimeChannel | null = null
  let closed = false

  const ping = () => {
    if (closed) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      onChange()
    }, debounceMs)
  }

  // A refreshed JWT has to reach the socket too, or events stop arriving an
  // hour in — the same silence, just delayed.
  const { data: authSub } = sb.auth.onAuthStateChange((_event, session) => {
    if (session?.access_token) void sb.realtime.setAuth(session.access_token)
  })

  void (async () => {
    const { data } = await sb.auth.getSession()
    if (data.session?.access_token) await sb.realtime.setAuth(data.session.access_token)
    if (closed) return

    // supabase-js caches channels by topic and returns the existing one for a
    // repeated name — so a second subscribe() for the same household gets back
    // an already-subscribed channel and throws on .on(). A per-call topic
    // avoids that entirely. It also drops the colon the old name carried;
    // supabase-js already prefixes topics with "realtime:", and a second
    // separator is not worth risking in the server's topic routing.
    let ch = sb.channel(`household-${householdId}-${++channelSeq}`)
    // feed_events is read-only to the client but still worth watching: when the
    // scheduled ICS sync lands new school events, the calendar should pick them
    // up without anyone reloading.
    for (const table of [...WRITE_ORDER, 'feed_events'] as const) {
      ch = ch.on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table,
          filter: table === 'households' ? `id=eq.${householdId}` : `household_id=eq.${householdId}`,
        },
        ping
      )
    }
    channel = ch
    // SUBSCRIBED / CHANNEL_ERROR / TIMED_OUT / CLOSED. Worth surfacing: on its
    // own, SUBSCRIBED is not evidence that anything will actually arrive.
    ch.subscribe((status) => opts.onStatus?.(status))
  })()

  return () => {
    closed = true
    if (timer) clearTimeout(timer)
    authSub.subscription.unsubscribe()
    if (channel) void sb.removeChannel(channel)
  }
}
