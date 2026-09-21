-- =====================================================================
-- 020 · RLS for the client role (Client Portal) — §11.1, §11.2
--
-- §11.1 is the hard rule this file exists for: "The client role only. They
-- see only their own events. Read-only — no editing whatsoever. No money
-- anywhere: no pay rates, no charge rates, no margin."
-- Every money-bearing table is asserted unreachable, in both directions.
-- =====================================================================
begin;
select plan(49);
\ir _shared/fixtures.psql

select set_config('request.jwt.claims', json_build_object('sub', :'clienta_uid', 'role', 'authenticated')::text, true);
set local role authenticated;

-- ---- own events, and only own events ---------------------------------
select is((select count(*)::int from events where id = :'event_a'), 1, 'client reads its own event');
select is((select count(*)::int from events where id = :'event_b'), 0, 'client cannot read another client''s event');
select is((select count(*)::int from profiles where id = :'clienta_uid'), 1, 'client reads its own profile');
select is((select count(*)::int from profiles where id in (:'clientb_uid', :'staffa_uid', :'admin_uid')), 0, 'client cannot read other profiles');

-- ---- NO MONEY (§11.1) -------------------------------------------------
select is((select count(*)::int from roles where id = :'role_id'), 0,
  '§11.1 client cannot read roles (pay_rate)');
select is((select count(*)::int from client_rate_cards where id = :'ratecard_a'), 0,
  '§11.1 client cannot read its own rate card (charge_rate)');
select is((select count(*)::int from shift_requirements where id in (:'shift_a', :'shift_b')), 0,
  '§11.1 client cannot read shift_requirements (charge_rate + pay_rate) — enforced by 0002');
select is((select count(*)::int from bookings where id in (:'booking_a', :'booking_b')), 0,
  '§11.1 client cannot read bookings');
select is((select count(*)::int from check_logs where id in (:'checklog_a', :'checklog_b')), 0,
  '§11.1 client cannot read check logs (payable window inputs)');
select is((select count(*)::int from breaks where id in (:'break_a', :'break_b')), 0,
  '§11.1 client cannot read breaks (unpaid break deductions)');
select is((select count(*)::int from violations where id in (:'violation_a', :'violation_b')), 0,
  'client cannot read violations');

-- ---- worker personal data ---------------------------------------------
select is((select count(*)::int from staff where id in (:'staffa', :'staffb')), 0, 'client cannot read the staff table');
select is((select count(*)::int from compliance_docs where id in (:'doc_a', :'doc_b')), 0, 'client cannot read compliance documents');
select is((select count(*)::int from criminal_declarations where id in (:'decl_a', :'decl_b')), 0, 'client cannot read criminal declarations');

-- ---- payroll data: the two tables 0004 was written for ----------------
select is((select count(*)::int from bank_details where staff_id in (:'staffa', :'staffb')), 0,
  '§11.1/§1.7 a client cannot read bank_details — sort code and account number are the worker''s money and the worker''s personal data');
select is((select count(*)::int from hmrc_checklists where staff_id in (:'staffa', :'staffb')), 0,
  '§11.1/§1.7 a client cannot read hmrc_checklists — tax status is personal data');

-- ---- the rest of what 0004_rls_gaps policed ---------------------------
select is((select count(*)::int from staff_references where id in (:'ref_a', :'ref_b')), 0,
  'client cannot read a worker''s referees');
select is((select count(*)::int from staff_roles where staff_id in (:'staffa', :'staffb')), 0,
  'client cannot read role qualifications');
select is((select count(*)::int from client_qualifications where id = :'qual_a'), 0,
  'client cannot read even its OWN client+role clearances — the list names workers (§9.6 is a back-office screen)');
select is((select count(*)::int from client_qualifications where id = :'qual_b'), 0,
  'client cannot read another client''s clearances');
select is((select count(*)::int from quiz_attempts where id in (:'quiz_a', :'quiz_b')), 0,
  'client cannot read quiz attempts');
select is((select count(*)::int from push_subscriptions where id in (:'push_a', :'push_b')), 0,
  'client cannot read push subscriptions');
select is((select count(*)::int from location_pings where booking_id in (:'booking_a', :'booking_b')), 0,
  'client cannot read a worker''s location trail');
select is((select count(*)::int from audit_log where action = 'rls_fixture_probe'), 0,
  'client cannot read the audit log');
select is((select count(*)::int from report_sends where error = 'rls_fixture_probe'), 0,
  'client cannot read the report send log (payroll periods)');

-- venue_types is the one thing 0004 opened to every signed-in role: nine
-- rows of label + default radius, no money and no personal data (§9.11).
select is((select count(*)::int from venue_types where key = 'rls_fixture_type'), 1,
  'client may read venue_types reference data — no money, no personal data');
