-- =====================================================================
-- 872 · attempt_check_in's section lock (20261019150200, ADR-0157;
--       go-live database audit F7, concurrency audit M1)
--
--   A · the section is locked FOR NO KEY UPDATE, after the read-only
--       compliance reads and before the RULE-15 slot count
--   B · every press gets the answer it got before: the idempotent
--       already_checked_in still wins over a compliance stop, and the
--       compliance stop over the slot count
--   C · a No-show recorded while the press waited (detected after the
--       press began) answers `locked` — never an accepted check-in beside
--       a No-show — while one the office recorded before the press does
--       not stop the worker coming in
--   D · strict buffer still counts under the lock: headcount 1, the
--       second on-time press is turned away with RULE-15's 4 h
-- =====================================================================
begin;
select plan(17);
\ir _shared/fixtures.psql

\set ev   '87200000-0000-4000-8000-0000000000e1'
\set sh   '87200000-0000-4000-8000-0000000000f1'
\set sh2  '87200000-0000-4000-8000-0000000000f2'
\set w1   '87200000-0000-4000-8000-000000000001'
\set w2   '87200000-0000-4000-8000-000000000002'
\set w3   '87200000-0000-4000-8000-000000000003'
\set w4   '87200000-0000-4000-8000-000000000004'
\set w5   '87200000-0000-4000-8000-000000000005'
\set w6   '87200000-0000-4000-8000-000000000006'
\set b1   '87200000-0000-4000-8000-000000000101'
\set b2   '87200000-0000-4000-8000-000000000102'
\set b3   '87200000-0000-4000-8000-000000000103'
\set b4   '87200000-0000-4000-8000-000000000104'
\set b5   '87200000-0000-4000-8000-000000000105'
\set b6   '87200000-0000-4000-8000-000000000106'

-- ---------------------------------------------------------------------
-- A · Where the lock is, and which
-- ---------------------------------------------------------------------
create temporary table t_src as
select prosrc from pg_proc
 where oid = 'public.attempt_check_in(uuid,double precision,double precision,double precision)'::regprocedure;

select ok((select prosrc ~ 'from shift_requirements where id = b\.shift_id for no key update' from t_src),
  'the section is locked FOR NO KEY UPDATE');
select ok((select prosrc !~* 'for\s+update' from t_src),
  'and nothing in the press takes FOR UPDATE any more');
select ok((select regexp_instr(prosrc, 'compliance_blockers\(') < regexp_instr(prosrc, 'for no key update')
              and regexp_instr(prosrc, 'can_roster_staff\(') < regexp_instr(prosrc, 'for no key update')
              and regexp_instr(prosrc, 'for no key update') < regexp_instr(prosrc, 'select count\(\*\) into v_slots')
             from t_src),
  'compliance and canRoster are read before the lock; the slot count after it');

-- ---------------------------------------------------------------------
-- The world
-- ---------------------------------------------------------------------
insert into staff (id, first_name, last_name, email, phone, dob, status, rtw_branch) values
  (:'w1', 'One',   'Press', 'w1@t872.test', '+447700987201', date '1995-01-01', 'compliant', 'uk_irish'),
  (:'w2', 'Two',   'Press', 'w2@t872.test', '+447700987202', date '1995-01-01', 'compliant', 'uk_irish'),
  (:'w3', 'Three', 'Press', 'w3@t872.test', '+447700987203', date '1995-01-01', 'compliant', 'uk_irish'),
  (:'w4', 'Four',  'Press', 'w4@t872.test', '+447700987204', date '1995-01-01', 'compliant', 'uk_irish'),
  (:'w5', 'Five',  'Press', 'w5@t872.test', '+447700987205', date '1995-01-01', 'compliant', 'uk_irish'),
  (:'w6', 'Six',   'Press', 'w6@t872.test', '+447700987206', date '1995-01-01', 'compliant', 'uk_irish');

-- pays_buffer = false: the strict buffer policy (RULE-15).
insert into events (id, client_id, venue_id, venue_name, venue_address, venue_location, geofence_radius_m,
                    title, event_date, pays_breaks, pays_buffer) values
  (:'ev', :'clienta', :'venue_id', 'RLS Fixture Venue', '1 Test Street, London',
   st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150, 'Lock Scope', current_date, true, false);
insert into shift_requirements (id, event_id, role_id, starts_at, ends_at, headcount, buffer,
                                charge_rate, pay_rate, allocation_per_hour) values
  -- Started ten minutes ago: a press now is Late, inside the grace.
  (:'sh',  :'ev', :'role_id', now() - interval '10 minutes', now() + interval '6 hours', 5, 0, 22.97, 14.00, 5),
  -- Starts in ten minutes, headcount 1: the strict buffer.
  (:'sh2', :'ev', :'role_id', now() + interval '10 minutes', now() + interval '6 hours', 1, 1, 22.97, 14.00, 2);
