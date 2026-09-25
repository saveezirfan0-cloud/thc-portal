-- =====================================================================
-- 651 · Office roles (20260930110000, ADR-0036)
--
-- owner / manager / scheduler / client / staff for each of the three
-- gates — users, settings, finance — plus:
--   * the last-owner guard (admin_set_office_role and
--     admin_set_login_disabled);
--   * every check the four re-created account functions had in
--     20260930100000 still refuses (docs/10 §3b: a straight replace that
--     drops a rule is the known failure);
--   * the report RPCs still refuse a worker with their old error;
--   * what a scheduler keeps: role names, role sections at catalogue
--     rates, the dashboard's rows, the check-in "already in payroll" flag.
-- =====================================================================
begin;
select plan(136);
\ir _shared/fixtures.psql

\set owner2    '65100000-0000-4000-8000-000000000001'
\set manager   '65100000-0000-4000-8000-000000000002'
\set scheduler '65100000-0000-4000-8000-000000000003'
\set invitee1  '65100000-0000-4000-8000-000000000004'
\set invitee2  '65100000-0000-4000-8000-000000000005'
\set invitee3  '65100000-0000-4000-8000-000000000006'
\set past_ev   '65100000-0000-4000-8000-000000000007'
\set past_sh   '65100000-0000-4000-8000-000000000008'
\set new_sh    '65100000-0000-4000-8000-000000000009'

insert into auth.users (id, email) values
  (:'owner2',    'owner.two@rls.test'),
  (:'manager',   'manager@rls.test'),
  (:'scheduler', 'scheduler@rls.test'),
  (:'invitee1',  'invitee.one@rls.test'),
  (:'invitee2',  'invitee.two@rls.test'),
  (:'invitee3',  'invitee.three@rls.test');
insert into profiles (id, role, office_role, full_name) values
  (:'owner2',    'admin', 'owner',     'Olive Owner'),
  (:'manager',   'admin', 'manager',   'Mona Manager'),
  (:'scheduler', 'admin', 'scheduler', 'Sam Scheduler');

-- A delivered event, so clients_margins_v has a row to show or withhold.
insert into events (id, client_id, venue_id, venue_name, venue_address, venue_location, geofence_radius_m,
                    title, event_date, pays_breaks, pays_buffer, po_number)
values (:'past_ev', :'clienta', :'venue_id', 'RLS Fixture Venue', '1 Test Street, London',
        st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150, 'Delivered Event', current_date - 3, true, true, '651-P');
insert into shift_requirements (id, event_id, role_id, starts_at, ends_at, headcount, buffer, charge_rate, pay_rate)
values (:'past_sh', :'past_ev', :'role_id', now() - interval '3 days', now() - interval '3 days' + interval '6 hours', 2, 0, 22.97, 14.00);

-- One exported payroll line, for the payroll_export_lines read and the
-- booking_payroll_exported() flag.
insert into payroll_export_lines (report_send_id, booking_id, staff_id, event_id, state, shift_date, payable_min, rate, base, holiday)
select id, :'booking_a', :'staffa', :'event_a', 'exported', current_date, 480, 14.00, 112.00, 13.52
  from report_sends where error = 'rls_fixture_probe';

-- ---------------------------------------------------------------------
-- 1 · Shape
-- ---------------------------------------------------------------------
select enum_has_labels('public', 'office_role', array['owner', 'manager', 'scheduler'],
  'office_role is owner / manager / scheduler');
select is((select office_role::text from profiles where id = :'admin_uid'), 'owner',
  'an admin row made outside the invite (the fixture, the dashboard, the seed) is an owner — what every admin was before');
select is((select count(*)::int from profiles where role <> 'admin' and office_role is not null), 0,
  'no client or staff row carries an office role');
select throws_ok(format($$ update profiles set office_role = 'manager' where id = %L $$, :'clienta_uid'),
  '23514', null, 'the check constraint refuses an office role on a client login');
select throws_ok(format($$ update profiles set office_role = null where id = %L $$, :'manager'),
  '23514', null, 'and refuses an admin login without one (no silent repair to owner)');

select ok(not has_function_privilege('anon', 'office_can(text)', 'execute')
      and has_function_privilege('authenticated', 'office_can(text)', 'execute'),
  'office_can is callable by a signed-in session (policies run as the caller) and not by anon');
