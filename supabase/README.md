# Supabase layer

The storage half of the move off the Obsidian vault. Two files matter in
production; the rest is test scaffolding.

| File | Purpose |
| --- | --- |
| `schema.sql` | The whole schema. Run this in the Supabase SQL editor. Idempotent. |
| `local-shim.sql` | **Local testing only.** Fakes the `auth` schema and the `anon`/`authenticated`/`service_role` roles so `schema.sql` can run on plain Postgres. Never run this against Supabase — it already has all of it. |
| `rls-test.sql` | Proves the household fence holds. Local only (it needs to `set role`). |

## Applying it

Paste `schema.sql` into the SQL editor of project `rdmlrmilkgalixiafbfg` and
run it. It is safe to re-run: tables are created only if absent, every column
is re-asserted with `add column if not exists`, and policies are dropped and
recreated.

That last part matters more than it sounds. `create table if not exists` is a
no-op on a table that already exists, so without the column back-fill section a
schema change would appear to apply and silently not. The suite caught exactly
that during development.

### Linking a login to the household

`schema.sql` creates no rows. After the first magic-link sign-in, connect that
auth user to a household — once, from the SQL editor:

```sql
insert into public.households (id, name) values ('carberry', 'Carberry')
on conflict (id) do nothing;

insert into public.household_users (household_id, user_id)
select 'carberry', id from auth.users where email = 'patrickm.carberry@gmail.com'
on conflict do nothing;
```

Every RLS policy resolves through `public.current_household_id()`, which reads
`household_users`. Until that row exists a signed-in session sees nothing at
all — which is the correct failure mode, but does look like a broken app.

## What RLS actually guarantees

`rls-test.sql` asserts, as a non-superuser wearing a real JWT claim:

- a household sees its own rows and zero rows of another household
- cross-household `INSERT` and `UPDATE` are refused, and a cross-household
  `DELETE` silently affects nothing
- `oauth_tokens` is unreadable by both `anon` and `authenticated` — it has RLS
  with no policy for them *and* no table grant, so a leaked anon key is not
  enough
- a session with no JWT sees nothing

The suite is checked against a deliberately broken policy during development,
so it is known to be capable of failing.

## Trust boundary

The anon key ships in the browser bundle and is fine there: it can only reach
what RLS allows. But every device is signed in as the household, so **the
database cannot tell a parent from a kid.** The per-kid PIN is a UI guardrail.

Anything that must genuinely be parent-only belongs in a Cloudflare Function
holding `SUPABASE_SERVICE_ROLE_KEY`, checking the session server-side. Do not
push that key into anything `VITE_`-prefixed — Vite inlines those into the
bundle.

## Testing

```bash
npm run test:cloud                        # local throwaway Postgres 16
PGURL=postgres://… npm run test:cloud     # a specific database
```

`scripts/cloud-test.sh` applies the shim and schema, re-applies the schema to
prove idempotency, then runs the RLS suite and `scripts/cloudsync-test.ts`.

Local Postgres exercises the schema, the policies, and every column
`cloudSync.ts` names — but it speaks raw SQL, not PostgREST. For the rest,
there is a second suite that runs against the live project:

```bash
export VITE_SUPABASE_URL=https://rdmlrmilkgalixiafbfg.supabase.co
export VITE_SUPABASE_ANON_KEY=…          # Settings -> API
export CC_EMAIL=you@example.com CC_PASSWORD=…

npx tsx scripts/cloud-smoke.ts           # read-only: auth, RLS, loadSnapshot
npx tsx scripts/cloud-smoke.ts --write   # + insert/update/delete + realtime
npx tsx scripts/cloud-smoke.ts --seed    # + seed an empty household from seed.ts
```

It signs in with the **anon** key and a password, exactly as the app will —
deliberately not the service role key, which bypasses RLS and would prove
nothing about whether the app's own writes are allowed. `--write` creates a
single scratch list and removes it again; `--seed` only fires on a household
with no members unless you add `--force`.

This is what covers `loadSnapshot`, `applyMutations` and `subscribe`, including
the composite-key delete filter and whether realtime actually delivers.

## Deploying to GitHub Pages

`.github/workflows/deploy.yml` builds and publishes on every push to `cloud`.
One-time setup:

1. **Settings → Pages → Source: GitHub Actions**
2. **Settings → Secrets and variables → Actions → Variables**, add
   `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.

They are repository *variables*, not secrets, on purpose: both are compiled into
the browser bundle and are meant to be public. Storing them as secrets would
imply a confidentiality the build cannot provide. RLS and the household link are
what protect the data — never the anon key. The service role key must never
appear in the workflow, and never with a `VITE_` prefix, since Vite inlines
those into the bundle.

### Two settings that matter once the URL is reachable

**Redirect URL.** Add `https://<user>.github.io/<repo>/` — with the trailing
slash — under Authentication → URL Configuration. A project Pages site is served
from a subpath, so the magic link must return there rather than to the domain
root; `redirectUrl()` in `src/store/auth.tsx` derives it from the same base path
the build uses.

**Disable public sign-ups.** Authentication → Providers → Email → turn off
"Allow new users to sign up". Otherwise anyone who finds the URL can create an
account. RLS still means they'd see nothing — a new user has no row in
`household_users`, so `current_household_id()` returns null and every policy
denies — but there's no reason to allow the accounts to exist.

### Functions

GitHub Pages is static only, so the parts that need a server are not available
there: ICS feed fetching (school calendars refuse browser requests), Sidekick
(the Claude API key can't ship in a bundle), the WHOOP/Oura/Google OAuth flows,
and server-side enforcement of parent-only actions. Those need Cloudflare Pages
Functions. The app already probes `/api/health` and reports them as unavailable
rather than failing oddly.
