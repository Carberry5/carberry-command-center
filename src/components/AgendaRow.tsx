import type { ResolvedEvent } from '../types.ts'
import { fmtTime, today } from '../lib/dates.ts'
import { eventColor, memberDots } from '../lib/selectors.ts'
import { line } from '../lib/theme.ts'
import { weatherAt } from '../lib/weather.ts'
import { useFamily } from '../store/FamilyStore.tsx'
import { useModals } from '../store/ModalStore.tsx'
import { Icon } from './Icon.tsx'
import { RideTags } from './RideTags.tsx'

/** One line of the day's plan. Shared by Today, a member's page, and the day sheet. */
export function AgendaRow({
  event,
  showRides = true,
  showDots = true,
}: {
  event: ResolvedEvent
  showRides?: boolean
  showDots?: boolean
}) {
  const { data, wx, now } = useFamily()
  const { editEvent } = useModals()

  const nowDate = new Date(now)
  const hhmm = `${String(nowDate.getHours()).padStart(2, '0')}:${String(nowDate.getMinutes()).padStart(2, '0')}`
  // Events already gone by are dimmed so the eye lands on what's next.
  const past = event.date === today() && !!event.start && event.start < hhmm

  const bar = eventColor(data, event)
  const forecast = weatherAt(wx, event.date, event.start)

  return (
    <div
      onClick={() => editEvent(event)}
      className="agenda-hover"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '7px 8px',
        borderRadius: 14,
        cursor: 'pointer',
        transition: 'background .15s',
        minHeight: 46,
        opacity: past ? 0.55 : 1,
      }}
    >
      <div style={{ width: 78, flexShrink: 0, fontWeight: 700, fontSize: '.86em', color: line(0.62) }}>
        {fmtTime(event.start)}
      </div>
      <div style={{ width: 5, alignSelf: 'stretch', borderRadius: 99, background: bar }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: '.98em' }}>{event.title}</div>
        {event.loc ? (
          <div style={{ color: line(0.55), fontWeight: 600, fontSize: '.8em' }}>{event.loc}</div>
        ) : null}
      </div>

      {showRides ? <RideTags data={data} event={event} /> : null}

      {showDots ? (
        <div style={{ display: 'flex', gap: 4 }}>
          {(event.feedColor ? [event.feedColor] : memberDots(data, event.memberIds)).map((c, i) => (
            <div
              key={`${c}-${i}`}
              style={{ width: 12, height: 12, borderRadius: '50%', border: '2px solid #FFFFFF', background: c }}
            />
          ))}
        </div>
      ) : null}

      {forecast ? (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            color: line(0.6),
            fontWeight: 700,
            fontSize: '.78em',
            background: 'rgba(35,42,61,.05)',
            borderRadius: 999,
            padding: '4px 9px',
          }}
        >
          <Icon d={forecast.d} size={15} />
          {forecast.t}
        </div>
      ) : null}
    </div>
  )
}
