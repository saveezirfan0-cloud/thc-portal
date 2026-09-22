-- =====================================================================
-- 260 · The staff profile (§9.6) — role and client qualification, and
--       the automatic grant     — 20260922094500_staff_profile.sql
--
-- The reads are checked, but the weight of this file is on four rules
-- where the obvious implementation is the wrong one:
--
--   · Removing a role deletes the client qualifications that named it —
--     EXCEPT one carrying Do not return. Deleting that row un-bars the
--     worker at the client, which is precisely what §9.6 tells managers
--     not to do.
--   · The automatic grant is for THE ROLE ACTUALLY WORKED. §9.6: "Working
--     a Waiting Staff shift at a client does not qualify them as Bar
--     Staff there."
--   · It never overwrites a manual entry, so a manager's note and name
--     survive a later clean shift at the same client.
--   · A violation resolved AFTER the shift closed makes it clean
--     retrospectively, and the grant has to happen then — otherwise a
--     Late the office resolves the next morning costs the worker a
--     qualification they earned.
-- =====================================================================
begin;
select plan(40);
\ir _shared/fixtures.psql

\set role_b     'bbbbbbbb-0000-4000-8000-000000000002'
\set past_event 'eeeeeeee-0000-4000-8000-00000000000a'
\set past_shift 'ffffffff-0000-4000-8000-00000000000a'
\set past_bkg   '0a0a0a0a-0000-4000-8000-00000000000a'
\set past_bkg_b '0a0a0a0a-0000-4000-8000-00000000000b'
\set past_viol  '0d0d0d0d-0000-4000-8000-00000000000a'
\set gone_staff 'ababab10-0000-4000-8000-000000000001'

-- A second role, so "the role they actually worked" can be told apart
-- from "every role they hold".
insert into roles (id, name, description, pay_rate) values
  (:'role_b', 'Profile Fixture Role B', 'internal only', 15.00);
insert into staff_roles (staff_id, role_id) values (:'staffa', :'role_b');

-- A finished shift at Client B, which Staff Alpha is NOT yet qualified
-- at — so any row that appears there was put there by the trigger.
insert into events (id, client_id, venue_id, venue_name, venue_address, venue_location,
                    geofence_radius_m, title, event_date, pays_breaks, pays_buffer) values
  (:'past_event', :'clientb', :'venue_id', 'RLS Fixture Venue', '1 Test Street, London',
   st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150,
   'Profile Fixture Past Event', current_date - 3, true, true);
insert into shift_requirements (id, event_id, role_id, starts_at, ends_at, headcount, buffer,
                                charge_rate, pay_rate, allocation_per_hour) values
  (:'past_shift', :'past_event', :'role_id', now() - interval '3 days',
   now() - interval '3 days' + interval '8 hours', 4, 0, 22.97, 14.00, 4);

-- =====================================================================
-- staff_profile_v (§9.6)
-- =====================================================================
select has_view('staff_profile_v', 'the profile header and Overview tab come from one view');

select is((select ni_number_masked from staff_profile_v where id = :'staffa'), null,
  'no NI number on file means no mask, not a row of dots suggesting one exists');

update staff set ni_number = 'QQ123456B' where id = :'staffa';
select is((select ni_number_masked from staff_profile_v where id = :'staffa'), '●●●●●●●6B',
  'the NI number is masked to its last two characters — enough to confirm a record with payroll, never the value (§9.6)');
select is((select has_ni_number from staff_profile_v where id = :'staffa'), true,
  'and the screen can still say whether one is held at all');

select is((select bank_sort_code_masked from staff_profile_v where id = :'staffa'), '04-••-••',
  'the sort code shows its first pair only');
select is((select bank_account_masked from staff_profile_v where id = :'staffa'), '••••0001',
  'the account number its last four');

select is((select hmrc_statement::text from staff_profile_v where id = :'staffa'), 'A',
  'the HMRC statement is the derived one (§2.8)');
update hmrc_checklists set superseded = true where staff_id = :'staffa';
select is((select hmrc_statement from staff_profile_v where id = :'staffa'), null,
  'and a superseded checklist is not the worker''s current position — a Reset to candidate leaves them with none until they redo it (§2.12)');

-- §1.7. The wipe is assumed to have half-run: the columns still hold
-- everything, and the view still must not print any of it.
insert into staff (id, employee_id, first_name, last_name, email, phone, dob, status,
                   home_address, ni_number, removed_at) values
  (:'gone_staff', 91050, 'Removed', 'Worker', 'gone@rls.test', '+447700900098',
   date '1990-01-01', 'removed', '1 Somewhere Road', 'QQ999999C', now());
insert into bank_details (staff_id, account_holder, sort_code, account_number) values
  (:'gone_staff', 'Removed Worker', '04-00-04', '11119999');

