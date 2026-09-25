-- =====================================================================
-- 040 · RLS for anonymous (logged-out) callers
-- Nothing in the schema is public. Every RLS-enabled table and every
-- client-facing view must be empty for the `anon` PostgREST role.
-- =====================================================================
begin;
select plan(53);
\ir _shared/fixtures.psql

-- A queued erasure and an issued timesheet copy to probe for (§1.7, §11.3).
insert into storage_deletions (bucket, path, staff_id)
  values ('photos', 'rls-probe/selfie.jpg', :'staffa');
insert into event_documents (event_id, kind, storage_path, file_name, row_count, page_count)
  values (:'event_a', 'allocation', :'event_a' || '/allocation/rls-probe.pdf', 'RLS probe.pdf', 1, 1);

-- A cap-band notice to probe for. Created here rather than in the shared
-- fixtures on purpose: 200_compliance_daily runs compliance_daily() over
-- the whole table and counts the N14 sends, so a standing row for a
-- fixture worker would change what that file measures.
insert into cap_band_notices (staff_id, band, cap_hours, notified_on)
  values (:'staffa', 'standard_48', 48, current_date - 1);

select set_config('request.jwt.claims', '', true);
set local role anon;

select is((select count(*)::int from profiles              where id in (:'admin_uid', :'staffa_uid')),       0, 'anon reads no profiles');
select is((select count(*)::int from staff                 where id in (:'staffa', :'staffb')),              0, 'anon reads no staff');
select is((select count(*)::int from events                where id in (:'event_a', :'event_b')),            0, 'anon reads no events');
select is((select count(*)::int from shift_requirements    where id in (:'shift_a', :'shift_b')),            0, 'anon reads no role sections');
select is((select count(*)::int from bookings              where id in (:'booking_a', :'booking_b')),        0, 'anon reads no bookings');
select is((select count(*)::int from compliance_docs       where id in (:'doc_a', :'doc_b')),                0, 'anon reads no compliance docs');
select is((select count(*)::int from criminal_declarations where id in (:'decl_a', :'decl_b')),              0, 'anon reads no criminal declarations');
select is((select count(*)::int from check_logs            where id in (:'checklog_a', :'checklog_b')),      0, 'anon reads no check logs');
select is((select count(*)::int from breaks                where id in (:'break_a', :'break_b')),            0, 'anon reads no breaks');
select is((select count(*)::int from violations            where id in (:'violation_a', :'violation_b')),    0, 'anon reads no violations');
select is((select count(*)::int from feedback              where id in (:'feedback_a', :'feedback_b')),      0, 'anon reads no feedback');
select is((select count(*)::int from clients               where id in (:'clienta', :'clientb')),            0, 'anon reads no clients');
select is((select count(*)::int from venues                where id = :'venue_id'),                          0, 'anon reads no venues');
select is((select count(*)::int from roles                 where id = :'role_id'),                           0, 'anon reads no roles');
select is((select count(*)::int from client_rate_cards     where id = :'ratecard_a'),                        0, 'anon reads no rate cards');
select is((select count(*)::int from settings              where key = 'rls_fixture_probe'),                 0, 'anon reads no settings');
select is((select count(*)::int from notification_outbox   where key = 'RLS:fixture:outbox'),                0, 'anon reads no notification outbox');
-- the eleven tables 0004_rls_gaps closed: before it, every one of these
-- returned its rows to a logged-out caller through PostgREST.
select is((select count(*)::int from bank_details          where staff_id in (:'staffa', :'staffb')),       0, 'anon reads no bank details');
select is((select count(*)::int from hmrc_checklists       where staff_id in (:'staffa', :'staffb')),       0, 'anon reads no HMRC checklists');
select is((select count(*)::int from staff_references      where id in (:'ref_a', :'ref_b')),               0, 'anon reads no staff references');
select is((select count(*)::int from staff_roles           where staff_id in (:'staffa', :'staffb')),       0, 'anon reads no role qualifications');
select is((select count(*)::int from client_qualifications where id in (:'qual_a', :'qual_b')),             0, 'anon reads no client clearances');
select is((select count(*)::int from quiz_attempts         where id in (:'quiz_a', :'quiz_b')),             0, 'anon reads no quiz attempts');
select is((select count(*)::int from push_subscriptions    where id in (:'push_a', :'push_b')),             0, 'anon reads no push subscriptions');
select is((select count(*)::int from location_pings        where booking_id in (:'booking_a', :'booking_b')), 0, 'anon reads no location pings');
select is((select count(*)::int from audit_log             where action = 'rls_fixture_probe'),             0, 'anon reads no audit log');
select is((select count(*)::int from report_sends          where error  = 'rls_fixture_probe'),             0, 'anon reads no report sends');
-- anon WRITES here, through submit_application (§2.1), and reads nothing back.
select is((select count(*)::int from applications          where id = :'applic_a'),                        0, 'anon reads no applications, though the public form writes them');
select is((select count(*)::int from venue_types           where key = 'rls_fixture_type'),                 0, 'anon reads no venue types: venue_types_read needs a profile, and anon has none');
-- cap_band_notices and staff_transitions: RLS from the day each landed,
-- and no per-role test until now. staff_transitions is the one worth
-- reading twice — its policy is `current_app_role() is not null`, and its
-- own migration explains that the obvious alternative spelling,
-- `auth.role() is not null`, is never null for a logged-out caller and
-- would have published the §2.12 machine to the world. This is the
-- assertion that would have caught it.
select is((select count(*)::int from cap_band_notices where staff_id = :'staffa'), 0, 'anon reads no cap-band notices');
select is((select count(*)::int from staff_transitions where from_status = 'compliant'), 0,
  'anon reads no staff_transitions: current_app_role() is null without a profile, which is what keeps the reference-data policy shut to the world');
