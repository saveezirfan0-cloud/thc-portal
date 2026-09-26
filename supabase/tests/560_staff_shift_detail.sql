-- =====================================================================
-- 560 · The worker's shift screen reads its shift (§10.4, §5.1)
--   20260927110000_staff_shift_detail.sql
--
-- docs/15 §2 blocker 1: `/shifts/:id` embedded shift_requirements, events,
-- roles, check_logs and breaks through the booking, and the staff role
-- reads none of them, so a real worker's check-in screen had no times, no
-- venue, no role and no check log. staff_shift_detail() is the definer
-- reader that replaces the embed.
--
--   A. A worker sees their own shift: role window, base rate, venue and
--      its centre, the accepted check log, their breaks.
--   B. Not anybody else's: another worker's booking, a client login and
--      anon all get nothing — and the base tables stay closed to staff,
--      which is the point of doing it this way (ADR-0004).
--   C. No charge rate, margin, PO or client in the result's columns or
--      values.
--   D. On-site contact is withheld until the booking is accepted.
--   E. The three §10.4 static-screen inputs: a cancelled event, an office
--      withdrawal, and an unresolved RULE-02 No check-out.
--   F. §5.1 check-out from anywhere: check_out() with NO coordinates at
--      all records the last on-site fix, and with no on-site fix raises
--      the No check-out violation rather than failing or defaulting.
--   G. §3.2 strict buffer turn-away (20260928120000): the screen reads the
--      logged attempt and RULE-15's minutes for it, so "Thanks for coming"
--      carries the four-hour sentence on every visit only when on time.
-- =====================================================================
begin;
select plan(38);
\ir _shared/fixtures.psql

\set ev_cx   'c5600000-0000-4000-8000-000000000001'
\set sh_run  'c5600000-0000-4000-8000-000000000011'
\set sh_nfx  'c5600000-0000-4000-8000-000000000012'
\set sh_cx   'c5600000-0000-4000-8000-000000000013'
\set sh_wd   'c5600000-0000-4000-8000-000000000014'
\set sh_inv  'c5600000-0000-4000-8000-000000000015'
\set b_run   'c5600000-0000-4000-8000-000000000021'
\set b_nfx   'c5600000-0000-4000-8000-000000000022'
\set b_cx    'c5600000-0000-4000-8000-000000000023'
\set b_wd    'c5600000-0000-4000-8000-000000000024'
\set b_inv   'c5600000-0000-4000-8000-000000000025'
\set ev_sb    'c5600000-0000-4000-8000-000000000002'
\set sh_ta_on 'c5600000-0000-4000-8000-000000000016'
\set sh_ta_lt 'c5600000-0000-4000-8000-000000000017'
\set b_ta_on  'c5600000-0000-4000-8000-000000000026'
\set b_ta_lt  'c5600000-0000-4000-8000-000000000027'
\set b_fl_on  'c5600000-0000-4000-8000-000000000028'
\set b_fl_lt  'c5600000-0000-4000-8000-000000000029'

update events set onsite_contact = 'Priya on 07700 900999', notes = 'Stage door on Godliman St'
 where id = :'event_a';

insert into events (id, client_id, venue_id, venue_name, venue_address, venue_location,
                    geofence_radius_m, title, event_date, pays_breaks, pays_buffer,
                    cancelled_at, cancel_reason) values
  (:'ev_cx', :'clienta', :'venue_id', 'RLS Fixture Venue', '1 Test Street, London',
   st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150,
   'Fixture Cancelled Event', current_date + 9, true, true, now(), 'Client postponed');

