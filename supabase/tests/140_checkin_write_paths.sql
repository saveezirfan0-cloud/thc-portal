-- =====================================================================
-- 140 · breaks and Resolve (Scope §5.2b, §9.5, RULE-02 / 06 / 14)
--
-- The two write paths the pay maths in 0006 was waiting on. `now()` is frozen
-- inside a transaction, so the RPC behaviour (what rows appear, which guards
-- fire) and the minute arithmetic are tested separately: the first through the
-- functions, the second by writing break rows with known times.
-- =====================================================================
begin;

\ir _shared/fixtures.psql

select plan(46);

\set ev_unpaid   '8e8e8e8e-0000-4000-8000-000000000001'
\set ev_paid     '8e8e8e8e-0000-4000-8000-000000000002'
\set sh_unpaid   '8f8f8f8f-0000-4000-8000-000000000001'
\set sh_paid     '8f8f8f8f-0000-4000-8000-000000000002'
\set bk_worker   '8a8a8a8a-0000-4000-8000-000000000001'
\set bk_paid     '8a8a8a8a-0000-4000-8000-000000000002'
\set bk_noshow   '8a8a8a8a-0000-4000-8000-000000000003'
\set st_noshow   'dddddddd-0000-4000-8000-00000000000c'
\set us_noshow   '88888888-8888-8888-8888-888888888888'

insert into auth.users (id, email) values (:'us_noshow', 'noshow@rls.test');
insert into profiles (id, role, full_name) values (:'us_noshow', 'staff', 'Staff No-show worker');
insert into staff (id, user_id, employee_id, first_name, last_name, email, phone, dob, status) values
  (:'st_noshow', :'us_noshow', 90005, 'Staff', 'Noshow', 'noshow@rls.test', '+447700900015', date '1991-05-05', 'compliant');

-- Two clients' worth of break policy on one venue: one pays for breaks, one does not.
insert into events (id, client_id, venue_id, venue_name, venue_address, venue_location, geofence_radius_m,
                    title, event_date, pays_breaks, pays_buffer) values
  (:'ev_unpaid', :'clienta', :'venue_id', 'RLS Fixture Venue', '1 Test Street, London',
   st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150, 'Breaks Unpaid', current_date, false, true),
  (:'ev_paid',   :'clienta', :'venue_id', 'RLS Fixture Venue', '1 Test Street, London',
   st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150, 'Breaks Paid',   current_date, true,  true);

insert into shift_requirements (id, event_id, role_id, starts_at, ends_at, headcount, buffer,
                                charge_rate, pay_rate, allocation_per_hour) values
  -- Started 10 minutes ago: inside the 30-minute grace, so check-in still works
  -- and lands as Late (§5.1).
  (:'sh_unpaid', :'ev_unpaid', :'role_id', now() - interval '10 minutes', now() + interval '6 hours', 6, 0, 22.97, 14.00, 6),
  (:'sh_paid',   :'ev_paid',   :'role_id', now() - interval '10 minutes', now() + interval '6 hours', 6, 0, 22.97, 14.00, 6);

insert into bookings (id, shift_id, staff_id, status, source, confirmed_at) values
  (:'bk_worker', :'sh_unpaid', :'staffa',    'confirmed', 'auto', now() - interval '2 days'),
  (:'bk_paid',   :'sh_paid',   :'staffb',    'confirmed', 'auto', now() - interval '2 days'),
  (:'bk_noshow', :'sh_unpaid', :'st_noshow', 'confirmed', 'auto', now() - interval '2 days');

-- ---------------------------------------------------------------------
-- 1 · Breaks (§5.2b)
-- ---------------------------------------------------------------------
set local "request.jwt.claims" = '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}';

select throws_ok(
  format('select start_break(%L)', :'bk_worker'),
  'P0001', 'not_checked_in',
  '§5.2b Start break is locked before check-in — you cannot be on a break for a shift you never started'
);

select is(
  attempt_check_in(:'bk_worker', 51.5000, -0.1000)->>'decision', 'checked_in_late',
  'the worker checks in 10 minutes after the start, so Late'
);

select is(start_break(:'bk_worker')->>'decision', 'on_break',
  '§5.2b Start break unlocks after check-in');
