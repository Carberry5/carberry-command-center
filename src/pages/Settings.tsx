import { useEffect, useState } from 'react'
import type { PreflightKid } from '../types.ts'
import { uid } from '../lib/dates.ts'
import { kidConfig } from '../lib/preflight.ts'
import { geocode } from '../lib/weather.ts'
import {
  CREAM,
  DANGER,
  HEADING,
  INK,
  PURPLE,
  SWATCHES,
  card,
  chip,
  dayChip,
  line,
} from '../lib/theme.ts'
import { useFamily } from '../store/FamilyStore.tsx'
import { revealSecret, syncFeedOnServer } from '../store/sync.ts'

const WEEKDAYS = [1, 2, 3, 4, 5]
const WEEKDAY_LABELS = ['M', 'T', 'W', 'T', 'F']

const smallInput = {
  background: '#FFF',
  border: `1.5px solid ${line(0.14)}`,
  borderRadius: 10,
  padding: '8px 11px',
  fontWeight: 700,
  fontSize: '.9em',
  color: INK,
  outlineColor: PURPLE,
  fontFamily: 'inherit',
} as const

const primary = {
  background: INK,
  color: CREAM,
  border: 'none',
  borderRadius: 999,
  padding: '10px 18px',
  fontWeight: 700,
  cursor: 'pointer',
  fontSize: '.85em',
} as const

