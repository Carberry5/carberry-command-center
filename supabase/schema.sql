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
  -- Where the item came from. null = somebody typed it in the app. 'reminders'
  -- = it arrived from an iCloud Reminders list through ingest_list(), and that
  -- job owns it: on the next ingest, reminders rows absent from the payload are
  -- removed and app rows are left alone. Without this column the two sources
  -- would fight over the same list.
  source         text,
  -- The id this item has in the system it syncs with — a Google Tasks task id.
  -- Without it there is no way to tell "the milk task, renamed" from "a new
  -- task", so ticking something off here could not be reflected there and every
  -- rename would arrive as a duplicate.
  remote_id      text,
  sort_order     integer not null default 0
);
-- The unique index on remote_id is created after the column back-fill below,
-- not here: on a database that already has list_items the create above is a
-- no-op, so remote_id would not exist yet and the index would fail.

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
-- Grocery savings — staples, imported store deals, the week's plan
-- ---------------------------------------------------------------------------

-- What the family buys week after week; deals are matched against these.
create table if not exists public.staples (
  id           text primary key,
  household_id text not null references public.households(id) on delete cascade,
  name         text not null default '',
  category     text not null default 'Pantry',
  note         text,
  sort_order   integer not null default 0
);

create index if not exists staples_household_idx on public.staples(household_id);

-- Current offers per store, replaced wholesale on each import. staple_id has no
-- foreign key on purpose: deleting a staple should not take its deals with it —
-- the client just stops treating them as matches.
create table if not exists public.deals (
  id           text primary key,
  household_id text not null references public.households(id) on delete cascade,
  store        text not null check (store in ('foodlion', 'giant', 'costco', 'amazon')),
  item         text not null default '',
  price        text not null default '',
  savings      text not null default '',
  detail       text not null default '',
  -- "YYYY-MM-DD" or '' when the ad doesn't say — text, because '' is not a date.
  ends         text not null default '',
  staple_id    text,
  sort_order   integer not null default 0
);

create index if not exists deals_household_store_idx on public.deals(household_id, store);

-- "14 deals · synced Aug 3", one line per store.
create table if not exists public.savings_status (
  household_id text not null references public.households(id) on delete cascade,
  store        text not null check (store in ('foodlion', 'giant', 'costco', 'amazon')),
  status       text not null default '',
  primary key (household_id, store)
);

-- The Claude-written weekly strategy; one row per household, replaced on rebuild.
create table if not exists public.savings_plan (
  household_id text primary key references public.households(id) on delete cascade,
  week         text not null default '',
  summary      text not null default '',
  generated_at bigint not null default 0
);

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
  -- Per-provider settings that are not credentials: for Google Tasks, which
  -- task list feeds which of the family's lists. A jsonb blob rather than
  -- columns, because every provider wants something different and none of it
  -- is ever queried — the sync reads the whole row anyway.
  config        jsonb not null default '{}'::jsonb,
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
alter table public.list_items add column if not exists source text;
alter table public.list_items add column if not exists remote_id text;
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
alter table public.oauth_tokens add column if not exists config jsonb default '{}'::jsonb;
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

-- staples
alter table public.staples add column if not exists id text;
alter table public.staples add column if not exists household_id text;
alter table public.staples add column if not exists name text default ''::text;
alter table public.staples add column if not exists category text default 'Pantry'::text;
alter table public.staples add column if not exists note text;
alter table public.staples add column if not exists sort_order integer default 0;

-- deals
alter table public.deals add column if not exists id text;
alter table public.deals add column if not exists household_id text;
alter table public.deals add column if not exists store text;
alter table public.deals add column if not exists item text default ''::text;
alter table public.deals add column if not exists price text default ''::text;
alter table public.deals add column if not exists savings text default ''::text;
alter table public.deals add column if not exists detail text default ''::text;
alter table public.deals add column if not exists ends text default ''::text;
alter table public.deals add column if not exists staple_id text;
alter table public.deals add column if not exists sort_order integer default 0;

-- savings_status
alter table public.savings_status add column if not exists household_id text;
alter table public.savings_status add column if not exists store text;
alter table public.savings_status add column if not exists status text default ''::text;

-- savings_plan
alter table public.savings_plan add column if not exists household_id text;
alter table public.savings_plan add column if not exists week text default ''::text;
alter table public.savings_plan add column if not exists summary text default ''::text;
alter table public.savings_plan add column if not exists generated_at bigint default 0;

