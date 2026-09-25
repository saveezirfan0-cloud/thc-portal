-- =====================================================================
-- 620 · check-out corrections (§5.1, §5.2, §5.2b, §9.5, RULE-01/02/14)
--   20260929120000_check_in_out_corrections.sql · ADR-0032
--
--   D5   an early check-out raises Left early, which blocks RULE-14's floor
--   D15  an off-site check-out on a stale fix raises No check-out for review
--   D49  breaks outside the paid window cost nothing
--   D16  a worker who is not compliant cannot check in; a shift already
--        under way still closes
-- =====================================================================
begin;
\ir _shared/fixtures.psql

select plan(31);

\set ev     '62000000-0000-4000-8000-0000000000e1'
\set sh_d5  '62000000-0000-4000-8000-0000000000f1'
\set sh_gr  '62000000-0000-4000-8000-0000000000f2'
\set sh_d15 '62000000-0000-4000-8000-0000000000f3'
\set sh_d16 '62000000-0000-4000-8000-0000000000f4'
\set bk_d5  '62000000-0000-4000-8000-0000000000b1'
\set bk_gr  '62000000-0000-4000-8000-0000000000b2'
\set bk_d15 '62000000-0000-4000-8000-0000000000b3'
\set bk_blk '62000000-0000-4000-8000-0000000000b4'
\set bk_run '62000000-0000-4000-8000-0000000000b5'
\set st_blk '62000000-0000-4000-8000-0000000000d1'
\set us_blk '62000000-0000-4000-8000-0000000000a1'

insert into auth.users (id, email) values (:'us_blk', 'blk620@rls.test');
insert into profiles (id, role, full_name) values (:'us_blk', 'staff', 'Blocked Later');
insert into staff (id, user_id, employee_id, first_name, last_name, email, phone, dob, status) values
  (:'st_blk', :'us_blk', 96201, 'Blocked', 'Later', 'blk620@rls.test', '+447700962001', date '1993-03-03', 'compliant');

-- The client does not pay for breaks, so break rows count (§5.2b).
insert into events (id, client_id, venue_id, venue_name, venue_address, venue_location, geofence_radius_m,
                    title, event_date, pays_breaks, pays_buffer) values
  (:'ev', :'clienta', :'venue_id', 'RLS Fixture Venue', '1 Test Street, London',
   st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150, 'Checkout Fixture', current_date, false, true);

insert into shift_requirements (id, event_id, role_id, starts_at, ends_at, headcount, buffer,
                                charge_rate, pay_rate, allocation_per_hour) values
  -- 14:00–22:00, and it is 15:00: the audit's repro (D5).
  (:'sh_d5',  :'ev', :'role_id', now() - interval '1 hour',  now() + interval '7 hours', 6, 0, 22.97, 14.00, 6),
  -- ends in ten minutes: inside the 15-minute grace.
  (:'sh_gr',  :'ev', :'role_id', now() - interval '6 hours', now() + interval '10 minutes', 6, 0, 22.97, 14.00, 6),
  -- ended five minutes ago; the only fix is the one right after check-in (D15).
  (:'sh_d15', :'ev', :'role_id', now() - interval '5 hours', now() - interval '5 minutes', 6, 0, 22.97, 14.00, 6),
  -- starts in ten minutes (D16).
  (:'sh_d16', :'ev', :'role_id', now() + interval '10 minutes', now() + interval '6 hours', 6, 0, 22.97, 14.00, 6);

insert into bookings (id, shift_id, staff_id, status, source, confirmed_at) values
  (:'bk_d5',  :'sh_d5',  :'staffa', 'worked',    'auto', now() - interval '2 days'),
  (:'bk_gr',  :'sh_gr',  :'staffb', 'worked',    'auto', now() - interval '2 days'),
  (:'bk_d15', :'sh_d15', :'staffb', 'worked',    'auto', now() - interval '2 days'),
  (:'bk_blk', :'sh_d16', :'st_blk', 'confirmed', 'auto', now() - interval '2 days');

