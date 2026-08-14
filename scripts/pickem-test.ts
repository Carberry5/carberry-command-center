/**
 * Exercises the pick'em scoring.
 *
 * The happy path is one point per correct pick and hardly needs a test. What
 * needs one is everything around it: an unfinished game must score nobody, a
 * corrupt result must not mark the whole family wrong, a missed pick must not
 * be confused with a wrong one, and a tie must read as a tie.
 *
 *   npx tsx scripts/pickem-test.ts
 */

import {
  TEAMS,
  gamesForWeek,
  isSettled,
  leader,
  pickOf,
  standings,
  teamColor,
  teamName,
  weekRecord,
  weeksWithGames,
  type PickemGame,
  type PickemPick,
} from '../src/lib/pickem.ts'

let checks = 0
let failures = 0
const check = (name: string, cond: boolean, detail = '') => {
  checks++
  if (cond) console.log(`  ok   ${name}`)
  else {
    failures++
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`)
  }
}
const section = (n: string) => console.log(`\n${n}`)

const g = (
  id: string,
  week: number,
  away: string,
  home: string,
  winner: string | null,
  date = '2026-09-13',
  start: string | null = '13:00'
): PickemGame => ({ id, season: 2026, week, away, home, date, start, winner })

const p = (gameId: string, memberId: string, team: string): PickemPick => ({ gameId, memberId, team })

const FAMILY = ['patrick', 'elizabeth', 'cannon', 'hadley', 'rowan']

// ---------------------------------------------------------------------------

section('the league is complete and usable')
{
  check('32 teams', TEAMS.length === 32, String(TEAMS.length))
  check('no duplicate codes', new Set(TEAMS.map((t) => t.code)).size === 32)
  check('every team has a colour', TEAMS.every((t) => /^#[0-9A-F]{6}$/i.test(t.color)))
  check('codes are short', TEAMS.every((t) => t.code.length >= 2 && t.code.length <= 3))
  check('the Commanders are there', teamName('WAS') === 'Commanders')
  check('an unknown code falls back to itself', teamName('XXX') === 'XXX')
  check('and gets a neutral colour', teamColor('XXX') === '#6B6B6B')
}

section('a game only counts once a real winner is recorded')
{
  check('no winner yet is unsettled', !isSettled(g('a', 1, 'DAL', 'PHI', null)))
  check('a winner that played is settled', isSettled(g('a', 1, 'DAL', 'PHI', 'PHI')))
  check('the away team counts too', isSettled(g('a', 1, 'DAL', 'PHI', 'DAL')))
  // The one that would quietly ruin a week: a typo'd code marking everyone wrong.
  check('a winner that did not play is NOT settled', !isSettled(g('a', 1, 'DAL', 'PHI', 'NYG')))
  check('an empty string is not a winner', !isSettled(g('a', 1, 'DAL', 'PHI', '')))
}

section('one point per correct pick')
{
  const games = [g('g1', 1, 'DAL', 'PHI', 'PHI'), g('g2', 1, 'KC', 'BUF', 'KC')]
  const picks = [
    p('g1', 'patrick', 'PHI'), p('g2', 'patrick', 'KC'),      // 2
    p('g1', 'hadley', 'PHI'), p('g2', 'hadley', 'BUF'),       // 1
    p('g1', 'rowan', 'DAL'), p('g2', 'rowan', 'BUF'),         // 0
  ]
  const rows = standings(games, picks, FAMILY, { season: 2026 })
  const by = Object.fromEntries(rows.map((r) => [r.memberId, r]))
  check('two right is two points', by.patrick.correct === 2, JSON.stringify(by.patrick))
  check('one right is one point', by.hadley.correct === 1)
  check('none right is nil', by.rowan.correct === 0)
  check('and the wrong ones are counted', by.rowan.wrong === 2)
  check('the leader is on top', rows[0].memberId === 'patrick')
  check('leader() agrees', leader(rows)?.memberId === 'patrick')
}

section('everyone appears, even before they have picked anything')
{
  const rows = standings([g('g1', 1, 'DAL', 'PHI', 'PHI')], [p('g1', 'patrick', 'PHI')], FAMILY)
  check('all five have a row', rows.length === 5, String(rows.length))
  const eliz = rows.find((r) => r.memberId === 'elizabeth')!
  check('a non-picker is on nil', eliz.correct === 0 && eliz.wrong === 0)
  check('and it is recorded as missed, not wrong', eliz.missed === 1, JSON.stringify(eliz))
}

section('missing a game is not the same as getting it wrong')
{
  const games = [g('g1', 1, 'DAL', 'PHI', 'PHI'), g('g2', 1, 'KC', 'BUF', 'KC')]
  // Both score zero. Only one of them picked and was wrong.
  const rows = standings(games, [p('g1', 'hadley', 'DAL')], ['hadley', 'rowan'])
  const h = rows.find((r) => r.memberId === 'hadley')!
  const r = rows.find((r) => r.memberId === 'rowan')!
  check('one wrong, one not picked', h.wrong === 1 && h.missed === 1, JSON.stringify(h))
  check('the other missed both', r.wrong === 0 && r.missed === 2, JSON.stringify(r))
  check('accuracy counts only what you picked', h.pct === 0)

  const perfect = standings(games, [p('g1', 'cannon', 'PHI')], ['cannon'])[0]
  check('one from one is 100%', perfect.pct === 1, JSON.stringify(perfect))
  check('even though a game was missed', perfect.missed === 1)
  check('picking nothing is 0%, not NaN', standings(games, [], ['rowan'])[0].pct === 0)
}

section('unfinished games score nobody')
{
  const games = [g('g1', 1, 'DAL', 'PHI', null), g('g2', 1, 'KC', 'BUF', null)]
  const rows = standings(games, [p('g1', 'patrick', 'PHI'), p('g2', 'patrick', 'KC')], FAMILY)
  check('no points yet', rows.every((r) => r.correct === 0))
  check('and nothing counted as missed', rows.every((r) => r.missed === 0))
  check('leader() reports nobody', leader(rows) === null)
}

section('a corrupt result is left unscored rather than marking everyone wrong')
{
  const games = [g('g1', 1, 'DAL', 'PHI', 'NYG')]
  const rows = standings(games, [p('g1', 'patrick', 'PHI'), p('g1', 'hadley', 'DAL')], ['patrick', 'hadley'])
  check('nobody is marked wrong', rows.every((r) => r.wrong === 0), JSON.stringify(rows))
  check('and nobody scores', rows.every((r) => r.correct === 0))
}

section('ties share a place')
{
  const games = [g('g1', 1, 'DAL', 'PHI', 'PHI'), g('g2', 1, 'KC', 'BUF', 'KC')]
  const picks = [
    p('g1', 'aa', 'PHI'), p('g2', 'aa', 'KC'),   // 2
    p('g1', 'bb', 'PHI'), p('g2', 'bb', 'KC'),   // 2
    p('g1', 'cc', 'PHI'), p('g2', 'cc', 'BUF'),  // 1
  ]
  const rows = standings(games, picks, ['aa', 'bb', 'cc'])
  check('the two leaders are both first', rows[0].rank === 1 && rows[1].rank === 1, JSON.stringify(rows))
  check('and the next is third, not second', rows[2].rank === 3, JSON.stringify(rows))
}

section('the season can be sliced by week')
{
  const games = [g('g1', 1, 'DAL', 'PHI', 'PHI'), g('g2', 2, 'KC', 'BUF', 'KC')]
  const picks = [p('g1', 'patrick', 'PHI'), p('g2', 'patrick', 'KC')]
  check('through week 1 counts one', standings(games, picks, ['patrick'], { throughWeek: 1 })[0].correct === 1)
  check('through week 2 counts both', standings(games, picks, ['patrick'], { throughWeek: 2 })[0].correct === 2)
  check('unbounded counts both', standings(games, picks, ['patrick'])[0].correct === 2)
}

section('seasons do not bleed into each other')
{
  const last: PickemGame = { ...g('old', 1, 'DAL', 'PHI', 'PHI'), season: 2025 }
  const now = g('new', 1, 'KC', 'BUF', 'KC')
  const picks = [p('old', 'patrick', 'PHI'), p('new', 'patrick', 'KC')]
  check('this season only counts this season', standings([last, now], picks, ['patrick'], { season: 2026 })[0].correct === 1)
  check('and last season is still there', standings([last, now], picks, ['patrick'], { season: 2025 })[0].correct === 1)
  check('week lists are per season', JSON.stringify(weeksWithGames([last, now], 2026)) === '[1]')
}

section('a week reads in kickoff order')
{
  const games = [
    g('sun', 1, 'KC', 'BUF', null, '2026-09-13', '13:00'),
    g('thu', 1, 'DAL', 'PHI', null, '2026-09-10', '20:15'),
    g('sunLate', 1, 'SF', 'SEA', null, '2026-09-13', '16:25'),
    g('nextWeek', 2, 'GB', 'CHI', null, '2026-09-20', '13:00'),
  ]
  const wk = gamesForWeek(games, 2026, 1).map((x) => x.id)
  check('sorted by date then time', JSON.stringify(wk) === '["thu","sun","sunLate"]', JSON.stringify(wk))
  check('other weeks are excluded', !wk.includes('nextWeek'))
  check('weeks are listed ascending', JSON.stringify(weeksWithGames(games, 2026)) === '[1,2]')

  // A game with no kickoff time must not sort ahead of one that has it.
  const noTime = [g('a', 1, 'KC', 'BUF', null, '2026-09-13', null), g('b', 1, 'SF', 'SEA', null, '2026-09-13', '13:00')]
  check('a timeless game sorts last', gamesForWeek(noTime, 2026, 1)[0].id === 'b')
}

section('a duplicate pick resolves the same way everywhere')
{
  // Shouldn't happen — picks are keyed by (game, member) — but if it does, every
  // view must agree on which one counts, or the board contradicts itself.
  const picks = [p('g1', 'hadley', 'DAL'), p('g1', 'hadley', 'PHI')]
  check('the last one wins', pickOf(picks, 'g1', 'hadley') === 'PHI')
  const rows = standings([g('g1', 1, 'DAL', 'PHI', 'PHI')], picks, ['hadley'])
  check('and scoring agrees with it', rows[0].correct === 1, JSON.stringify(rows[0]))
  check('an absent pick is null', pickOf(picks, 'g1', 'rowan') === null)
}

section("a week's record for one person")
{
  const games = [
    g('g1', 1, 'DAL', 'PHI', 'PHI'),
    g('g2', 1, 'KC', 'BUF', 'KC'),
    g('g3', 1, 'SF', 'SEA', null),
  ]
  const picks = [p('g1', 'hadley', 'PHI'), p('g2', 'hadley', 'BUF'), p('g3', 'hadley', 'SF')]
  const rec = weekRecord(games, picks, 'hadley', 2026, 1)
  check('1 of 2 settled', rec.correct === 1 && rec.settled === 2, JSON.stringify(rec))
  check('picked all three', rec.picked === 3 && rec.total === 3, JSON.stringify(rec))

  const none = weekRecord(games, picks, 'rowan', 2026, 1)
  check('somebody who picked nothing', none.correct === 0 && none.picked === 0 && none.total === 3)

  const empty = weekRecord(games, picks, 'hadley', 2026, 9)
  check('an empty week is zeroes, not a crash', empty.total === 0 && empty.settled === 0)
}

console.log(`\n${checks - failures}/${checks} checks passed`)
if (failures) {
  console.log(`${failures} FAILED`)
  process.exit(1)
}
