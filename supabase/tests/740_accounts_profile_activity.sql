-- =====================================================================
-- 740 · Accounts, own profile and the activity log (20261001200000)
--
-- /account: a manager or client edits their own name, phone and job
--   title; a worker cannot (their name is the staff record); the edit is
--   audited with field NAMES only.
-- /users: only an admin lists logins, registers a new admin or client
--   login, or switches one off — never a staff login, never their own,
--   never the last working admin — and an existing login of another kind
--   cannot be turned into an admin by typing its email into the invite.
-- /activity: admin-only, names the actor and labels the row.
-- /settings: a change to a value is now an audit row.
-- =====================================================================
begin;
select plan(41);
\ir _shared/fixtures.psql

\set newadmin  '65000000-0000-4000-8000-000000000001'
\set newclient '65000000-0000-4000-8000-000000000002'
\set admin2    '65000000-0000-4000-8000-000000000003'
insert into auth.users (id, email) values
  (:'newadmin',  'new.admin@rls.test'),
  (:'newclient', 'new.client@rls.test'),
  (:'admin2',    'second.admin@rls.test');

-- ---------------------------------------------------------------------
-- 1 · Grants: no anon, no PUBLIC; the trigger functions callable by nobody
-- ---------------------------------------------------------------------
select ok(
  not has_function_privilege('anon', 'update_my_profile(text,text,text)', 'execute')
  and not has_function_privilege('anon', 'admin_accounts(app_role)', 'execute')
  and not has_function_privilege('anon', 'admin_register_account(uuid,app_role,text,uuid,text)', 'execute')
  and not has_function_privilege('anon', 'admin_set_login_disabled(uuid,boolean,text)', 'execute')
  and not has_function_privilege('anon', 'admin_activity(int,bigint,text,uuid,text,timestamptz)', 'execute')
  and not has_function_privilege('anon', 'admin_activity_facets()', 'execute')
  and not has_function_privilege('anon', 'admin_login_lookup(text)', 'execute'),
  'anon can execute none of the seven account/activity functions');
select ok(
  not has_function_privilege('authenticated', 'audit_settings_change()', 'execute')
  and not has_function_privilege('authenticated', 'audit_venue_radius_change()', 'execute'),
  'the two audit trigger functions are not callable by a signed-in user');

-- ---------------------------------------------------------------------
-- 2 · update_my_profile
-- ---------------------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;

select is((update_my_profile('Gisela Martins', '+44 7700 900123', 'Operations manager'))->'changed',
  '["full_name", "phone", "job_title"]'::jsonb,
  'the admin edits their own name, phone and job title');
select is((select full_name || ' · ' || phone || ' · ' || job_title from profiles where id = :'admin_uid'),
  'Gisela Martins · +44 7700 900123 · Operations manager',
  'and the row says so');
select is((update_my_profile('Gisela Martins', '+44 7700 900123', 'Operations manager'))->'changed',
  '[]'::jsonb, 'saving the same values changes nothing');
select throws_ok($$ select update_my_profile(' ', null, null) $$, 'P0001', 'name_required',
  'a blank name is refused');
select throws_ok($$ select update_my_profile('Gisela', 'call me', null) $$, 'P0001', 'phone_invalid',
  'a phone that is not a number is refused');
update profiles set full_name = 'Direct' where id = auth.uid();
select is((select full_name from profiles where id = auth.uid()), 'Gisela Martins',
  'a direct UPDATE on profiles changes nothing: the function is the only way in (no policy)');
reset role;
select is((select count(*)::int from audit_log where action = 'profile.updated' and entity_id = :'admin_uid'), 1,
  'one profile.updated row — the no-op save wrote none');
select is((select data from audit_log where action = 'profile.updated' and entity_id = :'admin_uid'),
  '{"fields": ["full_name", "phone", "job_title"]}'::jsonb,
  'the audit row names the fields, not the phone number');

select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok($$ select update_my_profile('Someone Else', null, null) $$, 'P0001', 'use_staff_profile',
  'a worker cannot rename themselves here — their name is the staff record');

-- ---------------------------------------------------------------------
-- 3 · Only an admin reaches the account functions
-- ---------------------------------------------------------------------
select throws_ok($$ select * from admin_accounts() $$, '42501', 'not_authorised', 'a worker cannot list logins');
select throws_ok(format('select admin_register_account(%L, %L, %L)', :'newadmin', 'admin', 'Mallory'),
  '42501', 'not_authorised', 'a worker cannot make themselves an admin login');
select throws_ok(format('select admin_set_login_disabled(%L, true, %L)', :'admin_uid', 'x'),
  '42501', 'not_authorised', 'a worker cannot switch a login off');
select throws_ok($$ select * from admin_activity() $$, '42501', 'not_authorised', 'a worker cannot read the activity log');

