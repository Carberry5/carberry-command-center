import { useMemo, useState } from 'react'
import type { Deal, SavingsStoreId, Staple } from '../types.ts'
import { addDays, fmtDate, today, uid } from '../lib/dates.ts'
import { SAVINGS_STORES, activeDeals, storeById } from '../lib/savings.ts'
import { savingsRequest } from '../lib/savingsApi.ts'
import { DANGER, GREEN, HEADING, INK, PURPLE, card, input, line, primaryBtn, quietBtn } from '../lib/theme.ts'
import { useFamily } from '../store/FamilyStore.tsx'
import { CheckBox } from '../components/CheckBox.tsx'
import { Icon, PATHS } from '../components/Icon.tsx'

interface DraftPick {
  store: SavingsStoreId
  item: string
  note: string
  selected: boolean
}

interface DraftDinner {
  date: string
  meal: string
  note: string
  /** What's currently planned that night — '' when the night is open. */
  replaces: string
  selected: boolean
}

/** "2026-08-05" → "Aug 5" — tight enough for a status line. */
const monthDay = (ds: string) => fmtDate(ds).replace(/^\w+, /, '')

/**
 * The grocery savings module: before the weekly shop, line the stores' current
 * deals up against what the family actually buys, and build the week's spend
 * around the best of them.
 */