-- secrets
alter table public.secrets add column if not exists id text;
alter table public.secrets add column if not exists household_id text;
alter table public.secrets add column if not exists label text default ''::text;
alter table public.secrets add column if not exists ref text default ''::text;
alter table public.secrets add column if not exists note text;
alter table public.secrets add column if not exists sort_order integer default 0;
-- ---------------------------------------------------------------------------
-- Indexes that depend on back-filled columns
--
-- These have to come after the section above, not next to their create table:
-- on a database that already holds the table, `create table if not exists` is a
-- no-op and the column only appears in the back-fill.
-- ---------------------------------------------------------------------------

-- Partial: only synced rows carry a remote id, and any number of app-typed
-- items must be allowed to have none. Unique so one Google task cannot be
-- claimed by two items, which would make a completion ambiguous.
create unique index if not exists list_items_remote_idx
  on public.list_items(household_id, remote_id) where remote_id is not null;

-- ---------------------------------------------------------------------------
-- List ingest — iCloud Reminders and anything else that can make an HTTP POST
--
-- Apple publishes no Reminders API, and an icloud.com/reminders/… link is a
-- share invitation rather than a feed — nothing can fetch data from it. What a
-- phone *can* do is run a Shortcut that reads the list locally and posts it
-- somewhere. This is the somewhere.
--
-- The caller presents a token, not a Supabase key. Only its SHA-256 lives here,
-- so a database dump does not hand anyone the ability to write; and the token
-- resolves to exactly one household and one list, so the worst a leaked one can
-- do is rewrite that grocery list. Compare that to the alternative of putting a
-- service role key on a phone, which would bypass RLS for every household.
-- ---------------------------------------------------------------------------

create table if not exists public.list_ingest_tokens (
  id            text primary key,
  household_id  text not null references public.households(id) on delete cascade,
  -- The list this token may write. Created on first use if absent.
  list_name     text not null,
  -- hex sha256 of the token. The token itself is shown once, at mint time.
  token_hash    text not null unique,
  -- Items land attributed to this member, so the list shows who added them.
  member_id     text,
  label         text,
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz
);

alter table public.list_ingest_tokens add column if not exists household_id text;
alter table public.list_ingest_tokens add column if not exists list_name text;
alter table public.list_ingest_tokens add column if not exists token_hash text;
alter table public.list_ingest_tokens add column if not exists member_id text;
alter table public.list_ingest_tokens add column if not exists label text;
alter table public.list_ingest_tokens add column if not exists created_at timestamptz default now();
alter table public.list_ingest_tokens add column if not exists last_used_at timestamptz;

create index if not exists list_ingest_tokens_household_idx
  on public.list_ingest_tokens(household_id);

/**
 * Replaces the reminders-sourced items of one list.
 *
 * `p_items` is the list as the phone sees it right now — the incomplete items.
 * Anything reminders-sourced that is not in the payload has been checked off or
 * deleted upstream, so it goes; anything a person typed into the app stays.
 *
 * Item ids are derived from the list and the text, so re-posting an unchanged
 * list produces byte-identical rows. That matters: cloudSync diffs snapshots,
 * and churning ids would make every device see a change every five minutes.
 */
create or replace function public.ingest_list(p_token text, p_items text[])
returns json
language plpgsql
security definer
-- Pinned: a SECURITY DEFINER function that resolves unqualified names through
-- the caller's search_path is how privilege escalation happens.
set search_path = public, pg_temp
as $$
declare
  tok        public.list_ingest_tokens%rowtype;
  v_list_id  text;
  v_clean    text[];
  v_added    int;
  v_removed  int;
  v_kept     int;
