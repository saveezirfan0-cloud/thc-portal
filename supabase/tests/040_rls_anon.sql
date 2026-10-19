-- =====================================================================
-- 040 · RLS for anonymous (logged-out) callers
-- Nothing in the schema is public. Every RLS-enabled table and every
-- client-facing view must be empty for the `anon` PostgREST role.
--
-- Since 20261020120200 (ADR-0163, security review L4) that is no longer
-- RLS's job alone: anon holds no privilege on any table, view or sequence
-- in public, so each read below fails with 42501 instead of returning an
-- empty set, and section Z pins the grant itself — the whole catalog, not
-- a list — together with the default privileges that would otherwise hand
-- the next table back to anon.
-- =====================================================================
begin;
select plan(58);
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

select throws_ok(format($$ select count(*) from profiles              where id in (%L, %L) $$, :'admin_uid', :'staffa_uid'), '42501', null,
  'anon reads no profiles');
select throws_ok(format($$ select count(*) from staff                 where id in (%L, %L) $$, :'staffa', :'staffb'), '42501', null,
  'anon reads no staff');
select throws_ok(format($$ select count(*) from events                where id in (%L, %L) $$, :'event_a', :'event_b'), '42501', null,
  'anon reads no events');
select throws_ok(format($$ select count(*) from shift_requirements    where id in (%L, %L) $$, :'shift_a', :'shift_b'), '42501', null,
  'anon reads no role sections');
select throws_ok(format($$ select count(*) from bookings              where id in (%L, %L) $$, :'booking_a', :'booking_b'), '42501', null,
  'anon reads no bookings');
select throws_ok(format($$ select count(*) from compliance_docs       where id in (%L, %L) $$, :'doc_a', :'doc_b'), '42501', null,
  'anon reads no compliance docs');
select throws_ok(format($$ select count(*) from criminal_declarations where id in (%L, %L) $$, :'decl_a', :'decl_b'), '42501', null,
  'anon reads no criminal declarations');
select throws_ok(format($$ select count(*) from check_logs            where id in (%L, %L) $$, :'checklog_a', :'checklog_b'), '42501', null,
  'anon reads no check logs');
select throws_ok(format($$ select count(*) from breaks                where id in (%L, %L) $$, :'break_a', :'break_b'), '42501', null,
  'anon reads no breaks');
select throws_ok(format($$ select count(*) from violations            where id in (%L, %L) $$, :'violation_a', :'violation_b'), '42501', null,
  'anon reads no violations');
select throws_ok(format($$ select count(*) from feedback              where id in (%L, %L) $$, :'feedback_a', :'feedback_b'), '42501', null,
  'anon reads no feedback');
select throws_ok(format($$ select count(*) from clients               where id in (%L, %L) $$, :'clienta', :'clientb'), '42501', null,
  'anon reads no clients');
select throws_ok(format($$ select count(*) from venues                where id = %L $$, :'venue_id'), '42501', null,
  'anon reads no venues');
select throws_ok(format($$ select count(*) from roles                 where id = %L $$, :'role_id'), '42501', null,
  'anon reads no roles');
select throws_ok(format($$ select count(*) from client_rate_cards     where id = %L $$, :'ratecard_a'), '42501', null,
  'anon reads no rate cards');
select throws_ok($$ select count(*) from settings              where key = 'rls_fixture_probe' $$, '42501', null,
  'anon reads no settings');
select throws_ok($$ select count(*) from notification_outbox   where key = 'RLS:fixture:outbox' $$, '42501', null,
  'anon reads no notification outbox');
-- the eleven tables 0004_rls_gaps closed: before it, every one of these
-- returned its rows to a logged-out caller through PostgREST.
select throws_ok(format($$ select count(*) from bank_details          where staff_id in (%L, %L) $$, :'staffa', :'staffb'), '42501', null,
  'anon reads no bank details');
select throws_ok(format($$ select count(*) from hmrc_checklists       where staff_id in (%L, %L) $$, :'staffa', :'staffb'), '42501', null,
  'anon reads no HMRC checklists');
select throws_ok(format($$ select count(*) from staff_references      where id in (%L, %L) $$, :'ref_a', :'ref_b'), '42501', null,
  'anon reads no staff references');
select throws_ok(format($$ select count(*) from staff_roles           where staff_id in (%L, %L) $$, :'staffa', :'staffb'), '42501', null,
  'anon reads no role qualifications');
select throws_ok(format($$ select count(*) from client_qualifications where id in (%L, %L) $$, :'qual_a', :'qual_b'), '42501', null,
  'anon reads no client clearances');
select throws_ok(format($$ select count(*) from quiz_attempts         where id in (%L, %L) $$, :'quiz_a', :'quiz_b'), '42501', null,
  'anon reads no quiz attempts');
select throws_ok(format($$ select count(*) from push_subscriptions    where id in (%L, %L) $$, :'push_a', :'push_b'), '42501', null,
  'anon reads no push subscriptions');
select throws_ok(format($$ select count(*) from location_pings        where booking_id in (%L, %L) $$, :'booking_a', :'booking_b'), '42501', null,
  'anon reads no location pings');
select throws_ok($$ select count(*) from audit_log             where action = 'rls_fixture_probe' $$, '42501', null,
  'anon reads no audit log');
select throws_ok($$ select count(*) from report_sends          where error  = 'rls_fixture_probe' $$, '42501', null,
  'anon reads no report sends');
-- anon WRITES here, through submit_application (§2.1), and reads nothing back.
select throws_ok(format($$ select count(*) from applications          where id = %L $$, :'applic_a'), '42501', null,
  'anon reads no applications, though the public form writes them');
