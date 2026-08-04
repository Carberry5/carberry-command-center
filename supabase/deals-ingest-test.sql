-- Exercises public.savings_context() and public.ingest_deals() against a real
-- Postgres holding schema.sql.
--
-- Everything upstream of these functions is a scheduled Claude session reading
-- Gmail, which cannot be tested from here. So the behaviour that matters — a
-- wrong token gets nothing, a re-post of the same ad is byte-identical, staple
-- matches only stick when the staple exists, and one store's import never
-- touches another's — is pinned here.
--
--   psql "$PGURL" -v ON_ERROR_STOP=1 -f supabase/deals-ingest-test.sql
--
-- Cleans up after itself. Raises an exception on the first failure, so a
-- non-zero exit is the whole result.

\set ON_ERROR_STOP on
set client_min_messages = notice;

do $$
declare
  hh      constant text := 'hh_deals_test';
  tok     constant text := 'deals-test-token-do-not-use';
  res     json;
  n       int;
  ids     text;
  ids2    text;
  checks  int := 0;
begin
  -- --- fixture -------------------------------------------------------------
  delete from public.households where id = hh;
  insert into public.households (id, parent_pin) values (hh, '0000');
  insert into public.staples (id, household_id, name, category, sort_order)
  values ('st-milk', hh, 'Milk', 'Dairy', 0),
         ('st-chicken', hh, 'Chicken thighs', 'Meat', 1);

  insert into public.deals_ingest_tokens (id, household_id, token_hash, label)
  values ('dit_test', hh, encode(sha256(convert_to(tok, 'UTF8')), 'hex'), 'test');

  -- --- a bad token is rejected before anything is read or written ----------
  begin
    res := public.savings_context('not-the-token');
    raise exception 'FAIL: a bad token read the staples';
  exception when sqlstate '28000' then
    checks := checks + 1;
    raise notice '  ok: savings_context rejects a bad token';
  end;

  begin
    res := public.ingest_deals('not-the-token', 'costco', '[]'::jsonb);
    raise exception 'FAIL: a bad token was accepted';
  exception when sqlstate '28000' then
    checks := checks + 1;
    raise notice '  ok: ingest_deals rejects a bad token';
  end;

  -- --- context returns exactly the staples ---------------------------------
  res := public.savings_context(tok);
  if json_array_length(res->'staples') <> 2 then
    raise exception 'FAIL: expected 2 staples, got %', json_array_length(res->'staples');
  end if;
  checks := checks + 1;
  raise notice '  ok: savings_context returns the staples';

  -- --- guards --------------------------------------------------------------
  begin
    res := public.ingest_deals(tok, 'walmart', '[]'::jsonb);
    raise exception 'FAIL: an unknown store was accepted';
  exception when sqlstate '22023' then
    checks := checks + 1;
    raise notice '  ok: an unknown store is rejected';
  end;

  begin
    res := public.ingest_deals(tok, 'costco', '{"not":"an array"}'::jsonb);
    raise exception 'FAIL: a non-array payload was accepted';
  exception when sqlstate '22023' then
    checks := checks + 1;
    raise notice '  ok: a non-array payload is rejected';
  end;

  -- --- first import --------------------------------------------------------
  res := public.ingest_deals(tok, 'costco', '[
    {"item": "Kirkland Milk 2%", "price": "$2.99", "savings": "Save $1", "detail": "", "ends": "2099-01-31", "stapleId": "st-milk"},
    {"item": "Rotisserie Chicken", "price": "$4.99", "savings": "", "detail": "", "ends": "", "stapleId": "st-nope"},
    {"item": "Paper Towels", "price": "$19.99", "savings": "$5 off", "detail": "limit 2", "ends": "not-a-date", "stapleId": ""},
    {"item": "  ", "price": "$1", "savings": "", "detail": "", "ends": "", "stapleId": ""}
  ]'::jsonb);

  if (res->>'imported')::int <> 3 then
    raise exception 'FAIL: expected 3 imported (blank item dropped), got %', res->>'imported';
  end if;
  checks := checks + 1;
  raise notice '  ok: 3 deals imported, the blank one dropped';

  select count(*) into n from public.deals
   where household_id = hh and store = 'costco' and staple_id = 'st-milk';
  if n <> 1 then raise exception 'FAIL: the milk deal lost its staple match'; end if;
  checks := checks + 1;
  raise notice '  ok: a real staple match sticks';

  select count(*) into n from public.deals
   where household_id = hh and staple_id is not null and staple_id <> 'st-milk';
  if n <> 0 then raise exception 'FAIL: a made-up staple id survived'; end if;
  checks := checks + 1;
  raise notice '  ok: a made-up staple id is dropped to null';

  select count(*) into n from public.deals
   where household_id = hh and item = 'Paper Towels' and ends = '';
  if n <> 1 then raise exception 'FAIL: a malformed end date was not blanked'; end if;
  checks := checks + 1;
  raise notice '  ok: a malformed end date is blanked';

  select status into ids from public.savings_status where household_id = hh and store = 'costco';
  if ids not like '3 deals%' then raise exception 'FAIL: status line is "%"', ids; end if;
  checks := checks + 1;
  raise notice '  ok: the status line is written';

  -- --- idempotence: re-posting the same ad is byte-identical ---------------
  select string_agg(id || '|' || coalesce(staple_id, '') , ',' order by id) into ids
    from public.deals where household_id = hh and store = 'costco';
  res := public.ingest_deals(tok, 'costco', '[
    {"item": "Kirkland Milk 2%", "price": "$2.99", "savings": "Save $1", "detail": "", "ends": "2099-01-31", "stapleId": "st-milk"},
    {"item": "Rotisserie Chicken", "price": "$4.99", "savings": "", "detail": "", "ends": "", "stapleId": "st-nope"},
    {"item": "Paper Towels", "price": "$19.99", "savings": "$5 off", "detail": "limit 2", "ends": "not-a-date", "stapleId": ""}
  ]'::jsonb);
  select string_agg(id || '|' || coalesce(staple_id, '') , ',' order by id) into ids2
    from public.deals where household_id = hh and store = 'costco';
  if ids <> ids2 then raise exception 'FAIL: a re-post churned the deal ids'; end if;
  checks := checks + 1;
  raise notice '  ok: re-posting an unchanged ad produces identical rows';

  -- --- one store's import never touches another's --------------------------
  res := public.ingest_deals(tok, 'foodlion', '[
    {"item": "Chicken thighs", "price": "$1.99/lb", "savings": "", "detail": "with MVP card", "ends": "", "stapleId": "st-chicken"}
  ]'::jsonb);
  select count(*) into n from public.deals where household_id = hh and store = 'costco';
  if n <> 3 then raise exception 'FAIL: a Food Lion import disturbed Costco deals'; end if;
  checks := checks + 1;
  raise notice '  ok: importing one store leaves the others alone';

  -- --- replacement: next week''s ad replaces this week''s --------------------
  res := public.ingest_deals(tok, 'costco', '[
    {"item": "Butter 4pk", "price": "$8.99", "savings": "", "detail": "", "ends": "", "stapleId": ""}
  ]'::jsonb);
  select count(*) into n from public.deals where household_id = hh and store = 'costco';
  if n <> 1 then raise exception 'FAIL: expected the old ad replaced, found % deals', n; end if;
  checks := checks + 1;
  raise notice '  ok: a new import replaces the store''s previous deals';

  -- --- duplicates in one payload collapse ----------------------------------
  res := public.ingest_deals(tok, 'amazon', '[
    {"item": "Goldfish crackers", "price": "$7.49", "savings": "", "detail": "", "ends": "", "stapleId": ""},
    {"item": "goldfish crackers", "price": "$7.49", "savings": "", "detail": "", "ends": "", "stapleId": ""}
  ]'::jsonb);
  if (res->>'imported')::int <> 1 then
    raise exception 'FAIL: duplicate rows should collapse to 1, got %', res->>'imported';
  end if;
  checks := checks + 1;
  raise notice '  ok: duplicate deals in one payload collapse';

  -- --- the oversized payload guard -----------------------------------------
  begin
    res := public.ingest_deals(tok, 'costco', (
      select jsonb_agg(jsonb_build_object('item', 'x' || i, 'price', '$1'))
        from generate_series(1, 301) i
    ));
    raise exception 'FAIL: 301 deals were accepted';
  exception when sqlstate '22023' then
    checks := checks + 1;
    raise notice '  ok: an oversized payload is rejected';
  end;

  -- --- the widened context carries what a planner needs --------------------
  insert into public.favorites (id, household_id, name, sort_order)
  values ('fav1', hh, 'Taco night', 0);
  insert into public.meal_plan (household_id, day, meal)
  values (hh, current_date + 1, 'Pizza');
  insert into public.lists (id, household_id, name) values ('l_groc', hh, 'Groceries');
  insert into public.list_items (id, list_id, household_id, text, done)
  values ('i1', 'l_groc', hh, 'Milk', false),
         ('i2', 'l_groc', hh, 'Bought thing', true);

  res := public.savings_context(tok);
  if json_array_length(res->'deals') < 1 then raise exception 'FAIL: context has no deals'; end if;
  if json_array_length(res->'favorites') <> 1 then raise exception 'FAIL: context favourites wrong'; end if;
  if json_array_length(res->'mealPlan') <> 1 then raise exception 'FAIL: context meal plan wrong'; end if;
  if json_array_length(res->'groceries') <> 1 then
    raise exception 'FAIL: context should list only unchecked groceries';
  end if;
  checks := checks + 1;
  raise notice '  ok: context returns deals, favourites, meal plan and open groceries';

  -- --- ingest_plan: summary only -------------------------------------------
  begin
    res := public.ingest_plan('not-the-token', 'a plan');
    raise exception 'FAIL: a bad token wrote a plan';
  exception when sqlstate '28000' then
    checks := checks + 1;
    raise notice '  ok: ingest_plan rejects a bad token';
  end;

  begin
    res := public.ingest_plan(tok, '   ');
    raise exception 'FAIL: a blank summary was accepted';
  exception when sqlstate '22023' then
    checks := checks + 1;
    raise notice '  ok: a blank summary is rejected';
  end;

  res := public.ingest_plan(tok, 'Lead with Costco this week.');
  select count(*) into n from public.savings_plan where household_id = hh;
  if n <> 1 then raise exception 'FAIL: no plan row written'; end if;
  if (res->>'dinners')::int <> 0 or (res->>'groceries')::int <> 0 then
    raise exception 'FAIL: a summary-only call should change nothing else';
  end if;
  select count(*) into n from public.meal_plan where household_id = hh;
  if n <> 1 then raise exception 'FAIL: summary-only call touched the meal plan'; end if;
  checks := checks + 1;
  raise notice '  ok: summary-only writes the plan card and nothing else';

  -- --- ingest_plan: approved dinners and groceries -------------------------
  res := public.ingest_plan(tok, 'Updated plan.',
    jsonb_build_array(
      jsonb_build_object('date', to_char(current_date + 2, 'YYYY-MM-DD'), 'meal', 'Steak night'),
      jsonb_build_object('date', to_char(current_date + 1, 'YYYY-MM-DD'), 'meal', 'Tacos'),
      jsonb_build_object('date', '1999-01-01', 'meal', 'Time travel'),
      jsonb_build_object('date', to_char(current_date + 3, 'YYYY-MM-DD'), 'meal', '')
    ),
    '["Strip loin", "milk", "  "]'::jsonb);

  if (res->>'dinners')::int <> 2 then
    raise exception 'FAIL: expected 2 dinners applied (past + blank dropped), got %', res->>'dinners';
  end if;
  select meal into ids from public.meal_plan where household_id = hh and day = current_date + 1;
  if ids <> 'Tacos' then raise exception 'FAIL: an approved swap did not overwrite'; end if;
  checks := checks + 1;
  raise notice '  ok: approved dinners land, replacing the night they name';

  -- "milk" already on the list (case-insensitively), so only Strip loin adds.
  if (res->>'groceries')::int <> 1 then
    raise exception 'FAIL: expected 1 grocery added, got %', res->>'groceries';
  end if;
  select count(*) into n from public.list_items where list_id = 'l_groc';
  if n <> 3 then raise exception 'FAIL: expected 3 items on the list, got %', n; end if;
  checks := checks + 1;
  raise notice '  ok: approved groceries append, deduplicated against the list';

  -- Re-applying the same approval changes nothing.
  res := public.ingest_plan(tok, 'Updated plan.',
    jsonb_build_array(jsonb_build_object('date', to_char(current_date + 2, 'YYYY-MM-DD'), 'meal', 'Steak night')),
    '["Strip loin"]'::jsonb);
  if (res->>'groceries')::int <> 0 then raise exception 'FAIL: a re-post re-added groceries'; end if;
  select count(*) into n from public.list_items where list_id = 'l_groc';
  if n <> 3 then raise exception 'FAIL: a re-post grew the list'; end if;
  checks := checks + 1;
  raise notice '  ok: re-applying an approval is a no-op';

  -- --- cleanup -------------------------------------------------------------
  delete from public.households where id = hh;
  raise notice 'ALL % DEALS INGEST CHECKS PASSED', checks;
end
$$;
