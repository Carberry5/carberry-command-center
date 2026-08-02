-- Exercises public.ingest_list() against a real Postgres holding schema.sql.
--
-- The function is the whole grocery-list integration: everything upstream of it
-- is an Apple Shortcut, which cannot be tested from here. So the behaviour that
-- matters — that it is idempotent, that it never touches an item somebody typed
-- in the app, and that a wrong token gets nothing — is pinned here.
--
--   psql "$PGURL" -v ON_ERROR_STOP=1 -f supabase/ingest-test.sql
--
-- Cleans up after itself. Raises an exception on the first failure, so a
-- non-zero exit is the whole result.

\set ON_ERROR_STOP on
set client_min_messages = notice;

do $$
declare
  hh        constant text := 'hh_ingest_test';
  tok       constant text := 'test-token-do-not-use';
  tok2      constant text := 'a-different-token';
  res       json;
  n         int;
  v_list    text;
  checks    int := 0;
begin
  -- --- fixture -------------------------------------------------------------
  delete from public.households where id = hh;
  insert into public.households (id, parent_pin) values (hh, '0000');
  insert into public.members (id, household_id, name, role, color)
  values ('m_e', hh, 'Elizabeth', 'parent', '#0F8B8D');

  insert into public.list_ingest_tokens (id, household_id, list_name, token_hash, member_id, label)
  values ('lit_test', hh, 'Groceries',
          encode(sha256(convert_to(tok, 'UTF8')), 'hex'), 'm_e', 'test');

  -- --- a bad token is rejected before anything is written ------------------
  begin
    res := public.ingest_list('not-the-token', array['Milk']);
    raise exception 'FAIL: a bad token was accepted';
  exception when sqlstate '28000' then
    checks := checks + 1;
    raise notice '  ok: a bad token is rejected';
  end;

  select count(*) into n from public.lists where household_id = hh;
  if n <> 0 then raise exception 'FAIL: a rejected call created a list'; end if;
  checks := checks + 1;
  raise notice '  ok: a rejected call writes nothing';

  -- --- first post creates the list ----------------------------------------
  res := public.ingest_list(tok, array['Milk', 'Eggs', 'Bananas']);
  v_list := res->>'list_id';

  select count(*) into n from public.lists where household_id = hh and name = 'Groceries';
  if n <> 1 then raise exception 'FAIL: expected 1 Groceries list, got %', n; end if;
  checks := checks + 1;
  raise notice '  ok: the list is created on first post';

  select count(*) into n from public.list_items where list_id = v_list;
  if n <> 3 then raise exception 'FAIL: expected 3 items, got %', n; end if;
  checks := checks + 1;
  raise notice '  ok: three items landed';

  select count(*) into n from public.list_items where list_id = v_list and source = 'reminders';
  if n <> 3 then raise exception 'FAIL: items are not marked as reminders-sourced'; end if;
  checks := checks + 1;
  raise notice '  ok: items are marked source = reminders';

  select count(*) into n from public.list_items where list_id = v_list and by_member_id = 'm_e';
  if n <> 3 then raise exception 'FAIL: items are not attributed to the token member'; end if;
  checks := checks + 1;
  raise notice '  ok: items are attributed to the token''s member';

  if (res->>'added')::int <> 3 then raise exception 'FAIL: added should be 3, got %', res->>'added'; end if;
  checks := checks + 1;
  raise notice '  ok: the summary reports 3 added';

  -- --- idempotence: the same post again changes nothing --------------------
  declare
    before_ids text;
    after_ids  text;
  begin
    select string_agg(id || ':' || text, ',' order by id) into before_ids
      from public.list_items where list_id = v_list;

    res := public.ingest_list(tok, array['Milk', 'Eggs', 'Bananas']);

    select string_agg(id || ':' || text, ',' order by id) into after_ids
      from public.list_items where list_id = v_list;

    if before_ids is distinct from after_ids then
      raise exception 'FAIL: re-posting changed the rows. before=% after=%', before_ids, after_ids;
    end if;
    checks := checks + 1;
    raise notice '  ok: re-posting the same list is a no-op (ids stable)';

    if (res->>'added')::int <> 0 or (res->>'removed')::int <> 0 then
      raise exception 'FAIL: re-post reported added=% removed=%', res->>'added', res->>'removed';
    end if;
    checks := checks + 1;
    raise notice '  ok: and reports nothing added or removed';
  end;

  select count(*) into n from public.lists where household_id = hh;
  if n <> 1 then raise exception 'FAIL: re-posting created a second list (got %)', n; end if;
  checks := checks + 1;
  raise notice '  ok: re-posting does not create a second list';

  -- --- an item somebody typed in the app is never touched -------------------
  insert into public.list_items (id, list_id, household_id, text, done, by_member_id, sort_order)
  values ('app_1', v_list, hh, 'Birthday candles', false, 'm_e', 0);

  -- Milk is gone from the phone; Birthday candles was never on it.
  res := public.ingest_list(tok, array['Eggs', 'Bananas']);

  select count(*) into n from public.list_items where id = 'app_1';
  if n <> 1 then raise exception 'FAIL: an app-typed item was deleted by the ingest'; end if;
  checks := checks + 1;
  raise notice '  ok: an app-typed item survives an ingest that omits it';

  select count(*) into n from public.list_items where list_id = v_list and lower(text) = 'milk';
  if n <> 0 then raise exception 'FAIL: an item removed upstream was kept'; end if;
  checks := checks + 1;
  raise notice '  ok: an item checked off in Reminders is removed';

  if (res->>'removed')::int <> 1 then
    raise exception 'FAIL: removed should be 1, got %', res->>'removed';
  end if;
  checks := checks + 1;
  raise notice '  ok: the summary reports 1 removed';

  -- --- no duplicate when the same text exists from the other source --------
  update public.list_items set text = 'Eggs', source = null where id = 'app_1';
  delete from public.list_items where list_id = v_list and source = 'reminders' and lower(text) = 'eggs';
  res := public.ingest_list(tok, array['Eggs', 'Bananas']);

  select count(*) into n from public.list_items where list_id = v_list and lower(text) = 'eggs';
  if n <> 1 then raise exception 'FAIL: "Eggs" exists % times after ingest', n; end if;
  checks := checks + 1;
  raise notice '  ok: an item typed by hand is not duplicated by the ingest';

  -- --- blank and duplicate entries in the payload --------------------------
  res := public.ingest_list(tok, array['  Butter  ', 'Butter', '', '   ', 'butter']);
  select count(*) into n from public.list_items where list_id = v_list and lower(text) = 'butter';
  if n <> 1 then raise exception 'FAIL: "Butter" landed % times', n; end if;
  checks := checks + 1;
  raise notice '  ok: blanks dropped, duplicates and case folded to one item';

  select count(*) into n from public.list_items
   where list_id = v_list and text = 'Butter' and source = 'reminders';
  if n <> 1 then raise exception 'FAIL: whitespace was not trimmed from the item text'; end if;
  checks := checks + 1;
  raise notice '  ok: surrounding whitespace is trimmed';

  -- --- an oversized payload is refused -------------------------------------
  begin
    res := public.ingest_list(tok, (select array_agg('item ' || g) from generate_series(1, 501) g));
    raise exception 'FAIL: a 501-item payload was accepted';
  exception when sqlstate '22023' then
    checks := checks + 1;
    raise notice '  ok: a payload over 500 items is refused';
  end;

  -- --- a token cannot reach another household ------------------------------
  insert into public.households (id, parent_pin) values ('hh_ingest_other', '0000')
    on conflict (id) do nothing;
  insert into public.list_ingest_tokens (id, household_id, list_name, token_hash)
  values ('lit_other', 'hh_ingest_other', 'Groceries',
          encode(sha256(convert_to(tok2, 'UTF8')), 'hex'));

  res := public.ingest_list(tok2, array['Something else']);
  if (res->>'list_id') = v_list then
    raise exception 'FAIL: a second household''s token wrote into the first household''s list';
  end if;
  select count(*) into n from public.list_items
   where list_id = v_list and lower(text) = 'something else';
  if n <> 0 then raise exception 'FAIL: cross-household write leaked in'; end if;
  checks := checks + 1;
  raise notice '  ok: a token only reaches its own household';

  -- --- item ids are derived from the text, not minted ----------------------
  -- The "no-op on re-post" check above passes even with random ids, because a
  -- re-post inserts nothing at all. This is what actually pins the derivation:
  -- an item that leaves the list and comes back must return under its old id.
  -- That is also what makes `on conflict (id) do nothing` a real guard against
  -- two posts racing rather than decoration.
  declare
    id_before text;
    id_after  text;
  begin
    res := public.ingest_list(tok, array['Bananas']);
    select id into id_before from public.list_items
     where list_id = v_list and lower(text) = 'bananas';

    res := public.ingest_list(tok, array['Milk']);          -- Bananas checked off
    select count(*) into n from public.list_items
     where list_id = v_list and lower(text) = 'bananas';
    if n <> 0 then raise exception 'FAIL: Bananas was not removed'; end if;

    res := public.ingest_list(tok, array['Bananas']);        -- and put back
    select id into id_after from public.list_items
     where list_id = v_list and lower(text) = 'bananas';

    if id_before is null or id_before is distinct from id_after then
      raise exception 'FAIL: item id is not derived from the text (% -> %)', id_before, id_after;
    end if;
    checks := checks + 1;
    raise notice '  ok: an item that returns keeps its original id';
  end;

  -- --- last_used_at is stamped ---------------------------------------------
  select count(*) into n from public.list_ingest_tokens
   where id = 'lit_test' and last_used_at is not null;
  if n <> 1 then raise exception 'FAIL: last_used_at was not stamped'; end if;
  checks := checks + 1;
  raise notice '  ok: last_used_at is stamped';

  -- --- cleanup --------------------------------------------------------------
  delete from public.households where id in (hh, 'hh_ingest_other');

  raise notice 'ingest_list: % checks PASSED', checks;
end
$$;
