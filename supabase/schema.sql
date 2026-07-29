-- Carberry Command Center — Supabase schema
--
-- Mirrors the FamilyData shape in src/types.ts. Every table carries
-- household_id and is fenced by RLS, so a device only ever sees its own
-- household. oauth_tokens is the exception: it has no grants for the browser
-- roles at all, so integration credentials are unreachable from the client
-- even with a valid session.
--
-- Idempotent — safe to run repeatedly against an existing project.
--
-- A note on id types: ids are `text`, not `uuid`. The app ships preset ids
-- ('p', 'c', 'c1', 'l1', …) in src/data/seed.ts, and migrate.ts identifies
-- Patrick by `m.id === 'p'`. A uuid column would reject all of those. text
-- accepts both the presets and crypto.randomUUID() from uid(), so seed and
-- runtime ids coexist without rewriting the client.

begin;

-- ---------------------------------------------------------------------------
-- Household + auth linkage
-- ---------------------------------------------------------------------------

create table if not exists public.households (
  id                text primary key,
  name              text not null default 'Family',
  -- Parent PIN. A UI guardrail only — every device holds parent-level
  -- credentials, so anything that must actually be parent-only is enforced in
  -- a Function against the session, not here.
  parent_pin        text not null default '1234',
  zip               text not null default '',
  lat               double precision not null default 0,
  lon               double precision not null default 0,
  place             text not null default '',
  preflight_open    boolean not null default true,
  preflight_depart  text not null default '07:30',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- Which auth users belong to which household. One row per parent login.
create table if not exists public.household_users (
  household_id text not null references public.households(id) on delete cascade,
  user_id      uuid not null,
  role         text not null default 'parent',
  created_at   timestamptz not null default now(),
  primary key (household_id, user_id)
);

create index if not exists household_users_user_idx on public.household_users(user_id);

-- Resolves the caller's household. SECURITY DEFINER so it can read
-- household_users without tripping that table's own RLS (which would recurse
-- through every policy that calls this).
create or replace function public.current_household_id()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select household_id
  from public.household_users
  where user_id = auth.uid()
  limit 1
$$;

revoke all on function public.current_household_id() from public;
grant execute on function public.current_household_id() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- People
-- ---------------------------------------------------------------------------

create table if not exists public.members (
  id           text primary key,
  household_id text not null references public.households(id) on delete cascade,
  name         text not null,
  role         text not null check (role in ('parent', 'kid')),
  color        text not null default '#4A5B8C',
  age          integer,
  photo        text,
  -- Per-kid 4-digit PIN for profile switching. Same caveat as parent_pin:
  -- a guardrail, not a security boundary.
  pin          text,
  sort_order   integer not null default 0
);

create index if not exists members_household_idx on public.members(household_id);

-- Shortcuts shown on a member's page — school portals and the like. Plain
-- links, no credentials: they open in a new tab and whatever is behind them
-- does its own authentication.
create table if not exists public.member_links (
  id           text primary key,
  household_id text not null references public.households(id) on delete cascade,
  member_id    text not null,
  label        text not null default '',
  url          text not null default '',
  sort_order   integer not null default 0
);

create index if not exists member_links_member_idx on public.member_links(household_id, member_id);

-- ---------------------------------------------------------------------------
-- Calendar
-- ---------------------------------------------------------------------------

create table if not exists public.events (
  id             text primary key,
  household_id   text not null references public.households(id) on delete cascade,
  title          text not null default '',
  date           date not null,
  -- "HH:MM", or null for an all-day event.
  start_time     text,
  -- Duration in minutes.
  dur            integer,
  loc            text not null default '',
  recur          text check (recur in ('weekly')),
  drop_member_id text,
  pick_member_id text,
  sort_order     integer not null default 0
);

create index if not exists events_household_date_idx on public.events(household_id, date);

create table if not exists public.event_members (
  event_id     text not null references public.events(id) on delete cascade,
  member_id    text not null,
  household_id text not null references public.households(id) on delete cascade,
  sort_order   integer not null default 0,
  primary key (event_id, member_id)
);

create index if not exists event_members_household_idx on public.event_members(household_id);

-- ---------------------------------------------------------------------------
-- Chores + the daily done log
-- ---------------------------------------------------------------------------

create table if not exists public.chores (
  id           text primary key,
  household_id text not null references public.households(id) on delete cascade,
  title        text not null default '',
  -- 0 = Sunday … 6 = Saturday.
  days         integer[] not null default '{}',
  stars        integer not null default 1,
  sort_order   integer not null default 0
);

