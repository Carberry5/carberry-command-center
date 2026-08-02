/**
 * Exercises src/store/cloudSync.ts against a real Postgres running
 * supabase/schema.sql. It cannot reach Supabase's PostgREST or realtime layers,
 * but it does prove the part that was written blind: that every column
 * cloudSync names exists with a compatible type, and that
 * FamilyData -> rows -> FamilyData is lossless.
 *
 *   PGURL=postgres://postgres@127.0.0.1:55432/cctest npx tsx scripts/cloudsync-test.ts
 */

import pg from 'pg'
import assert from 'node:assert/strict'
import { migrate } from '../src/data/migrate.ts'
import { seed } from '../src/data/seed.ts'
import {
  PRIMARY_KEYS,
  WRITE_ORDER,
  compositeDeleteFilter,
  diff,
  fromRows,
  toRows,
  type Row,
  type TableName,
  type TableRows,
} from '../src/store/cloudSync.ts'
import type { FamilyData } from '../src/types.ts'

// Match what supabase-js actually receives over PostgREST rather than what the
// pg driver defaults to: dates as "YYYY-MM-DD" strings, bigint/numeric as JSON
// numbers.
pg.types.setTypeParser(1082, (v) => v) // date
pg.types.setTypeParser(20, (v) => Number(v)) // int8
pg.types.setTypeParser(1700, (v) => Number(v)) // numeric

const HH = 'hh_test'
const url = process.env.PGURL ?? 'postgres://postgres@127.0.0.1:55432/cctest'

let passed = 0
function ok(label: string) {
  passed++
  console.log(`  ok: ${label}`)
}

