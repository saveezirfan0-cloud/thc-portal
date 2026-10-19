-- =====================================================================
-- 873 · booking_tick's bounded working set (20261019194300, ADR-0157;
--       go-live database audit F6, concurrency audit M1/M5)
--
--   A · no temporary table, the window on every working-set read, one run
--       at a time, and the No-show / No check-out raised only after the
--       presses' own locks are taken
--   B · outside the window nothing is touched: a No-show or No check-out
--       a section ended more than seven days ago never raised stays
--       unraised (the tick never reads it again)
--   C · inside it every transition still happens, at the edges the proof
--       relies on: a No check-out and a No-show caught up six days late
--       (a cron outage), a section longer than a week still reminded
--       before its end, and N6's longest lead (08:00 the day before a
--       23:00 start)
--   D · check_out, when BG-09 raised No check-out while it waited,
--       answers `locked` and records nothing — one outcome, never both
--
-- 170 and 611 restate every rule's own timing and still pass unchanged.
-- February 2026: UK time is UTC. Every instant is fixed except D's.
-- =====================================================================
begin;
select plan(16);
\ir _shared/fixtures.psql

update shift_requirements set starts_at = timestamptz '2027-06-01 10:00+00',
                              ends_at   = timestamptz '2027-06-01 18:00+00';

\set now   '2026-02-10 16:30:00+00'
\set evt   '87300000-0000-4000-8000-00000000000a'
\set sA    '87310000-0000-4000-8000-00000000000a'
\set sB    '87310000-0000-4000-8000-00000000000b'
\set sC    '87310000-0000-4000-8000-00000000000c'
\set sD    '87310000-0000-4000-8000-00000000000d'
\set sE    '87310000-0000-4000-8000-00000000000e'
\set sF    '87310000-0000-4000-8000-00000000000f'
\set sH    '87310000-0000-4000-8000-000000000011'
\set bA    '87320000-0000-4000-8000-00000000000a'
\set bB    '87320000-0000-4000-8000-00000000000b'
\set bC    '87320000-0000-4000-8000-00000000000c'
\set bD    '87320000-0000-4000-8000-00000000000d'
\set bE    '87320000-0000-4000-8000-00000000000e'
\set bF    '87320000-0000-4000-8000-00000000000f'
\set bH    '87320000-0000-4000-8000-000000000011'

-- ---------------------------------------------------------------------
-- A · The shape
-- ---------------------------------------------------------------------
create temporary table t_src as
select prosrc from pg_proc where oid = 'public.booking_tick(timestamp with time zone)'::regprocedure;

select ok((select prosrc !~* 'create\s+temporary\s+table' and prosrc !~* 'drop\s+table' from t_src),
  'no temporary table is created or dropped any more');
select is((select count(*)::int from t_src, regexp_matches(prosrc,
             'and s\.starts_at < p_now \+ interval ''3 days''\s+and s\.ends_at\s+> p_now - interval ''7 days''', 'g')),
          10, 'every read of the working set (eight rules, two lock steps) carries the window');
select ok((select prosrc ~ 'pg_try_advisory_xact_lock\(hashtextextended\(''booking_tick'', 0\)\)' from t_src),
  'a second overlapping run steps aside');