insert into shift_requirements (id, event_id, role_id, starts_at, ends_at, headcount, buffer,
                                charge_rate, pay_rate, dress_code, allocation_per_hour) values
  -- Two sections under way right now: one with an on-site ping, one without.
  (:'sh_run', :'event_a', :'role_id', now() - interval '3 hours', now() + interval '1 hour',
   2, 0, 22.97, 14.00, 'Black tie', 2),
  (:'sh_nfx', :'event_b', :'role_id', now() - interval '3 hours', now() + interval '1 hour',
   2, 0, 19.50, 13.50, 'Smart black', 2),
  (:'sh_cx',  :'ev_cx',   :'role_id', now() + interval '9 days', now() + interval '9 days 6 hours',
   2, 0, 22.97, 14.00, 'Black tie', 2),
  (:'sh_wd',  :'event_a', :'role_id', now() + interval '7 days 9 hours',
   now() + interval '7 days 13 hours', 2, 0, 22.97, 14.00, 'Black tie', 2),
  (:'sh_inv', :'event_a', :'role_id', now() + interval '7 days 14 hours',
   now() + interval '7 days 18 hours', 2, 0, 22.97, 14.00, 'Black tie', 2);

insert into bookings (id, shift_id, staff_id, status, source, confirmed_at, cancelled_at, cancel_cause) values
  (:'b_run', :'sh_run', :'staffa', 'worked',    'auto',   now() - interval '2 days', null, null),
  (:'b_nfx', :'sh_nfx', :'staffa', 'worked',    'auto',   now() - interval '2 days', null, null),
  (:'b_cx',  :'sh_cx',  :'staffa', 'cancelled', 'auto',   now() - interval '2 days', now(), 'event_cancelled'),
  (:'b_wd',  :'sh_wd',  :'staffa', 'cancelled', 'manual', now() - interval '2 days', now(), 'office_withdraw'),
  (:'b_inv', :'sh_inv', :'staffa', 'invited',   'manual', null, null, null);

insert into check_logs (booking_id, outcome, check_in_at) values
  (:'b_run', 'checked_in', now() - interval '3 hours'),
  (:'b_nfx', 'checked_in', now() - interval '3 hours');

insert into location_pings (booking_id, at, location, inside_geofence) values
  (:'b_run', now() - interval '20 minutes',
   st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, true);

-- ---------------------------------------------------------------------
-- A · the worker's own shift
-- ---------------------------------------------------------------------
set local "request.jwt.claims" = '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}';
set local role authenticated;

select is((select count(*)::int from staff_shift_detail(:'booking_a')), 1,
  'A: a worker gets their own booking back as one row');
select is((select event_title from staff_shift_detail(:'booking_a')), 'Fixture Event A',
  'A: with the event title the embed used to lose');
select is((select role from staff_shift_detail(:'booking_a')), 'RLS Fixture Role',
  'A: with the role name');
select is((select venue_name || ', ' || venue_address from staff_shift_detail(:'booking_a')),
  'RLS Fixture Venue, 1 Test Street, London', 'A: with the venue and its address');
select ok((select starts_at > now() + interval '6 days' and ends_at - starts_at = interval '8 hours'
             from staff_shift_detail(:'booking_a')),
  'A: with the role section''s own window (RULE-18)');
select is((select pay_rate from staff_shift_detail(:'booking_a')), 14.00::numeric,
  'A: with the worker''s base rate');
select is((select dress_code from staff_shift_detail(:'booking_a')), 'Black tie',
  'A: with the dress code');
select ok((select abs(venue_lat - 51.5) < 1e-6 and abs(venue_lng + 0.1) < 1e-6
             from staff_shift_detail(:'booking_a')),
  'A: with the venue centre as two numbers for the distance line');
select is((select geofence_radius_m from staff_shift_detail(:'booking_a')), 150,
  'A: with the geofence radius');
select ok((select check_in_at is not null from staff_shift_detail(:'booking_a')),
  'A: with the accepted check-in, which staff cannot read from check_logs');
select is((select jsonb_array_length(breaks) from staff_shift_detail(:'booking_a')), 1,
  'A: with the worker''s breaks, which staff cannot read from breaks');

-- ---------------------------------------------------------------------
-- B · nobody else's
-- ---------------------------------------------------------------------
select is_empty($$ select * from staff_shift_detail('0a0a0a0a-0000-4000-8000-000000000002') $$,
  'B: another worker''s booking id returns nothing');
