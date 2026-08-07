import type { FamilyEvent } from '../types.ts'

/**
 * Upcoming rocket launches, from the Launch Library 2 API.
 *
 * Modelled as a *feed* rather than a new table: a feed row whose url is
 * `spacedevs://launches` is recognised by scripts/sync-feeds.ts, which calls
 * this instead of fetching an ICS. Everything downstream then comes free —
 * member tagging (so it lands on Hadley's page and not her brothers'), the
 * calendar merge, the read-only badge, the Echo display, and the status line in
 * Settings. A new table would have needed all of that rebuilt.
 *
 * The mapping is pure and exported so it can be tested against a recorded
 * response with no network, which matters here: the API is unreachable from
 * the development sandbox and only the scheduled job can actually call it.
 */

export const LAUNCHES_URL_SCHEME = 'spacedevs:'

/**
 * Fields we read from LL2's `/launch/upcoming/` response. The API returns far
 * more; this is deliberately the minimum, so an unrelated change upstream
 * cannot break the parse.
 */
export interface LaunchRecord {
  id?: string
  name?: string
  /** ISO 8601 target launch time, "No Earlier Than". */
  net?: string
  /** How firm `net` is: 1 Go, 2 TBD, 3 Success, 8 TBC… */
  status?: { id?: number; abbrev?: string; name?: string }
  launch_service_provider?: { name?: string }
  mission?: { name?: string; description?: string }
  pad?: { name?: string; location?: { name?: string } }
  /** Only present once a window is known. */
  window_start?: string
  window_end?: string
}

export interface LaunchesResponse {
  count?: number
  results?: LaunchRecord[]
}

/** Status ids LL2 uses for a launch that has already flown or been scrubbed. */
const PAST_OR_GONE = new Set([3, 4, 7])

const clean = (s: string | undefined | null) => (s ?? '').trim()

/**
 * "Falcon 9 Block 5 | Starlink Group 10-5" → "Starlink Group 10-5".
 *
 * LL2 names are `<rocket> | <mission>`. On a family dashboard the mission is
 * the interesting half and the rocket variant is noise, but the rocket is worth
 * keeping when there is no mission name to fall back on.
 */
export function launchTitle(rec: LaunchRecord): string {
  const name = clean(rec.name)
  const mission = clean(rec.mission?.name)
  if (mission) return mission
  const cut = name.indexOf('|')
  return cut > 0 ? name.slice(cut + 1).trim() : name
}

/** "Cape Canaveral SFS, FL, USA" → "Cape Canaveral SFS" — the state and country are noise. */
export function launchPlace(rec: LaunchRecord): string {
  const loc = clean(rec.pad?.location?.name)
  if (!loc) return clean(rec.pad?.name)
  return loc.split(',')[0].trim()
}

/**
 * LL2 records → the app's events, in local time.
 *
 * `net` is UTC with a trailing Z. Deriving the date from the *local* rendering
 * rather than slicing the ISO string is the point: a 01:30 UTC launch is the
 * previous evening in Virginia, and slicing would file it on the wrong day —
 * the same bug that had Picture Day four hours out in the ICS parser.
 */
export function launchesToEvents(
  res: LaunchesResponse,
  opts: { limit?: number; tz?: string } = {}
): FamilyEvent[] {
  const limit = opts.limit ?? 12
  const out: FamilyEvent[] = []

  for (const rec of res.results ?? []) {
    if (out.length >= limit) break
    const net = clean(rec.net)
    if (!net) continue
    const when = new Date(net)
    if (Number.isNaN(when.getTime())) continue
    if (rec.status?.id != null && PAST_OR_GONE.has(rec.status.id)) continue

    const local = localParts(when, opts.tz)
    const provider = clean(rec.launch_service_provider?.name)
    const place = launchPlace(rec)
    // TBD/TBC launches have a date that is a guess. Saying so is better than
    // a child watching the clock for a launch that was never really scheduled.
    const firm = rec.status?.id === 1
    const title = `🚀 ${launchTitle(rec)}${firm ? '' : ' (TBD)'}`

    out.push({
      // Derived from the LL2 id, so a re-sync produces identical rows and no
      // device sees a spurious change.
      id: `ll2:${clean(rec.id) || net}`,
      title,
      date: local.date,
      start: local.time,
      dur: null,
      memberIds: [],
      loc: [provider, place].filter(Boolean).join(' · '),
      recur: null,
    })
  }

  return out
}

/** The launch time as the family's wall clock sees it. */
function localParts(when: Date, tz = 'America/New_York'): { date: string; time: string } {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  const parts: Record<string, string> = {}
  for (const p of fmt.formatToParts(when)) if (p.type !== 'literal') parts[p.type] = p.value
  // en-CA renders midnight as "24" in some engines; normalise it.
  const hour = parts.hour === '24' ? '00' : parts.hour
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${hour}:${parts.minute}`,
  }
}

/**
 * The API call for a `spacedevs://launches` feed.
 *
 * `limit` is capped: LL2 rate-limits unauthenticated callers to a handful of
 * requests an hour, and a family calendar has no use for the 200th launch.
 */
export function launchesApiUrl(feedUrl: string): string {
  let limit = 12
  try {
    const parsed = new URL(feedUrl)
    const asked = Number(parsed.searchParams.get('limit'))
    if (Number.isFinite(asked) && asked > 0) limit = Math.min(asked, 30)
  } catch {
    /* the default is fine */
  }
  return `https://ll.thespacedevs.com/2.2.0/launch/upcoming/?limit=${limit}&mode=list&hide_recent_previous=true`
}

export const isLaunchFeed = (url: string) =>
  clean(url).toLowerCase().startsWith(LAUNCHES_URL_SCHEME)
