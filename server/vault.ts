import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type {
  Chore,
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
  Redemption,
  Reward,
  SecretRef,
} from '../src/types.ts'
import { DOW_NAMES, dowOf, parseDay, uid } from '../src/lib/dates.ts'
import { kidConfig, preflightRows } from '../src/lib/preflight.ts'
import { migrate } from '../src/data/migrate.ts'
import {
  buildDoc,
  buildTable,
  buildTask,
  parseDoc,
  parseNum,
  parseTable,
  parseTasks,
  section,
  slug,
  uniqueSlug,
} from './markdown.ts'
import { vaultDir } from './config.ts'

/**
 * The two-way markdown mirror.
 *
 * The vault is the durable store: `read()` rebuilds FamilyData from the files,
 * `write()` renders FamilyData back out. Anything a human types in Obsidian
 * survives a round trip, and anything the app can't map to a readable row is
 * still written somewhere it can be read back (see the chore log's "Unmatched"
 * table) so a sync never silently drops data.
 */

const FILES = {
  family: 'Family.md',
  events: 'Events.md',
  chores: 'Chores.md',
  meals: 'Meals.md',
  countdowns: 'Countdowns.md',
  secrets: 'Secrets.md',
  readme: 'README.md',
}
const LISTS_DIR = 'Lists'
const LOG_DIR = 'Chore Log'

const p = (...parts: string[]) => join(vaultDir, ...parts)

async function readIf(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return null
  }
}

/** Days column: "daily", "Mon Wed Fri", "1,3,5" — all accepted. */
function parseDays(v: string): number[] {
  const s = (v ?? '').trim().toLowerCase()
  if (!s) return []
  if (s === 'daily' || s === 'every day') return [0, 1, 2, 3, 4, 5, 6]
  if (s === 'weekdays' || s === 'school days') return [1, 2, 3, 4, 5]
  if (s === 'weekends') return [0, 6]
  const out = new Set<number>()
  for (const tok of s.split(/[\s,]+/).filter(Boolean)) {
    if (/^\d$/.test(tok)) {
      out.add(Number(tok))
      continue
    }
    const idx = DOW_NAMES.findIndex((d) => d.toLowerCase() === tok.slice(0, 3))
    if (idx >= 0) out.add(idx)
  }
  return [...out].sort((a, b) => a - b)
}

const fmtDays = (days: number[]) =>
  days.length === 7 ? 'daily' : days.length ? days.slice().sort((a, b) => a - b).map((i) => DOW_NAMES[i]).join(' ') : ''

/** Resolves a comma-separated list of member names to ids, ignoring unknowns. */
function idsFromNames(names: string, members: Member[]): string[] {
  return (names ?? '')
    .split(',')
    .map((n) => n.trim().toLowerCase())
    .filter(Boolean)
    .filter((n) => n !== 'everyone' && n !== 'family')
    .map((n) => members.find((m) => m.name.toLowerCase() === n)?.id)
    .filter((x): x is string => !!x)
}

const namesFromIds = (ids: string[] | undefined, members: Member[]) =>
  (ids ?? [])
    .map((id) => members.find((m) => m.id === id)?.name)
    .filter(Boolean)
    .join(', ')

const idFromName = (name: string, members: Member[]) =>
  members.find((m) => m.name.toLowerCase() === (name ?? '').trim().toLowerCase())?.id ?? null

// ---------------------------------------------------------------------------
// Family.md — members, weather, feeds, PIN, pre-flight config, integrations
// ---------------------------------------------------------------------------

