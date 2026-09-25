-- =====================================================================
-- 607 · client_arrivals_v — "11 of 13 arrived" (§11 addition, ADR-0038)
--
-- 20260929100100. Counts only, per role section, once the event has
-- started. Asserted here:
--   * the ADR-0004 shape (owner rights, security barrier, the predicate in
--     the body, exactly four named columns, SELECT to authenticated only);
--   * the counts: arrived vs confirmed vs not-yet vs turned-away vs
--     cancelled/invited vs an out-of-radius press vs repeated attempts;
--   * the denominator is the confirmed line-up, the same one
--     client_role_sections_v and client_lineup_v show;
--   * no row before the earliest role start (boundary included), none
--     for a cancelled event;
--   * a client sees only its own events; another client, a worker, a
--     client with no company and anon see none of them;
--   * the client role still holds no table policy (001_rls_guard's set)
--     and check_logs / bookings stay closed to it.
-- =====================================================================
begin;
select plan(33);
\ir _shared/fixtures.psql

-- ---- fixture rows of our own -------------------------------------------
\set ev_s     'e7e7e7e7-0000-4000-8000-000000000001'
\set ev_x     'e7e7e7e7-0000-4000-8000-000000000002'
\set ev_b2    'e7e7e7e7-0000-4000-8000-000000000003'
\set sh_s1    'f7f7f7f7-0000-4000-8000-000000000001'
\set sh_s2    'f7f7f7f7-0000-4000-8000-000000000002'
\set sh_x     'f7f7f7f7-0000-4000-8000-000000000003'
\set sh_b2    'f7f7f7f7-0000-4000-8000-000000000004'
\set st_c     'd7d7d7d7-0000-4000-8000-00000000000c'
\set st_d     'd7d7d7d7-0000-4000-8000-00000000000d'
\set st_e     'd7d7d7d7-0000-4000-8000-00000000000e'
\set st_f     'd7d7d7d7-0000-4000-8000-00000000000f'
\set st_g     'd7d7d7d7-0000-4000-8000-000000000010'
\set st_h     'd7d7d7d7-0000-4000-8000-000000000011'
\set st_i     'd7d7d7d7-0000-4000-8000-000000000012'
\set st_j     'd7d7d7d7-0000-4000-8000-000000000013'
\set bk_a     '07070707-0000-4000-8000-000000000001'
\set bk_b     '07070707-0000-4000-8000-000000000002'
\set bk_c     '07070707-0000-4000-8000-000000000003'
\set bk_d     '07070707-0000-4000-8000-000000000004'
\set bk_e     '07070707-0000-4000-8000-000000000005'
\set bk_f     '07070707-0000-4000-8000-000000000006'
\set bk_g     '07070707-0000-4000-8000-000000000007'
\set bk_h     '07070707-0000-4000-8000-000000000008'
\set bk_i     '07070707-0000-4000-8000-000000000009'
\set bk_j     '07070707-0000-4000-8000-00000000000a'

insert into staff (id, employee_id, first_name, last_name, email, phone, dob, status) values
  (:'st_c', 90703, 'Staff', 'Charlie', 'staffc-607@rls.test', '+447700907003', date '1996-03-03', 'compliant'),
  (:'st_d', 90704, 'Staff', 'Delta',   'staffd-607@rls.test', '+447700907004', date '1996-04-04', 'compliant'),
  (:'st_e', 90705, 'Staff', 'Echo',    'staffe-607@rls.test', '+447700907005', date '1996-05-05', 'compliant'),
  (:'st_f', 90706, 'Staff', 'Foxtrot', 'stafff-607@rls.test', '+447700907006', date '1996-06-06', 'compliant'),
  (:'st_g', 90707, 'Staff', 'Golf',    'staffg-607@rls.test', '+447700907007', date '1996-07-07', 'compliant'),
  (:'st_h', 90708, 'Staff', 'Hotel',   'staffh-607@rls.test', '+447700907008', date '1996-08-08', 'compliant'),
  (:'st_i', 90709, 'Staff', 'India',   'staffi-607@rls.test', '+447700907009', date '1996-09-09', 'compliant'),
  (:'st_j', 90710, 'Staff', 'Juliet',  'staffj-607@rls.test', '+447700907010', date '1996-10-10', 'compliant');

-- ev_s:  client A, started an hour ago. Section 1 is under way; section 2
--        starts in two hours (a later role window, RULE-18).
-- ev_x:  client A, started, but cancelled.
-- ev_b2: client B, started.
-- The fixture's event_a (client A, a week out) is the not-yet-started one,
-- and it already carries a check-in log (checklog_a) — the gate must hold
-- even so.
insert into events (id, client_id, venue_id, venue_name, venue_address, venue_location, geofence_radius_m,
                    title, event_date, pays_breaks, pays_buffer, cancelled_at) values
  (:'ev_s',  :'clienta', :'venue_id', 'RLS Fixture Venue', '1 Test Street, London',
   st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150, 'Arrivals Started A', current_date, true, true, null),
  (:'ev_x',  :'clienta', :'venue_id', 'RLS Fixture Venue', '1 Test Street, London',
   st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150, 'Arrivals Cancelled A', current_date, true, true, now()),
  (:'ev_b2', :'clientb', :'venue_id', 'RLS Fixture Venue', '1 Test Street, London',
   st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150, 'Arrivals Started B', current_date, false, false, null);

insert into shift_requirements (id, event_id, role_id, starts_at, ends_at, headcount, buffer,
                                charge_rate, pay_rate, dress_code, allocation_per_hour) values
  (:'sh_s1', :'ev_s',  :'role_id', now() - interval '1 hour',    now() + interval '6 hours', 6, 1, 22.97, 14.00, 'Black tie', 7),
  (:'sh_s2', :'ev_s',  :'role_id', now() + interval '2 hours',   now() + interval '8 hours', 3, 0, 22.97, 14.00, 'Black tie', 3),
  (:'sh_x',  :'ev_x',  :'role_id', now() - interval '1 hour',    now() + interval '6 hours', 2, 0, 22.97, 14.00, 'Black tie', 2),
  (:'sh_b2', :'ev_b2', :'role_id', now() - interval '30 minutes', now() + interval '6 hours', 2, 0, 19.50, 13.50, 'Smart black', 2);

-- Section 1 of ev_s, one worker per case:
--   a  worked · out-of-radius press, then checked in  → arrived (once)
--   b  worked · checked in late                        → arrived
--   c  confirmed · nothing yet                         → confirmed only
--   d  confirmed · only an out-of-radius press         → confirmed only
--   e  turned away under RULE-15                        → neither
--   f  cancelled                                        → neither
--   g  invited                                          → neither
-- Section 2 of ev_s:
--   h  confirmed · section not started                  → confirmed only
insert into bookings (id, shift_id, staff_id, status, source, confirmed_at) values
  (:'bk_a', :'sh_s1', :'staffa', 'worked',      'auto',   now() - interval '2 days'),
  (:'bk_b', :'sh_s1', :'staffb', 'worked',      'auto',   now() - interval '2 days'),
  (:'bk_c', :'sh_s1', :'st_c',   'confirmed',   'auto',   now() - interval '2 days'),
  (:'bk_d', :'sh_s1', :'st_d',   'confirmed',   'manual', now() - interval '2 days'),
  (:'bk_e', :'sh_s1', :'st_e',   'turned_away', 'auto',   now() - interval '2 days'),
  (:'bk_f', :'sh_s1', :'st_f',   'cancelled',   'auto',   null),
  (:'bk_g', :'sh_s1', :'st_g',   'invited',     'auto',   null),
  (:'bk_h', :'sh_s2', :'st_h',   'confirmed',   'auto',   now() - interval '2 days'),
  (:'bk_i', :'sh_x',  :'st_i',   'worked',      'auto',   now() - interval '2 days'),
  (:'bk_j', :'sh_b2', :'st_j',   'worked',      'auto',   now() - interval '2 days');

insert into check_logs (booking_id, attempted_at, outcome, check_in_at) values
  (:'bk_a', now() - interval '65 minutes', 'out_of_radius', null),
  (:'bk_a', now() - interval '62 minutes', 'checked_in',    now() - interval '62 minutes'),
  (:'bk_b', now() - interval '40 minutes', 'checked_in',    now() - interval '40 minutes'),
  (:'bk_d', now() - interval '50 minutes', 'out_of_radius', null),
  (:'bk_e', now() - interval '55 minutes', 'turned_away',   null),
  (:'bk_i', now() - interval '55 minutes', 'checked_in',    now() - interval '55 minutes'),
  (:'bk_j', now() - interval '25 minutes', 'checked_in',    now() - interval '25 minutes');

-- ---- shape (ADR-0004) ---------------------------------------------------
select ok(not (coalesce((select reloptions from pg_class where relname = 'client_arrivals_v'), '{}') @> '{security_invoker=true}'),
  'client_arrivals_v runs with owner rights, so check_logs and bookings stay closed to the client role (ADR-0004)');
select ok((coalesce((select reloptions from pg_class where relname = 'client_arrivals_v'), '{}') @> '{security_barrier=true}'),
  'client_arrivals_v is a security barrier, so no user-supplied qual runs ahead of the tenancy predicate');
select ok(pg_get_viewdef('client_arrivals_v'::regclass) ~ 'client_portal_visible\(e\.client_id\)',
  'the tenancy rule is in the view''s own body: client_portal_visible(e.client_id)');
select bag_eq(
  $$ select column_name::text from information_schema.columns
      where table_schema = 'public' and table_name = 'client_arrivals_v' $$,
  $$ values ('shift_id'::text),('event_id'),('confirmed'),('arrived') $$,
  'client_arrivals_v names exactly four columns: counts only — no name, no time, no status per person, no location, no money');
select ok(not has_table_privilege('anon', 'client_arrivals_v', 'select'),
  'anon holds no privilege on client_arrivals_v');
select ok(has_table_privilege('authenticated', 'client_arrivals_v', 'select'),
  'a signed-in caller may select client_arrivals_v; the body decides what comes back');
select ok(not has_table_privilege('authenticated', 'client_arrivals_v', 'insert')
      and not has_table_privilege('authenticated', 'client_arrivals_v', 'update')
      and not has_table_privilege('authenticated', 'client_arrivals_v', 'delete'),
  '§11.1 read-only: nobody writes through client_arrivals_v');

-- ---- client A -----------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', :'clienta_uid', 'role', 'authenticated')::text, true);
set local role authenticated;

select results_eq(
  $$ select shift_id, event_id, confirmed, arrived from client_arrivals_v order by shift_id $$,
  format($$ values (%L::uuid, %L::uuid, 4, 2), (%L::uuid, %L::uuid, 1, 0) $$,
         :'sh_s1', :'ev_s', :'sh_s2', :'ev_s'),
  'client A sees one row per role section of its started event: 2 of 4 arrived in section 1 (turned-away, cancelled and invited in neither number; a no-check-in and an out-of-radius press in confirmed only; two attempts count once), 0 of 1 in the later section');
select is((select sum(arrived)::int || ' of ' || sum(confirmed)::int from client_arrivals_v where event_id = :'ev_s'),
  '2 of 5', 'the event total adds its sections: "2 of 5 arrived"');
select is((select count(*)::int from client_arrivals_v where event_id = :'event_a'), 0,
  'no row before the event''s earliest role start, even with a check-in already logged against it');
select is((select count(*)::int from client_arrivals_v where event_id = :'ev_x'), 0,
  'no row for a cancelled event');
select is((select count(*)::int from client_arrivals_v where event_id = :'ev_b2'), 0,
  'client A cannot see client B''s arrivals, even by asking for the event');
select results_eq(
  $$ select a.shift_id, a.confirmed from client_arrivals_v a order by a.shift_id $$,
  $$ select s.shift_id, s.confirmed from client_role_sections_v s
      where s.shift_id in (select shift_id from client_arrivals_v) order by s.shift_id $$,
  'the denominator is the confirmed count client_role_sections_v shows for the same section');
select is((select sum(confirmed)::int from client_arrivals_v where event_id = :'ev_s'),
          (select count(*)::int from client_lineup_v where event_id = :'ev_s'),
  'and it is the confirmed line-up, row for row: client_lineup_v has as many people as the view counts');
select is((select count(*)::int from check_logs), 0,
  'check_logs stays closed to the client role: the counts come only through the view');
select is((select count(*)::int from bookings), 0,
  'bookings stays closed to the client role (ADR-0004)');

-- ---- client B -----------------------------------------------------------
reset role;
select set_config('request.jwt.claims', json_build_object('sub', :'clientb_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select results_eq(
  $$ select shift_id, event_id, confirmed, arrived from client_arrivals_v $$,
  format($$ values (%L::uuid, %L::uuid, 1, 1) $$, :'sh_b2', :'ev_b2'),
  'client B sees its own started event and nothing else');
select is((select count(*)::int from client_arrivals_v where event_id in (:'ev_s', :'ev_x', :'event_a')), 0,
  'client B sees none of client A''s rows');

-- ---- a worker -----------------------------------------------------------
reset role;
select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select count(*)::int from client_arrivals_v), 0,
  'a worker sees nothing through client_arrivals_v, not even the shift they checked in to');