insert into check_logs (booking_id, attempted_at, outcome, check_in_at, on_site_verified)
select b.id, sr.starts_at, 'checked_in', sr.starts_at, true
  from bookings b join shift_requirements sr on sr.id = b.shift_id
 where b.id in (:'bk_d5', :'bk_gr', :'bk_d15');

-- ---------------------------------------------------------------------
-- D5 · Left early
-- ---------------------------------------------------------------------
set local "request.jwt.claims" = '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}';
select is(check_out(:'bk_d5', 51.5000, -0.1000)->>'leftEarly', 'true',
  'D5: checking out on site seven hours before the end is an early finish');
select is((select count(*)::int from violations where booking_id = :'bk_d5' and type = 'left_early'), 1,
  'D5: and raises the Left early violation (§9.5)');
select is((select (pay->>'workedMin')::int from payable_shifts_v where booking_id = :'bk_d5'), 60,
  'RULE-01: the hour worked is the hour paid');
select is((select (pay->>'payableMin')::int from payable_shifts_v where booking_id = :'bk_d5'), 60,
  'RULE-14: Left early blocks the four-hour floor — 60 minutes, not 240');
select is((select (pay->>'floorApplied')::boolean from payable_shifts_v where booking_id = :'bk_d5'), false,
  'RULE-14: the floor did not apply');
update violations set resolved = true, resolved_at = now(), resolution_note = 'Sent home by the client'
 where booking_id = :'bk_d5' and type = 'left_early';
select is((select (pay->>'payableMin')::int from payable_shifts_v where booking_id = :'bk_d5'), 60,
  'RULE-14: a Left early violation blocks the floor resolved or not');

set local "request.jwt.claims" = '{"sub":"55555555-5555-5555-5555-555555555555","role":"authenticated"}';
select is(check_out(:'bk_gr', 51.5000, -0.1000)->>'leftEarly', 'false',
  'D5 / ADR-0032: ten minutes before the end is inside the 15-minute grace');
select is((select count(*)::int from violations where booking_id = :'bk_gr' and type = 'left_early'), 0,
  'D5: so no Left early is raised');

-- ---------------------------------------------------------------------
-- D15 · a stale on-site fix is recorded, and reviewed
-- ---------------------------------------------------------------------
insert into location_pings (booking_id, at, location, inside_geofence)
select :'bk_d15', starts_at + interval '1 minute', st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, true
  from shift_requirements where id = :'sh_d15';

select is(check_out(:'bk_d15', 51.6000, -0.1000)->>'decision', 'recorded_last_on_site',
  'D15: an off-site check-out still records the last on-site fix (§5.1)');
select is((select check_out_at from check_logs where booking_id = :'bk_d15' and check_in_at is not null),
          (select starts_at + interval '1 minute' from shift_requirements where id = :'sh_d15'),
  'D15: the finish stays that fix');
select is((select count(*)::int from violations where booking_id = :'bk_d15' and type = 'no_checkout' and not resolved), 1,
  'D15: a fix more than 30 minutes before both the press and the end raises No check-out for review');
select is((select count(*)::int from violations where booking_id = :'bk_d15' and type = 'left_early'), 0,
  'D15: pressed after the end, so it is not an early finish');
select is((select (pay->>'payableMin')::int from payable_shifts_v where booking_id = :'bk_d15'), 1,
  'RULE-14: while it is unresolved, RULE-01 pays to the fix with no floor');

reset role;
set local "request.jwt.claims" = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select is((select status from checkin_monitor_v where booking_id = :'bk_d15'), 'no_check_out',
  '§9.5: the monitor holds the row as No check-out until a manager resolves it');
select lives_ok(
  format('select resolve_violation((select id from violations where booking_id = %L and type = ''no_checkout''), %L, %L)',
         :'bk_d15', 'Phoned: she stayed to the end.', (now() - interval '5 minutes')::text),
  'D15: the manager resolves it with the real finish');