function renderFamily(d: FamilyData): string {
  const front = {
    fc: 'family',
    pin: d.settings.pin,
    weather: { zip: d.settings.zip, lat: d.settings.lat, lon: d.settings.lon, place: d.settings.place },
    members: d.members.map((m) => ({
      id: m.id,
      name: m.name,
      role: m.role,
      color: m.color,
      ...(m.age !== undefined ? { age: m.age } : {}),
      ...(m.photo ? { photo: m.photo } : {}),
    })),
    feeds: d.settings.feeds.map((f) => ({
      id: f.id,
      name: f.name,
      ...(f.url ? { url: f.url } : {}),
      ...(f.opRef ? { opRef: f.opRef } : {}),
      color: f.color,
      status: f.status,
    })),
    preflight: {
      open: d.preflight.open,
      depart: d.preflight.depart ?? '07:30',
      kids: d.preflight.kids,
    },
    integrations: { fit: d.fit, greenlight: d.gl },
  }

  const roster = buildTable(
    ['Who', 'Role', 'Age', 'Colour'],
    d.members.map((m) => [m.name, m.role, m.age ?? '—', m.color])
  )

  const preflightBody = d.members
    .filter((m) => m.role === 'kid')
    .map((k) => {
      const cfg = kidConfig(d.preflight, k.id)
      const bring = cfg.bring.length
        ? cfg.bring.map((b) => `  - ${b.text} — ${fmtDays(b.days) || 'no days set'}`).join('\n')
        : '  - _nothing yet_'
      return [
        `### ${k.name}`,
        `- Gym uniform: ${fmtDays(cfg.gym) || 'never'}`,
        `- Packed lunch: ${fmtDays(cfg.lun) || 'never'}`,
        `- Bring along:`,
        bring,
      ].join('\n')
    })
    .join('\n\n')

  const body = [
    '# The family',
    '',
    'Edit people, colours, calendar feeds and the pre-flight setup in this note\'s',
    'properties (the frontmatter above). The table below is written by the app for',
    'reading — changes to it are overwritten on the next sync.',
    '',
    roster,
    '## Morning pre-flight',
    '',
    `School is currently **${d.preflight.open ? 'in session' : 'out'}**. The car leaves at **${d.preflight.depart ?? '07:30'}**.`,
    '',
    preflightBody,
    '',
  ].join('\n')

  return buildDoc(front, body)
}

interface FamilyDoc {
  members: Member[]
  settings: FamilyData['settings']
  preflight: Preflight
  fit: Record<string, FitStats>
  gl: Record<string, Greenlight>
}

function parseFamily(src: string): FamilyDoc | null {
  const { front } = parseDoc(src)
  const members = Array.isArray(front.members) ? (front.members as Member[]) : []
  if (!members.length) return null
  const weather = (front.weather ?? {}) as Record<string, unknown>
  const pf = (front.preflight ?? {}) as Record<string, unknown>
  const integrations = (front.integrations ?? {}) as Record<string, unknown>

  return {
    members: members.map((m) => ({
      id: String(m.id ?? slug(m.name ?? 'member')),
      name: String(m.name ?? 'Member'),
      role: m.role === 'parent' ? 'parent' : 'kid',
      color: String(m.color ?? '#8A63C9'),
      ...(m.age !== undefined && m.age !== null ? { age: Number(m.age) } : {}),
      ...(m.photo ? { photo: String(m.photo) } : {}),
    })),
    settings: {
      pin: String(front.pin ?? '1234'),
      zip: String(weather.zip ?? '20165'),
      lat: Number(weather.lat ?? 39.065),
      lon: Number(weather.lon ?? -77.395),
      place: String(weather.place ?? 'Potomac Falls, VA'),
      feeds: (Array.isArray(front.feeds) ? (front.feeds as Feed[]) : []).map((f) => ({
        id: String(f.id ?? uid()),
        name: String(f.name ?? 'Calendar feed'),
        url: String(f.url ?? ''),
        ...(f.opRef ? { opRef: String(f.opRef) } : {}),
        color: String(f.color ?? '#5B8DEF'),
        status: String(f.status ?? 'Not synced yet'),
      })),
    },
    preflight: {
      open: pf.open !== false,
      depart: String(pf.depart ?? '07:30'),
      kids: (pf.kids ?? {}) as Preflight['kids'],
    },
    fit: ((integrations.fit ?? {}) as Record<string, FitStats>) ?? {},
    gl: ((integrations.greenlight ?? {}) as Record<string, Greenlight>) ?? {},
  }
}