create index if not exists chores_household_idx on public.chores(household_id);

create table if not exists public.chore_members (
  chore_id     text not null references public.chores(id) on delete cascade,
  member_id    text not null,
  household_id text not null references public.households(id) on delete cascade,
  sort_order   integer not null default 0,
  primary key (chore_id, member_id)
);

create index if not exists chore_members_household_idx on public.chore_members(household_id);

-- The DoneMap: done[YYYY-MM-DD]["<task_key>|<member_id>"] = 1.
-- task_key is a chore id *or* a pre-flight key ('gym', 'lun', a bring id), so
-- it deliberately has no foreign key to chores.
create table if not exists public.chore_log (
  household_id text not null references public.households(id) on delete cascade,
  day          date not null,
  task_key     text not null,
  member_id    text not null,
  primary key (household_id, day, task_key, member_id)
);

create index if not exists chore_log_household_day_idx on public.chore_log(household_id, day);

-- ---------------------------------------------------------------------------
-- Star economy
-- ---------------------------------------------------------------------------

create table if not exists public.rewards (
  id           text primary key,
  household_id text not null references public.households(id) on delete cascade,
  title        text not null default '',
  cost         integer not null default 0,
  sort_order   integer not null default 0
);

create index if not exists rewards_household_idx on public.rewards(household_id);

create table if not exists public.redemptions (
  id           text primary key,
  household_id text not null references public.households(id) on delete cascade,
  kid_id       text not null,
  title        text not null default '',
  cost         integer not null default 0,
  -- Epoch milliseconds, matching Redemption.ts in the client.
  ts           bigint not null default 0,
  sort_order   integer not null default 0
);

create index if not exists redemptions_household_ts_idx on public.redemptions(household_id, ts desc);

-- ---------------------------------------------------------------------------
-- Meals
-- ---------------------------------------------------------------------------

create table if not exists public.favorites (
  id           text primary key,
  household_id text not null references public.households(id) on delete cascade,
  name         text not null default '',
  tag          text,
  sort_order   integer not null default 0
);

create index if not exists favorites_household_idx on public.favorites(household_id);

create table if not exists public.meal_plan (
  household_id text not null references public.households(id) on delete cascade,
  day          date not null,
  meal         text not null default '',
  primary key (household_id, day)
);

-- ---------------------------------------------------------------------------
-- Lists
-- ---------------------------------------------------------------------------

create table if not exists public.lists (
  id           text primary key,
  household_id text not null references public.households(id) on delete cascade,
  name         text not null default '',
  sort_order   integer not null default 0
);

create index if not exists lists_household_idx on public.lists(household_id);

create table if not exists public.list_items (
  id             text primary key,
  list_id        text not null references public.lists(id) on delete cascade,
  household_id   text not null references public.households(id) on delete cascade,
  text           text not null default '',
  done           boolean not null default false,
  by_member_id   text,
  sort_order     integer not null default 0
);

create index if not exists list_items_list_idx on public.list_items(list_id, sort_order);
create index if not exists list_items_household_idx on public.list_items(household_id);

-- ---------------------------------------------------------------------------
-- Countdowns
-- ---------------------------------------------------------------------------

create table if not exists public.countdowns (
  id           text primary key,
  household_id text not null references public.households(id) on delete cascade,
  title        text not null default '',
  date         date not null,
  member_id    text,
  sort_order   integer not null default 0
);

create index if not exists countdowns_household_idx on public.countdowns(household_id);

-- ---------------------------------------------------------------------------
-- Settings: ICS feeds and 1Password-style secret references
-- ---------------------------------------------------------------------------

create table if not exists public.feeds (
  id           text primary key,
  household_id text not null references public.households(id) on delete cascade,
  name         text not null default '',
  url          text not null default '',
  op_ref       text,
  color        text not null default '#5B8DEF',
  status       text not null default 'Not synced yet',
  -- Members this feed's events belong to; empty means the whole family.
  member_ids   text[] not null default '{}',
  sort_order   integer not null default 0
);

create index if not exists feeds_household_idx on public.feeds(household_id);