select throws_ok($$ select count(*) from venue_types           where key = 'rls_fixture_type' $$, '42501', null,
  'anon reads no venue types: venue_types_read needs a profile, and anon has none');
-- cap_band_notices and staff_transitions: RLS from the day each landed,
-- and no per-role test until now. staff_transitions is the one worth
-- reading twice — its policy is `current_app_role() is not null`, and its
-- own migration explains that the obvious alternative spelling,
-- `auth.role() is not null`, is never null for a logged-out caller and
-- would have published the §2.12 machine to the world. This is the
-- assertion that would have caught it.
select throws_ok(format($$ select count(*) from cap_band_notices where staff_id = %L $$, :'staffa'), '42501', null,
  'anon reads no cap-band notices');
select throws_ok($$ select count(*) from staff_transitions where from_status = 'compliant' $$, '42501', null,
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
select throws_ok($$ update settings set value = '{}' where key = 'rls_fixture_probe' $$,
  '42501', null, 'anon cannot update settings');
select throws_ok(format($$ update bank_details set sort_code = '00-00-00' where staff_id = %L $$, :'staffa'),
  '42501', null, 'anon cannot change a worker''s bank details');
select throws_ok($$ update venue_types set default_radius_m = 999 where key = 'rls_fixture_type' $$,
  '42501', null, 'anon cannot edit venue type defaults');

-- The operational tables (§1.7 erasure queue, §7 jobs, §2.1 form, §11.3
-- document copies): admin-read, service-role-write, nothing for anon.
select throws_ok($$ select count(*) from storage_deletions where path = 'rls-probe/selfie.jpg' $$, '42501', null,
  'anon reads no erasure queue: it names removed workers'' passport and selfie paths');
select throws_ok(
  format($$ insert into storage_deletions (bucket, path, staff_id) values ('photos', 'forged/x.jpg', %L) $$, :'staffa'),
  '42501', null, 'anon cannot forge a deletion');
select throws_ok($$ select count(*) from job_runs $$, '42501', null,
  'anon reads no job runs (their error text is operational detail)');
select throws_ok($$ select count(*) from job_schedules $$, '42501', null,
  'anon reads no cron registry');
select throws_ok(
  $$ insert into job_runs (job) values ('x') $$,
  '42501', null, 'anon cannot write a job run');
select throws_ok(
  $$ insert into applications (first_name, last_name, email, phone, dob, age_band, consented_at)
     values ('Forged', 'Row', 'forged@rls.test', '+447700900998', date '1990-01-01', '25-34', now()) $$,
  '42501', null, '§2.1: anon cannot POST an application row and skip submit_application()''s throttle and DOB match');
select throws_ok($$ select count(*) from event_documents where file_name = 'RLS probe.pdf' $$, '42501', null,
  'anon reads no event_documents row: a timesheet path carries names and pay lines (§11.3)');
select throws_ok(
  format($$ insert into event_documents (event_id, kind, storage_path, file_name, row_count, page_count)
            values (%L, 'timesheet', 'forged/t.pdf', 'Forged.pdf', 1, 1) $$, :'event_a'),
  '42501', null, 'anon cannot register a document copy');

reset role;

-- =====================================================================
-- Z · The grant itself (ADR-0163, security review L4)
--
-- Supabase's default privileges give anon full DML on every table it
-- creates in public. 20261020120200 took all of it back and changed the
-- default; these pin the result over the whole catalog, so a table, view
-- or sequence added later with anon's privilege fails here by name.
-- PostGIS's own relations (extension members) are not ours: they carry
-- PostGIS's grant to PUBLIC and belong to supabase_admin on the live
-- project (ADR-0131).
-- =====================================================================
select is_empty(
  $$ select c.relname::text
       from pg_class c
      where c.relnamespace = 'public'::regnamespace
        and c.relkind in ('r', 'p', 'v', 'm', 'f')
        and not exists (select 1 from pg_depend d
                         where d.classid = 'pg_class'::regclass and d.objid = c.oid and d.deptype = 'e')
        and has_table_privilege('anon', c.oid, 'select, insert, update, delete, truncate, references, trigger') $$,
  'anon holds no privilege on any table or view in public: RLS is no longer the only wall');
select is_empty(
  $$ select c.relname::text || '.' || a.attname::text
       from pg_class c join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
      where c.relnamespace = 'public'::regnamespace
        and c.relkind in ('r', 'p', 'v', 'm', 'f')
        and not exists (select 1 from pg_depend d
                         where d.classid = 'pg_class'::regclass and d.objid = c.oid and d.deptype = 'e')
        and has_column_privilege('anon', c.oid, a.attnum, 'select, insert, update, references') $$,
  'nor on any column of one (the by-name grants on staff went with it)');
select is_empty(
  $$ select c.relname::text from pg_class c
      where c.relnamespace = 'public'::regnamespace
        and case when c.relkind = 'S' then has_sequence_privilege('anon', c.oid, 'usage, select, update') end $$,
  'nor on any sequence in public');
select is_empty(
  $$ select d.defaclobjtype::text
       from pg_default_acl d, aclexplode(d.defaclacl) x
      where d.defaclrole = 'postgres'::regrole
        and d.defaclnamespace = 'public'::regnamespace
        and d.defaclobjtype in ('r', 'S')
        and x.grantee = 'anon'::regrole $$,
  'and the migration role''s default privileges in public no longer hand anon the next table or sequence');
create table public.t040_default_probe (id int);
select ok(not has_table_privilege('anon', 'public.t040_default_probe', 'select, insert, update, delete, truncate'),
  'proved on a table created now: anon gets nothing on it');

select * from finish();
rollback;