insert into bookings (id, shift_id, staff_id, status, source, confirmed_at) values
  (:'b1', :'sh',  :'w1', 'confirmed', 'auto', now() - interval '2 days'),
  (:'b2', :'sh',  :'w2', 'confirmed', 'auto', now() - interval '2 days'),
  (:'b3', :'sh',  :'w3', 'confirmed', 'auto', now() - interval '2 days'),
  (:'b4', :'sh',  :'w4', 'confirmed', 'auto', now() - interval '2 days'),
  (:'b5', :'sh2', :'w5', 'confirmed', 'auto', now() - interval '2 days'),
  (:'b6', :'sh2', :'w6', 'confirmed', 'auto', now() - interval '2 days');

select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);

-- ---------------------------------------------------------------------
-- B · The order of the answers
-- ---------------------------------------------------------------------
set local role authenticated;
select is(attempt_check_in(:'b1', 51.5000, -0.1000, 10) ->> 'decision', 'checked_in_late',
  'a compliant worker inside the grace checks in Late');
reset role;
-- Now blocked mid-shift (a P45, a block): pressing again is still the
-- idempotent answer, not a compliance stop — the order is unchanged.
update staff set status = 'blocked' where id = :'w1';
set local role authenticated;
select is(attempt_check_in(:'b1', 51.5000, -0.1000, 10) ->> 'decision', 'already_checked_in',
  'a worker already on shift gets already_checked_in even if no longer compliant');
reset role;

update staff set status = 'blocked' where id = :'w2';
set local role authenticated;
select throws_ok(format('select attempt_check_in(%L, 51.5000, -0.1000, 10)', :'b2'),
  'P0001', 'staff_not_compliant', 'a blocked worker who has not checked in is stopped (D16)');
reset role;

insert into compliance_docs (staff_id, doc_type, file_path, review_status, expiry_date)
values (:'w3', 'passport', 'documents/w3/passport.pdf', 'verified', current_date - 1);
set local role authenticated;
select throws_ok(format('select attempt_check_in(%L, 51.5000, -0.1000, 10)', :'b3'),
  'P0001', 'staff_not_compliant', 'an expired document is still read and still stops the press');
reset role;
select is((select count(*)::int from check_logs where booking_id in (:'b2', :'b3')), 0,
  'and nothing was written for either');

-- ---------------------------------------------------------------------
-- C · A No-show recorded while the press waited
-- ---------------------------------------------------------------------
-- BG-03's row, committed a moment after this press began (detected_at is
-- the tick's own clock, later than the press's).
insert into violations (staff_id, booking_id, type, detected_at)
values (:'w4', :'b4', 'no_show', now() + interval '1 second');
set local role authenticated;
select is(attempt_check_in(:'b4', 51.5000, -0.1000, 10) ->> 'decision', 'locked',
  'a No-show raised while the press waited makes it the locked press');
select is(attempt_check_in(:'b4', 51.5000, -0.1000, 10) ->> 'messageKey', 'no_show_locked',
  'with the locked copy');
reset role;
select is((select status::text from bookings where id = :'b4'), 'confirmed',
  'the booking is not moved to worked');
select is((select count(*)::int from check_logs where booking_id = :'b4' and check_in_at is not null), 0,
  'no accepted check-in is written beside the No-show');
select is((select count(*)::int from violations where booking_id = :'b4' and type = 'no_show'), 1,
  'and the No-show is still the only one');

-- An office No-show recorded BEFORE the press: the worker still comes in.
update violations set detected_at = now() - interval '1 minute' where booking_id = :'b4' and type = 'no_show';
set local role authenticated;
select is(attempt_check_in(:'b4', 51.5000, -0.1000, 10) ->> 'decision', 'checked_in_late',
  'a No-show the office recorded before the press does not stop the arrival (Get back resolves it)');
reset role;

-- ---------------------------------------------------------------------
-- D · RULE-15 under the lock
-- ---------------------------------------------------------------------
set local role authenticated;
select is(attempt_check_in(:'b5', 51.5000, -0.1000, 10) ->> 'decision', 'checked_in',
  'headcount 1: the first on-time press takes the slot');
create temporary table t_away as select attempt_check_in(:'b6', 51.5000, -0.1000, 10) as d;
reset role;
select is((select d ->> 'decision' from t_away), 'turned_away',
  'the second is turned away under the strict buffer policy');
select is((select d ->> 'turnAwayPayMin' from t_away), '240',
  'with RULE-15''s fixed 4 hours, on time');

select * from finish();
rollback;
