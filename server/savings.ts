import Anthropic from '@anthropic-ai/sdk'
import type { Deal, SavingsStoreId, Staple } from '../src/types.ts'
import { storeById } from '../src/lib/savings.ts'
import * as op from './onepassword.ts'

/**
 * The savings module's Claude calls, following the Sidekick pattern: the key
 * never reaches the browser, structured outputs mean no JSON repair, and the
 * endpoints are stateless — the client sends the context and commits the
 * result through its normal update()/sync path, so this works identically
 * whether the store is the vault or Supabase.
 *
 * Two jobs:
 *   extractDeals — turn an ad page (fetched server-side or pasted) into Deal
 *                  rows, each matched against the family's staples.
 *   buildPlan    — given staples, current deals, the week's dinner plan and
 *                  the grocery list, write the week's shopping strategy and
 *                  concrete store-by-store picks.
 */

// ---------------------------------------------------------------------------
// Credentials — shared shape with sidekick.ts, cached per process.
// ---------------------------------------------------------------------------

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

export async function ready(): Promise<{ ok: boolean; reason?: string }> {
  try {
    await apiKey()
    return { ok: true }
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : 'Unavailable' }
  }
}

// ---------------------------------------------------------------------------
// Fetching an ad page server-side
// ---------------------------------------------------------------------------

/** Roughly what fits comfortably in one extraction call. */
const MAX_TEXT = 60_000

/** Strips an HTML page down to readable text for the extractor. */
export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|li|tr|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim()
}

/**
 * Best-effort server-side fetch of a store's ad page. Grocery sites are
 * JS-heavy and bot-guarded, so this succeeding is a bonus, not the plan —
 * when it fails (or comes back as an empty shell) the error tells the family
 * to paste the page instead, which always works.
 */
export async function fetchStoreText(store: SavingsStoreId): Promise<string> {
  const meta = storeById(store)
  const pasteHint = `Open ${meta.url}, select all (Cmd-A), copy, and use "Paste the ad" instead.`
  let html: string
  try {
    const r = await fetch(meta.url, {
      redirect: 'follow',
      headers: {
        accept: 'text/html,application/xhtml+xml',
        'accept-language': 'en-US,en;q=0.9',
        'user-agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
      },
      signal: AbortSignal.timeout(20_000),
    })
    if (!r.ok) throw new Error(`${meta.name} responded ${r.status}`)
    html = await r.text()
  } catch (err) {
    const why = err instanceof Error ? err.message : 'fetch failed'
    throw new Error(`Could not reach ${meta.name} (${why}). ${pasteHint}`)
  }
  const text = htmlToText(html)
  // A JS-only shell strips down to almost nothing — worthless to the extractor.
  if (text.length < 500) {
    throw new Error(`${meta.name} sent a page with no readable deals (it needs a browser). ${pasteHint}`)
  }
  return text.slice(0, MAX_TEXT)
}

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

const DEALS_SCHEMA = {
  type: 'object',
  properties: {
    deals: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          item: { type: 'string', description: 'The product, cleanly named ("Chicken thighs, bone-in")' },
          price: { type: 'string', description: 'Sale price as shown: "$2.99/lb", "2 for $6", "BOGO"' },
          savings: { type: 'string', description: '"Save $1.50", "30% off", or "" if not stated' },
          detail: { type: 'string', description: 'Conditions: "limit 2", "with card", "Deal Lock", or ""' },
          ends: { type: 'string', description: 'YYYY-MM-DD the deal ends, or "" if not stated' },
          stapleId: {
            type: 'string',
            description: 'The id of the matching staple from the provided list, or "" if none matches',
          },
        },
        required: ['item', 'price', 'savings', 'detail', 'ends', 'stapleId'],
        additionalProperties: false,
      },
    },
  },
  required: ['deals'],
  additionalProperties: false,
} as const

export interface ExtractedDeal {
  item: string
  price: string
  savings: string
  detail: string
  ends: string
  stapleId: string | null
}

/**
 * Reads deals out of an ad page's text and matches each against the staples.
 * Returns plain data — the caller mints ids and commits through its own store.
 */
