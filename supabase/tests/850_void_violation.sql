-- =====================================================================
-- 850 · Void a violation · 20261019100000 · ADR-0151
--
--   A. void_violation(): an admin removes a violation with a note; the row
--      leaves `violations` and is kept, whole, in audit_log as
--      violation.voided against its booking. Another violation is
--      untouched.
--   B. Who may: admin only (staff, client and anon are refused); a note is
--      mandatory; an unknown id is refused; the internal mover and the
--      tick's memory are not callable by a signed-in role.
--   C. booking_tick(): BG-09 raises No check-out for a checked-in,
--      never-checked-out booking past end + 4 h — and does NOT raise it
--      again once it was voided; the same for BG-03's No-show. The control
--      booking in each case, never voided, is still raised.
--
-- February 2026: every shift is in the past and every instant is fixed.
-- =====================================================================
begin;
select plan(26);
\ir _shared/fixtures.psql

\set evt      '85a00000-0000-4000-8000-000000000001'
\set sh       '85b00000-0000-4000-8000-000000000001'
\set st_ns    '85d00000-0000-4000-8000-000000000001'
\set b_ctl    '85c00000-0000-4000-8000-000000000001'
\set b_void   '85c00000-0000-4000-8000-000000000002'
\set b_ns_ctl '85c00000-0000-4000-8000-000000000003'
\set b_ns_void '85c00000-0000-4000-8000-000000000004'
\set v_void   '85e00000-0000-4000-8000-000000000001'
\set v_ns     '85e00000-0000-4000-8000-000000000002'
\set v_keep   '85e00000-0000-4000-8000-000000000003'
\set st_ns2   '85d00000-0000-4000-8000-000000000002'

insert into events (id, client_id, venue_id, venue_name, venue_address, venue_location,
                    geofence_radius_m, title, event_date, pays_breaks, pays_buffer) values
  (:'evt', :'clienta', :'venue_id', 'RLS Fixture Venue', '1 Test Street, London',
   st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150,
   'Void Dinner', date '2026-02-10', true, true);

insert into shift_requirements (id, event_id, role_id, starts_at, ends_at, headcount, buffer,
                                charge_rate, pay_rate, allocation_per_hour) values
  (:'sh', :'evt', :'role_id', '2026-02-10 08:00+00', '2026-02-10 12:00+00', 9, 0, 30, 15, 1);

insert into staff (id, first_name, last_name, email, phone, dob, status) values
  (:'st_ns',  'Void', 'One', 'v1@void.test', '+447700908501', date '1995-01-01', 'compliant'),
  (:'st_ns2', 'Void', 'Two', 'v2@void.test', '+447700908502', date '1995-01-01', 'compliant');

-- Two checked-in workers who never checked out, two confirmed who never came.
insert into bookings (id, shift_id, staff_id, status, source, confirmed_at) values
  (:'b_ctl',      :'sh', :'staffa', 'worked',    'auto', '2026-02-01 10:00+00'),
  (:'b_void',     :'sh', :'staffb', 'worked',    'auto', '2026-02-01 10:00+00'),
  (:'b_ns_ctl',   :'sh', :'st_ns',  'confirmed', 'auto', '2026-02-01 10:00+00'),
  (:'b_ns_void',  :'sh', :'st_ns2', 'confirmed', 'auto', '2026-02-01 10:00+00');

insert into check_logs (booking_id, outcome, attempted_at, check_in_at, check_out_at) values
  (:'b_ctl',  'checked_in', '2026-02-10 08:00+00', '2026-02-10 08:00+00', null),
  (:'b_void', 'checked_in', '2026-02-10 08:00+00', '2026-02-10 08:00+00', null);

