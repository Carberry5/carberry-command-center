import { useMemo, useState } from 'react'
import { uid } from '../lib/dates.ts'
import {
  TEAMS,
  gamesForWeek,
  isSettled,
  pickOf,
  standings,
  teamColor,
  teamName,
  weekRecord,
  weeksWithGames,
} from '../lib/pickem.ts'
import { CREAM, DISPLAY_CAPS, HEADING, INK, card, dangerBtn, input, line, primaryBtn } from '../lib/theme.ts'
import { useFamily } from '../store/FamilyStore.tsx'
import { Avatar } from '../components/Avatar.tsx'

/**
 * The family NFL pick'em.
 *
 * Two things share the page because they answer each other: the week's board
 * (who picked whom) and the season leaderboard (who is winning). The board is
 * everyone's picks at once rather than one person at a time — this runs on a
 * kitchen display, and the point of the whole thing is seeing that Rowan took
 * the Commanders again.
 *
 * Adding games and recording winners are parent jobs and sit behind the PIN.
 * Making a pick is not: a seven-year-old should be able to walk up and tap.
 */
export function PickemPage() {
  const { data, update, parentUnlocked, requirePin } = useFamily()
  const { season, games, picks } = data.pickem

  const weeks = useMemo(() => weeksWithGames(games, season), [games, season])
  const [week, setWeek] = useState(() => weeks[weeks.length - 1] ?? 1)
  const [who, setWho] = useState<string | null>(null)

  const slate = useMemo(() => gamesForWeek(games, season, week), [games, season, week])
  const board = useMemo(
    () => standings(games, picks, data.members.map((m) => m.id), { season }),
    [games, picks, data.members, season]
  )

  const pick = (gameId: string, team: string) => {
    if (!who) return
    update((d) => {
      const existing = d.pickem.picks.find((p) => p.gameId === gameId && p.memberId === who)
      // Tapping the team you already had clears it — the only way back out of a
      // misfire on a touchscreen with no right-click.
      if (existing && existing.team === team) {
        d.pickem.picks = d.pickem.picks.filter((p) => !(p.gameId === gameId && p.memberId === who))
      } else if (existing) {
        existing.team = team
      } else {
        d.pickem.picks.push({ gameId, memberId: who, team })
      }
    })
  }

  const setWinner = (gameId: string, team: string | null) =>
    requirePin(() =>
      update((d) => {
        const g = d.pickem.games.find((x) => x.id === gameId)
        if (g) g.winner = g.winner === team ? null : team
      })
    , 'Recording a result is parent-only')

  return (
    <section style={{ animation: 'fadeUp .35s ease both', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Leaderboard board={board} />

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ ...DISPLAY_CAPS, fontSize: '.9em', color: line(0.5) }}>Week</span>
        {weeks.map((w) => (
          <button
            key={w}
            onClick={() => setWeek(w)}
            style={{
              border: `1.5px solid ${w === week ? INK : line(0.16)}`,
              background: w === week ? INK : '#FFFFFF',
              color: w === week ? CREAM : INK,
              borderRadius: 999,
              minWidth: 40,
              padding: '7px 12px',
              fontWeight: 700,
              fontSize: '.85em',
              cursor: 'pointer',
            }}
          >
            {w}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        {/* Whose picks the taps below belong to. Without this the board would
            need a login; with it, anyone can walk up, tap their face, and pick. */}
        <span style={{ fontWeight: 700, fontSize: '.8em', color: line(0.55) }}>
          {who ? 'Picking as' : 'Tap your face to pick'}
        </span>
        {data.members.map((m) => (
          <Avatar
            key={m.id}
            member={m}
            size={38}
            onClick={() => setWho((prev) => (prev === m.id ? null : m.id))}
            title={who === m.id ? `Stop picking as ${m.name}` : `Pick as ${m.name}`}
            style={{
              transition: 'opacity .15s ease, box-shadow .15s ease',
              opacity: !who || who === m.id ? 1 : 0.34,
              boxShadow: who === m.id ? `0 0 0 2px ${CREAM}, 0 0 0 4px ${m.color}` : 'none',
            }}
          />
        ))}
      </div>

      {slate.length ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {slate.map((g) => (
            <GameRow
              key={g.id}
              game={g}
              members={data.members}
              picks={picks}
              who={who}
              parentUnlocked={parentUnlocked}
              onPick={pick}
              onWinner={setWinner}
              onRemove={() =>
                requirePin(() =>
                  update((d) => {
                    d.pickem.games = d.pickem.games.filter((x) => x.id !== g.id)
                    d.pickem.picks = d.pickem.picks.filter((p) => p.gameId !== g.id)
                  })
                , 'Removing a game is parent-only')
              }
            />
          ))}
        </div>
      ) : (
        <div style={{ ...card, padding: 26, textAlign: 'center', color: line(0.55), fontWeight: 600 }}>
          No games on the board for week {week} yet.
        </div>
      )}

      <AddGame season={season} week={week} weeks={weeks} onWeek={setWeek} />

      {slate.length ? <WeekTable slate={slate} members={data.members} picks={picks} season={season} week={week} games={games} /> : null}
    </section>
  )
}

// ---------------------------------------------------------------------------

function Leaderboard({ board }: { board: ReturnType<typeof standings> }) {
  const { data } = useFamily()
  const top = board[0]?.correct ?? 0
  return (
    <div style={{ ...card, padding: '16px 18px' }}>
      <h2 style={{ ...HEADING, fontSize: '1.2em', marginBottom: 12 }}>Season leaderboard</h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {board.map((row) => {
          const m = data.members.find((x) => x.id === row.memberId)
          if (!m) return null
          // Relative to the leader, so the bar means something on week 1 as well
          // as week 17. Everyone on nil gets no bar rather than a full one.
          const width = top ? Math.round((row.correct / top) * 100) : 0
          return (
            <div key={row.memberId} style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
              <span style={{ width: 26, fontWeight: 700, fontSize: '.85em', color: line(0.45) }}>
                {row.correct ? row.rank : '—'}
              </span>
              <Avatar member={m} size={32} />
              <span style={{ fontWeight: 700, fontSize: '.92em', minWidth: 78 }}>{m.name}</span>
              <div style={{ flex: 1, minWidth: 60, height: 10, borderRadius: 999, background: line(0.07) }}>
                <div
                  style={{
                    width: `${width}%`,
                    height: '100%',
                    borderRadius: 999,
                    background: m.color,
                    transition: 'width .3s ease',
                  }}
                />
              </div>
              <span style={{ fontFamily: "'Outfit', sans-serif", fontWeight: 600, fontSize: '1.05em', minWidth: 26, textAlign: 'right' }}>
                {row.correct}
              </span>
              <span style={{ fontWeight: 600, fontSize: '.76em', color: line(0.45), minWidth: 64, textAlign: 'right' }}>
                {row.correct + row.wrong ? `${Math.round(row.pct * 100)}%` : 'no picks'}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function GameRow({
  game,
  members,
  picks,
  who,
  parentUnlocked,
  onPick,
  onWinner,
  onRemove,
}: {
  game: ReturnType<typeof gamesForWeek>[number]
  members: { id: string; name: string; color: string }[]
  picks: { gameId: string; memberId: string; team: string }[]
  who: string | null
  parentUnlocked: boolean
  onPick: (gameId: string, team: string) => void
  onWinner: (gameId: string, team: string) => void
  onRemove: () => void
}) {
  const settled = isSettled(game)
  const mine = who ? pickOf(picks, game.id, who) : null

  const teamButton = (code: string) => {
    const won = settled && game.winner === code
    const lost = settled && game.winner !== code
    const chosen = mine === code
    return (
      <button
        onClick={() => (who ? onPick(game.id, code) : undefined)}
        disabled={!who}
        title={who ? `Pick ${teamName(code)}` : 'Tap a face above first'}
        style={{
          flex: 1,
          minWidth: 0,
          borderRadius: 14,
          padding: '11px 12px',
          fontWeight: 700,
          fontSize: '.95em',
          cursor: who ? 'pointer' : 'default',
          textAlign: 'left',
          transition: 'all .15s ease',
          // Your own pick is filled in the team's colour; everything else stays
          // quiet so the board reads as "what did I do here" at a glance.
          background: chosen ? teamColor(code) : '#FFFFFF',
          color: chosen ? '#FFFFFF' : INK,
          border: `2px solid ${chosen ? teamColor(code) : won ? INK : line(0.12)}`,
          opacity: lost ? 0.5 : 1,
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <span
            style={{
              width: 10,
              height: 10,
              borderRadius: 3,
              flexShrink: 0,
              background: chosen ? '#FFFFFF' : teamColor(code),
            }}
          />
          {teamName(code)}
          {won ? <span style={{ marginLeft: 'auto', fontSize: '.8em', fontWeight: 800 }}>WON</span> : null}
        </span>
      </button>
    )
  }

  return (
    <div style={{ ...card, padding: '12px 14px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 9 }}>
        <span style={{ fontWeight: 700, fontSize: '.76em', color: line(0.5) }}>
          {new Date(`${game.date}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
          {game.start ? ` · ${game.start}` : ''}
        </span>
        <span style={{ flex: 1 }} />
        {settled ? null : (
          <span style={{ fontWeight: 700, fontSize: '.72em', color: line(0.4) }}>not played yet</span>
        )}
        {parentUnlocked ? (
          <button onClick={onRemove} style={{ ...dangerBtn, padding: '4px 9px', fontSize: '.72em' }}>
            ✕
          </button>
        ) : null}
      </div>

      <div style={{ display: 'flex', gap: 9, alignItems: 'stretch' }}>
        {teamButton(game.away)}
        <span style={{ alignSelf: 'center', fontWeight: 700, fontSize: '.78em', color: line(0.4) }}>@</span>
        {teamButton(game.home)}
      </div>

      {/* Who picked what. Shown always: this is a family game on a wall, not a
          sealed-bid auction. */}
      <div style={{ display: 'flex', gap: 12, marginTop: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        {members.map((m) => {
          const p = pickOf(picks, game.id, m.id)
          if (!p) return null
          const right = settled && p === game.winner
          const wrong = settled && p !== game.winner
          return (
            <span key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: '.76em', fontWeight: 700 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: m.color }} />
              {m.name}
              <span style={{ color: line(0.5) }}>{teamName(p)}</span>
              {right ? <span style={{ color: '#1F8A5B' }}>✓</span> : null}
              {wrong ? <span style={{ color: line(0.35) }}>✗</span> : null}
            </span>
          )
        })}
      </div>

      <div style={{ display: 'flex', gap: 7, marginTop: 10, alignItems: 'center' }}>
        <span style={{ fontWeight: 700, fontSize: '.72em', color: line(0.45) }}>Winner</span>
        {[game.away, game.home].map((code) => (
          <button
            key={code}
            onClick={() => onWinner(game.id, code)}
            style={{
              borderRadius: 999,
              padding: '4px 11px',
              fontWeight: 700,
              fontSize: '.72em',
              cursor: 'pointer',
              background: game.winner === code ? INK : 'transparent',
              color: game.winner === code ? CREAM : line(0.5),
              border: `1.5px solid ${game.winner === code ? INK : line(0.16)}`,
            }}
          >
            {teamName(code)}
          </button>
        ))}
      </div>
    </div>
  )
}

/** The week at a glance — everyone down the side, games across the top. */
function WeekTable({
  slate,
  members,
  picks,
  games,
  season,
  week,
}: {
  slate: ReturnType<typeof gamesForWeek>
  members: { id: string; name: string; color: string }[]
  picks: { gameId: string; memberId: string; team: string }[]
  games: ReturnType<typeof gamesForWeek>
  season: number
  week: number
}) {
  return (
    <div style={{ ...card, padding: '14px 16px' }}>
      <h2 style={{ ...HEADING, fontSize: '1.1em', marginBottom: 10 }}>Week {week} at a glance</h2>
      <div className="scroll-x" style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: '.8em' }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left', padding: '6px 8px', color: line(0.5), fontWeight: 700 }} />
              {slate.map((g) => (
                <th key={g.id} style={{ padding: '6px 8px', color: line(0.5), fontWeight: 700, whiteSpace: 'nowrap' }}>
                  {teamName(g.away)} @ {teamName(g.home)}
                </th>
              ))}
              <th style={{ padding: '6px 8px', color: line(0.5), fontWeight: 700 }}>W</th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => {
              const rec = weekRecord(games, picks, m.id, season, week)
              return (
                <tr key={m.id} style={{ borderTop: `1px solid ${line(0.08)}` }}>
                  <td style={{ padding: '7px 8px', fontWeight: 700, whiteSpace: 'nowrap' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: m.color }} />
                      {m.name}
                    </span>
                  </td>
                  {slate.map((g) => {
                    const p = pickOf(picks, g.id, m.id)
                    const settled = isSettled(g)
                    return (
                      <td key={g.id} style={{ padding: '7px 8px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                        {p ? (
                          <span
                            style={{
                              fontWeight: 700,
                              color: settled ? (p === g.winner ? '#1F8A5B' : line(0.35)) : INK,
                            }}
                          >
                            {p}
                          </span>
                        ) : (
                          <span style={{ color: line(0.2) }}>–</span>
                        )}
                      </td>
                    )
                  })}
                  <td style={{ padding: '7px 8px', textAlign: 'center', fontWeight: 800 }}>
                    {rec.settled ? `${rec.correct}/${rec.settled}` : '–'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/** Parent-only: put a game on the board. */
function AddGame({
  season,
  week,
  weeks,
  onWeek,
}: {
  season: number
  week: number
  weeks: number[]
  onWeek: (w: number) => void
}) {
  const { update, requirePin } = useFamily()
  const [away, setAway] = useState('')
  const [home, setHome] = useState('')
  const [date, setDate] = useState('')
  const [start, setStart] = useState('')
  const [target, setTarget] = useState(String(week))

  const add = () => {
    const wk = Number(target)
    if (!away || !home || !date || away === home || !Number.isFinite(wk) || wk < 1) return
    requirePin(() => {
      update((d) => {
        d.pickem.games.push({
          id: uid(),
          season,
          week: wk,
          away,
          home,
          date,
          start: start || null,
          winner: null,
        })
      })
      setAway('')
      setHome('')
      setStart('')
      onWeek(wk)
    }, 'Adding a game is parent-only')
  }

  const teamSelect = (value: string, onChange: (v: string) => void, placeholder: string) => (
    <select value={value} onChange={(e) => onChange(e.target.value)} style={{ ...input, padding: '10px 12px', fontSize: '.86em' }}>
      <option value="">{placeholder}</option>
      {TEAMS.map((t) => (
        <option key={t.code} value={t.code}>
          {t.city} {t.name}
        </option>
      ))}
    </select>
  )

  return (
    <div style={{ ...card, padding: '14px 16px' }}>
      <h2 style={{ ...HEADING, fontSize: '1.1em', marginBottom: 4 }}>Add a game</h2>
      <p style={{ color: line(0.55), fontWeight: 600, fontSize: '.82em', margin: '0 0 11px' }}>
        Only the games you'll actually watch — the board is the family's slate, not the league's.
      </p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        {teamSelect(away, setAway, 'Away team')}
        <span style={{ fontWeight: 700, color: line(0.4) }}>@</span>
        {teamSelect(home, setHome, 'Home team')}
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
          style={{ ...input, padding: '10px 12px', fontSize: '.86em' }} />
        <input type="time" value={start} onChange={(e) => setStart(e.target.value)}
          style={{ ...input, padding: '10px 12px', fontSize: '.86em' }} />
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700, fontSize: '.82em' }}>
          Week
          <input
            type="number"
            min={1}
            max={23}
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            style={{ ...input, padding: '10px 12px', fontSize: '.86em', width: 74 }}
          />
        </label>
        <button onClick={add} style={primaryBtn}>
          Add game
        </button>
      </div>
      {weeks.length === 0 ? (
        <p style={{ color: line(0.45), fontWeight: 600, fontSize: '.78em', margin: '10px 0 0' }}>
          Nothing on the board yet for the {season} season.
        </p>
      ) : null}
    </div>
  )
}
