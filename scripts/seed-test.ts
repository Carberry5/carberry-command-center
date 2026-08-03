/**
 * Exercises the merge rules in scripts/seed-household.ts. No database and no
 * network: mergeSeed is a pure function of (live household, seed, mode), which
 * is the whole reason it was written as one.
 *
 * What it is guarding against, in order of how badly each would go wrong:
 *
 *   - running twice inserting a second copy of everything, because the seed
 *     mints a fresh uid() for countdowns and favourites on every call
 *   - a preset id ('c', 'c5') landing on top of a different entity that already
 *     holds that id
 *   - seed member ids leaking into a household whose members have other ids,
 *     leaving chores assigned to nobody
 *   - add-missing quietly modifying something
 *   - the family's chore history, meal plan or Greenlight balances being
 *     replaced with demo values
 *
 *   npx tsx scripts/seed-test.ts
 */

import type { FamilyData } from '../src/types.ts'
import { seed } from '../src/data/seed.ts'
import { mergeSeed } from './seed-household.ts'

let checks = 0
let failures = 0

function check(name: string, cond: boolean, detail = '') {
  checks++
  if (cond) {
    console.log(`  ok   ${name}`)
  } else {
    failures++
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

function section(name: string) {
  console.log(`\n${name}`)
}

/** An empty household, as loadSnapshot returns one. */
function emptyHousehold(): FamilyData {
  return {
    members: [], events: [], chores: [], done: {}, rewards: [], redemptions: [],
    favorites: [], mealPlan: {}, lists: [], countdowns: [],
    settings: { pin: '1234', zip: '', lat: 0, lon: 0, place: '', feeds: [] },
    feedEv: {}, preflight: { open: true, depart: '07:30', kids: {} },
    fit: {}, gl: {}, secrets: [],
    savings: { staples: [], deals: [], status: {}, plan: null },
  }
}

// ---------------------------------------------------------------------------

section('empty household')
{
  const fresh = seed()
  const { merged } = mergeSeed(emptyHousehold(), fresh, 'add-missing')
  check('every member arrives', merged.members.length === fresh.members.length)
  check('every chore arrives', merged.chores.length === fresh.chores.length)
  check('every countdown arrives', merged.countdowns.length === fresh.countdowns.length)
  check('every meal favourite arrives', merged.favorites.length === fresh.favorites.length)
  check('chore history is NOT seeded', Object.keys(merged.done).length === 0,
    `${Object.keys(merged.done).length} day(s) of demo history leaked in`)
  check('redemptions are NOT seeded', merged.redemptions.length === 0)
  check('meal plan is NOT seeded', Object.keys(merged.mealPlan).length === 0)
  check('wearable stats are NOT seeded', Object.keys(merged.fit).length === 0)
  check('Greenlight is NOT seeded', Object.keys(merged.gl).length === 0)
  check('blank location is filled in', merged.settings.place === fresh.settings.place)
}

section('idempotence — the property that matters most')
{
  const fresh = seed()
  const once = mergeSeed(emptyHousehold(), fresh, 'add-missing').merged
  // A second seed() call: same content, entirely different uid()s.
  const twice = mergeSeed(once, seed(), 'add-missing').merged
  check('members do not double', twice.members.length === once.members.length,
    `${once.members.length} -> ${twice.members.length}`)
  check('chores do not double', twice.chores.length === once.chores.length,
    `${once.chores.length} -> ${twice.chores.length}`)
  check('countdowns do not double', twice.countdowns.length === once.countdowns.length,
    `${once.countdowns.length} -> ${twice.countdowns.length}`)
  check('favourites do not double', twice.favorites.length === once.favorites.length,
    `${once.favorites.length} -> ${twice.favorites.length}`)
  check('events do not double', twice.events.length === once.events.length,
    `${once.events.length} -> ${twice.events.length}`)
  check('lists do not double', twice.lists.length === once.lists.length)
  check('list items do not double',
    twice.lists[0]?.items.length === once.lists[0]?.items.length,
    `${once.lists[0]?.items.length} -> ${twice.lists[0]?.items.length}`)
  check('feeds do not double', twice.settings.feeds.length === once.settings.feeds.length)
}

section('add-missing never modifies')
{
  const live = emptyHousehold()
  live.members = [{ id: 'x1', name: 'Rowan', role: 'kid', age: 9, color: '#000000', links: [] }]
  live.countdowns = [{ id: 'k1', title: 'First day of school', date: '2001-01-01', memberId: null }]
  const { merged } = mergeSeed(live, seed(), 'add-missing')
  const rowan = merged.members.find((m) => m.name === 'Rowan')!
  check('a matched member keeps its wrong age', rowan.age === 9, `age became ${rowan.age}`)
  check('a matched member keeps its id', rowan.id === 'x1')
  const school = merged.countdowns.find((c) => c.title === 'First day of school')!
  check('a matched countdown keeps its stale date', school.date === '2001-01-01')
  check('only one Rowan', merged.members.filter((m) => m.name === 'Rowan').length === 1)
}

section('refresh carries corrections onto matched rows')
{
  const live = emptyHousehold()
  live.members = [{ id: 'x1', name: 'Rowan', role: 'kid', age: 9, color: '#000000', links: [] }]
  live.countdowns = [{ id: 'k1', title: 'First day of school', date: '2001-01-01', memberId: null }]
  const fresh = seed()
  const { merged } = mergeSeed(live, fresh, 'refresh')
  const rowan = merged.members.find((m) => m.name === 'Rowan')!
  check('age is corrected', rowan.age === 4, `age is ${rowan.age}`)
  check('the member id is still theirs', rowan.id === 'x1')
  const school = merged.countdowns.find((c) => c.title === 'First day of school')!
  check('the date is corrected', school.date === fresh.countdowns.find((c) => c.title === 'First day of school')!.date,
    `date is ${school.date}`)
  check('the countdown id is still theirs', school.id === 'k1')
}

section('member ids are remapped, not assumed')
{
  const live = emptyHousehold()
  // A household whose members carry uuids, as they would if added in the app.
  live.members = [
    { id: 'u-cannon', name: 'Cannon', role: 'kid', age: 9, color: '#3D6DE8', links: [] },
    { id: 'u-hadley', name: 'Hadley', role: 'kid', age: 7, color: '#8B5CF6', links: [] },
    { id: 'u-rowan', name: 'Rowan', role: 'kid', age: 4, color: '#31A05F', links: [] },
  ]
  const { merged } = mergeSeed(live, seed(), 'add-missing')
  const liveIds = new Set(merged.members.map((m) => m.id))

  const dogs = merged.chores.find((c) => c.title === 'Feed the dogs')!
  check('a new chore reaches the household ids',
    dogs.memberIds.every((id) => liveIds.has(id)) && dogs.memberIds.length === 3,
    JSON.stringify(dogs.memberIds))
  check('and not the seed presets', !dogs.memberIds.some((id) => ['c', 'h', 'r'].includes(id)))

  const bday = merged.countdowns.find((c) => c.title.startsWith("Rowan's birthday"))!
  check("a countdown's member is remapped", bday.memberId === 'u-rowan', String(bday.memberId))

  const preflightKeys = Object.keys(merged.preflight.kids)
  check('pre-flight is keyed by household ids',
    preflightKeys.length > 0 && preflightKeys.every((k) => liveIds.has(k)),
    JSON.stringify(preflightKeys))

  const orphan = merged.chores.flatMap((c) => c.memberIds).filter((id) => !liveIds.has(id))
  check('no chore references a member that does not exist', orphan.length === 0, JSON.stringify(orphan))
}

section('preset id collisions do not overwrite')
{
  const live = emptyHousehold()
  live.members = [{ id: 'c', name: 'Cricket', role: 'kid', age: 6, color: '#111111', links: [] }]
  // 'c5' is the seed's id for "Clean your room".
  live.chores = [{ id: 'c5', title: 'Water the plants', memberIds: ['c'], days: [1], stars: 1 }]
  const { merged } = mergeSeed(live, seed(), 'add-missing')

  check('Cricket keeps id "c"', merged.members.find((m) => m.id === 'c')?.name === 'Cricket')
  check('Cannon got a different id', merged.members.find((m) => m.name === 'Cannon')!.id !== 'c')
  const c5 = merged.chores.filter((c) => c.id === 'c5')
  check('id c5 is still one chore', c5.length === 1, `${c5.length} chores hold id c5`)
  check('and still "Water the plants"', c5[0]?.title === 'Water the plants', c5[0]?.title)
  check('"Clean your room" arrived under another id',
    merged.chores.some((c) => c.title === 'Clean your room' && c.id !== 'c5'))

  const ids = merged.chores.map((c) => c.id)
  check('no duplicate chore ids at all', new Set(ids).size === ids.length)
  const mids = merged.members.map((m) => m.id)
  check('no duplicate member ids at all', new Set(mids).size === mids.length)
}

section("the family's own data is left alone")
{
  const live = emptyHousehold()
  live.members = [{ id: 'r', name: 'Rowan', role: 'kid', age: 4, color: '#31A05F', links: [] }]
  live.done = { '2026-07-28': { 'c1|r': 1 } }
  live.mealPlan = { '2026-07-29': 'Leftovers' }
  live.gl = { r: { bal: 99.5, allow: 4, goal: 'Bike', goalCost: 200, saved: 40, pay: [] } }
  live.fit = { r: { kind: 'oura', sleep: 91, act: 80 } }
  live.settings.pin = '9876'
  live.settings.zip = '11111'
  live.settings.place = 'Somewhere else'
  live.lists = [{ id: 'l1', name: 'Groceries', items: [{ id: 'i1', text: 'Milk', done: false, by: 'r' }] }]

  for (const mode of ['add-missing', 'refresh'] as const) {
    const { merged } = mergeSeed(live, seed(), mode)
    check(`${mode}: chore history untouched`, JSON.stringify(merged.done) === JSON.stringify(live.done))
    check(`${mode}: meal plan untouched`, merged.mealPlan['2026-07-29'] === 'Leftovers')
    check(`${mode}: Greenlight balance untouched`, merged.gl.r?.bal === 99.5)
    check(`${mode}: wearable stats untouched`, merged.fit.r?.sleep === 91)
    check(`${mode}: parent PIN untouched`, merged.settings.pin === '9876')
    check(`${mode}: location untouched when set`, merged.settings.place === 'Somewhere else')
    const groceries = merged.lists.find((l) => l.name === 'Groceries')!
    check(`${mode}: existing list keeps its id`, groceries.id === 'l1')
    check(`${mode}: existing item survives`, groceries.items.some((i) => i.text === 'Milk'))
    check(`${mode}: only one Groceries list`,
      merged.lists.filter((l) => l.name === 'Groceries').length === 1)
  }
}

section('replace is the caller\'s job, not mergeSeed\'s')
{
  // mergeSeed is never called in replace mode — seed-household.ts uses the seed
  // directly — so the guard that matters is that add-missing/refresh can never
  // remove anything.
  const live = emptyHousehold()
  live.chores = [{ id: 'z1', title: 'Something they added', memberIds: [], days: [1], stars: 1 }]
  live.favorites = [{ id: 'z2', name: 'Their own favourite' }]
  for (const mode of ['add-missing', 'refresh'] as const) {
    const { merged } = mergeSeed(live, seed(), mode)
    check(`${mode}: their chore survives`, merged.chores.some((c) => c.id === 'z1'))
    check(`${mode}: their favourite survives`, merged.favorites.some((f) => f.id === 'z2'))
  }
}

console.log(`\n${checks - failures}/${checks} checks passed`)
if (failures) {
  console.log(`${failures} FAILED`)
  process.exit(1)
}