with u as (update venue_types set default_radius_m = 999 where key = 'rls_fixture_type' returning 1)
  select is((select count(*)::int from u), 0, 'client cannot edit venue_types (read-only, §11.1)');

-- ---- internal configuration -------------------------------------------
select is((select count(*)::int from settings where key = 'rls_fixture_probe'), 0, 'client cannot read settings');
select is((select count(*)::int from venues where id = :'venue_id'), 0, 'client cannot read the venue directory');
select is((select count(*)::int from notification_outbox where key = 'RLS:fixture:outbox'), 0, 'client cannot read the notification outbox');
select is((select count(*)::int from clients where id = :'clienta'), 0,
  'KNOWN GAP: clients has admin_all only, so a client cannot read even its own company record');
select is((select count(*)::int from feedback where id = :'feedback_a'), 0,
  'client cannot read feedback back (insert-only policy)');

-- ---- client-safe views -------------------------------------------------
select is((select count(*)::int from client_events_v where id = :'event_a'), 1, 'client_events_v returns the client''s own event');
select is((select count(*)::int from client_events_v where id = :'event_b'), 0, 'client_events_v hides other clients'' events');
select is((select count(*)::int from client_lineup_v where booking_id = :'booking_a'), 0,
  'KNOWN GAP: client_lineup_v is security_invoker over bookings/staff/roles, where the client has no policy, so §11.2 line-up is empty');

-- ---- read-only (§11.1 "no editing whatsoever") -------------------------
with u as (update events set notes = 'client edit' where id = :'event_a' returning 1)
  select is((select count(*)::int from u), 0, 'client cannot update its own event');
with u as (update clients set name = 'renamed' where id = :'clienta' returning 1)
  select is((select count(*)::int from u), 0, 'client cannot update its own company record');
with u as (update settings set value = '{}' where key = 'rls_fixture_probe' returning 1)
  select is((select count(*)::int from u), 0, 'client cannot update settings');
with u as (update shift_requirements set headcount = 99 where id = :'shift_a' returning 1)
  select is((select count(*)::int from u), 0, 'client cannot update a role section');
with u as (delete from events where id = :'event_a' returning 1)
  select is((select count(*)::int from u), 0, 'client cannot delete its own event');

select throws_ok(
  format($$ insert into events (client_id, venue_name, venue_address, venue_location, geofence_radius_m,
                                title, event_date, pays_breaks, pays_buffer)
            values (%L, 'X', 'Y', st_setsrid(st_makepoint(-0.1,51.5),4326)::geography, 150, 'Client made this', current_date + 1, true, true) $$,
         :'clienta'),
  '42501', null, 'client cannot create an event');

select throws_ok(
  $$ insert into staff (first_name, last_name, email, phone, dob)
     values ('Mallory','Client','m@rls.test','+447700900099', date '1990-01-01') $$,
  '42501', null, 'client cannot create a worker');

select throws_ok(
  format($$ insert into bookings (shift_id, staff_id, status, source) values (%L, %L, 'confirmed', 'manual') $$,
         :'shift_a', :'staffb'),
  '42501', null, 'client cannot book a worker onto a shift');

select throws_ok(
  format($$ insert into bank_details (staff_id, account_holder, sort_code, account_number)
            values (%L, 'Mallory', '00-00-00', '00000000') $$, :'staffa'),
  '42501', null, 'client cannot write a worker''s bank details');

select throws_ok(
  format($$ insert into client_qualifications (client_id, role_id, staff_id, do_not_return)
            values (%L, %L, %L, true) $$, :'clienta', :'role_id', :'staffb'),
  '42501', null, 'client cannot grant or revoke a clearance itself — do-not-return is a back-office action (§9.6)');

-- ---- feedback is the one thing a client may write (§11.2) --------------
select lives_ok(
  format($$ insert into feedback (author_kind, author_id, staff_id, event_id, rating, text)
            values ('client', %L, %L, %L, 5, 'Great team') $$,
         :'clienta_uid', :'staffa', :'event_a'),
  'client can leave feedback on a worker at its own event');

select throws_ok(
  format($$ insert into feedback (author_kind, author_id, staff_id, event_id, rating, text)
            values ('client', %L, %L, %L, 1, 'Not my event') $$,
         :'clienta_uid', :'staffb', :'event_b'),
  '42501', null, 'client cannot leave feedback on another client''s event');

select throws_ok(
  format($$ insert into feedback (author_kind, author_id, staff_id, event_id, rating, text)
            values ('office', %L, %L, %L, 1, 'Pretending to be the office') $$,
         :'clienta_uid', :'staffa', :'event_a'),
  '42501', null, 'client cannot write office feedback');

with u as (update feedback set rating = 1 where id = :'feedback_a' returning 1)
  select is((select count(*)::int from u), 0, 'client cannot edit feedback once submitted');

reset role;
select * from finish();
rollback;
