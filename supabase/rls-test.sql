-- Local-only RLS proof. Run after local-shim.sql + schema.sql:
--
--   psql -d cctest -v ON_ERROR_STOP=1 -f supabase/rls-test.sql
--
-- Seeds two households, then puts on each household's identity in turn and
-- checks that it can reach its own rows and nothing of the other's. Every
-- check raises an exception on failure, so a clean run means all of it passed.

\set QUIET on
-- notice-level so each individual check reports itself.
set client_min_messages = notice;

-- --- fixtures (as superuser, RLS bypassed) ---------------------------------

delete from public.households where id in ('hh_a', 'hh_b');

insert into public.households (id, name, parent_pin) values
  ('hh_a', 'Carberry', '1234'),
  ('hh_b', 'Other family', '9999');

insert into public.household_users (household_id, user_id) values
  ('hh_a', '00000000-0000-0000-0000-00000000000a'),
  ('hh_b', '00000000-0000-0000-0000-00000000000b');

insert into public.members (id, household_id, name, role) values
  ('m_a', 'hh_a', 'Patrick', 'parent'),
  ('m_b', 'hh_b', 'Stranger', 'parent');

insert into public.oauth_tokens (id, household_id, provider, access_token) values
  ('tok_a', 'hh_a', 'google', 'super-secret-google-token');

-- --- helpers ---------------------------------------------------------------

create or replace function pg_temp.check(label text, got boolean, want boolean)
returns void language plpgsql as $$
begin
  if got is distinct from want then
    raise exception 'FAIL: % (got %, want %)', label, got, want;
  end if;
  raise notice 'ok: %', label;
end $$;

create or replace function pg_temp.expect_count(label text, got bigint, want bigint)
returns void language plpgsql as $$
begin
  if got <> want then
    raise exception 'FAIL: % (got % rows, want %)', label, got, want;
  end if;
  raise notice 'ok: % (% rows)', label, got;
end $$;

-- --- household A -----------------------------------------------------------

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);

select pg_temp.check('current_household_id() resolves to hh_a',
  public.current_household_id() = 'hh_a', true);

select pg_temp.expect_count('A sees its own member', (select count(*) from public.members), 1);
select pg_temp.expect_count('A cannot see B''s member',
  (select count(*) from public.members where household_id = 'hh_b'), 0);
select pg_temp.expect_count('A sees only its own household row',
  (select count(*) from public.households), 1);

-- A must not be able to write into B's household.
do $$
begin
  insert into public.members (id, household_id, name, role)
  values ('m_evil', 'hh_b', 'Injected', 'kid');
  raise exception 'FAIL: cross-household INSERT was allowed';
exception
  when insufficient_privilege then raise notice 'ok: cross-household INSERT blocked';
end $$;

-- Nor relabel its own row into B's household.
do $$
begin
  update public.members set household_id = 'hh_b' where id = 'm_a';
  if found then
    raise exception 'FAIL: cross-household UPDATE was allowed';
  end if;
  raise notice 'ok: cross-household UPDATE affected no rows';
exception
  when insufficient_privilege then raise notice 'ok: cross-household UPDATE blocked';
end $$;

-- Nor delete B's rows (invisible, so this must be a no-op, not an error).
delete from public.members where household_id = 'hh_b';
reset role;
select pg_temp.expect_count('B''s member survived A''s delete',
  (select count(*) from public.members where id = 'm_b'), 1);

-- --- oauth_tokens is unreachable from the browser roles --------------------

set role authenticated;
do $$
begin
  perform 1 from public.oauth_tokens;
  raise exception 'FAIL: authenticated could read oauth_tokens';
exception
  when insufficient_privilege then raise notice 'ok: authenticated cannot read oauth_tokens';
end $$;
reset role;

set role anon;
do $$
begin
  perform 1 from public.oauth_tokens;
  raise exception 'FAIL: anon could read oauth_tokens';
exception
  when insufficient_privilege then raise notice 'ok: anon cannot read oauth_tokens';
