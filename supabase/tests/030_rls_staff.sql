-- =====================================================================
-- 030 · RLS for the staff role (Staff PWA) — §1.4, §10.x
--
-- The rule under test: a worker may only ever reach their OWN rows in
-- staff, bookings, compliance_docs, check_logs, breaks, violations and
-- criminal_declarations, and never another worker's anything, never a
-- charge rate and never internal configuration.
--
-- Where 0001_init.sql has no worker policy at all the table is deny-all;
-- those assertions are marked KNOWN GAP and are listed in the Phase 0
-- report. They are expected to be replaced by `security definer` RPCs
-- (attempt_check_in, accept_invite, …) rather than by direct table policies.
-- =====================================================================
begin;
select plan(40);
\ir _shared/fixtures.psql

select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
set local role authenticated;

-- ---- own rows, and only own rows --------------------------------------
select is((select count(*)::int from staff where id = :'staffa'), 1, 'worker reads their own staff row');
select is((select count(*)::int from staff where id = :'staffb'), 0, 'worker cannot read another worker''s staff row');
select is((select count(*)::int from bookings where id = :'booking_a'), 1, 'worker reads their own booking');
select is((select count(*)::int from bookings where id = :'booking_b'), 0, 'worker cannot read another worker''s booking');
select is((select count(*)::int from compliance_docs where id = :'doc_a'), 1, 'worker reads their own compliance docs');
select is((select count(*)::int from compliance_docs where id = :'doc_b'), 0, 'worker cannot read another worker''s compliance docs');
select is((select count(*)::int from criminal_declarations where id = :'decl_a'), 1, 'worker reads their own criminal declaration');
select is((select count(*)::int from criminal_declarations where id = :'decl_b'), 0, 'worker cannot read another worker''s criminal declaration');
select is((select count(*)::int from profiles where id = :'staffa_uid'), 1, 'worker reads their own profile');
select is((select count(*)::int from profiles where id in (:'staffb_uid', :'admin_uid', :'clienta_uid')), 0, 'worker cannot read other profiles');

-- ---- own rows that are unreachable today (deny-all) --------------------
select is((select count(*)::int from check_logs where id = :'checklog_a'), 0,
  'KNOWN GAP: check_logs has admin_all only — a worker cannot read their own check-in');
select is((select count(*)::int from breaks where id = :'break_a'), 0,
  'KNOWN GAP: breaks has admin_all only — a worker cannot read their own break');
select is((select count(*)::int from violations where id = :'violation_a'), 0,
  'KNOWN GAP: violations has admin_all only — a worker cannot read their own violation');
select is((select count(*)::int from events where id = :'event_a'), 0,
  'KNOWN GAP: events has no worker policy — the PWA cannot read the event behind its own booking');
select is((select count(*)::int from shift_requirements where id = :'shift_a'), 0,
  'KNOWN GAP: shift_requirements has no worker policy — the PWA cannot read its own role window (RULE-18)');
select is((select count(*)::int from roles where id = :'role_id'), 0,
  'KNOWN GAP: roles has admin_all only — a worker cannot read the role name; it also keeps pay_rate out of reach');

-- ---- the tables 0004_rls_gaps policed, own row only --------------------
select is((select count(*)::int from bank_details where staff_id = :'staffa'), 1,
  'worker reads their own bank details (§10.1 Payment information)');
select is((select count(*)::int from bank_details where staff_id = :'staffb'), 0,
  'another worker''s bank details are invisible — sort code and account number never leave their owner');
select is((select count(*)::int from staff_references where id = :'ref_a'), 1, 'worker reads their own referees');
select is((select count(*)::int from staff_references where id = :'ref_b'), 0, 'worker cannot read another worker''s referees');
select is((select count(*)::int from staff_roles where staff_id = :'staffa'), 1, 'worker reads their own role qualifications');
select is((select count(*)::int from staff_roles where staff_id = :'staffb'), 0, 'worker cannot read another worker''s role qualifications');
select is((select count(*)::int from quiz_attempts where id = :'quiz_a'), 1, 'worker reads their own quiz attempt');
select is((select count(*)::int from quiz_attempts where id = :'quiz_b'), 0, 'worker cannot read another worker''s quiz attempt');
select is((select count(*)::int from push_subscriptions where id = :'push_a'), 1, 'worker reads their own push subscription');
select is((select count(*)::int from push_subscriptions where id = :'push_b'), 0, 'worker cannot read another worker''s push subscription');
select is((select count(*)::int from location_pings where booking_id = :'booking_a'), 1, 'worker reads their own location trail');
select is((select count(*)::int from location_pings where booking_id = :'booking_b'), 0, 'worker cannot read another worker''s location trail');
select is((select count(*)::int from venue_types where key = 'rls_fixture_type'), 1,
  'worker may read venue_types reference data (§9.11) — no money, no personal data');

-- §2.8: the derived A/B/C statement lives on this row and "the worker never
-- sees the resulting letter", so the worker holds no policy at all here and
-- submission goes through a security definer RPC (see 0004).
select is((select count(*)::int from hmrc_checklists where staff_id = :'staffa'), 0,
  '§2.8 worker cannot read even their OWN HMRC checklist — the row carries the derived statement');
