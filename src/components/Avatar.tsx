import type { CSSProperties } from 'react'
import type { Member } from '../types.ts'
import { avatarInitial, avatarStyle } from '../lib/selectors.ts'

/**
 * A member's dot: their photo if we have one, otherwise their initial on their
 * colour. Sizes are passed in because the design uses a different one in almost
 * every context (30 in the rail, 36 in lists, 64 in the chore ring, 72 on the hero).
 */
export function Avatar({
  member,
  size,
  fontSize,
  style,
  onClick,
  title,
}: {
  member: Member
  size: number
  fontSize?: string | number
  style?: CSSProperties
  onClick?: () => void
  title?: string
}) {
  const base: CSSProperties = {
    width: size,
    height: size,
    borderRadius: '50%',
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#F7F9FF',
    fontFamily: "'Outfit', sans-serif",
    fontWeight: 600,
    fontSize: fontSize ?? size * 0.42,
    ...(onClick ? { border: 'none', cursor: 'pointer', padding: 0 } : {}),
    ...style,
  }
  const resolved = avatarStyle(member, base)

  if (onClick) {
    return (
      <button type="button" onClick={onClick} title={title ?? member.name} style={resolved}>
        {avatarInitial(member)}
      </button>
    )
  }
  return (
    <div title={title} style={resolved}>
      {avatarInitial(member)}
    </div>
  )
}