select set_config('request.jwt.claims', json_build_object('sub', :'clienta_uid', 'role', 'authenticated')::text, true);
select throws_ok($$ select * from admin_accounts() $$, '42501', 'not_authorised', 'a client cannot list logins');
select throws_ok($$ select admin_activity_facets() $$, '42501', 'not_authorised', 'a client cannot read the activity filters');
select throws_ok($$ select admin_login_lookup('gisela@rls.test') $$, '42501', 'not_authorised', 'a client cannot look up logins');

-- ---------------------------------------------------------------------
-- 4 · admin_register_account
-- ---------------------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);

select is((admin_register_account(:'newadmin', 'admin', 'Nadia Admin', null, 'Scheduler'))->>'created', 'true',
  'an admin registers a new Back Office login');
select is((admin_register_account(:'newclient', 'client', 'Carl Client', :'clienta'))->>'role', 'client',
  'and a Client Portal login for one client');
select throws_ok(format('select admin_register_account(%L, %L, %L)', :'newclient', 'admin', 'Carl'),
  'P0001', 'account_has_other_role', 'a client login cannot be re-registered as an admin');
select throws_ok(format('select admin_register_account(%L, %L, %L)', :'staffa_uid', 'admin', 'Staff Alpha'),
  'P0001', 'account_has_other_role', 'a worker''s login cannot be turned into an admin by its email');
select throws_ok(format('select admin_register_account(%L, %L, %L)', :'admin2', 'staff', 'Someone'),
  'P0001', 'role_not_allowed', 'a staff login is never made here (Accept makes it, §2.7)');
select throws_ok(format('select admin_register_account(%L, %L, %L)', :'admin2', 'client', 'Someone'),
  'P0001', 'client_required', 'a client login needs its client');
select throws_ok(format('select admin_register_account(%L, %L, %L, %L)', :'newclient', 'client', 'Carl Client', :'clientb'),
  'P0001', 'account_has_other_client', 'a client login is never moved to another client');
select is(admin_login_lookup('STAFFA@rls.test') ->> 'isStaff', 'true',
  'the lookup finds a worker''s login before anything is minted, whatever the case of the address');
select is(admin_login_lookup('new.client@rls.test') ->> 'signedIn', 'false',
  'and says whether a login has ever been used');
select is(admin_login_lookup('nobody@rls.test') ->> 'exists', 'false', 'an unknown address has no login');

reset role;
select is((select raw_app_meta_data ->> 'role' from auth.users where id = :'newadmin'), 'admin',
  'app_metadata.role is written by the database, under its admin check');
select is((select role::text || ' · ' || client_id::text from profiles where id = :'newclient'),
  'client · ' || :'clienta', 'the client login is tied to its client');
select is((select count(*)::int from audit_log where action = 'account.invited' and actor = :'admin_uid'), 2,
  'both invitations are audited with the manager as actor');

-- ---------------------------------------------------------------------
-- 5 · admin_set_login_disabled
-- ---------------------------------------------------------------------
set local role authenticated;
select throws_ok(format('select admin_set_login_disabled(%L, true, %L)', :'admin_uid', 'testing'),
  'P0001', 'cannot_disable_self', 'a manager cannot switch their own login off');
select throws_ok(format('select admin_set_login_disabled(%L, true, %L)', :'staffa_uid', 'testing'),
  'P0001', 'use_staff_block', 'a worker is blocked on their staff profile, not here');
select throws_ok(format('select admin_set_login_disabled(%L, true, null)', :'newclient'),
  'P0001', 'reason_required', 'switching a login off needs a reason');
select is((admin_set_login_disabled(:'newclient', true, 'Left the client'))->>'disabled', 'true',
  'a client login is switched off');
select is((select disabled from admin_accounts('client') where id = :'newclient'), true,
  'and /users shows it switched off');
select is((admin_set_login_disabled(:'newclient', false))->>'disabled', 'false', 'and back on');

-- With the caller always a working admin and unable to switch themselves
-- off, the last-admin guard is a second fence; switching another admin off
-- while the caller remains must go through.
select lives_ok(format('select admin_set_login_disabled(%L, true, %L)', :'newadmin', 'Left THC'),
  'another admin can be switched off while one remains');

-- ---------------------------------------------------------------------
-- 6 · Activity log and settings history
-- ---------------------------------------------------------------------
update settings set value = '150' where key = 'booked_elsewhere_gap_minutes';
reset role;
select is((select data ->> 'key' from audit_log where action = 'settings.update' and actor = :'admin_uid' order by id desc limit 1),
  'booked_elsewhere_gap_minutes', 'a /settings save is an audit row naming the key and the manager');

set local role authenticated;
select is((select actor_name || ' · ' || entity_label from admin_activity(10, null, 'account') where action = 'account.disabled' limit 1),
  'Gisela Martins · Nadia Admin', 'the activity log names who did it and to whom');
select ok((admin_activity_facets() -> 'entities') @> '[{"entity": "settings"}]'::jsonb,
  'the filter options include every entity in the log');

select * from finish();
rollback;
