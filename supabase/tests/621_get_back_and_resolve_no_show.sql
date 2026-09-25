-- =====================================================================
-- 621 · "Get back" and Resolve on a No-show (§3.3, §5.1, §9.5)
--   20260929120000_check_in_out_corrections.sql · ADR-0032
--
--   D4   get_back() registers the arrival through resolve_violation(): the
--        booking is `worked`, the shift pays, the worker is unlocked, and
--        the next booking_tick() has no No-show left to raise.
--   D17  a No-show resolved after the section has ended takes the arrival
--        a manager types (validated) and, optionally, the finish — so the
--        shift settles instead of staying Pending.
-- =====================================================================
begin;
\ir _shared/fixtures.psql

select plan(37);

\set ev      '62100000-0000-4000-8000-0000000000e1'
\set sh_run  '62100000-0000-4000-8000-0000000000f1'
\set sh_done '62100000-0000-4000-8000-0000000000f2'
\set bk_run  '62100000-0000-4000-8000-0000000000b1'
\set bk_done '62100000-0000-4000-8000-0000000000b2'

insert into events (id, client_id, venue_id, venue_name, venue_address, venue_location, geofence_radius_m,
                    title, event_date, pays_breaks, pays_buffer) values
  (:'ev', :'clientb', :'venue_id', 'RLS Fixture Venue', '1 Test Street, London',
   st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150, 'Get Back Fixture', current_date, true, true);

insert into shift_requirements (id, event_id, role_id, starts_at, ends_at, headcount, buffer,
                                charge_rate, pay_rate, allocation_per_hour) values
  -- Started an hour ago and still running.
  (:'sh_run',  :'ev', :'role_id', now() - interval '1 hour',  now() + interval '5 hours', 6, 0, 22.97, 14.00, 6),
  -- 8 hours, ended two hours ago.
  (:'sh_done', :'ev', :'role_id', now() - interval '10 hours', now() - interval '2 hours', 6, 0, 22.97, 14.00, 6);

insert into bookings (id, shift_id, staff_id, status, source, confirmed_at) values
  (:'bk_run',  :'sh_run',  :'staffa', 'confirmed', 'auto', now() - interval '2 days'),
  (:'bk_done', :'sh_done', :'staffb', 'confirmed', 'auto', now() - interval '2 days');

delete from client_qualifications where client_id = :'clientb';

-- BG-03 raises both No-shows.
select lives_ok($$ select booking_tick() $$, 'booking_tick runs');
select is((select count(*)::int from violations where booking_id in (:'bk_run', :'bk_done') and type = 'no_show'), 2,
  'BG-03: start + 30 with no check-in is an automatic No-show on both');

set local "request.jwt.claims" = '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}';
select is(attempt_check_in(:'bk_run', 51.5000, -0.1000)->>'decision', 'locked',
  '§5.1: the worker''s check-in button is locked');
select throws_ok(format('select get_back(%L)', :'bk_run'), '42501', 'admins_only',
  'a worker cannot Get themselves back');

-- ---------------------------------------------------------------------
-- D4 · Get back on the event board
-- ---------------------------------------------------------------------
set local "request.jwt.claims" = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select is(get_back(:'bk_run')->>'nowType', 'late',
  'D4: Get back reclassifies the No-show to Late (§3.3)');
select is((select status::text from bookings where id = :'bk_run'), 'worked',
  'D4: and the booking is worked');
select is((select count(*)::int from check_logs where booking_id = :'bk_run' and check_in_at = now()), 1,
  'D4: the arrival is registered at the moment of the press');
select is((select on_site_verified from check_logs where booking_id = :'bk_run'), false,
  'D4: vouched for by a manager, not GPS');
select is((select minutes_late from violations where booking_id = :'bk_run'), 60,
  'D4: minutes late from the press (§3.3)');
select is((select count(*)::int from violations where booking_id = :'bk_run' and type = 'no_show'), 0,
  'D4: no No-show is left on the booking');
select is((select count(*)::int from violations where booking_id = :'bk_run'), 1,
  'D4: one entry, not a deleted No-show and a fresh Late');
select ok((select resolved and resolution_note like 'Get back%' from violations where booking_id = :'bk_run'),
  'D4: resolved, with the note saying where it came from');
select throws_ok(format('select get_back(%L)', :'bk_run'), 'P0001', 'no_open_no_show',
  'D4: pressing it twice finds nothing to get back');

select lives_ok($$ select booking_tick() $$, 'the next tick runs');
select is((select count(*)::int from violations where booking_id = :'bk_run' and type = 'no_show'), 0,
  'D4: and raises no new No-show — the booking is worked with a check-in');

