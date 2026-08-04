/**
 * The savings module's server half for the hosted site.
 *
 * GitHub Pages is static — there is nothing behind /api — so the Savings page
 * falls back to invoking this Edge Function for the two Claude-powered jobs:
 * extracting deals from an ad page and building the weekly plan. All the real
 * logic lives in shared.ts, which the local sidecar uses too; this file is
 * just the Deno doorway.
 *
 * Deploy (once, from the repo root):
 *   npx supabase login
 *   npx supabase link --project-ref rdmlrmilkgalixiafbfg
 *   npx supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
 *   npx supabase functions deploy savings
 *
 * The default verify_jwt gate stays on: only a signed-in household session can
 * call this, which is exactly who the Savings page is.
 */

import {
  buildPlan,
  extractDeals,
  fetchStoreText,
  isStoreId,
  type DealIn,
  type PlanInput,
  type StapleIn,
} from './shared.ts'

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
}

const json = (code: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status: code,
    headers: { ...CORS, 'content-type': 'application/json' },
  })

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json(405, { error: 'POST only' })

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY') ?? ''
  if (!apiKey) {
    return json(500, {
      error:
        'The savings function has no Anthropic key — run `npx supabase secrets set ANTHROPIC_API_KEY=…` and redeploy.',
    })
  }

  try {
    const body = (await req.json()) as {
      action?: string
      store?: string
      text?: string
      staples?: StapleIn[]
      deals?: DealIn[]
      dinners?: { date: string; meal: string }[]
      favorites?: string[]
      groceries?: string[]
    }

    if (body.action === 'import') {
      if (!isStoreId(body.store)) return json(400, { error: 'Unknown store' })
      const text = body.text?.trim() || (await fetchStoreText(body.store))
      const deals = await extractDeals(apiKey, body.store, text, body.staples ?? [])
      return json(200, { deals })
    }

    if (body.action === 'plan') {
      const input: PlanInput = {
        staples: body.staples ?? [],
        deals: body.deals ?? [],
        dinners: body.dinners ?? [],
        favorites: body.favorites ?? [],
        groceries: body.groceries ?? [],
      }
      return json(200, await buildPlan(apiKey, input))
    }

    return json(400, { error: 'Unknown action' })
  } catch (err) {
    return json(502, { error: err instanceof Error ? err.message : 'Savings failed' })
  }
})
