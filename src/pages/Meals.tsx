import { addDays, parseDay, today, uid } from '../lib/dates.ts'
import { BLUE, GREEN, HEADING, INK, card, line } from '../lib/theme.ts'
import { useFamily } from '../store/FamilyStore.tsx'
import { useModals } from '../store/ModalStore.tsx'
import { useState } from 'react'

/** The week's dinners, plus the family's go-to meals. */
export function MealsPage() {
  const { data, update } = useFamily()
  const { setMealPick, setMealQuery, setPlanNight } = useModals()
  const [newFav, setNewFav] = useState('')

  const td = today()

  const addFavorite = () => {
    const name = newFav.trim()
    if (!name) return
    update((d) => {
      d.favorites.push({ id: uid(), name, tag: '' })
    })
    setNewFav('')
  }

  return (
    <section style={{ animation: 'fadeUp .35s ease both' }}>
      <div
        className="scroll-x"
        style={{ display: 'grid', gridTemplateColumns: 'repeat(7,minmax(140px,1fr))', gap: 10, paddingBottom: 6 }}
      >
        {Array.from({ length: 7 }, (_, i) => addDays(td, i)).map((ds, i) => {
          const d = parseDay(ds)
          const name = data.mealPlan[ds]
          return (
            <button
              key={ds}
              onClick={() => {
                setMealQuery('')
                setMealPick(ds)
              }}
              style={{
                textAlign: 'left',
                background: '#FFFFFF',
                borderRadius: 18,
                padding: '13px 14px',
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                gap: 7,
                minHeight: 96,
                border: name ? `1.5px solid ${line(0.12)}` : `1.5px dashed ${line(0.3)}`,
              }}
            >
              <div style={{ fontWeight: 700, fontSize: '.78em', color: line(0.55) }}>
                {i === 0 ? 'Tonight' : d.toLocaleDateString('en-US', { weekday: 'short' })}{' '}
                <span style={{ color: line(0.85) }}>{d.getDate()}</span>
              </div>
              <div
                style={{
                  fontWeight: 700,
                  fontSize: '.95em',
                  lineHeight: 1.3,
                  color: name ? GREEN : line(0.4),
                }}
              >
                {name ?? '+ plan'}
              </div>
            </button>
          )
        })}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '24px 0 12px', flexWrap: 'wrap' }}>
        <h2 style={{ ...HEADING, fontSize: '1.25em' }}>Family favorites</h2>
        <div style={{ flex: 1 }} />
        <input
          value={newFav}
          onChange={(e) => setNewFav(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addFavorite()}
          placeholder="Add a favorite meal…"
          style={{
            background: '#FFF',
            border: `1.5px solid ${line(0.16)}`,
            borderRadius: 999,
            padding: '10px 16px',
            fontSize: '.9em',
            fontWeight: 600,
            color: INK,
            outlineColor: '#7C5CE0',
            width: 220,
          }}
        />
        <button
          onClick={addFavorite}
          style={{
            background: INK,
            color: '#F7F9FF',
            border: 'none',
            borderRadius: 999,
            padding: '10px 16px',
            fontWeight: 700,
            cursor: 'pointer',
            fontSize: '.85em',
          }}
        >
          Add
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 12 }}>
        {data.favorites.map((f) => (
          <div key={f.id} style={{ ...card, borderRadius: 18, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ fontWeight: 700, fontSize: '.95em' }}>{f.name}</div>
            {f.tag ? (
              <div
                style={{
                  alignSelf: 'flex-start',
                  fontWeight: 700,
                  fontSize: '.72em',
                  color: BLUE,
                  background: 'rgba(61,109,232,.1)',
                  borderRadius: 999,
                  padding: '3px 10px',
                }}
              >
                {f.tag}
              </div>
            ) : null}
            <div style={{ display: 'flex', gap: 8, marginTop: 2 }}>
              <button
                onClick={() => setPlanNight(f.name)}
                style={{
                  flex: 1,
                  border: `1px solid ${line(0.16)}`,
                  background: '#F7F9FF',
                  borderRadius: 999,
                  padding: '8px 10px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  fontSize: '.8em',
                  color: INK,
                }}
              >
                Plan a night
              </button>
              <button
                onClick={() =>
                  update((d) => {
                    d.favorites = d.favorites.filter((x) => x.id !== f.id)
                  })
                }
                style={{
                  border: 'none',
                  background: 'rgba(217,91,67,.1)',
                  color: '#B23B22',
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
          </div>
        ))}
      </div>
    </section>
  )
}