-- Events pulled from ICS feeds. Written only by the scheduled sync (service
-- role) and read-only to the browser — hence its own policy below rather than
-- the shared read/write one, and its absence from cloudSync's WRITE_ORDER.
-- They are a cache: the sync replaces a feed's rows wholesale each run, so
-- nothing here is authored by anyone and nothing is lost by discarding it.
create table if not exists public.feed_events (
  id           text primary key,
  household_id text not null references public.households(id) on delete cascade,
  feed_id      text not null references public.feeds(id) on delete cascade,
  title        text not null default '',
  date         date not null,
  start_time   text,
  dur          integer,
  loc          text not null default '',
  recur        text check (recur in ('weekly')),
  sort_order   integer not null default 0
);

create index if not exists feed_events_feed_idx on public.feed_events(household_id, feed_id);
create index if not exists feed_events_date_idx on public.feed_events(household_id, date);

-- SecretRef: a *pointer* to a secret (op://Vault/Item/field), never the value.
create table if not exists public.secrets (
  id           text primary key,
  household_id text not null references public.households(id) on delete cascade,
  label        text not null default '',
  ref          text not null default '',
  note         text,
  sort_order   integer not null default 0
);

create index if not exists secrets_household_idx on public.secrets(household_id);

-- ---------------------------------------------------------------------------
-- Morning pre-flight
-- ---------------------------------------------------------------------------

create table if not exists public.preflight_kids (
  household_id text not null references public.households(id) on delete cascade,
  member_id    text not null,
  -- Weekdays (1–5) the kid wears the gym uniform.
  gym          integer[] not null default '{}',
  -- Weekdays (1–5) lunch is packed rather than bought.
  lun          integer[] not null default '{}',
  primary key (household_id, member_id)
);

create table if not exists public.preflight_bring (
  id           text primary key,
  household_id text not null references public.households(id) on delete cascade,
  member_id    text not null,
  text         text not null default '',
  days         integer[] not null default '{}',
  sort_order   integer not null default 0
);

create index if not exists preflight_bring_member_idx on public.preflight_bring(household_id, member_id);

-- ---------------------------------------------------------------------------
-- Wearables + Greenlight (hand-entered: Greenlight has no public API)
-- ---------------------------------------------------------------------------

create table if not exists public.fit_stats (
  household_id text not null references public.households(id) on delete cascade,
  member_id    text not null,
  kind         text not null check (kind in ('whoop', 'oura')),
  sleep        double precision not null default 0,
  -- WHOOP only.
  strain       double precision,
  -- Oura only.
  act          double precision,
  updated_at   timestamptz not null default now(),
  primary key (household_id, member_id)
);

create table if not exists public.greenlight (
  household_id text not null references public.households(id) on delete cascade,
  member_id    text not null,
  bal          numeric(10, 2) not null default 0,
  allow        numeric(10, 2) not null default 0,
  goal         text not null default '',
  goal_cost    numeric(10, 2) not null default 0,
  saved        numeric(10, 2) not null default 0,
  primary key (household_id, member_id)
);

create table if not exists public.greenlight_payouts (
  id           text primary key,
  household_id text not null references public.households(id) on delete cascade,
  member_id    text not null,
  d            text not null default '',
  for_what     text not null default '',
  amt          numeric(10, 2) not null default 0,
  sort_order   integer not null default 0
);

create index if not exists greenlight_payouts_member_idx
  on public.greenlight_payouts(household_id, member_id);

-- ---------------------------------------------------------------------------
-- Integration credentials — service_role only, never the browser
-- ---------------------------------------------------------------------------

create table if not exists public.oauth_tokens (
  id            text primary key,
  household_id  text not null references public.households(id) on delete cascade,
  provider      text not null,
  -- Which family member this account belongs to, so a sync knows whose
  -- fit_stats row to write. Patrick's WHOOP, Elizabeth's Oura.
  member_id     text,
  access_token  text,
  refresh_token text,
  expires_at    timestamptz,
  scope         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (household_id, provider)
);

-- ---------------------------------------------------------------------------
-- Column back-fill
--
-- `create table if not exists` above is a no-op on a project that already has
-- the table, which means a column added in a later revision would silently
-- never appear. These statements make re-running this file actually bring an
-- existing deployment up to date rather than just appearing to.
-- ---------------------------------------------------------------------------

-- chore_log
alter table public.chore_log add column if not exists household_id text;
alter table public.chore_log add column if not exists day date;
alter table public.chore_log add column if not exists task_key text;
alter table public.chore_log add column if not exists member_id text;

-- chore_members
alter table public.chore_members add column if not exists chore_id text;
alter table public.chore_members add column if not exists member_id text;
alter table public.chore_members add column if not exists household_id text;
alter table public.chore_members add column if not exists sort_order integer default 0;

-- chores
alter table public.chores add column if not exists id text;
alter table public.chores add column if not exists household_id text;
alter table public.chores add column if not exists title text default ''::text;
alter table public.chores add column if not exists days integer[] default '{}'::integer[];
alter table public.chores add column if not exists stars integer default 1;
alter table public.chores add column if not exists sort_order integer default 0;

-- countdowns
alter table public.countdowns add column if not exists id text;
alter table public.countdowns add column if not exists household_id text;
alter table public.countdowns add column if not exists title text default ''::text;
alter table public.countdowns add column if not exists date date;
alter table public.countdowns add column if not exists member_id text;
alter table public.countdowns add column if not exists sort_order integer default 0;

-- event_members
alter table public.event_members add column if not exists event_id text;
alter table public.event_members add column if not exists member_id text;
alter table public.event_members add column if not exists household_id text;
alter table public.event_members add column if not exists sort_order integer default 0;

-- events
alter table public.events add column if not exists id text;
alter table public.events add column if not exists household_id text;
alter table public.events add column if not exists title text default ''::text;
alter table public.events add column if not exists date date;
alter table public.events add column if not exists start_time text;
alter table public.events add column if not exists dur integer;
alter table public.events add column if not exists loc text default ''::text;
alter table public.events add column if not exists recur text;
alter table public.events add column if not exists drop_member_id text;
alter table public.events add column if not exists pick_member_id text;
alter table public.events add column if not exists sort_order integer default 0;

-- favorites
alter table public.favorites add column if not exists id text;
alter table public.favorites add column if not exists household_id text;
alter table public.favorites add column if not exists name text default ''::text;
alter table public.favorites add column if not exists tag text;
alter table public.favorites add column if not exists sort_order integer default 0;

-- feed_events
alter table public.feed_events add column if not exists id text;
alter table public.feed_events add column if not exists household_id text;
alter table public.feed_events add column if not exists feed_id text;
alter table public.feed_events add column if not exists title text default ''::text;
alter table public.feed_events add column if not exists date date;
alter table public.feed_events add column if not exists start_time text;
alter table public.feed_events add column if not exists dur integer;
alter table public.feed_events add column if not exists loc text default ''::text;
alter table public.feed_events add column if not exists recur text;
alter table public.feed_events add column if not exists sort_order integer default 0;

-- feeds
alter table public.feeds add column if not exists id text;
alter table public.feeds add column if not exists household_id text;
alter table public.feeds add column if not exists name text default ''::text;
alter table public.feeds add column if not exists url text default ''::text;
alter table public.feeds add column if not exists op_ref text;
alter table public.feeds add column if not exists color text default '#5B8DEF'::text;
alter table public.feeds add column if not exists status text default 'Not synced yet'::text;
alter table public.feeds add column if not exists member_ids text[] default '{}'::text[];
alter table public.feeds add column if not exists sort_order integer default 0;

-- fit_stats
alter table public.fit_stats add column if not exists household_id text;
alter table public.fit_stats add column if not exists member_id text;
alter table public.fit_stats add column if not exists kind text;
alter table public.fit_stats add column if not exists sleep double precision default 0;
alter table public.fit_stats add column if not exists strain double precision;
alter table public.fit_stats add column if not exists act double precision;
alter table public.fit_stats add column if not exists updated_at timestamp with time zone default now();

-- greenlight
alter table public.greenlight add column if not exists household_id text;
alter table public.greenlight add column if not exists member_id text;
alter table public.greenlight add column if not exists bal numeric(10,2) default 0;
alter table public.greenlight add column if not exists allow numeric(10,2) default 0;
alter table public.greenlight add column if not exists goal text default ''::text;
alter table public.greenlight add column if not exists goal_cost numeric(10,2) default 0;
alter table public.greenlight add column if not exists saved numeric(10,2) default 0;

-- greenlight_payouts
alter table public.greenlight_payouts add column if not exists id text;
alter table public.greenlight_payouts add column if not exists household_id text;
alter table public.greenlight_payouts add column if not exists member_id text;
alter table public.greenlight_payouts add column if not exists d text default ''::text;
alter table public.greenlight_payouts add column if not exists for_what text default ''::text;
alter table public.greenlight_payouts add column if not exists amt numeric(10,2) default 0;
alter table public.greenlight_payouts add column if not exists sort_order integer default 0;

-- household_users
alter table public.household_users add column if not exists household_id text;
alter table public.household_users add column if not exists user_id uuid;
alter table public.household_users add column if not exists role text default 'parent'::text;
alter table public.household_users add column if not exists created_at timestamp with time zone default now();

-- households
alter table public.households add column if not exists id text;
alter table public.households add column if not exists name text default 'Family'::text;
alter table public.households add column if not exists parent_pin text default '1234'::text;
alter table public.households add column if not exists zip text default ''::text;
alter table public.households add column if not exists lat double precision default 0;
alter table public.households add column if not exists lon double precision default 0;
alter table public.households add column if not exists place text default ''::text;
alter table public.households add column if not exists preflight_open boolean default true;
alter table public.households add column if not exists preflight_depart text default '07:30'::text;
alter table public.households add column if not exists created_at timestamp with time zone default now();
alter table public.households add column if not exists updated_at timestamp with time zone default now();

-- list_items
alter table public.list_items add column if not exists id text;
alter table public.list_items add column if not exists list_id text;
alter table public.list_items add column if not exists household_id text;
alter table public.list_items add column if not exists text text default ''::text;
alter table public.list_items add column if not exists done boolean default false;
alter table public.list_items add column if not exists by_member_id text;
alter table public.list_items add column if not exists sort_order integer default 0;

-- lists
alter table public.lists add column if not exists id text;
alter table public.lists add column if not exists household_id text;
alter table public.lists add column if not exists name text default ''::text;
alter table public.lists add column if not exists sort_order integer default 0;

-- meal_plan
alter table public.meal_plan add column if not exists household_id text;
alter table public.meal_plan add column if not exists day date;
alter table public.meal_plan add column if not exists meal text default ''::text;

-- member_links
alter table public.member_links add column if not exists id text;
alter table public.member_links add column if not exists household_id text;
alter table public.member_links add column if not exists member_id text;
alter table public.member_links add column if not exists label text default ''::text;
alter table public.member_links add column if not exists url text default ''::text;
alter table public.member_links add column if not exists sort_order integer default 0;

-- members
alter table public.members add column if not exists id text;
alter table public.members add column if not exists household_id text;
alter table public.members add column if not exists name text;
alter table public.members add column if not exists role text;
alter table public.members add column if not exists color text default '#4A5B8C'::text;
alter table public.members add column if not exists age integer;
alter table public.members add column if not exists photo text;
alter table public.members add column if not exists pin text;
alter table public.members add column if not exists sort_order integer default 0;

-- oauth_tokens
alter table public.oauth_tokens add column if not exists id text;
alter table public.oauth_tokens add column if not exists household_id text;
alter table public.oauth_tokens add column if not exists provider text;
alter table public.oauth_tokens add column if not exists member_id text;
alter table public.oauth_tokens add column if not exists access_token text;
alter table public.oauth_tokens add column if not exists refresh_token text;
alter table public.oauth_tokens add column if not exists expires_at timestamp with time zone;
alter table public.oauth_tokens add column if not exists scope text;
alter table public.oauth_tokens add column if not exists created_at timestamp with time zone default now();
alter table public.oauth_tokens add column if not exists updated_at timestamp with time zone default now();

-- preflight_bring
alter table public.preflight_bring add column if not exists id text;
alter table public.preflight_bring add column if not exists household_id text;
alter table public.preflight_bring add column if not exists member_id text;
alter table public.preflight_bring add column if not exists text text default ''::text;
alter table public.preflight_bring add column if not exists days integer[] default '{}'::integer[];
alter table public.preflight_bring add column if not exists sort_order integer default 0;

-- preflight_kids
alter table public.preflight_kids add column if not exists household_id text;
alter table public.preflight_kids add column if not exists member_id text;
alter table public.preflight_kids add column if not exists gym integer[] default '{}'::integer[];
alter table public.preflight_kids add column if not exists lun integer[] default '{}'::integer[];

-- redemptions
alter table public.redemptions add column if not exists id text;
alter table public.redemptions add column if not exists household_id text;
alter table public.redemptions add column if not exists kid_id text;
alter table public.redemptions add column if not exists title text default ''::text;
alter table public.redemptions add column if not exists cost integer default 0;
alter table public.redemptions add column if not exists ts bigint default 0;
alter table public.redemptions add column if not exists sort_order integer default 0;

-- rewards
alter table public.rewards add column if not exists id text;
alter table public.rewards add column if not exists household_id text;
alter table public.rewards add column if not exists title text default ''::text;
alter table public.rewards add column if not exists cost integer default 0;
alter table public.rewards add column if not exists sort_order integer default 0;

-- secrets
alter table public.secrets add column if not exists id text;
alter table public.secrets add column if not exists household_id text;
alter table public.secrets add column if not exists label text default ''::text;
alter table public.secrets add column if not exists ref text default ''::text;
alter table public.secrets add column if not exists note text;
alter table public.secrets add column if not exists sort_order integer default 0;
-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
  -- Every household-scoped table gets the same policy shape.
  scoped text[] := array[
    'members', 'member_links', 'events', 'event_members', 'chores', 'chore_members', 'chore_log',
    'rewards', 'redemptions', 'favorites', 'meal_plan', 'lists', 'list_items',
    'countdowns', 'feeds', 'secrets', 'preflight_kids', 'preflight_bring',
    'fit_stats', 'greenlight', 'greenlight_payouts'
  ];
begin
  foreach t in array scoped loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_household_rw', t);
    execute format(
      'create policy %I on public.%I for all to authenticated '
      || 'using (household_id = public.current_household_id()) '
      || 'with check (household_id = public.current_household_id())',
      t || '_household_rw', t
    );
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end
$$;

-- households: readable and updatable by its own members.
alter table public.households enable row level security;
alter table public.households force row level security;
drop policy if exists households_rw on public.households;
create policy households_rw on public.households
  for all to authenticated
  using (id = public.current_household_id())
  with check (id = public.current_household_id());
grant select, insert, update on public.households to authenticated;

-- household_users: a user may only see their own membership rows. This policy
-- must not call current_household_id() — that function reads this table.
alter table public.household_users enable row level security;
alter table public.household_users force row level security;
drop policy if exists household_users_self on public.household_users;
create policy household_users_self on public.household_users
  for select to authenticated
  using (user_id = auth.uid());
grant select on public.household_users to authenticated;

-- feed_events: readable by the household, writable only by the scheduled sync.
-- SELECT is the only grant, so a device cannot alter feed data even by mistake
-- — which matches how the app already treats it (ResolvedEvent.readOnly).
alter table public.feed_events enable row level security;
alter table public.feed_events force row level security;
drop policy if exists feed_events_household_read on public.feed_events;
create policy feed_events_household_read on public.feed_events
  for select to authenticated
  using (household_id = public.current_household_id());
grant select on public.feed_events to authenticated;
revoke insert, update, delete on public.feed_events from authenticated, anon;

-- oauth_tokens: RLS on with no policy for the browser roles, *and* no table
-- grants. Either alone would be enough; both together means a leaked anon or
-- authenticated key still cannot read an integration token.
alter table public.oauth_tokens enable row level security;
alter table public.oauth_tokens force row level security;
revoke all on public.oauth_tokens from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Realtime
--
-- Supabase only broadcasts row changes for tables in the supabase_realtime
-- publication. Without this, cloudSync's subscribe() connects, reports itself
-- healthy, and never fires — the failure looks like "other devices don't
-- update" rather than like an error.
--
-- oauth_tokens is deliberately excluded: nothing should be able to watch it.
-- The whole block no-ops where that publication doesn't exist, so plain
-- Postgres (the local test cluster) is unaffected.
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
  watched text[] := array[
    'households', 'members', 'member_links', 'events', 'event_members', 'chores', 'chore_members',
    'chore_log', 'rewards', 'redemptions', 'favorites', 'meal_plan', 'lists',
    'list_items', 'countdowns', 'feeds', 'feed_events', 'secrets', 'preflight_kids',
    'preflight_bring', 'fit_stats', 'greenlight', 'greenlight_payouts'
  ];
begin
  -- The `realtime` schema is the reliable "am I on Supabase?" tell; a plain
  -- Postgres cluster (including the local test one) has no such schema even
  -- with local-shim.sql applied.
  if not exists (select 1 from pg_namespace where nspname = 'realtime') then
    raise notice 'no realtime schema — skipping publication setup (not a Supabase database)';
    return;
  end if;

  -- Normally Supabase ships this publication, but not every project has it.
  -- Without it there is nothing to subscribe to and cloudSync goes quiet.
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
    raise notice 'created the supabase_realtime publication';
  end if;

  foreach t in array watched loop
    -- Default replica identity writes only the primary key to the WAL on
    -- DELETE, so household_id is absent from the old record and a subscription
    -- filtered on household_id drops delete events entirely — inserts and
    -- updates arrive, deletes vanish. FULL puts the whole old row in the WAL.
    execute format('alter table public.%I replica identity full', t);

    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end
$$;

commit;
