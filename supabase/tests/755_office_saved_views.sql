-- =====================================================================
-- 755 · Saved views on Scheduling follow the manager (20261001202000,
--       ADR-0059)
--
-- office_saved_views: own rows only, Back Office logins only; another
-- admin's views are invisible and untouchable; a worker, a client and
-- anon get nothing; one name per owner case-insensitively; at most 30
-- per owner (also inside one multi-row INSERT); and `query` holds only
-- the four known filter keys, as bounded strings, so it cannot carry
-- anything else into a URL.
-- =====================================================================
begin;
select plan(48);
\ir _shared/fixtures.psql

\set admin2    '75500000-0000-4000-8000-000000000001'
\set scheduler '75500000-0000-4000-8000-000000000002'
\set other_v   '75510000-0000-4000-8000-000000000001'

insert into auth.users (id, email) values
  (:'admin2',    'second.admin@rls.test'),
  (:'scheduler', 'saved.scheduler@rls.test');
insert into profiles (id, role, office_role, full_name) values
  (:'admin2',    'admin', 'manager',   'Maya Second'),
  (:'scheduler', 'admin', 'scheduler', 'Sid Scheduler');

-- Another admin's view, written as the table owner.
insert into office_saved_views (id, owner, name, query)
values (:'other_v', :'admin2', 'Their weddings', '{"view":"month","q":"wedding","clientId":"","status":""}');

-- ---------------------------------------------------------------------
-- 1 · Shape
-- ---------------------------------------------------------------------
select has_table('public', 'office_saved_views', 'office_saved_views exists');
select is((select relrowsecurity from pg_class where oid = 'public.office_saved_views'::regclass), true,
  'row level security is on');
select bag_eq(
  $$ select polname::text || ':' || polcmd::text from pg_policy
      where polrelid = 'public.office_saved_views'::regclass $$,
  $$ values ('admin_own_select:r'::text), ('admin_own_insert:a'), ('admin_own_update:w'),
            ('admin_own_delete:d') $$,
  'exactly four own-row policies, one per command');
select is_empty(
  $$ select polname::text from pg_policy
      where polrelid = 'public.office_saved_views'::regclass
        and (coalesce(pg_get_expr(polqual, polrelid), '') || coalesce(pg_get_expr(polwithcheck, polrelid), ''))
            !~ '\(\s*SELECT\s+current_app_role\(\).*\(\s*SELECT\s+auth\.uid\(\)' $$,
  'every policy asks the office role AND the owner, both wrapped in (select …)');
select ok(not has_table_privilege('anon', 'public.office_saved_views', 'select'),
  'anon holds no grant on the table');
select ok(not has_function_privilege('authenticated', 'public.office_saved_views_guard()', 'execute'),
  'the guard trigger is not callable as an RPC');

-- ---------------------------------------------------------------------
-- 2 · The admin, on their own rows
-- ---------------------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;

select lives_ok(
  $$ insert into office_saved_views (name, query)
     values ('Weddings', '{"view":"week","q":"wedding","clientId":"aaaaaaaa-0000-4000-8000-000000000001","status":"upcoming"}') $$,
  'an admin saves a view without naming the owner');
select is((select owner from office_saved_views where name = 'Weddings'), :'admin_uid'::uuid,
  'owner defaults to the caller');
select is((select scope from office_saved_views where name = 'Weddings'), 'events',
  'scope defaults to events');
select is((select count(*)::int from office_saved_views), 1,
  'the admin reads exactly their own view');
select is((select count(*)::int from office_saved_views where id = :'other_v'), 0,
  'another admin''s view is invisible');

with u as (update office_saved_views set name = 'Hijacked' where id = :'other_v' returning 1)
  select is((select count(*)::int from u), 0, 'another admin''s view cannot be renamed');
with d as (delete from office_saved_views where id = :'other_v' returning 1)
  select is((select count(*)::int from d), 0, 'another admin''s view cannot be deleted');

select throws_ok(
  format($$ insert into office_saved_views (owner, name, query) values (%L, 'Planted', '{"view":"list"}') $$, :'admin2'),
  '42501', null, 'an admin cannot save a view into another admin''s list');

select lives_ok(
  $$ update office_saved_views set query = '{"view":"day","q":"","clientId":"","status":"cancelled"}' where name = 'Weddings' $$,
  'the admin updates their own view');
select is((select query ->> 'status' from office_saved_views where name = 'Weddings'), 'cancelled',
  'and the update holds');
select throws_ok(
  format($$ update office_saved_views set owner = %L where name = 'Weddings' $$, :'admin2'),
  '22023', 'saved_view_fixed', 'a view cannot be handed to another owner');
select throws_ok(
  $$ insert into office_saved_views (name, query) values ('WEDDINGS', '{"view":"list"}') $$,
  '23505', null, 'one name per owner, case-insensitively');

-- ---------------------------------------------------------------------
-- 3 · Validation: only the known filter keys, strings, bounded
-- ---------------------------------------------------------------------
select throws_ok($$ insert into office_saved_views (name, query) values ('V1', '{"view":"list","redirect":"https://evil.example"}') $$,
  '23514', null, 'an unknown key is refused');
select throws_ok($$ insert into office_saved_views (name, query) values ('V2', '{"view":"list","q":{"$ne":1}}') $$,
  '23514', null, 'a non-string value is refused');
