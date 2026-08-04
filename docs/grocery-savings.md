# Grocery savings

The **Savings** page lines the week's grocery spend up against what is actually
on sale before anyone shops. It tracks the four places the family already buys
from:

| Store | Where the deals live |
| --- | --- |
| Food Lion | [Weekly specials](https://foodlion.com/savings/all-specials) |
| Giant Food | [Deal Lock](https://giantfood.com/browse-aisles/categories/1/deal-lock) |
| Costco | [$ OFF search](https://www.costco.com/s?keyword=OFF&dept=All) |
| Amazon Prime | [Deals](https://www.amazon.com/deals), Subscribe & Save emails |

## The loop

1. **Staples** — the "things we regularly buy" list at the bottom of the page.
   This is the module's memory of what the family purchases week after week
   (milk, chicken thighs, Goldfish, paper towels…). It ships seeded and is
   edited in the app or in `Savings.md` in the vault.

2. **Import deals** — per store, either:
   - **Sync** — the sidecar fetches the ad page server-side and reads it. This
     works when the store serves readable HTML; the big grocery sites are
     JS-heavy and bot-guarded, so expect it to fail politely sometimes.
   - **Paste the ad** — open the store's page, select-all, copy, paste. This
     always works, and also accepts circular emails, Subscribe & Save
     notifications, or a photo-to-text of the paper flyer.

   Either way the text goes to Claude (same key as the Sidekick, structured
   outputs), which returns clean deal rows — item, price, savings, conditions,
   end date — each matched against the staples list. Importing a store replaces
   that store's previous deals.

3. **Deals on things we buy** — every deal that hits a staple, with a
   one-tap **+ Groceries** that drops it on the grocery list tagged with the
   store and price. Unmatched deals sit behind a "show N more" toggle.

4. **Build the plan** — Claude gets the staples, all current deals, the next
   seven days of the dinner plan, and the unchecked grocery list, and writes
   the week's strategy: which store to lead with, what to stock up on while
   it's cheap, what to skip because it isn't on sale anywhere. It also returns
   concrete deal-backed picks you approve Sidekick-style — checked items land
   on the Groceries list. The summary stays on the page (and in the vault)
   until the next rebuild.

## Where the data lives

- **Vault** — `Savings.md`: staples and deals as editable tables, the plan
  summary under its own heading, per-store sync status in the frontmatter.
- **Supabase** — `staples`, `deals`, `savings_status`, `savings_plan` tables,
  household-fenced by RLS like everything else, watched by realtime.
- The two Claude endpoints (`POST /api/savings/import`,
  `POST /api/savings/plan`) are stateless: the client sends context and commits
  results through its normal store, so they behave identically in vault mode
  and cloud mode.

## Where the Claude calls run

The extraction and planning logic lives once, in
`supabase/functions/savings/shared.ts`, and runs in whichever server exists:

- **Locally** (`npm run dev` / `npm start`) the sidecar answers
  `/api/savings/*`, reading the key from `OP_ANTHROPIC_REF` (1Password) or
  `ANTHROPIC_API_KEY` in `.env`.
- **On the hosted site** there is no server behind `/api` — GitHub Pages is
  static — so the page falls back to the `savings` Supabase Edge Function.
  The client tries the sidecar first and falls back automatically; a real
  error from either server is shown as-is.

### Deploying the Edge Function (once)

```bash
npx supabase login
npx supabase link --project-ref rdmlrmilkgalixiafbfg
npx supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
npx supabase functions deploy savings
```

The function keeps the default JWT gate: only a signed-in household session
can call it, and the Anthropic key lives in Supabase's secret store — never
in the browser bundle. If invocations fail with a 401 despite being signed
in, redeploy with `--no-verify-jwt` and rely on the key staying server-side.

With no key configured anywhere, the page still manages staples and shows
saved deals; Sync / Extract / Build explain what's missing.

## Deals from Gmail — when the store sites block the fetch

The grocery sites bot-block server-side fetches (Giant answers 403), but their
deal emails — "Your Weekly Warehouse Insider!", weekly-ad newsletters,
Subscribe & Save notices — land in Gmail. The deals ingest turns those into
Savings-page deals automatically.

The trust model mirrors the iCloud Reminders list ingest: the caller presents
a minted token, only its SHA-256 is stored, and the token can do exactly two
things — read the household's staples (`savings_context`) and rewrite its
deals (`ingest_deals`). No Google OAuth scopes change: the repo deliberately
carries only the Tasks scope, and Gmail is read by whatever holds the token —
in our setup, a scheduled Claude session using the family's Gmail connector,
which also does the extraction itself, so no Anthropic key is involved either.

Setup:

1. Apply `supabase/schema.sql` (idempotent) to create the token table and the
   two functions.
2. Mint a token:
   `npx tsx scripts/deals-token.ts mint --household carberry`
3. Give the token to the thing that reads Gmail. It calls, with the public
   `sb_publishable_` key as the `apikey` header:
   - `POST /rest/v1/rpc/savings_context` `{"p_token": …}` → the staples to
     match against
   - `POST /rest/v1/rpc/ingest_deals` `{"p_token": …, "p_store": "costco",
     "p_deals": [{item, price, savings, detail, ends, stapleId}, …]}` — one
     call per store; each call replaces that store's deals and stamps the
     store's status line "N deals · Gmail <date>".

Re-posting an unchanged ad produces byte-identical rows (ids derive from
store+item+price), so devices see no phantom changes. Revoke a token any time
with `deals-token.ts revoke`. Subscribe to Food Lion's and Giant's weekly-ad
emails on their sites — until those arrive, only stores with deal emails get
imported this way.
