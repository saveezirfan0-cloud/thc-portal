-- =====================================================================
-- 870 · Every path to `confirmed` serialises on the worker first
--       (20261019194000, ADR-0157; go-live concurrency audit H2, M2)
--
--   A · the paths that write `confirmed` are exactly the ones that take
--       lock_worker(), and each takes it before any row lock or write —
--       worker, then section, then booking, so no wait cycle can form
--   B · accept_invite and accept_application really hold the worker's
--       lock (pg_locks) once they have run
--   C · a double-tapped Accept returns the success it already had, on the
--       last slot and on any other. Racing the first tap, the second read
--       the booking before the section lock: on the last slot it ran
--       confirmed -> closed (illegal_booking_transition), elsewhere it re-ran
--       the gates against its own confirmation. It is now re-read FOR
--       UPDATE under the locks, which a single session cannot race but the
--       answer it gives can be pinned.
--   D · nobody but the definer functions can take the lock
--
-- pgTAP runs in one session, so two transactions cannot be raced here;
-- what can be pinned is that the lock is taken, and taken first, which is
-- what makes the second of two racing transactions wait.
-- =====================================================================
begin;
select plan(18);
\ir _shared/fixtures.psql

select cap_week_start(current_date) + 14 as w \gset

\set ev  '87000000-0000-4000-8000-000000000001'
\set s1  '87100000-0000-4000-8000-000000000001'
\set s2  '87100000-0000-4000-8000-000000000002'
\set s3  '87100000-0000-4000-8000-000000000003'
\set w1  '87200000-0000-4000-8000-000000000001'
\set w2  '87200000-0000-4000-8000-000000000002'
\set i1  '87300000-0000-4000-8000-000000000001'
\set i2  '87300000-0000-4000-8000-000000000002'
\set a3  '87300000-0000-4000-8000-000000000003'

insert into staff (id, first_name, last_name, email, phone, dob, status, rtw_branch) values
  (:'w1', 'Ada', 'Lock', 'w1@lock870.test', '+447700987001', date '1995-01-01', 'compliant', 'uk_irish'),
  (:'w2', 'Ben', 'Lock', 'w2@lock870.test', '+447700987002', date '1995-01-01', 'compliant', 'uk_irish');
insert into staff_roles (staff_id, role_id) values (:'w1', :'role_id'), (:'w2', :'role_id');

insert into events (id, client_id, venue_id, venue_name, venue_address, venue_location, geofence_radius_m,
                    title, event_date, pays_breaks, pays_buffer) values
  (:'ev', :'clienta', :'venue_id', 'RLS Fixture Venue', '1 Test Street, London',
   st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150, 'Lock Gala', :'w'::date + 1, true, true);

insert into shift_requirements (id, event_id, role_id, starts_at, ends_at, headcount, buffer,
                                charge_rate, pay_rate, allocation_per_hour) values
  -- Tuesday: headcount 1 — the last slot.
  (:'s1', :'ev', :'role_id', (:'w'::date + 1 + time '09:00') at time zone 'Europe/London',
                             (:'w'::date + 1 + time '17:00') at time zone 'Europe/London', 1, 0, 20, 12, 1),
  -- Wednesday: room for five.
  (:'s2', :'ev', :'role_id', (:'w'::date + 2 + time '09:00') at time zone 'Europe/London',
                             (:'w'::date + 2 + time '17:00') at time zone 'Europe/London', 5, 0, 20, 12, 5),
  -- Thursday: an application.
  (:'s3', :'ev', :'role_id', (:'w'::date + 3 + time '09:00') at time zone 'Europe/London',
                             (:'w'::date + 3 + time '17:00') at time zone 'Europe/London', 5, 0, 20, 12, 5);

insert into bookings (id, shift_id, staff_id, status, source, applied_at) values
  (:'i1', :'s1', :'w1', 'invited', 'auto', null),
  (:'i2', :'s2', :'w1', 'invited', 'auto', null),
  (:'a3', :'s3', :'w2', 'applied', 'self', now());

-- ---------------------------------------------------------------------
-- A · Static: who writes `confirmed`, and where the lock sits in them
-- ---------------------------------------------------------------------
create temporary table t_confirmers as
select p.oid::regprocedure::text as fn, p.prosrc
  from pg_proc p
 where p.pronamespace = 'public'::regnamespace
   and p.prosrc ~* ('\mset\s+status\s*=\s*''confirmed'''
                 || '|insert\s+into\s+(public\.)?bookings\M[^;]*\m(values|select)\M[^;]*''confirmed''');