begin
  if p_items is null then
    raise exception 'items is required' using errcode = '22023';
  end if;
  -- A grocery list is tens of items. A million-element array is either a bug or
  -- somebody probing, and either way should not become a million rows.
  if array_length(p_items, 1) > 500 then
    raise exception 'too many items (max 500)' using errcode = '22023';
  end if;

  select * into tok
    from public.list_ingest_tokens
   where token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
  if not found then
    -- Deliberately not "no such token": the caller learns only that it failed.
    raise exception 'invalid ingest token' using errcode = '28000';
  end if;

  -- Normalise once: trimmed, non-empty, de-duplicated case-insensitively,
  -- payload order preserved. A local array rather than a temp table, because a
  -- temp table declared `on commit drop` survives until the *transaction*
  -- commits — so two calls in one transaction collide on the second create.
  -- Each RPC call is its own transaction in production, but a test suite or a
  -- batch job is not, and this should not be a trap.
  select array_agg(txt order by ord) into v_clean
    from (
      select (array_agg(btrim(u.t) order by u.ord))[1] as txt, min(u.ord) as ord
        from unnest(p_items) with ordinality as u(t, ord)
       where btrim(u.t) <> ''
       group by lower(btrim(u.t))
    ) s;
  -- All blank, or an empty list: everything has been checked off upstream.
  v_clean := coalesce(v_clean, array[]::text[]);

  select id into v_list_id
    from public.lists
   where household_id = tok.household_id and lower(name) = lower(tok.list_name)
   order by sort_order
   limit 1;

  if v_list_id is null then
    v_list_id := 'ingest:' || tok.id;
    insert into public.lists (id, household_id, name, sort_order)
    values (v_list_id, tok.household_id, tok.list_name,
            coalesce((select max(sort_order) + 1 from public.lists
                       where household_id = tok.household_id), 0));
  end if;

  -- Gone from the phone's list, so gone from ours. Scoped to source =
  -- 'reminders' so nothing anybody typed in the app is ever deleted here.
  with removed as (
    delete from public.list_items li
     where li.list_id = v_list_id
       and li.source = 'reminders'
       and not exists (select 1 from unnest(v_clean) c where lower(c) = lower(li.text))
    returning 1
  )
  select count(*) into v_removed from removed;

  -- New to us. Matched case-insensitively against every item already in the
  -- list, whatever its source, so an item somebody typed by hand does not
  -- reappear as a second copy the moment it shows up in Reminders too.
  with added as (
    insert into public.list_items (id, list_id, household_id, text, done, by_member_id, source, sort_order)
    select 'rem:' || md5(v_list_id || '|' || lower(i.text)),
           v_list_id, tok.household_id, i.text, false, tok.member_id, 'reminders',
           -- Grouped after whatever the family typed, rather than interleaved
           -- into their ordering.
           1000 + i.ord
      from unnest(v_clean) with ordinality as i(text, ord)
     where not exists (
       select 1 from public.list_items li
        where li.list_id = v_list_id and lower(li.text) = lower(i.text)
     )
    on conflict (id) do nothing
    returning 1
  )
  select count(*) into v_added from added;

  select count(*) into v_kept from public.list_items where list_id = v_list_id;

  update public.list_ingest_tokens set last_used_at = now() where id = tok.id;

  return json_build_object(
    'list_id', v_list_id,
    'list_name', tok.list_name,
    'added', v_added,
    'removed', v_removed,
    'total', v_kept
  );
end
$$;

-- Callable by an unauthenticated caller — the token is the credential, and a
-- Shortcut has no Supabase session. EXECUTE is revoked from PUBLIC first
-- because Postgres grants it to PUBLIC by default, which would also expose it
-- to any future role.
revoke all on function public.ingest_list(text, text[]) from public;
grant execute on function public.ingest_list(text, text[]) to anon, authenticated;

-- The token table itself is unreachable from any browser role: RLS on with no
-- policy, and no grants. Only the service role (scripts/list-token.ts) and the
-- SECURITY DEFINER function above can see it.
alter table public.list_ingest_tokens enable row level security;
alter table public.list_ingest_tokens force row level security;
revoke all on public.list_ingest_tokens from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Deals ingest — anything that can extract grocery deals and make an HTTP POST
--
-- The grocery sites bot-block server-side fetches, but their deal emails land
-- in Gmail. A scheduled Claude session (or anything else) reads those emails,
-- extracts the deals, and posts them here. Same trust model as ingest_list
-- above: the caller presents a token, only its SHA-256 lives here, and the
-- token resolves to exactly one household's deals — the worst a leaked one can
-- do is rewrite a list of grocery prices.
-- ---------------------------------------------------------------------------

create table if not exists public.deals_ingest_tokens (
  id            text primary key,
  household_id  text not null references public.households(id) on delete cascade,
  -- hex sha256 of the token. The token itself is shown once, at mint time.
  token_hash    text not null unique,
  label         text,
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz
);

alter table public.deals_ingest_tokens add column if not exists household_id text;
alter table public.deals_ingest_tokens add column if not exists token_hash text;
alter table public.deals_ingest_tokens add column if not exists label text;
alter table public.deals_ingest_tokens add column if not exists created_at timestamptz default now();
alter table public.deals_ingest_tokens add column if not exists last_used_at timestamptz;

create index if not exists deals_ingest_tokens_household_idx
  on public.deals_ingest_tokens(household_id);

/**
 * What the extractor needs before it can match deals: the household's staples.
 * Read-only, token-gated, and deliberately nothing else — no names, no
 * calendar, no lists.
 */
