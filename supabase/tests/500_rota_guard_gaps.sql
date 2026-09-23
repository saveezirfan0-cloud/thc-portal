-- =====================================================================
-- 500 · The rota guard's four gaps (docs/14 §4, ADR-0019)
--   20260924130100_rota_guard_gaps.sql
--
--   1. A declined / withdrawn / slot-taken `closed` booking is not hours.
--   2. One statement confirming two bookings for one worker sees both.
--   3. Moving a shift re-checks the workers already confirmed on it.
--   4. Auto-assign names an expired right to work `rtw_expired`.
-- =====================================================================
begin;
select plan(25);
\ir _shared/fixtures.psql

\set stu 'c5000000-0000-4000-8000-000000000001'
\set adu 'c5000000-0000-4000-8000-000000000002'
\set ev  'c5100000-0000-4000-8000-000000000001'
\set s_a 'c5200000-0000-4000-8000-00000000000a'
\set s_1 'c5200000-0000-4000-8000-000000000001'
\set s_2 'c5200000-0000-4000-8000-000000000002'
\set s_3 'c5200000-0000-4000-8000-000000000003'
\set s_4 'c5200000-0000-4000-8000-000000000004'
\set l_1 'c5200000-0000-4000-8000-000000000011'
\set l_2 'c5200000-0000-4000-8000-000000000012'
select cap_week_start(current_date) + 14 as w \gset

-- A Student visa holder whose right to work ends on Thursday of week W,
-- and an adult on the Working Time 48 with no opt-out.
insert into staff (id, first_name, last_name, email, phone, dob, status, rtw_branch, right_to_work_until) values
  (:'stu', 'Gap', 'Student', 'gs@rg500.test', '+447700950001', date '2001-01-01', 'compliant',
   'international_student', :'w'::date + 3),
  (:'adu', 'Gap', 'Adult', 'ga@rg500.test', '+447700950002', date '1990-01-01', 'compliant',
   'uk_irish', null);
insert into staff_roles (staff_id, role_id) values (:'stu', :'role_id'), (:'adu', :'role_id');

insert into events (id, client_id, venue_id, venue_name, venue_address, venue_location, geofence_radius_m,
                    title, event_date, pays_breaks, pays_buffer)
values (:'ev', :'clienta', :'venue_id', 'RLS Fixture Venue', '1 Test Street, London',
        st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150, 'Gap Week', :'w'::date, true, true);

insert into shift_requirements (id, event_id, role_id, starts_at, ends_at, headcount, buffer,
                                charge_rate, pay_rate, allocation_per_hour) values
  -- Monday, 8 h: the invitation the student declines.
  (:'s_a', :'ev', :'role_id', (:'w'::date + time '09:00') at time zone 'Europe/London',
                              (:'w'::date + time '17:00') at time zone 'Europe/London', 5, 0, 20, 12, 5),
  -- Tuesday and Wednesday, 12 h each.
  (:'s_1', :'ev', :'role_id', (:'w'::date + 1 + time '06:00') at time zone 'Europe/London',
                              (:'w'::date + 1 + time '18:00') at time zone 'Europe/London', 5, 0, 20, 12, 5),
  (:'s_2', :'ev', :'role_id', (:'w'::date + 2 + time '06:00') at time zone 'Europe/London',
                              (:'w'::date + 2 + time '18:00') at time zone 'Europe/London', 5, 0, 20, 12, 5),
  -- Thursday, 8 h: the last day of the student's right to work.
  (:'s_3', :'ev', :'role_id', (:'w'::date + 3 + time '09:00') at time zone 'Europe/London',
                              (:'w'::date + 3 + time '17:00') at time zone 'Europe/London', 5, 0, 20, 12, 5),
  -- Friday, 4 h: past it.
  (:'s_4', :'ev', :'role_id', (:'w'::date + 4 + time '09:00') at time zone 'Europe/London',
                              (:'w'::date + 4 + time '13:00') at time zone 'Europe/London', 5, 0, 20, 12, 5),
  -- The adult: 40 h from Monday 00:00, then 6 h on Saturday.
  (:'l_1', :'ev', :'role_id', (:'w'::date + time '00:00') at time zone 'Europe/London',
                              (:'w'::date + 1 + time '16:00') at time zone 'Europe/London', 5, 0, 20, 12, 5),
  (:'l_2', :'ev', :'role_id', (:'w'::date + 5 + time '09:00') at time zone 'Europe/London',
                              (:'w'::date + 5 + time '15:00') at time zone 'Europe/London', 5, 0, 20, 12, 5);

