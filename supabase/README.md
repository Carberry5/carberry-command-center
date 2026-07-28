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
`cloudSync.ts` names — but it speaks raw SQL, not PostgREST. The supabase-js
call layer (`loadSnapshot`, `applyMutations`, `subscribe`) is still unproven
against a real Supabase stack; see the note in `src/store/cloudSync.ts`.
