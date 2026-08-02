/**
 * Exercises src/lib/gtasks.ts. No credentials, no network, no database — the
 * whole point of keeping the reconciliation pure is that the part which decides
 * what to do can be tested before anyone has an OAuth client.
 *
 * What it guards against, worst first:
 *
 *   - the first sync duplicating a list that already exists on both sides
 *   - a bought item coming back on the next run
 *   - two app items claiming the same task, or one task claiming two items
 *   - re-running with nothing changed producing work
 *   - an item leaving the app list before its completion reached Google
 *
 *   npx tsx scripts/gtasks-test.ts
 */

import type { ListItem } from '../src/types.ts'
import {
  applyPlan,
  describePlan,
  planIsEmpty,
  planSync,
  type GoogleTask,
  type SyncPlan,
} from '../src/lib/gtasks.ts'

let checks = 0
let failures = 0

function check(name: string, cond: boolean, detail = '') {
  checks++
  if (cond) console.log(`  ok   ${name}`)
  else {
    failures++
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`)
  }
}
const section = (n: string) => console.log(`\n${n}`)

const item = (p: Partial<ListItem> & { id: string; text: string }): ListItem => ({
  done: false,
  by: 'e',
  ...p,
})
const task = (id: string, title: string, extra: Partial<GoogleTask> = {}): GoogleTask => ({
  id,
  title,
  status: 'needsAction',
  ...extra,
})

/** Everything the sync would do, rolled forward into the resulting list. */
const runSync = (items: ListItem[], tasks: GoogleTask[], newIds: string[] = []) => {
  const plan = planSync(items, tasks)
  const created = new Map<string, string>()
  plan.create.forEach((c, i) => created.set(c.itemId, newIds[i] ?? `new_${i}`))
  return { plan, after: applyPlan(items, plan, created, 'e') }
}

// ---------------------------------------------------------------------------

section('an empty app list pulls Google down')
{
  const { plan, after } = runSync([], [task('t1', 'Milk'), task('t2', 'Eggs')])
  check('two inserts', plan.insert.length === 2)
  check('nothing to push up', plan.create.length === 0)
  check('both items land', after.length === 2)
  check('tagged as gtasks', after.every((i) => i.src === 'gtasks'))
  check('linked to their tasks', after.map((i) => i.rid).join() === 't1,t2')
  check('ids derived from the task id', after[0].id === 'gt:t1')
}

section('an empty Google list gets the app pushed up')
{
  const { plan, after } = runSync([item({ id: 'a1', text: 'Bread' })], [], ['t9'])
  check('one create', plan.create.length === 1 && plan.create[0].title === 'Bread')
  check('nothing removed', plan.remove.length === 0)
  check('the item stays', after.length === 1)
  check('and comes back linked', after[0].rid === 't9', String(after[0].rid))
}

section('the first sync does not duplicate a list typed on both sides')
{
  // The case that would be most visible and most annoying: the family has
  // written the list into the app, and the same list exists in Google Tasks.
  const items = [
    item({ id: 'a1', text: 'Milk' }),
    item({ id: 'a2', text: 'eggs' }), // different case on purpose
    item({ id: 'a3', text: 'Bread' }),
  ]
  const tasks = [task('t1', 'Milk'), task('t2', 'Eggs'), task('t4', 'Butter')]
  const { plan, after } = runSync(items, tasks, ['t5'])

  check('Milk and Eggs are linked, not recreated', plan.link.length === 2,
    `link=${plan.link.length} create=${plan.create.length}`)
  check('matching is case-insensitive', plan.link.some((l) => l.itemId === 'a2'))
  check('only Bread is pushed up', plan.create.length === 1 && plan.create[0].title === 'Bread')
  check('only Butter is pulled down', plan.insert.length === 1 && plan.insert[0].title === 'Butter')
  check('the list totals 4, not 7', after.length === 4, `got ${after.length}`)
  const texts = after.map((i) => i.text.toLowerCase()).sort()
  check('no text appears twice', new Set(texts).size === texts.length, texts.join())
}

section('idempotence — the second run does nothing')
{
  const items = [item({ id: 'a1', text: 'Milk' }), item({ id: 'a2', text: 'Bread' })]
  const tasks = [task('t1', 'Milk'), task('t2', 'Butter')]
  const first = runSync(items, tasks, ['t3'])

  // Google now holds what the first run pushed up.
  const tasksAfter = [...tasks, task('t3', 'Bread')]
  const second = runSync(first.after, tasksAfter)

  check('the second plan is empty', planIsEmpty(second.plan), describePlan(second.plan))
  check('the list is unchanged', second.after.length === first.after.length)
  check('ids are unchanged',
    second.after.map((i) => i.id).join() === first.after.map((i) => i.id).join())

  const third = runSync(second.after, tasksAfter)
  check('and a third run too', planIsEmpty(third.plan), describePlan(third.plan))
}

section('a task ticked off in Google leaves the app list')
{
  const items = [
    item({ id: 'gt:t1', text: 'Milk', rid: 't1', src: 'gtasks' }),
    item({ id: 'gt:t2', text: 'Eggs', rid: 't2', src: 'gtasks' }),
  ]
  // Milk is gone from the incomplete set — someone bought it.
  const { plan, after } = runSync(items, [task('t2', 'Eggs')])
  check('one removal', plan.remove.length === 1 && plan.remove[0] === 'gt:t1')
  check('nothing is re-added', plan.insert.length === 0)
  check('Eggs survives', after.length === 1 && after[0].text === 'Eggs')
}

section('an item ticked off in the app is pushed up before it goes')
{
  const items = [item({ id: 'gt:t1', text: 'Milk', rid: 't1', src: 'gtasks', done: true })]
  const { plan, after } = runSync(items, [task('t1', 'Milk')])
  check('completion is pushed up', plan.complete.length === 1 && plan.complete[0].remoteId === 't1')
  check('and only then removed here', plan.remove.includes('gt:t1'))
  check('the list is empty afterwards', after.length === 0)
}

section('a rename in Google reaches the app')
{
  const items = [item({ id: 'gt:t1', text: 'Milk', rid: 't1', src: 'gtasks' })]
  const { plan, after } = runSync(items, [task('t1', 'Oat milk')])
  check('one rename', plan.rename.length === 1 && plan.rename[0].title === 'Oat milk')
  check('no insert or remove', plan.insert.length === 0 && plan.remove.length === 0)
  check('the text is updated in place', after.length === 1 && after[0].text === 'Oat milk')
  check('and the id is unchanged', after[0].id === 'gt:t1')
}

section('one task cannot be claimed twice')
{
  // Two app items with the same text, one task. The second must not adopt it.
  const items = [item({ id: 'a1', text: 'Milk' }), item({ id: 'a2', text: 'Milk' })]
  const { plan, after } = runSync(items, [task('t1', 'Milk')], ['t2'])
  check('exactly one link', plan.link.length === 1, `${plan.link.length}`)
  check('the other is pushed up as new', plan.create.length === 1)
  const rids = after.map((i) => i.rid)
  check('the two items end up on different tasks', rids[0] !== rids[1], rids.join())
  check('neither is left unlinked', rids.every(Boolean), rids.join())
}

section('a linked item outranks an unlinked one with the same text')
{
  const items = [
    item({ id: 'a1', text: 'Milk' }), // unlinked, listed first
    item({ id: 'gt:t1', text: 'Milk', rid: 't1', src: 'gtasks' }),
  ]
  const { plan } = runSync(items, [task('t1', 'Milk')], ['t7'])
  check('the unlinked one does not steal the task', plan.link.length === 0,
    JSON.stringify(plan.link))
  check('it is pushed up as its own task instead', plan.create.length === 1)
}

section('rubbish in the payload is ignored')
{
  const items = [item({ id: 'a1', text: '   ' })]
  const tasks = [
    task('t1', ''),
    task('t2', 'Milk', { deleted: true }),
    task('t3', 'Eggs', { status: 'completed' }),
    task('t4', 'Bread'),
  ]
  const { plan, after } = runSync(items, tasks)
  check('a blank app item is not pushed up', plan.create.length === 0)
  check('blank, deleted and completed tasks are skipped',
    plan.insert.length === 1 && plan.insert[0].title === 'Bread',
    JSON.stringify(plan.insert))
  check('only the real task lands', after.filter((i) => i.src === 'gtasks').length === 1)
}

section('an item ticked off before it ever reached Google')
{
  const items = [item({ id: 'a1', text: 'Milk', done: true })]
  const { plan } = runSync(items, [])
  check('it is not pushed up', plan.create.length === 0)
  check('and nothing is completed upstream', plan.complete.length === 0)
}

section('a linked item whose task vanished while ticked off here')
{
  // Both sides removed it. It must not be pushed and must not linger.
  const items = [item({ id: 'gt:t1', text: 'Milk', rid: 't1', src: 'gtasks', done: true })]
  const { plan, after } = runSync(items, [])
  check('nothing is sent upstream', plan.complete.length === 0)
  check('the row still goes', plan.remove.includes('gt:t1'))
  check('the list is empty', after.length === 0)
}

section('app-typed items are never silently dropped')
{
  const items = [
    item({ id: 'a1', text: 'Birthday candles' }),
    item({ id: 'gt:t1', text: 'Milk', rid: 't1', src: 'gtasks' }),
  ]
  const { after } = runSync(items, [task('t1', 'Milk')], ['t8'])
  const candles = after.find((i) => i.id === 'a1')
  check('the app item survives', !!candles)
  check('and keeps its id', candles?.id === 'a1')
  check('it is not retagged as gtasks', candles?.src === undefined, String(candles?.src))
}

console.log(`\n${checks - failures}/${checks} checks passed`)
if (failures) {
  console.log(`${failures} FAILED`)
  process.exit(1)
}

// Referenced so the plan shape stays exported and typechecked here too.
export type { SyncPlan }
