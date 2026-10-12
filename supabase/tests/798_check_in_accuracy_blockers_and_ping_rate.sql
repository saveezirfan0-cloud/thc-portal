-- =====================================================================
-- 798 · check-in hears the GPS accuracy and the worker's blockers;
--       pings are rate-limited
--       20261012121200 · §5.1, §9.5, §10.1, RULE-20
--
--   A. p_accuracy is optional on all three RPCs and stored; the old
--      three-argument call still works.
--   B. location_suspect flags (never refuses) a fix with no accuracy, an
--      accuracy wider than the fence, or one on the venue's centre; the
--      §9.5 monitor shows it.
--   C. a compliant worker with an expired document, an unreviewed
--      conviction or no right to work on the day cannot check in.
--   D. one ping per booking per 20 seconds.
-- =====================================================================
begin;
select plan(27);
\ir _shared/fixtures.psql

\set ev   '79800000-0000-4000-8000-0000000000e1'
\set sh   '79800000-0000-4000-8000-0000000000f1'
-- workers (staff id / login / booking)
\set ok1  '79800000-0000-4000-8000-000000000001'
\set ok2  '79800000-0000-4000-8000-000000000002'
\set ok3  '79800000-0000-4000-8000-000000000003'
\set ok4  '79800000-0000-4000-8000-000000000004'
\set exp  '79800000-0000-4000-8000-000000000005'
\set conv '79800000-0000-4000-8000-000000000006'
\set rtw  '79800000-0000-4000-8000-000000000007'

insert into auth.users (id, email)
select ('79800000-0000-4000-8000-0000000001' || lpad(n::text, 2, '0'))::uuid, 'w' || n || '@t798.test'
  from generate_series(1, 7) n;
insert into profiles (id, role, full_name)
select ('79800000-0000-4000-8000-0000000001' || lpad(n::text, 2, '0'))::uuid, 'staff', 'Worker ' || n
  from generate_series(1, 7) n;
insert into staff (id, user_id, employee_id, first_name, last_name, email, phone, dob, status, rtw_branch, right_to_work_until)
select ('79800000-0000-4000-8000-00000000000' || n)::uuid,
       ('79800000-0000-4000-8000-0000000001' || lpad(n::text, 2, '0'))::uuid,
       97980 + n, 'Worker', 'No' || n, 'w' || n || '@t798.test', '+44770097980' || n, date '1995-01-01', 'compliant',
       case when n = 7 then 'work_visa'::rtw_branch else 'uk_irish'::rtw_branch end,
       case when n = 7 then current_date + 30 end
  from generate_series(1, 7) n;

-- An expired passport (verified, so it counts) and an unreviewed conviction.
insert into compliance_docs (staff_id, doc_type, file_path, review_status, expiry_date)
values (:'exp', 'passport', 'documents/exp/passport.pdf', 'verified', current_date - 1);
insert into criminal_declarations (staff_id, source, answer) values (:'conv', 'in_employment', true);

insert into events (id, client_id, venue_id, venue_name, venue_address, venue_location, geofence_radius_m,
                    title, event_date, pays_breaks, pays_buffer) values
  (:'ev', :'clienta', :'venue_id', 'RLS Fixture Venue', '1 Test Street, London',
   st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150, 'Accuracy Fixture', current_date, true, true);
insert into shift_requirements (id, event_id, role_id, starts_at, ends_at, headcount, buffer,
                                charge_rate, pay_rate, allocation_per_hour) values
  (:'sh', :'ev', :'role_id', now() + interval '10 minutes', now() + interval '6 hours', 10, 0, 22.97, 14.00, 10);
insert into bookings (id, shift_id, staff_id, status, source, confirmed_at)
select ('79800000-0000-4000-8000-0000000002' || lpad(n::text, 2, '0'))::uuid, :'sh',
       ('79800000-0000-4000-8000-00000000000' || n)::uuid, 'confirmed', 'auto', now() - interval '2 days'
  from generate_series(1, 7) n;
