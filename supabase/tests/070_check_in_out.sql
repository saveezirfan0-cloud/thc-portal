-- =====================================================================
-- 070 · the day of the shift (Scope §5.1–5.2b, RULE-01/02/14/15)
--
-- Two halves:
--
--  1. The shared vectors. Every case in packages/domain/src/pay.vectors.json
--     is run against the Postgres decision functions. The same cases are run
--     against packages/domain/pay.ts by Vitest, so the two implementations
--     cannot drift: if a rule changes, the vectors change and both suites move
--     together. The .psql below is generated from the JSON — see
--     packages/domain/scripts/gen-vectors-sql.mjs.
--
--  2. The two RPCs end to end: what attempt_check_in() and check_out() write
--     to check_logs, bookings and violations, who is allowed to call them, and
--     how payable_shifts_v then prices the result.
-- =====================================================================
begin;

\ir _shared/fixtures.psql
\ir _shared/pay_vectors.psql

select plan(
  (select count(*)::int from vec_check_in)
  + (select count(*)::int from vec_check_out)
  + (select count(*)::int from vec_pay)
  + (select count(*)::int from vec_turn_away)
  + (select count(*)::int from vec_breaks)
  + 35
);

-- ---------------------------------------------------------------------
-- 1 · the shared vectors
--
-- Offsets are minutes from the role section's scheduled start, so neither
-- side has to agree on a calendar. 14:00–22:00 UK on 14 June 2026 (BST).
-- ---------------------------------------------------------------------
create temporary view vbase as select timestamptz '2026-06-14 13:00:00+00' as base;

create function pg_temp.mins(p_base timestamptz, p_json jsonb, p_key text) returns timestamptz
language sql immutable as $$
  select case when p_json->p_key is null or jsonb_typeof(p_json->p_key) = 'null' then null
              else p_base + (p_json->>p_key)::int * interval '1 minute' end
$$;

-- check_in_decision returns the vector shape as it stands.
select is(
  check_in_decision(
    v.base,
    v.base + (c.input->>'shiftMin')::int * interval '1 minute',
    pg_temp.mins(v.base, c.input, 'atMinFromStart'),
    (c.input->>'insideGeofence')::boolean,
    pg_temp.mins(v.base, c.input, 'confirmedMinFromStart'),
    (c.input->>'slotsFilled')::int,
    (c.input->>'headcount')::int,
    (c.input->>'strictBuffer')::boolean),
  c.expect,
  'check-in · ' || c.name
) from vec_check_in c, vbase v;

-- check_out_decision returns a timestamp; the vectors speak in offsets.
create function pg_temp.as_vector(p_base timestamptz, p_decision jsonb) returns jsonb
language sql immutable as $$
  select jsonb_build_object(
    'decision', p_decision->>'decision',
    'recordedMinFromStart',
      case when jsonb_typeof(p_decision->'recordedAt') = 'null' then null
           else round(extract(epoch from ((p_decision->>'recordedAt')::timestamptz - p_base)) / 60)::int end,
    'violation', p_decision->>'violation',
    'messageKey', p_decision->>'messageKey',
    'leftEarly', (p_decision->>'leftEarly')::boolean)
$$;

select is(
  pg_temp.as_vector(v.base, check_out_decision(
    v.base,
    v.base + (c.input->>'shiftMin')::int * interval '1 minute',
    pg_temp.mins(v.base, c.input, 'atMinFromStart'),
    (c.input->>'insideGeofence')::boolean,
    pg_temp.mins(v.base, c.input, 'checkInMinFromStart'),
    pg_temp.mins(v.base, c.input, 'lastOnSiteMinFromStart'))),
  c.expect,
  'check-out · ' || c.name
) from vec_check_out c, vbase v;

select is(
  payable_minutes(
    v.base,
    v.base + (c.input->>'shiftMin')::int * interval '1 minute',
    pg_temp.mins(v.base, c.input, 'checkInMinFromStart'),
    pg_temp.mins(v.base, c.input, 'checkOutMinFromStart'),
    (c.input->>'unpaidBreakMin')::int,
    (c.input->>'leftEarlyViolation')::boolean,
    c.input->>'noCheckOut'),
  c.expect,
  'pay · ' || c.name
) from vec_pay c, vbase v;

select is(
  turned_away_minutes(v.base, pg_temp.mins(v.base, c.input, 'attemptMinFromStart')),
  (c.expect->>'payMin')::int,
  'turn-away · ' || c.name
) from vec_turn_away c, vbase v;