select ok((select regexp_instr(prosrc, 'for no key update of sl') between 1 and regexp_instr(prosrc, '''no_show'', p_now from due')
             and regexp_instr(prosrc, 'for no key update of ck') between 1 and regexp_instr(prosrc, '''no_checkout'', p_now from due')
           from t_src),
  'the sections are locked before the No-show is raised, the check-ins before the No check-out');

-- ---------------------------------------------------------------------
-- The world (pays_breaks false, so BG-10 is live too)
-- ---------------------------------------------------------------------
insert into events (id, client_id, venue_id, venue_name, venue_address, venue_location,
                    geofence_radius_m, title, event_date, pays_breaks, pays_buffer) values
  (:'evt', :'clienta', :'venue_id', 'RLS Fixture Venue', '1 Test Street, London',
   st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150,
   'Window Dinner', date '2026-02-10', false, true);

insert into shift_requirements (id, event_id, role_id, starts_at, ends_at, headcount, buffer,
                                charge_rate, pay_rate, allocation_per_hour) values
  -- B · ended 8 days 22 h before the tick: an old No-show never raised.
  (:'sA', :'evt', :'role_id', '2026-02-01 10:00+00', '2026-02-01 18:00+00', 1, 0, 30, 15, 1),
  -- B · ended 8 days 30 min before: an old No check-out never raised.
  (:'sB', :'evt', :'role_id', '2026-02-02 08:00+00', '2026-02-02 16:00+00', 1, 0, 30, 15, 1),
  -- C · ended 6 days 30 min before: the No check-out, caught up.
  (:'sC', :'evt', :'role_id', '2026-02-04 08:00+00', '2026-02-04 16:00+00', 1, 0, 30, 15, 1),
  -- C · ended 5 days 22 h 30 min before: the No-show, caught up.
  (:'sD', :'evt', :'role_id', '2026-02-04 10:00+00', '2026-02-04 18:00+00', 1, 0, 30, 15, 1),
  -- C · eleven days long, ending at 17:00: N9's check-out half at 16:30.
  (:'sE', :'evt', :'role_id', '2026-01-30 17:00+00', '2026-02-10 17:00+00', 1, 0, 30, 15, 1),
  -- C · 23:00 tomorrow: N6 at 08:00 today, 39 h ahead.
  (:'sF', :'evt', :'role_id', '2026-02-11 23:00+00', '2026-02-12 05:00+00', 1, 0, 30, 15, 1);

insert into bookings (id, shift_id, staff_id, status, source, confirmed_at) values
  (:'bA', :'sA', :'staffa', 'confirmed', 'auto', '2026-01-20 10:00+00'),
  (:'bB', :'sB', :'staffa', 'worked',    'auto', '2026-01-20 10:00+00'),
  (:'bC', :'sC', :'staffa', 'worked',    'auto', '2026-01-20 10:00+00'),
  (:'bD', :'sD', :'staffb', 'confirmed', 'auto', '2026-01-20 10:00+00'),
  (:'bE', :'sE', :'staffb', 'worked',    'auto', '2026-01-20 10:00+00'),
  (:'bF', :'sF', :'staffa', 'confirmed', 'auto', '2026-01-20 10:00+00');

insert into check_logs (booking_id, outcome, attempted_at, check_in_at) values
  (:'bB', 'checked_in', '2026-02-02 08:00+00', '2026-02-02 08:00+00'),
  (:'bC', 'checked_in', '2026-02-04 08:00+00', '2026-02-04 08:00+00'),
  (:'bE', 'checked_in', '2026-01-30 17:00+00', '2026-01-30 17:00+00');
-- bE took a break, so BG-10 stays quiet on the long section.
insert into breaks (booking_id, started_at, ended_at)
values (:'bE', '2026-01-31 01:00+00', '2026-01-31 01:30+00');

create temporary table t_run as select booking_tick(:'now'::timestamptz) as counts;

select ok((select not (counts ? 'skipped') from t_run), 'a run that holds the lock reports no skip');

-- ---------------------------------------------------------------------
-- B · Outside the window
-- ---------------------------------------------------------------------
select is((select count(*)::int from violations where booking_id = :'bA'), 0,
  'a section that ended more than 7 days ago gets no late No-show');
select is((select count(*)::int from violations where booking_id = :'bB'), 0,
  'nor a late No check-out');

-- ---------------------------------------------------------------------
-- C · Inside it, at the edges
-- ---------------------------------------------------------------------
select is((select count(*)::int from violations where booking_id = :'bC' and type = 'no_checkout'), 1,
  'a No check-out missed for six days (a cron outage) is still raised');
select is((select count(*)::int from violations where booking_id = :'bD' and type = 'no_show'), 1,
  'and a No-show missed for six days');
select is((select counts->>'no_show' from t_run) || '/' || (select counts->>'no_checkout' from t_run), '1/1',
  'and those are the only two raised');
select ok(exists (select 1 from notification_outbox where key = 'N9:booking:' || :'bE' || ':check-out'),
  'a section that started 11 days ago is still reminded 30 minutes before its end (the bound is on the end)');

select is((booking_tick('2026-02-10 08:30+00'::timestamptz) ->> 'n6')::int, 1,
  'N6 at 08:30 the day before a 23:00 start — the longest lead any rule has — is inside the window');
select ok(exists (select 1 from notification_outbox
                   where key = booking_reminder_key('N6', :'bF', '2026-02-11 23:00+00'::timestamptz)),
  'and it is that booking''s N6');

select is((booking_tick(:'now'::timestamptz + interval '1 minute') ->> 'no_show')::int
        + (booking_tick(:'now'::timestamptz + interval '2 minutes') ->> 'no_checkout')::int, 0,
  'the next runs raise nothing again');

-- ---------------------------------------------------------------------
-- D · check_out after BG-09 won the race
-- ---------------------------------------------------------------------
insert into shift_requirements (id, event_id, role_id, starts_at, ends_at, headcount, buffer,
                                charge_rate, pay_rate, allocation_per_hour) values
  (:'sH', :'evt', :'role_id', now() - interval '8 hours', now() - interval '3 hours 59 minutes', 1, 0, 30, 15, 1);
insert into bookings (id, shift_id, staff_id, status, source, confirmed_at)
values (:'bH', :'sH', :'staffb', 'worked', 'auto', now() - interval '2 days');
insert into check_logs (booking_id, outcome, attempted_at, check_in_at)
values (:'bH', 'checked_in', now() - interval '8 hours', now() - interval '8 hours');
-- BG-09's row, raised a moment after this press began.
insert into violations (staff_id, booking_id, type, detected_at)
values (:'staffb', :'bH', 'no_checkout', now() + interval '1 second');

select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is(check_out(:'bH', 51.5000, -0.1000, 10) ->> 'decision', 'locked',
  'a check-out pressed inside the window, but judged after BG-09 raised No check-out, is the locked press');
reset role;
select is((select check_out_at from check_logs where booking_id = :'bH'), null::timestamptz,
  'and no check-out is recorded beside the No check-out — the manager enters the finish (RULE-02)');

select * from finish();
rollback;
