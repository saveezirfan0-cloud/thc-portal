-- =====================================================================
-- 871 · One open No-show / No check-out / Late / Left-early per booking
--       (20261019150100, ADR-0157; go-live concurrency audit M1)
--
--   A · the partial unique index refuses a second open row of a once-only
--       kind, and leaves alone what is not a duplicate: a resolved row
--       beside an open one, and Left-geofence (one per exit)
--   B · every writer of those kinds says ON CONFLICT DO NOTHING, so the
--       loser of a race is a no-op, and such an insert swallows the
--       duplicate instead of raising
--   C · booking_tick run twice still raises one No-show and one No
--       check-out
--
-- The race itself needs two sessions; pgTAP has one. What makes it safe
-- is the index plus the clause, and both are pinned.
-- =====================================================================
begin;
select plan(12);
\ir _shared/fixtures.psql

\set now  '2026-09-21 20:00:00+00'
\set ev   '87100000-0000-4000-8000-0000000000e1'
\set sns  '87110000-0000-4000-8000-000000000001'
\set snc  '87110000-0000-4000-8000-000000000002'
\set bns  '87120000-0000-4000-8000-000000000001'
\set bnc  '87120000-0000-4000-8000-000000000002'

-- ---------------------------------------------------------------------
-- A · The index
-- ---------------------------------------------------------------------
select is(
  (select indexdef from pg_indexes where indexname = 'violations_one_open_per_booking_type'),
  'CREATE UNIQUE INDEX violations_one_open_per_booking_type ON public.violations USING btree (booking_id, type) WHERE ((NOT resolved) AND (type = ANY (ARRAY[''no_show''::violation_type, ''no_checkout''::violation_type, ''late''::violation_type, ''left_early''::violation_type])))',
  'one open row per booking for No-show, No check-out, Late and Left-early');

-- The fixture already holds an open Late on booking_a.
select throws_ok(
  format($$ insert into violations (staff_id, booking_id, type) values (%L, %L, 'late') $$, :'staffa', :'booking_a'),
  '23505', null, 'a second open Late on one booking is refused');

select lives_ok(
  format($$ insert into violations (staff_id, booking_id, type, resolved, resolution_note)
            values (%L, %L, 'late', true, 'reclassified no-show (Get back)') $$, :'staffa', :'booking_a'),
  'a resolved row of the same kind beside it is not a duplicate (Get back turns a No-show into a resolved Late)');

select lives_ok(
  format($$ insert into violations (staff_id, booking_id, type) values (%L, %L, 'left_geofence'), (%L, %L, 'left_geofence') $$,
         :'staffa', :'booking_a', :'staffa', :'booking_a'),
  'Left-geofence is one per exit and stays unconstrained');

create temporary table t_swallow as
with ins as (
  insert into violations (staff_id, booking_id, type) values (:'staffa', :'booking_a', 'late')
  on conflict do nothing returning 1)
select count(*)::int as n from ins;
select is((select n from t_swallow), 0, 'an ON CONFLICT DO NOTHING insert of the duplicate is a quiet no-op');
select is((select count(*)::int from violations where booking_id = :'booking_a' and type = 'late' and not resolved), 1,
  'and the one open Late is still the only one');

-- ---------------------------------------------------------------------
-- B · Every writer of a once-only kind swallows the race
-- ---------------------------------------------------------------------
create temporary table t_inserts as
select p.oid::regprocedure::text as fn, m[1] as stmt
  from pg_proc p,
       regexp_matches(p.prosrc, '(insert\s+into\s+(?:public\.)?violations\M[^;]*;)', 'gi') m
 where p.pronamespace = 'public'::regnamespace;

select set_eq(
  $$ select distinct fn from t_inserts where stmt ~ '''(no_show|no_checkout|late|left_early)''' $$,
  array['attempt_check_in(uuid,double precision,double precision,double precision)',
        'check_out(uuid,double precision,double precision,double precision)',
        'booking_tick(timestamp with time zone)',
        'office_mark_no_show(uuid)'],
  'the writers of the once-only kinds are the check-in, the check-out, the tick and the office''s No-show');
select is_empty(
  $$ select fn || ': ' || stmt from t_inserts
      where stmt ~ '''(no_show|no_checkout|late|left_early)'''
        and stmt !~* 'on\s+conflict\s+do\s+nothing' $$,
  'every one of their inserts says ON CONFLICT DO NOTHING');

-- ---------------------------------------------------------------------
-- C · The tick, twice
-- ---------------------------------------------------------------------
update shift_requirements set starts_at = :'now'::timestamptz + interval '40 days',
                              ends_at   = :'now'::timestamptz + interval '41 days';
insert into events (id, client_id, venue_id, venue_name, venue_address, venue_location,
                    geofence_radius_m, title, event_date, pays_breaks, pays_buffer) values
  (:'ev', :'clienta', :'venue_id', 'RLS Fixture Venue', '1 Test Street, London',
   st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150, 'Twice', date '2026-09-21', true, true);
insert into shift_requirements (id, event_id, role_id, starts_at, ends_at, headcount, buffer,
                                charge_rate, pay_rate, allocation_per_hour) values
  (:'sns', :'ev', :'role_id', '2026-09-21 18:00+00', '2026-09-22 01:00+00', 1, 0, 30, 15, 1),
  (:'snc', :'ev', :'role_id', '2026-09-21 08:00+00', '2026-09-21 15:00+00', 1, 0, 30, 15, 1);
insert into bookings (id, shift_id, staff_id, status, source, confirmed_at) values
  (:'bns', :'sns', :'staffa', 'confirmed', 'auto', '2026-09-20 10:00+00'),
  (:'bnc', :'snc', :'staffa', 'worked',    'auto', '2026-09-20 10:00+00');
insert into check_logs (booking_id, outcome, attempted_at, check_in_at) values
  (:'bnc', 'checked_in', '2026-09-21 08:00+00', '2026-09-21 08:00+00');

select is(booking_tick(:'now'::timestamptz) ->> 'no_show', '1', 'BG-03 raises the No-show at start + 30');
select is(booking_tick(:'now'::timestamptz + interval '1 minute') ->> 'no_show', '0', 'and the next run does not raise it again');
select is((select count(*)::int from violations where booking_id = :'bns' and type = 'no_show'), 1,
  'one No-show on the booking');
select is((select count(*)::int from violations where booking_id = :'bnc' and type = 'no_checkout'), 1,
  'and one No check-out on the shift past end + 4 h');

select * from finish();
rollback;
