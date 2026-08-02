# Grocery list from iCloud Reminders

Keeps the app's **Groceries** list in step with an iCloud Reminders list, so
whoever is standing in the shop sees what everyone else added.

## Why it works this way

Apple publishes no Reminders API. An `icloud.com/reminders/…` link is a *share
invitation* — it is meant to be opened on a device signed into iCloud, where it
adds the list to the Reminders app. Nothing can fetch data from it, and no
amount of server-side code changes that.

What a phone *can* do is run a Shortcut that reads the list locally and posts
it somewhere. So the phone pushes; nothing pulls.

The alternative — a server talking to `caldav.icloud.com` like a third-party
Reminders client — works, but needs an Apple ID and an app-specific password,
and that password grants CalDAV access to the **whole iCloud account's**
calendars and reminders, not just one grocery list. That is a lot of blast
radius for a shopping list. This route stores no Apple credential anywhere.

## What gets stored

A token, and only its SHA-256. The token resolves to exactly one household and
one list, so the worst a leaked one can do is rewrite that grocery list. It is
not a Supabase key and cannot read anything.

## Setup

### 1. Mint a token

```bash
SUPABASE_URL=https://rdmlrmilkgalixiafbfg.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=… \
  npx tsx scripts/list-token.ts mint --household carberry --list Groceries --member e
```

It prints the token **once**. Copy it straight into the Shortcut — it cannot be
recovered later. Mint a new one and revoke the old if you lose it:

```bash
npx tsx scripts/list-token.ts list    --household carberry
npx tsx scripts/list-token.ts revoke  --id lit_…
```

`--member` decides who the items show as being added by. Leave it off for none.

### 2. Build the Shortcut

On the iPhone: **Shortcuts → + → Add Action**.

| # | Action | Settings |
|---|---|---|
| 1 | **Find Reminders** | *Where* `List` `is` `Groceries`, and `Completed` `is` `No`. Do not set a limit. |
| 2 | **Repeat with Each** | Input: the result of step 1 |
| 3 | ‣ **Get Details of Reminders** | `Name`, from *Repeat Item* |
| 4 | **Get Contents of URL** | see below |

Step 4:

- **URL** — `https://rdmlrmilkgalixiafbfg.supabase.co/rest/v1/rpc/ingest_list`
- **Method** — `POST`
- **Headers**
  - `apikey` → your `sb_publishable_…` key (the same one in the web app; it is
    designed to be public)
  - `Content-Type` → `application/json`
- **Request Body** — `JSON`
  - `p_token` *(Text)* → the token from step 1
  - `p_items` *(Array)* → **Repeat Results** from step 2

The response is a small JSON summary — `added`, `removed`, `total` — which is
handy to leave visible while you are testing and to delete afterwards.

### 3. Run it automatically

**Shortcuts → Automation → +**. Two that work well together:

- **Time of Day**, daily, early evening — catches the day's additions.
- **App**, *Reminders*, *Is Closed* — posts right after anyone edits the list.

Turn **Ask Before Running** off, or it will never run unattended.

## How the merge behaves

Items the Shortcut sends are stored with `source = 'reminders'`, and that tag is
what keeps the two sources from fighting:

| Situation | What happens |
|---|---|
| New item in Reminders | Added to the app's list |
| Item checked off in Reminders | Removed from the app's list |
| Item typed in the app | Left alone forever — the ingest never deletes it |
| Same text in both | One item, not two (matched case-insensitively) |
| Blank or duplicate entries | Dropped |
| Nothing left in Reminders | All reminders-sourced items cleared; app-typed ones stay |

It is one-way: ticking something off **in the app** does not check it off in
Reminders. Reminders is the source of truth for anything it sent.

Re-posting an unchanged list is a no-op — item ids are derived from the list and
the text, so nothing churns and no device sees a spurious update.

## If it does not work

**`{"code":"PGRST202"}` / "Could not find the function"** — PostgREST caches the
schema. In the Supabase SQL editor:

```sql
notify pgrst, 'reload schema';
```

**`invalid ingest token`** — the token is wrong, or was revoked. Check with
`list-token.ts list`; mint a new one if in doubt.

**`401` / `Invalid API key`** — the `apikey` header is missing or is not the
publishable key.

**It posts, but nothing appears** — confirm the list name in the token matches a
list in the app, or let it create one: `list-token.ts list` shows the name each
token writes to. The list is created on first post if it does not exist.

## Testing

The ingest function is covered by `supabase/ingest-test.sql` (20 checks, run by
`npm run test:cloud`) — idempotence, the app-typed-item guard, cross-household
isolation, oversized payloads, and id determinism. The Shortcut itself cannot be
tested from CI; the response summary is how you check it.