select ok(not has_function_privilege('anon', 'admin_set_office_role(uuid,office_role)', 'execute')
      and not has_function_privilege('public', 'admin_set_office_role(uuid,office_role)', 'execute')
      and not has_function_privilege('anon', 'admin_register_account(uuid,app_role,text,uuid,text,office_role)', 'execute')
      and not has_function_privilege('anon', 'admin_register_account(uuid,app_role,text,uuid,text)', 'execute'),
  'anon can execute neither admin_set_office_role nor either admin_register_account');
select ok(not has_function_privilege('authenticated', 'profiles_office_role_default()', 'execute')
      and not has_function_privilege('authenticated', 'office_finance_write_guard()', 'execute')
      and not has_function_privilege('authenticated', 'shift_rates_office_guard()', 'execute'),
  'the three trigger functions are not RPCs');
select ok((select prosecdef from pg_proc where oid = 'office_can(text)'::regprocedure)
      and (select proconfig is not null from pg_proc where oid = 'office_can(text)'::regprocedure)
      and (select provolatile = 's' from pg_proc where oid = 'office_can(text)'::regprocedure),
  'office_can is security definer, stable, with a pinned search_path');

-- ---------------------------------------------------------------------
-- 2 · office_can, per role
-- ---------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
select is(array[office_can('users'), office_can('settings'), office_can('finance')], array[true, true, true],
  'owner: users, settings, finance');
select is(office_can('reports'), false, 'an unknown permission name is false even for an owner (fails closed)');
select set_config('request.jwt.claims', json_build_object('sub', :'manager', 'role', 'authenticated')::text, true);
select is(array[office_can('users'), office_can('settings'), office_can('finance')], array[false, false, true],
  'manager: finance only');
select set_config('request.jwt.claims', json_build_object('sub', :'scheduler', 'role', 'authenticated')::text, true);
select is(array[office_can('users'), office_can('settings'), office_can('finance')], array[false, false, false],
  'scheduler: none of the three');
select set_config('request.jwt.claims', json_build_object('sub', :'clienta_uid', 'role', 'authenticated')::text, true);
select is(array[office_can('users'), office_can('settings'), office_can('finance')], array[false, false, false],
  'client: none');
select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
select is(array[office_can('users'), office_can('settings'), office_can('finance')], array[false, false, false],
  'staff: none');

-- ---------------------------------------------------------------------
-- 3 · users — only an owner reaches /users
-- ---------------------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', :'manager', 'role', 'authenticated')::text, true);
select throws_ok($$ select * from admin_accounts() $$, '42501', 'not_permitted', 'a manager cannot list logins');
select throws_ok($$ select admin_login_lookup('x@rls.test') $$, '42501', 'not_permitted', 'nor look up an address');
select throws_ok(format('select admin_register_account(%L, %L, %L)', :'invitee1', 'admin', 'Ivy Invitee'),
  '42501', 'not_permitted', 'nor invite a login');
select throws_ok(format('select admin_set_login_disabled(%L, true, %L)', :'scheduler', 'x'),
  '42501', 'not_permitted', 'nor switch one off');
select throws_ok(format('select admin_set_office_role(%L, %L)', :'scheduler', 'owner'),
  '42501', 'not_permitted', 'nor change anyone''s office role — least of all to make someone owner');

select set_config('request.jwt.claims', json_build_object('sub', :'scheduler', 'role', 'authenticated')::text, true);
select throws_ok($$ select * from admin_accounts() $$, '42501', 'not_permitted', 'a scheduler cannot list logins');
select throws_ok(format('select admin_register_account(%L, %L, %L, null, null, %L)', :'invitee1', 'admin', 'Ivy', 'owner'),
  '42501', 'not_permitted', 'nor invite an owner');
select throws_ok(format('select admin_set_office_role(%L, %L)', :'scheduler', 'manager'),
  '42501', 'not_permitted', 'nor promote themselves');

select set_config('request.jwt.claims', json_build_object('sub', :'clienta_uid', 'role', 'authenticated')::text, true);
select throws_ok(format('select admin_set_office_role(%L, %L)', :'manager', 'owner'),
  '42501', 'not_authorised', 'a client meets the old admin check first');
