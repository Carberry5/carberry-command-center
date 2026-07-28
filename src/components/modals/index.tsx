import { DOW_NAMES, addDays, fmtDate, parseDay, today, uid } from '../../lib/dates.ts'
import { balances, eventsOn } from '../../lib/selectors.ts'
import {
  BLUE,
  CREAM,
  DANGER,
  FAM,
  HEADING,
  INK,
  PURPLE_TEXT,
  chip,
  input,
  line,
} from '../../lib/theme.ts'
import { useFamily } from '../../store/FamilyStore.tsx'
import { useModals } from '../../store/ModalStore.tsx'
import { AgendaRow } from '../AgendaRow.tsx'
import { Modal } from '../Modal.tsx'

/** Save / Delete / Cancel row shared by the editing dialogs. */
function Footer({
  onSave,
  onDelete,
  onClose,
}: {
  onSave: () => void
  onDelete?: () => void
  onClose: () => void
}) {
  return (
    <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
      <button
        onClick={onSave}
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
      {onDelete ? (
        <button
          onClick={onDelete}
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
        onClick={onClose}
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
  )
}

/** −/+ stepper used for star counts and reward costs. */
function Stepper({
  label,
  value,
  onChange,
  min = 1,
  max = 99,
}: {
  label: string
  value: number
  onChange: (next: number) => void
  min?: number
  max?: number
}) {
  const round = {
    width: 38,
    height: 38,
    borderRadius: '50%',
    border: `1px solid ${line(0.16)}`,
    background: '#F7F9FF',
    fontWeight: 800,
    cursor: 'pointer',
    fontSize: '1.1em',
    color: INK,
  } as const
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <span style={{ fontWeight: 700, fontSize: '.85em', color: line(0.6) }}>{label}</span>
      <button onClick={() => onChange(Math.max(min, value - 1))} style={round}>
        −
      </button>
      <span style={{ fontWeight: 800, fontSize: '1.2em', color: PURPLE_TEXT }}>{value} ★</span>
      <button onClick={() => onChange(Math.min(max, value + 1))} style={round}>
        +
      </button>
    </div>
  )
}

export function ChoreModal() {
  const { data, update, toast } = useFamily()
  const { chore, setChore } = useModals()
  if (!chore) return null
  const close = () => setChore(null)

  const save = () => {
    if (!chore.t.trim() || !chore.mems.length || !chore.days.length) {
      toast('Needs a name, a person, and a day')
      return
    }
    update((d) => {
      const patch = {
        title: chore.t.trim(),
        memberIds: chore.mems,
        days: [...chore.days].sort((a, b) => a - b),
        stars: chore.stars,
      }
      if (chore.id) {
        const existing = d.chores.find((c) => c.id === chore.id)
        if (existing) Object.assign(existing, patch)
      } else {
        d.chores.push({ id: uid(), ...patch })
      }
    })
    close()
    toast('Chore saved')
  }

  return (
    <Modal onClose={close} title={chore.id ? 'Edit chore' : 'New chore'}>
      <input
        value={chore.t}
        onChange={(e) => setChore((prev) => ({ ...prev, t: e.target.value }))}
        placeholder="Chore name"
        style={{ ...input, width: '100%', fontWeight: 700, fontSize: '1em', marginBottom: 12 }}
      />

      <div style={{ fontWeight: 700, fontSize: '.85em', color: line(0.6), marginBottom: 6 }}>Who does it?</div>
      <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginBottom: 12 }}>
        {data.members.map((m) => (
          <button
            key={m.id}
            onClick={() =>
              setChore((prev) => ({
                ...prev,
                mems: prev.mems.includes(m.id) ? prev.mems.filter((x) => x !== m.id) : [...prev.mems, m.id],
              }))
            }
            style={chip(chore.mems.includes(m.id))}
          >
            <span style={{ width: 10, height: 10, borderRadius: '50%', display: 'inline-block', background: m.color }} />
            {m.name}
          </button>
        ))}
      </div>

      <div style={{ fontWeight: 700, fontSize: '.85em', color: line(0.6), marginBottom: 6 }}>Which days?</div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
        {DOW_NAMES.map((label, i) => (
          <button
            key={label}
            onClick={() =>
              setChore((prev) => ({
                ...prev,
                days: prev.days.includes(i) ? prev.days.filter((x) => x !== i) : [...prev.days, i],
              }))
            }
            style={chip(chore.days.includes(i))}
          >
            {label}
          </button>
        ))}
      </div>

      <Stepper
        label="Stars:"
        value={chore.stars}
        max={10}
        onChange={(stars) => setChore((prev) => ({ ...prev, stars }))}
      />

      <Footer
        onSave={save}
        onClose={close}
        onDelete={
          chore.id
            ? () => {
                update((d) => {
                  d.chores = d.chores.filter((c) => c.id !== chore.id)
                })
                close()
              }
            : undefined
        }
      />
    </Modal>
  )
}

