-- =====================================================================
-- 625 · The shift screen can tell a turn-away on reload (§3.2, RULE-15)
--   20260929130000_staff_shift_detail_turned_away.sql
--
-- Audit D19: a worker turned away under the strict buffer policy was
-- offered Check in again on reload. The booking says `turned_away`; the
-- screen also needs WHEN the attempt was logged, because RULE-15 pays a
-- flat 4 hours only for an on-time attempt and the §3.2 copy says so only
-- then.
--
--   A. A turned-away booking carries its logged attempt.
--   B. A working booking never does, even with a stray turn-away log row.
--   C. Still the caller's own rows only, and still no money columns.
-- =====================================================================
begin;
select plan(9);
\ir _shared/fixtures.psql

\set sh_ta   'c6250000-0000-4000-8000-000000000011'
\set sh_ok   'c6250000-0000-4000-8000-000000000012'
\set b_ta    'c6250000-0000-4000-8000-000000000021'
\set b_ok    'c6250000-0000-4000-8000-000000000022'

insert into shift_requirements (id, event_id, role_id, starts_at, ends_at, headcount, buffer,
                                charge_rate, pay_rate, dress_code, allocation_per_hour) values
  (:'sh_ta', :'event_a', :'role_id', now() - interval '1 hour', now() + interval '5 hours',
   1, 1, 22.97, 14.00, 'Black tie', 1),
  (:'sh_ok', :'event_b', :'role_id', now() - interval '1 hour', now() + interval '5 hours',
   1, 0, 19.50, 13.50, 'Smart black', 1);

insert into bookings (id, shift_id, staff_id, status, source, confirmed_at) values
  (:'b_ta', :'sh_ta', :'staffa', 'turned_away', 'auto', now() - interval '2 days'),
  (:'b_ok', :'sh_ok', :'staffa', 'worked',      'auto', now() - interval '2 days');

-- Ten minutes before the start: on time, so RULE-15 pays the flat 4 h.
insert into check_logs (booking_id, outcome, attempted_at) values
  (:'b_ta', 'turned_away', now() - interval '70 minutes'),
  -- A stray turn-away row on a booking that went on to work.
  (:'b_ok', 'turned_away', now() - interval '70 minutes');
insert into check_logs (booking_id, outcome, attempted_at, check_in_at) values
  (:'b_ok', 'checked_in', now() - interval '65 minutes', now() - interval '65 minutes');

set local "request.jwt.claims" = '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}';
set local role authenticated;

-- ---------------------------------------------------------------------
-- A · a turned-away booking carries its attempt
-- ---------------------------------------------------------------------
select is((select status from staff_shift_detail(:'b_ta')), 'turned_away',
  'A: the booking reads as turned away');
select ok((select turned_away_at between now() - interval '71 minutes' and now() - interval '69 minutes'
             from staff_shift_detail(:'b_ta')),
  'A: with the logged attempt time, which staff cannot read from check_logs');
select ok((select turned_away_at < starts_at from staff_shift_detail(:'b_ta')),
  'A: early enough for the screen to say the flat 4 h is paid (RULE-15)');
select is((select turned_away_minutes(starts_at, turned_away_at) from staff_shift_detail(:'b_ta')), 240,
  'A: and the SQL rule agrees: 240 minutes');

-- ---------------------------------------------------------------------
-- B · a working booking never does
-- ---------------------------------------------------------------------
select ok((select turned_away_at is null from staff_shift_detail(:'b_ok')),
  'B: a stray turn-away log row does not put a worked booking behind the screen');
select ok((select turned_away_at is null from staff_shift_detail(:'booking_a')),
  'B: nor is there one on an ordinary confirmed booking');
reset role;

-- ---------------------------------------------------------------------
-- C · still the caller's own, still no money
-- ---------------------------------------------------------------------
set local "request.jwt.claims" = '{"sub":"55555555-5555-5555-5555-555555555555","role":"authenticated"}';
set local role authenticated;
select is_empty($$ select * from staff_shift_detail('c6250000-0000-4000-8000-000000000021') $$,
  'C: another worker cannot read the turn-away');
reset role;

select ok(not has_function_privilege('anon', 'public.staff_shift_detail(uuid)', 'execute'),
  'C: anon still cannot execute it after the restatement');
select ok(pg_get_function_result('public.staff_shift_detail(uuid)'::regprocedure)
            !~* '(charge|margin|po_number|client|holiday)',
  'C: no charge rate, margin, PO, client or holiday column in the result');

select * from finish();
rollback;