end $$;
reset role;

-- --- list_ingest_tokens is unreachable too ---------------------------------
--
-- ingest_list() is SECURITY DEFINER and reads this table on behalf of an
-- unauthenticated caller, which is the whole point — but the table itself must
-- stay invisible. A readable token hash is a brute-force target, and a readable
-- row tells an attacker which households have an ingest token at all.

insert into public.list_ingest_tokens (id, household_id, list_name, token_hash)
values ('lit_rls', 'hh_a', 'Groceries', 'not-a-real-hash')
on conflict (id) do nothing;

set role authenticated;
do $$
begin
  perform 1 from public.list_ingest_tokens;
  raise exception 'FAIL: authenticated could read list_ingest_tokens';
exception
  when insufficient_privilege then raise notice 'ok: authenticated cannot read list_ingest_tokens';
end $$;
reset role;

set role anon;
do $$
begin
  perform 1 from public.list_ingest_tokens;
  raise exception 'FAIL: anon could read list_ingest_tokens';
exception
  when insufficient_privilege then raise notice 'ok: anon cannot read list_ingest_tokens';
end $$;

-- But the function that reads it on their behalf is callable, and rejects a
-- token it does not know. Without the grant the whole integration is dead; with
-- a too-broad one, anybody could rewrite the list.
do $$
begin
  perform public.ingest_list('definitely-not-a-token', array['Milk']);
  raise exception 'FAIL: ingest_list accepted an unknown token';
exception
  when sqlstate '28000' then raise notice 'ok: anon may call ingest_list, and a bad token is refused';
  when insufficient_privilege then raise exception 'FAIL: anon cannot execute ingest_list at all';
end $$;
reset role;

-- --- anon sees nothing at all ----------------------------------------------

set role anon;
do $$
begin
  perform 1 from public.members;
  raise exception 'FAIL: anon could read members';
exception
  when insufficient_privilege then raise notice 'ok: anon cannot read members';
end $$;
reset role;

-- --- household B, to prove the fence points both ways ----------------------

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
select pg_temp.expect_count('B sees only its own member', (select count(*) from public.members), 1);
select pg_temp.check('B''s one member is m_b',
  (select id from public.members) = 'm_b', true);
reset role;

-- --- a session with no JWT at all -------------------------------------------

set role authenticated;
select set_config('request.jwt.claim.sub', '', false);
select pg_temp.expect_count('unauthenticated session sees no members',
  (select count(*) from public.members), 0);
reset role;


-- --- feed_events: readable by the household, never writable from a device ---

insert into public.feeds (id, household_id, name, url) values ('f_a', 'hh_a', 'School', 'https://x/y.ics');
insert into public.feed_events (id, household_id, feed_id, title, date)
  values ('fe_a', 'hh_a', 'f_a', 'Early release', current_date);

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
select pg_temp.expect_count('A can read its feed events',
  (select count(*) from public.feed_events), 1);

do $$
begin
  insert into public.feed_events (id, household_id, feed_id, title, date)
  values ('fe_evil', 'hh_a', 'f_a', 'Injected', current_date);
  raise exception 'FAIL: a device could INSERT feed events';
exception
  when insufficient_privilege then raise notice 'ok: device cannot INSERT feed events';
end $$;

do $$
begin
  update public.feed_events set title = 'Tampered' where id = 'fe_a';
  raise exception 'FAIL: a device could UPDATE feed events';
exception
  when insufficient_privilege then raise notice 'ok: device cannot UPDATE feed events';
end $$;

do $$
begin
  delete from public.feed_events where id = 'fe_a';
  raise exception 'FAIL: a device could DELETE feed events';
exception
  when insufficient_privilege then raise notice 'ok: device cannot DELETE feed events';
end $$;
reset role;

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
select pg_temp.expect_count('B cannot see A''s feed events',
  (select count(*) from public.feed_events), 0);
reset role;

\echo 'ALL RLS CHECKS PASSED'