select is((select count(*)::int from hmrc_checklists where staff_id = :'staffb'), 0,
  'worker cannot read another worker''s HMRC checklist');

-- ---- things a worker must never reach ---------------------------------
select is((select count(*)::int from client_qualifications where staff_id in (:'staffa', :'staffb')), 0,
  'worker cannot read client+role clearances — it would leak the client directory into the PWA (§9.6)');
select is((select count(*)::int from audit_log where action = 'rls_fixture_probe'), 0, 'worker cannot read the audit log');
select is((select count(*)::int from report_sends where error = 'rls_fixture_probe'), 0, 'worker cannot read the report send log');
select is((select count(*)::int from client_rate_cards where id = :'ratecard_a'), 0, 'worker cannot read charge rates');
select is((select count(*)::int from clients where id = :'clienta'), 0, 'worker cannot read the client directory');
select is((select count(*)::int from venues where id = :'venue_id'), 0, 'worker cannot read the venue directory');
select is((select count(*)::int from settings where key = 'rls_fixture_probe'), 0, 'worker cannot read settings');
select is((select count(*)::int from feedback where id = :'feedback_a'), 0, 'worker cannot read feedback written about them');
select is((select count(*)::int from notification_outbox where key = 'RLS:fixture:outbox'), 0, 'worker cannot read the notification outbox');
select is((select count(*)::int from client_lineup_v where booking_id in (:'booking_a', :'booking_b')), 0, 'worker cannot read the client line-up view');
select is((select count(*)::int from client_events_v where id in (:'event_a', :'event_b')), 0, 'worker cannot read the client events view');

-- ---- writes ------------------------------------------------------------
with u as (update staff set phone = '+447700900999' where id = :'staffa' returning 1)
  select is((select count(*)::int from u), 0, 'KNOWN GAP: worker cannot update their own staff row (select-only policy)');
with u as (update staff set status = 'compliant' where id = :'staffb' returning 1)
  select is((select count(*)::int from u), 0, 'worker cannot update another worker''s staff row');
with u as (update bookings set status = 'confirmed', confirmed_at = now() where id = :'booking_a' returning 1)
  select is((select count(*)::int from u), 0, 'KNOWN GAP: worker cannot accept their own booking directly (needs a definer RPC)');
with u as (delete from bookings where id = :'booking_a' returning 1)
  select is((select count(*)::int from u), 0, 'worker cannot delete their own booking');
with u as (update settings set value = '{}' where key = 'rls_fixture_probe' returning 1)
  select is((select count(*)::int from u), 0, 'worker cannot update settings');

select throws_ok(
  $$ insert into staff (first_name, last_name, email, phone, dob)
     values ('Fake','Worker','fake@rls.test','+447700900098', date '1990-01-01') $$,
  '42501', null, 'worker cannot create a staff row');
select throws_ok(
  format($$ insert into check_logs (booking_id, outcome) values (%L, 'checked_in') $$, :'booking_a'),
  '42501', null, 'KNOWN GAP: worker cannot insert their own check-in (needs attempt_check_in RPC)');
select throws_ok(
  format($$ insert into breaks (booking_id, started_at) values (%L, now()) $$, :'booking_a'),
  '42501', null, 'KNOWN GAP: worker cannot start their own break directly');
select throws_ok(
  format($$ insert into violations (staff_id, booking_id, type) values (%L, %L, 'late') $$, :'staffa', :'booking_a'),
  '42501', null, 'worker cannot write a violation');
select throws_ok(
  format($$ insert into compliance_docs (staff_id, doc_type, file_path) values (%L, 'passport', 'documents/x.pdf') $$, :'staffa'),
  '42501', null, 'KNOWN GAP: worker cannot upload their own document directly');
select throws_ok(
  format($$ insert into criminal_declarations (staff_id, source, answer) values (%L, 'in_employment', true) $$, :'staffa'),
  '42501', null, 'KNOWN GAP: worker cannot record an in-employment declaration directly (RULE-21 RPC)');
select throws_ok(
  format($$ insert into feedback (author_kind, staff_id, event_id, rating) values ('office', %L, %L, 5) $$, :'staffa', :'event_a'),
  '42501', null, 'worker cannot write feedback about themselves');

-- ---- symmetry: the second worker sees only their own rows ---------------
reset role;
select set_config('request.jwt.claims', json_build_object('sub', :'staffb_uid', 'role', 'authenticated')::text, true);
set local role authenticated;

select is((select count(*)::int from staff where id = :'staffb'), 1, 'second worker reads their own staff row');
select is((select count(*)::int from staff where id = :'staffa'), 0, 'second worker cannot read the first worker''s staff row');
select is((select count(*)::int from bookings where id = :'booking_b'), 1, 'second worker reads their own booking');
select is((select count(*)::int from bookings where id = :'booking_a'), 0, 'second worker cannot read the first worker''s booking');

reset role;
select * from finish();
rollback;
