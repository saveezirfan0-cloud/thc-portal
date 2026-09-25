-- =====================================================================
-- 591 · Same-day escalation reads its radius (§3.4, §7)
--   20260927140100_escalation_radius.sql
--
-- docs/15 §3: settings.escalation_radius_miles was editable and never
-- read. Held here:
--   * the setting is read, and a broken one falls back to the scope's 3;
--   * the escalation pool gates everyone outside it — including anyone
--     with no home on file — and the ordinary pool is unchanged;
--   * the gate sits last, so a stronger reason still shows;
--   * qualified-first still holds inside the radius;
--   * invite_worker re-checks the radius for an escalation invitation and
--     records source = 'escalation';
--   * the one-argument call every existing caller makes still resolves.
-- =====================================================================
begin;
select plan(24);
\ir _shared/fixtures.psql

-- ---------------------------------------------------------------------
-- Fixtures. The venue is the fixture venue at (-0.1000, 51.5000). At that
-- latitude 0.01° of longitude is about 0.69 km, so:
--   near    -0.1100   ~0.7 km  (0.4 mi)  inside 3 miles
--   edge    -0.1900   ~6.2 km  (3.9 mi)  outside 3, inside 5
--   far     -0.5000  ~27.7 km (17 mi)   outside both
--   nohome  no home_location on file
--   blkfar  blocked AND far — the stronger reason must show
-- ---------------------------------------------------------------------
\set ro      '59400000-0000-4000-8000-000000000001'
\set evt     '59400000-0000-4000-8000-00000000000e'
\set sec     '59400000-0000-4000-8000-0000000000a1'
\set near    '59500000-0000-4000-8000-000000000001'
\set edge    '59500000-0000-4000-8000-000000000002'
\set far     '59500000-0000-4000-8000-000000000003'
\set nohome  '59500000-0000-4000-8000-000000000004'
\set blkfar  '59500000-0000-4000-8000-000000000005'
\set near2   '59500000-0000-4000-8000-000000000006'

insert into roles (id, name, pay_rate) values (:'ro', 'Escalation Waiting Staff', 14.00);

insert into events (id, client_id, venue_id, venue_name, venue_address, venue_location,
                    geofence_radius_m, title, event_date, pays_breaks, pays_buffer, auto_assign) values
  (:'evt', :'clienta', :'venue_id', 'RLS Fixture Venue', '1 Test Street, London',
   st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150,
   'Escalation Dinner', date '2027-01-15', true, true, true);

insert into shift_requirements (id, event_id, role_id, starts_at, ends_at, headcount, buffer,
                                charge_rate, pay_rate, allocation_per_hour, auto_assign) values
  (:'sec', :'evt', :'ro', '2027-01-15 17:00+00', '2027-01-15 23:00+00', 3, 1, 30, 15, 4, true);

insert into staff (id, first_name, last_name, email, phone, dob, status, rtw_branch, home_location) values
  (:'near',   'Near',  'One',  'n1@esc.test', '+447700905911', date '1995-01-01', 'compliant', 'uk_irish',
   st_setsrid(st_makepoint(-0.1100, 51.5000), 4326)::geography),
  (:'edge',   'Edge',  'Two',  'e2@esc.test', '+447700905912', date '1995-01-01', 'compliant', 'uk_irish',
   st_setsrid(st_makepoint(-0.1900, 51.5000), 4326)::geography),
  (:'far',    'Far',   'Three','f3@esc.test', '+447700905913', date '1995-01-01', 'compliant', 'uk_irish',
   st_setsrid(st_makepoint(-0.5000, 51.5000), 4326)::geography),
  (:'nohome', 'No',    'Home', 'nh@esc.test', '+447700905914', date '1995-01-01', 'compliant', 'uk_irish', null),
  (:'blkfar', 'Block', 'Far',  'bf@esc.test', '+447700905915', date '1995-01-01', 'blocked',   'uk_irish',
   st_setsrid(st_makepoint(-0.5000, 51.5000), 4326)::geography),
  (:'near2',  'Near',  'Two',  'n2@esc.test', '+447700905916', date '1995-01-01', 'compliant', 'uk_irish',
   st_setsrid(st_makepoint(-0.1050, 51.5000), 4326)::geography);

insert into staff_roles (staff_id, role_id)
select id, :'ro' from staff where id in (:'near', :'edge', :'far', :'nohome', :'blkfar', :'near2');

-- `near` is qualified at this client and role (Wave 1); `near2` is not.
insert into client_qualifications (client_id, role_id, staff_id) values (:'clienta', :'ro', :'near');

-- ---------------------------------------------------------------------
-- 1. The setting
-- ---------------------------------------------------------------------
select is(escalation_radius_miles(), 3::numeric,
  'the seeded settings.escalation_radius_miles is 3, as §3.4 says');