select is((select (pay->>'payableMin')::int from payable_shifts_v where booking_id = :'bk_d15'), 295,
  'RULE-01: the manager-entered finish is what is then paid');

-- ---------------------------------------------------------------------
-- D49 · breaks outside the paid window
-- ---------------------------------------------------------------------
insert into breaks (booking_id, started_at, ended_at)
select :'bk_gr', starts_at - interval '20 minutes', starts_at + interval '10 minutes'
  from shift_requirements where id = :'sh_gr';
select is(unpaid_break_minutes(:'bk_gr'), 10,
  'D49: a break straddling the start only costs the minutes after it');
insert into breaks (booking_id, started_at, ended_at)
select :'bk_gr', now() + interval '1 minute', now() + interval '5 minutes';
select is(unpaid_break_minutes(:'bk_gr'), 10,
  'D49: a break after the recorded check-out costs nothing');
select is((select unpaid_break_min from payable_shifts_v where booking_id = :'bk_gr'), 10,
  'D49: payable_shifts_v deducts the same clipped figure');

-- ---------------------------------------------------------------------
-- D16 · only a compliant worker checks in
-- ---------------------------------------------------------------------
update staff set status = 'blocked', block_kind = 'manual', block_reason = 'fixture' where id = :'st_blk';

set local "request.jwt.claims" = '{"sub":"62000000-0000-4000-8000-0000000000a1","role":"authenticated"}';
select throws_ok(format('select attempt_check_in(%L, 51.5, -0.1)', :'bk_blk'),
  'P0001', 'staff_not_compliant',
  'D16: a blocked worker cannot check in, whatever the app showed');
select is((select count(*)::int from check_logs where booking_id = :'bk_blk'), 0,
  'D16: and nothing is written');
select is((select status::text from bookings where id = :'bk_blk'), 'confirmed',
  'D16: the booking is untouched');

reset role;
update staff set status = 'compliant', block_kind = null, block_reason = null where id = :'st_blk';
update shift_requirements set starts_at = now() - interval '10 minutes', ends_at = now() + interval '5 hours'
 where id = :'sh_d16';
set local "request.jwt.claims" = '{"sub":"62000000-0000-4000-8000-0000000000a1","role":"authenticated"}';
select is(attempt_check_in(:'bk_blk', 51.5000, -0.1000)->>'accepted', 'true',
  'D16: compliant again, the same worker checks in');
select is(record_ping(:'bk_blk', 51.5000, -0.1000)->>'decision', 'on_site',
  'and pings');

reset role;
update staff set status = 'blocked', block_kind = 'manual', block_reason = 'fixture' where id = :'st_blk';
set local "request.jwt.claims" = '{"sub":"62000000-0000-4000-8000-0000000000a1","role":"authenticated"}';
select is(record_ping(:'bk_blk', 51.5000, -0.1000)->>'decision', 'on_site',
  'D16: blocked mid-shift, tracking keeps working');
select is(start_break(:'bk_blk')->>'decision', 'on_break',
  'D16: so does Start break');
select is(finish_break(:'bk_blk')->>'decision', 'break_finished',
  'D16: and Finish break');
select is(check_out(:'bk_blk', 51.5000, -0.1000)->>'decision', 'recorded_on_site',
  'D16: and the shift already under way still closes');
select is(attempt_check_in(:'bk_blk', 51.5000, -0.1000)->>'decision', 'already_checked_in',
  'D16: a repeat press on a shift already started answers as before, it does not throw');

reset role;
select ok(not has_function_privilege('anon', 'attempt_check_in(uuid, double precision, double precision)', 'execute'),
  'anon still cannot call attempt_check_in');
select ok(has_function_privilege('authenticated', 'check_out(uuid, double precision, double precision)', 'execute'),
  'a signed-in worker still can call check_out');

select * from finish();
rollback;