// ---------------------------------------------------------------------------
// Events.md
// ---------------------------------------------------------------------------

const EVENT_HEADERS = ['Date', 'Time', 'Title', 'Who', 'Where', 'Mins', 'Repeats', 'Drop-off', 'Pick-up', 'ID']

function renderEvents(d: FamilyData): string {
  const rows = d.events
    .slice()
    .sort((a, b) => (a.date === b.date ? (a.start ?? '') .localeCompare(b.start ?? '') : a.date.localeCompare(b.date)))
    .map((e) => [
      e.date,
      e.start ?? '',
      e.title,
      namesFromIds(e.memberIds, d.members) || 'Everyone',
      e.loc ?? '',
      e.dur ?? '',
      e.recur === 'weekly' ? 'weekly' : '',
      e.drop ? namesFromIds([e.drop], d.members) : '',
      e.pick ? namesFromIds([e.pick], d.members) : '',
      e.id,
    ])

  const body = [
    '# Calendar',
    '',
    'One row per event. Add a row and leave **ID** blank — the app fills it in on',
    'the next sync. `Repeats` accepts `weekly`. `Who` is a comma-separated list of',
    'names; leave it as `Everyone` for whole-family events.',
    '',
    buildTable(EVENT_HEADERS, rows),
  ].join('\n')

  return buildDoc({ fc: 'events' }, body)
}

function parseEvents(src: string, members: Member[]): FamilyEvent[] {
  const { body } = parseDoc(src)
  return parseTable(body)
    .filter((r) => (r.title ?? '').trim() && /^\d{4}-\d{2}-\d{2}$/.test((r.date ?? '').trim()))
    .map((r) => ({
      id: (r.id ?? '').trim() || uid(),
      title: r.title.trim(),
      date: r.date.trim(),
      start: /^\d{1,2}:\d{2}$/.test((r.time ?? '').trim()) ? r.time.trim().padStart(5, '0') : null,
      dur: (r.mins ?? '').trim() ? parseNum(r.mins) : null,
      memberIds: idsFromNames(r.who ?? '', members),
      loc: (r.where ?? '').trim(),
      recur: /weekly/i.test(r.repeats ?? '') ? ('weekly' as const) : null,
      drop: idFromName(r['drop-off'] ?? '', members),
      pick: idFromName(r['pick-up'] ?? '', members),
    }))
}

// ---------------------------------------------------------------------------
// Chores.md — chores, reward shop, redemption history
// ---------------------------------------------------------------------------

function renderChores(d: FamilyData): string {
  const chores = buildTable(
    ['Chore', 'Who', 'Days', 'Stars', 'ID'],
    d.chores.map((c) => [c.title, namesFromIds(c.memberIds, d.members), fmtDays(c.days), c.stars, c.id])
  )
  const rewards = buildTable(
    ['Reward', 'Stars'],
    d.rewards.map((r) => [r.title, r.cost])
  )
  const redemptions = buildTable(
    ['When', 'Who', 'Reward', 'Stars'],
    d.redemptions
      .slice()
      .sort((a, b) => a.ts - b.ts)
      .map((r) => [
        new Date(r.ts).toISOString().slice(0, 10),
        namesFromIds([r.kidId], d.members),
        r.title,
        r.cost,
      ])
  )

  const body = [
    '# Chores',
    '',
    'Keep the **ID** column — the daily checklists in `Chore Log/` point at it.',
    '`Days` accepts `daily`, `weekdays`, or day names like `Mon Wed Fri`.',
    '',
    chores,
    '## Reward shop',
    '',
    rewards,
    '## Redemptions',
    '',
    redemptions,
  ].join('\n')

  return buildDoc({ fc: 'chores' }, body)
}

