-- =====================================================================
-- 895 · Compulsory two-step and a maximum session age for the Back
--       Office, in the database (20261020130000, ADR-0164)
--
-- What the middleware does at the door, current_app_role() does for every
-- row: an office token naming a sign-in session gets no role below aal2
-- while settings.office_two_step_required is on (the default), whether or
-- not the login has an authenticator, and none once its session is older
-- than settings.office_session_max_hours (12). Staff and client logins,
-- tokens without a session (jobs, fixtures) and the service role are as
-- they were.
-- =====================================================================
begin;
select plan(34);
\ir _shared/fixtures.psql

\set sess       '89500000-0000-4000-8000-000000000001'
\set sess_staff '89500000-0000-4000-8000-000000000002'

insert into auth.sessions (id, user_id, created_at, updated_at, aal) values
  (:'sess',       :'admin_uid',  now() - interval '1 hour', now(), 'aal1'),
  (:'sess_staff', :'staffa_uid', now() - interval '30 days', now(), 'aal1');

\set admin_aal1 '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated","aal":"aal1","session_id":"89500000-0000-4000-8000-000000000001"}'
\set admin_aal2 '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated","aal":"aal2","session_id":"89500000-0000-4000-8000-000000000001"}'

-- ---------------------------------------------------------------------
-- 1 · The settings ship on
-- ---------------------------------------------------------------------
select is((select value from settings where key = 'office_two_step_required'), 'true'::jsonb,
  'two-step is required for the Back Office by default');
select is((select value from settings where key = 'office_session_max_hours'), '12'::jsonb,
  'an office sign-in lasts 12 hours by default');

-- ---------------------------------------------------------------------
-- 2 · Required: a password alone reaches no data, authenticator or not
-- ---------------------------------------------------------------------
select set_config('request.jwt.claims', :'admin_aal1', true);
select is(current_app_role(), null::app_role,
  'an office login with no authenticator, at aal1, has no role while two-step is required');
select is(office_can('finance'), false, 'and no office permission');
set local role authenticated;
select is((select count(*)::int from clients), 0, 'so RLS shows it no client rows');
select is((select count(*)::int from settings), 0, 'and not even the settings');
reset role;
select throws_ok($$ select * from admin_accounts() $$, '42501', null, 'and every admin RPC refuses it');

-- What the enrol step needs still answers.
select is(office_session_policy() ->> 'twoStepRequired', 'true',
  'office_session_policy() tells the middleware two-step is required');
select is((office_session_policy() ->> 'sessionMaxHours')::int, 12, 'and the maximum session age');
select ok((office_session_policy() ->> 'sessionStartedAt')::timestamptz between now() - interval '61 minutes' and now() - interval '59 minutes',
  'and when this session began (its auth.sessions row)');

select set_config('request.jwt.claims', :'admin_aal2', true);
select is(current_app_role()::text, 'admin', 'after the code step (aal2) the admin role is back');
select is(office_can('users'), true, 'with the owner''s permissions');

-- A token naming no session (none GoTrue issues: jobs, fixtures) is judged as before.
select set_config('request.jwt.claims',
  json_build_object('sub', :'admin_uid', 'role', 'authenticated', 'aal', 'aal1')::text, true);
select is(current_app_role()::text, 'admin', 'a token without session_id is judged as before (745, 756)');

-- Not the Staff App's rule, nor the Client Portal's.
select set_config('request.jwt.claims',
  json_build_object('sub', :'staffa_uid', 'role', 'authenticated', 'aal', 'aal1', 'session_id', :'sess_staff')::text, true);
select is(current_app_role()::text, 'staff', 'a worker at aal1 is unaffected, and so is a 30-day-old worker session');
select is(office_session_policy() ->> 'sessionStartedAt' is not null, true,
  'office_session_policy() reads the caller''s own session');
select set_config('request.jwt.claims',
  json_build_object('sub', :'staffa_uid', 'role', 'authenticated', 'session_id', :'sess')::text, true);
select is(office_session_policy() ->> 'sessionStartedAt', null,
  'and never someone else''s, even when the token names it');

