import Anthropic from '@anthropic-ai/sdk'
import * as op from './onepassword.ts'

/**
 * The Sidekick: paste a school email, get back events and list items.
 *
 * The prototype called `window.claude.complete`, which only exists inside the
 * design tool's preview. Here the call runs server-side against the Claude API
 * so the key never reaches the browser — read from 1Password when a reference
 * is configured, otherwise from ANTHROPIC_API_KEY.
 */

export interface ExtractedEvent {
  title: string
  /** "YYYY-MM-DD" */
  date: string
  /** "HH:MM", or "" for an all-day event. */
  start: string
  /** 0 when unknown. */
  durationMin: number
  /** Member names; empty means the whole family. */
  members: string[]
  location: string
}

export interface ExtractedItem {
  list: string
  text: string
}

export interface Extraction {
  events: ExtractedEvent[]
  listItems: ExtractedItem[]
}

/**
 * Structured outputs constrain the reply to exactly this shape, so there's no
 * brace-hunting or JSON repair on the way back. Every object needs
 * `additionalProperties: false` and a complete `required` list.
 */
const SCHEMA = {
  type: 'object',
  properties: {
    events: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'What the event is called' },
          date: { type: 'string', description: 'YYYY-MM-DD, resolved from today' },
          start: { type: 'string', description: 'HH:MM in 24-hour time, or "" if all day' },
          durationMin: { type: 'integer', description: 'Length in minutes, or 0 if not stated' },
          members: {
            type: 'array',
            items: { type: 'string' },
            description: 'Family member names it applies to; empty for the whole family',
          },
          location: { type: 'string', description: 'Where it happens, or "" if not stated' },
        },
        required: ['title', 'date', 'start', 'durationMin', 'members', 'location'],
        additionalProperties: false,
      },
    },
    listItems: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          list: { type: 'string', description: 'Which list it belongs on, e.g. Groceries' },
          text: { type: 'string', description: 'The item itself' },
        },
        required: ['list', 'text'],
        additionalProperties: false,
      },
    },
  },
  required: ['events', 'listItems'],
  additionalProperties: false,
} as const

let cachedKey: string | null = null

async function apiKey(): Promise<string> {
  if (cachedKey) return cachedKey
  const ref = process.env.OP_ANTHROPIC_REF ?? ''
  if (ref) {
    cachedKey = await op.read(ref)
    return cachedKey
  }
  const direct = process.env.ANTHROPIC_API_KEY
  if (direct) {
    cachedKey = direct
    return cachedKey
  }
  throw new Error(
    'No Anthropic credentials — set OP_ANTHROPIC_REF to a 1Password item, or ANTHROPIC_API_KEY'
  )
}

export async function extract(text: string, memberNames: string[]): Promise<Extraction> {
  const client = new Anthropic({ apiKey: await apiKey() })
  const now = new Date()
  const today = now.toISOString().slice(0, 10)
  const weekday = now.toLocaleDateString('en-US', { weekday: 'long' })

  const response = await client.messages.create({
    model: 'claude-opus-5',
    max_tokens: 16000,
    output_config: {
      effort: 'low',
      format: { type: 'json_schema', schema: SCHEMA },
    },
    system:
      'You pull calendar events and shopping/to-do items out of school emails, camp schedules and team texts for a family dashboard. ' +
      'Resolve relative dates ("this Saturday", "next Wednesday") against today. ' +
      'Leave `members` empty when something applies to the whole family. ' +
      'Only include items that are actually stated — do not invent details.',
    messages: [
      {
        role: 'user',
        content:
          `Today is ${weekday}, ${today}. Family members: ${memberNames.join(', ')}.\n\n` +
          `TEXT:\n"""${text}"""`,
      },
    ],
  })

  if (response.stop_reason === 'refusal') {
    throw new Error('Claude declined to read that text.')
  }

  const block = response.content.find((b) => b.type === 'text')
  if (!block || block.type !== 'text') throw new Error('Empty response from Claude.')

  const parsed = JSON.parse(block.text) as Extraction
  return {
    events: (parsed.events ?? []).filter((e) => e.title && /^\d{4}-\d{2}-\d{2}$/.test(e.date)),
    listItems: (parsed.listItems ?? []).filter((i) => i.text),
  }
}

/** Whether the Sidekick has credentials available, for the UI to explain itself. */
export async function ready(): Promise<{ ok: boolean; reason?: string }> {
  try {
    await apiKey()
    return { ok: true }
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : 'Unavailable' }
  }
}