function parseChores(src: string, members: Member[]): {
  chores: Chore[]
  rewards: Reward[]
  redemptions: Redemption[]
} {
  const { body } = parseDoc(src)
  const takenChore = new Set<string>()
  const chores = parseTable(section(body, 'Chores') || body)
    .filter((r) => (r.chore ?? '').trim())
    .map((r) => ({
      id: (r.id ?? '').trim() || uniqueSlug(slug(r.chore), takenChore),
      title: r.chore.trim(),
      memberIds: idsFromNames(r.who ?? '', members),
      days: parseDays(r.days ?? ''),
      stars: Math.max(1, parseNum(r.stars, 1)),
    }))
  chores.forEach((c) => takenChore.add(c.id))

  const takenReward = new Set<string>()
  const rewards = parseTable(section(body, 'Reward shop'))
    .filter((r) => (r.reward ?? '').trim())
    .map((r) => ({
      id: uniqueSlug(slug(r.reward), takenReward),
      title: r.reward.trim(),
      cost: Math.max(1, parseNum(r.stars, 1)),
    }))

  const redemptions = parseTable(section(body, 'Redemptions'))
    .filter((r) => (r.reward ?? '').trim())
    .map((r) => ({
      id: uid(),
      kidId: idFromName(r.who ?? '', members) ?? '',
      title: r.reward.trim(),
      cost: parseNum(r.stars, 0),
      ts: /^\d{4}-\d{2}-\d{2}$/.test((r.when ?? '').trim()) ? parseDay(r.when.trim()).getTime() : Date.now(),
    }))
    .filter((r) => r.kidId)

  return { chores, rewards, redemptions }
}

// ---------------------------------------------------------------------------
// Meals.md
// ---------------------------------------------------------------------------

function renderMeals(d: FamilyData): string {
  const plan = buildTable(
    ['Date', 'Dinner'],
    Object.keys(d.mealPlan)
      .sort()
      .map((ds) => [ds, d.mealPlan[ds]])
  )
  const favs = buildTable(
    ['Meal', 'Tag'],
    d.favorites.map((f) => [f.name, f.tag ?? ''])
  )
  const body = ['# Dinner plan', '', plan, '## Family favorites', '', favs].join('\n')
  return buildDoc({ fc: 'meals' }, body)
}

function parseMeals(src: string): { mealPlan: Record<string, string>; favorites: Favorite[] } {
  const { body } = parseDoc(src)
  const mealPlan: Record<string, string> = {}
  for (const r of parseTable(section(body, 'Dinner plan') || body)) {
    const date = (r.date ?? '').trim()
    const dinner = (r.dinner ?? '').trim()
    if (/^\d{4}-\d{2}-\d{2}$/.test(date) && dinner) mealPlan[date] = dinner
  }
  const taken = new Set<string>()
  const favorites = parseTable(section(body, 'Family favorites'))
    .filter((r) => (r.meal ?? '').trim())
    .map((r) => ({
      id: uniqueSlug(slug(r.meal), taken),
      name: r.meal.trim(),
      tag: (r.tag ?? '').trim() || undefined,
    }))
  return { mealPlan, favorites }
}

// ---------------------------------------------------------------------------
// Countdowns.md
// ---------------------------------------------------------------------------

function renderCountdowns(d: FamilyData): string {
  const body = [
    '# Countdowns',
    '',
    buildTable(
      ['Date', 'What', 'Who'],
      d.countdowns
        .slice()
        .sort((a, b) => a.date.localeCompare(b.date))
        .map((c) => [c.date, c.title, c.memberId ? namesFromIds([c.memberId], d.members) : 'Everyone'])
    ),
  ].join('\n')
  return buildDoc({ fc: 'countdowns' }, body)
}

function parseCountdowns(src: string, members: Member[]): Countdown[] {
  const { body } = parseDoc(src)
  const taken = new Set<string>()
  return parseTable(body)
    .filter((r) => (r.what ?? '').trim() && /^\d{4}-\d{2}-\d{2}$/.test((r.date ?? '').trim()))
    .map((r) => ({
      id: uniqueSlug(slug(r.what), taken),
      title: r.what.trim(),
      date: r.date.trim(),
      memberId: idFromName(r.who ?? '', members),
    }))
}

// ---------------------------------------------------------------------------
// Lists/*.md
// ---------------------------------------------------------------------------