export function SavingsPage() {
  const { data, update, toast } = useFamily()
  const sv = data.savings
  const td = today()

  const [pasteFor, setPasteFor] = useState<SavingsStoreId | null>(null)
  const [pasteText, setPasteText] = useState('')
  const [busyStore, setBusyStore] = useState<SavingsStoreId | null>(null)
  const [storeError, setStoreError] = useState<string | null>(null)
  const [planBusy, setPlanBusy] = useState(false)
  const [planError, setPlanError] = useState<string | null>(null)
  const [picks, setPicks] = useState<DraftPick[] | null>(null)
  const [draftDinners, setDraftDinners] = useState<DraftDinner[] | null>(null)
  const [showUnmatched, setShowUnmatched] = useState(false)
  const [newStaple, setNewStaple] = useState('')
  const [newCategory, setNewCategory] = useState('')

  const deals = useMemo(() => activeDeals(sv.deals, td), [sv.deals, td])
  const stapleById = useMemo(() => new Map(sv.staples.map((s) => [s.id, s])), [sv.staples])
  const matched = deals.filter((d) => d.stapleId && stapleById.has(d.stapleId))
  const unmatched = deals.filter((d) => !d.stapleId || !stapleById.has(d.stapleId))

  /** First parent claims savings-added items, so the list shows who queued them. */
  const parentId = data.members.find((m) => m.role === 'parent')?.id ?? data.members[0]?.id ?? ''

  const addToGroceries = (text: string) => {
    update((d) => {
      let list = d.lists.find((l) => l.name.toLowerCase() === 'groceries')
      if (!list) {
        list = { id: uid(), name: 'Groceries', items: [] }
        d.lists.push(list)
      }
      if (!list.items.some((i) => i.text.toLowerCase() === text.toLowerCase())) {
        list.items.push({ id: uid(), text, done: false, by: parentId })
      }
    })
  }

  const importDeals = async (store: SavingsStoreId, text?: string) => {
    setBusyStore(store)
    setStoreError(null)
    try {
      const json = await savingsRequest<{ deals?: Omit<Deal, 'id' | 'store'>[] }>('import', {
        store,
        text,
        staples: sv.staples,
      })
      const fresh: Deal[] = (json.deals ?? []).map((d) => ({ ...d, id: uid(), store }))
      if (!fresh.length) throw new Error('No deals found in that — try pasting more of the page.')
      update((d) => {
        d.savings.deals = d.savings.deals.filter((x) => x.store !== store).concat(fresh)
        d.savings.status[store] = `${fresh.length} deals · synced ${monthDay(td)}`
      })
      const hits = fresh.filter((d) => d.stapleId).length
      toast(`${storeById(store).name}: ${fresh.length} deals, ${hits} match your staples`)
      setPasteFor(null)
      setPasteText('')
    } catch (err) {
      setStoreError(err instanceof Error ? err.message : 'Import failed')
    } finally {
      setBusyStore(null)
    }
  }

  const buildPlan = async () => {
    setPlanBusy(true)
    setPlanError(null)
    setPicks(null)
    setDraftDinners(null)
    try {
      const week = Array.from({ length: 7 }, (_, i) => addDays(td, i))
      const dinners = week
        .filter((ds) => data.mealPlan[ds])
        .map((ds) => ({ date: ds, meal: data.mealPlan[ds] }))
      const groceries =
        data.lists
          .find((l) => l.name.toLowerCase() === 'groceries')
          ?.items.filter((i) => !i.done)
          .map((i) => i.text) ?? []
      const json = await savingsRequest<{
        summary?: string
        dinners?: Omit<DraftDinner, 'selected' | 'replaces'>[]
        picks?: Omit<DraftPick, 'selected'>[]
      }>('plan', {
        staples: sv.staples,
        deals,
        dinners,
        favorites: data.favorites.map((f) => f.name),
        groceries,
      })
      update((d) => {
        d.savings.plan = { week: td, summary: json.summary ?? '', generatedAt: Date.now() }
      })
      setDraftDinners(
        (json.dinners ?? [])
          .filter((p) => week.includes(p.date))
          // Re-proposing the meal a night already has is agreement, not a change.
          .filter((p) => (data.mealPlan[p.date] ?? '').toLowerCase() !== p.meal.toLowerCase())
          .map((p) => ({
            ...p,
            replaces: data.mealPlan[p.date] ?? '',
            // Open nights are pre-approved; overwriting somebody's plan is opt-in.
            selected: !data.mealPlan[p.date],
          }))
      )
      setPicks((json.picks ?? []).map((p) => ({ ...p, selected: true })))
    } catch (err) {
      setPlanError(err instanceof Error ? err.message : 'Planning failed')
    } finally {
      setPlanBusy(false)
    }
  }

  const commitPlan = () => {
    const nights = (draftDinners ?? []).filter((p) => p.selected)
    const chosen = (picks ?? []).filter((p) => p.selected)
    update((d) => {
      nights.forEach((p) => {
        d.mealPlan[p.date] = p.meal
      })
    })
    chosen.forEach((p) => addToGroceries(`${p.item} (${storeById(p.store).name})`))
    const parts = [
      nights.length ? `${nights.length} dinner night${nights.length === 1 ? '' : 's'}` : '',
      chosen.length ? `${chosen.length} grocery item${chosen.length === 1 ? '' : 's'}` : '',
    ].filter(Boolean)
    toast(parts.length ? `Set ${parts.join(' and ')}` : 'Nothing selected')
    setPicks(null)
    setDraftDinners(null)
  }

  const addStaple = () => {
    const name = newStaple.trim()
    if (!name) return
    update((d) => {
      d.savings.staples.push({ id: uid(), name, category: newCategory.trim() || 'Pantry' })
    })
    setNewStaple('')
  }

  const storeChip = (id: SavingsStoreId) => (
    <span
      style={{
        fontWeight: 700,
        fontSize: '.72em',
        color: '#FFF',
        background: storeById(id).color,
        borderRadius: 999,
        padding: '3px 10px',
        whiteSpace: 'nowrap',
      }}
    >
      {storeById(id).name}
    </span>
  )

  const dealRow = (d: Deal, muted = false) => {
    const staple = d.stapleId ? stapleById.get(d.stapleId) : null
    return (
      <div
        key={d.id}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 11,
          padding: '9px 6px',
          borderBottom: `1px solid ${line(0.07)}`,
          opacity: muted ? 0.75 : 1,
        }}
      >
        {storeChip(d.store)}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: '.95em' }}>
            {d.item}{' '}
            <span style={{ color: GREEN }}>{d.price}</span>
          </div>
          <div style={{ color: line(0.55), fontWeight: 600, fontSize: '.8em' }}>
            {[d.savings, d.detail, d.ends ? `ends ${monthDay(d.ends)}` : '', staple ? `covers: ${staple.name}` : '']
              .filter(Boolean)
              .join(' · ')}
          </div>
        </div>
        <button
          onClick={() => {
            addToGroceries(`${d.item} (${storeById(d.store).name}, ${d.price})`)
            toast(`Added ${d.item} to Groceries`)
          }}
          style={{ ...quietBtn, whiteSpace: 'nowrap' }}
        >
          + Groceries
        </button>
      </div>
    )
  }

  const grouped = useMemo(() => {
    const byCat = new Map<string, Staple[]>()
    for (const s of sv.staples) {
      const cat = s.category || 'Pantry'
      byCat.set(cat, [...(byCat.get(cat) ?? []), s])
    }
    return [...byCat.entries()]
  }, [sv.staples])

  return (
    <section style={{ animation: 'fadeUp .35s ease both' }}>
      {/* --- the four stores ------------------------------------------------ */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(230px,1fr))', gap: 12 }}>
        {SAVINGS_STORES.map((s) => {
          const count = deals.filter((d) => d.store === s.id).length
          const hits = matched.filter((d) => d.store === s.id).length
          return (
            <div key={s.id} style={{ ...card, borderRadius: 18, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 10, height: 10, borderRadius: 5, background: s.color, flexShrink: 0 }} />
                <span style={{ fontWeight: 700, fontSize: '.95em' }}>{s.name}</span>
                <div style={{ flex: 1 }} />
                <a
                  href={s.url}
                  target="_blank"
                  rel="noreferrer"
                  style={{ color: '#3D6DE8', fontWeight: 700, fontSize: '.78em', textDecoration: 'none' }}
                >
                  View ad ↗
                </a>
              </div>
              <div style={{ color: line(0.55), fontWeight: 600, fontSize: '.8em' }}>
                {sv.status[s.id] ?? 'Not synced yet'}
                {count ? ` · ${hits} staple match${hits === 1 ? '' : 'es'}` : ''}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={() => void importDeals(s.id)}
                  disabled={busyStore !== null}
                  style={{ ...quietBtn, flex: 1, opacity: busyStore ? 0.5 : 1 }}
                >
                  {busyStore === s.id && pasteFor !== s.id ? 'Reading…' : 'Sync'}
                </button>
                <button
                  onClick={() => {
                    setPasteFor(pasteFor === s.id ? null : s.id)
                    setPasteText('')
                    setStoreError(null)
                  }}
                  style={{ ...quietBtn, flex: 1, ...(pasteFor === s.id ? { background: INK, color: '#F7F9FF' } : {}) }}
                >
                  Paste the ad
                </button>
              </div>
            </div>
          )
        })}
      </div>

      {storeError ? (
        <div style={{ color: DANGER, fontWeight: 600, fontSize: '.9em', marginTop: 10 }}>{storeError}</div>
      ) : null}

      {/* --- paste panel ---------------------------------------------------- */}
      {pasteFor ? (
        <div style={{ ...card, padding: '16px 18px', marginTop: 12, animation: 'fadeUp .3s ease both' }}>
          <div style={{ fontWeight: 700, fontSize: '.95em', marginBottom: 4 }}>
            Paste {storeById(pasteFor).name}'s deals
          </div>
          <div style={{ color: line(0.55), fontWeight: 600, fontSize: '.82em', marginBottom: 10 }}>
            {storeById(pasteFor).hint}
          </div>
          <textarea
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            rows={6}
            placeholder="Paste the specials page, circular, or deals email here…"
            style={{ ...input, width: '100%', borderRadius: 16, resize: 'vertical', lineHeight: 1.5 }}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }}>
            <button
              onClick={() => void importDeals(pasteFor, pasteText)}
              disabled={!pasteText.trim() || busyStore !== null}
              style={{ ...primaryBtn, opacity: pasteText.trim() && !busyStore ? 1 : 0.5 }}
            >
              Extract deals ✦
            </button>
            {busyStore === pasteFor ? (
              <span style={{ fontWeight: 600, color: line(0.6), fontSize: '.9em' }}>Reading the ad…</span>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* --- the week's plan ------------------------------------------------ */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '24px 0 12px', flexWrap: 'wrap' }}>
        <Icon d={PATHS.dollar} size={22} color={GREEN} />
        <h2 style={{ ...HEADING, fontSize: '1.25em' }}>This week's plan</h2>
        <div style={{ flex: 1 }} />
        <button
          onClick={() => void buildPlan()}
          disabled={planBusy || !deals.length}
          style={{ ...primaryBtn, opacity: planBusy || !deals.length ? 0.5 : 1 }}
          title={deals.length ? '' : 'Sync or paste at least one store first'}
        >
          {planBusy ? 'Planning…' : sv.plan ? 'Rebuild the plan ✦' : 'Build the plan ✦'}
        </button>
      </div>
      {planError ? (
        <div style={{ color: DANGER, fontWeight: 600, fontSize: '.9em', marginBottom: 10 }}>{planError}</div>
      ) : null}
      {sv.plan ? (
        <div style={{ ...card, padding: '18px 20px' }}>
          <div style={{ color: line(0.5), fontWeight: 700, fontSize: '.75em', marginBottom: 8 }}>
            BUILT {fmtDate(sv.plan.week).toUpperCase()}
          </div>
          <div style={{ fontWeight: 600, fontSize: '.93em', lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>
            {sv.plan.summary}
          </div>
        </div>
      ) : (
        <div style={{ color: line(0.5), fontWeight: 600, fontSize: '.9em' }}>
          Sync the stores, then build the plan — the deals propose the week's dinner nights, and the
          shopping list follows from what's actually on sale.
        </div>
      )}

      {picks?.length || draftDinners?.length ? (
        <div style={{ ...card, border: `1.5px solid rgba(124,92,224,.5)`, padding: '18px 20px', marginTop: 12, animation: 'fadeUp .3s ease both' }}>
          {draftDinners?.length ? (
            <>
              <h3 style={{ ...HEADING, fontSize: '1.05em', margin: '0 0 8px' }}>
                Dinner nights the deals suggest — check what sounds good:
              </h3>
              {draftDinners.map((p, i) => (
                <div
                  key={`d${i}`}
                  onClick={() =>
                    setDraftDinners((prev) => prev!.map((x, j) => (j === i ? { ...x, selected: !x.selected } : x)))
                  }
                  style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '8px 6px', borderBottom: `1px solid ${line(0.07)}`, cursor: 'pointer' }}
                >
                  <CheckBox on={p.selected} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: '.95em' }}>
                      {fmtDate(p.date)} · <span style={{ color: GREEN }}>{p.meal}</span>
                    </div>
                    <div style={{ color: line(0.55), fontWeight: 600, fontSize: '.8em' }}>
                      {[p.note, p.replaces ? `replaces “${p.replaces}”` : ''].filter(Boolean).join(' · ')}
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
                    dinner
                  </span>
                </div>
              ))}
            </>
          ) : null}

          {picks?.length ? (
            <>
              <h3 style={{ ...HEADING, fontSize: '1.05em', margin: `${draftDinners?.length ? 14 : 0}px 0 8px` }}>
                And the shopping to match:
              </h3>
              {picks.map((p, i) => (
                <div
                  key={`p${i}`}
                  onClick={() => setPicks((prev) => prev!.map((x, j) => (j === i ? { ...x, selected: !x.selected } : x)))}
                  style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '8px 6px', borderBottom: `1px solid ${line(0.07)}`, cursor: 'pointer' }}
                >
                  <CheckBox on={p.selected} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: '.95em' }}>{p.item}</div>
                    <div style={{ color: line(0.55), fontWeight: 600, fontSize: '.8em' }}>{p.note}</div>
                  </div>
                  {storeChip(p.store)}
                </div>
              ))}
            </>
          ) : null}

          <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
            <button onClick={commitPlan} style={primaryBtn}>
              Apply{' '}
              {[
                draftDinners?.filter((p) => p.selected).length
                  ? `${draftDinners.filter((p) => p.selected).length} dinner${draftDinners.filter((p) => p.selected).length === 1 ? '' : 's'}`
                  : '',
                picks?.filter((p) => p.selected).length
                  ? `${picks.filter((p) => p.selected).length} grocery item${picks.filter((p) => p.selected).length === 1 ? '' : 's'}`
                  : '',
              ]
                .filter(Boolean)
                .join(' + ') || 'nothing'}
            </button>
            <button
              onClick={() => {
                setPicks(null)
                setDraftDinners(null)
              }}
              style={quietBtn}
            >
              Discard
            </button>
          </div>
        </div>
      ) : null}

      {/* --- deals that hit a staple ---------------------------------------- */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '24px 0 8px' }}>
        <h2 style={{ ...HEADING, fontSize: '1.25em' }}>Deals on things we buy</h2>
        <span style={{ fontWeight: 700, fontSize: '.8em', color: PURPLE }}>
          {matched.length} match{matched.length === 1 ? '' : 'es'}
        </span>
      </div>
      {matched.length ? (
        <div style={{ ...card, padding: '8px 14px' }}>{matched.map((d) => dealRow(d))}</div>
      ) : (
        <div style={{ color: line(0.5), fontWeight: 600, fontSize: '.9em' }}>
          Nothing yet — sync a store or paste its ad and matches against your staples land here.
        </div>
      )}

      {unmatched.length ? (
        <div style={{ marginTop: 10 }}>
          <button onClick={() => setShowUnmatched(!showUnmatched)} style={quietBtn}>
            {showUnmatched ? 'Hide' : 'Show'} {unmatched.length} other deal{unmatched.length === 1 ? '' : 's'}
          </button>
          {showUnmatched ? (
            <div style={{ ...card, padding: '8px 14px', marginTop: 10 }}>
              {unmatched.map((d) => dealRow(d, true))}
            </div>
          ) : null}
        </div>
      ) : null}

      {/* --- staples -------------------------------------------------------- */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '24px 0 12px', flexWrap: 'wrap' }}>
        <h2 style={{ ...HEADING, fontSize: '1.25em' }}>Things we regularly buy</h2>
        <div style={{ flex: 1 }} />
        <input
          value={newStaple}
          onChange={(e) => setNewStaple(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addStaple()}
          placeholder="Add a staple…"
          style={{ ...input, borderRadius: 999, padding: '10px 16px', fontSize: '.9em', width: 180 }}
        />
        <input
          value={newCategory}
          onChange={(e) => setNewCategory(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addStaple()}
          placeholder="Category"
          style={{ ...input, borderRadius: 999, padding: '10px 16px', fontSize: '.9em', width: 120 }}
        />
        <button onClick={addStaple} style={primaryBtn}>
          Add
        </button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 12 }}>
        {grouped.map(([cat, staples]) => (
          <div key={cat} style={{ ...card, borderRadius: 18, padding: '14px 16px' }}>
            <div style={{ fontWeight: 700, fontSize: '.78em', color: line(0.5), marginBottom: 8 }}>
              {cat.toUpperCase()}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {staples.map((s) => (
                <span
                  key={s.id}
                  title={s.note ?? ''}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    border: `1px solid ${line(0.14)}`,
                    background: '#F7F9FF',
                    borderRadius: 999,
                    padding: '6px 6px 6px 12px',
                    fontWeight: 700,
                    fontSize: '.82em',
                  }}
                >
                  {s.name}
                  <button
                    onClick={() =>
                      update((d) => {
                        d.savings.staples = d.savings.staples.filter((x) => x.id !== s.id)
                      })
                    }
                    style={{
                      border: 'none',
                      background: 'rgba(217,91,67,.1)',
                      color: DANGER,
                      borderRadius: 999,
                      width: 20,
                      height: 20,
                      fontWeight: 700,
                      cursor: 'pointer',
                      fontSize: '.8em',
                      lineHeight: 1,
                    }}
                  >
                    ✕
                  </button>
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