select throws_ok($$ insert into office_saved_views (name, query) values ('V3', '{"view":"list","status":null}') $$,
  '23514', null, 'a null value is refused');
select throws_ok(format($$ insert into office_saved_views (name, query) values ('V4', %L) $$,
                        jsonb_build_object('view', 'list', 'q', repeat('x', 101))),
  '23514', null, 'a search over 100 characters is refused');
select throws_ok($$ insert into office_saved_views (name, query) values ('V5', jsonb_build_object('view', 'list', 'q', E'a\nb')) $$,
  '23514', null, 'a control character is refused');
select throws_ok($$ insert into office_saved_views (name, query) values ('V6', '{"view":"year"}') $$,
  '23514', null, 'an unknown view is refused');
select throws_ok($$ insert into office_saved_views (name, query) values ('V7', '{"view":"list","status":"draft"}') $$,
  '23514', null, 'an unknown status is refused');
select throws_ok($$ insert into office_saved_views (name, query) values ('V8', '{"view":"list","clientId":"javascript:alert(1)"}') $$,
  '23514', null, 'a client id that is not a UUID is refused');
select throws_ok($$ insert into office_saved_views (name, query) values ('V9', '{"q":"gala"}') $$,
  '23514', null, 'a view with no view is refused');
select throws_ok($$ insert into office_saved_views (name, query) values ('V10', '["list"]') $$,
  '23514', null, 'an array is refused');
select throws_ok($$ insert into office_saved_views (name, query) values ('   ', '{"view":"list"}') $$,
  '23514', null, 'a blank name is refused');
select throws_ok(format($$ insert into office_saved_views (name, query) values (%L, '{"view":"list"}') $$, repeat('n', 61)),
  '23514', null, 'a name over 60 characters is refused');
select throws_ok($$ insert into office_saved_views (name, query) values (' Padded', '{"view":"list"}') $$,
  '23514', null, 'an untrimmed name is refused');
select throws_ok($$ insert into office_saved_views (scope, name, query) values ('payroll', 'Other screen', '{"view":"list"}') $$,
  '23514', null, 'an unknown scope is refused');
select lives_ok(
  format($$ insert into office_saved_views (name, query) values (%L, %L) $$, repeat('n', 60),
         jsonb_build_object('view', 'month', 'q', repeat('q', 100), 'clientId', '', 'status', '')),
  'a 60-character name and a 100-character search are accepted');

-- ---------------------------------------------------------------------
-- 4 · The cap: 30 per owner
-- ---------------------------------------------------------------------
select lives_ok(
  $$ insert into office_saved_views (name, query)
     select 'Cap ' || g, '{"view":"list"}'::jsonb from generate_series(1, 28) g $$,
  'the admin fills their list to 30');
select is((select count(*)::int from office_saved_views), 30, 'thirty views');
select throws_ok(
  $$ insert into office_saved_views (name, query) values ('Thirty-first', '{"view":"list"}') $$,
  '23514', 'saved_views_cap', 'the thirty-first is refused');
select lives_ok(
  $$ update office_saved_views set query = '{"view":"week"}' where name = 'Cap 1' $$,
  'updating a view at the cap is fine');
select lives_ok($$ delete from office_saved_views where name = 'Cap 1' $$, 'the admin deletes one');
select lives_ok(
  $$ insert into office_saved_views (name, query) values ('Thirty-first', '{"view":"list"}') $$,
  'and then has room again');

-- ---------------------------------------------------------------------
-- 5 · Every office role saves its own; nobody else gets in
-- ---------------------------------------------------------------------
reset role;
select set_config('request.jwt.claims', json_build_object('sub', :'scheduler', 'role', 'authenticated')::text, true);
set local role authenticated;
select lives_ok(
  $$ insert into office_saved_views (name, query) values ('My rota', '{"view":"day"}') $$,
  'a scheduler saves their own view: a per-user preference, not operational data');
select is((select count(*)::int from office_saved_views), 1, 'and sees only that one');

reset role;
select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select count(*)::int from office_saved_views), 0, 'a worker reads nothing');
select throws_ok($$ insert into office_saved_views (name, query) values ('Mine', '{"view":"list"}') $$,
  '42501', null, 'a worker cannot save a view');

reset role;
select set_config('request.jwt.claims', json_build_object('sub', :'clienta_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select count(*)::int from office_saved_views), 0, 'a client reads nothing');
select throws_ok($$ insert into office_saved_views (name, query) values ('Mine', '{"view":"list"}') $$,
  '42501', null, 'a client cannot save a view');

reset role;
select set_config('request.jwt.claims', '', true);
set local role anon;
select throws_ok($$ select count(*) from office_saved_views $$, '42501', null,
  'anon cannot even select');

-- ---------------------------------------------------------------------
-- 6 · The cap holds inside one multi-row INSERT too (the "move my saved
--     views" path writes them in one statement)
-- ---------------------------------------------------------------------
reset role;
select throws_ok(
  format($$ insert into office_saved_views (owner, name, query)
            select %L, 'Bulk ' || g, '{"view":"list"}'::jsonb from generate_series(1, 30) g $$, :'admin2'),
  '23514', 'saved_views_cap', 'thirty more on top of one is refused, as one statement');
select is((select count(*)::int from office_saved_views where owner = :'admin2'), 1,
  'and nothing of that statement was kept');

select * from finish();
rollback;