function renderList(list: FamilyList, members: Member[]): string {
  const lines = list.items.map((i) =>
    buildTask(i.done, i.text, { by: members.find((m) => m.id === i.by)?.name.toLowerCase() ?? null })
  )
  const body = [`# ${list.name}`, '', ...lines, ''].join('\n')
  return buildDoc({ fc: 'list', id: list.id }, body)
}

function parseList(src: string, fallbackName: string, members: Member[]): FamilyList {
  const { front, body } = parseDoc(src)
  const heading = /^#\s+(.+)$/m.exec(body)
  const name = (heading?.[1] ?? fallbackName).trim()
  const taken = new Set<string>()
  return {
    id: String(front.id ?? slug(name)),
    name,
    items: parseTasks(body).map((t) => ({
      id: uniqueSlug(slug(t.text), taken),
      text: t.text,
      done: t.done,
      by: (t.by && members.find((m) => m.name.toLowerCase() === t.by)?.id) || '',
    })),
  }
}

// ---------------------------------------------------------------------------
// Chore Log/YYYY-MM-DD.md
// ---------------------------------------------------------------------------

function renderLogDay(d: FamilyData, ds: string): string {
  const dow = dowOf(ds)
  const day = d.done[ds] ?? {}
  const used = new Set<string>()
  const kids = d.members.filter((m) => m.role === 'kid')
  const chunks: string[] = []

  for (const k of d.members) {
    const lines: string[] = []
    const chores = d.chores.filter((c) => c.memberIds.includes(k.id) && c.days.includes(dow))
    for (const c of chores) {
      const key = `${c.id}|${k.id}`
      used.add(key)
      lines.push(buildTask(!!day[key], `${c.title} (+${c.stars}★)`, { ref: c.id }))
    }

    const pfLines: string[] = []
    if (d.preflight.open && dow >= 1 && dow <= 5 && k.role === 'kid') {
      for (const r of preflightRows(kidConfig(d.preflight, k.id), dow)) {
        if (!r.key) {
          pfLines.push(`- _${r.text}_`)
          continue
        }
        const key = `${r.key}|${k.id}`
        if (used.has(key)) continue // "Brush teeth" is the c1 chore — don't list it twice
        used.add(key)
        pfLines.push(buildTask(!!day[key], r.text + (r.badge ? ` **${r.badge}**` : ''), { ref: r.key }))
      }
    }

    // Anything ticked for this member that no current row covers (a chore that
    // was rescheduled, a bring-along that was deleted) still gets written out so
    // the round trip stays lossless.
    const extras = Object.keys(day)
      .filter((key) => key.endsWith(`|${k.id}`) && !used.has(key))
      .map((key) => {
        used.add(key)
        return buildTask(true, key.split('|')[0], { ref: key.split('|')[0] })
      })

    if (!lines.length && !pfLines.length && !extras.length) continue
    chunks.push(
      [
        `## ${k.name}`,
        '',
        ...lines,
        ...(pfLines.length ? ['', '### Pre-flight', '', ...pfLines] : []),
        ...(extras.length ? ['', '### Also done', '', ...extras] : []),
      ].join('\n')
    )
  }

  // Ticked keys whose member is gone entirely.
  const orphans = Object.keys(day).filter((key) => !used.has(key))
  if (orphans.length) {
    chunks.push(
      ['## Unmatched', '', buildTable(['Key', 'Done'], orphans.map((k) => [k, 'yes']))].join('\n')
    )
  }

  const heading = parseDay(ds).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
  const summary = kids.length
    ? kids
        .map((k) => {
          const stars = Object.keys(day)
            .filter((key) => key.endsWith(`|${k.id}`))
            .reduce((sum, key) => sum + (d.chores.find((c) => c.id === key.split('|')[0])?.stars ?? 0), 0)
          return `- ${k.name}: ${stars}★`
        })
        .join('\n')
    : ''

  const body = [`# ${heading}`, '', summary, '', chunks.join('\n\n'), ''].join('\n')
  return buildDoc({ fc: 'chorelog', date: ds }, body)
}

