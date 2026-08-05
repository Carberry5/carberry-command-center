import type { CSSProperties } from 'react'

/**
 * The Carberry mark: a tree whose canopy sweeps into a "C", with a lit tip for
 * each branch.
 *
 * Drawn rather than imported so it stays crisp on the TV, inherits nothing from
 * the icon set, and costs no network request. The geometry is polar — every
 * branch leaves the canopy at its own angle on a circle of radius 27 about
 * (60, 58) — which is why the numbers below look arbitrary. Branches only ever
 * leave in the upper half; a fan that radiates evenly reads as a sunburst
 * rather than a tree.
 */

const GREEN = '#2F5A47'
const CLAY = '#C0603A'
const GOLD = '#C9A063'
const CREAM = '#FBEFD2'

interface Tip {
  d: string
  cx: number
  cy: number
  r: number
  lit: boolean
}

const BRANCHES: Tip[] = [
  { d: 'M81.3 41.4Q89.4 33.0 94.5 24.7', cx: 94.5, cy: 24.7, r: 3.6, lit: true },
  { d: 'M74.3 35.1Q79.6 28.7 85.0 24.2', cx: 85.0, cy: 24.2, r: 2.6, lit: false },
  { d: 'M66.5 31.8Q68.4 18.7 68.0 7.6', cx: 68.0, cy: 7.6, r: 4.0, lit: true },
  { d: 'M57.2 31.1Q57.6 21.7 59.6 14.0', cx: 59.6, cy: 14.0, r: 2.8, lit: false },
  { d: 'M48.2 33.7Q41.4 23.6 34.0 16.4', cx: 34.0, cy: 16.4, r: 3.6, lit: true },
  { d: 'M39.9 39.9Q34.5 33.7 30.8 27.8', cx: 30.8, cy: 27.8, r: 2.6, lit: false },
  { d: 'M34.6 48.8Q24.4 46.4 15.6 46.1', cx: 15.6, cy: 46.1, r: 3.2, lit: true },
]

/** Forks off the two longest branches, so the canopy isn't a plain fan. */
const FORKS: Tip[] = [
  { d: 'M68.4 18.7Q64.8 12.1 58.3 8.2', cx: 58.3, cy: 8.2, r: 2.4, lit: false },
  { d: 'M41.6 23.5Q45.8 15.7 50.9 11.0', cx: 50.9, cy: 11.0, r: 2.4, lit: true },
]

/**
 * Clay arcs tying each limb to its neighbour — the warm note in an otherwise
 * green mark. They run between the branches rather than across them; drawn as
 * separate sticks they read as debris caught in the tree.
 */
const CONNECTORS = [
  'M88.6 33.1Q87.7 27.3 79.6 29.3',
  'M79.6 29.3Q76.5 19.2 67.8 19.3',
  'M67.8 19.3Q63.0 15.4 58.0 22.2',
  'M58.0 22.2Q48.4 17.5 41.3 24.4',
  'M41.3 24.4Q35.0 24.8 35.0 33.8',
  'M35.0 33.8Q25.0 37.0 24.8 47.0',
]

export function Logo({ size = 40, style }: { size?: number; style?: CSSProperties }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 116 116"
      fill="none"
      style={style}
      role="img"
      aria-label="Carberry Command Center"
    >
      <defs>
        <filter id="cc-glow" x="-70%" y="-70%" width="240%" height="240%">
          <feGaussianBlur stdDeviation="2.4" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      <g strokeLinecap="round" strokeLinejoin="round">
        {/* Leaf slivers in the counter of the C, behind everything. */}
        <path d="M58 46Q45 55 47.5 70Q57 59 58 46Z" fill={GOLD} opacity={0.9} />
        <path d="M64 66Q53.5 73 55 85Q63.5 74 64 66Z" fill={GOLD} opacity={0.72} />

        {/* Canopy into trunk: one stroke, the C left open to the right. The arc
            runs on to bottom-centre so the trunk falls straight rather than
            swinging back across the mark. */}
        <path
          d="M72.7 34.2A27 27 0 1 0 62.4 84.9C60 91 58.6 95 58.4 98"
          stroke={GREEN}
          strokeWidth={7.5}
        />
        {/* Two roots, an inverted V under the trunk. */}
        <path d="M58.6 96C55 99.5 51.5 102 48 105" stroke={GREEN} strokeWidth={6} />
        <path d="M58.6 96C62 99.5 65.5 102 69 105" stroke={GREEN} strokeWidth={6} />
        {/* The clay sliver down the inside of the right root. */}
        <path d="M60 97.5Q63.5 101 65 105" stroke={CLAY} strokeWidth={3.6} />

        {CONNECTORS.map((d) => (
          <path key={d} d={d} stroke={CLAY} strokeWidth={3} />
        ))}

        {[...BRANCHES, ...FORKS].map((b) => (
          <path key={b.d} d={b.d} stroke={GREEN} strokeWidth={b.r > 3 ? 4.8 : 3.8} />
        ))}

        {/* Lights last, so no stroke crosses them. */}
        <g filter="url(#cc-glow)">
          {[...BRANCHES, ...FORKS].map((b) => (
            <circle key={`${b.cx}-${b.cy}`} cx={b.cx} cy={b.cy} r={b.r} fill={b.lit ? CREAM : GREEN} />
          ))}
        </g>
      </g>
    </svg>
  )
}
