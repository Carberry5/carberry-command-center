import type { CSSProperties } from 'react'

/** Palette and reusable style builders, lifted verbatim from the design. */

export const INK = '#232A3D'
export const CREAM = '#F7F9FF'
/** The whole-family purple, used when no single member owns something. */
export const FAM = '#8A63C9'
export const BG = '#F4F6FB'
export const BLUE = '#3D6DE8'
export const BLUE_DARK = '#2A4FB8'
export const PURPLE = '#7C5CE0'
export const PURPLE_TEXT = '#6D4FD1'
export const GREEN = '#1F8A5B'
export const CHECK = '#22A06B'
export const GREENLIGHT = '#18A957'
export const DANGER = '#B23B22'
export const ALERT = '#D9435B'
export const AMBER = '#E2924A'
export const AMBER_TEXT = '#8A5A1E'

export const line = (a: number) => `rgba(35,42,61,${a})`

export const HEADING: CSSProperties = { fontFamily: "'Outfit', sans-serif", fontWeight: 600, margin: 0 }

/** The standard white card. */
export const card: CSSProperties = {
  background: '#FFFFFF',
  border: `1px solid ${line(0.1)}`,
  borderRadius: 22,
  boxShadow: '0 8px 24px -18px rgba(35,42,61,.3)',
}

export const cardPad: CSSProperties = { ...card, padding: '20px 22px' }
/** The tighter padding the reworked Today page uses. */
export const cardTight: CSSProperties = { ...card, padding: '14px 16px' }

export const h2: CSSProperties = { ...HEADING, fontSize: '1.18em' }

/** Pill toggle — the design's `chipSt`. */
export function chip(on: boolean): CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    padding: '8px 14px',
    fontWeight: 700,
    fontSize: '.82em',
    cursor: 'pointer',
    border: `1.5px solid ${on ? INK : line(0.16)}`,
    background: on ? INK : '#FFFFFF',
    color: on ? CREAM : INK,
    minHeight: 38,
  }
}

/** Checkbox square — the design's `ck`. */
export function check(on: boolean): CSSProperties {
  return {
    width: 26,
    height: 26,
    borderRadius: 9,
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    transition: 'all .15s',
    border: `2px solid ${on ? CHECK : line(0.25)}`,
    background: on ? CHECK : '#FFF',
  }
}

/** The tick mark path drawn inside a checked box. */
export const CHECK_PATH = 'M5 12.5l5 5 9-11'

export const primaryBtn: CSSProperties = {
  background: INK,
  color: CREAM,
  border: 'none',
  borderRadius: 999,
  padding: '11px 18px',
  fontWeight: 700,
  cursor: 'pointer',
  fontSize: '.9em',
  minHeight: 44,
}

export const quietBtn: CSSProperties = {
  border: `1px solid ${line(0.16)}`,
  background: '#F7F9FF',
  borderRadius: 999,
  padding: '8px 14px',
  fontWeight: 700,
  cursor: 'pointer',
  fontSize: '.8em',
  color: INK,
}

export const linkBtn: CSSProperties = {
  background: 'none',
  border: 'none',
  color: BLUE,
  fontWeight: 700,
  cursor: 'pointer',
  fontSize: '.85em',
  padding: 6,
}

export const dangerBtn: CSSProperties = {
  border: 'none',
  background: 'rgba(217,91,67,.1)',
  color: DANGER,
  borderRadius: 999,
  padding: '8px 14px',
  fontWeight: 700,
  cursor: 'pointer',
  fontSize: '.8em',
}

export const input: CSSProperties = {
  background: '#FFF',
  border: `1.5px solid ${line(0.16)}`,
  borderRadius: 14,
  padding: '12px 14px',
  fontWeight: 600,
  fontSize: '.95em',
  color: INK,
  outlineColor: PURPLE,
  fontFamily: 'inherit',
}

/** Small square day-picker button used in the pre-flight settings. */
export function dayChip(on: boolean, small = false): CSSProperties {
  const size = small ? 28 : 36
  return {
    width: size,
    height: size,
    borderRadius: small ? 8 : 10,
    border: `1.5px solid ${on ? INK : line(0.16)}`,
    background: on ? INK : '#FFF',
    color: on ? CREAM : INK,
    fontWeight: 700,
    cursor: 'pointer',
    fontSize: small ? '.68em' : '.8em',
  }
}

/** Colour swatches offered when editing a member. */
export const SWATCHES = ['#0F8B8D', '#3D6DE8', '#8B5CF6', '#31A05F', '#8A63C9', '#2E9E6B', '#7C5CE0', '#5B8DEF']