select throws_ok($$ select * from admin_accounts() $$, '42501', 'not_authorised', 'and cannot list logins');
select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
select throws_ok(format('select admin_set_office_role(%L, %L)', :'manager', 'owner'),
  '42501', 'not_authorised', 'nor can a worker');
select throws_ok(format('select admin_register_account(%L, %L, %L)', :'invitee1', 'admin', 'Mallory'),
  '42501', 'not_authorised', 'a worker still cannot make themselves an admin login');

select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
select is((select office_role::text from admin_accounts('admin') where id = :'manager'), 'manager',
  'an owner lists logins, with each Back Office login''s office role');
select is((select count(*)::int from admin_accounts('client') where office_role is not null), 0,
  'and no office role on a Client Portal login');

-- ---------------------------------------------------------------------
-- 4 · admin_register_account — the office role, and every old check
-- ---------------------------------------------------------------------
select is((admin_register_account(:'invitee1', 'admin', 'Ivy Invitee'))->>'officeRole', 'manager',
  'a new Back Office login invited without a role is a manager (the five-argument form)');
select is((admin_register_account(:'invitee2', 'admin', 'Ian Invitee', null, 'Rota', 'scheduler'))->>'officeRole', 'scheduler',
  'an owner can choose the office role (the six-argument form)');
select is((admin_register_account(:'invitee2', 'admin', 'Ian Invitee', null, 'Rota'))->>'officeRole', 'scheduler',
  'a re-invite (New invite link) leaves the office role alone — it never resets a login to manager');
select is((admin_register_account(:'invitee3', 'client', 'Cara Client', :'clienta'))->>'officeRole', null,
  'a Client Portal login gets no office role');
select throws_ok(format('select admin_register_account(%L, %L, %L, null, null, null)', :'invitee1', 'admin', 'Ivy'),
  'P0001', 'office_role_required', 'the six-argument form needs a role for a Back Office login');
select throws_ok(format('select admin_register_account(%L, %L, %L, %L, null, %L)', :'invitee3', 'client', 'Cara', :'clienta', 'manager'),
  'P0001', 'office_role_not_allowed', 'and refuses one for a client login');
-- 20260930100000's refusals, all still there.
select throws_ok(format('select admin_register_account(%L, %L, %L)', :'invitee1', 'staff', 'Someone'),
  'P0001', 'role_not_allowed', 'preserved: a staff login is never made here');
select throws_ok(format('select admin_register_account(%L, %L, %L)', :'invitee1', 'admin', ' '),
  'P0001', 'name_required', 'preserved: a blank name is refused');
select throws_ok(format('select admin_register_account(%L, %L, %L)', :'owner2', 'client', 'Someone'),
  'P0001', 'client_required', 'preserved: a client login needs its client');
select throws_ok(format('select admin_register_account(%L, %L, %L, %L)', :'invitee1', 'client', 'Someone', gen_random_uuid()),
  'P0001', 'unknown_client', 'preserved: an unknown client is refused');
select throws_ok(format('select admin_register_account(%L, %L, %L, %L)', :'invitee1', 'admin', 'Someone', :'clienta'),
  'P0001', 'client_not_allowed', 'preserved: a Back Office login is not tied to a client');
select throws_ok(format('select admin_register_account(%L, %L, %L)', gen_random_uuid(), 'admin', 'Nobody'),
  'P0001', 'unknown_account', 'preserved: a login that does not exist is refused');
select throws_ok(format('select admin_register_account(%L, %L, %L)', :'staffa_uid', 'admin', 'Staff Alpha'),
  'P0001', 'account_has_other_role', 'preserved: a worker''s login cannot be turned into an admin by its email');
select throws_ok(format('select admin_register_account(%L, %L, %L)', :'invitee3', 'admin', 'Cara'),
  'P0001', 'account_has_other_role', 'preserved: a client login cannot be re-registered as an admin');
select throws_ok(format('select admin_register_account(%L, %L, %L, %L)', :'invitee3', 'client', 'Cara', :'clientb'),
  'P0001', 'account_has_other_client', 'preserved: a client login is never moved to another client');
select is(admin_login_lookup('STAFFA@rls.test') ->> 'isStaff', 'true',
  'preserved: the lookup still finds a worker''s login, whatever the case');
reset role;
select is((select office_role::text from profiles where id = :'invitee1'), 'manager', 'the row says manager');
select is((select raw_app_meta_data ->> 'role' from auth.users where id = :'invitee2'), 'admin',
  'preserved: app_metadata.role is written by the database');