update settings set value = '"4.5"'::jsonb where key = 'escalation_radius_miles';
select is(escalation_radius_miles(), 4.5::numeric, 'a numeric string is read as a number');
update settings set value = '"three"'::jsonb where key = 'escalation_radius_miles';
select is(escalation_radius_miles(), 3::numeric, 'an unusable value falls back to the scope''s 3, not an error');
update settings set value = '0'::jsonb where key = 'escalation_radius_miles';
select is(escalation_radius_miles(), 3::numeric, 'and so does a zero radius, which would invite nobody');
delete from settings where key = 'escalation_radius_miles';
select is(escalation_radius_miles(), 3::numeric, 'and a missing row');
insert into settings (key, value) values ('escalation_radius_miles', '3'::jsonb);

-- ---------------------------------------------------------------------
-- 2. The pool
-- ---------------------------------------------------------------------
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname = 'auto_assign_candidates'), 1,
  'exactly one auto_assign_candidates, so the one-argument call cannot be ambiguous');

select is(
  (select array_agg(gate order by staff_id) from auto_assign_candidates(:'sec')
    where staff_id in (:'near', :'edge', :'far', :'nohome')),
  array[null, null, null, null]::text[],
  'the ordinary pool (one argument, as the board and Radar call it) knows no radius');
select is(
  (select array_agg(gate order by staff_id) from auto_assign_candidates(:'sec', false)
    where staff_id in (:'near', :'edge', :'far', :'nohome')),
  array[null, null, null, null]::text[],
  'nor does p_escalation => false');

select is((select gate from auto_assign_candidates(:'sec', true) where staff_id = :'near'), null,
  'escalation: a worker 0.4 miles from the venue is in the pool');
select is((select gate from auto_assign_candidates(:'sec', true) where staff_id = :'edge'), 'outside_radius',
  'escalation: one 3.9 miles away is gated outside_radius at the default 3');
select is((select gate from auto_assign_candidates(:'sec', true) where staff_id = :'far'), 'outside_radius',
  'escalation: one 17 miles away is gated');
select is((select gate from auto_assign_candidates(:'sec', true) where staff_id = :'nohome'), 'outside_radius',
  'escalation: no home on file cannot be shown to be inside the radius');
select is((select gate from auto_assign_candidates(:'sec', true) where staff_id = :'blkfar'), 'blocked',
  'the radius gate sits last: a blocked worker far away still reads blocked');

select is(
  (select count(*)::int
     from auto_assign_candidates(:'sec', false) a
     join auto_assign_candidates(:'sec', true)  e using (staff_id)
    where a.gate is distinct from e.gate and e.gate is distinct from 'outside_radius'),
  0, 'escalation changes nothing but adding outside_radius — every other gate is the same row for row');

update settings set value = '5'::jsonb where key = 'escalation_radius_miles';
select is((select gate from auto_assign_candidates(:'sec', true) where staff_id = :'edge'), null,
  'the radius is the setting: at 5 miles the worker 3.9 miles away is back in the pool');
update settings set value = '3'::jsonb where key = 'escalation_radius_miles';

select is(
  (select array_agg(qualified order by staff_id) from auto_assign_candidates(:'sec', true)
    where staff_id in (:'near', :'near2')),
  array[true, false],
  '§3.4: inside the radius the qualified wave still comes first — the qualified flag is untouched');

-- ---------------------------------------------------------------------
-- 3. invite_worker — the insert re-applies the radius
-- ---------------------------------------------------------------------
select ok(exists (select 1 from auto_assign_due_shifts('escalation', '2027-01-15 18:00+00') d
                   where d.shift_id = :'sec'),
  'the section is under way and short, so it is the escalation job''s');

select is((invite_worker(:'sec', :'far', 'escalation', true))->>'reason', 'outside_radius',
  'an escalation invitation to someone 17 miles away is refused at the insert');
select ok(not exists (select 1 from bookings where shift_id = :'sec' and staff_id = :'far'),
  'and no booking is written');

select is((invite_worker(:'sec', :'near', 'escalation', true))->>'invited', 'true',
  'an escalation invitation inside the radius is written');
select is((select source::text from bookings where shift_id = :'sec' and staff_id = :'near'), 'escalation',
  'recorded as source = escalation, the enum value 0001_init made for it');
select ok(exists (select 1 from notification_outbox n join bookings b on b.id::text = n.payload->>'bookingId'
                   where b.shift_id = :'sec' and b.staff_id = :'near' and n.template = 'N5'),
  'and the worker gets N5 through the outbox, like any invitation');

select is((invite_worker(:'sec', :'edge', 'manual'))->>'invited', 'true',
  'a manager''s own invitation is not held to the radius — §3.4 lets the office invite anyone');

select ok(has_function_privilege('service_role', 'public.auto_assign_candidates(uuid, boolean)', 'execute'),
  'the jobs layer can still call the pool');

select * from finish();
rollback;
