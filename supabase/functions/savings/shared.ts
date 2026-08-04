/**
 * The savings module's Claude logic, shared verbatim between the two places it
 * runs: the local sidecar (server/savings.ts, Node) and the Supabase Edge
 * Function (index.ts next door, Deno). Everything here sticks to what both
 * runtimes provide — global fetch and nothing else — which is why the Anthropic
 * call is plain REST rather than the SDK.
 *
 * Deliberately self-contained: the Edge Function bundler deploys from this
 * folder, so nothing here may import from src/ or server/. The store metadata
 * below is the deploy-side twin of src/lib/savings.ts — same ids, same URLs;
 * change them together.
 */

export type StoreId = 'foodlion' | 'giant' | 'costco' | 'amazon'

export interface StapleIn {
  id: string
  name: string
  category: string
  note?: string
}

export interface DealIn {
  store: StoreId
  item: string
  price: string
  savings: string
  detail: string
  ends: string
  stapleId: string | null
}

export interface ExtractedDeal {
  item: string
  price: string
  savings: string
  detail: string
  ends: string
  stapleId: string | null
}

export interface PlanInput {
  staples: StapleIn[]
  deals: DealIn[]
  /** Nights the family has already planned, "YYYY-MM-DD: meal". Soft — a deep deal may propose a swap. */
  dinners: { date: string; meal: string }[]
  /** The family's go-to meals, so deal-driven dinners land on food they actually eat. */
  favorites: string[]
  groceries: string[]
}

export interface PlanResult {
  summary: string
  /** The deal-driven dinner proposals, one per night that has a good answer. */
  dinners: { date: string; meal: string; note: string }[]
  picks: { store: StoreId; item: string; note: string }[]
}

export const STORES: Record<StoreId, { name: string; url: string }> = {
  foodlion: { name: 'Food Lion', url: 'https://foodlion.com/savings/all-specials' },
  giant: { name: 'Giant Food', url: 'https://giantfood.com/browse-aisles/categories/1/deal-lock' },
  costco: { name: 'Costco', url: 'https://www.costco.com/s?keyword=OFF&dept=All' },
  amazon: { name: 'Amazon Prime', url: 'https://www.amazon.com/deals' },
}

export const isStoreId = (v: unknown): v is StoreId =>
  typeof v === 'string' && v in STORES

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
export async function fetchStoreText(store: StoreId): Promise<string> {
  const meta = STORES[store]
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
// The Claude call — plain REST so Node and Deno share one code path
// ---------------------------------------------------------------------------

interface ContentBlock {
  type: string
  text?: string
}

async function claude(apiKey: string, payload: Record<string, unknown>): Promise<string> {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
  const json = (await r.json()) as {
    content?: ContentBlock[]
    stop_reason?: string
    error?: { message?: string }
  }
  if (!r.ok) {
    throw new Error(`Claude API ${r.status}: ${json.error?.message ?? 'request failed'}`)
  }
  if (json.stop_reason === 'refusal') throw new Error('Claude declined to read that.')
  const block = (json.content ?? []).find((b) => b.type === 'text')
  if (!block?.text) throw new Error('Empty response from Claude.')
  return block.text
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
}

/**
 * Reads deals out of an ad page's text and matches each against the staples.
 * Returns plain data — the caller mints ids and commits through its own store.
 */
export async function extractDeals(
  apiKey: string,
  store: StoreId,
  text: string,
  staples: StapleIn[]
): Promise<ExtractedDeal[]> {
  const today = new Date().toISOString().slice(0, 10)
  const stapleLines = staples.map((s) => `${s.id}: ${s.name} (${s.category})`).join('\n')

  const raw = await claude(apiKey, {
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
          `Today is ${today}. Store: ${STORES[store].name}.\n\n` +
          `STAPLES (id: name):\n${stapleLines}\n\n` +
          `AD PAGE TEXT:\n"""${text.slice(0, MAX_TEXT)}"""`,
      },
    ],
  })

  const parsed = JSON.parse(raw) as { deals?: ExtractedDeal[] }
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
        "The week's strategy in short plain-text paragraphs and dashed lists: which deals shaped the dinners, which store leads, what to stock up on, what to skip. No markdown headings.",
    },
    dinners: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          date: { type: 'string', description: 'YYYY-MM-DD, within the next 7 days' },
          meal: { type: 'string', description: 'The dinner, as it should appear on the meal plan ("Steak night")' },
          note: {
            type: 'string',
            description: 'The deal driving it: "NY strip $9.99/lb at Costco". "" only if no deal applies.',
          },
        },
        required: ['date', 'meal', 'note'],
        additionalProperties: false,
      },
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
  required: ['summary', 'dinners', 'picks'],
  additionalProperties: false,
}

