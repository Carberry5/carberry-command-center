import { useEffect, useState } from 'react'
import { uid } from '../lib/dates.ts'
import { memberById } from '../lib/selectors.ts'
import { CREAM, FAM, HEADING, INK, card, line } from '../lib/theme.ts'
import { useFamily, useLayout } from '../store/FamilyStore.tsx'
import { CheckBox } from '../components/CheckBox.tsx'

/** Groceries, Target runs, the summer bucket list — anything the family tracks. */
export function ListsPage() {
  const { data, update, requirePin } = useFamily()
  const { narrow } = useLayout()
  const [selected, setSelected] = useState<string | null>(data.lists[0]?.id ?? null)
  const [newItem, setNewItem] = useState('')
  const [newList, setNewList] = useState('')

  // The vault can add or remove lists underneath us.
  useEffect(() => {
    if (!data.lists.some((l) => l.id === selected)) setSelected(data.lists[0]?.id ?? null)
  }, [data.lists, selected])

  const current = data.lists.find((l) => l.id === selected) ?? data.lists[0]

  const addItem = () => {
    const text = newItem.trim()
    if (!text || !current) return
    update((d) => {
      d.lists.find((l) => l.id === current.id)?.items.push({ id: uid(), text, done: false, by: 'e' })
    })
    setNewItem('')
  }

  const addList = () => {
    const name = newList.trim()
    if (!name) return
    const id = uid()
    update((d) => {
      d.lists.push({ id, name, items: [] })
    })
    setNewList('')
    setSelected(id)
  }

  return (
    <section
      style={{
        animation: 'fadeUp .35s ease both',
        display: 'grid',
        gridTemplateColumns: narrow ? '1fr' : '230px 1fr',
        gap: 18,
        alignItems: 'start',
      }}
    >
      <div style={{ ...card, borderRadius: 20, padding: 14 }}>
        {data.lists.map((l) => {
          const on = current?.id === l.id
          return (
            <button
              key={l.id}
              onClick={() => setSelected(l.id)}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                border: 'none',
                borderRadius: 14,
                padding: '12px 14px',
                fontWeight: 700,
                cursor: 'pointer',
                fontSize: '.92em',
                marginBottom: 4,
                background: on ? INK : 'none',
                color: on ? CREAM : INK,
              }}
            >
              {l.name}
              <span style={{ float: 'right', opacity: 0.6 }}>{l.items.filter((i) => !i.done).length}</span>
            </button>
          )
        })}
        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          <input
            value={newList}
            onChange={(e) => setNewList(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addList()}
            placeholder="New list…"
            style={{
              flex: 1,
              minWidth: 0,
              background: '#FFF',
              border: `1.5px solid ${line(0.16)}`,
              borderRadius: 12,
              padding: '9px 12px',
              fontSize: '.88em',
              fontWeight: 600,
              color: INK,
              outlineColor: '#7C5CE0',
            }}
          />
          <button
            onClick={addList}
            style={{
              background: INK,
              color: CREAM,
              border: 'none',
              borderRadius: 12,
              padding: '9px 13px',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            +
          </button>
        </div>
      </div>

      <div style={{ ...card, borderRadius: 20, padding: '18px 20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
          <h2 style={{ ...HEADING, fontSize: '1.2em' }}>{current?.name ?? 'No lists'}</h2>
          <div style={{ flex: 1 }} />
          <button
            onClick={() =>
              current &&
              update((d) => {
                const l = d.lists.find((x) => x.id === current.id)
                if (l) l.items = l.items.filter((i) => !i.done)
              })
            }
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
            Clear checked
          </button>
          <button
            onClick={() =>
              current &&
              requirePin(() => {
                update((d) => {
                  d.lists = d.lists.filter((x) => x.id !== current.id)
                })
                setSelected(null)
              }, 'Deleting a list is parent-only')
            }
            style={{
              border: 'none',
              background: 'rgba(217,91,67,.1)',
              color: '#B23B22',
              borderRadius: 999,
              padding: '8px 14px',
              fontWeight: 700,
              cursor: 'pointer',
              fontSize: '.8em',
            }}
          >
            Delete list
          </button>
        </div>

        {!current || !current.items.length ? (
          <div style={{ color: line(0.55), fontWeight: 600, padding: '18px 4px', textAlign: 'center' }}>
            Nothing here yet — add the first item below.
          </div>
        ) : null}

        {current?.items.map((item) => {
          const toggle = () =>
            update((d) => {
              const it = d.lists.find((l) => l.id === current.id)?.items.find((x) => x.id === item.id)
              if (it) it.done = !it.done
            })
          return (
            <div
              key={item.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 11,
                padding: '8px 4px',
                borderBottom: `1px solid ${line(0.07)}`,
                minHeight: 46,
              }}
            >
              <div onClick={toggle}>
                <CheckBox on={item.done} />
              </div>
              <div
                onClick={toggle}
                style={{
                  flex: 1,
                  fontWeight: 700,
                  fontSize: '.95em',
                  cursor: 'pointer',
                  textDecoration: item.done ? 'line-through' : 'none',
                  opacity: item.done ? 0.45 : 1,
                }}
              >
                {item.text}
              </div>
              <div
                title={memberById(data, item.by)?.name}
                style={{ width: 11, height: 11, borderRadius: '50%', background: memberById(data, item.by)?.color ?? FAM }}
              />
              <button
                onClick={() =>
                  update((d) => {
                    const l = d.lists.find((x) => x.id === current.id)
                    if (l) l.items = l.items.filter((x) => x.id !== item.id)
                  })
                }
                className="x-hover"
                style={{
                  border: 'none',
                  background: 'none',
                  color: line(0.4),
                  fontWeight: 800,
                  cursor: 'pointer',
                  fontSize: '1em',
                  padding: 6,
                }}
              >
                ✕
              </button>
            </div>
          )
        })}

        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
          <input
            value={newItem}
            onChange={(e) => setNewItem(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addItem()}
            placeholder="Add an item… (Enter)"
            style={{
              flex: 1,
              background: '#FFF',
              border: `1.5px solid ${line(0.16)}`,
              borderRadius: 999,
              padding: '11px 16px',
              fontSize: '.92em',
              fontWeight: 600,
              color: INK,
              outlineColor: '#7C5CE0',
            }}
          />
          <button
            onClick={addItem}
            style={{
              background: INK,
              color: CREAM,
              border: 'none',
              borderRadius: 999,
              padding: '11px 20px',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            Add
          </button>
        </div>
      </div>
    </section>
  )
}