-- The violations the office wants gone: a No check-out and a No-show, and
-- one it does not (the fixture's Late on staff A).
insert into violations (id, staff_id, booking_id, type, detected_at) values
  (:'v_void', :'staffb', :'b_void',    'no_checkout', '2026-02-10 16:00+00'),
  (:'v_ns',   :'st_ns2', :'b_ns_void', 'no_show',     '2026-02-10 08:30+00');
insert into violations (id, staff_id, booking_id, type, minutes_late, detected_at) values
  (:'v_keep', :'staffa', :'b_ctl', 'late', 5, '2026-02-10 08:10+00');

-- =====================================================================
-- B · Who may
-- =====================================================================
select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok($$ select void_violation('85e00000-0000-4000-8000-000000000001', 'mistake') $$,
  '42501', 'admins_only', 'B: a worker cannot void a violation');

select set_config('request.jwt.claims', json_build_object('sub', :'clienta_uid', 'role', 'authenticated')::text, true);
select throws_ok($$ select void_violation('85e00000-0000-4000-8000-000000000001', 'mistake') $$,
  '42501', 'admins_only', 'B: nor a client');
select throws_ok($$ select _void_violation('85e00000-0000-4000-8000-000000000001', 'mistake', null) $$,
  '42501', null, 'B: the internal mover is not callable by a signed-in role');
select throws_ok($$ select violation_was_voided('85c00000-0000-4000-8000-000000000002', 'no_checkout') $$,
  '42501', null, 'B: nor the tick''s memory');

set local role anon;
select throws_ok($$ select void_violation('85e00000-0000-4000-8000-000000000001', 'mistake') $$,
  '42501', null, 'B: anon is refused at the grant');
reset role;

select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok($$ select void_violation('85e00000-0000-4000-8000-000000000001', '   ') $$,
  'P0001', 'note_required', 'B: a note is mandatory');
select throws_ok($$ select void_violation('85e00000-0000-4000-8000-000000000001', null) $$,
  'P0001', 'note_required', 'B: a null note too');
select throws_ok($$ select void_violation('85e00000-0000-4000-8000-0000000000ff', 'mistake') $$,
  'P0002', 'violation_not_found', 'B: an unknown violation is refused');
reset role;
select is((select count(*)::int from violations where id = :'v_void'), 1,
  'B: none of the refusals removed anything');

-- =====================================================================
-- A · The void
-- =====================================================================
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
create temporary table t_void on commit drop as
  select void_violation(:'v_void', '  Booked in by mistake  ') as r;
reset role;

select is((select r ->> 'ok' from t_void), 'true', 'A: an admin voids the No check-out');
select is((select r ->> 'type' from t_void), 'no_checkout', 'A: and is told which type it was');
select is((select count(*)::int from violations where id = :'v_void'), 0,
  'A: the row has left violations, so the Check-in list, show-rate and pay floor no longer see it');
select is((select count(*)::int from audit_log
            where action = 'violation.voided' and entity = 'booking' and entity_id = :'b_void'), 1,
  'A: it is kept in audit_log against its booking');
select is((select data ->> 'reason' from audit_log where action = 'violation.voided' and entity_id = :'b_void'),
  'Booked in by mistake', 'A: with the reason, trimmed');
select is((select data -> 'violation' ->> 'id' from audit_log where action = 'violation.voided' and entity_id = :'b_void'),
  :'v_void', 'A: and the whole original row');
select is((select actor from audit_log where action = 'violation.voided' and entity_id = :'b_void'),
  :'admin_uid'::uuid, 'A: by whom');
select is((select count(*)::int from violations where id = :'v_keep'), 1,
  'A: another violation is untouched');
select ok(violation_was_voided(:'b_void', 'no_checkout'), 'A: the booking remembers a voided No check-out');
select ok(not violation_was_voided(:'b_void', 'no_show'), 'A: and only that type');
select ok(not violation_was_voided(:'b_ctl', 'no_checkout'), 'A: and only that booking');

-- The one-off a migration (or the SQL editor) runs: no signed-in user.
select is((_void_violation(:'v_ns', 'Booked in by mistake', null)).type::text, 'no_show',
  'A: the internal mover voids a No-show with no signed-in user');
select ok(violation_was_voided(:'b_ns_void', 'no_show'), 'A: and the booking remembers it');

-- =====================================================================
-- C · The tick does not bring a voided violation back
-- =====================================================================
create temporary table t_tick as select booking_tick('2026-02-10 17:00+00') as counts;

select is((select count(*)::int from violations where booking_id = :'b_ctl' and type = 'no_checkout'), 1,
  'C: BG-09 still raises No check-out for a checked-in worker who never checked out');
select is((select count(*)::int from violations where booking_id = :'b_void' and type = 'no_checkout'), 0,
  'C: but not again for the booking whose No check-out was voided');
select is((select count(*)::int from violations where booking_id = :'b_ns_ctl' and type = 'no_show'), 1,
  'C: BG-03 still raises No-show for a confirmed worker who never came');
select is((select count(*)::int from violations where booking_id = :'b_ns_void' and type = 'no_show'), 0,
  'C: but not again for the booking whose No-show was voided');

select * from finish();
rollback;