select is_empty($$ select 1 from shift_requirements where id = 'ffffffff-0000-4000-8000-000000000001' $$,
  'B: the staff role still has no read on shift_requirements (ADR-0004)');
select is_empty($$ select 1 from events where id = 'eeeeeeee-0000-4000-8000-000000000001' $$,
  'B: nor on events');
reset role;

set local "request.jwt.claims" = '{"sub":"55555555-5555-5555-5555-555555555555","role":"authenticated"}';
set local role authenticated;
select is_empty($$ select * from staff_shift_detail('0a0a0a0a-0000-4000-8000-000000000001') $$,
  'B: and the other worker cannot read this one''s either');
reset role;

set local "request.jwt.claims" = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
set local role authenticated;
select is_empty($$ select * from staff_shift_detail('0a0a0a0a-0000-4000-8000-000000000001') $$,
  'B: a client login gets nothing, even for a booking on its own event');
reset role;

select ok(not has_function_privilege('anon', 'public.staff_shift_detail(uuid)', 'execute'),
  'B: anon cannot execute it');
select ok(has_function_privilege('authenticated', 'public.staff_shift_detail(uuid)', 'execute'),
  'B: a signed-in worker can');

-- ---------------------------------------------------------------------
-- C · no money the worker should not see
-- ---------------------------------------------------------------------
select ok(pg_get_function_result('public.staff_shift_detail(uuid)'::regprocedure)
            !~* '(charge|margin|po_number|client|holiday)',
  'C: no charge rate, margin, PO, client or holiday column in the result');