function parseLogDay(src: string, members: Member[]): Record<string, 1> {
  const { body } = parseDoc(src)
  const out: Record<string, 1> = {}
  let memberId: string | null = null

  for (const line of body.split('\n')) {
    const h2 = /^##\s+(?!#)(.*)$/.exec(line)
    if (h2) {
      const name = h2[1].trim()
      memberId = members.find((m) => m.name.toLowerCase() === name.toLowerCase())?.id ?? null
      continue
    }
    const tasks = parseTasks(line)
    if (!tasks.length || !memberId) continue
    const t = tasks[0]
    if (!t.done || !t.ref) continue
    out[`${t.ref}|${memberId}`] = 1
  }

  // The "Unmatched" table carries whole keys rather than per-member refs.
  for (const row of parseTable(section(body, 'Unmatched'))) {
    const key = (row.key ?? '').trim()
    if (key && /^(yes|x|true)$/i.test((row.done ?? '').trim())) out[key] = 1
  }
  return out
}

// ---------------------------------------------------------------------------
// Secrets.md — 1Password references only, never values
// ---------------------------------------------------------------------------

function renderSecrets(d: FamilyData): string {
  const front = {
    fc: 'secrets',
    items: d.secrets.map((s) => ({ id: s.id, label: s.label, ref: s.ref, ...(s.note ? { note: s.note } : {}) })),
  }
  const body = [
    '# Family vault',
    '',
    'Only **references** live here — the values stay in 1Password and are fetched',
    'through the sidecar (`op read`) when someone taps Reveal behind the parent PIN.',
    '',
    buildTable(
      ['What', 'Reference', 'Note'],
      d.secrets.map((s) => [s.label, `\`${s.ref}\``, s.note ?? ''])
    ),
  ].join('\n')
  return buildDoc(front, body)
}

function parseSecrets(src: string): SecretRef[] {
  const { front } = parseDoc(src)
  const items = Array.isArray(front.items) ? (front.items as SecretRef[]) : []
  return items
    .filter((s) => s && s.ref)
    .map((s) => ({
      id: String(s.id ?? slug(String(s.label ?? s.ref))),
      label: String(s.label ?? 'Secret'),
      ref: String(s.ref),
      ...(s.note ? { note: String(s.note) } : {}),
    }))
}

const README = `# Family Council

This folder is written and read by **Carberry Command Center**. It is the app's
durable store — edit a note here and the app picks it up within a second; change
something in the app and it lands back here.

| File | What it holds | Edit it by |
| --- | --- | --- |
| \`Family.md\` | People, colours, weather location, calendar feeds, PIN, pre-flight setup | Note properties (frontmatter) |
| \`Events.md\` | The calendar | Table rows — leave **ID** blank for new events |
| \`Chores.md\` | Chores, reward shop, redemption history | Table rows — keep the **ID** column |
| \`Meals.md\` | Dinner plan and family favourites | Table rows |
| \`Countdowns.md\` | Countdowns | Table rows |
| \`Lists/\` | One note per list | Normal \`- [ ]\` checkboxes; \`#by/name\` tags who added it |
| \`Chore Log/\` | One note per day of ticked chores and pre-flight | Checkboxes — keep the \`^id\` block refs |
| \`Secrets.md\` | 1Password *references* (never values) | Note properties |

Two things to leave alone: the \`^id\` block references in the chore log and the
\`ID\` columns. They're how a renamed chore keeps its history.
`

// ---------------------------------------------------------------------------
// Read / write
// ---------------------------------------------------------------------------

/** Paths this process has just written, so the watcher can ignore its own echo. */
const selfWrites = new Map<string, number>()
export const wasSelfWrite = (path: string) => {
  const at = selfWrites.get(path)
  return at !== undefined && Date.now() - at < 2500
}

async function put(path: string, contents: string) {
  const existing = await readIf(path)
  if (existing === contents) return // don't churn mtimes for no reason
  selfWrites.set(path, Date.now())
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, contents, 'utf8')
}