select is((select data ->> 'officeRole' from audit_log where action = 'account.invited' and entity_id = :'invitee2'), 'scheduler',
  'the invitation''s audit row records the office role');

-- ---------------------------------------------------------------------
-- 5 · admin_set_office_role
-- ---------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
select is((admin_set_office_role(:'invitee1', 'scheduler'))->>'changed', 'true', 'an owner makes a manager a scheduler');
select is((admin_set_office_role(:'invitee1', 'scheduler'))->>'changed', 'false', 'setting the same role again changes nothing');
select throws_ok(format('select admin_set_office_role(%L, %L)', :'admin_uid', 'manager'),
  'P0001', 'cannot_change_own_role', 'an owner cannot change their own role');
select throws_ok(format('select admin_set_office_role(%L, %L)', :'clienta_uid', 'manager'),
  'P0001', 'not_office_login', 'a client login has no office role to change');
select throws_ok(format('select admin_set_office_role(%L, %L)', :'staffa_uid', 'owner'),
  'P0001', 'not_office_login', 'nor has a worker''s');
select throws_ok(format('select admin_set_office_role(%L, %L)', gen_random_uuid(), 'manager'),
  'P0001', 'unknown_account', 'an unknown login is refused');
select throws_ok(format('select admin_set_office_role(%L, null)', :'invitee1'),
  'P0001', 'office_role_required', 'a role is required');
select is((admin_set_office_role(:'owner2', 'manager'))->>'officeRole', 'manager',
  'an owner can demote another owner while one remains (the caller)');
select is((admin_set_office_role(:'owner2', 'owner'))->>'officeRole', 'owner', 'and promote them back');
reset role;
select is((select count(*)::int from audit_log where action = 'account.role_changed' and entity_id = :'invitee1'), 1,
  'one account.role_changed row — the no-op wrote none');
select is((select data from audit_log where action = 'account.role_changed' and entity_id = :'invitee1'),
  '{"from": "manager", "to": "scheduler"}'::jsonb, 'naming the role before and after');
select is((select actor from audit_log where action = 'account.role_changed' and entity_id = :'invitee1'),
  :'admin_uid'::uuid, 'with the owner as actor');