-- §5.2b / D49: each break clipped to the paid window, then summed.
select is(
  (select coalesce(sum(break_window_minutes(
            v.base,
            v.base + (c.input->>'shiftMin')::int * interval '1 minute',
            pg_temp.mins(v.base, c.input, 'checkInMinFromStart'),
            pg_temp.mins(v.base, c.input, 'finishMinFromStart'),
            v.base + (br->>0)::int * interval '1 minute',
            case when jsonb_typeof(br->1) = 'null' then null
                 else v.base + (br->>1)::int * interval '1 minute' end)), 0)::int
     from jsonb_array_elements(c.input->'breaks') br),
  (c.expect->>'unpaidBreakMin')::int,
  'breaks · ' || c.name
) from vec_breaks c, vbase v;

-- ---------------------------------------------------------------------
-- 2 · the RPCs end to end
--
-- Today's event: a Waiting Staff section under a strict buffer (the client
-- does not pay for it, §3.2) that started 10 minutes ago. The shift is walked
-- backwards through the day between blocks, so one fixture covers check-in,
-- the No-show lock, check-out and RULE-02.
-- ---------------------------------------------------------------------
\set today_event  '7e7e7e7e-0000-4000-8000-000000000001'
\set today_shift  '7f7f7f7f-0000-4000-8000-000000000001'
\set book_ontime  '7a7a7a7a-0000-4000-8000-000000000001'
\set book_late    '7a7a7a7a-0000-4000-8000-000000000002'
\set book_locked  '7a7a7a7a-0000-4000-8000-000000000003'
\set staff_late   'dddddddd-0000-4000-8000-00000000000a'
\set staff_locked 'dddddddd-0000-4000-8000-00000000000b'
\set user_late    '66666666-6666-6666-6666-666666666666'
\set user_locked  '77777777-7777-7777-7777-777777777777'

-- Identity is what attempt_check_in() and check_out() authorise against, so
-- every press below runs under the pressing worker's own JWT claims. The SQL
-- role stays the migration role after the first block: these are
-- security-definer RPCs, and the assertions have to read tables the worker
-- holds no select policy on.
insert into auth.users (id, email) values (:'user_late', 'late@rls.test'), (:'user_locked', 'locked@rls.test');
insert into profiles (id, role, full_name) values
  (:'user_late', 'staff', 'Staff Late worker'), (:'user_locked', 'staff', 'Staff Locked worker');
insert into staff (id, user_id, employee_id, first_name, last_name, email, phone, dob, status) values
  (:'staff_late',   :'user_late',   90003, 'Staff', 'Late',   'late@rls.test',   '+447700900013', date '1993-03-03', 'compliant'),
  (:'staff_locked', :'user_locked', 90004, 'Staff', 'Locked', 'locked@rls.test', '+447700900014', date '1992-04-04', 'compliant');

-- pays_buffer false = the strict policy; pays_breaks false = breaks deducted.
insert into events (id, client_id, venue_id, venue_name, venue_address, venue_location, geofence_radius_m,
                    title, event_date, pays_breaks, pays_buffer) values
  (:'today_event', :'clienta', :'venue_id', 'RLS Fixture Venue', '1 Test Street, London',
   st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150, 'Today Gala', current_date, false, false);

-- headcount 1 (+1 buffer): the second arrival is the RULE-15 case.
insert into shift_requirements (id, event_id, role_id, starts_at, ends_at, headcount, buffer,
                                charge_rate, pay_rate, allocation_per_hour) values
  (:'today_shift', :'today_event', :'role_id', now() - interval '10 minutes', now() + interval '7 hours 50 minutes',
   1, 1, 22.97, 14.00, 2);

insert into bookings (id, shift_id, staff_id, status, source, confirmed_at) values
  (:'book_ontime', :'today_shift', :'staffa',       'confirmed', 'auto',       now() - interval '2 days'),
  (:'book_late',   :'today_shift', :'staff_late',   'confirmed', 'auto',       now() - interval '2 days'),
  (:'book_locked', :'today_shift', :'staff_locked', 'confirmed', 'escalation', now() - interval '2 days');

-- ---- the worker's own press, on site --------------------------------
set local "request.jwt.claims" = '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}';
set local role authenticated;

select is(
  attempt_check_in(:'book_ontime', 51.5000, -0.1000)->>'decision',
  'checked_in_late',
  '§5.1 a worker checks themselves in through the RPC, 10 minutes late'
);
select is(
  attempt_check_in(:'book_ontime', 51.5000, -0.1000)->>'decision',
  'already_checked_in',
  'a second press does not check the worker in twice'
);
select throws_ok(
  format('select attempt_check_in(%L, 51.5, -0.1)', :'book_late'),
  '42501', null,
  'a worker cannot check in against somebody else''s booking'
);
reset role;
set local "request.jwt.claims" = '{"sub":"66666666-6666-6666-6666-666666666666","role":"authenticated"}';

