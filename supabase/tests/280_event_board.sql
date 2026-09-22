-- =====================================================================
-- 280 · The event board (§3.3)  — 20260922100500_event_board.sql
--
-- The counts are where this screen goes wrong, and they go wrong the same
-- way every time:
--
--   · Fill counts CONFIRMED bookings only. Not invited, not applied.
--   · Open is headcount - confirmed, NEVER (headcount + buffer) -
--     confirmed. The buffer is an over-invitation allowance, not a seat.
--   · A no-show is a flag on a CONFIRMED row, never a fifth list (§3.3).
--   · A worked booking still holds its slot, or a finished event reads as
--     empty.
--
-- And two rules on the actions: a worked shift cannot be withdrawn
-- (RULE-06 never corrects an export), and a manual No-show is allowed on
-- an already-exported shift but must say so rather than being refused.
-- =====================================================================
begin;
select plan(31);
\ir _shared/fixtures.psql

\set past_event 'eeeeeeee-0000-4000-8000-0000000000e1'
\set past_shift 'ffffffff-0000-4000-8000-0000000000e1'
\set bk_conf    '0a0a0a0a-0000-4000-8000-0000000000e1'
\set bk_inv     '0a0a0a0a-0000-4000-8000-0000000000e2'
\set staffc     'dddddddd-0000-4000-8000-0000000000e1'

insert into staff (id, employee_id, first_name, last_name, email, phone, dob, status) values
  (:'staffc', 90301, 'Board', 'Charlie', 'boardc@rls.test', '+447700900301',
   date '1993-03-03', 'compliant');
insert into staff_roles (staff_id, role_id) values (:'staffc', :'role_id');

-- A shift that has already started, so the manual No-show window is open.
insert into events (id, client_id, venue_id, venue_name, venue_address, venue_location,
                    geofence_radius_m, title, event_date, pays_breaks, pays_buffer, po_number) values
  (:'past_event', :'clienta', :'venue_id', 'RLS Fixture Venue', '1 Test Street, London',
   st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150,
   'Board Fixture Event', current_date, true, true, 'PO-BOARD');
insert into shift_requirements (id, event_id, role_id, starts_at, ends_at, headcount, buffer,
                                charge_rate, pay_rate, dress_code, allocation_per_hour) values
  (:'past_shift', :'past_event', :'role_id', now() - interval '2 hours',
   now() + interval '4 hours', 3, 2, 22.97, 14.00, 'Black tie', 5);
insert into bookings (id, shift_id, staff_id, status, source, confirmed_at) values
  (:'bk_conf', :'past_shift', :'staffa', 'confirmed', 'auto', now() - interval '1 day'),
  (:'bk_inv',  :'past_shift', :'staffc', 'invited',   'auto', null);

-- The board is an admin screen and every action on it is a manager's, so
-- the whole file runs as one. `set local role` is deliberately NOT used:
-- the tests read through security_invoker views that the owner reaches,
-- and 010/020/030 are where the policies themselves are proven.
set local "request.jwt.claims" = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

-- =====================================================================
-- The header
-- =====================================================================
select is((select starts_at from event_board_v where id = :'past_event'),
  (select min(starts_at) from shift_requirements where event_id = :'past_event'),
  'the header window is the DERIVED one (§3.2), min start across the role sections');
select is((select status::text from event_board_v where id = :'past_event'), 'ongoing',
  'and the status is computed from it, not stored');
select is((select pays_breaks from event_board_v where id = :'past_event'), true,
  'the break policy shown is the EVENT''s copy — an event keeps what it was built with (§3.2)');

-- The client's live policy changing must not rewrite what this event bills.
update clients set pays_breaks = false where id = :'clienta';
select is((select pays_breaks from event_board_v where id = :'past_event'), true,
  'so changing the client''s policy today does not change what a built event says it will bill');
update clients set pays_breaks = true where id = :'clienta';

-- =====================================================================
-- The section counts — §3.3's one repeated mistake
-- =====================================================================
select is((select confirmed from event_board_sections_v where id = :'past_shift'), 1,
  'fill counts CONFIRMED bookings only');
select is((select invited from event_board_sections_v where id = :'past_shift'), 1,
  'the invitation is counted separately and never as fill');
select is((select open_slots from event_board_sections_v where id = :'past_shift'), 2,
  'open is headcount - confirmed = 3 - 1, NOT (headcount + buffer) - confirmed: the buffer is an over-invitation allowance, not a seat to fill');

update bookings set status = 'worked' where id = :'bk_conf';
select is((select confirmed from event_board_sections_v where id = :'past_shift'), 1,
  'a worked booking still holds its slot — counting only `confirmed` would empty the board the moment an event finished');
update bookings set status = 'confirmed' where id = :'bk_conf';

select is((select final_pay_rate from event_board_sections_v where id = :'past_shift'),
  final_rate(14.00),
  'the section carries final pay through final_rate(), not a second copy of the 12.07% (§9.8)');

-- =====================================================================
-- The roster — a no-show is a flag, never a list
-- =====================================================================
select is((select count(*)::int from event_board_roster_v where event_id = :'past_event'), 2,
  'the roster is one row per booking');