-- The last-owner guard. With the caller always an owner who cannot change
-- themselves, it is a second fence — reachable when the caller's login has
-- been switched off but their access token still runs (ADR-0035 "Known
-- limit"): a switched-off owner does not count as the owner who remains.
-- (seed.sql's admins are owners too, so every owner but owner2 goes off.)
update auth.users set banned_until = now() + interval '1 day'
 where id in (select id from profiles where office_role = 'owner' and id <> :'owner2');
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
select throws_ok(format('select admin_set_office_role(%L, %L)', :'owner2', 'manager'),
  'P0001', 'last_owner', 'the last working owner cannot be demoted');
select throws_ok(format('select admin_set_login_disabled(%L, true, %L)', :'owner2', 'Left'),
  'P0001', 'last_owner', 'nor switched off');
select lives_ok(format('select admin_set_office_role(%L, %L)', :'manager', 'scheduler'),
  'demoting someone who is not an owner is unaffected');
reset role;
select is((select office_role::text from profiles where id = :'owner2'), 'owner', 'the owner is still an owner');
-- 20260930100000's last_admin fence, still ahead of last_owner: every
-- Back Office login but one switched off, and that one is the target.
update auth.users set banned_until = now() + interval '1 day'
 where id in (select id from profiles where role = 'admin' and id <> :'invitee1');
set local role authenticated;
select throws_ok(format('select admin_set_login_disabled(%L, true, %L)', :'invitee1', 'Left'),
  'P0001', 'last_admin', 'preserved: the last working admin cannot be switched off');
reset role;
update auth.users set banned_until = null where id in (select id from profiles where role = 'admin');
update profiles set office_role = 'manager' where id = :'manager';

-- admin_set_login_disabled's other refusals, as an owner.
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
select throws_ok(format('select admin_set_login_disabled(%L, true, %L)', :'admin_uid', 'x'),
  'P0001', 'cannot_disable_self', 'preserved: an owner cannot switch their own login off');
select throws_ok(format('select admin_set_login_disabled(%L, true, %L)', :'staffa_uid', 'x'),
  'P0001', 'use_staff_block', 'preserved: a worker is blocked on their staff profile');
select throws_ok(format('select admin_set_login_disabled(%L, true, null)', :'invitee3'),
  'P0001', 'reason_required', 'preserved: switching off needs a reason');
select throws_ok(format('select admin_set_login_disabled(%L, true, %L)', gen_random_uuid(), 'x'),
  'P0001', 'unknown_account', 'preserved: an unknown login is refused');
select is((admin_set_login_disabled(:'owner2', true, 'On leave'))->>'disabled', 'true',
  'an owner switches another owner off while one remains');
select is((admin_set_login_disabled(:'owner2', false))->>'disabled', 'false', 'and back on');

-- ---------------------------------------------------------------------
-- 6 · settings — writes need an owner
-- ---------------------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', :'manager', 'role', 'authenticated')::text, true);
select is((select count(*)::int from settings where key = 'rls_fixture_probe'), 1, 'a manager still reads settings');
with u as (update settings set value = '{"m":1}' where key = 'rls_fixture_probe' returning 1)
select is((select count(*)::int from u), 0, 'a manager''s settings update changes no row');
select throws_ok($$ insert into settings (key, value) values ('office_role_probe', '1') $$,
  '42501', null, 'nor can a manager add a setting');
with d as (delete from settings where key = 'rls_fixture_probe' returning 1)
select is((select count(*)::int from d), 0, 'nor delete one');
with u as (update venue_types set default_radius_m = 300 where key = 'rls_fixture_type' returning 1)
select is((select count(*)::int from u), 0, 'nor change a default radius');
select is((select count(*)::int from venue_types where key = 'rls_fixture_type'), 1, 'venue types stay readable');

select set_config('request.jwt.claims', json_build_object('sub', :'scheduler', 'role', 'authenticated')::text, true);
with u as (update settings set value = '{"s":1}' where key = 'rls_fixture_probe' returning 1)
select is((select count(*)::int from u), 0, 'a scheduler''s settings update changes no row');
with u as (update venue_types set default_radius_m = 300 where key = 'rls_fixture_type' returning 1)
select is((select count(*)::int from u), 0, 'nor a scheduler''s radius change');

select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
with u as (update settings set value = '{"w":1}' where key = 'rls_fixture_probe' returning 1)
select is((select count(*)::int from u), 0, 'a worker still changes no setting');
select set_config('request.jwt.claims', json_build_object('sub', :'clienta_uid', 'role', 'authenticated')::text, true);
with u as (update venue_types set default_radius_m = 300 where key = 'rls_fixture_type' returning 1)
select is((select count(*)::int from u), 0, 'nor does a client change a radius');

select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
with u as (update settings set value = '{"o":1}' where key = 'rls_fixture_probe' returning 1)
select is((select count(*)::int from u), 1, 'an owner changes a setting');
with u as (update venue_types set default_radius_m = 300 where key = 'rls_fixture_type' returning 1)
select is((select count(*)::int from u), 1, 'and a default radius');

-- ---------------------------------------------------------------------
-- 7 · finance — money-only tables
-- ---------------------------------------------------------------------
select is((select count(*)::int from bank_details where staff_id in (:'staffa', :'staffb')), 2, 'owner reads bank details');
select is((select count(*)::int from payroll_export_lines where booking_id = :'booking_a'), 1, 'owner reads payroll export lines');
select set_config('request.jwt.claims', json_build_object('sub', :'manager', 'role', 'authenticated')::text, true);
select is((select count(*)::int from bank_details where staff_id in (:'staffa', :'staffb')), 2, 'manager reads bank details');
select is((select count(*)::int from report_sends where error = 'rls_fixture_probe'), 1, 'manager reads report sends');

select set_config('request.jwt.claims', json_build_object('sub', :'scheduler', 'role', 'authenticated')::text, true);
select is((select count(*)::int from bank_details), 0, 'scheduler reads no bank details');
select is((select count(*)::int from payroll_export_lines), 0, 'scheduler reads no payroll export lines');
select is((select count(*)::int from report_sends), 0, 'scheduler reads no report sends');
select is((select bank_sort_code_masked from staff_profile_v where id = :'staffa'), null,
  'and the staff profile''s bank fields come back empty for them');
select throws_ok(format($$ insert into bank_details (staff_id, account_holder, sort_code, account_number)
                           values (%L, 'X', '00-00-00', '00000000') $$, :'new_id'),
  '42501', 'not_permitted', 'a scheduler cannot write bank details either (trigger — 571 pins admin_all as the only write policy)');
with u as (update bank_details set sort_code = '99-99-99' where staff_id = :'staffa' returning 1)
select is((select count(*)::int from u), 0, 'nor change them');
select is(booking_payroll_exported(:'booking_a'), true,
  'the check-in screen''s "already in payroll" flag (RULE-06) still reaches a scheduler');

select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
select is((select count(*)::int from bank_details), 1, 'a worker still reads their own bank details');

-- ---------------------------------------------------------------------
-- 8 · finance — the report RPCs
-- ---------------------------------------------------------------------
select throws_ok($$ select * from finance_report(current_date, current_date) $$,
  '42501', 'admins_only', 'preserved: a worker still meets the reports gate');
select set_config('request.jwt.claims', json_build_object('sub', :'clienta_uid', 'role', 'authenticated')::text, true);
select throws_ok($$ select * from payroll_report(current_date, current_date) $$,
  '42501', 'admins_only', 'preserved: and so does a client');

select set_config('request.jwt.claims', json_build_object('sub', :'scheduler', 'role', 'authenticated')::text, true);
select throws_ok($$ select * from finance_report(current_date, current_date) $$,
  '42501', 'not_permitted', 'a scheduler cannot run the financial report');
select throws_ok($$ select * from payroll_report(current_date, current_date) $$,
  '42501', 'not_permitted', 'nor the payroll report');
select throws_ok($$ select * from payroll_report_people(current_date, current_date) $$,
  '42501', 'not_permitted', 'nor its people view');
select throws_ok($$ select * from new_starter_report(current_date) $$,
  '42501', 'not_permitted', 'nor the New Starter (HMRC) report');
select throws_ok($$ select retry_finance_report(1) $$,
  '42501', 'not_permitted', 'nor retry a finance send');
select lives_ok(format('select event_document_data(%L)', :'event_a'),
  'a scheduler still builds an allocation sheet / timesheet (§11.3 shares the old gate)');

select set_config('request.jwt.claims', json_build_object('sub', :'manager', 'role', 'authenticated')::text, true);
select lives_ok($$ select * from finance_report(current_date - 7, current_date + 14) $$, 'a manager runs the financial report');
select lives_ok($$ select * from payroll_report_people(current_date - 7, current_date) $$, 'and the payroll report');
select throws_ok($$ select * from finance_report(current_date, current_date, 'week') $$,
  '22023', 'unknown_grouping', 'preserved: the grouping check is still there');

-- ---------------------------------------------------------------------
-- 9 · finance — rates on the catalogue and on a role section
-- ---------------------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', :'scheduler', 'role', 'authenticated')::text, true);
select is((select name from roles where id = :'role_id'), 'RLS Fixture Role',
  'a scheduler reads role names — scheduling needs them (the pay_rate beside them is ADR-0036''s residual gap)');
with u as (update roles set pay_rate = 99 where id = :'role_id' returning 1)
select is((select count(*)::int from u), 0, 'a scheduler''s pay-rate change on a role changes no row');
select throws_ok($$ insert into roles (name, pay_rate) values ('Scheduler role', 12) $$,
  '42501', null, 'nor can a scheduler create a role');
with u as (update client_rate_cards set charge_rate = 1 where id = :'ratecard_a' returning 1)
select is((select count(*)::int from u), 0, 'nor change a client''s charge rate');
select throws_ok(format($$ insert into client_rate_cards (client_id, role_id, charge_rate) values (%L, %L, 1) $$, :'clientb', :'role_id'),
  '42501', null, 'nor add a rate card');

select lives_ok(format($$ insert into shift_requirements (id, event_id, role_id, starts_at, ends_at, headcount, buffer, charge_rate, pay_rate)
                          values (%L, %L, %L, now() + interval '7 days', now() + interval '7 days 4 hours', 2, 0, 22.97, 14.00) $$,
                       :'new_sh', :'event_a', :'role_id'),
  'a scheduler adds a role section at the catalogue rates');
select throws_ok(format($$ insert into shift_requirements (event_id, role_id, starts_at, ends_at, headcount, buffer, charge_rate, pay_rate)
                          values (%L, %L, now() + interval '7 days', now() + interval '7 days 4 hours', 2, 0, 22.97, 20.00) $$,
                       :'event_a', :'role_id'),
  '42501', 'rates_need_finance', 'but not at a pay rate of their own');
select throws_ok(format($$ insert into shift_requirements (event_id, role_id, starts_at, ends_at, headcount, buffer, charge_rate, pay_rate)
                          values (%L, %L, now() + interval '8 days', now() + interval '8 days 4 hours', 2, 0, 30.00, 14.00) $$,
                       :'event_b', :'role_id'),
  '42501', 'rates_need_finance', 'nor charge a client with no rate card for the role anything but 0');
select lives_ok(format($$ update shift_requirements set headcount = 3, charge_rate = 22.97, pay_rate = 14.00 where id = %L $$, :'new_sh'),
  'a scheduler edits a section''s headcount, the rates resent unchanged');
select throws_ok(format($$ update shift_requirements set pay_rate = 15 where id = %L $$, :'new_sh'),
  '42501', 'rates_need_finance', 'but cannot re-price it');

select set_config('request.jwt.claims', json_build_object('sub', :'manager', 'role', 'authenticated')::text, true);
select lives_ok(format($$ update shift_requirements set pay_rate = 15 where id = %L $$, :'new_sh'),
  'a manager re-prices a section');
with u as (update roles set pay_rate = 14.50 where id = :'role_id' returning 1)
select is((select count(*)::int from u), 1, 'and changes a role''s pay rate');
with u as (update client_rate_cards set charge_rate = 23.50 where id = :'ratecard_a' returning 1)
select is((select count(*)::int from u), 1, 'and a client''s charge rate');

-- ---------------------------------------------------------------------
-- 10 · finance — the money views
-- ---------------------------------------------------------------------
select is((select count(*)::int from role_directory_v where id = :'role_id'), 1, 'manager reads role_directory_v');
select is((select count(*)::int from dashboard_week_finance_v), 1, 'and the dashboard''s weekly money');
select isnt((select avg_margin_pct from clients_directory_v where id = :'clienta'), null, 'and a client''s average margin');

select set_config('request.jwt.claims', json_build_object('sub', :'scheduler', 'role', 'authenticated')::text, true);
select is((select count(*)::int from role_directory_v), 0, 'scheduler reads nothing from role_directory_v');
select is((select count(*)::int from clients_rate_card_v), 0, 'nor from clients_rate_card_v');
select is((select count(*)::int from clients_margins_v), 0, 'nor from clients_margins_v');
select is((select count(*)::int from dashboard_week_finance_v), 0, 'nor the weekly money panel');
select ok((select count(*) from dashboard_upcoming_v) > 0, 'but still reads the ten-day list');
select is((select count(*)::int from dashboard_upcoming_v
            where charge_rate is not null or base_rate is not null
               or final_pay_rate is not null or margin_per_hour is not null), 0,
  'with every rate and margin on it NULL');
select ok((select count(*) from dashboard_kpis_v) = 1, 'and the four KPIs');
select is((select count(*)::int from clients_directory_v where id = :'clienta' and avg_margin_pct is null), 1,
  'the client directory keeps the row and drops the margin');
select is((select count(*)::int from clients_event_list_v where client_id = :'clienta'
            and margin_gbp is null and margin_pct is null), 2,
  'the client''s event list keeps every event and drops the margin');

select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
select ok((select count(*) from dashboard_upcoming_v where margin_per_hour is not null) > 0,
  'an owner sees the margin on the ten-day list');
select is((select count(*)::int from clients_event_list_v where client_id = :'clienta' and margin_gbp is not null), 2,
  'and on the client''s events');

select set_config('request.jwt.claims', json_build_object('sub', :'clienta_uid', 'role', 'authenticated')::text, true);
select is((select count(*)::int from role_directory_v), 0, 'a client still reads nothing from role_directory_v');
select is((select count(*)::int from dashboard_upcoming_v), 0, 'nor the dashboard');
reset role;
select ok(not has_table_privilege('anon', 'clients_directory_v', 'select')
      and not has_table_privilege('anon', 'role_directory_v', 'select'),
  'anon holds no grant on the money views');

select * from finish();
rollback;
