import YAML from 'yaml'

/**
 * Small markdown helpers for the vault mirror. Everything here has to survive a
 * human editing the file in Obsidian, so parsing is deliberately forgiving:
 * unknown columns are ignored, whitespace is trimmed, and missing values fall
 * back to sensible defaults rather than throwing.
 */

export interface ParsedDoc {
  front: Record<string, unknown>
  body: string
}

const FRONT_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/

export function parseDoc(src: string): ParsedDoc {
  const m = FRONT_RE.exec(src)
  if (!m) return { front: {}, body: src }
  let front: Record<string, unknown> = {}
  try {
    front = (YAML.parse(m[1]) as Record<string, unknown>) ?? {}
  } catch {
    // A half-typed property shouldn't nuke the file — treat it as empty and
    // let the next write rewrite valid YAML.
    front = {}
  }
  return { front, body: src.slice(m[0].length) }
}

export function buildDoc(front: Record<string, unknown>, body: string): string {
  const yaml = YAML.stringify(front, { lineWidth: 0 }).trimEnd()
  return `---\n${yaml}\n---\n\n${body.trimStart()}`
}

/** Splits a markdown table cell row, tolerating missing edge pipes. */
function splitRow(line: string): string[] {
  let s = line.trim()
  if (s.startsWith('|')) s = s.slice(1)
  if (s.endsWith('|')) s = s.slice(0, -1)
  // Allow escaped pipes inside a cell.
  return s.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'))
}

const isDivider = (line: string) => /^\s*\|?[\s:-]*-[\s:|-]*\|?\s*$/.test(line) && line.includes('-')

/**
 * Reads every markdown table in `body`, returning rows keyed by lowercased
 * header name. Tables under different headings are all merged unless you
 * narrow the body first with `section()`.
 */
export function parseTable(body: string): Record<string, string>[] {
  const lines = body.split('\n')
  const rows: Record<string, string>[] = []
  let headers: string[] | null = null

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!line.includes('|')) {
      headers = null
      continue
    }
    if (isDivider(line)) continue
    const cells = splitRow(line)
    if (!headers) {
      // A header row is only a header if a divider follows it.
      if (i + 1 < lines.length && isDivider(lines[i + 1])) {
        headers = cells.map((c) => c.toLowerCase())
      }
      continue
    }
    if (cells.every((c) => !c)) continue
    const row: Record<string, string> = {}
    headers.forEach((h, j) => (row[h] = cells[j] ?? ''))
    rows.push(row)
  }
  return rows
}

export function buildTable(headers: string[], rows: (string | number | null | undefined)[][]): string {
  const esc = (v: string | number | null | undefined) =>
    String(v ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ') || ' '
  const head = `| ${headers.join(' | ')} |`
  const div = `| ${headers.map(() => '---').join(' | ')} |`
  const body = rows.map((r) => `| ${r.map(esc).join(' | ')} |`).join('\n')
  return rows.length ? `${head}\n${div}\n${body}\n` : `${head}\n${div}\n`
}

/** Returns the slice of `body` under the given `##`-level heading (any depth). */
export function section(body: string, heading: string): string {
  const lines = body.split('\n')
  const want = heading.trim().toLowerCase()
  let start = -1
  let level = 0
  for (let i = 0; i < lines.length; i++) {
    const m = /^(#{1,6})\s+(.*)$/.exec(lines[i])
    if (!m) continue
    if (start < 0) {
      if (m[2].trim().toLowerCase() === want) {
        start = i + 1
        level = m[1].length
      }
    } else if (m[1].length <= level) {
      return lines.slice(start, i).join('\n')
    }
  }
  return start < 0 ? '' : lines.slice(start).join('\n')
}

export interface TaskLine {
  done: boolean
  text: string
  /** Obsidian block reference (`^c1`) used to carry the task key. */
  ref: string | null
  /** Inline `#by/elizabeth` tag, lowercased without the prefix. */
  by: string | null
}

const TASK_RE = /^\s*[-*]\s+\[( |x|X)\]\s+(.*)$/

export function parseTasks(body: string): TaskLine[] {
  const out: TaskLine[] = []
  for (const line of body.split('\n')) {
    const m = TASK_RE.exec(line)
    if (!m) continue
    let text = m[2].trim()
    let ref: string | null = null
    let by: string | null = null

    const refM = /\s\^([A-Za-z0-9_-]+)\s*$/.exec(text)
    if (refM) {
      ref = refM[1]
      text = text.slice(0, refM.index).trim()
    }
    const byM = /#by\/([A-Za-z0-9_-]+)/.exec(text)
    if (byM) {
      by = byM[1].toLowerCase()
      text = text.replace(byM[0], '').trim()
    }
    out.push({ done: m[1].toLowerCase() === 'x', text, ref, by })
  }
  return out
}

export function buildTask(done: boolean, text: string, opts: { ref?: string | null; by?: string | null } = {}): string {
  const tag = opts.by ? ` #by/${opts.by}` : ''
  const ref = opts.ref ? ` ^${opts.ref}` : ''
  return `- [${done ? 'x' : ' '}] ${text}${tag}${ref}`
}

/** Filesystem- and id-safe slug. */
export function slug(s: string): string {
  return (
    s
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^\w\s-]/g, '')
      .trim()
      .replace(/[\s_]+/g, '-')
      .replace(/-+/g, '-')
      .slice(0, 48) || 'item'
  )
}

/** Makes slugs unique within one collection, appending -2, -3, … */
export function uniqueSlug(base: string, taken: Set<string>): string {
  let id = base
  let n = 2
  while (taken.has(id)) id = `${base}-${n++}`
  taken.add(id)
  return id
}

export const parseNum = (v: string | undefined, fallback = 0): number => {
  const n = parseFloat(String(v ?? '').replace(/[^0-9.-]/g, ''))
  return Number.isFinite(n) ? n : fallback
}

export const parseBool = (v: unknown, fallback = false): boolean => {
  if (typeof v === 'boolean') return v
  const s = String(v ?? '').trim().toLowerCase()
  if (['yes', 'true', 'x', '1', 'on'].includes(s)) return true
  if (['no', 'false', '', '0', 'off'].includes(s)) return fallback && s === ''
  return fallback
}
