/**
 * The family NFL pick'em: who picked what, and who is winning.
 *
 * Everything here is pure. The rules are simple enough to hold in your head —
 * one point for a correct pick — but the edges are where a leaderboard quietly
 * lies to you, and those are the parts worth being deliberate about:
 *
 *   - a game with no winner recorded yet scores nothing for anybody
 *   - a game whose recorded winner isn't one of the two teams playing is
 *     treated as unsettled rather than marking everyone wrong
 *   - not picking a game is not the same as picking it wrong; both score zero,
 *     but only one of them counts against your accuracy
 *
 * There is no schedule to fetch. The 32 teams are stable enough to write down,
 * and the family adds the handful of games they'll actually watch each week.
 */

export interface Team {
  code: string
  city: string
  name: string
  /** Primary colour, dark enough to carry white text on a chip. */
  color: string
}

/** The league, in divisional order. Codes match the usual broadcast ones. */
export const TEAMS: Team[] = [
  { code: 'BUF', city: 'Buffalo', name: 'Bills', color: '#00338D' },
  { code: 'MIA', city: 'Miami', name: 'Dolphins', color: '#008E97' },
  { code: 'NE', city: 'New England', name: 'Patriots', color: '#002244' },
  { code: 'NYJ', city: 'New York', name: 'Jets', color: '#125740' },
  { code: 'BAL', city: 'Baltimore', name: 'Ravens', color: '#241773' },
  { code: 'CIN', city: 'Cincinnati', name: 'Bengals', color: '#FB4F14' },
  { code: 'CLE', city: 'Cleveland', name: 'Browns', color: '#311D00' },
  { code: 'PIT', city: 'Pittsburgh', name: 'Steelers', color: '#101820' },
  { code: 'HOU', city: 'Houston', name: 'Texans', color: '#03202F' },
  { code: 'IND', city: 'Indianapolis', name: 'Colts', color: '#002C5F' },
  { code: 'JAX', city: 'Jacksonville', name: 'Jaguars', color: '#006778' },
  { code: 'TEN', city: 'Tennessee', name: 'Titans', color: '#0C2340' },
  { code: 'DEN', city: 'Denver', name: 'Broncos', color: '#FB4F14' },
  { code: 'KC', city: 'Kansas City', name: 'Chiefs', color: '#E31837' },
  { code: 'LV', city: 'Las Vegas', name: 'Raiders', color: '#101820' },
  { code: 'LAC', city: 'Los Angeles', name: 'Chargers', color: '#0080C6' },
  { code: 'DAL', city: 'Dallas', name: 'Cowboys', color: '#041E42' },
  { code: 'NYG', city: 'New York', name: 'Giants', color: '#0B2265' },
  { code: 'PHI', city: 'Philadelphia', name: 'Eagles', color: '#004C54' },
  { code: 'WAS', city: 'Washington', name: 'Commanders', color: '#5A1414' },
  { code: 'CHI', city: 'Chicago', name: 'Bears', color: '#0B162A' },
  { code: 'DET', city: 'Detroit', name: 'Lions', color: '#0076B6' },
  { code: 'GB', city: 'Green Bay', name: 'Packers', color: '#203731' },
  { code: 'MIN', city: 'Minnesota', name: 'Vikings', color: '#4F2683' },
  { code: 'ATL', city: 'Atlanta', name: 'Falcons', color: '#A71930' },
  { code: 'CAR', city: 'Carolina', name: 'Panthers', color: '#0085CA' },
  { code: 'NO', city: 'New Orleans', name: 'Saints', color: '#101820' },
  { code: 'TB', city: 'Tampa Bay', name: 'Buccaneers', color: '#D50A0A' },
  { code: 'ARI', city: 'Arizona', name: 'Cardinals', color: '#97233F' },
  { code: 'LAR', city: 'Los Angeles', name: 'Rams', color: '#003594' },
  { code: 'SF', city: 'San Francisco', name: '49ers', color: '#AA0000' },
  { code: 'SEA', city: 'Seattle', name: 'Seahawks', color: '#002244' },
]

const BY_CODE = new Map(TEAMS.map((t) => [t.code, t]))

export const teamByCode = (code: string | null | undefined): Team | undefined =>
  code ? BY_CODE.get(code) : undefined

/** "Commanders", or the raw code if it isn't one we know. */
export const teamName = (code: string): string => BY_CODE.get(code)?.name ?? code

/** The colour to paint a team's chip; a neutral grey for anything unrecognised. */
export const teamColor = (code: string): string => BY_CODE.get(code)?.color ?? '#6B6B6B'