-- ---- a client profile with no client_id --------------------------------
reset role;
insert into auth.users (id, email) values (:'new_id', 'orphan-607@rls.test');
insert into profiles (id, role, full_name, client_id) values (:'new_id', 'client', 'Client with no company', null);
select set_config('request.jwt.claims', json_build_object('sub', :'new_id', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select count(*)::int from client_arrivals_v), 0,
  'a client profile with a null client_id matches no event rather than every event');

-- ---- the admin: inside the predicate, and the gate still applies -------
reset role;
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select count(*)::int from client_arrivals_v where event_id in (:'ev_s', :'ev_b2')), 3,
  'an admin reads both clients'' started events through the same definition');
select is((select count(*)::int from client_arrivals_v where event_id in (:'event_a', :'event_b', :'ev_x')), 0,
  'the start gate and the cancelled filter hold for the admin too: they are in the view, not the screen');

-- ---- the start gate, at its boundary -------------------------------------
-- now() is fixed for the transaction, so these are exact.
reset role;
update shift_requirements set starts_at = now() + interval '1 second', ends_at = now() + interval '8 hours'
 where id = :'shift_a';
select set_config('request.jwt.claims', json_build_object('sub', :'clienta_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select count(*)::int from client_arrivals_v where event_id = :'event_a'), 0,
  'one second before the earliest role start: still no row');

reset role;
update shift_requirements set starts_at = now() where id = :'shift_a';
select set_config('request.jwt.claims', json_build_object('sub', :'clienta_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select results_eq(
  $$ select confirmed, arrived from client_arrivals_v where event_id = $$ || quote_literal(:'event_a'),
  $$ values (1, 1) $$,
  'at the earliest role start the row appears, and the fixture''s logged check-in counts: 1 of 1');

-- ---- a turned-away worker moves out of both numbers ----------------------
reset role;
update bookings set status = 'turned_away' where id = :'bk_d';
select set_config('request.jwt.claims', json_build_object('sub', :'clienta_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select results_eq(
  $$ select confirmed, arrived from client_arrivals_v where shift_id = $$ || quote_literal(:'sh_s1'),
  $$ values (3, 2) $$,
  'RULE-15: a confirmed worker turned away at the door leaves the line-up, so they leave the denominator and never reach the numerator');

-- ---- the office's "Get back" registers an arrival (§9.5) -----------------
reset role;
insert into check_logs (booking_id, attempted_at, outcome, check_in_at, on_site_verified)
values (:'bk_c', now(), 'checked_in', now(), false);
update bookings set status = 'worked' where id = :'bk_c';
select set_config('request.jwt.claims', json_build_object('sub', :'clienta_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select results_eq(
  $$ select confirmed, arrived from client_arrivals_v where shift_id = $$ || quote_literal(:'sh_s1'),
  $$ values (3, 3) $$,
  'a No-show the office gets back (§9.5 "registers the worker as arrived") becomes an arrival');

-- ---- the end gate: on the day only (security review, 29.09) -------------
-- After the event's latest role end the rows go. Kept, they would join to
-- client_lineup_v's names and become a permanent per-worker attendance
-- record — a one-person section reading 0 of 1 names a No-show. The gate is
-- the same `between` event_status() uses for 'ongoing', so the view and the
-- screen's status pill can never disagree.
reset role;
update shift_requirements set starts_at = now() - interval '8 hours', ends_at = now()
 where event_id = :'event_a';
select set_config('request.jwt.claims', json_build_object('sub', :'clienta_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select count(*)::int from client_arrivals_v where event_id = :'event_a'), 1,
  'at the latest role end the event is still ongoing, and its row is still there');

reset role;
update shift_requirements set ends_at = now() - interval '1 second' where event_id = :'event_a';
select set_config('request.jwt.claims', json_build_object('sub', :'clienta_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select count(*)::int from client_arrivals_v where event_id = :'event_a'), 0,
  'one second after the latest role end: no row — the counts do not outlive the day');

reset role;
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select count(*)::int from client_arrivals_v where event_id = :'event_a'), 0,
  'the end gate holds for the admin too: it is in the view, not the screen');

-- ---- privileges, exactly -------------------------------------------------
reset role;
select table_privs_are('public', 'client_arrivals_v', 'authenticated', array['SELECT'],
  'authenticated holds SELECT on client_arrivals_v and nothing else');

-- ---- anon ----------------------------------------------------------------
reset role;
select set_config('request.jwt.claims', '', true);
set local role anon;
select throws_ok($$ select * from client_arrivals_v $$, '42501', null,
  'anon is refused outright, not handed an empty set');

-- ---- the client role still holds no table policy -------------------------
reset role;
select is_empty(
  $$ select c.relname::text from pg_policy p join pg_class c on c.oid = p.polrelid
      where p.polname like 'client\_%' $$,
  'ADR-0026 still holds: the client role has no policy on any table (001_rls_guard assertion 5)');
select is((select count(*)::int from pg_policy p join pg_class c on c.oid = p.polrelid
            where c.relname in ('check_logs', 'bookings', 'shift_requirements')
              and coalesce(pg_get_expr(p.polqual, p.polrelid), '') ~ 'client'''),
  0, 'no policy on check_logs, bookings or shift_requirements names the client role');

select * from finish();
rollback;