select is((select no_show from event_board_roster_v where booking_id = :'bk_conf'), false,
  'nobody is a no-show yet');

select is(mark_no_show(:'bk_conf') ->> 'payrollExported', 'false',
  'a manual No-show on a shift whose payroll has not gone reports so');
select is((select status::text from event_board_roster_v where booking_id = :'bk_conf'), 'confirmed',
  'and the worker STAYS in Confirmed — §3.3: a no-show "stays listed inside Confirmed … rather than moving to a different list"');
select is((select no_show from event_board_roster_v where booking_id = :'bk_conf'), true,
  'carrying the badge as a flag on the row');
select isnt((select no_show_violation from event_board_roster_v where booking_id = :'bk_conf'), null,
  'and the violation id, because Get back IS resolve_violation() — the same act as Resolve in the §9.5 log, not a second implementation');
select is((select no_shows from event_board_sections_v where id = :'past_shift'), 1,
  'the section header counts it so the manager can see who needs replacing');

-- Get back, through the shared function.
select is(resolve_violation(
            (select no_show_violation from event_board_roster_v where booking_id = :'bk_conf'),
            'arrived late, worked the shift') ->> 'nowType', 'late',
  'Get back reclassifies the no-show to Late through the one shared function (§3.3, §9.5)');
select is((select no_show from event_board_roster_v where booking_id = :'bk_conf'), false,
  'and the badge clears');

-- Get back registers the worker as ARRIVED, so resolve_violation() moved
-- the booking to `worked` — that is the point of it. Put it back to
-- confirmed for the rest of the file, which tests the pre-arrival actions.
update bookings set status = 'confirmed' where id = :'bk_conf';

-- The payroll warning, which is returned rather than raised.
update events set payroll_exported_at = now() where id = :'past_event';
update violations set resolved = false where booking_id = :'bk_conf';
delete from violations where booking_id = :'bk_conf';
select is(mark_no_show(:'bk_conf') ->> 'payrollExported', 'true',
  'a No-show on an already-exported shift is ALLOWED and reports the export — §3.3 says the late No-show only affects the show-rate, and the money correction happens in THC''s finance process');
select is(mark_no_show(:'bk_conf') ->> 'messageKey', 'no_show_payroll_already_exported',
  'with the message key the screen turns into the sentence §3.3 dictates');
update events set payroll_exported_at = null where id = :'past_event';
delete from violations where booking_id = :'bk_conf';

-- The window at both ends.
select throws_ok($$ select mark_no_show('0a0a0a0a-0000-4000-8000-000000000001') $$,
  'P0001', null,
  'the No-show button does not open before the shift starts — a no-show recorded early is a prediction');
select throws_ok($$ select mark_no_show('0a0a0a0a-0000-4000-8000-0000000000e1',
                                        now() + interval '15 days') $$,
  'P0001', null,
  'and closes two weeks after it ends, when there is no pay-and-bill run left to affect (§3.3)');

-- =====================================================================
-- Withdraw
-- =====================================================================
select is(withdraw_booking(:'bk_inv') ->> 'wasStatus', 'invited',
  'an invitation can be withdrawn');
select is((select cancel_cause from bookings where id = :'bk_inv'), 'withdraw_invite',
  'and is marked as an invitation rather than a released slot — nobody had accepted it');
select is((select count(*)::int from notification_outbox
            where key = 'N10b:withdraw:' || :'bk_inv'), 0,
  'so no N10b: nothing was promised to withdraw');

select is(withdraw_booking(:'bk_conf') ->> 'withdrawn', 'true',
  'a confirmed worker can be withdrawn');
select is((select count(*)::int from notification_outbox
            where key = 'N10b:withdraw:' || :'bk_conf'), 1,
  'and is told, because this one WAS a promise (N10b)');

update bookings set status = 'worked', cancelled_at = null, cancel_cause = null where id = :'bk_conf';
select throws_ok($$ select withdraw_booking('0a0a0a0a-0000-4000-8000-0000000000e1') $$,
  'P0001', null,
  'a worked shift cannot be withdrawn — the record of it is payroll''s, and RULE-06 never corrects an export retroactively');

-- =====================================================================
-- Cancel event
-- =====================================================================
select throws_ok($$ select cancel_event('eeeeeeee-0000-4000-8000-0000000000e1', '  ') $$,
  'P0001', null,
  'cancelling needs a reason — same pattern as the manual Block (§9.6)');

update bookings set status = 'applied', applied_at = now(), cancelled_at = null, cancel_cause = null
 where id = :'bk_inv';
select is(cancel_event(:'past_event', 'Client cancelled the booking') ->> 'workersNotified', '1',
  'N12 reaches the open Radar application too — §3.3 names self-applicants specifically, because silence is the wrong answer to somebody still waiting');
select is((select count(*)::int from events where id = :'past_event' and cancelled_at is not null), 1,
  'and the event is MARKED, never deleted: it stays in the list and calendar greyed out for record-keeping');

reset role;
select * from finish();
rollback;