export interface PickemGame {
  id: string
  season: number
  week: number
  /** Team codes. Away plays at home, so the board reads "away @ home". */
  away: string
  home: string
  date: string
  start: string | null
  /** Winning team code. Null until a parent records the result. */
  winner: string | null
}

export interface PickemPick {
  gameId: string
  memberId: string
  team: string
}

/**
 * A game counts towards the leaderboard only once a winner is recorded AND
 * that winner is one of the two teams playing.
 *
 * The second half matters: a typo'd or stale winner code would otherwise mark
 * every single pick on that game wrong, which looks exactly like the family
 * having a terrible week. Better to leave it unsettled and visibly unscored.
 */
export const isSettled = (g: PickemGame): boolean =>
  !!g.winner && (g.winner === g.home || g.winner === g.away)

/** Games in a week, in kickoff order. */
export function gamesForWeek(games: PickemGame[], season: number, week: number): PickemGame[] {
  return games
    .filter((g) => g.season === season && g.week === week)
    .sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1
      return (a.start ?? '99:99') < (b.start ?? '99:99') ? -1 : 1
    })
}

/** Every week that has at least one game, ascending. */
export function weeksWithGames(games: PickemGame[], season: number): number[] {
  return [...new Set(games.filter((g) => g.season === season).map((g) => g.week))].sort((a, b) => a - b)
}

/**
 * What `memberId` picked for `gameId`, or null.
 *
 * The last matching entry wins. Picks are keyed by (game, member) when stored,
 * so a duplicate means something went wrong upstream — resolving it to the most
 * recent one at least keeps every view of the board agreeing with every other.
 */
export function pickOf(picks: PickemPick[], gameId: string, memberId: string): string | null {
  let found: string | null = null
  for (const p of picks) if (p.gameId === gameId && p.memberId === memberId) found = p.team
  return found
}

export interface Standing {
  memberId: string
  /** Correct picks — this is the score. */
  correct: number
  /** Picked, and wrong. */
  wrong: number
  /** Settled games with no pick at all. Zero points, but not a wrong answer. */
  missed: number
  /** Correct / (correct + wrong), 0 when they have picked nothing yet. */
  pct: number
  /** Shared position, so equal scores read as equal (1, 2, 2, 4). */
  rank: number
}

/**
 * The leaderboard.
 *
 * `memberIds` drives the rows rather than the picks do, so somebody who has not
 * picked anything yet still appears on nil rather than vanishing from the
 * family's board.
 */
export function standings(
  games: PickemGame[],
  picks: PickemPick[],
  memberIds: string[],
  opts: { season?: number; throughWeek?: number } = {}
): Standing[] {
  const settled = games.filter(
    (g) =>
      isSettled(g) &&
      (opts.season == null || g.season === opts.season) &&
      (opts.throughWeek == null || g.week <= opts.throughWeek)
  )

  const rows = memberIds.map((memberId) => {
    let correct = 0
    let wrong = 0
    let missed = 0
    for (const g of settled) {
      const pick = pickOf(picks, g.id, memberId)
      if (!pick) missed++
      else if (pick === g.winner) correct++
      else wrong++
    }
    const played = correct + wrong
    return { memberId, correct, wrong, missed, pct: played ? correct / played : 0, rank: 0 }
  })

  rows.sort((a, b) => b.correct - a.correct || b.pct - a.pct || a.memberId.localeCompare(b.memberId))

  // Competition ranking: equal scores share a place and the next one skips.
  rows.forEach((r, i) => {
    const prev = rows[i - 1]
    r.rank = prev && prev.correct === r.correct && prev.pct === r.pct ? prev.rank : i + 1
  })
  return rows
}

/** One member's record for a single week — the "3 of 4" under their name. */
export function weekRecord(
  games: PickemGame[],
  picks: PickemPick[],
  memberId: string,
  season: number,
  week: number
): { correct: number; settled: number; picked: number; total: number } {
  const wk = gamesForWeek(games, season, week)
  let correct = 0
  let settledCount = 0
  let picked = 0
  for (const g of wk) {
    const pick = pickOf(picks, g.id, memberId)
    if (pick) picked++
    if (!isSettled(g)) continue
    settledCount++
    if (pick === g.winner) correct++
  }
  return { correct, settled: settledCount, picked, total: wk.length }
}

/** Whoever is top of the board, or null when nobody has scored yet. */
export function leader(rows: Standing[]): Standing | null {
  const top = rows[0]
  return top && top.correct > 0 ? top : null
}
