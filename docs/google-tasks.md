# Grocery list ↔ Google Tasks

Two-way sync between a Google Tasks list and one of the family's lists. Add
something in either place and it appears in the other; tick it off in either
place and it goes from both.

Unlike the [Reminders route](./reminders-shortcut.md), nothing depends on a
phone being awake — a scheduled Action does the work.

## Setting up the Google project

Once, at [console.cloud.google.com](https://console.cloud.google.com).

1. **New Project** — `carberry-command-center`, no organization.
2. **APIs & Services → Library** → enable the **Google Tasks API**. Only that
   one — see *Why only one scope* below.
3. **Google Auth Platform → Branding** (older console: *OAuth consent screen*) —
   User type **External**, fill in the app name and your email, skip the logo.
4. **Data Access** → add exactly one scope:
   ```
   https://www.googleapis.com/auth/tasks
   ```
5. **Audience → Test users → Add users** → the Google account whose task list
   this is. Leave publishing status on **Testing**.
6. **Clients → Create client** → application type **Desktop app**. Desktop
   clients accept any `http://localhost` port automatically, so there are no
   redirect URIs to register.

### Do not publish the app

This is counter-intuitive enough to be worth stating plainly, because getting it
backwards blocks you completely.

`tasks` is a **sensitive** scope. An app that requests one and is set to *In
production* without completed Google verification is refused outright:

> Access blocked: Carberry Command Center has not completed the Google
> verification process

There is no *Advanced → Go to…* link on that screen. The clickable
*"Google hasn't verified this app"* interstitial — the one you *can* get past —
appears in **Testing**, for accounts on the test-user list.

So: stay in Testing, add yourself as a test user.

The cost is real and worth knowing: **in Testing, refresh tokens expire after 7
days**, so the sync stops weekly until you re-run `google-connect.ts auth`. The
only way out is verification, which for a sensitive scope is a form and a demo
video.

### Why only one scope

An earlier version of this asked for `gmail.readonly` and `calendar.events` too,
so that a future mail → calendar agent would not need a second trip through
consent. That was a mistake:

- `gmail.readonly` is a **restricted** scope. Verifying it needs a CASA
  third-party security assessment — months, and it costs money. Including it
  makes the client permanently unverifiable in practice.
- `calendar.events` is sensitive, and unused: the family's Google Calendar is
  read through a secret iCal URL as an ordinary feed, deliberately one-way.

Nothing is lost. The mail → calendar agent reads Gmail and writes Calendar
through the connectors attached to the assistant, not through this OAuth client.
This client only ever needs the grocery list.

Put the two values in the repo at **Settings → Secrets and variables → Actions
→ Secrets** — as *Secrets*, not Variables; unlike the Supabase publishable key
these are genuinely confidential:

| Name | Looks like |
|---|---|
| `GOOGLE_CLIENT_ID` | `…apps.googleusercontent.com` |
| `GOOGLE_CLIENT_SECRET` | `GOCSPX-…` |

## Connecting the account

On your own machine. Set the credentials up once, in a gitignored file the
scripts read automatically:

```bash
cp .env.example .env.local
```

Then open `.env.local` and fill in `SUPABASE_SERVICE_ROLE_KEY`,
`GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. Two things worth getting right:

- The Supabase key is the one under **Secret keys** (`sb_secret_…`), not the
  publishable key. You have to click **Reveal** to see it, which is the tell
  that you have the right one. The publishable key cannot bypass RLS, so every
  write would fail.
- Never paste `.env.local` into a chat window, an issue or a commit. It is
  gitignored precisely so it cannot be committed by accident.

```bash
npx tsx scripts/google-connect.ts auth --household carberry --member e
```

It prints a consent URL. Approve it, and the browser will land on a `localhost`
address that **fails to load** — that is expected, nothing is listening there.
Copy the whole address bar and feed it back:

```bash
npx tsx scripts/google-connect.ts auth --household carberry --member e \
  --redirected 'http://localhost:8910/?code=…'
```

That stores the refresh token in `oauth_tokens` — a table with no grants for any
browser role — and prints the task lists on the account. Link one:

```bash
npx tsx scripts/google-connect.ts link --household carberry \
  --tasklist MDk4… --list Groceries

npx tsx scripts/sync-tasks.ts --dry-run
```

The dry run reports what it *would* do and writes nothing.

## How it decides

Every operation has exactly one authoritative direction, which is what lets this
work without conflict resolution:

| Change | Result |
|---|---|
| Task added in Google | Appears in the app, tagged `gtasks` |
| Item added in the app | Pushed up; Google owns it from then on |
| Renamed in Google | Renamed in the app |
| Ticked off in Google | Leaves the app's list |
| Ticked off in the app | Marked complete in Google, then leaves the list |
| Same text on both sides | **Linked, not duplicated** |

That last row is the one that would hurt if it were wrong. The first sync sees a
list the family typed into the app *and* the same list in Google Tasks, and
matches them case-insensitively rather than producing two of everything.

### Deleting is not synced

Removing an item in the app does **not** delete the task in Google. Telling
"they deleted this" from "this was never here" needs a tombstone, and there is
nowhere to keep one — the row is simply gone, and absence is indistinguishable
from a task we have not pulled yet. Treating absence as deletion would mean a
device that is briefly behind wipes the shopping list.

**To remove something, tick it off.** That is unambiguous and syncs both ways.

## When it runs

`.github/workflows/sync-tasks.yml`, every 20 minutes between roughly 7am and
11pm Eastern. GitHub's scheduler is best-effort and can run late under load;
**Actions → Sync Google Tasks → Run workflow** forces one.

## If it breaks

**`Access blocked: … has not completed the Google verification process`** — the
app is set to *In production*. Set it **Back to testing** and add the account
under **Audience → Test users**. See *Do not publish the app* above.

**`refresh rejected (400)` roughly weekly** — expected while the app is in
Testing, where refresh tokens live 7 days. Re-run `google-connect.ts auth`. The
only permanent fix is Google verification.

**`Google returned no refresh token`** — the account has already granted this
client, and Google only issues a refresh token on a first consent. Remove the
app at [myaccount.google.com/permissions](https://myaccount.google.com/permissions)
and run `auth` again.

**`no list called "Groceries"`** — the linked name has to match a list in the
app. `google-connect.ts lists` shows what each Google list is mapped to.

**Items reappear after being ticked off** — check that only one sync is running.
The workflow sets `concurrency: sync-tasks` for exactly this reason.

## Testing

`scripts/gtasks-test.ts` — 47 checks, no credentials and no network
(`npm run test:gtasks`). The reconciliation in `src/lib/gtasks.ts` is pure, so
the decisions can be tested without an OAuth client; only the HTTP calls in
`sync-tasks.ts` need real credentials, and they are thin by design.

The `remote_id` round trip is covered in `scripts/cloudsync-test.ts` against
real Postgres, including the unique index that stops two items claiming one task.
