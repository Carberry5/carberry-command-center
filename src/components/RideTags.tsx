import type { FamilyData, ResolvedEvent } from '../types.ts'
import { memberById } from '../lib/selectors.ts'
import { Icon, PATHS } from './Icon.tsx'

/**
 * "Drop · Patrick" / "Pick · Elizabeth" pills. Colour-coded to whichever parent
 * is driving so a glance at the agenda answers "who's got the run?".
 */
export function RideTags({
  data,
  event,
  short = true,
  iconSize = 13,
}: {
  data: FamilyData
  event: Pick<ResolvedEvent, 'drop' | 'pick'>
  short?: boolean
  iconSize?: number
}) {
  const tags = (
    [
      ['drop', 'Drop-off', 'Drop', PATHS.dropOff],
      ['pick', 'Pick-up', 'Pick', PATHS.pickUp],
    ] as const
  )
    .map(([field, longLabel, shortLabel, d]) => {
      const id = event[field]
      const m = memberById(data, id)
      return m ? { field, label: short ? shortLabel : longLabel, d, m } : null
    })
    .filter((t): t is NonNullable<typeof t> => !!t)

  if (!tags.length) return null

  return (
    <>
      {tags.map((t) => (
        <div
          key={t.field}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            fontWeight: 700,
            fontSize: '.72em',
            borderRadius: 999,
            padding: '3px 8px',
            whiteSpace: 'nowrap',
            color: '#F7F9FF',
            background: t.m.color,
          }}
        >
          <Icon d={t.d} size={iconSize} strokeWidth={1.9} />
          {t.label} · {t.m.name}
        </div>
      ))}
    </>
  )
}
