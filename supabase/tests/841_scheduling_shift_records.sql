-- =====================================================================
-- 841 · The busiest day and week ever booked (ADR-0142)
--   20261015110000_scheduling_shift_records.sql
--
--   1. A day's shifts are its role sections' headcount; the buffer and a
--      cancelled event count for nothing.
--   2. The top two days and Mon–Sun weeks, highest first; on a tie the
--      earlier date holds the record.
--   3. Office only: staff, client and anon are refused.
--
--   The fixture days sit in 2099 with headcounts no seed row comes near,
--   so the seed's own events never reach the top two.
-- =====================================================================
begin;
select plan(9);
\ir _shared/fixtures.psql

\set e1 '84100000-0000-4000-8000-000000000001'
\set e2 '84100000-0000-4000-8000-000000000002'
\set e3 '84100000-0000-4000-8000-000000000003'
\set e4 '84100000-0000-4000-8000-000000000004'
\set e5 '84100000-0000-4000-8000-000000000005'

insert into events (id, client_id, venue_id, venue_name, venue_address, venue_location, geofence_radius_m,
                    title, event_date, pays_breaks, pays_buffer, cancelled_at)
select v.id::uuid, :'clienta', :'venue_id', 'RLS Fixture Venue', '1 Test Street, London',
       st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150,
       'Record ' || v.d, v.d::date, true, true, v.cancelled
  from (values (:'e1', '2099-06-03', null::timestamptz),   -- Wed, week of Mon 1 Jun
               (:'e2', '2099-06-04', null),                -- Thu, same week
               (:'e3', '2099-06-10', null),                -- Wed, week of Mon 8 Jun
               (:'e4', '2099-06-11', null),                -- Thu, same week
               (:'e5', '2099-06-12', now())) v(id, d, cancelled);  -- cancelled

insert into shift_requirements (event_id, role_id, starts_at, ends_at, headcount, buffer,
                                charge_rate, pay_rate, allocation_per_hour)
select v.ev::uuid, :'role_id', (v.d || ' 09:00+01')::timestamptz, (v.d || ' 17:00+01')::timestamptz,
       v.hc, v.buf, 22.97, 14.00, 1
  from (values (:'e1', '2099-06-03', 5000, 9999),  -- the buffer is not a shift
               (:'e1', '2099-06-03', 4000, 0),
               (:'e2', '2099-06-04', 1000, 0),
               (:'e3', '2099-06-10', 9000, 0),    -- ties 3 Jun: the earlier day holds it
               (:'e4', '2099-06-11', 3000, 0),
               (:'e5', '2099-06-12', 50000, 0)) v(ev, d, hc, buf);

-- ---------------------------------------------------------------------
-- 1–2 · The office reads the records
-- ---------------------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;

select is(scheduling_shift_records() -> 'days' -> 0,
  '{"date": "2099-06-03", "shifts": 9000}'::jsonb,
  'the busiest day: both sections'' headcount, no buffer, the earlier of a tie');
select is(scheduling_shift_records() -> 'days' -> 1,
  '{"date": "2099-06-10", "shifts": 9000}'::jsonb,
  'the later tie is the runner-up, not a new record');
select is(jsonb_array_length(scheduling_shift_records() -> 'days'), 2, 'two days, no more');
select is(scheduling_shift_records() -> 'weeks' -> 0,
  '{"date": "2099-06-08", "shifts": 12000}'::jsonb,
  'the busiest week, keyed by its Monday; the cancelled 50 000 counts for nothing');
select is(scheduling_shift_records() -> 'weeks' -> 1,
  '{"date": "2099-06-01", "shifts": 10000}'::jsonb,
  'the runner-up week');

-- ---------------------------------------------------------------------
-- 3 · Nobody else
-- ---------------------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
select throws_ok('select scheduling_shift_records()', '42501', 'admins_only', 'a worker is refused');

select set_config('request.jwt.claims', json_build_object('sub', :'clienta_uid', 'role', 'authenticated')::text, true);
select throws_ok('select scheduling_shift_records()', '42501', 'admins_only', 'a client is refused');

reset role;
select ok(not has_function_privilege('anon', 'public.scheduling_shift_records()', 'execute'),
  'anon holds no grant');
select ok(not has_function_privilege('public', 'public.scheduling_shift_records()', 'execute'),
  'nor does public');

select * from finish();
rollback;