export function RewardModal() {
  const { update } = useFamily()
  const { reward, setReward } = useModals()
  if (!reward) return null
  const close = () => setReward(null)

  const save = () => {
    if (!reward.t.trim()) return
    update((d) => {
      if (reward.id) {
        const existing = d.rewards.find((r) => r.id === reward.id)
        if (existing) Object.assign(existing, { title: reward.t.trim(), cost: reward.cost })
      } else {
        d.rewards.push({ id: uid(), title: reward.t.trim(), cost: reward.cost })
      }
    })
    close()
  }

  return (
    <Modal onClose={close} width={400} title={reward.id ? 'Edit reward' : 'New reward'}>
      <input
        value={reward.t}
        onChange={(e) => setReward((prev) => ({ ...prev, t: e.target.value }))}
        placeholder="Reward name"
        style={{ ...input, width: '100%', fontWeight: 700, fontSize: '1em', marginBottom: 12 }}
      />
      <Stepper label="Cost:" value={reward.cost} onChange={(cost) => setReward((prev) => ({ ...prev, cost }))} />
      <Footer
        onSave={save}
        onClose={close}
        onDelete={
          reward.id
            ? () => {
                update((d) => {
                  d.rewards = d.rewards.filter((r) => r.id !== reward.id)
                })
                close()
              }
            : undefined
        }
      />
    </Modal>
  )
}

export function RedeemModal() {
  const { data, update, toast, requirePin } = useFamily()
  const { redeem, setRedeem } = useModals()
  if (!redeem) return null

  const close = () => setRedeem(null)
  const bal = balances(data)
  const kids = data.members.filter((m) => m.role === 'kid')

  return (
    <Modal onClose={close} width={420}>
      <h2 style={{ ...HEADING, fontSize: '1.25em', margin: '0 0 4px' }}>Redeem: {redeem.title}</h2>
      <div style={{ fontWeight: 700, color: PURPLE_TEXT, marginBottom: 14 }}>
        Costs {redeem.cost} ★ — who's cashing in?
      </div>

      {kids.map((k) => {
        const balance = bal[k.id] ?? 0
        const canAfford = balance >= redeem.cost
        return (
          <button
            key={k.id}
            onClick={() => {
              if (!canAfford) {
                toast(`${k.name} needs ${redeem.cost - balance} more ★`)
                return
              }
              requirePin(() => {
                update((d) => {
                  d.redemptions.push({
                    id: uid(),
                    kidId: k.id,
                    title: redeem.title,
                    cost: redeem.cost,
                    ts: Date.now(),
                  })
                })
                close()
                toast(`${k.name} redeemed “${redeem.title}” — enjoy!`)
              }, 'A parent approves redemptions')
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 11,
              width: '100%',
              borderRadius: 16,
              padding: '11px 13px',
              marginBottom: 7,
              cursor: canAfford ? 'pointer' : 'not-allowed',
              border: `1.5px solid ${line(0.13)}`,
              background: '#FFFFFF',
              opacity: canAfford ? 1 : 0.45,
            }}
          >
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: CREAM,
                fontFamily: "'Outfit', sans-serif",
                fontWeight: 600,
                background: k.color,
              }}
            >
              {k.name[0]}
            </div>
            <div style={{ flex: 1, textAlign: 'left' }}>
              <div style={{ fontWeight: 700 }}>{k.name}</div>
              <div style={{ fontWeight: 600, fontSize: '.8em', color: line(0.55) }}>
                {canAfford ? 'Can afford it!' : `Needs ${redeem.cost - balance} more ★`}
              </div>
            </div>
            <div style={{ fontWeight: 800, color: PURPLE_TEXT }}>{balance} ★</div>
          </button>
        )
      })}

      <button
        onClick={close}
        style={{
          width: '100%',
          border: `1px solid ${line(0.16)}`,
          background: 'none',
          borderRadius: 999,
          padding: 12,
          fontWeight: 700,
          cursor: 'pointer',
          marginTop: 8,
          color: INK,
        }}
      >
        Cancel
      </button>
    </Modal>
  )
}