-- ---------------------------------------------------------------------
-- 3 · Optional again: ADR-0057's rule as it was
-- ---------------------------------------------------------------------
update settings set value = 'false' where key = 'office_two_step_required';
select set_config('request.jwt.claims', :'admin_aal1', true);
select is(current_app_role()::text, 'admin', 'switched off, an office login without an authenticator passes at aal1');
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at)
  values (gen_random_uuid(), :'admin_uid', '895 phone', 'totp', 'verified', now(), now());
select is(current_app_role(), null::app_role, 'but a login WITH one still needs aal2, setting or not');
delete from auth.mfa_factors where user_id = :'admin_uid';
update settings set value = 'true' where key = 'office_two_step_required';

-- A missing row is the safe value, never "off".
delete from settings where key = 'office_two_step_required';
select is(current_app_role(), null::app_role, 'with the row deleted, two-step reads as required');
insert into settings (key, value) values ('office_two_step_required', 'true');

-- ---------------------------------------------------------------------
-- 4 · Session age
-- ---------------------------------------------------------------------
select set_config('request.jwt.claims', :'admin_aal2', true);
update auth.sessions set created_at = now() - interval '11 hours 59 minutes' where id = :'sess';
select is(current_app_role()::text, 'admin', 'a session signed in just under 12 hours ago still works');
update auth.sessions set created_at = now() - interval '12 hours 1 minute' where id = :'sess';
select is(current_app_role(), null::app_role,
  'a session older than 12 hours has no role, however recently its token was refreshed');
select is(office_can('finance'), false, 'and no office permission');

update settings set value = '24' where key = 'office_session_max_hours';
select is(current_app_role()::text, 'admin', 'the owner can lengthen it (24 hours)');
update auth.sessions set created_at = now() - interval '25 hours' where id = :'sess';
select is(current_app_role(), null::app_role, 'and 24 hours is the longest');

update auth.sessions set created_at = null where id = :'sess';
select is(current_app_role(), null::app_role, 'a session with no start time is treated as expired (fail closed)');
update auth.sessions set created_at = now() where id = :'sess';
update settings set value = '12' where key = 'office_session_max_hours';

-- ---------------------------------------------------------------------
-- 5 · Only sensible values can be stored
-- ---------------------------------------------------------------------
select throws_ok($$ update settings set value = '"yes"' where key = 'office_two_step_required' $$,
  '22023', 'office_two_step_required_not_boolean', 'two-step required is a JSON boolean');
select throws_ok($$ update settings set value = '0' where key = 'office_session_max_hours' $$,
  '22023', 'office_session_max_hours_out_of_range', 'the session age is at least an hour');
select throws_ok($$ update settings set value = '25' where key = 'office_session_max_hours' $$,
  '22023', 'office_session_max_hours_out_of_range', 'and at most 24');
select throws_ok($$ update settings set value = '1.5' where key = 'office_session_max_hours' $$,
  '22023', 'office_session_max_hours_out_of_range', 'in whole hours');
select throws_ok($$ update settings set value = '"12"' where key = 'office_session_max_hours' $$,
  '22023', 'office_session_max_hours_out_of_range', 'as a JSON number');

-- ---------------------------------------------------------------------
-- 6 · Who may ask
-- ---------------------------------------------------------------------
select ok(not has_function_privilege('anon', 'public.office_session_policy()', 'execute')
          and has_function_privilege('authenticated', 'public.office_session_policy()', 'execute'),
  'office_session_policy() is for a signed-in session only');
select ok(not has_function_privilege('authenticated', 'public.office_security_settings()', 'execute')
          and not has_function_privilege('anon', 'public.office_security_settings()', 'execute'),
  'the settings reader itself is internal');
select is((select l.lanname::text from pg_proc p join pg_language l on l.oid = p.prolang
            where p.oid = 'public.current_app_role()'::regprocedure), 'plpgsql',
  'current_app_role() is still plpgsql (786)');

-- With no user at all (the service role, every job) nothing changes.
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select is(current_app_role(), null::app_role, 'the service role has no app role, as before (it bypasses RLS)');

select * from finish();
rollback;