-- ---------------------------------------------------------------------
-- 1 · `closed` is not committed hours
-- ---------------------------------------------------------------------
insert into bookings (shift_id, staff_id, status, source, cancelled_at, cancel_cause)
values (:'s_a', :'stu', 'closed', 'auto', now(), 'declined');

select is(weekly_booked_hours(:'stu', :'w'::date), 0::numeric,
  'a declined invitation (closed, stamped declined) is not 8 hours booked');
select is((rota_guard_verdict(:'stu', :'s_1') ->> 'bookedHours')::numeric, 0::numeric,
  'so the guard does not count it either');
select ok(booking_counts_toward_cap('confirmed', null, null)
          and booking_counts_toward_cap('worked', null, null)
          and not booking_counts_toward_cap('invited', null, null)
          and not booking_counts_toward_cap('applied', null, null)
          and not booking_counts_toward_cap('cancelled', now(), 'withdraw')
          and not booking_counts_toward_cap('closed', now(), 'slot_taken')
          and not booking_counts_toward_cap('closed', now(), 'withdrawn_by_worker'),
  'confirmed and worked are hours; invitations, applications, cancellations and cancelled-closed rows are not');

-- ---------------------------------------------------------------------
-- 2 · One statement, two confirmations, one worker
-- ---------------------------------------------------------------------
insert into bookings (shift_id, staff_id, status, source) values
  (:'s_1', :'stu', 'invited', 'auto'),
  (:'s_2', :'stu', 'invited', 'auto');

select throws_ok(
  format($$ update bookings set status = 'confirmed' where staff_id = %L and shift_id in (%L, %L) $$,
         :'stu', :'s_1', :'s_2'),
  'P0001', 'rota_guard_visa_cap',
  'confirming 12 h + 12 h in ONE statement is refused: each row sees the other (24 h > 20 h)');
select is((select count(*)::int from bookings where staff_id = :'stu' and status = 'confirmed'), 0,
  'and the whole statement rolls back — neither is confirmed');

select lives_ok(
  format($$ update bookings set status = 'confirmed' where staff_id = %L and shift_id = %L $$, :'stu', :'s_1'),
  'one of them alone is within the 20 h');
select is(weekly_booked_hours(:'stu', :'w'::date), 12::numeric, 'the week now holds 12 h');
select is((rota_guard_verdict(:'stu', :'s_1') ->> 'verdict'), 'ok',
  'and a confirmed booking is not judged against itself: its own 12 h are not counted twice');
select throws_ok(
  format($$ update bookings set status = 'confirmed' where staff_id = %L and shift_id = %L $$, :'stu', :'s_2'),
  'P0001', 'rota_guard_visa_cap', 'the second, on its own, still is not');

-- ---------------------------------------------------------------------
-- 3 · Moving a shift re-checks who is already on it
-- ---------------------------------------------------------------------
select ok(
  (select tgdeferrable and tginitdeferred from pg_trigger
    where tgname = 'shift_times_rota_guard' and tgrelid = 'public.shift_requirements'::regclass),
  'the shift-time check is a constraint trigger deferred to COMMIT: an edit is judged where the rota ends up');
-- pgTAP never commits, so ask for the check at each statement's end.
set constraints shift_times_rota_guard immediate;

insert into bookings (shift_id, staff_id, status, source) values (:'s_3', :'stu', 'invited', 'auto');
select lives_ok(
  format($$ update bookings set status = 'confirmed' where staff_id = %L and shift_id = %L $$, :'stu', :'s_3'),
  'Thursday''s 8 h takes the week to exactly 20');