select set_eq(
  $$ select fn from t_confirmers $$,
  array['accept_invite(uuid)', 'accept_application(uuid)', 'take_offered_shift(uuid)'],
  'the only functions that write a booking''s status to confirmed are the three Accept paths');

select is_empty(
  $$ select fn from t_confirmers where prosrc !~ '\mperform\s+lock_worker\(' $$,
  'every one of them takes lock_worker() — a new path to confirmed must too (ADR-0157)');

-- Worker first: before any row lock, and before any write, in every
-- function that takes it. A worker lock taken after a section lock is the
-- inversion that would deadlock against these.
select is_empty($$
  select p.oid::regprocedure::text
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname <> 'lock_worker'
     and p.prosrc ~ '\mlock_worker\('
     and (   regexp_instr(p.prosrc, '\mfor\s+(no\s+key\s+)?(update|share)\M', 1, 1, 0, 'i')
               between 1 and regexp_instr(p.prosrc, '\mlock_worker\(')
          or regexp_instr(p.prosrc, '\m(update|delete\s+from|insert\s+into)\s+(public\.)?[a-z_]+\M', 1, 1, 0, 'i')
               between 1 and regexp_instr(p.prosrc, '\mlock_worker\(')
          or (select count(*) from regexp_matches(p.prosrc, '\mlock_worker\(', 'g')) <> 1)
$$, 'every caller takes the worker lock once, before any section or booking lock and before any write');

select is_empty($$
  select p.oid::regprocedure::text from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname <> 'lock_worker'
     and p.prosrc ~ 'worker_lock_key\(' and p.proname <> 'worker_lock_held'
$$, 'nothing takes the worker''s advisory key except through lock_worker()');

-- ---------------------------------------------------------------------
-- D · The lock is not a client-callable thing
-- ---------------------------------------------------------------------
select ok(not has_function_privilege('authenticated', 'public.lock_worker(uuid)', 'execute'),
  'authenticated cannot call lock_worker');
select ok(not has_function_privilege('anon', 'public.lock_worker(uuid)', 'execute'),
  'anon cannot call lock_worker');

-- ---------------------------------------------------------------------
-- B · accept_invite holds the worker's lock
-- ---------------------------------------------------------------------
select ok(not worker_lock_held(:'w1'), 'before Accept this session holds no lock on the worker');

select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
-- The worker presses Accept as themselves.
update staff set user_id = null where id = :'staffa';
update staff set user_id = :'staffa_uid' where id = :'w1';
set local role authenticated;

select is(accept_invite(:'i1'),
  jsonb_build_object('ok', true, 'withdrawn', 0, 'closedApplications', 0),
  'the first tap on the last slot confirms');
reset role;
select ok(worker_lock_held(:'w1'), 'and the transaction now holds the worker''s lock (held to commit)');
select ok(not worker_lock_held(:'w2'), 'and only that worker''s');

create temporary table t_stamp as select confirmed_at from bookings where id = :'i1';

-- ---------------------------------------------------------------------
-- C · The second tap
-- ---------------------------------------------------------------------
set local role authenticated;
select is(accept_invite(:'i1'),
  jsonb_build_object('ok', true, 'already', true, 'withdrawn', 0, 'closedApplications', 0),
  'the second tap on the (now full) last slot answers the same success (it answered not_invited, and racing the first it raised illegal_booking_transition)');
reset role;
select is((select status::text from bookings where id = :'i1'), 'confirmed',
  'the booking stays confirmed, not closed as slot_taken');
select is((select confirmed_at from bookings where id = :'i1'), (select confirmed_at from t_stamp),
  'and keeps the moment it was first confirmed');

set local role authenticated;
select is(accept_invite(:'i2') ->> 'ok', 'true', 'a second section with room confirms');
select is(accept_invite(:'i2'),
  jsonb_build_object('ok', true, 'already', true, 'withdrawn', 0, 'closedApplications', 0),
  'and its second tap is not re-gated against its own confirmation');
reset role;

-- ---------------------------------------------------------------------
-- B · accept_application holds the applicant's lock
-- ---------------------------------------------------------------------
select ok(not worker_lock_held(:'w2'), 'before the office accepts the application, no lock on the applicant');
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is(accept_application(:'a3') ->> 'ok', 'true', 'the office accepts the application');
reset role;
select ok(worker_lock_held(:'w2'), 'and the transaction holds the applicant''s lock');

select * from finish();
rollback;
