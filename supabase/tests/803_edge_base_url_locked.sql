-- =====================================================================
-- 803 · settings.edge_base_url is the deploy's, not a session's
--       20261012120050 · docs/01 §4, Invariant 8
--
-- The service-role bearer is POSTed to edge_base_url by every pg_cron
-- job. An owner session could point it at their own Supabase project
-- (the shape guard of 20260927160300 accepts any <ref>.supabase.co).
-- Now no API session writes the row at all; the vault secret
-- supabase_project_ref, when set, pins it to the project's own ref.
-- =====================================================================
begin;
select plan(16);
\ir _shared/fixtures.psql

\set good '"https://abcdefghijklmnopqrst.supabase.co/functions/v1"'
\set other '"https://zzzzzzzzzzzzzzzzzzzz.supabase.co/functions/v1"'

-- The deploy step (no API role) sets it; that is the path docs/16 §4.7 uses.
select lives_ok(format($$ insert into settings (key, value) values ('edge_base_url', %L::jsonb)
                           on conflict (key) do update set value = excluded.value $$, :'good'),
  'the deploy (a direct connection, no API role) sets edge_base_url');

-- =====================================================================
-- 1 · An owner session cannot insert, update or delete it
-- =====================================================================
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select ok(office_can('settings'), 'the fixture admin is a Back Office owner (may write settings)');

select throws_ok(format($$ update settings set value = %L::jsonb where key = 'edge_base_url' $$, :'other'),
  '42501', 'edge_base_url_locked', 'an owner cannot repoint edge_base_url at another Supabase project');
select throws_ok($$ delete from settings where key = 'edge_base_url' $$,
  '42501', 'edge_base_url_locked', 'nor delete it');
select throws_ok(format($$ insert into settings (key, value) values ('edge_base_url', %L::jsonb)
                           on conflict (key) do update set value = excluded.value $$, :'other'),
  '42501', 'edge_base_url_locked', 'nor upsert it the way /settings saves');
select throws_ok(format($$ update settings set key = 'edge_base_url', value = %L::jsonb where key = 'rls_fixture_probe' $$, :'other'),
  '42501', 'edge_base_url_locked', 'nor rename another row into it');
select throws_ok($$ update settings set key = 'edge_base_url_old' where key = 'edge_base_url' $$,
  '42501', 'edge_base_url_locked', 'nor rename it away (and then insert their own)');

-- Every other key is still the owner's, exactly as before (677).
select lives_ok($$ update settings set value = '135'::jsonb where key = 'booked_elsewhere_gap_minutes' $$,
  'an owner still saves an ordinary setting');
select lives_ok($$ insert into settings (key, value) values ('e2e_786_probe', '"x"'::jsonb) $$,
  'and inserts a new one');
reset role;

select is((select value from settings where key = 'edge_base_url'), :'good'::jsonb,
  'edge_base_url is what the deploy set');

-- =====================================================================
-- 2 · The service role (an Edge Function, the owner's script) still can
-- =====================================================================
select set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
set local role service_role;
select lives_ok(format($$ update settings set value = %L::jsonb where key = 'edge_base_url' $$, :'good'),
  'the service role may still write it');
reset role;
select set_config('request.jwt.claims', '', true);

-- =====================================================================
-- 3 · The vault pin
-- =====================================================================
-- Through vault.create_secret, not an insert (601: on Supabase the encrypt
-- trigger is not callable by the test role).
do $$ begin
  perform vault.create_secret('abcdefghijklmnopqrst', 'supabase_project_ref');
exception when undefined_function then
  insert into vault.secrets (name, secret) values ('supabase_project_ref', 'abcdefghijklmnopqrst');
end $$;

select is(edge_base_url(), :'good'::jsonb #>> '{}', 'the project''s own ref passes the pin');
select throws_ok(format($$ update settings set value = %L::jsonb where key = 'edge_base_url' $$, :'other'),
  '22023', null, 'with the pin set, even the deploy cannot name another project');

-- A value that reached the row some other way posts nothing.
alter table settings disable trigger settings_edge_base_url_guard;
update settings set value = :'other'::jsonb where key = 'edge_base_url';
alter table settings enable trigger settings_edge_base_url_guard;
select throws_ok($$ select edge_base_url() $$, '22023', null,
  'and the run-time reader refuses a row that names another project');

-- =====================================================================
-- 4 · The lock publishes nothing
-- =====================================================================
select ok(not (select prosecdef from pg_proc where oid = 'public.settings_edge_base_url_lock()'::regprocedure),
  'the lock is an invoker trigger function, so current_user is the caller');
select ok(not has_function_privilege('authenticated', 'public.edge_base_url_pinned(text)', 'execute')
      and not has_function_privilege('anon', 'public.edge_base_url_pinned(text)', 'execute'),
  'the pin check is not an RPC');

select * from finish();
rollback;