export function MealPickModal() {
  const { data, update } = useFamily()
  const { mealPick, setMealPick, mealQuery, setMealQuery } = useModals()
  if (!mealPick) return null

  const close = () => setMealPick(null)
  const query = mealQuery.trim()
  const matches = data.favorites.filter((f) => !query || f.name.toLowerCase().includes(query.toLowerCase()))
  const exact = data.favorites.some((f) => f.name.toLowerCase() === query.toLowerCase())

  const pick = (name: string) => {
    update((d) => {
      d.mealPlan[mealPick] = name
    })
    close()
  }

  return (
    <Modal onClose={close} width={440} title={`Dinner for ${fmtDate(mealPick)}`}>
      <input
        value={mealQuery}
        onChange={(e) => setMealQuery(e.target.value)}
        placeholder="Search or type a meal…"
        style={{ ...input, width: '100%', fontWeight: 700, fontSize: '.95em', marginBottom: 10 }}
      />

      {query && !exact ? (
        <button
          onClick={() => pick(query)}
          style={{
            display: 'block',
            width: '100%',
            textAlign: 'left',
            border: `1.5px dashed ${line(0.25)}`,
            background: 'none',
            borderRadius: 14,
            padding: '11px 14px',
            fontWeight: 700,
            cursor: 'pointer',
            marginBottom: 8,
            color: INK,
          }}
        >
          Use “{query}”
        </button>
      ) : null}

      {matches.map((f) => (
        <button
          key={f.id}
          onClick={() => pick(f.name)}
          className="row-hover"
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            border: 'none',
            background: 'none',
            borderRadius: 12,
            padding: '11px 10px',
            fontWeight: 700,
            cursor: 'pointer',
            fontSize: '.95em',
            color: INK,
            borderBottom: `1px solid ${line(0.06)}`,
          }}
        >
          <span style={{ flex: 1, textAlign: 'left' }}>{f.name}</span>
          {f.tag ? (
            <span
              style={{
                fontWeight: 700,
                fontSize: '.7em',
                color: BLUE,
                background: 'rgba(61,109,232,.1)',
                borderRadius: 999,
                padding: '3px 9px',
              }}
            >
              {f.tag}
            </span>
          ) : null}
        </button>
      ))}

      {data.mealPlan[mealPick] ? (
        <button
          onClick={() => {
            update((d) => {
              delete d.mealPlan[mealPick]
            })
            close()
          }}
          style={{
            width: '100%',
            border: 'none',
            background: 'rgba(217,91,67,.1)',
            color: DANGER,
            borderRadius: 999,
            padding: 11,
            fontWeight: 700,
            cursor: 'pointer',
            marginTop: 10,
          }}
        >
          Clear this night
        </button>
      ) : null}
    </Modal>
  )
}

