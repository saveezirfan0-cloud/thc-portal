-- =====================================================================
-- 100 · Shift Builder rules (Scope §3.2, RULE-18)
--
-- packages/domain/src/shift.vectors.json calls itself the contract between
-- the TypeScript rules and this database. This file is the database half of
-- it: every `roleSections` vector is inserted and expected to be accepted or
-- rejected by `shift_requirements.min_4h`, and every `eventWindows` vector
-- is read back off the `event_windows` view.
--
-- The cases that matter are the ones where the clock lies. A role section is
-- measured in REAL hours, because `min_4h` is an interval on timestamptz:
--   - 23:00 → 03:00 across the spring change reads four hours and is three,
--     so it is rejected;
--   - 22:00 → 06:00 across the autumn change reads eight and is nine.
-- Both sit in the vectors file and both are asserted here.
--
-- Requires a seeded database, which is what `supabase db reset` and
-- `supabase start` give you. Everything below rolls back.
-- =====================================================================
begin;
select plan(11);

-- A Europe/London wall-clock time, stored as timestamptz — the same helper
-- supabase/seed.sql uses, and the SQL twin of `ukInstant` (§1.8).
create or replace function pg_temp.uk(d date, t time) returns timestamptz
language sql stable as $$ select (d + t) at time zone 'Europe/London' $$;

-- Four scratch events. Referenced by name so the seed's UUIDs can move.
insert into events (id, client_id, venue_id, venue_name, venue_address, venue_location,
                    geofence_radius_m, title, event_date, pays_breaks, pays_buffer)
select e.id::uuid, c.id, v.id, v.name, v.address, v.location, v.geofence_radius_m,
       e.title, e.event_date, true, true
from (values
  ('6f000000-0000-4000-8000-000000000001','Vector · rejected sections',  date '2026-09-18'),
  ('6f000000-0000-4000-8000-000000000002','Vector · accepted sections',  date '2026-09-18'),
  ('6f000000-0000-4000-8000-000000000003','Vector · derived window',     date '2026-09-18'),
  ('6f000000-0000-4000-8000-000000000004','Vector · after midnight',     date '2026-09-18')
) as e(id, title, event_date)
cross join (select id from clients where name = 'Leonardo Hotel St Pauls') c
cross join (select id, name, address, location, geofence_radius_m
              from venues where name = 'Leonardo Royal Hotel') v;

-- ---------------------------------------------------------------------
-- min_4h REJECTS — the four-hour floor, measured on its own start (§3.2)
-- ---------------------------------------------------------------------
select throws_ok(
  $$ insert into shift_requirements (event_id, role_id, starts_at, ends_at, headcount, buffer,
                                     charge_rate, pay_rate, allocation_per_hour)
     select '6f000000-0000-4000-8000-000000000001', r.id,
            pg_temp.uk(date '2026-09-18', time '18:00'),
            pg_temp.uk(date '2026-09-18', time '21:00'),
            1, 0, 26.83, 16.00, 1
       from roles r where r.name = 'Host' $$,
  '23514', null, 'Host 18:00-21:00 is three hours and is rejected');

select throws_ok(
  $$ insert into shift_requirements (event_id, role_id, starts_at, ends_at, headcount, buffer,
                                     charge_rate, pay_rate, allocation_per_hour)
     select '6f000000-0000-4000-8000-000000000001', r.id,
            pg_temp.uk(date '2026-09-18', time '22:00'),
            pg_temp.uk(date '2026-09-19', time '01:00'),
            2, 0, 22.97, 14.00, 2
       from roles r where r.name = 'Bar Staff' $$,
  '23514', null, 'after midnight does not excuse the four-hour floor');

select throws_ok(
  $$ insert into shift_requirements (event_id, role_id, starts_at, ends_at, headcount, buffer,
                                     charge_rate, pay_rate, allocation_per_hour)
     select '6f000000-0000-4000-8000-000000000001', r.id,
            pg_temp.uk(date '2026-09-18', time '12:00'),
            pg_temp.uk(date '2026-09-18', time '12:00'),
            2, 0, 22.97, 14.00, 2
       from roles r where r.name = 'Chef' $$,
  '23514', null, 'a zero-length section is rejected, never read as 24 hours');

select throws_ok(
  $$ insert into shift_requirements (event_id, role_id, starts_at, ends_at, headcount, buffer,
                                     charge_rate, pay_rate, allocation_per_hour)
     select '6f000000-0000-4000-8000-000000000001', r.id,
            pg_temp.uk(date '2026-03-28', time '23:00'),
            pg_temp.uk(date '2026-03-29', time '03:00'),
            2, 0, 22.97, 14.00, 2
       from roles r where r.name = 'Chef' $$,
  '23514', null, 'spring forward: 23:00-03:00 reads four hours, is three, is rejected');