set local "request.jwt.claims" = '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}';
set local role authenticated;
-- Compared field by field, not as text: the row carries now()-derived
-- timestamps, and one stamped at hh:mm:22.97… matched a text search for
-- '22.97' (PR #79 CI, 19:36:22.97).
select ok(not exists (select 1
                        from staff_shift_detail(:'booking_a') d,
                             jsonb_each(to_jsonb(d)) e
                       where e.value = to_jsonb(22.97::numeric)
                          or e.value #>> '{}' = '22.97'),
  'C: and the section''s charge rate value appears nowhere in the row');

-- ---------------------------------------------------------------------
-- D · withheld until accepted (§10.4, §3.2)
-- ---------------------------------------------------------------------
select is((select onsite_contact from staff_shift_detail(:'booking_a')), 'Priya on 07700 900999',
  'D: a confirmed booking shows the on-site contact');
select ok((select onsite_contact is null and notes is null and pays_breaks is null
             from staff_shift_detail(:'b_inv')),
  'D: an invitation does not');

-- ---------------------------------------------------------------------
-- E · the static-screen inputs (§10.4)
-- ---------------------------------------------------------------------
select ok((select event_cancelled_at is not null from staff_shift_detail(:'b_cx')),
  'E: a cancelled event is reachable by id and says it was cancelled (N12)');
select is((select cancel_cause from staff_shift_detail(:'b_wd')), 'office_withdraw',
  'E: an office withdrawal is reachable by id and says so (N10b)');
select ok((select not no_checkout_open from staff_shift_detail(:'b_nfx')),
  'E: no No check-out flag before one is raised');

-- ---------------------------------------------------------------------
-- F · check-out with no coordinates at all (§5.1)
-- ---------------------------------------------------------------------
select is((select check_out(:'b_run', null, null) ->> 'decision'), 'recorded_last_on_site',
  'F: no GPS fix still checks out, at the last on-site fix');
select ok((select check_out_at between now() - interval '21 minutes' and now() - interval '19 minutes'
             from staff_shift_detail(:'b_run')),
  'F: and the screen reads that fix back as the finish');
select is((select check_out(:'b_nfx', null, null) ->> 'decision'), 'no_on_site_fix',
  'F: with no on-site fix either, the press is accepted and RULE-02 decides');
select ok((select no_checkout_open from staff_shift_detail(:'b_nfx')),
  'F: which raises the No check-out violation, never a silent default');
reset role;

select is((select count(*)::int from violations where booking_id = :'b_nfx' and type = 'no_checkout'), 1,
  'F: exactly one No check-out violation on the booking');

-- ---------------------------------------------------------------------
-- G · the strict-buffer turn-away (§3.2, RULE-15)
--
-- An event that does NOT pay for its buffer, headcount 1, and the one slot
-- already taken by another worker's check-in on each section. Worker A then
-- presses Check in on site: once inside the grace (on time), once after it.
-- ---------------------------------------------------------------------
insert into events (id, client_id, venue_id, venue_name, venue_address, venue_location,
                    geofence_radius_m, title, event_date, pays_breaks, pays_buffer) values
  (:'ev_sb', :'clienta', :'venue_id', 'RLS Fixture Venue', '1 Test Street, London',
   st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150,
   'Fixture Strict Buffer Event', current_date, false, false);

insert into shift_requirements (id, event_id, role_id, starts_at, ends_at, headcount, buffer,
                                charge_rate, pay_rate, dress_code, allocation_per_hour) values
  -- Check-in open, the start still ten minutes away: an attempt now is on time.
  (:'sh_ta_on', :'ev_sb', :'role_id', now() + interval '10 minutes',
   now() + interval '4 hours 10 minutes', 1, 1, 22.97, 14.00, 'Black tie', 2),
  -- Started 45 minutes ago: the grace has elapsed, so an attempt now is late.
  (:'sh_ta_lt', :'ev_sb', :'role_id', now() - interval '45 minutes',
   now() + interval '3 hours 15 minutes', 1, 1, 22.97, 14.00, 'Black tie', 2);

insert into bookings (id, shift_id, staff_id, status, source, confirmed_at) values
  (:'b_fl_on', :'sh_ta_on', :'staffb', 'worked',    'auto', now() - interval '2 days'),
  (:'b_fl_lt', :'sh_ta_lt', :'staffb', 'worked',    'auto', now() - interval '2 days'),
  (:'b_ta_on', :'sh_ta_on', :'staffa', 'confirmed', 'auto', now() - interval '2 days'),
  (:'b_ta_lt', :'sh_ta_lt', :'staffa', 'confirmed', 'auto', now() - interval '2 days');

insert into check_logs (booking_id, outcome, check_in_at) values
  (:'b_fl_on', 'checked_in', now()),
  (:'b_fl_lt', 'checked_in', now() - interval '40 minutes');

set local "request.jwt.claims" = '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}';
set local role authenticated;

select is((select attempt_check_in(:'b_ta_on', 51.5000, -0.1000) ->> 'decision'), 'turned_away',
  'G: past the headcount under a strict buffer, an on-site press is turned away');
select is((select status from staff_shift_detail(:'b_ta_on')), 'turned_away',
  'G: and the screen reads the booking back as turned away');
select is((select turned_away_at from staff_shift_detail(:'b_ta_on')), now(),
  'G: with the logged attempt''s own timestamp (CheckLog.attempted_at, §1.5)');
select is((select turned_away_pay_min from staff_shift_detail(:'b_ta_on')), 240,
  'G: on time, RULE-15''s flat four hours — the screen shows the paid sentence');

select is((select attempt_check_in(:'b_ta_lt', 51.5000, -0.1000) ->> 'turnAwayPayMin'), '0',
  'G: a turn-away after the grace is paid nothing');
select ok((select turned_away_at is not null and turned_away_pay_min = 0
             from staff_shift_detail(:'b_ta_lt')),
  'G: and the screen reads 0 back, so the paid sentence is withheld on every visit');

select ok((select turned_away_at is null and turned_away_pay_min is null
             from staff_shift_detail(:'b_run')),
  'G: a shift with no turn-away carries neither');
reset role;

select ok((select bool_and((p.pay ->> 'payableMin')::int = d.turned_away_pay_min)
             from (values (:'b_ta_on'::uuid), (:'b_ta_lt'::uuid)) x(id)
             join payable_shifts_v p on p.booking_id = x.id
             cross join lateral staff_shift_detail(x.id) d),
  'G: what the screen says matches what payable_shifts_v pays');

select * from finish();
rollback;