select is((select count(*)::int from breaks where booking_id = :'bk_worker'), 1,
  'one break row is opened');
select is(start_break(:'bk_worker')->>'decision', 'already_on_break',
  'pressing Start break twice does not open a second break');
select is((select count(*)::int from breaks where booking_id = :'bk_worker'), 1,
  'and no second row appears');

select is(finish_break(:'bk_worker')->>'decision', 'break_finished',
  '§5.2b Finish break closes it');
select is((select count(*)::int from breaks where booking_id = :'bk_worker' and ended_at is not null), 1,
  'the break now carries an end');
select is(finish_break(:'bk_worker')->>'decision', 'not_on_break',
  'finishing again is a no-op, not an error');

select is(start_break(:'bk_worker')->>'decision', 'on_break',
  '§5.2b several breaks per shift are allowed');
select is((select count(*)::int from breaks where booking_id = :'bk_worker'), 2,
  'the second break is its own row');
select ok(finish_break(:'bk_worker')->>'decision' = 'break_finished', 'and it closes too');

-- A client that pays for breaks holds no break data at all (§3.2).
set local "request.jwt.claims" = '{"sub":"55555555-5555-5555-5555-555555555555","role":"authenticated"}';
select is(attempt_check_in(:'bk_paid', 51.5000, -0.1000)->>'accepted', 'true',
  'the second worker checks in on the client that pays breaks');
select throws_ok(
  format('select start_break(%L)', :'bk_paid'),
  'P0001', 'breaks_paid_by_client',
  '§5.2b where the client pays for breaks there is nothing to log'
);

select throws_ok(
  format('select start_break(%L)', :'bk_worker'),
  '42501', 'not_your_booking',
  'a worker cannot open a break on somebody else''s booking'
);

-- ---------------------------------------------------------------------
-- 2 · What a break costs (§5.2b: deducted from the hours worked)
--
-- now() is frozen in this transaction, so every break above is zero-length.
-- The arithmetic is asserted against rows with known times instead.
-- ---------------------------------------------------------------------
reset role;
set local "request.jwt.claims" = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

delete from breaks where booking_id = :'bk_worker';
-- The section and the check-in move back two hours so both breaks below sit
-- inside the paid window: a break outside [max(check-in, start), finish]
-- costs nothing (D49, 20260929120000; the clipping has its own vectors).
update shift_requirements set starts_at = now() - interval '2 hours' where id = :'sh_unpaid';
update check_logs set check_in_at = (select starts_at from shift_requirements where id = :'sh_unpaid')
 where booking_id = :'bk_worker';
insert into breaks (booking_id, started_at, ended_at) values
  (:'bk_worker', now() - interval '90 minutes', now() - interval '70 minutes'),   -- 20 min
  (:'bk_worker', now() - interval '50 minutes', now() - interval '35 minutes');   -- 15 min

select is(unpaid_break_minutes(:'bk_worker'), 35,
  '§5.2b the unpaid total is the sum of every break');
select is(unpaid_break_minutes(:'bk_paid'), 0,
  '§5.2b a client that pays for breaks contributes nothing, whatever rows exist');

-- Close the shift and check the deduction reaches the money.
update shift_requirements set starts_at = now() - interval '8 hours', ends_at = now()
 where id = :'sh_unpaid';
update check_logs set check_in_at = now() - interval '8 hours' where booking_id = :'bk_worker';
select is(check_out(:'bk_worker', 51.5000, -0.1000)->>'decision', 'recorded_on_site',
  'the worker checks out on site');
select is(
  (select (pay->>'workedMin')::int from payable_shifts_v where booking_id = :'bk_worker'),
  8 * 60 - 35,
  'RULE-01 the payable window has the break time taken out of it'
);

-- An unfinished break ends when the shift does, rather than staying open.
insert into breaks (booking_id, started_at) values (:'bk_worker', now() - interval '30 minutes');
update check_logs set check_out_at = null, check_out_pressed_at = null where booking_id = :'bk_worker';
select is(check_out(:'bk_worker', 51.5000, -0.1000)->>'decision', 'recorded_on_site',
  'the worker checks out again with a break still running');