export function PlanNightModal() {
  const { data, update, toast } = useFamily()
  const { planNight, setPlanNight } = useModals()
  if (!planNight) return null

  const close = () => setPlanNight(null)
  const td = today()

  return (
    <Modal onClose={close} width={400} title={`“${planNight}” — which night?`}>
      <div style={{ display: 'grid', gap: 7 }}>
        {Array.from({ length: 7 }, (_, i) => addDays(td, i)).map((ds, i) => {
          const d = parseDay(ds)
          return (
            <button
              key={ds}
              onClick={() => {
                update((draft) => {
                  draft.mealPlan[ds] = planNight
                })
                close()
                toast(`${planNight} planned!`)
              }}
              className="pick-hover"
              style={{
                display: 'flex',
                gap: 10,
                alignItems: 'center',
                border: `1px solid ${line(0.14)}`,
                background: '#F7F9FF',
                borderRadius: 14,
                padding: '11px 14px',
                fontWeight: 700,
                cursor: 'pointer',
                color: INK,
              }}
            >
              <span style={{ flex: 1, textAlign: 'left' }}>
                {i === 0 ? 'Tonight' : d.toLocaleDateString('en-US', { weekday: 'long' })} {d.getDate()}
              </span>
              <span style={{ fontWeight: 600, fontSize: '.82em', color: line(0.5) }}>
                {data.mealPlan[ds] ?? 'open'}
              </span>
            </button>
          )
        })}
      </div>
    </Modal>
  )
}

export function CountdownModal() {
  const { data, update } = useFamily()
  const { countdown, setCountdown } = useModals()
  if (!countdown) return null
  const close = () => setCountdown(null)

  const save = () => {
    if (!countdown.t.trim() || !countdown.date) return
    update((d) => {
      const patch = { title: countdown.t.trim(), date: countdown.date, memberId: countdown.mem }
      if (countdown.id) {
        const existing = d.countdowns.find((c) => c.id === countdown.id)
        if (existing) Object.assign(existing, patch)
      } else {
        d.countdowns.push({ id: uid(), ...patch })
      }
    })
    close()
  }

  return (
    <Modal onClose={close} width={420} title={countdown.id ? 'Edit countdown' : 'New countdown'}>
      <input
        value={countdown.t}
        onChange={(e) => setCountdown((prev) => ({ ...prev, t: e.target.value }))}
        placeholder="What are we counting down to?"
        style={{ ...input, width: '100%', fontWeight: 700, fontSize: '1em', marginBottom: 10 }}
      />
      <input
        type="date"
        value={countdown.date}
        onChange={(e) => setCountdown((prev) => ({ ...prev, date: e.target.value }))}
        style={{ ...input, width: '100%', padding: '11px 12px', fontSize: '.9em', marginBottom: 12 }}
      />
      <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
        <button onClick={() => setCountdown((prev) => ({ ...prev, mem: null }))} style={chip(!countdown.mem)}>
          <span style={{ width: 10, height: 10, borderRadius: '50%', display: 'inline-block', background: FAM }} />
          Everyone
        </button>
        {data.members.map((m) => (
          <button
            key={m.id}
            onClick={() => setCountdown((prev) => ({ ...prev, mem: m.id }))}
            style={chip(countdown.mem === m.id)}
          >
            <span style={{ width: 10, height: 10, borderRadius: '50%', display: 'inline-block', background: m.color }} />
            {m.name}
          </button>
        ))}
      </div>
      <Footer
        onSave={save}
        onClose={close}
        onDelete={
          countdown.id
            ? () => {
                update((d) => {
                  d.countdowns = d.countdowns.filter((c) => c.id !== countdown.id)
                })
                close()
              }
            : undefined
        }
      />
    </Modal>
  )
}

