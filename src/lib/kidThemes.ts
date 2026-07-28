import type { CSSProperties } from 'react'
import type { Member } from '../types.ts'

/**
 * The themed profile heroes: Hadley's deep space, Cannon's Notre Dame → Bills,
 * Rowan's dirt track. Every other member gets the plain tinted hero.
 */

const ROCKET =
  'M12 2.2c2.9 2.4 4 6 4 9.1l-4 4.2-4-4.2c0-3.1 1.1-6.7 4-9.1zM12 8a1.6 1.6 0 1 0 0 3.2A1.6 1.6 0 0 0 12 8zM8 11.5l-2.8 2.8.9 2.8 2.6-1M16 11.5l2.8 2.8-.9 2.8-2.6-1M12 15.5v3.2M10.2 21h3.6'
const PLANET =
  'M12 5.6a6.4 6.4 0 1 0 0 12.8 6.4 6.4 0 0 0 0-12.8M5.8 9.8c-2.6.9-4.2 2-3.9 3 .4 1.4 4.2 1.4 8.6 0 4.3-1.4 7.5-3.5 7.1-4.9-.3-1-2.3-1.1-4.9-.5'
const MOON = 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z'
export const STAR = 'M12 3.5l2.4 5 5.4.7-4 3.8 1 5.4-4.8-2.6-4.8 2.6 1-5.4-4-3.8 5.4-.7z'
const BALL =
  'M4.6 15.2C4.6 9.2 9.2 4.6 15.2 4.6c2.3 0 4.2 1.9 4.2 4.2 0 6-4.6 10.6-10.6 10.6-2.3 0-4.2-1.9-4.2-4.2zM9.3 14.7l5.4-5.4M10.5 11.6l1.9 1.9M12.6 9.5l1.9 1.9'
const GOAL = 'M12 20v-9M5 11V4M19 11V4M5 11h14M8.5 20h7'
const LAX =
  'M14.8 3.2a4.6 4.6 0 0 1 4.6 4.6c0 2.9-2.3 5.2-5.2 5.2-1.3 0-2.5-.5-3.4-1.3L4.2 18.4M12.4 4.9l4.4 4.4M10.9 7.6l3.6 3.6'
const TRUCK =
  'M7 11.9a3.6 3.6 0 1 0 0 7.2 3.6 3.6 0 0 0 0-7.2zM17 11.9a3.6 3.6 0 1 0 0 7.2 3.6 3.6 0 0 0 0-7.2zM10.6 15.5h2.8M8.4 10L9.6 4.8h5l1.4 5.2M9.9 7.4h5.4M4.6 10h14.8'
const BOLT = 'M13 2.5L5.5 13H10l-1.5 8.5L16 11h-4.5z'
const FLAG = 'M5.5 21V4.2c3.8-2 6.2 2 10 0V13c-3.8 2-6.2-2-10 0'

export interface Deco {
  key: string
  d: string
  filled: boolean
  style: CSSProperties
}

export interface KidTheme {
  tag: string
  bg: string
  fg: string
  sub: string
  deco: Deco[]
}

const deco = (
  d: string,
  right: number,
  top: number,
  size: number,
  color: string,
  opacity: number,
  rotate = 0,
  filled = false
): Deco => ({
  key: `${right}-${top}`,
  d,
  filled,
  style: {
    position: 'absolute',
    right,
    top,
    width: size,
    height: size,
    color,
    opacity,
    transform: `rotate(${rotate}deg)`,
  },
})

export function kidTheme(m: Member | undefined): KidTheme | null {
  const n = (m?.name ?? '').toLowerCase()

  if (n === 'hadley')
    return {
      tag: 'Future astronaut',
      bg: 'linear-gradient(115deg,#1B2145 30%,#454FA0 70%,#7C5CE0)',
      fg: '#F7F9FF',
      sub: 'rgba(247,249,255,.72)',
      deco: [
        deco(ROCKET, 36, 14, 62, '#F7F9FF', 0.6, 16),
        deco(PLANET, 128, 52, 44, '#B9A6F1', 0.55, -8),
        deco(MOON, 300, 18, 28, '#F7F9FF', 0.4),
        deco(STAR, 215, 16, 20, '#FFD98A', 0.85, 0, true),
        deco(STAR, 255, 68, 13, '#FFD98A', 0.6, 0, true),
        deco(STAR, 108, 10, 11, '#F7F9FF', 0.7, 0, true),
      ],
    }

  if (n === 'cannon')
    return {
      tag: 'Go Irish · Go Bills',
      bg: 'linear-gradient(115deg,#0C2340 35%,#1D4FA8 75%,#3D6DE8)',
      fg: '#F7F9FF',
      sub: 'rgba(247,249,255,.72)',
      deco: [
        deco(BALL, 38, 16, 58, '#C99700', 0.8, -6),
        deco(GOAL, 130, 26, 54, '#F7F9FF', 0.45),
        deco(LAX, 214, 14, 46, '#E8646F', 0.6, 8),
        deco(STAR, 285, 60, 15, '#C99700', 0.65, 0, true),
      ],
    }

  if (n === 'rowan')
    return {
      tag: 'Monster truck racer',
      bg: 'linear-gradient(115deg,#14301E 30%,#1F8A5B 75%,#37B87F)',
      fg: '#F7F9FF',
      sub: 'rgba(247,249,255,.72)',
      deco: [
        deco(TRUCK, 36, 16, 66, '#F7F9FF', 0.7),
        deco(BOLT, 140, 10, 30, '#FFD98A', 0.75, 10, true),
        deco(FLAG, 196, 34, 40, '#F7F9FF', 0.45),
        deco(BOLT, 258, 58, 16, '#FFD98A', 0.55, -8, true),
      ],
    }

  return null
}