-- What that press wrote. Read back as the migration role: the worker holds no
-- select policy on check_logs or violations, which is the whole reason the
-- day of the shift goes through these two security-definer RPCs.
select is(
  (select outcome::text from check_logs where booking_id = :'book_ontime'),
  'checked_in',
  '§1.5 the attempt is logged as one CheckLog row'
);
select is(
  (select status::text from bookings where id = :'book_ontime'),
  'worked',
  '§3.6 the booking moves confirmed → worked'
);
select is(
  (select minutes_late from violations where booking_id = :'book_ontime' and type = 'late'),
  10,
  '§9.5 a Late violation is raised with the minutes from the actual press'
);

-- ---- off site, then the strict-buffer turn-away ---------------------
select is(
  attempt_check_in(:'book_late', 51.6000, -0.1000)->>'decision',
  'out_of_radius',
  '§5.1 a press from outside the geofence cannot check anyone in'
);
select is(
  (select count(*)::int from check_logs where booking_id = :'book_late' and outcome = 'out_of_radius'),
  1,
  '§1.5 the out-of-radius attempt is logged all the same'
);
select is(
  (select status::text from bookings where id = :'book_late'),
  'confirmed',
  'an out-of-radius press leaves the booking alone'
);

select is(
  attempt_check_in(:'book_late', 51.5000, -0.1000)->>'turnAwayPayMin',
  '240',
  'RULE-15 the worker past the headcount is turned away, on time, a flat four hours'
);
select is(
  (select count(*)::int from check_logs where booking_id = :'book_late' and outcome = 'turned_away'),
  1,
  'RULE-15 rests on CheckLog.attempted_at, so the turn-away is a logged attempt'
);
select is(
  (select status::text from bookings where id = :'book_late'),
  'turned_away',
  '§3.6 the turned-away booking carries its own status'
);
select is(
  (select kind from payable_shifts_v where booking_id = :'book_late'),
  'turned_away',
  'payable_shifts_v says which rule paid the row'
);
select is(
  (select (pay->>'payableMin')::int from payable_shifts_v where booking_id = :'book_late'),
  240,
  'RULE-15 payable_shifts_v prices the turn-away at a flat four hours, not half the shift'
);

-- ---- the No-show lock ------------------------------------------------
set local "request.jwt.claims" = '{"sub":"77777777-7777-7777-7777-777777777777","role":"authenticated"}';
update shift_requirements set starts_at = now() - interval '45 minutes',
                              ends_at   = now() + interval '7 hours 15 minutes',
                              headcount = 6
  where id = :'today_shift';

select is(
  attempt_check_in(:'book_locked', 51.5000, -0.1000)->>'decision',
  'locked',
  '§5.1 at start+30 the button locks — the worker can no longer check themselves in'
);
select is(
  (select count(*)::int from check_logs where booking_id = :'book_locked'),
  0,
  'a locked press is not a CheckLog row: the button was never live'
);
select is(
  (select count(*)::int from violations where booking_id = :'book_locked' and type = 'no_show'),
  1,
  '§9.5 the automatic No-show violation is recorded once'
);
select is(
  (select (pay->>'payableMin')::int from payable_shifts_v where booking_id = :'book_locked'),
  0,
  'RULE-14 never lifts someone who did not work: a No-show is paid nothing'
);

-- The §3.4 replacement: confirmed after the shift had already started.
update bookings set confirmed_at = now() - interval '20 minutes' where id = :'book_locked';
select is(
  attempt_check_in(:'book_locked', 51.5000, -0.1000)->>'decision',
  'checked_in_late',
  '§5.1 a booking confirmed after the start is exempt from the 30-minute lock'
);

-- ---- check-out -------------------------------------------------------
-- Walk the shift into the past: 8 hours, finished 45 minutes ago, with both
-- workers checked in at the scheduled start.
update shift_requirements set starts_at = now() - interval '8 hours 45 minutes',
                              ends_at   = now() - interval '45 minutes'
  where id = :'today_shift';
update check_logs cl set check_in_at = now() - interval '8 hours 45 minutes'
  from bookings b where b.id = cl.booking_id and b.shift_id = :'today_shift' and cl.check_in_at is not null;
set local "request.jwt.claims" = '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}';

