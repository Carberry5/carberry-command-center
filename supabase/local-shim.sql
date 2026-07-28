-- Local-only test harness. NOT for the Supabase project — Supabase already
-- provides all of this.
--
-- Recreates just enough of the Supabase environment (the auth schema, auth.uid(),
-- and the anon / authenticated / service_role roles) that supabase/schema.sql
-- can be run and its RLS exercised against a plain Postgres 16 cluster.
--
--   psql -f supabase/local-shim.sql -f supabase/schema.sql

create schema if not exists auth;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end
$$;

grant usage on schema public to anon, authenticated, service_role;
grant usage on schema auth to anon, authenticated, service_role;

-- Mirrors Supabase's auth.uid(): the subject claim of the request's JWT.
-- Tests set it with `select set_config('request.jwt.claim.sub', '<uuid>', true)`.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

grant execute on function auth.uid() to anon, authenticated, service_role;
