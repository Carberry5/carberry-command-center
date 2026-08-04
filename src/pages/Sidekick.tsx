import { useState } from 'react'
import { fmtDate, fmtTime, uid } from '../lib/dates.ts'
import { DANGER, GREEN, HEADING, INK, PURPLE, card, line } from '../lib/theme.ts'
import { useFamily } from '../store/FamilyStore.tsx'
import { CheckBox } from '../components/CheckBox.tsx'
import { Icon, PATHS } from '../components/Icon.tsx'

interface DraftEvent {
  title: string
  date: string
  start: string
  durationMin: number
  members: string[]
  location: string
  selected: boolean
}

interface DraftItem {
  list: string
  text: string
  selected: boolean
}

const SAMPLE =
  "Hi Panther families! Reminder: Cannon's swim team has a meet this Saturday at 8:30am at Claude Moore Park — arrive 20 minutes early. Hadley's soccer picture day moved to next Wednesday at 5:30pm on Field 3. Please send your student with: sunscreen, a water bottle, and a folding chair. The book fair runs Monday–Friday next week; send $10 if you'd like your child to shop."

/** Paste a school email; Claude turns it into events and list items you approve. */
export function SidekickPage() {
  const { update, toast } = useFamily()
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [events, setEvents] = useState<DraftEvent[] | null>(null)
  const [items, setItems] = useState<DraftItem[] | null>(null)

  const run = async () => {
    const text = input.trim()
    if (!text) return
    setBusy(true)
    setError(null)
    setEvents(null)
    setItems(null)
    try {
      const res = await fetch('/api/sidekick', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text }),
      })
      let json: {
        events?: Omit<DraftEvent, 'selected'>[]
        listItems?: Omit<DraftItem, 'selected'>[]
        error?: string
      }
      try {
        json = (await res.json()) as typeof json
      } catch {
        // HTML instead of JSON: a static host with no server behind /api.
        throw new Error('The Sidekick needs its server — run `npm run dev` on the home machine.')
      }
      if (!res.ok) throw new Error(json.error ?? 'Sidekick could not read that.')
      const ev = (json.events ?? []).map((e) => ({ ...e, selected: true }))
      const it = (json.listItems ?? []).map((i) => ({ ...i, selected: true }))
      if (!ev.length && !it.length) {
        throw new Error('Nothing I could turn into events or items — try pasting more detail.')
      }
      setEvents(ev)
      setItems(it)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong — try again.')
    } finally {
      setBusy(false)
    }
  }

  const commit = () => {
    const pickedEvents = (events ?? []).filter((e) => e.selected)
    const pickedItems = (items ?? []).filter((i) => i.selected)

    update((d) => {
      pickedEvents.forEach((e) => {
        const memberIds = e.members
          .map((n) => d.members.find((m) => m.name.toLowerCase() === n.toLowerCase())?.id)
          .filter((x): x is string => !!x)
        d.events.push({
          id: uid(),
          title: e.title,
          date: e.date,
          start: e.start || null,
          dur: e.durationMin || null,
          memberIds,
          loc: e.location ?? '',
          recur: null,
        })
      })
      pickedItems.forEach((i) => {
        const wanted = (i.list || 'To do').toLowerCase()
        let list =
          d.lists.find((l) => l.name.toLowerCase() === wanted) ??
          d.lists.find((l) => l.name.toLowerCase().includes(wanted.split(' ')[0]))
        if (!list) {
          list = { id: uid(), name: i.list || 'To do', items: [] }
          d.lists.push(list)
        }
        list.items.push({ id: uid(), text: i.text, done: false, by: 'e' })
      })
    })

    toast(
      `Added ${pickedEvents.length} event${pickedEvents.length === 1 ? '' : 's'} and ` +
        `${pickedItems.length} list item${pickedItems.length === 1 ? '' : 's'}`
    )
    setEvents(null)
    setItems(null)
    setInput('')
  }

  const selectedCount =
    (events ?? []).filter((e) => e.selected).length + (items ?? []).filter((i) => i.selected).length
  const hasOutput = !!events || !!items

  return (
    <section style={{ animation: 'fadeUp .35s ease both', maxWidth: 860 }}>
      <div style={{ ...card, padding: '20px 22px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <Icon d={PATHS.sparkle} size={24} color={GREEN} />
          <h2 style={{ ...HEADING, fontSize: '1.25em' }}>Sidekick</h2>
          <div style={{ flex: 1 }} />
          <button
            onClick={() => setInput(SAMPLE)}
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
            Try a sample
          </button>
        </div>
        <div style={{ color: line(0.6), fontWeight: 600, fontSize: '.9em', marginBottom: 12 }}>
          Paste a school email, camp schedule, or team text — Sidekick turns it into events and list
          items you can approve.
        </div>

        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          rows={7}
          placeholder="Paste anything here…"
          style={{
            width: '100%',
            background: '#FFF',
            border: `1.5px solid ${line(0.16)}`,
            borderRadius: 16,
            padding: '14px 16px',
            fontSize: '.95em',
            fontWeight: 600,
            color: INK,
            outlineColor: PURPLE,
            resize: 'vertical',
            lineHeight: 1.5,
            fontFamily: 'inherit',
          }}
        />

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12 }}>
          <button
            onClick={() => void run()}
            disabled={!input.trim() || busy}
            style={{
              background: INK,
              color: '#F7F9FF',
              border: 'none',
              borderRadius: 999,
              padding: '12px 24px',
              fontWeight: 700,
              cursor: 'pointer',
              fontSize: '.95em',
              opacity: input.trim() && !busy ? 1 : 0.5,
            }}
          >
            Read it ✦
          </button>
          {busy ? (
            <>
              <div
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: '50%',
                  border: `3px solid ${line(0.15)}`,
                  borderTopColor: GREEN,
                  animation: 'spin .8s linear infinite',
                }}
              />
              <span style={{ fontWeight: 600, color: line(0.6), fontSize: '.9em' }}>Reading…</span>
            </>
          ) : null}
          {error ? <span style={{ fontWeight: 600, color: DANGER, fontSize: '.9em' }}>{error}</span> : null}
        </div>
      </div>

      {hasOutput ? (
        <div
          style={{
            ...card,
            border: `1.5px solid rgba(124,92,224,.5)`,
            padding: '20px 22px',
            marginTop: 16,
            animation: 'fadeUp .3s ease both',
          }}
        >
          <h3 style={{ ...HEADING, fontSize: '1.1em', margin: '0 0 10px' }}>
            Here's what I found — uncheck anything you don't want:
          </h3>

          {(events ?? []).map((e, i) => (
            <div
              key={`e${i}`}
              onClick={() =>
                setEvents((prev) => prev!.map((x, j) => (j === i ? { ...x, selected: !x.selected } : x)))
              }
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 11,
                padding: '9px 6px',
                borderBottom: `1px solid ${line(0.07)}`,
                cursor: 'pointer',
              }}
            >
              <CheckBox on={e.selected} />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: '.95em' }}>{e.title}</div>
                <div style={{ color: line(0.55), fontWeight: 600, fontSize: '.8em' }}>
                  {fmtDate(e.date)}
                  {e.start ? ` · ${fmtTime(e.start)}` : ''}
                  {e.members.length ? ` · ${e.members.join(', ')}` : ' · Everyone'}
                  {e.location ? ` · ${e.location}` : ''}
                </div>
              </div>
              <span
                style={{
                  fontWeight: 700,
                  fontSize: '.72em',
                  color: '#3D6DE8',
                  background: 'rgba(61,109,232,.1)',
                  borderRadius: 999,
                  padding: '3px 10px',
                }}
              >
                event
              </span>
            </div>
          ))}

          {(items ?? []).map((it, i) => (
            <div
              key={`i${i}`}
              onClick={() =>
                setItems((prev) => prev!.map((x, j) => (j === i ? { ...x, selected: !x.selected } : x)))
              }
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 11,
                padding: '9px 6px',
                borderBottom: `1px solid ${line(0.07)}`,
                cursor: 'pointer',
              }}
            >
              <CheckBox on={it.selected} />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: '.95em' }}>{it.text}</div>
                <div style={{ color: line(0.55), fontWeight: 600, fontSize: '.8em' }}>
                  to “{it.list || 'To do'}”
                </div>
              </div>
              <span
                style={{
                  fontWeight: 700,
                  fontSize: '.72em',
                  color: '#7A4DBB',
                  background: 'rgba(138,99,201,.12)',
                  borderRadius: 999,
                  padding: '3px 10px',
                }}
              >
                list item
              </span>
            </div>
          ))}

          <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
            <button
              onClick={commit}
              style={{
                background: INK,
                color: '#F7F9FF',
                border: 'none',
                borderRadius: 999,
                padding: '12px 22px',
                fontWeight: 700,
                cursor: 'pointer',
                fontSize: '.95em',
              }}
            >
              Add {selectedCount} selected
            </button>
            <button
              onClick={() => {
                setEvents(null)
                setItems(null)
              }}
              style={{
                border: `1px solid ${line(0.16)}`,
                background: '#F7F9FF',
                borderRadius: 999,
                padding: '12px 18px',
                fontWeight: 700,
                cursor: 'pointer',
                fontSize: '.9em',
                color: INK,
              }}
            >
              Discard
            </button>
          </div>
        </div>
      ) : null}
    </section>
  )
}
