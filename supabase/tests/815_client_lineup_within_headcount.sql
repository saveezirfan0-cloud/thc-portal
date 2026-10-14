-- =====================================================================
-- 815 · The customer's line-up stops at the headcount (§11.1, §11.2,
--       §3.2, RULE-15; ADR-0004, ADR-0053, ADR-0134)
--       — 20261014140000_client_lineup_within_headcount.sql
--
-- An over-booked section (six confirmed on a headcount of four) must give
-- the customer four rows, the RIGHT four, and counts that never say six:
--   · before the event: the four confirmed first (bookings.confirmed_at),
--     the booking id breaking a tie;
--   · on the day: whoever checked in first takes a seat ahead of anyone
--     who has not (RULE-15), by check-in time;
--   · a worker the customer already rated stays visible whatever their seat;
--   · client_role_sections_v and client_arrivals_v hold their counts to
--     the same headcount;
--   · the restated views keep ADR-0004's shape, and another customer
--     still sees nothing.
-- =====================================================================
begin;
select plan(20);
\ir _shared/fixtures.psql

\set ev_up   'e8150000-0000-4000-8000-000000000001'
\set ev_live 'e8150000-0000-4000-8000-000000000002'
\set sh_up   'f8150000-0000-4000-8000-000000000001'
\set sh_live 'f8150000-0000-4000-8000-000000000002'
\set s1 'd8150000-0000-4000-8000-000000000001'
\set s2 'd8150000-0000-4000-8000-000000000002'
\set s3 'd8150000-0000-4000-8000-000000000003'
\set s4 'd8150000-0000-4000-8000-000000000004'
\set s5 'd8150000-0000-4000-8000-000000000005'
\set s6 'd8150000-0000-4000-8000-000000000006'
\set u1 '08150000-0000-4000-8000-000000000001'
\set u2 '08150000-0000-4000-8000-000000000002'
\set u3 '08150000-0000-4000-8000-000000000003'
\set u4 '08150000-0000-4000-8000-000000000004'
\set u5 '08150000-0000-4000-8000-000000000005'
\set u6 '08150000-0000-4000-8000-000000000006'
\set l1 '08150000-0000-4000-8000-000000000011'
\set l2 '08150000-0000-4000-8000-000000000012'
\set l3 '08150000-0000-4000-8000-000000000013'
\set l4 '08150000-0000-4000-8000-000000000014'
\set l5 '08150000-0000-4000-8000-000000000015'
\set l6 '08150000-0000-4000-8000-000000000016'

insert into staff (id, employee_id, first_name, last_name, email, phone, dob, status) values
  (:'s1', 98151, 'Seat', 'One',   'seat1-815@rls.test', '+447700981501', date '1996-01-01', 'compliant'),
  (:'s2', 98152, 'Seat', 'Two',   'seat2-815@rls.test', '+447700981502', date '1996-01-02', 'compliant'),
  (:'s3', 98153, 'Seat', 'Three', 'seat3-815@rls.test', '+447700981503', date '1996-01-03', 'compliant'),
  (:'s4', 98154, 'Seat', 'Four',  'seat4-815@rls.test', '+447700981504', date '1996-01-04', 'compliant'),
  (:'s5', 98155, 'Seat', 'Five',  'seat5-815@rls.test', '+447700981505', date '1996-01-05', 'compliant'),
  (:'s6', 98156, 'Seat', 'Six',   'seat6-815@rls.test', '+447700981506', date '1996-01-06', 'compliant');