/** Edit the sample WHOOP / Oura / Greenlight numbers by hand. */
export function IntegrationModal() {
  const { update, toast } = useFamily()
  const { integration, setIntegration } = useModals()
  if (!integration) return null
  const close = () => setIntegration(null)

  const fields: { key: string; label: string; type: 'number' | 'text' }[] =
    integration.type === 'gl'
      ? [
          { key: 'bal', label: 'Balance ($)', type: 'number' },
          { key: 'allow', label: 'Allowance ($ / week)', type: 'number' },
          { key: 'goal', label: 'Savings goal', type: 'text' },
          { key: 'goalCost', label: 'Goal cost ($)', type: 'number' },
          { key: 'saved', label: 'Saved so far ($)', type: 'number' },
        ]
      : integration.type === 'whoop'
        ? [
            { key: 'sleep', label: 'Sleep performance (%)', type: 'number' },
            { key: 'strain', label: 'Day strain (0–21)', type: 'number' },
          ]
        : [
            { key: 'sleep', label: 'Sleep score (0–100)', type: 'number' },
            { key: 'act', label: 'Activity goal (%)', type: 'number' },
          ]

  const title =
    integration.type === 'gl'
      ? 'Edit Greenlight'
      : integration.type === 'whoop'
        ? 'Edit WHOOP stats'
        : 'Edit Oura stats'

  const save = () => {
    const num = (v: string | number) => Math.max(0, parseFloat(String(v)) || 0)
    update((d) => {
      if (integration.type === 'gl') {
        const gl = d.gl[integration.mem]
        if (!gl) return
        Object.assign(gl, {
          bal: num(integration.vals.bal),
          allow: num(integration.vals.allow),
          goal: String(integration.vals.goal || 'Savings goal'),
          goalCost: num(integration.vals.goalCost),
          saved: num(integration.vals.saved),
        })
      } else {
        const fit = d.fit[integration.mem]
        if (!fit) return
        fit.sleep = num(integration.vals.sleep)
        if (fit.kind === 'whoop') fit.strain = num(integration.vals.strain)
        else fit.act = num(integration.vals.act)
      }
    })
    close()
    toast('Updated')
  }

  return (
    <Modal onClose={close} width={420} title={title}>
      {fields.map((f) => (
        <div key={f.key} style={{ marginBottom: 12 }}>
          <div style={{ fontWeight: 700, fontSize: '.78em', color: line(0.6), marginBottom: 5 }}>{f.label}</div>
          <input
            type={f.type}
            step="any"
            value={integration.vals[f.key] ?? ''}
            onChange={(e) =>
              setIntegration((prev) => ({ ...prev, vals: { ...prev.vals, [f.key]: e.target.value } }))
            }
            style={{
              width: '100%',
              boxSizing: 'border-box',
              border: `1.5px solid ${line(0.16)}`,
              borderRadius: 12,
              padding: '11px 13px',
              font: 'inherit',
              fontWeight: 600,
              color: INK,
              background: '#FCFCFE',
            }}
          />
        </div>
      ))}

      <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
        <button
          onClick={close}
          style={{
            flex: 1,
            border: `1px solid ${line(0.16)}`,
            background: 'none',
            borderRadius: 999,
            padding: 12,
            fontWeight: 700,
            cursor: 'pointer',
            color: INK,
          }}
        >
          Cancel
        </button>
        <button
          onClick={save}
          style={{
            flex: 1,
            border: 'none',
            background: INK,
            color: CREAM,
            borderRadius: 999,
            padding: 12,
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          Save
        </button>
      </div>
    </Modal>
  )
}

/** Tapping a month cell opens the day's plan. */
export function DayDetailModal() {
  const { data } = useFamily()
  const { dayDetail, setDayDetail, newEvent } = useModals()
  if (!dayDetail) return null

  const close = () => setDayDetail(null)
  const events = eventsOn(data, dayDetail, null)

  return (
    <Modal onClose={close} width={460}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
        <h2 style={{ ...HEADING, fontSize: '1.25em' }}>
          {parseDay(dayDetail).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
        </h2>
        <div style={{ flex: 1 }} />
        <button
          onClick={() => {
            newEvent(dayDetail)
            close()
          }}
          style={{
            background: INK,
            color: CREAM,
            border: 'none',
            borderRadius: 999,
            padding: '9px 15px',
            fontWeight: 700,
            cursor: 'pointer',
            fontSize: '.82em',
          }}
        >
          + Add
        </button>
      </div>

      {events.length ? (
        events.map((e) => <AgendaRow key={`${e.id}-${e.date}`} event={e} showRides={false} showDots={false} />)
      ) : (
        <div style={{ color: line(0.55), fontWeight: 600, padding: 14, textAlign: 'center' }}>Nothing planned.</div>
      )}
    </Modal>
  )
}