select throws_ok(
  format($$ insert into cap_band_notices (staff_id, band, cap_hours, notified_on)
            values (%L, 'uncapped', null, current_date) $$, :'staffb'),
  '42501', null, 'anon cannot forge a cap-band notice');
select throws_ok(
  $$ insert into staff_transitions (from_status, to_status) values ('compliant','documents') $$,
  '42501', null, 'anon cannot add an edge to the staff state machine');

-- 0009 took back the default grants on event_windows. It runs with owner
-- rights over the money-bearing shift_requirements table, so a world grant
-- on it handed every event's timings to a logged-out caller (§11.1).
select throws_ok(
  $$ select count(*) from event_windows $$,
  '42501', null, 'anon holds no privilege on event_windows: it reads shift_requirements with owner rights');

-- All three client views run with the owner's rights (ADR-0004; 0009 brought
-- client_events_v into line), so they are not merely empty for anon: the
-- privilege itself is revoked and the attempt fails rather than returning
-- nothing. Anything that runs with the owner's rights must not depend on
-- auth.uid() being null to stay shut.
select throws_ok(
  $$ select count(*) from client_events_v $$,
  '42501', null, 'anon holds no privilege at all on client_events_v');
select throws_ok(
  $$ select count(*) from client_lineup_v $$,
  '42501', null, 'anon holds no privilege at all on client_lineup_v');
select throws_ok(
  $$ select count(*) from client_role_sections_v $$,
  '42501', null, 'anon holds no privilege at all on client_role_sections_v');

select throws_ok(
  $$ insert into staff (first_name, last_name, email, phone, dob)
     values ('Anon','Applicant','anon@rls.test','+447700900097', date '1990-01-01') $$,
  '42501', null, 'anon cannot self-register a staff row (the public /apply flow must go through an RPC or Edge Function)');
select throws_ok(
  format($$ insert into feedback (author_kind, staff_id, event_id, rating) values ('client', %L, %L, 5) $$, :'staffa', :'event_a'),
  '42501', null, 'anon cannot write feedback');
select throws_ok(
  format($$ insert into bank_details (staff_id, account_holder, sort_code, account_number)
            values (%L, 'Mallory', '00-00-00', '00000000') $$, :'staffa'),
  '42501', null, 'anon cannot write bank details');
select throws_ok(
  format($$ insert into push_subscriptions (staff_id, endpoint, p256dh, auth)
            values (%L, 'https://push.rls.test/anon', 'p', 'a') $$, :'staffa'),
  '42501', null, 'anon cannot register a push endpoint');
select throws_ok(
  $$ insert into audit_log (action, entity) values ('forged','staff') $$,
  '42501', null, 'anon cannot write the audit log');
with u as (update settings set value = '{}' where key = 'rls_fixture_probe' returning 1)
  select is((select count(*)::int from u), 0, 'anon cannot update settings');
with u as (update bank_details set sort_code = '00-00-00' where staff_id = :'staffa' returning 1)
  select is((select count(*)::int from u), 0, 'anon cannot change a worker''s bank details');
with u as (update venue_types set default_radius_m = 999 where key = 'rls_fixture_type' returning 1)
  select is((select count(*)::int from u), 0, 'anon cannot edit venue type defaults');

-- The operational tables (§1.7 erasure queue, §7 jobs, §2.1 form, §11.3
-- document copies): admin-read, service-role-write, nothing for anon.
select is((select count(*)::int from storage_deletions where path = 'rls-probe/selfie.jpg'), 0,
  'anon reads no erasure queue: it names removed workers'' passport and selfie paths');
select throws_ok(
  format($$ insert into storage_deletions (bucket, path, staff_id) values ('photos', 'forged/x.jpg', %L) $$, :'staffa'),
  '42501', null, 'anon cannot forge a deletion');
select is((select count(*)::int from job_runs), 0, 'anon reads no job runs (their error text is operational detail)');
select is((select count(*)::int from job_schedules), 0, 'anon reads no cron registry');
select throws_ok(
  $$ insert into job_runs (job) values ('x') $$,
  '42501', null, 'anon cannot write a job run');
select throws_ok(
  $$ insert into applications (first_name, last_name, email, phone, dob, age_band, consented_at)
     values ('Forged', 'Row', 'forged@rls.test', '+447700900998', date '1990-01-01', '25-34', now()) $$,
  '42501', null, '§2.1: anon cannot POST an application row and skip submit_application()''s throttle and DOB match');
select is((select count(*)::int from event_documents where file_name = 'RLS probe.pdf'), 0,
  'anon reads no event_documents row: a timesheet path carries names and pay lines (§11.3)');
select throws_ok(
  format($$ insert into event_documents (event_id, kind, storage_path, file_name, row_count, page_count)
            values (%L, 'timesheet', 'forged/t.pdf', 'Forged.pdf', 1, 1) $$, :'event_a'),
  '42501', null, 'anon cannot register a document copy');

reset role;
select * from finish();
rollback;