create or replace function public.savings_context(p_token text)
returns json
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  tok public.deals_ingest_tokens%rowtype;
begin
  select * into tok
    from public.deals_ingest_tokens
   where token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
  if not found then
    raise exception 'invalid ingest token' using errcode = '28000';
  end if;

  return json_build_object(
    'staples', coalesce((
      select json_agg(json_build_object(
               'id', s.id, 'name', s.name, 'category', s.category, 'note', s.note)
             order by s.sort_order)
        from public.staples s
       where s.household_id = tok.household_id
    ), '[]'::json)
  );
end
$$;

/**
 * Replaces one store's deals with a freshly extracted set.
 *
 * `p_deals` is a json array of {item, price, savings, detail, ends, stapleId}.
 * The whole store is replaced each call — deals are a cache of the current ad,
 * not authored data, so nothing is lost by discarding the previous set. Ids
 * are derived from store+item+price, so re-posting an unchanged ad produces
 * byte-identical rows and the devices' differ sees nothing to sync.
 */
create or replace function public.ingest_deals(
  p_token text,
  p_store text,
  p_deals jsonb,
  p_source text default 'Gmail'
)
returns json
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  tok      public.deals_ingest_tokens%rowtype;
  v_count  int;
begin
  if p_store is null or p_store not in ('foodlion', 'giant', 'costco', 'amazon') then
    raise exception 'unknown store' using errcode = '22023';
  end if;
  if p_deals is null or jsonb_typeof(p_deals) <> 'array' then
    raise exception 'deals must be a json array' using errcode = '22023';
  end if;
  -- A weekly ad is dozens of deals. Thousands is a bug or a probe.
  if jsonb_array_length(p_deals) > 300 then
    raise exception 'too many deals (max 300)' using errcode = '22023';
  end if;

  select * into tok
    from public.deals_ingest_tokens
   where token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
  if not found then
    raise exception 'invalid ingest token' using errcode = '28000';
  end if;

  delete from public.deals
   where household_id = tok.household_id and store = p_store;

  with cleaned as (
    select btrim(d.value->>'item')                                   as item,
           btrim(coalesce(d.value->>'price', ''))                    as price,
           btrim(coalesce(d.value->>'savings', ''))                  as savings,
           btrim(coalesce(d.value->>'detail', ''))                   as detail,
           case when coalesce(d.value->>'ends', '') ~ '^\d{4}-\d{2}-\d{2}$'
                then d.value->>'ends' else '' end                    as ends,
           nullif(btrim(coalesce(d.value->>'stapleId', '')), '')     as staple_id,
           d.ord
      from jsonb_array_elements(p_deals) with ordinality as d(value, ord)
     where btrim(coalesce(d.value->>'item', '')) <> ''
       and btrim(coalesce(d.value->>'price', '')) <> ''
  ),
  inserted as (
    insert into public.deals
      (id, household_id, store, item, price, savings, detail, ends, staple_id, sort_order)
    select distinct on (lower(c.item), c.price)
           'ing:' || md5(p_store || '|' || lower(c.item) || '|' || c.price),
           tok.household_id, p_store, c.item, c.price, c.savings, c.detail, c.ends,
           -- Only keep matches that point at a staple this household really has.
           (select s.id from public.staples s
             where s.household_id = tok.household_id and s.id = c.staple_id),
           1000 + c.ord
      from cleaned c
     order by lower(c.item), c.price, c.ord
        on conflict (id) do nothing
    returning 1
  )
  select count(*) into v_count from inserted;

  insert into public.savings_status (household_id, store, status)
  values (tok.household_id, p_store,
          v_count || ' deals · ' || coalesce(nullif(btrim(p_source), ''), 'Gmail')
                  || ' ' || to_char(now(), 'Mon FMDD'))
  on conflict (household_id, store)
  do update set status = excluded.status;

  update public.deals_ingest_tokens set last_used_at = now() where id = tok.id;

  return json_build_object('store', p_store, 'imported', v_count);
end
$$;

revoke all on function public.savings_context(text) from public;
revoke all on function public.ingest_deals(text, text, jsonb, text) from public;
grant execute on function public.savings_context(text) to anon, authenticated;
grant execute on function public.ingest_deals(text, text, jsonb, text) to anon, authenticated;

-- The token table itself is unreachable from any browser role, exactly like
-- list_ingest_tokens: RLS on with no policy, and no grants.
alter table public.deals_ingest_tokens enable row level security;
alter table public.deals_ingest_tokens force row level security;
revoke all on public.deals_ingest_tokens from anon, authenticated;

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
    'fit_stats', 'greenlight', 'greenlight_payouts',
    'staples', 'deals', 'savings_status', 'savings_plan'
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
    'preflight_bring', 'fit_stats', 'greenlight', 'greenlight_payouts',
    'staples', 'deals', 'savings_status', 'savings_plan'
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
