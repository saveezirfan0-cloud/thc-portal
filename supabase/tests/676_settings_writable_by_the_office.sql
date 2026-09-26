-- =====================================================================
-- 676 · The office can write settings; edge_base_url is still guarded
--   20260930150000_settings_guard_runs_as_its_owner.sql
--
-- The edge_base_url guard ran as the caller and called a function the
-- caller may not execute, so every write to `settings` through PostgREST
-- was refused (permission denied for function is_edge_base_url). This
-- file writes AS the admin — the path /settings takes — which the rest of
-- the suite never did.
--
-- Deliberately NOT built on _shared/fixtures.psql: that file writes a
-- settings row as the owner, and PL/pgSQL initialises (and permission-
-- checks) a trigger's expressions once per transaction, so a write by the
-- owner first hides the failure from every later caller in the same test.
-- Nothing touches `settings` here before the admin does.
-- =====================================================================
begin;
select plan(7);

\set admin_uid '67600000-0000-4000-8000-000000000001'
insert into auth.users (id, email) values (:'admin_uid', 'settings-admin@rls.test');
insert into profiles (id, role, full_name) values (:'admin_uid', 'admin', 'Settings Admin');

select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;

-- 1–2 · the /settings upsert, for an existing key and a new one
select lives_ok(
  $$insert into settings (key, value, updated_at) values ('booked_elsewhere_gap_minutes', '135'::jsonb, now())
      on conflict (key) do update set value = excluded.value, updated_at = excluded.updated_at$$,
  'an admin saves the different-venue gap (the Save limits upsert)');
select lives_ok(
  $$insert into settings (key, value, updated_at) values ('e2e_676_new_key', '"x"'::jsonb, now())
      on conflict (key) do update set value = excluded.value$$,
  'an admin inserts a settings row');

-- 3 · the value landed
select is((select value #>> '{}' from settings where key = 'booked_elsewhere_gap_minutes'), '135',
  'the saved value is what the row now holds');

-- 4–5 · the guard still refuses a non-Supabase destination, and still takes a real one
select throws_ok(
  $$insert into settings (key, value) values ('edge_base_url', '"https://attacker.example/functions/v1"'::jsonb)
      on conflict (key) do update set value = excluded.value$$,
  '22023', null,
  'edge_base_url is still refused for anything but a Supabase Functions base');
select lives_ok(
  $$insert into settings (key, value) values ('edge_base_url', '"https://abcdefghijklmnopqrst.supabase.co/functions/v1"'::jsonb)
      on conflict (key) do update set value = excluded.value$$,
  'a Supabase Functions base is accepted');

reset role;

-- 6–7 · the guard is a definer, and publishes no RPC
select ok(
  (select prosecdef from pg_proc where oid = 'public.settings_edge_base_url_guard()'::regprocedure),
  'settings_edge_base_url_guard() runs as its owner');
select ok(
  not has_function_privilege('authenticated', 'public.settings_edge_base_url_guard()', 'execute'),
  'settings_edge_base_url_guard() is not executable by authenticated');

select * from finish();
rollback;
