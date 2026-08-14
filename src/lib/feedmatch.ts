/**
 * Picking one feed out of a household's list from a name typed by a human.
 *
 * This exists to serve `scripts/delete-feed.ts`, which is destructive and runs
 * unattended on a runner. The matching is the part that can be quietly wrong —
 * "Family" matching both "Family" and "Family (school)" would delete the wrong
 * calendar and take its events with it — so it lives here, pure and tested,
 * rather than inline in a script that can only be exercised against the live
 * database.
 *
 * The rule is deliberately strict: a delete happens only when the query
 * identifies exactly one feed. Anything else is reported and refused.
 */

export interface MatchableFeed {
  id: string
  name: string
}

export type FeedMatch<T extends MatchableFeed> =
  | { ok: true; feed: T; how: 'id' | 'name' | 'substring' }
  | { ok: false; reason: 'empty-query' | 'no-match' | 'ambiguous'; candidates: T[] }

const norm = (s: string) => s.trim().toLowerCase()

/**
 * Resolve `query` against `feeds`, in order of how sure we can be:
 *
 *   1. an exact id — unambiguous by definition, ids are the primary key
 *   2. an exact (case-insensitive) name
 *   3. a case-insensitive substring of a name, but only if it hits one feed
 *
 * Ties at a stronger tier are not broken by a weaker one. Two feeds sharing a
 * name is ambiguous even if only one of them also contains the query as a
 * substring — that would be picking by coincidence.
 */
export function resolveFeed<T extends MatchableFeed>(feeds: T[], query: string): FeedMatch<T> {
  const q = norm(query)
  if (!q) return { ok: false, reason: 'empty-query', candidates: [] }

  const byId = feeds.filter((f) => norm(f.id) === q)
  if (byId.length === 1) return { ok: true, feed: byId[0], how: 'id' }
  if (byId.length > 1) return { ok: false, reason: 'ambiguous', candidates: byId }

  const byName = feeds.filter((f) => norm(f.name) === q)
  if (byName.length === 1) return { ok: true, feed: byName[0], how: 'name' }
  if (byName.length > 1) return { ok: false, reason: 'ambiguous', candidates: byName }

  const bySub = feeds.filter((f) => norm(f.name).includes(q))
  if (bySub.length === 1) return { ok: true, feed: bySub[0], how: 'substring' }
  if (bySub.length > 1) return { ok: false, reason: 'ambiguous', candidates: bySub }

  return { ok: false, reason: 'no-match', candidates: [] }
}