select is((select email from staff_profile_v where id = :'gone_staff'), null,
  'a removed worker''s email is not printable even while the column holds it (§1.7)');
select is((select home_address from staff_profile_v where id = :'gone_staff'), null,
  'nor their address');
select is((select ni_number_masked from staff_profile_v where id = :'gone_staff'), null,
  'nor the last two of their NI number — a mask is still personal data about a person who asked to be forgotten');
select is((select bank_account_masked from staff_profile_v where id = :'gone_staff'), null,
  'nor their bank details');
select is((select display_name from staff_profile_v where id = :'gone_staff'),
  deleted_account_label(91050),
  'and the name is the one deleted_account_label() gives, inherited from staff_directory_v rather than redefined');

-- =====================================================================
-- Role qualification (§9.6)
-- =====================================================================
select is(add_staff_role(:'staffb', :'role_b') ->> 'roleId', :'role_b',
  'a role can be added to a worker');
select lives_ok($$ select add_staff_role('dddddddd-0000-4000-8000-000000000002',
                                         'bbbbbbbb-0000-4000-8000-000000000002') $$,
  'and adding it twice is a no-op, not an error the manager has to read — "+ Add role" is a dropdown');
select is((select count(*)::int from staff_roles
            where staff_id = :'staffb' and role_id = :'role_b'), 1,
  'one row either way');

select throws_ok($$ select add_staff_role('dddddddd-0000-4000-8000-000000000002',
                                          '00000000-0000-4000-8000-00000000dead') $$,
  'P0001', null,
  'an unknown role is refused rather than silently ignored');

-- The Do-not-return exception, which is the point of this block.
insert into client_qualifications (client_id, role_id, staff_id, note) values
  (:'clienta', :'role_b', :'staffa', 'Manual clearance for role B');
select set_do_not_return((select id from client_qualifications
                           where staff_id = :'staffa' and role_id = :'role_id'
                             and client_id = :'clienta'),
                         true, 'Client asked for her not to return');

select is(remove_staff_role(:'staffa', :'role_id') ->> 'doNotReturnKept', '1',
  'removing a role reports the barring entry it refused to delete');
select is((select do_not_return from client_qualifications
            where staff_id = :'staffa' and role_id = :'role_id' and client_id = :'clienta'), true,
  'the Do-not-return row SURVIVES the role removal — deleting it would un-bar her at that client, which §9.6 tells managers not to do');
select is(remove_staff_role(:'staffa', :'role_b') ->> 'qualificationsRemoved', '1',
  'a qualification NOT carrying the flag goes with its role — it named a role she no longer holds');

-- Put the role back for the rest of the file.
select add_staff_role(:'staffa', :'role_id');
select set_do_not_return((select id from client_qualifications
                           where staff_id = :'staffa' and role_id = :'role_id'
                             and client_id = :'clienta'), false);

-- =====================================================================
-- Client qualification (§9.6, §9.7)
-- =====================================================================
select throws_ok($$ select grant_client_qualification(
                      'dddddddd-0000-4000-8000-000000000001',
                      'aaaaaaaa-0000-4000-8000-000000000002',
                      'bbbbbbbb-0000-4000-8000-00000000dead') $$,
  '23514', null,
  'a worker cannot be qualified at a client for a role they do not hold — auto-assign would never read the row (§9.6)');

select isnt(grant_client_qualification(:'staffa', :'clientb', :'role_id', 'Site induction done'), null,
  'a manual grant returns the entry');
select is((select granted_how from staff_client_qualifications_v
            where staff_id = :'staffa' and client_id = :'clientb'), 'manual',
  'and the view says how it was granted rather than leaving each screen to infer it from two nulls');

select throws_ok($$ select set_do_not_return(
                      (select id from client_qualifications
                        where staff_id = 'dddddddd-0000-4000-8000-000000000001'
                          and client_id = 'aaaaaaaa-0000-4000-8000-000000000002'),
                      true) $$,
  '23514', null,
  'Do not return needs a reason — it is shown on that client''s events, and an unexplained bar is one nobody can decide to lift (§9.6)');

select set_do_not_return((select id from client_qualifications
                           where staff_id = :'staffa' and client_id = :'clientb'),
                         true, 'Complaint 02.09, service attitude');
select throws_ok($$ select revoke_client_qualification(
                      (select id from client_qualifications
                        where staff_id = 'dddddddd-0000-4000-8000-000000000001'
                          and client_id = 'aaaaaaaa-0000-4000-8000-000000000002')) $$,
  '23514', null,
  'and a barring entry cannot be removed while the flag is on — Remove is not how a bar is lifted (§9.6)');

select set_do_not_return((select id from client_qualifications
                           where staff_id = :'staffa' and client_id = :'clientb'), false);
