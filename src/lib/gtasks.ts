import type { ListItem } from '../types.ts'

/**
 * The reconciliation between a Google Tasks list and one of the family's lists.
 *
 * Deliberately pure and free of any HTTP: the network part of a sync is the
 * easy part to get right and the hard part to test, so everything that decides
 * *what* to do lives here and scripts/sync-tasks.ts only carries it out.
 * scripts/gtasks-test.ts exercises it with no credentials and no network.
 *
 * The direction of authority, which is what makes this tractable without a
 * conflict-resolution layer:
 *
 *   - Google holds the canonical list. What is on it is what the family sees.
 *   - An item added in the app is pushed up, and Google owns it from then on.
 *   - Ticking something off in the app is pushed up, then the item leaves the
 *     app list — a bought item is not a state to reconcile, it is gone.
 *
 * Every operation therefore has exactly one authoritative direction, so there
 * is never a question of which side won. The cost is stated in
 * DELETION_IS_NOT_SYNCED below.
 */

/** One task as the Google Tasks API returns it. Only the fields we use. */
export interface GoogleTask {
  id: string
  title?: string
  status?: 'needsAction' | 'completed'
  notes?: string
  updated?: string
  deleted?: boolean
  hidden?: boolean
}

/**
 * Deleting an item in the app does not delete the task in Google.
 *
 * Telling "the family deleted this" from "this was never here" needs a
 * tombstone — a record of a row that used to exist. There is nowhere to keep
 * one: the app removes the row outright, and the next sync sees only its
 * absence, which is indistinguishable from a task Google has that we have not
 * pulled yet. Treating absence as deletion would mean a device that is briefly
 * behind wipes the family's shopping list.
 *
 * So: to remove something, tick it off. That is pushed up and is unambiguous.
 */
export const DELETION_IS_NOT_SYNCED = true

export interface SyncPlan {
  /** Tasks on Google with no counterpart here — add them to the list. */
  insert: { title: string; remoteId: string }[]
  /** Item ids to drop: their task is completed or gone upstream. */
  remove: string[]
  /** Items typed in the app that Google has never seen. */
  create: { itemId: string; title: string }[]
  /** Items ticked off here whose task must be completed upstream. */
  complete: { itemId: string; remoteId: string }[]
  /** A linked item whose title drifted from its task's. Google wins. */
  rename: { itemId: string; title: string }[]
  /**
   * The same thing typed on both sides. Link them rather than creating either
   * — this is what stops the first sync from duplicating a list the family had
   * already written out by hand.
   */
  link: { itemId: string; remoteId: string }[]
}

export function emptyPlan(): SyncPlan {
  return { insert: [], remove: [], create: [], complete: [], rename: [], link: [] }
}

export function planIsEmpty(p: SyncPlan): boolean {
  return (
    !p.insert.length && !p.remove.length && !p.create.length &&
    !p.complete.length && !p.rename.length && !p.link.length
  )
}

export function describePlan(p: SyncPlan): string {
  const parts: string[] = []
  if (p.insert.length) parts.push(`${p.insert.length} to add here`)
  if (p.link.length) parts.push(`${p.link.length} already on both sides`)
  if (p.rename.length) parts.push(`${p.rename.length} renamed upstream`)
  if (p.remove.length) parts.push(`${p.remove.length} bought or removed`)
  if (p.create.length) parts.push(`${p.create.length} to push up`)
  if (p.complete.length) parts.push(`${p.complete.length} to tick off up there`)
  return parts.length ? parts.join(', ') : 'already in step'
}

const clean = (s: string | undefined | null) => (s ?? '').trim()
const key = (s: string | undefined | null) => clean(s).toLowerCase()

/**
 * Works out what to do, given the list as the app holds it and the *incomplete*
 * tasks Google returned.
 *
 * `tasks` must be the incomplete set: a task ticked off in Google is absent
 * from it, and that absence is what tells us the item was bought. The caller
 * passes showCompleted=false; this trusts that, but also drops anything
 * explicitly flagged completed or deleted in case it does not.
 */
export function planSync(items: ListItem[], tasks: GoogleTask[]): SyncPlan {
  const plan = emptyPlan()

  const live = tasks.filter(
    (t) => t.id && !t.deleted && t.status !== 'completed' && clean(t.title) !== ''
  )
  const byRemote = new Map(live.map((t) => [t.id, t]))
  const byTitle = new Map<string, GoogleTask>()
  for (const t of live) {
    const k = key(t.title)
    if (!byTitle.has(k)) byTitle.set(k, t)
  }

  /** Tasks already accounted for, so two app items cannot claim the same one. */
  const claimed = new Set<string>()

  // Linked items first: they have the strongest claim on a task, and settling
  // them before the title matching below stops an unlinked duplicate from
  // stealing a task that already belongs to something.
  for (const item of items) {
    if (!item.rid) continue
    const task = byRemote.get(item.rid)

    if (item.done) {
      if (task) {
        plan.complete.push({ itemId: item.id, remoteId: item.rid })
        claimed.add(task.id)
      }
      plan.remove.push(item.id)
      continue
    }

    if (!task) {
      // Its task is completed or gone upstream, so it has been bought.
      plan.remove.push(item.id)
      continue
    }

    claimed.add(task.id)
    const title = clean(task.title)
    if (title !== clean(item.text)) plan.rename.push({ itemId: item.id, title })
  }

  for (const item of items) {
    if (item.rid) continue
    if (item.done) continue // ticked off before it was ever pushed; nothing to do
    if (!clean(item.text)) continue

    const match = byTitle.get(key(item.text))
    if (match && !claimed.has(match.id)) {
      claimed.add(match.id)
      plan.link.push({ itemId: item.id, remoteId: match.id })
      continue
    }

    plan.create.push({ itemId: item.id, title: clean(item.text) })
  }

  for (const task of live) {
    if (claimed.has(task.id)) continue
    plan.insert.push({ title: clean(task.title), remoteId: task.id })
  }

  return plan
}

/**
 * Applies a plan to the items in memory, returning the list as it should look
 * once the sync has run. sync-tasks.ts uses this to build the FamilyData it
 * hands to cloudSync.pushChanges, so the same diffing path the app uses does
 * the writing — no bespoke SQL for list items.
 *
 * `created` maps an item id to the task id Google minted for it, so items
 * pushed up this run come back linked.
 */
export function applyPlan(
  items: ListItem[],
  plan: SyncPlan,
  created: Map<string, string> = new Map(),
  by = ''
): ListItem[] {
  const removed = new Set(plan.remove)
  const renames = new Map(plan.rename.map((r) => [r.itemId, r.title]))
  const links = new Map(plan.link.map((l) => [l.itemId, l.remoteId]))

  const out: ListItem[] = []

  for (const item of items) {
    if (removed.has(item.id)) continue
    const next: ListItem = { ...item }
    const title = renames.get(item.id)
    if (title != null) next.text = title
    const rid = links.get(item.id) ?? created.get(item.id)
    if (rid) next.rid = rid
    out.push(next)
  }

  for (const add of plan.insert) {
    out.push({
      // Derived from the task id, so re-running produces the same row and no
      // device sees a spurious change.
      id: `gt:${add.remoteId}`,
      text: add.title,
      done: false,
      by,
      src: 'gtasks',
      rid: add.remoteId,
    })
  }

  return out
}
