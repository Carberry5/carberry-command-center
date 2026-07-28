import { today, uid } from '../../lib/dates.ts'
import { CREAM, DANGER, INK, chip, input, line } from '../../lib/theme.ts'
import { useFamily } from '../../store/FamilyStore.tsx'
import { useModals } from '../../store/ModalStore.tsx'
import { Modal } from '../Modal.tsx'

/** Create or edit an event — who it's for, and who's driving. */
export function EventModal() {
  const { data, update, toast, requirePin } = useFamily()
  const { event, setEvent } = useModals()
  if (!event) return null

  const close = () => setEvent(null)
  const parents = data.members.filter((m) => m.role === 'parent')

  const save = () => {
    if (!event.t.trim() || !event.date) {
      toast('Give it a name and a date')
      return
    }
    update((d) => {
      const patch = {
        title: event.t.trim(),
        date: event.date,
        start: event.start || null,
        dur: event.dur ? Number(event.dur) : null,
        loc: event.loc,
        memberIds: event.mems,
        recur: event.rec ? ('weekly' as const) : null,
        drop: event.drop || null,
        pick: event.pick || null,
      }
      if (event.id) {
        const existing = d.events.find((e) => e.id === event.id)
        if (existing) Object.assign(existing, patch)
      } else {
        d.events.push({ id: uid(), ...patch })
      }
    })
    close()
    toast('Saved to the family calendar')
  }

  const remove = () => {
    const id = event.id
    requirePin(() => {
      update((d) => {
        d.events = d.events.filter((e) => e.id !== id)
      })
      close()
      toast('Event deleted')
    }, 'Deleting needs a parent')
  }

  const rideRow = (field: 'drop' | 'pick', label: string) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap', marginBottom: field === 'drop' ? 8 : 12 }}>
      <span style={{ width: 62, fontWeight: 700, fontSize: '.8em', color: line(0.75) }}>{label}</span>
      <button onClick={() => setEvent((prev) => ({ ...prev, [field]: '' }))} style={chip(!event[field])}>
        No one
      </button>
      {parents.map((m) => (
        <button
          key={m.id}
          onClick={() => setEvent((prev) => ({ ...prev, [field]: m.id }))}
          style={chip(event[field] === m.id)}
        >
          {m.name}
        </button>
      ))}
    </div>
  )

  return (
    <Modal onClose={close} width={480} title={event.id ? 'Edit event' : 'New event'}>
      <input
        value={event.t}
        onChange={(e) => setEvent((prev) => ({ ...prev, t: e.target.value }))}
        placeholder="What's happening?"
        style={{ ...input, width: '100%', fontWeight: 700, fontSize: '1em', marginBottom: 10 }}
      />

      <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
        <input
          type="date"
          value={event.date || today()}
          onChange={(e) => setEvent((prev) => ({ ...prev, date: e.target.value }))}
          style={{ ...input, flex: 1, minWidth: 140, padding: '11px 12px', fontSize: '.9em' }}
        />
        <input
          type="time"
          value={event.start}
          onChange={(e) => setEvent((prev) => ({ ...prev, start: e.target.value }))}
          style={{ ...input, padding: '11px 12px', fontSize: '.9em' }}
        />
        <input
          value={event.dur}
          onChange={(e) => setEvent((prev) => ({ ...prev, dur: e.target.value.replace(/\D/g, '') }))}
          placeholder="Min"
          title="Duration (minutes)"
          style={{ ...input, width: 74, padding: '11px 12px', fontSize: '.9em' }}
        />
      </div>

      <input
        value={event.loc}
        onChange={(e) => setEvent((prev) => ({ ...prev, loc: e.target.value }))}
        placeholder="Location (optional)"
        style={{ ...input, width: '100%', padding: '11px 14px', fontSize: '.9em', marginBottom: 12 }}
      />

      <div style={{ fontWeight: 700, fontSize: '.85em', color: line(0.6), marginBottom: 6 }}>Who's it for?</div>
      <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginBottom: 12 }}>
        {data.members.map((m) => (
          <button
            key={m.id}
            onClick={() =>
              setEvent((prev) => ({
                ...prev,
                mems: prev.mems.includes(m.id) ? prev.mems.filter((x) => x !== m.id) : [...prev.mems, m.id],
              }))
            }
            style={chip(event.mems.includes(m.id))}
          >
            <span style={{ width: 10, height: 10, borderRadius: '50%', display: 'inline-block', background: m.color }} />
            {m.name}
          </button>
        ))}
      </div>

      <div style={{ fontWeight: 700, fontSize: '.85em', color: line(0.6), marginBottom: 6 }}>Rides</div>
      {rideRow('drop', 'Drop-off')}
      {rideRow('pick', 'Pick-up')}

      <button onClick={() => setEvent((prev) => ({ ...prev, rec: !prev.rec }))} style={chip(event.rec)}>
        Repeats weekly
      </button>

      <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
        <button
          onClick={save}
          style={{
            flex: 1,
            background: INK,
            color: CREAM,
            border: 'none',
            borderRadius: 999,
            padding: 13,
            fontWeight: 700,
            cursor: 'pointer',
            fontSize: '1em',
          }}
        >
          Save
        </button>
        {event.id ? (
          <button
            onClick={remove}
            style={{
              border: 'none',
              background: 'rgba(217,91,67,.12)',
              color: DANGER,
              borderRadius: 999,
              padding: '13px 18px',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            Delete
          </button>
        ) : null}
        <button
          onClick={close}
          style={{
            border: `1px solid ${line(0.16)}`,
            background: 'none',
            borderRadius: 999,
            padding: '13px 18px',
            fontWeight: 700,
            cursor: 'pointer',
            color: INK,
          }}
        >
          Cancel
        </button>
      </div>
    </Modal>
  )
}