-- Booked while the visa was good; the date has since been corrected to
-- yesterday (the rota guard would refuse the booking itself today).
update staff set right_to_work_until = current_date - 1 where id = :'rtw';

\set b1 '79800000-0000-4000-8000-000000000201'
\set b2 '79800000-0000-4000-8000-000000000202'
\set b3 '79800000-0000-4000-8000-000000000203'
\set b4 '79800000-0000-4000-8000-000000000204'
\set b5 '79800000-0000-4000-8000-000000000205'
\set b6 '79800000-0000-4000-8000-000000000206'
\set b7 '79800000-0000-4000-8000-000000000207'

-- =====================================================================
-- A + B · accuracy and the flag
-- =====================================================================
select set_config('request.jwt.claims', '{"sub":"79800000-0000-4000-8000-000000000101","role":"authenticated"}', true);
set local role authenticated;
select is(attempt_check_in(:'b1', 51.5000, -0.1000, 10)->>'accepted', 'true',
  'a fix exactly on the venue centre is still accepted (flag only)');
select set_config('request.jwt.claims', '{"sub":"79800000-0000-4000-8000-000000000102","role":"authenticated"}', true);
select is(attempt_check_in(:'b2', 51.5005, -0.1000, 20)->>'accepted', 'true',
  'an ordinary fix 55 m in, 20 m accuracy');
select set_config('request.jwt.claims', '{"sub":"79800000-0000-4000-8000-000000000103","role":"authenticated"}', true);
select is(attempt_check_in(:'b3', 51.5005, -0.1000)->>'accepted', 'true',
  'the old three-argument call still works (no accuracy)');
select set_config('request.jwt.claims', '{"sub":"79800000-0000-4000-8000-000000000104","role":"authenticated"}', true);
select is(attempt_check_in(:'b4', 51.5005, -0.1000, 500)->>'accepted', 'true',
  'a 500 m-wide fix inside a 150 m fence');
reset role;

select results_eq(
  format($$ select booking_id, accuracy_m, location_suspect from check_logs
             where booking_id in (%L, %L, %L, %L) order by booking_id $$, :'b1', :'b2', :'b3', :'b4'),
  format($$ values (%L::uuid, 10.0::numeric, true), (%L::uuid, 20.0, false), (%L::uuid, null, true), (%L::uuid, 500.0, true) $$,
         :'b1', :'b2', :'b3', :'b4'),
  'accuracy is stored, and the centre fix, the missing accuracy and the wide one are flagged — the ordinary one is not');
select is(location_accuracy_m('NaN'::double precision), null::numeric, 'a non-number accuracy is stored as null');
select is(location_accuracy_m(-5), null::numeric, 'so is a negative one');

select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select results_eq(
  format($$ select booking_id, location_suspect from checkin_monitor_v where booking_id in (%L, %L) order by booking_id $$, :'b1', :'b2'),
  format($$ values (%L::uuid, true), (%L::uuid, false) $$, :'b1', :'b2'),
  '§9.5 the monitor carries location_suspect for the office');
reset role;

-- =====================================================================
-- C · blockers
-- =====================================================================
select set_config('request.jwt.claims', '{"sub":"79800000-0000-4000-8000-000000000105","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(format('select attempt_check_in(%L, 51.5005, -0.1, 10)', :'b5'),
  'P0001', 'staff_not_compliant', 'compliant on the row but with an expired passport: refused');
select set_config('request.jwt.claims', '{"sub":"79800000-0000-4000-8000-000000000106","role":"authenticated"}', true);
select throws_ok(format('select attempt_check_in(%L, 51.5005, -0.1, 10)', :'b6'),
  'P0001', 'staff_not_compliant', 'an unreviewed conviction: refused');
select set_config('request.jwt.claims', '{"sub":"79800000-0000-4000-8000-000000000107","role":"authenticated"}', true);
select throws_ok(format('select attempt_check_in(%L, 51.5005, -0.1, 10)', :'b7'),
  'P0001', 'staff_not_compliant', 'a right to work that ended yesterday (canRoster): refused');