export async function extractDeals(
  store: SavingsStoreId,
  text: string,
  staples: Staple[]
): Promise<ExtractedDeal[]> {
  const client = new Anthropic({ apiKey: await apiKey() })
  const meta = storeById(store)
  const now = new Date()
  const today = now.toISOString().slice(0, 10)
  const stapleLines = staples.map((s) => `${s.id}: ${s.name} (${s.category})`).join('\n')

  const response = await client.messages.create({
    model: 'claude-opus-5',
    max_tokens: 32000,
    output_config: {
      effort: 'low',
      format: { type: 'json_schema', schema: DEALS_SCHEMA },
    },
    system:
      'You extract grocery deals from store ad pages, weekly circulars, and deal emails for a family budget dashboard. ' +
      'Each deal is one product with its sale price. Skip navigation text, category names without prices, and duplicates. ' +
      'Resolve relative end dates ("through Tuesday") against today. ' +
      'Match each deal against the STAPLES list generously but honestly: "Boneless chicken thighs $1.99/lb" matches the ' +
      '"Chicken thighs" staple; "chicken-flavored ramen" does not match "Chicken breast". A staple id must come from the ' +
      'list verbatim; use "" when nothing on the list genuinely covers the product. Do not invent deals or prices.',
    messages: [
      {
        role: 'user',
        content:
          `Today is ${today}. Store: ${meta.name}.\n\n` +
          `STAPLES (id: name):\n${stapleLines}\n\n` +
          `AD PAGE TEXT:\n"""${text.slice(0, MAX_TEXT)}"""`,
      },
    ],
  })

  if (response.stop_reason === 'refusal') throw new Error('Claude declined to read that page.')
  const block = response.content.find((b) => b.type === 'text')
  if (!block || block.type !== 'text') throw new Error('Empty response from Claude.')

  const parsed = JSON.parse(block.text) as { deals?: ExtractedDeal[] }
  const known = new Set(staples.map((s) => s.id))
  return (parsed.deals ?? [])
    .filter((d) => d.item?.trim() && d.price?.trim())
    .map((d) => ({
      item: d.item.trim(),
      price: d.price.trim(),
      savings: (d.savings ?? '').trim(),
      detail: (d.detail ?? '').trim(),
      ends: /^\d{4}-\d{2}-\d{2}$/.test((d.ends ?? '').trim()) ? d.ends.trim() : '',
      stapleId: known.has((d.stapleId ?? '').trim()) ? (d.stapleId ?? '').trim() : null,
    }))
}

// ---------------------------------------------------------------------------
// The weekly plan
// ---------------------------------------------------------------------------

const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    summary: {
      type: 'string',
      description:
        'The week\'s shopping strategy in short plain-text paragraphs and dashed lists: which store leads, what to stock up on, what to skip. No markdown headings.',
    },
    picks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          store: { type: 'string', enum: ['foodlion', 'giant', 'costco', 'amazon'] },
          item: { type: 'string', description: 'What to buy, as it should appear on the grocery list' },
          note: { type: 'string', description: 'Why: "$1.99/lb, save $2 — taco night Tue"' },
        },
        required: ['store', 'item', 'note'],
        additionalProperties: false,
      },
    },
  },
  required: ['summary', 'picks'],
  additionalProperties: false,
} as const

export interface PlanInput {
  staples: Staple[]
  deals: Deal[]
  /** The next week's dinner plan, "YYYY-MM-DD: meal" lines. */
  dinners: { date: string; meal: string }[]
  /** Unchecked grocery-list items. */
  groceries: string[]
}

export interface PlanResult {
  summary: string
  picks: { store: SavingsStoreId; item: string; note: string }[]
}

export async function buildPlan(input: PlanInput): Promise<PlanResult> {
  const client = new Anthropic({ apiKey: await apiKey() })
  const now = new Date()
  const today = now.toISOString().slice(0, 10)
  const weekday = now.toLocaleDateString('en-US', { weekday: 'long' })

  const stapleById = new Map(input.staples.map((s) => [s.id, s]))
  const dealLines = input.deals
    .map((d) => {
      const staple = d.stapleId ? stapleById.get(d.stapleId) : null
      return (
        `[${storeById(d.store).name}] ${d.item} — ${d.price}` +
        (d.savings ? ` (${d.savings})` : '') +
        (d.detail ? ` · ${d.detail}` : '') +
        (d.ends ? ` · ends ${d.ends}` : '') +
        (staple ? ` · staple: ${staple.name}` : '')
      )
    })
    .join('\n')

  const response = await client.messages.create({
    model: 'claude-opus-5',
    max_tokens: 16000,
    output_config: {
      effort: 'medium',
      format: { type: 'json_schema', schema: PLAN_SCHEMA },
    },
    system:
      'You are a family grocery strategist. Before the weekly shop, you look at the current deals across their four ' +
      'stores, their staples, the week\'s dinner plan and what is already on the grocery list, and build the plan that ' +
      'saves the most money: which store to lead with this week, which staples to buy on sale (and stock up on when a ' +
      'deal is deep and the item keeps), which grocery-list items line up with a deal, and what to hold off on because ' +
      'it is not on sale anywhere. Picks are concrete list-ready items, each tied to a real deal from the list, best ' +
      'savings first — never invent a deal or a price. If a store has no useful deals, say so briefly in the summary.',
    messages: [
      {
        role: 'user',
        content:
          `Today is ${weekday}, ${today}.\n\n` +
          `STAPLES:\n${input.staples.map((s) => `${s.name} (${s.category})${s.note ? ` — ${s.note}` : ''}`).join('\n')}\n\n` +
          `CURRENT DEALS:\n${dealLines || '(none imported yet)'}\n\n` +
          `DINNER PLAN THIS WEEK:\n${input.dinners.map((d) => `${d.date}: ${d.meal}`).join('\n') || '(not planned yet)'}\n\n` +
          `ALREADY ON THE GROCERY LIST:\n${input.groceries.join('\n') || '(empty)'}`,
      },
    ],
  })

  if (response.stop_reason === 'refusal') throw new Error('Claude declined to plan that.')
  const block = response.content.find((b) => b.type === 'text')
  if (!block || block.type !== 'text') throw new Error('Empty response from Claude.')

  const parsed = JSON.parse(block.text) as PlanResult
  return {
    summary: (parsed.summary ?? '').trim(),
    picks: (parsed.picks ?? []).filter((p) => p.item?.trim()),
  }
}