select throws_ok(
  format($$ update shift_requirements set ends_at = ends_at + interval '1 hour' where id = %L $$, :'s_3'),
  'P0001', 'rota_guard_visa_cap',
  'lengthening the shift by an hour would put a confirmed student at 21 h: the change is refused');
update settings set value = '"warn"' where key = 'rota_guard_mode';
select throws_ok(
  format($$ update shift_requirements set ends_at = ends_at + interval '1 hour' where id = %L $$, :'s_3'),
  'P0001', 'rota_guard_visa_cap',
  'and warn mode does not change that: a Student visa limit is never configurable');
select throws_ok(
  format($$ update shift_requirements set starts_at = starts_at + interval '1 day',
                                          ends_at   = ends_at   + interval '1 day' where id = %L $$, :'s_3'),
  'P0001', 'rota_guard_rtw_expired',
  'moving it to Friday, past the right to work, is refused as the expiry — always');
select lives_ok(
  format($$ update shift_requirements set ends_at = ends_at - interval '1 hour' where id = %L $$, :'s_3'),
  'shortening it is fine');
update settings set value = '"block"' where key = 'rota_guard_mode';

-- The right to work turns out to end on Wednesday: Thursday's confirmed
-- shift is already past it. That is compliance_daily's to act on; it must
-- not freeze every edit to the section, only one that makes it worse.
update staff set right_to_work_until = :'w'::date + 2 where id = :'stu';
select lives_ok(
  format($$ update shift_requirements set starts_at = starts_at + interval '30 minutes',
                                          ends_at   = ends_at   + interval '30 minutes' where id = %L $$, :'s_3'),
  'a move that leaves an existing breach no worse (same reason, same hours) is not refused');
select throws_ok(
  format($$ update shift_requirements set ends_at = ends_at + interval '1 hour' where id = %L $$, :'s_3'),
  'P0001', 'rota_guard_rtw_expired',
  'but adding hours past the right to work is');

-- The Working Time 48: the one limit the setting decides.
insert into bookings (shift_id, staff_id, status, source) values
  (:'l_1', :'adu', 'confirmed', 'manual'),
  (:'l_2', :'adu', 'confirmed', 'manual');
select is(weekly_booked_hours(:'adu', :'w'::date), 46::numeric, 'the adult holds 46 h');
select throws_ok(
  format($$ update shift_requirements set ends_at = ends_at + interval '4 hours' where id = %L $$, :'l_2'),
  'P0001', 'rota_guard_wtr_cap',
  'block mode: lengthening Saturday to 10 h (50 h) is refused');
update settings set value = '"warn"' where key = 'rota_guard_mode';
select lives_ok(
  format($$ update shift_requirements set ends_at = ends_at + interval '4 hours' where id = %L $$, :'l_2'),
  'warn mode: it goes ahead');
select is(
  (select count(*)::int from audit_log
    where action = 'rota_guard.warned' and data ->> 'change' = 'shift_times'
      and (data ->> 'staffId')::uuid = :'adu' and (data ->> 'shiftId')::uuid = :'l_2'),
  1, 'and the breach is recorded for the office, marked as a shift-time change');
update settings set value = '"block"' where key = 'rota_guard_mode';

select lives_ok(
  format($$ update shift_requirements set starts_at = now() - interval '3 days',
                                          ends_at   = now() - interval '2 days' where id = %L $$, :'l_1'),
  'a shift moved into the past is history, not rostering: not re-checked');

-- ---------------------------------------------------------------------
-- 4 · Auto-assign's label
-- ---------------------------------------------------------------------
select is((select gate from auto_assign_candidates(:'s_4') where staff_id = :'stu'), 'rtw_expired',
  'a shift past the worker''s right to work is gated rtw_expired, not hours_limit');
select is((select gate from auto_assign_candidates(:'s_2') where staff_id = :'stu'), 'hours_limit',
  'a shift over the student''s 20 h is still hours_limit');
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
select is((select count(*)::int from staff_open_shifts(:'stu') where shift_id = :'s_4'), 0,
  'the Radar does not offer the worker a shift past their right to work as "Limit reached"');

select * from finish();
rollback;
