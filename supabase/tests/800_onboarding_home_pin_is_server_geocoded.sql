-- =====================================================================
-- 800 · the onboarding home pin is checked against the postcode the
--       server looked up
--       20261012121400 · §2.3 step 2/11, §6 proximity
--
-- onboarding_save_address() took the pin from the candidate's session.
-- Now a session cannot place a pin at all; the Staff App's action calls
-- onboarding_save_address_geocoded() with the service key and the
-- postcode's centroid, and the pin must be within 5 km of it.
-- =====================================================================
begin;
select plan(10);

\set cand     '80000000-0000-4000-8000-0000000000c1'
\set cand_uid '80000000-0000-4000-8000-0000000000a1'

insert into auth.users (id, email) values (:'cand_uid', 'cand800@rls.test');
insert into profiles (id, role, full_name) values (:'cand_uid', 'staff', 'Pia Pin');
insert into staff (id, user_id, first_name, last_name, email, phone, dob, status, rtw_branch)
values (:'cand', :'cand_uid', 'Pia', 'Pin', 'cand800@rls.test', '+447700980001', date '1999-01-01', 'documents', 'uk_irish');
insert into onboarding_progress (staff_id, rtw_at, updated_at) values (:'cand', now(), now());

-- E2 0RY's centroid is about (51.5290, -0.0450).
select ok(not has_function_privilege('authenticated', 'public.onboarding_save_address(text, text, text, double precision, double precision)', 'execute'),
  'a session can no longer call the pin-taking onboarding_save_address()');
select ok(not has_function_privilege('authenticated', 'public.onboarding_save_address_geocoded(uuid, text, text, text, double precision, double precision, double precision, double precision)', 'execute')
      and not has_function_privilege('anon', 'public.onboarding_save_address_geocoded(uuid, text, text, text, double precision, double precision, double precision, double precision)', 'execute'),
  'nor the geocoded one');
select ok(has_function_privilege('service_role', 'public.onboarding_save_address_geocoded(uuid, text, text, text, double precision, double precision, double precision, double precision)', 'execute'),
  'the Staff App''s server action (service key) can');

set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select throws_ok(format($$ select onboarding_save_address_geocoded(%L, 'Flat 4, 22 Roman Road', 'London', 'E2 0RY', 51.5010, -0.1410, 51.5290, -0.0450) $$, :'cand'),
  'P0001', 'pin_far_from_postcode', 'a pin beside a West End venue, 7 km from the postcode, is refused');
select throws_ok(format($$ select onboarding_save_address_geocoded(%L, 'Flat 4, 22 Roman Road', 'London', 'E2 0RY', 51.5290, -0.0450, null, null) $$, :'cand'),
  'P0001', 'postcode_not_located', 'no centroid, no save');
select throws_ok(format($$ select onboarding_save_address_geocoded(%L, 'Flat 4, 22 Roman Road', 'London', 'E2 0RY', 40.7, -74.0, 51.5290, -0.0450) $$, :'cand'),
  'P0001', 'pin_outside_uk', 'the UK box still applies');
select lives_ok(format($$ select onboarding_save_address_geocoded(%L, 'Flat 4, 22 Roman Road', 'London', 'e20ry', 51.5300, -0.0470, 51.5290, -0.0450) $$, :'cand'),
  'a pin dragged to the front door, near the centroid, is saved');
select throws_ok($$ select onboarding_save_address_geocoded(null, 'x', 'y', 'E2 0RY', 51.53, -0.047, 51.529, -0.045) $$,
  'P0001', 'unknown_staff', 'a missing candidate is unknown_staff');
reset role;

select results_eq(format($$ select home_address, round(st_y(home_location::geometry)::numeric, 4) from staff where id = %L $$, :'cand'),
  $$ values ('Flat 4, 22 Roman Road, London E2 0RY'::text, 51.5300::numeric) $$,
  'the address and the pin land as before');
select ok((select address_at is not null from onboarding_progress where staff_id = :'cand'), 'and the step is marked done');

select * from finish();
rollback;
