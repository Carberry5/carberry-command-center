import { addDays, daysUntil, fmtDate, today } from '../lib/dates.ts'
import { memberById } from '../lib/selectors.ts'
import { CREAM, FAM, HEADING, INK, line } from '../lib/theme.ts'
import { useFamily } from '../store/FamilyStore.tsx'
import { useModals } from '../store/ModalStore.tsx'

/** How many sleeps until the beach, the birthday, the first day of school. */
export function CountdownsPage() {
  const { data } = useFamily()
  const { setCountdown } = useModals()

  const td = today()
  const items = data.countdowns
    .map((c) => ({ ...c, days: daysUntil(td, c.date) }))
    .filter((c) => c.date >= td)
    .sort((a, b) => a.days - b.days)

  return (
    <section style={{ animation: 'fadeUp .35s ease both' }}>
      <div style={{ display: 'flex', marginBottom: 14 }}>
        <div style={{ flex: 1 }} />
        <button
          onClick={() => setCountdown({ t: '', date: addDays(td, 7), mem: null })}
          style={{
            background: INK,
            color: CREAM,
            border: 'none',
            borderRadius: 999,
            padding: '11px 18px',
            fontWeight: 700,
            cursor: 'pointer',
            fontSize: '.9em',
          }}
        >
          + New countdown
        </button>
      </div>

      {!items.length ? (
        <div style={{ color: line(0.55), fontWeight: 600, padding: 30, textAlign: 'center' }}>
          No countdowns yet — what's the next big day?
        </div>
      ) : null}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(210px,1fr))', gap: 14 }}>
        {items.map((c) => {
          const color = c.memberId ? memberById(data, c.memberId)?.color ?? FAM : FAM
          return (
            <button
              key={c.id}
              onClick={() => setCountdown({ id: c.id, t: c.title, date: c.date, mem: c.memberId })}
              style={{
                textAlign: 'center',
                background: `linear-gradient(160deg,#FFFFFF,${color}14)`,
                border: `1.5px solid ${color}55`,
                borderRadius: 22,
                padding: '22px 16px',
                cursor: 'pointer',
              }}
            >
              <div style={{ ...HEADING, fontSize: '2.6em', lineHeight: 1, color }}>
                {c.days === 0 ? '🎈' : c.days}
              </div>
              <div style={{ fontWeight: 700, fontSize: '.8em', color: line(0.5), letterSpacing: '.12em', marginTop: 2 }}>
                {c.days === 0 ? "IT'S TODAY" : c.days === 1 ? 'DAY TO GO' : 'DAYS TO GO'}
              </div>
              <div style={{ fontWeight: 700, fontSize: '1.02em', marginTop: 8, color: INK }}>{c.title}</div>
              <div style={{ fontWeight: 600, fontSize: '.8em', color: line(0.55), marginTop: 2 }}>{fmtDate(c.date)}</div>
            </button>
          )
        })}
      </div>
    </section>
  )
}
