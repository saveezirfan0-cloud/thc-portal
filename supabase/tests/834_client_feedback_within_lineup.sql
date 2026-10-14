-- =====================================================================
-- 834 · Client feedback only on the line-up the customer is shown
--       (§11.2, §11.5, RULE-15; ADR-0134 §1, ADR-0135 §4)
--       — 20261014170300_client_feedback_within_lineup.sql
--
-- A section of two with three confirmed: the third is THC's buffer and is
-- never on the customer's line-up. submit_client_feedback() must refuse
-- it with the generic "not on your line-up", exactly as for another
-- customer's booking, while the two seated workers can be rated, and a
-- worker the customer already rated (kept visible by ADR-0134) still
-- answers "already left".
-- =====================================================================
begin;
select plan(9);
\ir _shared/fixtures.psql

\set ev  'e8340000-0000-4000-8000-000000000001'
\set sh  'f8340000-0000-4000-8000-000000000001'
\set s1  'd8340000-0000-4000-8000-000000000001'
\set s2  'd8340000-0000-4000-8000-000000000002'
\set s3  'd8340000-0000-4000-8000-000000000003'
\set s4  'd8340000-0000-4000-8000-000000000004'
\set k1  '08340000-0000-4000-8000-000000000001'
\set k2  '08340000-0000-4000-8000-000000000002'
\set k3  '08340000-0000-4000-8000-000000000003'
\set k4  '08340000-0000-4000-8000-000000000004'

insert into staff (id, employee_id, first_name, last_name, email, phone, dob, status) values
  (:'s1', 98341, 'Seat',   'One',   'seat1-834@rls.test', '+447700983401', date '1996-01-01', 'compliant'),
  (:'s2', 98342, 'Seat',   'Two',   'seat2-834@rls.test', '+447700983402', date '1996-01-02', 'compliant'),
  (:'s3', 98343, 'Buffer', 'Three', 'buf3-834@rls.test',  '+447700983403', date '1996-01-03', 'compliant'),
  (:'s4', 98344, 'Buffer', 'Four',  'buf4-834@rls.test',  '+447700983404', date '1996-01-04', 'compliant');

insert into events (id, client_id, venue_id, venue_name, venue_address, venue_location, geofence_radius_m,
                    title, event_date, pays_breaks, pays_buffer) values
  (:'ev', :'clienta', :'venue_id', 'RLS Fixture Venue', '1 Test Street, London',
   st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150, 'Over-booked finished', current_date - 1, true, true);

insert into shift_requirements (id, event_id, role_id, starts_at, ends_at, headcount, buffer,
                                charge_rate, pay_rate, dress_code, allocation_per_hour) values
  (:'sh', :'ev', :'role_id', now() - interval '30 hours', now() - interval '22 hours', 2, 2, 22.97, 14.00, null, 6);

-- Confirmed in the order 1, 2, 3, 4: 1 and 2 hold the seats.
insert into bookings (id, shift_id, staff_id, status, source, confirmed_at) values
  (:'k1', :'sh', :'s1', 'confirmed', 'auto', now() - interval '9 days'),
  (:'k2', :'sh', :'s2', 'confirmed', 'auto', now() - interval '8 days'),
  (:'k3', :'sh', :'s3', 'confirmed', 'auto', now() - interval '7 days'),
  (:'k4', :'sh', :'s4', 'confirmed', 'auto', now() - interval '6 days');

-- An entry left on k4 before the trim (ADR-0134 keeps a rated face).
insert into feedback (author_kind, author_id, staff_id, event_id, rating, text)
values ('client', :'clienta_uid', :'s4', :'ev', 3, 'Left before the trim');

select ok(pg_get_functiondef('public.submit_client_feedback(uuid, integer, text)'::regprocedure) ~ 'client_lineup_v',
  'submit_client_feedback reads the customer''s line-up through client_lineup_v');
select ok(not has_function_privilege('anon', 'public.submit_client_feedback(uuid, integer, text)', 'execute')
          and has_function_privilege('authenticated', 'public.submit_client_feedback(uuid, integer, text)', 'execute'),
  'its grants are unchanged: authenticated only');

select set_config('request.jwt.claims', json_build_object('sub', :'clienta_uid', 'role', 'authenticated')::text, true);
set local role authenticated;

select ok(not exists (select 1 from client_lineup_v where booking_id = :'k3'),
  'the buffer worker is not on the customer''s line-up');
select throws_ok(format($$ select submit_client_feedback(%L, 4, 'A buffer worker') $$, :'k3'),
  '42501', 'That booking is not on your line-up',
  'a booking past the headcount, not already rated, is refused with the generic sentence');
select throws_ok(format($$ select submit_client_feedback(%L, 4, 'Not mine') $$, :'booking_b'),
  '42501', 'That booking is not on your line-up',
  '… the same sentence as another customer''s booking: the answer does not say which');
select isnt((select submit_client_feedback(:'k1', 5, 'Seated and rated')), null::uuid,
  'a seated worker can still be rated');
select throws_ok(format($$ select submit_client_feedback(%L, 2, 'Again') $$, :'k4'),
  '23505', 'Feedback has already been left for this person on this event',
  'a worker already rated stays on the line-up, so a second entry is "already left", not "not on your line-up"');
reset role;

select is((select count(*)::int from feedback where staff_id = :'s3' and author_kind = 'client'), 0,
  'nothing was written for the buffer worker');
select is((select count(*)::int from feedback where staff_id in (:'s1', :'s4') and author_kind = 'client' and event_id = :'ev'), 2,
  'the seated entry and the earlier one stand');

select * from finish();
rollback;