select is((select count(*)::int from breaks where booking_id = :'bk_worker' and ended_at is null), 0,
  '§5.2b check-out closes a break the worker never finished');

-- ---------------------------------------------------------------------
-- 3 · Resolve (§9.5)
-- ---------------------------------------------------------------------
-- The Late violation attempt_check_in raised for this worker.
select is((select count(*)::int from violations where booking_id = :'bk_worker' and type = 'late'), 1,
  'the late check-in left a violation to resolve');

select throws_ok(
  format('select resolve_violation((select id from violations where booking_id = %L and type = ''late''), %L)',
         :'bk_worker', '   '),
  'P0001', 'note_required',
  '§9.5 the note is mandatory on every type — whitespace is not a note'
);

select lives_ok(
  format('select resolve_violation((select id from violations where booking_id = %L and type = ''late''), %L)',
         :'bk_worker', 'Tube strike, agreed with the client on the night.'),
  '§9.5 a Late violation resolves with a note'
);
select is(
  (select resolution_note from violations where booking_id = :'bk_worker' and type = 'late'),
  'Tube strike, agreed with the client on the night.',
  '§9.5 the note is never write-only — it stays on the entry'
);
select is(
  (select resolved_by from violations where booking_id = :'bk_worker' and type = 'late'),
  '11111111-1111-1111-1111-111111111111'::uuid,
  '§9.5 and so does the name of the manager who closed it'
);
select is(
  (select resolve_violation(id, 'again') ->> 'decision' from violations where booking_id = :'bk_worker' and type = 'late'),
  'already_resolved',
  'resolving twice is a no-op'
);

-- A manager is the only one who can resolve.
set local "request.jwt.claims" = '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}';
select throws_ok(
  format('select resolve_violation((select id from violations where booking_id = %L limit 1), %L)',
         :'bk_worker', 'let me off'),
  '42501', 'admins_only',
  '§9.5 a worker cannot resolve their own violation'
);
set local "request.jwt.claims" = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

-- ---- No check-out: RULE-02 settles, RULE-14's floor comes back -------
\set v_nocheckout '0d0d0d0d-0000-4000-8000-00000000000a'
update check_logs set check_out_at = null, check_out_pressed_at = null, manager_finish_at = null
 where booking_id = :'bk_worker';
insert into violations (id, staff_id, booking_id, type, detected_at)
  values (:'v_nocheckout', :'staffa', :'bk_worker', 'no_checkout', now());

select is(
  (select pay->>'status' from payable_shifts_v where booking_id = :'bk_worker'),
  'undetermined',
  'RULE-02 the shift has no payable figure at all before it is resolved'
);
select throws_ok(
  format('select resolve_violation(%L, %L)', :'v_nocheckout', 'Worker confirmed by phone.'),
  'P0001', 'actual_finish_required',
  '§9.5 resolving a No check-out needs the actual finish time'
);
select throws_ok(
  format('select resolve_violation(%L, %L, %L)', :'v_nocheckout', 'Typo.', (now() + interval '1 hour')::text),
  'P0001', 'actual_finish_in_future',
  '§9.5 a finish time in the future is rejected'
);
select throws_ok(
  format('select resolve_violation(%L, %L, %L)', :'v_nocheckout', 'Typo.', (now() - interval '9 hours')::text),
  'P0001', 'actual_finish_before_check_in',
  '§9.5 a finish time before the worker checked in is rejected'
);

select lives_ok(
  format('select resolve_violation(%L, %L, %L)', :'v_nocheckout', 'Left at 23:10, confirmed with the venue.',
         (now() + interval '0 minutes')::text),
  '§9.5 a finish time after the scheduled end is accepted — RULE-01 caps the pay, not the clock'
);
select is(
  (select manager_finish_at from check_logs where booking_id = :'bk_worker'),
  now(),
  'RULE-02 the manager-entered finish becomes the shift''s check-out'
);
select is(
  (select pay->>'status' from payable_shifts_v where booking_id = :'bk_worker'),
  'settled',
  'RULE-02 and the payable time settles'
);