select is(
  check_out(:'book_ontime', 51.5000, -0.1000)->>'decision',
  'recorded_on_site',
  '§5.1 an on-site check-out records the press itself'
);
select is(
  (select (pay->>'lateCheckOutFlag')::boolean from payable_shifts_v where booking_id = :'book_ontime'),
  true,
  '§9.5 a recorded check-out more than 15 minutes past the end is flagged'
);
select is(
  (select (pay->>'payableMin')::int from payable_shifts_v where booking_id = :'book_ontime'),
  8 * 60,
  'RULE-01 a late check-out is still paid only to the scheduled end'
);
select is(
  check_out(:'book_ontime', 51.5000, -0.1000)->>'decision',
  'already_checked_out',
  'a second check-out does not move the recorded time'
);

-- Off site with nothing from background tracking after check-in.
set local "request.jwt.claims" = '{"sub":"77777777-7777-7777-7777-777777777777","role":"authenticated"}';
select is(
  check_out(:'book_locked', 51.6000, -0.1000)->>'decision',
  'no_on_site_fix',
  '§5.1 off site with no on-site fix raises RULE-02 on the press, not a zero-length shift'
);
select is(
  (select count(*)::int from violations where booking_id = :'book_locked' and type = 'no_checkout'),
  1,
  'RULE-02 the No check-out violation is raised immediately on that press'
);

-- Same press, but background tracking has a fix from two hours ago.
update check_logs set check_out_at = null, check_out_pressed_at = null where booking_id = :'book_locked';
delete from violations where booking_id = :'book_locked' and type = 'no_checkout';
insert into location_pings (booking_id, at, location, inside_geofence) values
  (:'book_locked', now() - interval '2 hours',
   st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, true);

select is(
  check_out(:'book_locked', 51.6000, -0.1000)->>'decision',
  'recorded_last_on_site',
  '§5.1 off site records the last on-site fix, not the press'
);
select cmp_ok(
  (select check_out_at from check_logs where booking_id = :'book_locked'),
  '<', now() - interval '1 hour 59 minutes',
  'the recorded finish is that fix, hours before the button was pressed (§5.2)'
);

-- ---- RULE-02: four hours past the end --------------------------------
set local "request.jwt.claims" = '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}';
update shift_requirements set starts_at = now() - interval '12 hours 30 minutes',
                              ends_at   = now() - interval '4 hours 30 minutes'
  where id = :'today_shift';
update check_logs set check_out_at = null, check_out_pressed_at = null, last_on_site_at = null,
                      check_in_at = now() - interval '12 hours 30 minutes'
  where booking_id = :'book_ontime';

select is(
  check_out(:'book_ontime', 51.5000, -0.1000)->>'decision',
  'locked',
  'RULE-02 four hours after the scheduled end the check-out button locks'
);
select is(
  (select check_out_at from check_logs where booking_id = :'book_ontime'),
  null,
  'RULE-02 nothing is recorded, and nothing defaults to the scheduled finish'
);
select is(
  (select pay->>'status' from payable_shifts_v where booking_id = :'book_ontime'),
  'undetermined',
  'RULE-02 the payable time stays undetermined until a manager resolves it'
);
select is(
  (select (pay->>'payableMin')::int from payable_shifts_v where booking_id = :'book_ontime'),
  null,
  'RULE-02 undetermined means no figure at all, not zero and not the scheduled end'
);

-- The manager resolves it by entering the actual finish time (§9.5).
update violations set resolved = true, resolved_at = now(),
                      actual_finish_at = (select starts_at + interval '2 hours' from shift_requirements where id = :'today_shift')
  where booking_id = :'book_ontime' and type = 'no_checkout';
update check_logs set manager_finish_at = (select starts_at + interval '2 hours' from shift_requirements where id = :'today_shift')
  where booking_id = :'book_ontime';

select is(
  (select (pay->>'workedMin')::int from payable_shifts_v where booking_id = :'book_ontime'),
  120,
  'RULE-01 the manager-entered finish time is what the pay window then prices'
);
select is(
  (select (pay->>'payableMin')::int from payable_shifts_v where booking_id = :'book_ontime'),
  240,
  'RULE-14 resolving the No check-out restores the four-hour floor'
);
select is(
  (select (pay->>'floorApplied')::boolean from payable_shifts_v where booking_id = :'book_ontime'),
  true,
  'RULE-14 and the row says the floor is what paid it, not the clock'
);

-- ---- §11.1 · no money reaches the client ----------------------------
-- payable_shifts_v carries pay_rate and charge_rate. It is security_invoker,
-- and 0002 left the client role with no policy on shift_requirements, so the
-- join yields nothing at all for a client — the view cannot hand back a rate.
reset role;
set local "request.jwt.claims" = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
set local role authenticated;
select is(
  (select count(*)::int from payable_shifts_v),
  0,
  '§11.1 a client reads no row of payable_shifts_v — no pay rate, no charge rate, no margin'
);
reset role;

select * from finish();
rollback;