export async function write(d: FamilyData): Promise<void> {
  await mkdir(p(LISTS_DIR), { recursive: true })
  await mkdir(p(LOG_DIR), { recursive: true })

  await put(p(FILES.readme), README)
  await put(p(FILES.family), renderFamily(d))
  await put(p(FILES.events), renderEvents(d))
  await put(p(FILES.chores), renderChores(d))
  await put(p(FILES.meals), renderMeals(d))
  await put(p(FILES.countdowns), renderCountdowns(d))
  await put(p(FILES.secrets), renderSecrets(d))

  // Lists: one file each, and delete files for lists that were removed.
  const wantList = new Map(d.lists.map((l) => [`${l.name}.md`, l]))
  for (const [file, list] of wantList) await put(p(LISTS_DIR, file), renderList(list, d.members))
  for (const file of await readdir(p(LISTS_DIR)).catch(() => [] as string[])) {
    if (file.endsWith('.md') && !wantList.has(file)) {
      selfWrites.set(p(LISTS_DIR, file), Date.now())
      await rm(p(LISTS_DIR, file), { force: true })
    }
  }

  // Chore log: a note per day that has anything ticked.
  const wantLog = new Set<string>()
  for (const ds of Object.keys(d.done)) {
    if (!Object.keys(d.done[ds] ?? {}).length) continue
    wantLog.add(`${ds}.md`)
    await put(p(LOG_DIR, `${ds}.md`), renderLogDay(d, ds))
  }
  for (const file of await readdir(p(LOG_DIR)).catch(() => [] as string[])) {
    if (file.endsWith('.md') && !wantLog.has(file)) {
      selfWrites.set(p(LOG_DIR, file), Date.now())
      await rm(p(LOG_DIR, file), { force: true })
    }
  }
}

/** Rebuilds FamilyData from the vault. Returns null if the folder isn't set up yet. */
export async function read(): Promise<FamilyData | null> {
  if (!existsSync(p(FILES.family))) return null
  const familySrc = await readIf(p(FILES.family))
  const fam = familySrc ? parseFamily(familySrc) : null
  if (!fam) return null

  const members = fam.members
  const [eventsSrc, choresSrc, mealsSrc, cdSrc, secretsSrc] = await Promise.all([
    readIf(p(FILES.events)),
    readIf(p(FILES.chores)),
    readIf(p(FILES.meals)),
    readIf(p(FILES.countdowns)),
    readIf(p(FILES.secrets)),
  ])

  const choreDoc = choresSrc
    ? parseChores(choresSrc, members)
    : { chores: [], rewards: [], redemptions: [] }
  const mealDoc = mealsSrc ? parseMeals(mealsSrc) : { mealPlan: {}, favorites: [] }

  const lists: FamilyList[] = []
  for (const file of (await readdir(p(LISTS_DIR)).catch(() => [] as string[])).sort()) {
    if (!file.endsWith('.md')) continue
    const src = await readIf(p(LISTS_DIR, file))
    if (src) lists.push(parseList(src, file.replace(/\.md$/, ''), members))
  }

  const done: FamilyData['done'] = {}
  for (const file of (await readdir(p(LOG_DIR)).catch(() => [] as string[])).sort()) {
    if (!/^\d{4}-\d{2}-\d{2}\.md$/.test(file)) continue
    const src = await readIf(p(LOG_DIR, file))
    if (!src) continue
    const day = parseLogDay(src, members)
    if (Object.keys(day).length) done[file.replace(/\.md$/, '')] = day
  }

  return migrate({
    members,
    settings: fam.settings,
    preflight: fam.preflight,
    fit: fam.fit,
    gl: fam.gl,
    events: eventsSrc ? parseEvents(eventsSrc, members) : [],
    chores: choreDoc.chores,
    rewards: choreDoc.rewards,
    redemptions: choreDoc.redemptions,
    mealPlan: mealDoc.mealPlan,
    favorites: mealDoc.favorites,
    countdowns: cdSrc ? parseCountdowns(cdSrc, members) : [],
    lists,
    done,
    secrets: secretsSrc ? parseSecrets(secretsSrc) : [],
    feedEv: {},
  })
}