async function main() {
  const db = new pg.Client({ connectionString: url })
  await db.connect()

  const data: FamilyData = migrate(seed())

  // --- insert a full snapshot ------------------------------------------------

  console.log('\ninsert a full snapshot')
  await db.query('delete from public.households where id = $1', [HH])

  const rows = toRows(data, HH)
  for (const table of WRITE_ORDER) {
    for (const row of rows[table]) {
      const cols = Object.keys(row)
      const params = cols.map((_, i) => `$${i + 1}`).join(', ')
      await db.query(
        `insert into public.${table} (${cols.map((c) => `"${c}"`).join(', ')}) values (${params})`,
        cols.map((c) => row[c])
      )
    }
  }
  ok(`inserted ${WRITE_ORDER.reduce((n, t) => n + rows[t].length, 0)} rows across ${WRITE_ORDER.length} tables`)

  // --- read it back and rebuild ---------------------------------------------

  console.log('\nround-trip FamilyData -> rows -> FamilyData')
  const back = {} as TableRows
  for (const table of WRITE_ORDER) {
    const col = table === 'households' ? 'id' : 'household_id'
    const res = await db.query(`select * from public.${table} where ${col} = $1`, [HH])
    back[table] = res.rows as Row[]
  }

  const rebuilt = fromRows(back, data)

  for (const key of Object.keys(data) as (keyof FamilyData)[]) {
    // feedEv is a cache the ICS sync repopulates; it is deliberately not stored.
    if (key === 'feedEv') continue
    assert.deepEqual(rebuilt[key], data[key], `mismatch in "${key}"`)
    ok(`${key} round-tripped intact`)
  }
  // feedEv is populated separately, from the read-only feed_events table — so
  // with no feed rows passed in it is empty rather than reconstructed.
  assert.deepEqual(rebuilt.feedEv, {}, 'feedEv should be empty with no feed events')
  ok('feedEv is empty when no feed events are supplied')

  // --- the differ ------------------------------------------------------------

  console.log('\ndiffer')
  assert.deepEqual(diff(data, data, HH), [], 'identical snapshots must produce no writes')
  ok('no change produces no mutations')

  const tickChore = structuredClone(data)
  const today = Object.keys(tickChore.done)[0]
  // Find a box that is genuinely unticked rather than assuming one. The seed
  // fills a week of plausible history from the *current* weekday, so hard-coding
  // a key ('c5|r') made this pass or fail depending on the day it ran — the
  // chore is scheduled Wed and Sat, and on the wrong day the "tick" was a no-op
  // that produced no mutation and failed here for a reason having nothing to do
  // with the differ.
  const freeKey = data.chores
    .flatMap((c) => c.memberIds.map((m) => `${c.id}|${m}`))
    .find((k) => !tickChore.done[today][k])
  assert.ok(freeKey, 'the seeded history left no unticked box to test with')
  tickChore.done[today][freeKey] = 1
  const m1 = diff(data, tickChore, HH)
  assert.equal(m1.length, 1, 'ticking a chore should touch exactly one table')
  assert.equal(m1[0].table, 'chore_log')
  assert.equal(m1[0].upsert.length, 1)
  assert.equal(m1[0].remove.length, 0)
  ok('ticking one chore box -> 1 chore_log upsert, nothing else')

  const untick = structuredClone(tickChore)
  delete untick.done[today][freeKey]
  const m2 = diff(tickChore, untick, HH)
  assert.equal(m2.length, 1)
  assert.equal(m2[0].remove.length, 1)
  assert.equal(m2[0].upsert.length, 0)
  ok('unticking it -> 1 chore_log delete')

  const rename = structuredClone(data)
  rename.members[0].name = 'Pat'
  const m3 = diff(data, rename, HH)
  assert.equal(m3.length, 1)
  assert.equal(m3[0].table, 'members')
  assert.equal(m3[0].upsert.length, 1)
  ok('renaming a member -> 1 members upsert')

  const dropItem = structuredClone(data)
  const removedId = dropItem.lists[0].items[2].id
  dropItem.lists[0].items.splice(2, 1)
  const m4 = diff(data, dropItem, HH)
  const items = m4.find((m) => m.table === 'list_items')
  assert(items, 'expected a list_items mutation')
  assert.equal(items.remove.length, 1)
  assert.equal(items.remove[0].id, removedId)
  // The items after it shift up, so their sort_order changes too.
  assert.equal(items.upsert.length, dropItem.lists[0].items.length - 2)
  ok('deleting a list item -> 1 delete + resequenced siblings only')

  const addEvent = structuredClone(data)
  addEvent.events.push({
    id: 'ev_new', title: 'Orthodontist', date: '2026-08-03', start: '09:00',
    dur: 30, memberIds: ['c', 'e'], loc: 'Dr. Reyes', recur: null,
  })
  const m5 = diff(data, addEvent, HH)
  const ev = m5.find((m) => m.table === 'events')
  const evm = m5.find((m) => m.table === 'event_members')
  assert.equal(ev?.upsert.length, 1)
  assert.equal(evm?.upsert.length, 2)
  ok('adding an event -> 1 event + 2 event_member rows')

  const settingsOnly = structuredClone(data)
  settingsOnly.settings.place = 'Sterling, VA'
  const m6 = diff(data, settingsOnly, HH)
  assert.equal(m6.length, 1)
  assert.equal(m6[0].table, 'households')
  ok('changing a setting -> households only')

  // --- the diff actually applies against the real schema ---------------------

  console.log('\napply a diff to the database')
  const applied = diff(data, addEvent, HH)
  for (const m of applied) {
    for (const row of m.upsert) {
      const cols = Object.keys(row)
      const conflict = PRIMARY_KEYS[m.table as TableName]
      const updates = cols.filter((c) => !conflict.includes(c))
      // A table whose every column is part of the key (chore_log) has nothing
      // to update — the row's existence *is* the value.
      const action = updates.length
        ? `do update set ${updates.map((c) => `"${c}" = excluded."${c}"`).join(', ')}`
        : 'do nothing'
      await db.query(
        `insert into public.${m.table} (${cols.map((c) => `"${c}"`).join(', ')})
         values (${cols.map((_, i) => `$${i + 1}`).join(', ')})
         on conflict (${conflict.map((c) => `"${c}"`).join(', ')}) ${action}`,
        cols.map((c) => row[c])
      )
    }
  }
  const after = await db.query('select count(*)::int as n from public.events where household_id = $1', [HH])
  assert.equal(after.rows[0].n, data.events.length + 1)
  ok('upserts applied cleanly; event count grew by exactly 1')

  // Confirm the on-conflict targets the diff generates are real unique indexes.
  console.log('\nupsert conflict targets exist as unique constraints')
  for (const table of WRITE_ORDER) {
    const pk = PRIMARY_KEYS[table]
    const res = await db.query(
      `select 1 from pg_index i
         join pg_class c on c.oid = i.indrelid
        where c.relname = $1 and i.indisunique
          and (select array_agg(a.attname::text order by a.attname)
                 from pg_attribute a
                where a.attrelid = c.oid and a.attnum = any(i.indkey)) = (
                select array_agg(x order by x) from unnest($2::text[]) x)`,
      [table, pk]
    )
    assert.equal(res.rowCount, 1, `no unique index on ${table}(${pk.join(', ')})`)
  }
  ok(`all ${WRITE_ORDER.length} upsert conflict targets are backed by unique indexes`)

  // --- member links ----------------------------------------------------------

  console.log('\nmember links')
  const linked = structuredClone(data)
  linked.members[2].links = [
    { id: 'ln_sch', label: 'Schoology', url: 'https://app.schoology.com/home' },
    { id: 'ln_tc', label: 'Transparent Classroom', url: 'https://www.transparentclassroom.com/s/2707' },
  ]
  const linkMut = diff(data, linked, HH)
  assert.equal(linkMut.length, 1, 'adding links should touch one table')
  assert.equal(linkMut[0].table, 'member_links')
  assert.equal(linkMut[0].upsert.length, 2)
  ok('adding two links -> 2 member_links rows, nothing else')

  for (const row of linkMut[0].upsert) {
    const cols = Object.keys(row)
    await db.query(
      `insert into public.member_links (${cols.map((c) => `"${c}"`).join(', ')})
       values (${cols.map((_, i) => `$${i + 1}`).join(', ')})`,
      cols.map((c) => row[c])
    )
  }
  back.member_links = (
    await db.query('select * from public.member_links where household_id = $1', [HH])
  ).rows as Row[]
  const withLinks = fromRows(back, data)
  assert.deepEqual(withLinks.members[2].links, linked.members[2].links, 'links did not round-trip')
  ok('member links round-trip in order, attached to the right member')

  const unlinked = structuredClone(linked)
  unlinked.members[2].links = []
  const rm = diff(linked, unlinked, HH)
  assert.equal(rm[0].remove.length, 2)
  ok('clearing links -> 2 deletes')

  await db.query('delete from public.member_links where household_id = $1', [HH])
  back.member_links = []

  // --- reminders-sourced list items -----------------------------------------

  // ingest_list() marks the rows it owns with source = 'reminders'. If that
  // column does not survive FamilyData -> rows -> FamilyData, the next device
  // edit upserts the row with source null, the ingest stops recognising its own
  // items, and every post re-adds them as duplicates. Nothing about that would
  // look like an error.
  console.log('\nreminders-sourced list items')
  const groceries = data.lists[0]
  await db.query(
    `insert into public.list_items (id, list_id, household_id, text, done, by_member_id, source, sort_order)
     values ($1,$2,$3,$4,$5,$6,$7,$8)`,
    ['rem:test', groceries.id, HH, 'Oat milk', false, 'e', 'reminders', 1001]
  )
  back.list_items = (
    await db.query('select * from public.list_items where household_id = $1', [HH])
  ).rows as Row[]

  const withRem = fromRows(back, data)
  const remItem = withRem.lists[0].items.find((i) => i.id === 'rem:test')
  assert.equal(remItem?.src, 'reminders', 'source did not survive the read')
  ok('an ingested item comes back tagged src = reminders')

  const typed = withRem.lists[0].items.find((i) => i.id !== 'rem:test')
  assert.ok(typed && !('src' in typed), 'an app-typed item should have no src key at all')
  ok('an app-typed item carries no src key (absent, not undefined)')

  const remRows = toRows(withRem, HH)
  const remRow = remRows.list_items.find((r) => r.id === 'rem:test')
  assert.equal(remRow?.source, 'reminders', 'source was dropped on the way back to rows')
  ok('and survives the trip back to a row')

  assert.deepEqual(diff(withRem, withRem, HH), [], 'a snapshot should not differ from itself')
  ok('a mixed-source list is stable under the differ')

  // The case that would actually bite: edit something else in the same list and
  // confirm the ingested row is not dragged into the write with source lost.
  const renamed = structuredClone(withRem)
  renamed.lists[0].items[0].text = 'Whole milk'
  const renameMut = diff(withRem, renamed, HH)
  const touched = renameMut.find((m) => m.table === 'list_items')?.upsert ?? []
  assert.equal(touched.length, 1, 'renaming one item should upsert exactly one row')
  assert.notEqual(touched[0].id, 'rem:test', 'the ingested row should not be rewritten')
  ok('editing a neighbouring item leaves the ingested row alone')

  // Google Tasks items carry a remote_id as well. It is the only link between a
  // row here and a task there — lose it on a round trip and the next sync sees
  // an unlinked item, pushes a second task up, and the list doubles every run.
  await db.query(
    `insert into public.list_items (id, list_id, household_id, text, done, by_member_id, source, remote_id, sort_order)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    ['gt:task9', groceries.id, HH, 'Butter', false, 'e', 'gtasks', 'task9', 1002]
  )
  back.list_items = (
    await db.query('select * from public.list_items where household_id = $1', [HH])
  ).rows as Row[]

  const withGt = fromRows(back, data)
  const gtItem = withGt.lists[0].items.find((i) => i.id === 'gt:task9')
  assert.equal(gtItem?.rid, 'task9', 'remote_id did not survive the read')
  assert.equal(gtItem?.src, 'gtasks')
  ok('a Google Tasks item comes back with its remote id')

  const gtRow = toRows(withGt, HH).list_items.find((r) => r.id === 'gt:task9')
  assert.equal(gtRow?.remote_id, 'task9', 'remote_id was dropped on the way back to rows')
  ok('and the remote id survives the trip back to a row')

  assert.deepEqual(diff(withGt, withGt, HH), [], 'a synced list should not differ from itself')
  ok('a list mixing app, reminders and gtasks items is stable under the differ')

  // The unique index is what stops two rows claiming one task, which would make
  // completions ambiguous.
  await assert.rejects(
    db.query(
      `insert into public.list_items (id, list_id, household_id, text, source, remote_id)
       values ($1,$2,$3,$4,$5,$6)`,
      ['gt:dupe', groceries.id, HH, 'Butter again', 'gtasks', 'task9']
    ),
    /duplicate key|unique/i,
    'two items should not be able to share a remote_id'
  )
  ok('the database refuses two items linked to the same task')

  await db.query('delete from public.list_items where id in ($1, $2)', ['rem:test', 'gt:task9'])
  back.list_items = (
    await db.query('select * from public.list_items where household_id = $1', [HH])
  ).rows as Row[]

  // --- feed events are read-only to the client ------------------------------

  console.log('\nICS feed events')
  // Tagged to two kids, as a school calendar covering siblings would be.
  await db.query(
    `insert into public.feeds (id, household_id, name, url, member_ids) values ($1,$2,$3,$4,$5)`,
    ['f_smoke', HH, 'School', 'https://example.test/school.ics', ['c', 'h']]
  )
  await db.query(
    `insert into public.feed_events (id, household_id, feed_id, title, date, start_time, loc, sort_order)
     values ($1,$2,$3,$4,$5,$6,$7,$8), ($9,$10,$11,$12,$13,$14,$15,$16)`,
    [
      'f_smoke:0', HH, 'f_smoke', 'Early release', '2026-09-02', '12:30', 'LCPS', 0,
      'f_smoke:1', HH, 'f_smoke', 'Teacher workday', '2026-09-07', null, '', 1,
    ]
  )

  const feRows = (await db.query('select * from public.feed_events where household_id = $1', [HH]))
    .rows as Row[]
  // `back` was captured before this feed existed; refresh it so the member
  // lookup has the row it needs.
  back.feeds = (await db.query('select * from public.feeds where household_id = $1', [HH]))
    .rows as Row[]
  const withFeeds = fromRows(back, data, feRows)

  assert.equal(withFeeds.feedEv['f_smoke']?.length, 2, 'feed events did not reach feedEv')
  assert.equal(withFeeds.feedEv['f_smoke'][0].title, 'Early release')
  assert.equal(withFeeds.feedEv['f_smoke'][0].start, '12:30')
  assert.equal(withFeeds.feedEv['f_smoke'][1].start, null, 'an all-day feed event should have no time')
  assert.deepEqual(
    withFeeds.feedEv['f_smoke'][0].memberIds,
    ['c', 'h'],
    'feed events should inherit their feed\'s members'
  )
  ok('feed events load into feedEv, ordered, with times and all-day handled')

  // The tag lives on the feed, so retagging takes effect on the next read
  // rather than waiting for the ICS sync to run again.
  const retagged = structuredClone(back)
  ;(retagged.feeds.find((f) => f.id === 'f_smoke') as Row).member_ids = ['h']
  assert.deepEqual(fromRows(retagged, data, feRows).feedEv['f_smoke'][0].memberIds, ['h'])
  ok('retagging a feed re-attributes its events without a re-sync')

  // The differ must never produce a write for them: the scheduled sync owns
  // that table, and the database only grants the browser SELECT anyway.
  const feedChanged = structuredClone(withFeeds)
  feedChanged.feedEv['f_smoke'][0].title = 'Tampered'
  feedChanged.feedEv['f_smoke'].push({
    id: 'invented', title: 'Invented', date: '2026-09-09', start: null,
    dur: null, memberIds: [], loc: '', recur: null,
  })
  assert.deepEqual(
    diff(withFeeds, feedChanged, HH),
    [],
    'editing feedEv must not generate any mutation'
  )
  ok('editing feedEv produces no writes — the sync owns that table')

  // --- composite delete filters ---------------------------------------------

  console.log('\ncomposite delete filter (PostgREST grammar)')
  assert.equal(
    compositeDeleteFilter(
      [{ event_id: 'ev1', member_id: 'c' }, { event_id: 'ev2', member_id: 'h' }],
      ['event_id', 'member_id']
    ),
    'and(event_id.eq.ev1,member_id.eq.c),and(event_id.eq.ev2,member_id.eq.h)'
  )
  ok('two-column filter matches the documented or=(and(…),and(…)) shape')

  assert.equal(
    compositeDeleteFilter([{ household_id: HH, day: '2026-08-03' }], ['household_id', 'day']),
    `and(household_id.eq.${HH},day.eq.2026-08-03)`
  )
  ok('dates pass through unquoted (hyphens are filter-safe)')

  assert.equal(
    compositeDeleteFilter([{ a: 'has space', b: 'q"uote' }], ['a', 'b']),
    'and(a.eq."has space",b.eq."q\\"uote")'
  )
  ok('values needing quotes are quoted and escaped')

  // --- deletes identify exactly one row each ---------------------------------

  console.log('\ndelete keys uniquely identify their rows')
  for (const m of diff(addEvent, data, HH)) {
    for (const row of m.remove) {
      const cols = Object.keys(row)
      const where = cols.map((c, i) => `"${c}" = $${i + 1}`).join(' and ')
      const res = await db.query(
        `select count(*)::int as n from public.${m.table} where ${where}`,
        cols.map((c) => row[c])
      )
      assert(res.rows[0].n <= 1, `${m.table} delete key matched ${res.rows[0].n} rows`)
    }
  }
  ok('every generated delete key matches at most one row')

  await db.query('delete from public.households where id = $1', [HH])
  await db.end()
  console.log(`\nALL ${passed} CLOUDSYNC CHECKS PASSED`)
}

main().catch((err) => {
  console.error('\nFAILED:', err instanceof Error ? err.message : err)
  process.exit(1)
})
