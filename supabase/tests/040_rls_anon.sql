-- =====================================================================
-- 040 · RLS for anonymous (logged-out) callers
-- Nothing in the schema is public. Every RLS-enabled table and every
-- client-facing view must be empty for the `anon` PostgREST role.
-- =====================================================================
begin;
select plan(38);
\ir _shared/fixtures.psql

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
select is((select count(*)::int from venue_types           where key = 'rls_fixture_type'),                 0, 'anon reads no venue types: venue_types_read needs a profile, and anon has none');

select is((select count(*)::int from client_events_v       where id in (:'event_a', :'event_b')),            0, 'anon reads no client_events_v');
select is((select count(*)::int from client_lineup_v       where booking_id in (:'booking_a', :'booking_b')),0, 'anon reads no client_lineup_v');

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

reset role;
select * from finish();
rollback;
