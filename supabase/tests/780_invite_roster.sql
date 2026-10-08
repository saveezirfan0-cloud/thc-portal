-- =====================================================================
-- 780 · The invite list: SpudBros Express or THC, and the Payroll ID
--       (20261008100000, ADR-0105)
--
--   1. shape: invite_roster has RLS, one policy (admin_read), the viewer's
--      write guard; the loader is the office's, the matcher is nobody's;
--   2. the group, in whatever words the sheet uses;
--   3. load_invite_roster(): what it takes, and a reason for every row it
--      does not; people already here get the list applied now — unless that
--      would strand a shift;
--   4. an application is matched to the list: the list's group wins over the
--      link, the link decides for someone not on the list, the Payroll ID
--      moves onto the new candidate and the row is consumed — and a
--      returning applicant is never touched;
--   5. the Employee ID follows a numeric Payroll ID at contract signature;
--      one with a letter keeps a system ID;
--   6. set_staff_payroll_id and remove_invite_roster_entries: who may;
--   7. the office's two lists carry the group and the Payroll ID;
--   8. entries older than 180 days are dropped on the next load.
-- =====================================================================
begin;
select plan(76);
\ir _shared/fixtures.psql

\set here    '77900000-0000-4000-8000-000000000001'
\set busy    '77900000-0000-4000-8000-000000000002'
\set sp      '77900000-0000-4000-8000-000000000003'
\set owner   '77900000-0000-4000-8000-000000000004'
\set signer  '77900000-0000-4000-8000-000000000005'
\set signer2 '77900000-0000-4000-8000-000000000006'
\set viewer  '77900000-0000-4000-8000-000000000007'
\set other   '77900000-0000-4000-8000-000000000008'
\set evt     '77900000-0000-4000-8000-00000000000e'
\set sec     '77900000-0000-4000-8000-0000000000a1'

insert into auth.users (id, email) values (:'viewer', 'viewer.779@rls.test');
insert into profiles (id, role, office_role, full_name) values (:'viewer', 'admin', 'viewer', 'Vic Viewer');

-- =====================================================================
-- 1 · Shape
-- =====================================================================
select has_table('public', 'invite_roster', 'invite_roster exists');
select ok((select relrowsecurity from pg_class where oid = 'public.invite_roster'::regclass),
  'invite_roster has row level security');
select is(
  (select array_agg(polname::text || ':' || polcmd::text order by polname) from pg_policy
    where polrelid = 'public.invite_roster'::regclass),
  array['admin_read:r'],
  'one policy — admin_read, SELECT only; no staff, client or write policy');
select ok(exists (select 1 from pg_trigger where tgrelid = 'public.invite_roster'::regclass
                    and tgname = 'office_read_only'),
  'carries the viewer''s write guard (ADR-0060)');
select ok(has_function_privilege('authenticated', 'public.load_invite_roster(jsonb)', 'execute')
      and not has_function_privilege('anon', 'public.load_invite_roster(jsonb)', 'execute'),
  'the office can load the list; the public cannot');
select ok(not has_function_privilege('authenticated', 'public.record_application_source(text,text)', 'execute')
      and not has_function_privilege('service_role', 'public.record_application_source(text,text)', 'execute')
      and not has_function_privilege('anon', 'public.record_application_source(text,text)', 'execute'),
  'the matcher is owner-only: no API role can mark anyone directly');
select ok(has_column_privilege('authenticated', 'public.staff', 'payroll_id', 'select'),
  'a signed-in session may read payroll_id (RLS decides the rows)');

-- =====================================================================
-- 2 · The group
-- =====================================================================
select is(
  (select array_agg(invite_roster_group(g) order by n)
     from (values (1, 'Spud Bros Express'), (2, ' SPUDBROS '), (3, 'spud'), (4, 'SBE'),
                  (5, 'Normal'), (6, 'THC'), (7, 'standard'), (8, 'huh'), (9, ''), (10, null)) as t(n, g)),
  array['spudbros', 'spudbros', 'spudbros', 'spudbros', 'thc', 'thc', 'thc', null, null, null]::text[],
  'the sheet''s words for each group; anything else is not guessed at');