export async function buildPlan(apiKey: string, input: PlanInput): Promise<PlanResult> {
  const now = new Date()
  const today = now.toISOString().slice(0, 10)
  const weekday = now.toLocaleDateString('en-US', { weekday: 'long' })

  const stapleById = new Map(input.staples.map((s) => [s.id, s]))
  const dealLines = input.deals
    .map((d) => {
      const staple = d.stapleId ? stapleById.get(d.stapleId) : null
      return (
        `[${STORES[d.store].name}] ${d.item} — ${d.price}` +
        (d.savings ? ` (${d.savings})` : '') +
        (d.detail ? ` · ${d.detail}` : '') +
        (d.ends ? ` · ends ${d.ends}` : '') +
        (staple ? ` · staple: ${staple.name}` : '')
      )
    })
    .join('\n')

  const raw = await claude(apiKey, {
    model: 'claude-opus-5',
    max_tokens: 16000,
    output_config: {
      effort: 'medium',
      format: { type: 'json_schema', schema: PLAN_SCHEMA },
    },
    system:
      'You are a family grocery strategist, and the deals drive the dinner plan — not the other way around. Before ' +
      'the weekly shop, look at the current deals across their four stores and PROPOSE the week\'s dinners around ' +
      'what is on sale: a deep deal on a protein becomes that night\'s dinner, drawing on the family\'s favorite ' +
      'meals whenever one fits the sale ingredients. Propose a dinner for each of the next 7 nights that has a good ' +
      'deal-backed answer; skip nights that don\'t. A night the family already planned keeps their meal unless a ' +
      'deal makes a clearly cheaper or better swap — propose the swap and say why in the note. Then the shopping ' +
      'side: which store to lead with, which staples to buy on sale (stock up when a deal is deep and the item ' +
      'keeps), which grocery-list items line up with a deal, and what to hold off on because it is not on sale ' +
      'anywhere. Picks are concrete list-ready items, each tied to a real deal, best savings first, and should ' +
      'cover the ingredients the proposed dinners need. Never invent a deal or a price. If a store has no useful ' +
      'deals, say so briefly in the summary.',
    messages: [
      {
        role: 'user',
        content:
          `Today is ${weekday}, ${today}.\n\n` +
          `STAPLES:\n${input.staples.map((s) => `${s.name} (${s.category})${s.note ? ` — ${s.note}` : ''}`).join('\n')}\n\n` +
          `CURRENT DEALS:\n${dealLines || '(none imported yet)'}\n\n` +
          `FAMILY FAVORITE MEALS:\n${input.favorites.join('\n') || '(none listed)'}\n\n` +
          `NIGHTS ALREADY PLANNED:\n${input.dinners.map((d) => `${d.date}: ${d.meal}`).join('\n') || '(none — the week is open)'}\n\n` +
          `ALREADY ON THE GROCERY LIST:\n${input.groceries.join('\n') || '(empty)'}`,
      },
    ],
  })

  const parsed = JSON.parse(raw) as PlanResult
  return {
    summary: (parsed.summary ?? '').trim(),
    dinners: (parsed.dinners ?? []).filter(
      (d) => d.meal?.trim() && /^\d{4}-\d{2}-\d{2}$/.test((d.date ?? '').trim())
    ),
    picks: (parsed.picks ?? []).filter((p) => p.item?.trim()),
  }
}
