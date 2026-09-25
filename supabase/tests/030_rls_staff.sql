-- =====================================================================
-- 030 · RLS for the staff role (Staff PWA) — §1.4, §10.x
--
-- The rule under test: a worker may only ever reach their OWN rows in
-- staff, bookings, compliance_docs, check_logs, breaks and violations, and
-- never another worker's anything, never a charge rate and never internal
-- configuration. criminal_declarations is deny-all for a worker since
-- 20260928110500: their reads go through definer RPCs (§10.7).
--
-- Where 0001_init.sql has no worker policy at all the table is deny-all;
-- those assertions are marked KNOWN GAP and are listed in the Phase 0
-- report. They are expected to be replaced by `security definer` RPCs
-- (attempt_check_in, accept_invite, …) rather than by direct table policies.
--
-- 0004_rls_gaps added the worker's own bank details, referees, push
-- subscriptions (read and write) and their own role qualifications, quiz
-- attempts and location pings (read only — see 0004 for which RPC owes the
-- write). hmrc_checklists is deliberately unreachable in BOTH directions:
-- §2.8 says the worker never sees the derived A/B/C statement.
-- =====================================================================
begin;
select plan(85);
\ir _shared/fixtures.psql

-- A queued erasure to probe for (§1.7): admin-read, service-role-write.
insert into storage_deletions (bucket, path, staff_id)
  values ('photos', 'rls-probe/selfie.jpg', :'staffa');

-- A cap-band notice for the worker under test. Created here rather than in
-- the shared fixtures on purpose: 200_compliance_daily runs
-- compliance_daily() over the whole table and counts the N14 sends, so a
-- standing row for a fixture worker would change what that file measures.
insert into cap_band_notices (staff_id, band, cap_hours, notified_on)
  values (:'staffa', 'standard_48', 48, current_date - 1);

select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
set local role authenticated;

-- ---- own rows, and only own rows --------------------------------------
select is((select count(*)::int from staff where id = :'staffa'), 1, 'worker reads their own staff row');
select is((select count(*)::int from staff where id = :'staffb'), 0, 'worker cannot read another worker''s staff row');
select is((select count(*)::int from bookings where id = :'booking_a'), 1, 'worker reads their own booking');
select is((select count(*)::int from bookings where id = :'booking_b'), 0, 'worker cannot read another worker''s booking');
select is((select count(*)::int from compliance_docs where id = :'doc_a'), 1, 'worker reads their own compliance docs');
select is((select count(*)::int from compliance_docs where id = :'doc_b'), 0, 'worker cannot read another worker''s compliance docs');
-- 20260928110500 (ADR-0031): the worker's row policy on declarations is
-- gone. Every read the app makes is a definer RPC that withholds the text
-- (staff_documents, onboarding_state), so the direct path had one use —
-- reading `details` back — and §10.7 forbids exactly that.
select is((select count(*)::int from criminal_declarations where id = :'decl_a'), 0, 'worker reaches no declaration row directly, their own included — reads go through staff_documents()/onboarding_state(), which withhold the text (§10.7)');
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
select is((select count(*)::int from applications where id = :'applic_a'), 0,
  'worker cannot read applications, not even the one naming their own record — it is the office''s queue (§2.12)');
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
  '42501', null, 'BY DESIGN: a worker writes no check-in directly — attempt_check_in() is the only way in (§5.1)');
select throws_ok(
  format($$ insert into breaks (booking_id, started_at) values (%L, now()) $$, :'booking_a'),
  '42501', null, 'BY DESIGN: a worker writes no break directly — start_break()/finish_break() are the only way in (§5.2b)');
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

-- ---- writes on the tables 0004_rls_gaps policed ------------------------
-- Bank & payroll: §2.10 and §10.1 give the worker the write, but THROUGH
-- staff_save_bank(), which validates and queues E5 in the same transaction.
-- The direct self insert/update policies were dropped in 20260927120100
-- (571 covers the RPC path), so a direct PATCH now touches nothing.
with u as (update bank_details set sort_code = '12-34-56' where staff_id = :'staffa' returning 1)
  select is((select count(*)::int from u), 0, 'worker cannot update their own bank details directly — only through staff_save_bank() (§2.10 E5)');