-- =====================================================================
-- 3 · Loading the list
-- =====================================================================
insert into staff (id, first_name, last_name, email, phone, dob, status, employee_id, spudbros_express, payroll_id) values
  (:'here',  'Hera',  'Here',  'here@t779.test',  '+447700979001', date '1990-01-01', 'compliant', 19001, false, null),
  (:'busy',  'Bea',   'Busy',  'busy@t779.test',  '+447700979002', date '1990-01-01', 'compliant', 19002, false, null),
  (:'sp',    'Sid',   'Spud',  'sp@t779.test',    '+447700979003', date '1990-01-01', 'compliant', 19003, true,  null),
  (:'owner', 'Olga',  'Owner', 'owner@t779.test', '+447700979004', date '1990-01-01', 'compliant', 19004, false, 'T1');

insert into staff (id, first_name, last_name, email, phone, dob, status, employee_id) values
  (:'other', 'Zed', 'Zebra', 'other@t779.test', '+447700979005', date '1990-01-01', 'compliant', 19005);

insert into events (id, client_id, venue_id, venue_name, venue_address, venue_location,
                    geofence_radius_m, title, event_date, pays_breaks, pays_buffer, auto_assign) values
  (:'evt', :'clienta', :'venue_id', 'RLS Fixture Venue', '1 Test Street, London',
   st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150,
   'Roster Gala', (current_date + 30), true, true, true);
insert into shift_requirements (id, event_id, role_id, starts_at, ends_at, headcount, buffer,
                                charge_rate, pay_rate, allocation_per_hour, auto_assign) values
  (:'sec', :'evt', :'role_id', ((current_date + 30)::timestamp + interval '17 hours'), ((current_date + 30)::timestamp + interval '23 hours'), 6, 0, 30, 15, 6, true);
insert into bookings (shift_id, staff_id, status, source) values (:'sec', :'busy', 'invited', 'manual');