/** Everything parent-only: the family, pre-flight setup, feeds, PIN, secrets, display. */
export function SettingsPage() {
  const { data, update, toast, prefs, setPrefs, mode, householdId, resetDemoData, reloadWeather } = useFamily()

  const [zipMsg, setZipMsg] = useState('')
  const [newPin, setNewPin] = useState('')
  const [bringDraft, setBringDraft] = useState<Record<string, string>>({})
  const [linkDraft, setLinkDraft] = useState<Record<string, { label: string; url: string }>>({})

  const kids = data.members.filter((m) => m.role === 'kid')

  const lookUpPlace = async () => {
    setZipMsg('Looking up…')
    const result = await geocode(data.settings.zip)
    if (!result) {
      setZipMsg('Not found — try a city name')
      return
    }
    update((d) => {
      d.settings.lat = result.lat
      d.settings.lon = result.lon
      d.settings.place = result.place
    })
    setZipMsg(`Now showing ${result.name}`)
    reloadWeather()
  }

  const editKidConfig = (kidId: string, fn: (cfg: PreflightKid) => void) =>
    update((d) => {
      d.preflight.kids[kidId] = d.preflight.kids[kidId] ?? { gym: [], lun: [], bring: [] }
      fn(d.preflight.kids[kidId])
    })

  const toggleDay = (kidId: string, field: 'gym' | 'lun', day: number) =>
    editKidConfig(kidId, (cfg) => {
      cfg[field] = cfg[field].includes(day) ? cfg[field].filter((x) => x !== day) : [...cfg[field], day]
    })

  return (
    <section style={{ animation: 'fadeUp .35s ease both', maxWidth: 900, display: 'grid', gap: 16 }}>
      {/* Family */}
      <div style={{ ...card, padding: '20px 22px' }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
          <h2 style={{ ...HEADING, fontSize: '1.2em' }}>Family</h2>
          <div style={{ flex: 1 }} />
          <button
            onClick={() =>
              update((d) => {
                d.members.push({ id: uid(), name: 'New member', role: 'kid', color: '#2E9E6B', links: [] })
              })
            }
            style={{ ...primary, padding: '9px 15px', fontSize: '.82em' }}
          >
            + Member
          </button>
        </div>

        {data.members.map((m) => (
          <div
            key={m.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '8px 0',
              borderBottom: `1px solid ${line(0.07)}`,
              flexWrap: 'wrap',
            }}
          >
            <div
              style={{
                width: 34,
                height: 34,
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: CREAM,
                fontFamily: "'Outfit', sans-serif",
                fontWeight: 600,
                background: m.color,
              }}
            >
              {m.name[0] ?? '?'}
            </div>
            <input
              value={m.name}
              onChange={(e) =>
                update((d) => {
                  const target = d.members.find((x) => x.id === m.id)
                  if (target) target.name = e.target.value
                })
              }
              style={{ ...smallInput, flex: 1, minWidth: 130 }}
            />
            <button
              onClick={() =>
                update((d) => {
                  const target = d.members.find((x) => x.id === m.id)
                  if (target) target.role = target.role === 'parent' ? 'kid' : 'parent'
                })
              }
              style={{
                border: `1px solid ${line(0.16)}`,
                background: '#F7F9FF',
                borderRadius: 999,
                padding: '8px 13px',
                fontWeight: 700,
                cursor: 'pointer',
                fontSize: '.78em',
                color: INK,
              }}
            >
              {m.role === 'parent' ? 'Parent' : 'Kid'}
            </button>
            <div style={{ display: 'flex', gap: 5 }}>
              {SWATCHES.map((c) => (
                <button
                  key={c}
                  onClick={() =>
                    update((d) => {
                      const target = d.members.find((x) => x.id === m.id)
                      if (target) target.color = c
                    })
                  }
                  style={{
                    width: 26,
                    height: 26,
                    borderRadius: '50%',
                    cursor: 'pointer',
                    background: c,
                    border: `2.5px solid ${m.color === c ? INK : 'transparent'}`,
                  }}
                />
              ))}
            </div>
            <button
              onClick={() =>
                update((d) => {
                  d.members = d.members.filter((x) => x.id !== m.id)
                })
              }
              style={{
                border: 'none',
                background: 'rgba(217,91,67,.1)',
                color: DANGER,
                borderRadius: 10,
                padding: '8px 12px',
                fontWeight: 700,
                cursor: 'pointer',
                fontSize: '.8em',
              }}
            >
              Remove
            </button>

            {/* Shortcuts shown on this member's page — school portals and the
                like. Just links; whatever is behind them handles its own login. */}
            <div style={{ flexBasis: '100%', display: 'flex', gap: 6, flexWrap: 'wrap', paddingLeft: 44 }}>
              {(m.links ?? []).map((l) => (
                <span
                  key={l.id}
                  title={l.url}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    borderRadius: 999,
                    padding: '5px 8px 5px 12px',
                    fontWeight: 700,
                    fontSize: '.76em',
                    background: 'rgba(35,42,61,.05)',
                  }}
                >
                  {l.label}
                  <button
                    onClick={() =>
                      update((d) => {
                        const t = d.members.find((x) => x.id === m.id)
                        if (t) t.links = (t.links ?? []).filter((x) => x.id !== l.id)
                      })
                    }
                    aria-label={`Remove ${l.label}`}
                    style={{
                      border: 'none',
                      background: 'none',
                      cursor: 'pointer',
                      color: line(0.5),
                      fontWeight: 700,
                      padding: '0 2px',
                    }}
                  >
                    ✕
                  </button>
                </span>
              ))}
              <input
                value={linkDraft[m.id]?.label ?? ''}
                onChange={(e) =>
                  setLinkDraft((p) => ({ ...p, [m.id]: { ...(p[m.id] ?? { label: '', url: '' }), label: e.target.value } }))
                }
                placeholder="Link name"
                style={{ ...smallInput, width: 120, fontSize: '.8em', padding: '6px 9px' }}
              />
              <input
                value={linkDraft[m.id]?.url ?? ''}
                onChange={(e) =>
                  setLinkDraft((p) => ({ ...p, [m.id]: { ...(p[m.id] ?? { label: '', url: '' }), url: e.target.value } }))
                }
                placeholder="https://…"
                style={{ ...smallInput, flex: 1, minWidth: 180, fontSize: '.8em', padding: '6px 9px' }}
              />
              <button
                onClick={() => {
                  const draft = linkDraft[m.id]
                  const url = draft?.url?.trim()
                  if (!url) return
                  update((d) => {
                    const t = d.members.find((x) => x.id === m.id)
                    if (!t) return
                    t.links = [
                      ...(t.links ?? []),
                      { id: uid(), label: draft.label.trim() || new URL(url, 'https://x').hostname, url },
                    ]
                  })
                  setLinkDraft((p) => ({ ...p, [m.id]: { label: '', url: '' } }))
                }}
                style={{ ...primary, padding: '6px 12px', fontSize: '.78em' }}
              >
                + Link
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* School pre-flight */}
      <div style={{ ...card, padding: '20px 22px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <h2 style={{ ...HEADING, fontSize: '1.2em' }}>School pre-flight</h2>
          <div style={{ flex: 1 }} />
          <button
            onClick={() =>
              update((d) => {
                d.preflight.open = !d.preflight.open
              })
            }
            style={chip(data.preflight.open)}
          >
            {data.preflight.open ? 'School is in session' : 'School is out'}
          </button>
        </div>
        <div style={{ color: line(0.58), fontWeight: 600, fontSize: '.85em', margin: '4px 0 6px' }}>
          Shows every school morning, Monday–Friday. Set gym-uniform days, packed-lunch days, and
          bring-along items for each kid.
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0 2px', flexWrap: 'wrap' }}>
          <div style={{ fontWeight: 700, fontSize: '.9em' }}>Departure time</div>
          <input
            type="time"
            value={data.preflight.depart ?? '07:30'}
            onChange={(e) =>
              update((d) => {
                d.preflight.depart = e.target.value || '07:30'
              })
            }
            style={{
              border: `1.5px solid ${line(0.16)}`,
              borderRadius: 10,
              padding: '7px 10px',
              font: 'inherit',
              fontWeight: 700,
              color: INK,
              background: '#FCFCFE',
            }}
          />
          <div style={{ fontWeight: 600, fontSize: '.78em', color: line(0.5) }}>
            Shown on the pre-flight card
          </div>
        </div>

        {kids.map((k) => {
          const cfg = kidConfig(data.preflight, k.id)
          return (
            <div key={k.id} style={{ borderTop: `1px solid ${line(0.08)}`, padding: '12px 0 4px', marginTop: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 9 }}>
                <div
                  style={{
                    width: 30,
                    height: 30,
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: CREAM,
                    fontFamily: "'Outfit', sans-serif",
                    fontWeight: 600,
                    fontSize: '.9em',
                    background: k.color,
                  }}
                >
                  {k.name[0]}
                </div>
                <div style={{ fontWeight: 700 }}>{k.name}</div>
              </div>

              <div style={{ display: 'flex', gap: 26, flexWrap: 'wrap' }}>
                {(
                  [
                    ['gym', 'GYM UNIFORM DAYS'],
                    ['lun', 'PACK LUNCH DAYS'],
                  ] as const
                ).map(([field, label]) => (
                  <div key={field}>
                    <div
                      style={{
                        fontWeight: 700,
                        fontSize: '.72em',
                        letterSpacing: '.07em',
                        color: line(0.5),
                        marginBottom: 5,
                      }}
                    >
                      {label}
                    </div>
                    <div style={{ display: 'flex', gap: 5 }}>
                      {WEEKDAYS.map((day, i) => (
                        <button
                          key={day}
                          onClick={() => toggleDay(k.id, field, day)}
                          style={dayChip(cfg[field].includes(day))}
                        >
                          {WEEKDAY_LABELS[i]}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              <div style={{ marginTop: 11 }}>
                <div
                  style={{
                    fontWeight: 700,
                    fontSize: '.72em',
                    letterSpacing: '.07em',
                    color: line(0.5),
                    marginBottom: 5,
                  }}
                >
                  BRING ALONG
                </div>
                {cfg.bring.map((b) => (
                  <div
                    key={b.id}
                    style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '5px 0', flexWrap: 'wrap' }}
                  >
                    <div style={{ fontWeight: 700, fontSize: '.88em', minWidth: 130 }}>{b.text}</div>
                    <div style={{ display: 'flex', gap: 4 }}>
                      {WEEKDAYS.map((day, i) => (
                        <button
                          key={day}
                          onClick={() =>
                            editKidConfig(k.id, (c) => {
                              const item = c.bring.find((x) => x.id === b.id)
                              if (!item) return
                              item.days = item.days.includes(day)
                                ? item.days.filter((x) => x !== day)
                                : [...item.days, day]
                            })
                          }
                          style={dayChip(b.days.includes(day), true)}
                        >
                          {WEEKDAY_LABELS[i]}
                        </button>
                      ))}
                    </div>
                    <button
                      onClick={() =>
                        editKidConfig(k.id, (c) => {
                          c.bring = c.bring.filter((x) => x.id !== b.id)
                        })
                      }
                      style={{
                        border: 'none',
                        background: 'rgba(217,91,67,.1)',
                        color: DANGER,
                        borderRadius: 8,
                        padding: '6px 10px',
                        fontWeight: 700,
                        cursor: 'pointer',
                        fontSize: '.75em',
                      }}
                    >
                      ✕
                    </button>
                  </div>
                ))}

                <div style={{ display: 'flex', gap: 7, marginTop: 5 }}>
                  <input
                    value={bringDraft[k.id] ?? ''}
                    onChange={(e) => setBringDraft((prev) => ({ ...prev, [k.id]: e.target.value }))}
                    placeholder="e.g. Library book"
                    style={{ ...smallInput, flex: 1, maxWidth: 260, fontSize: '.85em' }}
                  />
                  <button
                    onClick={() => {
                      const text = (bringDraft[k.id] ?? '').trim()
                      if (!text) return
                      const today = new Date().getDay()
                      const day = Math.min(5, Math.max(1, today))
                      editKidConfig(k.id, (c) => {
                        c.bring.push({ id: uid(), text, days: [day] })
                      })
                      setBringDraft((prev) => ({ ...prev, [k.id]: '' }))
                    }}
                    style={{ ...primary, borderRadius: 10, padding: '8px 13px', fontSize: '.8em' }}
                  >
                    Add
                  </button>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Weather */}
      <div style={{ ...card, padding: '20px 22px' }}>
        <h2 style={{ ...HEADING, fontSize: '1.2em', margin: '0 0 10px' }}>Weather location</h2>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            value={data.settings.zip}
            onChange={(e) =>
              update((d) => {
                d.settings.zip = e.target.value
              })
            }
            placeholder="ZIP or city"
            style={{ ...smallInput, borderRadius: 12, padding: '10px 13px', width: 160, fontSize: '.92em' }}
          />
          <button onClick={() => void lookUpPlace()} style={primary}>
            Update
          </button>
          <span style={{ fontWeight: 600, color: line(0.6), fontSize: '.9em' }}>
            {zipMsg || data.settings.place}
          </span>
        </div>
      </div>

      <FeedsCard />

      <SecretsCard />

      {/* Display */}
      <div style={{ ...card, padding: '20px 22px' }}>
        <h2 style={{ ...HEADING, fontSize: '1.2em', margin: '0 0 4px' }}>Display</h2>
        <div style={{ color: line(0.58), fontWeight: 600, fontSize: '.85em', marginBottom: 12 }}>
          Per-device — the TV can run big type while the iPad stays compact.
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={() => setPrefs({ tvMode: !prefs.tvMode })} style={chip(prefs.tvMode)}>
            TV mode
          </button>
          <button onClick={() => setPrefs({ showWeather: !prefs.showWeather })} style={chip(prefs.showWeather)}>
            Show weather
          </button>
          <button
            onClick={() => setPrefs({ weekStartMonday: !prefs.weekStartMonday })}
            style={chip(prefs.weekStartMonday)}
          >
            Weeks start Monday
          </button>
        </div>
      </div>

      {/* PIN + storage */}
      <div style={{ ...card, padding: '20px 22px', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <h2 style={{ ...HEADING, fontSize: '1.2em' }}>Parent PIN</h2>
          <div style={{ color: line(0.58), fontWeight: 600, fontSize: '.85em' }}>
            Guards settings, redemptions, edits &amp; deletes.
          </div>
        </div>
        <input
          value={newPin}
          onChange={(e) => setNewPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
          placeholder="New 4-digit PIN"
          maxLength={4}
          style={{ ...smallInput, borderRadius: 12, padding: '10px 13px', width: 150, fontSize: '.92em' }}
        />
        <button
          onClick={() => {
            if (newPin.length !== 4) {
              toast('PIN must be 4 digits')
              return
            }
            update((d) => {
              d.settings.pin = newPin
            })
            setNewPin('')
            toast('PIN updated')
          }}
          style={primary}
        >
          Save PIN
        </button>
        <button
          onClick={resetDemoData}
          style={{
            border: `1.5px solid rgba(217,91,67,.4)`,
            background: 'none',
            color: DANGER,
            borderRadius: 999,
            padding: '10px 18px',
            fontWeight: 700,
            cursor: 'pointer',
            fontSize: '.85em',
          }}
        >
          Reset demo data
        </button>
      </div>

      {/* Where the data lives */}
      <div style={{ ...card, padding: '20px 22px' }}>
        <h2 style={{ ...HEADING, fontSize: '1.2em', margin: '0 0 6px' }}>Storage</h2>
        {mode === 'cloud' ? (
          <div style={{ fontWeight: 600, fontSize: '.9em', color: line(0.7) }}>
            Syncing with the{' '}
            <code style={{ background: 'rgba(35,42,61,.06)', padding: '2px 6px', borderRadius: 6 }}>
              {householdId}
            </code>{' '}
            household. Changes appear on every signed-in device within a second.
          </div>
        ) : mode === 'connecting' ? (
          <div style={{ fontWeight: 600, fontSize: '.9em', color: line(0.7) }}>Connecting…</div>
        ) : (
          <div style={{ fontWeight: 600, fontSize: '.9em', color: line(0.7) }}>
            This device is saving to its own browser storage and not syncing. Sign in to join the
            family's data.
          </div>
        )}
      </div>
    </section>
  )
}

/**
 * ICS feeds. Fetching them is a server's job: calendar providers do not send
 * CORS headers, so a browser cannot read a school or Google calendar at any
 * price. In development a local sidecar does it; in production the scheduled
 * GitHub Action does, writing into feed_events.
 */
function FeedsCard() {
  const { data, update, toast, serverOk, mode } = useFamily()
  const [draft, setDraft] = useState({ name: '', url: '' })

  const sync = async (id: string, name: string) => {
    if (serverOk) {
      update((d) => {
        const feed = d.settings.feeds.find((f) => f.id === id)
        if (feed) feed.status = 'Syncing…'
      })
      const result = await syncFeedOnServer(id)
      if (result.error) {
        update((d) => {
          const feed = d.settings.feeds.find((f) => f.id === id)
          if (feed) feed.status = result.error!
        })
        toast(`Could not sync ${name}`)
      } else {
        toast(`Synced ${result.count} events from ${name}`)
      }
      return
    }

    // No server on this origin. This used to attempt the fetch from the browser
    // anyway and, on the inevitable CORS failure, tell the family to "start the
    // sidecar" — advice that has been wrong since the move off the vault, and
    // that names a thing they do not have.
    //
    // Worse, it was wrong when it *worked*: a successful browser fetch wrote
    // into feedEv, which fromRows rebuilds from the feed_events table, so the
    // events disappeared again at the next snapshot. Better to be honest that
    // this button cannot do the job than to appear to and then undo it.
    if (mode === 'cloud') {
      toast(`${name} syncs on a schedule — next run within 3 hours`)
      return
    }
    toast(`${name} needs a server to fetch it — run the app with npm run dev`)
  }

  return (
    <div style={{ ...card, padding: '20px 22px' }}>
      <h2 style={{ ...HEADING, fontSize: '1.2em', margin: '0 0 4px' }}>Calendar feeds</h2>
      <div style={{ color: line(0.58), fontWeight: 600, fontSize: '.85em', marginBottom: 12 }}>
        Read-only ICS links (Google, Apple, Outlook, school). Fetched for you every few hours by a
        scheduled job, because calendar providers refuse browser requests — nothing on this page
        could load them directly.
      </div>

      {data.settings.feeds.map((f) => (
        <div
          key={f.id}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '8px 0',
            borderBottom: `1px solid ${line(0.07)}`,
            flexWrap: 'wrap',
          }}
        >
          <span style={{ width: 12, height: 12, borderRadius: '50%', background: f.color }} />
          <div style={{ flex: 1, minWidth: 150 }}>
            <div style={{ fontWeight: 700, fontSize: '.92em' }}>{f.name}</div>
            <div
              style={{
                color: line(0.5),
                fontWeight: 600,
                fontSize: '.78em',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                maxWidth: 420,
              }}
            >
              {f.opRef ? `1Password · ${f.opRef}` : f.url}
            </div>
            {/* Who this feed belongs to. None selected = the whole family, which
                is how an events-with-no-members row already behaves elsewhere. */}
            <div style={{ display: 'flex', gap: 5, marginTop: 7, alignItems: 'center' }}>
              <span style={{ fontSize: '.72em', fontWeight: 700, color: line(0.5) }}>
                {f.memberIds?.length ? 'For' : 'Everyone'}
              </span>
              {data.members.map((m) => {
                const on = (f.memberIds ?? []).includes(m.id)
                return (
                  <button
                    key={m.id}
                    type="button"
                    title={m.name}
                    aria-pressed={on}
                    onClick={() =>
                      update((d) => {
                        const feed = d.settings.feeds.find((x) => x.id === f.id)
                        if (!feed) return
                        const ids = feed.memberIds ?? []
                        feed.memberIds = ids.includes(m.id)
                          ? ids.filter((x) => x !== m.id)
                          : [...ids, m.id]
                      })
                    }
                    style={{
                      width: 24,
                      height: 24,
                      borderRadius: '50%',
                      cursor: 'pointer',
                      fontWeight: 700,
                      fontSize: '.66em',
                      fontFamily: "'Outfit', sans-serif",
                      background: on ? m.color : 'transparent',
                      color: on ? '#F7F9FF' : line(0.5),
                      border: on ? 'none' : `1.5px solid ${line(0.2)}`,
                      padding: 0,
                    }}
                  >
                    {m.name[0]}
                  </button>
                )
              })}
            </div>
          </div>
          <span style={{ fontWeight: 600, fontSize: '.78em', color: line(0.55) }}>{f.status}</span>
          <button
            onClick={() => void sync(f.id, f.name)}
            style={{
              border: `1px solid ${line(0.16)}`,
              background: '#F7F9FF',
              borderRadius: 999,
              padding: '8px 14px',
              fontWeight: 700,
              cursor: 'pointer',
              fontSize: '.8em',
              color: INK,
            }}
          >
            Sync
          </button>
          <button
            onClick={() =>
              update((d) => {
                d.settings.feeds = d.settings.feeds.filter((x) => x.id !== f.id)
                delete d.feedEv[f.id]
              })
            }
            style={{
              border: 'none',
              background: 'rgba(217,91,67,.1)',
              color: DANGER,
              borderRadius: 999,
              padding: '8px 12px',
              fontWeight: 700,
              cursor: 'pointer',
              fontSize: '.8em',
            }}
          >
            ✕
          </button>
        </div>
      ))}

      <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
        <input
          value={draft.name}
          onChange={(e) => setDraft((p) => ({ ...p, name: e.target.value }))}
          placeholder="Feed name"
          style={{ ...smallInput, borderRadius: 12, padding: '10px 13px', width: 170, fontSize: '.88em' }}
        />
        <input
          value={draft.url}
          onChange={(e) => setDraft((p) => ({ ...p, url: e.target.value }))}
          placeholder="https://…/calendar.ics  or  op://Family/School/url"
          style={{
            ...smallInput,
            borderRadius: 12,
            padding: '10px 13px',
            flex: 1,
            minWidth: 220,
            fontWeight: 600,
            fontSize: '.88em',
          }}
        />
        <button
          onClick={() => {
            const url = draft.url.trim()
            if (!url) return
            const isOpRef = url.startsWith('op://')
            update((d) => {
              d.settings.feeds.push({
                id: uid(),
                name: draft.name.trim() || 'Calendar feed',
                url: isOpRef ? '' : url,
                ...(isOpRef ? { opRef: url } : {}),
                color: '#5B8DEF',
                status: 'Not synced yet',
                // Whole family until someone tags it.
                memberIds: [],
              })
            })
            setDraft({ name: '', url: '' })
          }}
          style={primary}
        >
          Add feed
        </button>
      </div>
    </div>
  )
}

/**
 * Family reference secrets. Only the `op://` reference is stored — the value is
 * fetched from 1Password on demand, behind the parent PIN, and never persisted.
 */
function SecretsCard() {
  const { data, update, toast, serverOk } = useFamily()
  const [draft, setDraft] = useState({ label: '', ref: '', note: '' })
  const [revealed, setRevealed] = useState<Record<string, string>>({})
  const [pin, setPin] = useState('')
  const [cliReady, setCliReady] = useState<boolean | null>(null)

  useEffect(() => {
    if (!serverOk) return
    void fetch('/api/health')
      .then((r) => r.json())
      .then((h: { onePassword?: boolean }) => setCliReady(!!h.onePassword))
      .catch(() => setCliReady(false))
  }, [serverOk])

  const reveal = async (id: string) => {
    if (pin.length !== 4) {
      toast('Enter the parent PIN to reveal')
      return
    }
    const result = await revealSecret(id, pin)
    if (result.error || !result.value) {
      toast(result.error ?? 'Could not read that item')
      return
    }
    setRevealed((prev) => ({ ...prev, [id]: result.value! }))
    // Auto-hide so a revealed password doesn't sit on a kitchen display.
    window.setTimeout(() => setRevealed((prev) => {
      const next = { ...prev }
      delete next[id]
      return next
    }), 30000)
  }

  return (
    <div style={{ ...card, padding: '20px 22px' }}>
      <h2 style={{ ...HEADING, fontSize: '1.2em', margin: '0 0 4px' }}>Family vault (1Password)</h2>
      <div style={{ color: line(0.58), fontWeight: 600, fontSize: '.85em', marginBottom: 12 }}>
        School portals, activity logins, emergency info. Only the reference is stored here — the
        value is read from 1Password when you tap Reveal, and hides again after 30 seconds.
      </div>

      {cliReady === false ? (
        <div
          style={{
            fontWeight: 600,
            fontSize: '.85em',
            color: '#8A5A1E',
            background: 'rgba(226,146,74,.15)',
            borderRadius: 12,
            padding: '10px 14px',
            marginBottom: 12,
          }}
        >
          The 1Password CLI (<code>op</code>) isn't available to the sidecar. Install it and run{' '}
          <code>op signin</code> to reveal values.
        </div>
      ) : null}

      {data.secrets.map((s) => (
        <div
          key={s.id}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '8px 0',
            borderBottom: `1px solid ${line(0.07)}`,
            flexWrap: 'wrap',
          }}
        >
          <div style={{ flex: 1, minWidth: 160 }}>
            <div style={{ fontWeight: 700, fontSize: '.92em' }}>{s.label}</div>
            <div
              style={{
                color: line(0.5),
                fontWeight: 600,
                fontSize: '.78em',
                fontFamily: 'ui-monospace, monospace',
              }}
            >
              {revealed[s.id] ?? s.ref}
            </div>
            {s.note ? (
              <div style={{ color: line(0.45), fontWeight: 600, fontSize: '.75em' }}>{s.note}</div>
            ) : null}
          </div>
          <button
            onClick={() => void reveal(s.id)}
            style={{
              border: `1px solid ${line(0.16)}`,
              background: '#F7F9FF',
              borderRadius: 999,
              padding: '8px 14px',
              fontWeight: 700,
              cursor: 'pointer',
              fontSize: '.8em',
              color: INK,
            }}
          >
            {revealed[s.id] ? 'Showing' : 'Reveal'}
          </button>
          <button
            onClick={() =>
              update((d) => {
                d.secrets = d.secrets.filter((x) => x.id !== s.id)
              })
            }
            style={{
              border: 'none',
              background: 'rgba(217,91,67,.1)',
              color: DANGER,
              borderRadius: 999,
              padding: '8px 12px',
              fontWeight: 700,
              cursor: 'pointer',
              fontSize: '.8em',
            }}
          >
            ✕
          </button>
        </div>
      ))}

      <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
        <input
          value={draft.label}
          onChange={(e) => setDraft((p) => ({ ...p, label: e.target.value }))}
          placeholder="What it is"
          style={{ ...smallInput, borderRadius: 12, padding: '10px 13px', width: 170, fontSize: '.88em' }}
        />
        <input
          value={draft.ref}
          onChange={(e) => setDraft((p) => ({ ...p, ref: e.target.value }))}
          placeholder="op://Family/LCPS ParentVUE/password"
          style={{
            ...smallInput,
            borderRadius: 12,
            padding: '10px 13px',
            flex: 1,
            minWidth: 240,
            fontWeight: 600,
            fontSize: '.88em',
          }}
        />
        <button
          onClick={() => {
            const ref = draft.ref.trim()
            if (!ref.startsWith('op://')) {
              toast('References look like op://Vault/Item/field')
              return
            }
            update((d) => {
              d.secrets.push({
                id: uid(),
                label: draft.label.trim() || 'Secret',
                ref,
                ...(draft.note.trim() ? { note: draft.note.trim() } : {}),
              })
            })
            setDraft({ label: '', ref: '', note: '' })
          }}
          style={primary}
        >
          Add
        </button>
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
          placeholder="PIN"
          maxLength={4}
          type="password"
          style={{ ...smallInput, borderRadius: 12, padding: '10px 13px', width: 90 }}
        />
        <span style={{ fontWeight: 600, fontSize: '.8em', color: line(0.5) }}>
          The sidecar checks this PIN before it reads anything from 1Password.
        </span>
      </div>
    </div>
  )
}