with u as (update bank_details set sort_code = '00-00-00' where staff_id = :'staffb' returning 1)
  select is((select count(*)::int from u), 0, 'worker cannot change another worker''s bank details');
with u as (delete from bank_details where staff_id = :'staffa' returning 1)
  select is((select count(*)::int from u), 0, 'worker cannot delete their bank details — removal is GDPR, through a definer routine (§1.7)');

-- Two references (§2.10): written through onboarding_save_references(),
-- which validates the pair and checks the stage. The direct self insert
-- and update policies were dropped in 20260930120200, as bank_details'
-- were in 20260927120100, so a direct write touches nothing.
with u as (update staff_references set phone = '+447700900041' where id = :'ref_a' returning 1)
  select is((select count(*)::int from u), 0, 'worker cannot correct a referee directly — only through onboarding_save_references() (§2.10)');
select throws_ok(
  format($$ insert into staff_references (staff_id, name, relationship, phone, email)
            values (%L, 'Referee Charlie', 'Lecturer', '+447700900042', 'ref-c@rls.test') $$, :'staffa'),
  '42501', null, 'worker cannot add a referee of their own directly either (§2.10 step 8/11 is an RPC)');
select throws_ok(
  format($$ insert into staff_references (staff_id, name, relationship, phone, email)
            values (%L, 'Planted', 'Tutor', '+447700900043', 'planted@rls.test') $$, :'staffb'),
  '42501', null, 'worker cannot add a referee to another worker');
with u as (delete from staff_references where id = :'ref_a' returning 1)
  select is((select count(*)::int from u), 0, 'worker cannot delete a referee — two are always required (§2.10)');

-- Push subscriptions (§8): the device registers and deregisters itself
-- through save_push_subscription() / forget_push_subscription() (340).
-- The direct write policy went in 20260930120200; the worker still reads
-- their own rows.
select throws_ok(
  format($$ insert into push_subscriptions (staff_id, endpoint, p256dh, auth)
            values (%L, 'https://push.rls.test/fixture-a2', 'p256dh-a2', 'auth-a2') $$, :'staffa'),
  '42501', null, 'worker cannot insert a push endpoint directly — only through save_push_subscription()');
with u as (delete from push_subscriptions where id = :'push_a' returning 1)
  select is((select count(*)::int from u), 0, 'worker cannot delete a push endpoint directly — only through forget_push_subscription()');
select throws_ok(
  format($$ insert into push_subscriptions (staff_id, endpoint, p256dh, auth)
            values (%L, 'https://push.rls.test/stolen', 'p256dh-x', 'auth-x') $$, :'staffb'),
  '42501', null, 'worker cannot register a push endpoint against another worker');

-- Everything below is read-only for the worker on purpose: the write side
-- is owed to a security definer RPC, or is not the worker's to make at all.
select throws_ok(
  format($$ insert into quiz_attempts (staff_id, attempt_no, score, passed, answers)
            values (%L, 2, 100.00, true, '{}') $$, :'staffa'),
  '42501', null, 'worker cannot write their own quiz result — marking is a definer RPC (§2.6)');
select throws_ok(
  format($$ insert into location_pings (booking_id, location, inside_geofence)
            values (%L, st_setsrid(st_makepoint(-0.1,51.5),4326)::geography, true) $$, :'booking_a'),
  '42501', null, 'worker cannot claim an on-site fix — inside_geofence is derived server-side (§5.2b)');
select throws_ok(
  format($$ insert into staff_roles (staff_id, role_id) values (%L, %L) $$, :'staffa', :'role_id'),
  '42501', null, 'worker cannot qualify themselves for a role');
with u as (delete from staff_roles where staff_id = :'staffa' returning 1)
  select is((select count(*)::int from u), 0, 'worker cannot drop their own role qualification');
select throws_ok(
  format($$ insert into hmrc_checklists (staff_id, q1_other_job, statement, declared)
            values (%L, false, 'A', true) $$, :'staffa'),
  '42501', null, 'worker cannot write an HMRC checklist directly — the statement is derived by a definer RPC (§2.8)');