-- Client A: one event a week out, one running now. Waiting-staff style
-- section of FOUR on each, six confirmed on each (THC's buffer of two).
insert into events (id, client_id, venue_id, venue_name, venue_address, venue_location, geofence_radius_m,
                    title, event_date, pays_breaks, pays_buffer) values
  (:'ev_up',   :'clienta', :'venue_id', 'RLS Fixture Venue', '1 Test Street, London',
   st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150, 'Over-booked upcoming', current_date + 7, true, true),
  (:'ev_live', :'clienta', :'venue_id', 'RLS Fixture Venue', '1 Test Street, London',
   st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150, 'Over-booked live', current_date, true, true);

insert into shift_requirements (id, event_id, role_id, starts_at, ends_at, headcount, buffer,
                                charge_rate, pay_rate, dress_code, allocation_per_hour) values
  (:'sh_up',   :'ev_up',   :'role_id', now() + interval '7 days', now() + interval '7 days 6 hours', 4, 2, 22.97, 14.00, 'Black tie', 6),
  (:'sh_live', :'ev_live', :'role_id', now() - interval '1 hour', now() + interval '5 hours',        4, 2, 22.97, 14.00, 'Black tie', 6);

-- Upcoming: confirmed in the order 1, 2, 3, then 4 and 5 at the same
-- instant (the booking id decides: u4 < u5), then 6 last.
insert into bookings (id, shift_id, staff_id, status, source, confirmed_at) values
  (:'u6', :'sh_up', :'s6', 'confirmed', 'auto', now() - interval '1 day'),
  (:'u1', :'sh_up', :'s1', 'confirmed', 'auto', now() - interval '6 days'),
  (:'u5', :'sh_up', :'s5', 'confirmed', 'auto', now() - interval '3 days'),
  (:'u2', :'sh_up', :'s2', 'confirmed', 'auto', now() - interval '5 days'),
  (:'u4', :'sh_up', :'s4', 'confirmed', 'auto', now() - interval '3 days'),
  (:'u3', :'sh_up', :'s3', 'confirmed', 'auto', now() - interval '4 days');

-- Live: the same confirmation order, but on the door 6 and 5 checked in
-- first (6 before 5), then 1; 2, 3 and 4 have not arrived. RULE-15: the
-- first four check-ins work, and the seats follow them.
insert into bookings (id, shift_id, staff_id, status, source, confirmed_at) values
  (:'l1', :'sh_live', :'s1', 'confirmed', 'auto', now() - interval '6 days'),
  (:'l2', :'sh_live', :'s2', 'confirmed', 'auto', now() - interval '5 days'),
  (:'l3', :'sh_live', :'s3', 'confirmed', 'auto', now() - interval '4 days'),
  (:'l4', :'sh_live', :'s4', 'confirmed', 'auto', now() - interval '3 days'),
  (:'l5', :'sh_live', :'s5', 'confirmed', 'auto', now() - interval '2 days'),
  (:'l6', :'sh_live', :'s6', 'confirmed', 'auto', now() - interval '1 day');
insert into check_logs (booking_id, attempted_at, outcome, check_in_at) values
  (:'l6', now() - interval '58 minutes', 'checked_in',    now() - interval '58 minutes'),
  (:'l5', now() - interval '50 minutes', 'out_of_radius', null),
  (:'l5', now() - interval '45 minutes', 'checked_in',    now() - interval '45 minutes'),
  (:'l1', now() - interval '30 minutes', 'checked_in',    now() - interval '30 minutes'),
  -- An out-of-radius press is not an arrival and takes no seat.
  (:'l4', now() - interval '20 minutes', 'out_of_radius', null);

-- ---------------------------------------------------------------------
-- Shape: the restatement kept ADR-0004's form.
-- ---------------------------------------------------------------------
select ok(
  (select bool_and(not (coalesce(reloptions, '{}') @> '{security_invoker=true}')
                   and coalesce(reloptions, '{}') @> '{security_barrier=true}')
     from pg_class where relname in ('client_lineup_v', 'client_role_sections_v', 'client_arrivals_v')),
  'the three restated views keep owner rights and their security barrier (ADR-0004)');
select ok(pg_get_viewdef('client_lineup_v'::regclass) ~ 'client_portal_visible\(e\.client_id\)'
          and pg_get_viewdef('client_role_sections_v'::regclass) ~ 'client_portal_visible\(e\.client_id\)'
          and pg_get_viewdef('client_arrivals_v'::regclass) ~ 'client_portal_visible\(e\.client_id\)',
  'each still carries client_portal_visible(e.client_id) in its own body');
select ok(not has_table_privilege('anon', 'client_lineup_v', 'select')
          and not has_table_privilege('anon', 'client_role_sections_v', 'select')
          and not has_table_privilege('anon', 'client_arrivals_v', 'select')
          and not has_table_privilege('authenticated', 'client_lineup_v', 'insert')
          and not has_table_privilege('authenticated', 'client_role_sections_v', 'update')
          and not has_table_privilege('authenticated', 'client_arrivals_v', 'delete')
          and has_table_privilege('authenticated', 'client_lineup_v', 'select'),
  'SELECT to authenticated and nothing else to anybody (ADR-0004 rule (d))');
select is(
  (select count(*)::int from information_schema.columns
    where table_schema = 'public' and table_name = 'client_lineup_v'
      and column_name in ('seat', 'headcount', 'confirmed_at', 'check_in_at', 'first_in')),
  0,
  'the seat, the headcount and the timestamps that order it stay inside the view');

-- ---------------------------------------------------------------------
-- As Client A (the Marco of this file).
-- ---------------------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', :'clienta_uid', 'role', 'authenticated')::text, true);
set local role authenticated;

select is((select count(*)::int from client_lineup_v where event_id = :'ev_up'), 4,
  'six confirmed on a headcount of four: the customer gets four rows, not six');
select bag_eq(
  $$ select booking_id::text from client_lineup_v where event_id = 'e8150000-0000-4000-8000-000000000001' $$,
  $$ values ('08150000-0000-4000-8000-000000000001'), ('08150000-0000-4000-8000-000000000002'),
            ('08150000-0000-4000-8000-000000000003'), ('08150000-0000-4000-8000-000000000004') $$,
  'before the event the four confirmed first take the seats; a tie on confirmed_at goes to the lower booking id');
select is((select confirmed from client_role_sections_v where shift_id = :'sh_up'), 4,
  '"N of M confirmed" never says six: the section''s confirmed is held to its headcount');
select is((select headcount from client_role_sections_v where shift_id = :'sh_up'), 4,
  '… and M is still the headcount booked, never headcount + buffer');

select is((select count(*)::int from client_lineup_v where event_id = :'ev_live'), 4,
  'on the day: still four rows');
select bag_eq(
  $$ select booking_id::text from client_lineup_v where event_id = 'e8150000-0000-4000-8000-000000000002' $$,
  $$ values ('08150000-0000-4000-8000-000000000016'), ('08150000-0000-4000-8000-000000000015'),
            ('08150000-0000-4000-8000-000000000011'), ('08150000-0000-4000-8000-000000000012') $$,
  'RULE-15: the three who checked in take seats first (6, 5, 1), then the earliest confirmed of the rest (2) — not 4, whose only press was out of radius');
select results_eq(
  $$ select confirmed, arrived from client_arrivals_v where shift_id = 'f8150000-0000-4000-8000-000000000002' $$,
  $$ values (4, 3) $$,
  '"N of M arrived" reads 3 of 4: the arrivals among the faces shown, never "of 6"');

reset role;
-- Two more check-ins (2 and 3): five arrivals on a section of four.
insert into check_logs (booking_id, attempted_at, outcome, check_in_at) values
  (:'l2', now() - interval '10 minutes', 'checked_in', now() - interval '10 minutes'),
  (:'l3', now() - interval '5 minutes',  'checked_in', now() - interval '5 minutes');
set local role authenticated;
select results_eq(
  $$ select confirmed, arrived from client_arrivals_v where shift_id = 'f8150000-0000-4000-8000-000000000002' $$,
  $$ values (4, 4) $$,
  'arrived is held to the headcount too: the fifth check-in never reads "5 of 4"');
select bag_eq(
  $$ select booking_id::text from client_lineup_v where event_id = 'e8150000-0000-4000-8000-000000000002' $$,
  $$ values ('08150000-0000-4000-8000-000000000016'), ('08150000-0000-4000-8000-000000000015'),
            ('08150000-0000-4000-8000-000000000011'), ('08150000-0000-4000-8000-000000000012') $$,
  'the first four check-ins hold the seats; the fifth (3, at the door last) is not shown');

-- ---------------------------------------------------------------------
-- A worker the customer already rated stays visible.
-- ---------------------------------------------------------------------
reset role;
insert into feedback (author_kind, author_id, staff_id, event_id, rating, text)
values ('client', :'clienta_uid', :'s4', :'ev_live', 2, 'Never arrived at the door');
set local role authenticated;
select is((select count(*)::int from client_lineup_v where event_id = :'ev_live'), 5,
  'the rated worker stays on the line-up although their seat is past the headcount');
select results_eq(
  $$ select feedback_given, feedback_rating from client_lineup_v where booking_id = '08150000-0000-4000-8000-000000000014' $$,
  $$ values (true, 2) $$,
  '… with the customer''s own stars, so "✓ Feedback sent" and the feedback history still find them');
select ok(not exists (select 1 from client_lineup_v where booking_id = :'l3'),
  'the unrated fifth arrival is still not shown');
select is((select confirmed from client_role_sections_v where shift_id = :'sh_live'), 4,
  'the count stays the booking: a kept rated face never makes "5 of 4"');
reset role;

-- ---------------------------------------------------------------------
-- Tenancy: Client B, a worker and the admin.
-- ---------------------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', :'clientb_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select count(*)::int from client_lineup_v where event_id in (:'ev_up', :'ev_live')), 0,
  'another customer sees none of these rows');
reset role;

select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select count(*)::int from client_role_sections_v where event_id in (:'ev_up', :'ev_live')), 0,
  'a worker reads no section, capped or not');
reset role;

select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select count(*)::int from client_lineup_v where event_id = :'ev_up'), 4,
  'the admin reads the customer''s view of the line-up through the same definition: four');
reset role;

select * from finish();
rollback;
