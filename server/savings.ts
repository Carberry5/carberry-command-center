import type { Deal, SavingsStoreId, Staple } from '../src/types.ts'
import * as shared from '../supabase/functions/savings/shared.ts'
import * as op from './onepassword.ts'

/**
 * The sidecar's half of the savings module. The Claude logic itself lives in
 * supabase/functions/savings/shared.ts so the local sidecar and the deployed
 * Edge Function can never drift apart; this file only supplies what is
 * Node-specific — resolving the API key through 1Password.
 *
 * Endpoints stay stateless: the client sends the context and commits the
 * result through its normal update()/sync path, so this works identically
 * whether the store is the vault or Supabase.
 */

export type { ExtractedDeal, PlanResult } from '../supabase/functions/savings/shared.ts'

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

export const htmlToText = shared.htmlToText

export const fetchStoreText = (store: SavingsStoreId): Promise<string> =>
  shared.fetchStoreText(store)

export async function extractDeals(
  store: SavingsStoreId,
  text: string,
  staples: Staple[]
): Promise<shared.ExtractedDeal[]> {
  return shared.extractDeals(await apiKey(), store, text, staples)
}

export interface PlanInput {
  staples: Staple[]
  deals: Deal[]
  /** The next week's dinner plan, "YYYY-MM-DD: meal" lines. */
  dinners: { date: string; meal: string }[]
  /** Unchecked grocery-list items. */
  groceries: string[]
}

export async function buildPlan(input: PlanInput): Promise<shared.PlanResult> {
  return shared.buildPlan(await apiKey(), input)
}