select throws_ok(
  format($$ insert into client_qualifications (client_id, role_id, staff_id)
            values (%L, %L, %L) $$, :'clienta', :'role_id', :'staffa'),
  '42501', null, 'worker cannot clear themselves at a client (§9.6, RULE-17)');
select throws_ok(
  $$ insert into audit_log (action, entity) values ('forged','staff') $$,
  '42501', null, 'worker cannot write the audit log');
with u as (update venue_types set default_radius_m = 999 where key = 'rls_fixture_type' returning 1)
  select is((select count(*)::int from u), 0, 'worker cannot edit venue type defaults');
select throws_ok(
  $$ insert into venue_types (key, label, default_radius_m) values ('forged','Forged',200) $$,
  '42501', null, 'worker cannot add a venue type');

-- cap_band_notices (20260921170411) and staff_transitions (20260921180312):
-- RLS since the day they landed, and no per-role test until now.
--
-- The worker's own cap-band notice is the interesting one. It is ABOUT
-- them, it is not money, and a self policy would look reasonable — which
-- is exactly the mistake. RULE-20 says the weekly cap is calculated and
-- never stored, and this table stores what N14 last TOLD the worker. A
-- letter verified this morning moves the real cap and leaves this row
-- saying yesterday's number; a screen that could read it would show a
-- worker hours they may not legally work. 001_rls_guard's assertion 4
-- states the same rule from the policy side; this is it from the
-- worker's.
select is((select count(*)::int from cap_band_notices where staff_id = :'staffa'), 0,
  'RULE-20 a worker cannot read even their OWN cap-band notice: it is a send receipt, not the cap, and the cap is always recalculated');
select throws_ok(
  format($$ insert into cap_band_notices (staff_id, band, cap_hours, notified_on)
            values (%L, 'uncapped', null, current_date) $$, :'staffb'),
  '42501', null, 'worker cannot write a cap-band notice for anybody, least of all a colleague');

select is((select count(*)::int from staff_transitions where from_status = 'compliant' and to_status = 'blocked'), 1,
  'worker may read staff_transitions: the §2.12 machine as data, so the Staff App can grey out a button it knows will be refused');
select throws_ok(
  $$ insert into staff_transitions (from_status, to_status) values ('compliant','documents') $$,
  '42501', null, 'worker cannot add an edge to the staff state machine — that would be editing §2.12 from the phone');

-- ---- symmetry: the second worker sees only their own rows ---------------
reset role;
select set_config('request.jwt.claims', json_build_object('sub', :'staffb_uid', 'role', 'authenticated')::text, true);
set local role authenticated;

select is((select count(*)::int from staff where id = :'staffb'), 1, 'second worker reads their own staff row');
select is((select count(*)::int from staff where id = :'staffa'), 0, 'second worker cannot read the first worker''s staff row');
select is((select count(*)::int from bookings where id = :'booking_b'), 1, 'second worker reads their own booking');
select is((select count(*)::int from bookings where id = :'booking_a'), 0, 'second worker cannot read the first worker''s booking');

-- ---- the erasure queue and the public form (§1.7, §2.1) ------------------
select is((select count(*)::int from storage_deletions where path = 'rls-probe/selfie.jpg'), 0,
  'a worker reads no erasure queue, not even the row naming their own selfie');
select throws_ok(
  format($$ insert into storage_deletions (bucket, path, staff_id) values ('photos', 'forged/x.jpg', %L) $$, :'staffa'),
  '42501', null, 'a worker cannot queue a deletion of anybody''s evidence — that is remove_worker()''s');
select throws_ok(
  $$ insert into applications (first_name, last_name, email, phone, dob, age_band, consented_at)
     values ('Forged', 'Row', 'forged@rls.test', '+447700900998', date '1990-01-01', '25-34', now()) $$,
  '42501', null, '§2.1: a worker cannot insert an application row and skip the throttle and DOB match');

reset role;
select * from finish();
rollback;