-- The floor: a worker who finished an hour into a four-hour section (every
-- section is at least four hours, §3.2) is still paid four.
update shift_requirements set starts_at = now() - interval '5 hours', ends_at = now() - interval '1 hour'
 where id = :'sh_unpaid';
update check_logs set check_in_at = now() - interval '5 hours',
                      manager_finish_at = now() - interval '4 hours'
 where booking_id = :'bk_worker';
delete from breaks where booking_id = :'bk_worker';
select is(
  (select (pay->>'payableMin')::int from payable_shifts_v where booking_id = :'bk_worker'),
  240,
  'RULE-14 resolving the No check-out restores the four-hour floor'
);

-- ---- No-show: Resolve is "Get back" (§3.3) --------------------------
\set v_noshow '0d0d0d0d-0000-4000-8000-00000000000b'
insert into violations (id, staff_id, booking_id, type, detected_at)
  values (:'v_noshow', :'st_noshow', :'bk_noshow', 'no_show', now() - interval '3 hours');
update shift_requirements set starts_at = now() - interval '90 minutes', ends_at = now() + interval '6 hours'
 where id = :'sh_unpaid';

select is(
  (select count(*)::int from check_logs where booking_id = :'bk_noshow'), 0,
  'the no-show has no check log: the button had locked'
);
select is(
  resolve_violation(:'v_noshow', 'Arrived at the staff entrance, registered on the roster.')->>'nowType',
  'late',
  '§9.5 resolving a No-show reclassifies the entry to Late'
);
select is(
  (select type::text from violations where id = :'v_noshow'), 'late',
  '§3.3 the stored type follows — it is the same action as "Get back"'
);
select is(
  (select minutes_late from violations where id = :'v_noshow'), 90,
  '§3.3 the minutes late are counted from the moment the manager pressed it'
);
select is(
  (select count(*)::int from check_logs where booking_id = :'bk_noshow' and check_in_at is not null), 1,
  '§3.3 the worker is registered as arrived'
);
select is(
  (select on_site_verified from check_logs where booking_id = :'bk_noshow'), false,
  'that arrival is not GPS-verified — a manager vouched for it, and the record says so'
);
select is(
  (select status::text from bookings where id = :'bk_noshow'), 'worked',
  '§3.6 and the booking moves to worked'
);

-- ---- RULE-06: an exported payroll is never corrected retroactively ---
-- Asked per booking (20260923190000): the event going out on a Monday says
-- nothing about a shift that was held from that export.
\set v_late2 '0d0d0d0d-0000-4000-8000-00000000000c'
\set v_late3 '0d0d0d0d-0000-4000-8000-00000000000d'
update events set payroll_exported_at = now() - interval '1 day' where id = :'ev_unpaid';
insert into violations (id, staff_id, booking_id, type, detected_at, minutes_late)
  values (:'v_late3', :'staffa', :'bk_worker', 'left_early', now(), null);
select is(
  resolve_violation(:'v_late3', 'Held from the export, resolved before the next one.')->>'payrollExported',
  'false',
  'RULE-06 the event was exported but this shift was not, so resolving it warns nothing: it is paid on the next Monday'
);
with rs as (
  insert into report_sends (kind, period_start, period_end, sent_at, status)
  values ('payroll', date '2001-01-01', date '2001-01-07', now() - interval '1 day', 'sent') returning id
)
insert into payroll_export_lines (report_send_id, booking_id, staff_id, event_id, state, shift_date, payable_min, rate, base, holiday)
select rs.id, :'bk_worker', :'staffa', :'ev_unpaid', 'exported', current_date - 1, 240, 12.21, 48.84, 5.89 from rs;
insert into violations (id, staff_id, booking_id, type, detected_at, minutes_late)
  values (:'v_late2', :'staffa', :'bk_worker', 'left_early', now(), null);
select is(
  resolve_violation(:'v_late2', 'Sent home early by the venue.')->>'payrollExported',
  'true',
  'RULE-06 resolving a shift already in a payroll export says so, so the screen can point at Finance'
);
select is(
  (select resolved from violations where id = :'v_late2'), true,
  'RULE-06 the resolution still goes through — the money is owed, the export just does not move'
);

select * from finish();
rollback;
