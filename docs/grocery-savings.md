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

## Credentials

Reuses the Sidekick's Anthropic key — `OP_ANTHROPIC_REF` (1Password) or
`ANTHROPIC_API_KEY`. No key: the page still manages staples and shows saved
deals; Sync / Extract / Build explain what's missing.
