# Grocery list ↔ Google Tasks

Two-way sync between a Google Tasks list and one of the family's lists. Add
something in either place and it appears in the other; tick it off in either
place and it goes from both.

Unlike the [Reminders route](./reminders-shortcut.md), nothing depends on a
phone being awake — a scheduled Action does the work.

## Setting up the Google project

Once, at [console.cloud.google.com](https://console.cloud.google.com).

1. **New Project** — `carberry-command-center`, no organization.
2. **APIs & Services → Library** → enable **Google Tasks API**, **Gmail API**
   and **Google Calendar API**. Enable all three now; adding one later means
   going back through the consent screen.
3. **Google Auth Platform → Branding** (older console: *OAuth consent screen*) —
   User type **External**, fill in the app name and your email, skip the logo.
4. **Data Access** → add these scopes:
   ```
   https://www.googleapis.com/auth/tasks
   https://www.googleapis.com/auth/gmail.readonly
   https://www.googleapis.com/auth/calendar.events
   ```
5. **Audience → Publish app.** ⚠️ This one matters: while the app is in
   *Testing*, **refresh tokens expire after 7 days** and the sync silently stops
   every week. Publish it. Verification is only needed to serve strangers —
   unverified means a *"Google hasn't verified this app"* interstitial on first
   sign-in, which you click through with **Advanced → Go to…**. The 100-user cap
   is not a constraint for a family.
6. **Clients → Create client** → application type **Desktop app**. Desktop
   clients accept any `http://localhost` port automatically, so there are no
   redirect URIs to register.

Put the two values in the repo at **Settings → Secrets and variables → Actions
→ Secrets** — as *Secrets*, not Variables; unlike the Supabase publishable key
these are genuinely confidential:

| Name | Looks like |
|---|---|
| `GOOGLE_CLIENT_ID` | `…apps.googleusercontent.com` |
| `GOOGLE_CLIENT_SECRET` | `GOCSPX-…` |

## Connecting the account

On your own machine, with the same two values in the environment:

```bash
export SUPABASE_URL=https://rdmlrmilkgalixiafbfg.supabase.co
export SUPABASE_SERVICE_ROLE_KEY=…
export GOOGLE_CLIENT_ID=…
export GOOGLE_CLIENT_SECRET=…

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

**`refresh rejected (400)` every 7 days** — the OAuth client is still in
*Testing*. Publish it (step 5) and reconnect.

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