set local "request.jwt.claims" = '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}';
select is(attempt_check_in(:'bk_run', 51.5000, -0.1000)->>'decision', 'already_checked_in',
  'D4: the worker is no longer locked out — the screen reads them as on shift');

-- The shift runs its course: walk it (and the arrival) back so the
-- check-out below lands at the scheduled end.
reset role;
update shift_requirements set starts_at = now() - interval '6 hours', ends_at = now() where id = :'sh_run';
update check_logs set check_in_at = now() - interval '5 hours' where booking_id = :'bk_run';
set local "request.jwt.claims" = '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}';
select is(check_out(:'bk_run', 51.5000, -0.1000)->>'decision', 'recorded_on_site',
  'D4: and checks out themselves');
reset role;
select is((select kind from payable_shifts_v where booking_id = :'bk_run'), 'worked',
  'D4: payable_shifts_v prices it as worked');
select is((select (pay->>'payableMin')::int from payable_shifts_v where booking_id = :'bk_run'), 300,
  'D4: from the registered arrival to the end — not £0');
select lives_ok($$ select booking_tick(now() + interval '5 hours') $$, 'a tick well after the end');
select is((select count(*)::int from violations where booking_id = :'bk_run' and type in ('no_show', 'no_checkout')), 0,
  'D4: raises neither a No-show nor a No check-out');

-- ---------------------------------------------------------------------
-- D17 · Resolve a No-show after the section has ended
-- ---------------------------------------------------------------------
set local "request.jwt.claims" = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
\set v_done '(select id from violations where booking_id = ''62100000-0000-4000-8000-0000000000b2'' and type = ''no_show'')'

select throws_ok(format('select resolve_violation(%s, %L)', :'v_done', 'Came in late.'),
  'P0001', 'arrived_at_required',
  'D17: after the end, the press is not an arrival — the manager says when they came');
select throws_ok(format('select resolve_violation(%s, %L, null, %L)', :'v_done', 'Typo.', (now() - interval '10 hours 31 minutes')::text),
  'P0001', 'arrived_at_too_early',
  'D17: not before check-in opens (start − 30)');
select throws_ok(format('select resolve_violation(%s, %L, null, %L)', :'v_done', 'Typo.', (now() + interval '1 minute')::text),
  'P0001', 'arrived_at_in_future',
  'D17: not in the future');
select throws_ok(format('select resolve_violation(%s, %L, %L, %L)', :'v_done', 'Typo.',
                        (now() - interval '9 hours')::text, (now() - interval '8 hours')::text),
  'P0001', 'actual_finish_before_arrival',
  'D17: a finish before the arrival is refused');
select throws_ok(format('select resolve_violation(%s, %L, %L, %L)', :'v_done', 'Typo.',
                        (now() + interval '1 minute')::text, (now() - interval '8 hours')::text),
  'P0001', 'actual_finish_in_future',
  'D17: a finish in the future is refused');
select is((select count(*)::int from check_logs where booking_id = :'bk_done'), 0,
  'D17: a refused resolve writes nothing');

select is(
  resolve_violation(:v_done, 'Arrived 45 minutes late, left 30 minutes early — agreed with the venue.',
                    now() - interval '2 hours 30 minutes', now() - interval '9 hours 15 minutes')->>'minutesLate',
  '45',
  'D17: minutes late from the arrival the manager entered');
select is((select check_in_at from check_logs where booking_id = :'bk_done'), now() - interval '9 hours 15 minutes',
  'D17: that arrival is the check-in');
select is((select check_out_at from check_logs where booking_id = :'bk_done'), now() - interval '2 hours 30 minutes',
  'D17: the finish is the check-out');
select is((select manager_finish_at from check_logs where booking_id = :'bk_done'), now() - interval '2 hours 30 minutes',
  'D17: and is recorded as manager-entered');
select is((select status::text from bookings where id = :'bk_done'), 'worked',
  'D17: the booking is worked');
select is((select pay->>'status' from payable_shifts_v where booking_id = :'bk_done'), 'settled',
  'D17: the shift settles — not Pending for ever');
select is((select (pay->>'payableMin')::int from payable_shifts_v where booking_id = :'bk_done'), 405,
  'RULE-01: arrival to finish, 45 minutes late and 30 early off eight hours');

select is((select count(*)::int from client_qualifications where client_id = :'clientb' and staff_id = :'staffb'), 1,
  'D37: the shift closed with its only violation resolved, so the automatic qualification follows (§9.6)');

reset role;
select lives_ok($$ select booking_tick(now() + interval '5 hours') $$, 'a tick after the check-out lock');
select is((select count(*)::int from violations where booking_id = :'bk_done' and type in ('no_show', 'no_checkout')), 0,
  'D17: nothing is re-raised on the settled shift');

select * from finish();
rollback;
