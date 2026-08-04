import { isConfigured, supabase } from '../store/cloudSync.ts'

/**
 * Reaches whichever savings server exists.
 *
 * In development (and `npm start`) the sidecar answers /api/savings/*. On the
 * hosted site there is no server at all — GitHub Pages answers /api with its
 * HTML 404 page — so the same request goes to the `savings` Supabase Edge
 * Function instead. The two speak the same shapes; only the doorway differs.
 *
 * The tell for "no server" is a non-JSON response: a real sidecar always
 * answers JSON, even for errors. Real errors from either server are surfaced
 * as-is — they carry the useful text ("paste the ad instead", "no key set").
 */
export async function savingsRequest<T>(
  action: 'import' | 'plan',
  payload: Record<string, unknown>
): Promise<T> {
  let status = 0
  let raw: string | null = null
  try {
    const res = await fetch(`/api/savings/${action}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
    status = res.status
    raw = await res.text()
  } catch {
    raw = null // network failure — try the Edge Function
  }

  if (raw !== null) {
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      parsed = undefined // HTML from a static host — not a real server
    }
    if (parsed !== undefined) {
      if (status >= 200 && status < 300) return parsed as T
      throw new Error((parsed as { error?: string }).error ?? `Server responded ${status}`)
    }
  }

  if (!isConfigured()) {
    throw new Error(
      'No savings server available — run `npm run dev` on the home machine, or deploy the savings Edge Function (docs/grocery-savings.md).'
    )
  }

  const { data, error } = await supabase().functions.invoke('savings', {
    body: { action, ...payload },
  })
  if (error) {
    // A FunctionsHttpError carries the function's own response; its `error`
    // field is the message worth showing ("paste the ad instead", …).
    let message = ''
    const ctx = (error as { context?: Response }).context
    if (ctx && typeof ctx.json === 'function') {
      try {
        message = ((await ctx.json()) as { error?: string }).error ?? ''
      } catch {
        /* not json */
      }
    }
    throw new Error(
      message ||
        'The savings Edge Function is not reachable — deploy it with `npx supabase functions deploy savings` (docs/grocery-savings.md).'
    )
  }
  return data as T
}
