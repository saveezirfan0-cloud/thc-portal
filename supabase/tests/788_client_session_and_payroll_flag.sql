-- =====================================================================
-- 788 · 20261012120100: a client token dies with its sign-in session;
--       booking_payroll_exported() answers the office only
--
--   A. current_app_role(): a client token whose auth.sessions row is gone
--      has no role, so client_portal_visible() and every client_* view
--      stop answering at once; a live session and a token with no
--      session_id are judged as before; a worker is not held to it.
--   B. booking_payroll_exported(): an office login (a scheduler too), the
--      service role and a JWT-less connection get the answer; a client
--      and a worker get 42501. (020 holds the client refusal as well.)
-- =====================================================================
begin;
select plan(12);
\ir _shared/fixtures.psql

\set sess_client '78800000-0000-4000-8000-000000000001'
\set sess_staff  '78800000-0000-4000-8000-000000000002'

-- =====================================================================
-- A · the client session rule
-- =====================================================================
insert into auth.sessions (id, user_id, created_at, updated_at)
  values (:'sess_client', :'clienta_uid', now(), now());

select set_config('request.jwt.claims',
  json_build_object('sub', :'clienta_uid', 'role', 'authenticated', 'session_id', :'sess_client')::text, true);
select is(current_app_role()::text, 'client', 'a client token with a live session keeps its role');
set local role authenticated;
select is((select count(*)::int from client_events_v where id = :'event_a'), 1,
  'and reads its own event through client_events_v');
reset role;

delete from auth.sessions where id = :'sess_client';
select is(current_app_role(), null,
  'once the session is ended (sign out other devices, password change, switch off), the token has no role');
set local role authenticated;
select is((select count(*)::int from client_events_v where id = :'event_a'), 0,
  'and the portal''s views answer nothing straight away, not at the token''s exp');
reset role;

select set_config('request.jwt.claims',
  json_build_object('sub', :'clienta_uid', 'role', 'authenticated')::text, true);
select is(current_app_role()::text, 'client', 'a client token without session_id is judged as before');

select set_config('request.jwt.claims',
  json_build_object('sub', :'staffa_uid', 'role', 'authenticated', 'session_id', :'sess_staff')::text, true);
select is(current_app_role()::text, 'staff',
  'a worker token is not held to the session rule (unchanged: the Staff App replays its offline queue)');

-- =====================================================================
-- B · booking_payroll_exported
-- =====================================================================
insert into payroll_export_lines (report_send_id, booking_id, staff_id, event_id, state, shift_date, payable_min, rate, base, holiday)
select id, :'booking_a', :'staffa', :'event_a', 'exported', current_date, 480, 14.00, 112.00, 13.52
  from report_sends where error = 'rls_fixture_probe';

select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is(booking_payroll_exported(:'booking_a'), true, 'an office login gets the answer');
reset role;

update profiles set office_role = 'scheduler' where id = :'admin_uid';
set local role authenticated;
select is(booking_payroll_exported(:'booking_a'), true,
  'so does a scheduler, who reads no payroll lines — the reason the function is definer');
reset role;
update profiles set office_role = 'owner' where id = :'admin_uid';

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select is(booking_payroll_exported(:'booking_a'), true, 'the service role gets the answer');
reset role;

select set_config('request.jwt.claims', '', true);
select is(booking_payroll_exported(:'booking_a'), true, 'a connection with no API JWT (a job) gets the answer');

select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(format($$ select booking_payroll_exported(%L) $$, :'booking_a'), '42501', 'not_authorised',
  'a worker cannot ask whether a booking is in payroll');
reset role;

select set_config('request.jwt.claims', json_build_object('sub', :'clienta_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(format($$ select booking_payroll_exported(%L) $$, :'booking_a'), '42501', 'not_authorised',
  'nor can a client');
reset role;

select * from finish();
rollback;