reset role;
select is((select count(*)::int from check_logs where booking_id in (:'b5', :'b6', :'b7')), 0,
  'and nothing was written for any of them');

-- =====================================================================
-- D · pings
-- =====================================================================
select set_config('request.jwt.claims', '{"sub":"79800000-0000-4000-8000-000000000102","role":"authenticated"}', true);
set local role authenticated;
select is(record_ping(:'b2', 51.5005, -0.1000, 12)->>'decision', 'on_site', 'the first fix is recorded');
select is(record_ping(:'b2', 51.5005, -0.1000, 12)->>'decision', 'too_soon', 'a second within 20 seconds is ignored');
select is(record_ping(:'b2', 51.6000, -0.1000)->>'decision', 'too_soon', 'even an off-site one');
reset role;
select is((select count(*)::int from location_pings where booking_id = :'b2'), 1, 'only one row was written');
select is((select count(*)::int from violations where booking_id = :'b2' and type = 'left_geofence'), 0,
  'and the ignored off-site fix raised nothing');
select is((select accuracy_m from location_pings where booking_id = :'b2'), 12.0::numeric, 'the ping''s accuracy is stored');

update location_pings set at = at - interval '25 seconds' where booking_id = :'b2';
set local role authenticated;
select is(record_ping(:'b2', 51.5005, -0.1000)->>'decision', 'on_site', 'after 20 seconds the next fix is recorded');
select is(record_ping(:'b2', 51.5005, -0.1000)->>'messageKey', 'too_soon', 'with messageKey too_soon for the app when early');
reset role;
select is((select count(*)::int from location_pings where booking_id = :'b2'), 2, 'two rows now');

-- =====================================================================
-- Check-out
-- =====================================================================
update check_logs set check_in_at = now() - interval '5 hours' where booking_id = :'b2';
update shift_requirements set starts_at = now() - interval '5 hours', ends_at = now() - interval '1 minute' where id = :'sh';
set local role authenticated;
select is(check_out(:'b2', 51.5005, -0.1000, 400)->>'decision', 'recorded_on_site', 'an on-site check-out with a 400 m-wide fix');
reset role;
select results_eq(format($$ select check_out_accuracy_m, location_suspect from check_logs where booking_id = %L $$, :'b2'),
  $$ values (400.0::numeric, true) $$, 'its accuracy is stored and the row is now flagged');

select set_config('request.jwt.claims', '{"sub":"79800000-0000-4000-8000-000000000101","role":"authenticated"}', true);
update check_logs set check_in_at = now() - interval '5 hours' where booking_id = :'b1';
set local role authenticated;
select is(check_out(:'b1', 51.5005, -0.1000)->>'decision', 'recorded_on_site', 'the old three-argument check-out works');
reset role;

-- =====================================================================
-- Grants
-- =====================================================================
select ok(not has_function_privilege('anon', 'public.attempt_check_in(uuid, double precision, double precision, double precision)', 'execute')
      and not has_function_privilege('anon', 'public.check_out(uuid, double precision, double precision, double precision)', 'execute')
      and not has_function_privilege('anon', 'public.record_ping(uuid, double precision, double precision, double precision)', 'execute'),
  'anon can call none of the three');
select ok(has_function_privilege('authenticated', 'public.attempt_check_in(uuid, double precision, double precision, double precision)', 'execute')
      and has_function_privilege('authenticated', 'public.check_out(uuid, double precision, double precision, double precision)', 'execute')
      and has_function_privilege('authenticated', 'public.record_ping(uuid, double precision, double precision, double precision)', 'execute'),
  'a signed-in worker can call all three');
select is((select count(*)::int from pg_proc where proname in ('attempt_check_in', 'check_out', 'record_ping')
            and pronamespace = 'public'::regnamespace), 3, 'one version of each: no overload left behind');

select * from finish();
rollback;
