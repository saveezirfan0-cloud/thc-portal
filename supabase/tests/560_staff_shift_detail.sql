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
-- =====================================================================
begin;
select plan(30);
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
select ok((select to_jsonb(d)::text from staff_shift_detail(:'booking_a') d) !~ '22\.97',
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

select * from finish();
rollback;
