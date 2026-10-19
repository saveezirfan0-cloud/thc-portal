-- =====================================================================
-- 857 · /events Month and List read their sections and fill counts in
--       one call (go-live audit 17.10.2026, B2)
--   20261019110000_office_event_sections.sql
--
--   1. Every section of every event DATED in the period, none outside it.
--   2. The count is the screen's old count exactly: status 'confirmed'
--      only — not worked, invited, cancelled or applied. Fill counts ONLY
--      confirmed.
--   3. Headcount and buffer come back as stored, so the chip still reads
--      "6 (+1)", never "7".
--   4. A total order (starts_at, id), so the office can page it.
--   5. Office only: a worker and a customer are refused; anon and public
--      hold no grant.
-- =====================================================================
begin;
select plan(10);
\ir _shared/fixtures.psql

\set e1 '85700000-0000-4000-8000-000000000001'
\set e2 '85700000-0000-4000-8000-000000000002'
\set e3 '85700000-0000-4000-8000-000000000003'
\set sa '85710000-0000-4000-8000-00000000000a'
\set sb '85710000-0000-4000-8000-00000000000b'
\set sc '85710000-0000-4000-8000-00000000000c'
\set sd '85710000-0000-4000-8000-00000000000d'
\set se '85710000-0000-4000-8000-00000000000e'
\set w1 '85720000-0000-4000-8000-000000000001'
\set w2 '85720000-0000-4000-8000-000000000002'
\set w3 '85720000-0000-4000-8000-000000000003'
\set w4 '85720000-0000-4000-8000-000000000004'
\set w5 '85720000-0000-4000-8000-000000000005'

insert into staff (id, employee_id, first_name, last_name, email, phone, dob, status) values
  (:'w1', 98571, 'Fill', 'One',   'fill1-857@rls.test', '+447700985701', date '1996-02-01', 'compliant'),
  (:'w2', 98572, 'Fill', 'Two',   'fill2-857@rls.test', '+447700985702', date '1996-02-02', 'compliant'),
  (:'w3', 98573, 'Fill', 'Three', 'fill3-857@rls.test', '+447700985703', date '1996-02-03', 'compliant'),
  (:'w4', 98574, 'Fill', 'Four',  'fill4-857@rls.test', '+447700985704', date '1996-02-04', 'compliant'),
  (:'w5', 98575, 'Fill', 'Five',  'fill5-857@rls.test', '+447700985705', date '1996-02-05', 'compliant');

-- Two events in the period (3 and 30 July 2099), one the day after it.
insert into events (id, client_id, venue_id, venue_name, venue_address, venue_location, geofence_radius_m,
                    title, event_date, pays_breaks, pays_buffer)
select v.id::uuid, :'clienta', :'venue_id', 'RLS Fixture Venue', '1 Test Street, London',
       st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150,
       'Fill ' || v.d, v.d::date, true, true
  from (values (:'e1', '2099-07-03'), (:'e2', '2099-07-30'), (:'e3', '2099-07-31')) v(id, d);

-- e1 has two sections; sa and sd start at the same instant (the id decides).
insert into shift_requirements (id, event_id, role_id, starts_at, ends_at, headcount, buffer,
                                charge_rate, pay_rate, allocation_per_hour) values
  (:'sa', :'e1', :'role_id', '2099-07-03 17:00+01', '2099-07-03 23:00+01', 6, 1, 22.97, 14.00, 7),
  (:'sd', :'e1', :'role_id', '2099-07-03 17:00+01', '2099-07-03 22:00+01', 2, 0, 22.97, 14.00, 2),
  (:'sb', :'e1', :'role_id', '2099-07-03 18:00+01', '2099-07-04 01:00+01', 3, 2, 22.97, 14.00, 5),
  (:'sc', :'e2', :'role_id', '2099-07-30 09:00+01', '2099-07-30 17:00+01', 4, 0, 22.97, 14.00, 4),
  (:'se', :'e3', :'role_id', '2099-07-31 09:00+01', '2099-07-31 17:00+01', 4, 0, 22.97, 14.00, 4);

-- sa: two confirmed, one worked, one invited, one cancelled → 2.
-- sb: nothing → 0.  sc: one confirmed → 1.  se (outside): one confirmed.
insert into bookings (shift_id, staff_id, status, source, confirmed_at) values
  (:'sa', :'w1', 'confirmed', 'auto',   now()),
  (:'sa', :'w2', 'confirmed', 'manual', now()),
  (:'sa', :'w3', 'worked',    'auto',   now()),
  (:'sa', :'w4', 'invited',   'auto',   null),
  (:'sa', :'w5', 'cancelled', 'auto',   null),
  (:'sc', :'w1', 'confirmed', 'auto',   now()),
  (:'se', :'w2', 'confirmed', 'auto',   now());

select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;

create temp table got on commit drop as
  select * from office_event_sections('2099-07-01', '2099-07-30');

select results_eq(
  $$ select section_id from got where event_id in ('85700000-0000-4000-8000-000000000001',
                                                    '85700000-0000-4000-8000-000000000002',
                                                    '85700000-0000-4000-8000-000000000003') $$,
  $$ values ('85710000-0000-4000-8000-00000000000a'::uuid),
            ('85710000-0000-4000-8000-00000000000d'::uuid),
            ('85710000-0000-4000-8000-00000000000b'::uuid),
            ('85710000-0000-4000-8000-00000000000c'::uuid) $$,
  'every section of the events dated in the period, by (starts_at, id); the 31 July event is not one');

select is((select confirmed from got where section_id = :'sa'), 2,
  'confirmed only: worked, invited and cancelled are not counted');
select is((select confirmed from got where section_id = :'sb'), 0, 'a section with nobody reads 0');
select is((select confirmed from got where section_id = :'sc'), 1, 'and the other event its own');
select is((select array[headcount, buffer] from got where section_id = :'sa'), array[6, 1],
  'headcount and buffer as stored — the chip reads 6 (+1), never 7');

select is((select count(*)::int from got),
          (select count(*)::int from shift_requirements sr join events e on e.id = sr.event_id
            where e.event_date between '2099-07-01' and '2099-07-30'),
  'nothing beyond the period''s sections');

select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
select throws_ok($$ select * from office_event_sections('2099-07-01', '2099-07-30') $$,
  '42501', 'admins_only', 'a worker is refused');

select set_config('request.jwt.claims', json_build_object('sub', :'clienta_uid', 'role', 'authenticated')::text, true);
select throws_ok($$ select * from office_event_sections('2099-07-01', '2099-07-30') $$,
  '42501', 'admins_only', 'a customer is refused');

reset role;
select ok(not has_function_privilege('anon', 'public.office_event_sections(date, date)', 'execute'),
  'anon holds no grant');
select ok(not has_function_privilege('public', 'public.office_event_sections(date, date)', 'execute'),
  'nor does public');

select * from finish();
rollback;