-- A viewer cannot load. (Checked before the real load so nothing is half-done.)
select set_config('request.jwt.claims', json_build_object('sub', :'viewer', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok($$ select load_invite_roster('[{"email":"v@t779.test","group":"thc"}]'::jsonb) $$,
  '42501', 'read_only', 'a viewer cannot load the list');
reset role;

select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok($$ select load_invite_roster('[{"email":"v@t779.test","group":"thc"}]'::jsonb) $$,
  '42501', 'not_authorised', 'a worker cannot load the list');
reset role;

select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
create temp table first_load as
select load_invite_roster($$[
  {"email": " Spud1@t779.test ", "first_name": "Sidney", "last_name": "Spudson", "payroll_id": "1641a", "group": "Spud Bros Express"},
  {"email": "norm@t779.test",    "first_name": "Noreen", "last_name": "Normanton", "payroll_id": "1500",  "group": "normal"},
  {"email": "spud2@t779.test",   "first_name": "Sam",  "last_name": "Spud", "group": "spudbros"},
  {"email": "bad",               "group": "thc"},
  {"email": "x@t779.test",       "group": "huh"},
  {"email": "norm@t779.test",    "group": "thc"},
  {"email": "y@t779.test",       "payroll_id": "1500", "group": "thc"},
  {"email": "z@t779.test",       "payroll_id": "12 34", "group": "thc"},
  {"email": "zero@t779.test",    "first_name": "Zoe", "last_name": "Zero", "payroll_id": "0183", "group": "thc"}
]$$::jsonb) as r;

create temp table second_load as
select load_invite_roster($$[
  {"email": "HERE@t779.test",  "payroll_id": "2200", "group": "spudbros"},
  {"email": "busy@t779.test",  "payroll_id": "2201", "group": "spudbros"},
  {"email": "sp@t779.test",    "payroll_id": "2202", "group": "thc"},
  {"email": "new@t779.test",   "payroll_id": "T1",   "group": "thc"},
  {"email": "other@t779.test", "first_name": "Yan", "last_name": "Yellow", "payroll_id": "2300", "group": "spudbros"}
]$$::jsonb) as r;
reset role;

select is((select (r->>'loaded')::int from first_load), 4, 'four people added to the list');
select is((select payroll_id from invite_roster where email = 'zero@t779.test'), '183',
  'a leading zero is not a different Payroll ID: 0183 is 183, as it is one Employee ID');
select is((select jsonb_array_length(r->'skipped') from first_load), 5, 'five rows handed back');
select is(
  (select array_agg(s->>'reason' order by s->>'reason') from first_load, jsonb_array_elements(r->'skipped') s),
  array['bad_email', 'bad_payroll_id', 'duplicate_email_in_file', 'duplicate_payroll_id_in_file', 'group_unknown']::text[],
  'each with its reason');
select is((select grp || ':' || coalesce(payroll_id, '-') from invite_roster where email = 'spud1@t779.test'),
  'spudbros:1641A', 'the email is trimmed and lower-cased, the Payroll ID upper-cased, the group understood');
select is((select grp from invite_roster where email = 'norm@t779.test'), 'thc', '"normal" is the THC group');

select is((select (r->>'updated')::int from second_load), 3,
  'three people already here had the list applied (their Payroll ID goes on regardless of the group)');
select is((select payroll_id from staff where id = :'here'), '2200', 'their Payroll ID is on their profile');
select is((select spudbros_express from staff where id = :'here'), true, 'and they are marked SpudBros Express');
select is((select employee_id from staff where id = :'here'), 2200,
  'a numeric Payroll ID replaces a system-issued Employee ID (the ADR-0076 backfill rule)');
select is((select count(*)::int from audit_log where action = 'roster.applied_existing' and entity_id = :'here'), 1,
  'audited');
select is((select r->'held'->0->>'reason' from second_load),
  'has_upcoming_shifts', 'someone with an upcoming invitation is not closed out — reported instead');
select is((select spudbros_express from staff where id = :'busy'), false, 'and is not marked');
select is((select payroll_id from staff where id = :'busy'), '2201', 'though their Payroll ID is on their profile');
select is((select r->'held'->1->>'reason' from second_load), 'already_marked_spudbros',
  'a list never switches a SpudBros person back to THC — reported instead');
select is((select spudbros_express from staff where id = :'sp'), true, 'who stays marked');
select is((select r->'skipped'->0->>'reason' from second_load), 'payroll_id_taken',
  'a Payroll ID somebody already holds is not given again');
select is((select r->'held'->2->>'reason' from second_load), 'name_mismatch',
  'a sheet email that belongs to a DIFFERENTLY NAMED live worker is held, not applied');
select is((select payroll_id || ':' || spudbros_express::text || ':' || employee_id::text from staff where id = :'other'), null,
  'and changes nothing on them — no Payroll ID');
select is((select spudbros_express::text || ':' || employee_id::text from staff where id = :'other'), 'false:19005',
  'not marked SpudBros, Employee ID untouched');

-- =====================================================================
-- 4 · An application is matched to the list
-- =====================================================================
insert into invite_roster (email, grp, payroll_id) values ('staffb@rls.test', 'spudbros', 'ZZ9');
insert into invite_roster (email, first_name, last_name, grp, payroll_id)
  values ('victim@t779.test', 'Vera', 'Victim', 'spudbros', 'V7');
-- A listed person whose Payroll ID somebody else now holds (T1 is Olga's).
insert into invite_roster (email, first_name, last_name, grp, payroll_id)
  values ('clash@t779.test', 'Cleo', 'Clash', 'thc', 'T1');

set local role service_role;
set local "request.jwt.claims" = '{"role":"service_role"}';
-- Somebody who knows an invited email, but not the invitee's name.
select lives_ok($$ select submit_application_as_caller('Mallory', 'Attacker', 'victim@t779.test', '+447700979199',
  date '1999-01-09', true, null, null, null) $$, 'someone applies with an invited email and the wrong name');
select lives_ok($$ select submit_application_as_caller('Cleo', 'Clash', 'clash@t779.test', '+447700979198',
  date '1999-01-08', true, null, null, null) $$, 'a listed person whose Payroll ID is now held by somebody else applies');
-- On the list as SpudBros, through the ORDINARY link.
select lives_ok($$ select submit_application_as_caller('Sidney', 'Spudson', 'spud1@t779.test', '+447700979101',
  date '1999-01-01', true, null, null, null) $$, 'a listed SpudBros person applies through /apply');
-- On the list as THC, through the SpudBros link.
select lives_ok($$ select submit_application_as_caller('Noreen Anne', 'Normanton', 'norm@t779.test', '+447700979102',
  date '1999-01-02', true, null, null, 'spudbros') $$, 'a listed THC person applies through /apply/spudbros');
-- Not on the list: the link decides.
select lives_ok($$ select submit_application_as_caller('Una', 'Unlisted', 'unlisted@t779.test', '+447700979103',
  date '1999-01-03', true, null, null, 'spudbros') $$, 'an unlisted person applies through /apply/spudbros');
select lives_ok($$ select submit_application_as_caller('Olive', 'Ordinary', 'ordinary@t779.test', '+447700979104',
  date '1999-01-04', true, null, null, null) $$, 'an unlisted person applies through /apply');
-- A live worker, on the list as SpudBros, re-applying: the §2.12 match.
select lives_ok($$ select submit_application_as_caller('Staff', 'Bravo', 'staffb@rls.test', '+447700979105',
  date '1994-02-02', true, null, null, 'spudbros') $$, 'an existing worker re-applies through /apply/spudbros');
reset role;

select is((select spudbros_express::text || ':' || payroll_id from staff where email = 'spud1@t779.test'), 'true:1641A',
  'listed as SpudBros: marked, and the Payroll ID is on the new candidate — whichever link they used');
select is((select spudbros_express::text || ':' || payroll_id from staff where email = 'norm@t779.test'), 'false:1500',
  'listed as THC: not marked, even through the SpudBros link — the list wins');
select is((select spudbros_express from staff where email = 'unlisted@t779.test'), true,
  'not listed: the SpudBros link marks them');
select is((select payroll_id from staff where email = 'unlisted@t779.test'), null, 'with no Payroll ID');
select is((select spudbros_express from staff where email = 'ordinary@t779.test'), false,
  'not listed, ordinary link: an ordinary worker');
select is((select count(*)::int from invite_roster where email in ('spud1@t779.test', 'norm@t779.test')), 0,
  'the matched rows are consumed — a middle name in the app does not stop the match');
select is((select count(*)::int from invite_roster where email = 'victim@t779.test'), 1,
  'a wrong-name application leaves the invitee''s row exactly where it was');
select is((select coalesce(payroll_id, '-') || ':' || spudbros_express::text from staff where email = 'victim@t779.test'), '-:false',
  'and gets neither their Payroll ID nor their group');
select is((select coalesce(payroll_id, '-') from staff where email = 'clash@t779.test'), '-',
  'a Payroll ID somebody else holds is never given twice');
select is((select count(*)::int from invite_roster where email = 'clash@t779.test'), 1,
  'and the list row is KEPT, so the office can see who came in without their ID');
select is((select data->>'payrollIdTaken' from audit_log where action = 'roster.matched'
             and entity_id = (select id from staff where email = 'clash@t779.test')), 'true',
  'audited as such');
select is((select count(*)::int from audit_log where action = 'roster.name_mismatch'
             and entity_id = (select id from staff where email = 'victim@t779.test')), 1,
  'the miss is recorded for the office');
select is(
  (select array_agg(data->>'via' order by data->>'via') from audit_log
    where action = 'roster.matched'
      and entity_id in (select id from staff where email in ('spud1@t779.test', 'norm@t779.test', 'unlisted@t779.test'))),
  array['link', 'list', 'list_over_link']::text[],
  'audit_log says how each was decided');
select is((select spudbros_express::text || ':' || coalesce(payroll_id, '-') from staff where id = :'staffb'), 'false:-',
  'a returning applicant is never marked or given a Payroll ID from the public form');
select is((select count(*)::int from invite_roster where email = 'staffb@rls.test'), 1,
  'and their list row is left where it was');

-- =====================================================================
-- 5 · The Employee ID follows a numeric Payroll ID
-- =====================================================================
insert into payroll_codes (code, first_name, last_name) values (3300, 'Other', 'Name');
insert into staff (id, first_name, last_name, email, phone, dob, status, employee_id, payroll_id) values
  (:'signer',  'Sig',  'Ner',  'signer@t779.test',  '+447700979201', date '1990-01-01', 'contract', null, '3300'),
  (:'signer2', 'Sig',  'Two',  'signer2@t779.test', '+447700979202', date '1990-01-01', 'contract', null, '1641B');
update staff set status = 'compliant', contract_signed_at = now(), contract_version = 'v1'
 where id in (:'signer', :'signer2');

select is((select employee_id from staff where id = :'signer'), 3300,
  'a numeric Payroll ID is the Employee ID at signature — the name does not have to match');
select is((select count(*)::int from payroll_codes where code = 3300), 0, 'and the payroll code row is consumed');
select is((select count(*)::int from audit_log where action = 'employee_id_from_payroll'
             and entity_id = :'signer' and data->>'via' = 'payroll_id'), 1, 'audited');
select ok((select employee_id >= 10001 from staff where id = :'signer2'),
  'a Payroll ID with a letter cannot be an integer Employee ID: a system one is issued');
select is((select payroll_id from staff where id = :'signer2'), '1641B', 'and the Payroll ID stays on the profile');
select throws_ok(format($$ update staff set payroll_id = 'T1' where id = %L $$, :'signer2'),
  '23505', null, 'a Payroll ID belongs to one person');
select throws_ok(format($$ update staff set payroll_id = 'no spaces' where id = %L $$, :'signer2'),
  '23514', null, 'and has a shape');

-- =====================================================================
-- 6 · set_staff_payroll_id and remove_invite_roster_entries
-- =====================================================================
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is(set_staff_payroll_id(:'signer2', ' ab-12 ')->>'payrollId', 'AB-12', 'the office sets one, upper-cased');
select throws_ok(format($$ select set_staff_payroll_id(%L, 'T1') $$, :'signer2'),
  'P0001', 'payroll_id_taken', 'one somebody holds is refused');
select throws_ok(format($$ select set_staff_payroll_id(%L, 'a b') $$, :'signer2'),
  'P0001', 'payroll_id_shape', 'a malformed one is refused');
select is(set_staff_payroll_id(:'signer2', null)->>'payrollId', null, 'null clears it');
select is((select count(*)::int from audit_log where action = 'staff.payroll_id_set' and entity_id = :'signer2'), 2,
  'both changes audited');

select set_config('request.jwt.claims', json_build_object('sub', :'viewer', 'role', 'authenticated')::text, true);
select throws_ok(format($$ select set_staff_payroll_id(%L, 'Q1') $$, :'signer2'),
  '42501', 'read_only', 'a viewer cannot set one');
select throws_ok($$ select remove_invite_roster_entries(null) $$,
  '42501', 'read_only', 'a viewer cannot clear the list');

select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
select throws_ok(format($$ select set_staff_payroll_id(%L, 'Q1') $$, :'staffa'),
  '42501', 'not_authorised', 'a worker cannot set their own');
reset role;

-- =====================================================================
-- 7 · The office's two lists
-- =====================================================================
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select spudbros_express::text || ':' || payroll_id from staff_directory_v where id = :'here'), 'true:2200',
  'staff_directory_v carries the group and the Payroll ID');
select is((select spudbros_express::text || ':' || thc_shifts_enabled::text
             from onboarding_candidates_v where email = 'spud1@t779.test'), 'true:false',
  'and so does the onboarding board');
select is((select count(*)::int from invite_roster where email = 'staffb@rls.test'), 1, 'the office reads the list');
reset role;

select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select count(*)::int from invite_roster), 0, 'a worker reads nothing of it');
reset role;

-- =====================================================================
-- 8 · Retention, and clearing
-- =====================================================================
update staff set removed_at = now() where id in (:'owner', :'sp');
select is((select coalesce(payroll_id, '-') || ':' || spudbros_express::text from staff where id = :'owner'), '-:false',
  'GDPR removal clears the Payroll ID — the ID of a removed person is not kept (or in the way)');
select is((select spudbros_express::text from staff where id = :'sp'), 'false', 'and the SpudBros marking');
insert into invite_roster (email, grp, loaded_at) values ('stale@t779.test', 'thc', now() - interval '200 days');
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select load_invite_roster('[]'::jsonb);
select is((select count(*)::int from invite_roster where email = 'stale@t779.test'), 0,
  'an entry older than 180 days is dropped on the next load');
select count(*)::int as waiting from invite_roster \gset
select is(remove_invite_roster_entries(null), :waiting, 'clearing returns how many it removed');
select is((select count(*)::int from invite_roster), 0, 'and leaves none');
reset role;

select * from finish();
rollback;