select is((select note from client_qualifications
            where staff_id = :'staffa' and client_id = :'clientb'),
  'Complaint 02.09, service attitude',
  'switching the flag off KEEPS the reason — it is the record the next manager''s decision rests on');

select is((select count(*)::int from audit_log
            where action = 'do_not_return_on' and entity = 'client_qualification'), 2,
  'every switch-on is audited — a hard gate is not a silent edit');
select is((select count(*)::int from audit_log
            where action = 'do_not_return_off' and entity = 'client_qualification'), 2,
  'and so is every switch-off: lifting a bar is the half a manager has to answer for');

select lives_ok($$ select revoke_client_qualification(
                     (select id from client_qualifications
                       where staff_id = 'dddddddd-0000-4000-8000-000000000001'
                         and client_id = 'aaaaaaaa-0000-4000-8000-000000000002')) $$,
  'with the flag off the entry removes normally');

-- =====================================================================
-- The automatic grant (§9.6)
-- =====================================================================
select is((select count(*)::int from client_qualifications
            where staff_id = :'staffa' and client_id = :'clientb'), 0,
  'Staff Alpha starts unqualified at Client B, so any row below was put there by the trigger');

insert into bookings (id, shift_id, staff_id, status, source) values
  (:'past_bkg', :'past_shift', :'staffa', 'confirmed', 'auto');
insert into violations (id, staff_id, booking_id, type, minutes_late) values
  (:'past_viol', :'staffa', :'past_bkg', 'late', 15);

update bookings set status = 'worked' where id = :'past_bkg';
select is((select count(*)::int from client_qualifications
            where staff_id = :'staffa' and client_id = :'clientb'), 0,
  'a completed shift with an UNRESOLVED violation grants nothing — §9.6''s condition is a clean shift');

update violations set resolved = true, resolved_at = now(), resolution_note = 'tube delay'
 where id = :'past_viol';
select is((select count(*)::int from client_qualifications
            where staff_id = :'staffa' and client_id = :'clientb'), 1,
  'resolving it grants the qualification then — a Late the office clears the next morning must not cost her the clearance she earned');

select is((select granted_how from staff_client_qualifications_v
            where staff_id = :'staffa' and client_id = :'clientb'), 'automatic',
  'marked as a system grant (§9.6)');
select is((select granted_from_event_title from staff_client_qualifications_v
            where staff_id = :'staffa' and client_id = :'clientb'),
  'Profile Fixture Past Event',
  'carrying the event it came from, which a nightly batch job would have to reconstruct');
select is((select role_id from client_qualifications
            where staff_id = :'staffa' and client_id = :'clientb'), :'role_id',
  'and for THE ROLE SHE ACTUALLY WORKED — working a shift in one role does not qualify her for another at that client (§9.6)');
select is((select count(*)::int from client_qualifications
            where staff_id = :'staffa' and client_id = :'clientb' and role_id = :'role_b'), 0,
  'her second role gets no row from this shift');

-- A manual entry must not be overwritten by a later clean shift.
update client_qualifications set granted_by = :'admin_uid', granted_from_event = null,
       note = 'Manual: client asked for her'
 where staff_id = :'staffa' and client_id = :'clientb';
insert into bookings (id, shift_id, staff_id, status, source) values
  (:'past_bkg_b', :'past_shift', :'staffb', 'confirmed', 'auto');
update bookings set status = 'worked' where id = :'past_bkg';
select is((select note from client_qualifications
            where staff_id = :'staffa' and client_id = :'clientb'),
  'Manual: client asked for her',
  'a second clean shift does not overwrite the manager''s entry — their note, their name and their date stand');

-- And never over a bar.
select set_do_not_return((select id from client_qualifications
                           where staff_id = :'staffa' and client_id = :'clientb'),
                         true, 'Do not return');
select add_staff_role(:'staffa', :'role_b');
update shift_requirements set role_id = :'role_b' where id = :'past_shift';
update bookings set status = 'confirmed' where id = :'past_bkg';
update bookings set status = 'worked' where id = :'past_bkg';
select is((select count(*)::int from client_qualifications
            where staff_id = :'staffa' and client_id = :'clientb'), 1,
  'a clean shift at a client where she is barred grants nothing, not even for a different role — the gate is client-wide, and a new row would read as a contradiction on the screen');

-- =====================================================================
-- RLS
-- =====================================================================
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid')::text, true);
select is((select count(*)::int from staff_profile_v), 1,
  'a worker reaches one profile through the view: their own (staff_self, 0001)');
select is((select count(*)::int from staff_client_qualifications_v), 0,
  'and no client qualifications at all — client_qualifications is admin_all, and the view is security_invoker so it cannot hand back what the policy withholds (ADR-0004)');

reset role;
select * from finish();
rollback;