-- ---------------------------------------------------------------------
-- min_4h ACCEPTS
-- ---------------------------------------------------------------------
select lives_ok(
  $$ insert into shift_requirements (event_id, role_id, starts_at, ends_at, headcount, buffer,
                                     charge_rate, pay_rate, allocation_per_hour)
     select '6f000000-0000-4000-8000-000000000002', r.id,
            pg_temp.uk(date '2026-09-18', time '10:00'),
            pg_temp.uk(date '2026-09-18', time '14:00'),
            4, 0, 22.97, 14.00, 4
       from roles r where r.name = 'Waiting Staff' $$,
  'exactly four hours is allowed');

select lives_ok(
  $$ insert into shift_requirements (event_id, role_id, starts_at, ends_at, headcount, buffer,
                                     charge_rate, pay_rate, allocation_per_hour)
     select '6f000000-0000-4000-8000-000000000002', r.id,
            pg_temp.uk(date '2026-09-18', time '18:00'),
            pg_temp.uk(date '2026-09-19', time '01:00'),
            6, 1, 26.40, 15.50, 7
       from roles r where r.name = 'Bar Staff' $$,
  'a role may end after midnight');

select lives_ok(
  $$ insert into shift_requirements (event_id, role_id, starts_at, ends_at, headcount, buffer,
                                     charge_rate, pay_rate, allocation_per_hour)
     select '6f000000-0000-4000-8000-000000000002', r.id,
            pg_temp.uk(date '2026-10-24', time '22:00'),
            pg_temp.uk(date '2026-10-25', time '06:00'),
            2, 0, 22.97, 14.00, 2
       from roles r where r.name = 'Chef' $$,
  'autumn back: 22:00-06:00 reads eight hours and is nine, so it passes');

-- ---------------------------------------------------------------------
-- event_windows — earliest role start to latest role end (RULE-18)
-- ---------------------------------------------------------------------
insert into shift_requirements (event_id, role_id, starts_at, ends_at, headcount, buffer,
                                charge_rate, pay_rate, allocation_per_hour)
select w.event_id::uuid, r.id,
       pg_temp.uk(date '2026-09-18', w.start_t),
       pg_temp.uk(date '2026-09-18' + w.end_offset, w.end_t),
       w.headcount, w.buffer, 22.97, 14.00, w.headcount + w.buffer
from (values
  -- Gala Dinner's shape: Chef early, Waiting Staff late.
  ('6f000000-0000-4000-8000-000000000003','Chef',          time '07:00', time '15:00', 0, 2, 0),
  ('6f000000-0000-4000-8000-000000000003','Kitchen Porter',time '09:00', time '17:00', 0, 3, 1),
  ('6f000000-0000-4000-8000-000000000003','Waiting Staff', time '17:00', time '23:30', 0, 12, 2),
  -- One section running past midnight carries the window with it.
  ('6f000000-0000-4000-8000-000000000004','Waiting Staff', time '12:00', time '20:00', 0, 4, 0),
  ('6f000000-0000-4000-8000-000000000004','Bar Staff',     time '18:00', time '01:00', 1, 6, 1)
) as w(event_id, role_name, start_t, end_t, end_offset, headcount, buffer)
join roles r on r.name = w.role_name;

select is(
  (select starts_at from event_windows where event_id = '6f000000-0000-4000-8000-000000000003'),
  pg_temp.uk(date '2026-09-18', time '07:00'),
  'the derived window starts at the EARLIEST role start, not the event''s (RULE-18)'
);

select is(
  (select ends_at from event_windows where event_id = '6f000000-0000-4000-8000-000000000003'),
  pg_temp.uk(date '2026-09-18', time '23:30'),
  'the derived window ends at the LATEST role end (RULE-18)'
);

select is(
  (select ends_at from event_windows where event_id = '6f000000-0000-4000-8000-000000000004'),
  pg_temp.uk(date '2026-09-19', time '01:00'),
  'an after-midnight section carries the derived window past the event date'
);

-- The sections keep their own hours: the window is derived, never imposed.
select is(
  (select count(*)::int from shift_requirements
    where event_id = '6f000000-0000-4000-8000-000000000003'
      and starts_at = pg_temp.uk(date '2026-09-18', time '17:00')
      and ends_at   = pg_temp.uk(date '2026-09-18', time '23:30')),
  1,
  'the Waiting Staff section still runs 17:00-23:30, not the event window'
);

select * from finish();
rollback;
