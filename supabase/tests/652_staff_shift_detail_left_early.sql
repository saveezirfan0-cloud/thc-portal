-- =====================================================================
-- 652 · The shift screen knows a Left early is logged (RULE-14)
--   20260930100100_staff_shift_detail_left_early.sql
--
-- check_out() raises `left_early` (20260930100000, D5). A logged Left early
-- always blocks the 4-hour floor, so the worker's earnings figure must see
-- it rather than infer it from the press time.
--
--   A. A booking with a Left early reads left_early = true, resolved or not.
--   B. One without reads false.
--   C. Still the caller's own rows, anon still refused, no money columns.
--   D. main's turn-away columns (20260928120000) are kept.
-- =====================================================================
begin;
select plan(7);
\ir _shared/fixtures.psql

\set sh_le   'c6520000-0000-4000-8000-000000000011'
\set b_le    'c6520000-0000-4000-8000-000000000021'

insert into shift_requirements (id, event_id, role_id, starts_at, ends_at, headcount, buffer,
                                charge_rate, pay_rate, dress_code, allocation_per_hour) values
  (:'sh_le', :'event_a', :'role_id', now() - interval '6 hours', now() + interval '2 hours',
   1, 0, 22.97, 14.00, 'Black tie', 1);

insert into bookings (id, shift_id, staff_id, status, source, confirmed_at) values
  (:'b_le', :'sh_le', :'staffa', 'worked', 'auto', now() - interval '2 days');

insert into violations (staff_id, booking_id, type, detected_at, resolved)
select staff_id, id, 'left_early', now() - interval '1 hour', true
  from bookings where id = :'b_le';

set local "request.jwt.claims" = '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}';
set local role authenticated;

select ok((select left_early from staff_shift_detail(:'b_le')),
  'A: a logged Left early reads true, even once resolved (RULE-14: it always blocks the floor)');
select ok((select not left_early from staff_shift_detail(:'booking_a')),
  'B: a booking with no Left early reads false');
reset role;

set local "request.jwt.claims" = '{"sub":"55555555-5555-5555-5555-555555555555","role":"authenticated"}';
set local role authenticated;
select is_empty($$ select * from staff_shift_detail('c6520000-0000-4000-8000-000000000021') $$,
  'C: another worker cannot read it');
reset role;

select ok(not has_function_privilege('anon', 'public.staff_shift_detail(uuid)', 'execute'),
  'C: anon cannot execute it after the restatement');
select ok(has_function_privilege('authenticated', 'public.staff_shift_detail(uuid)', 'execute'),
  'C: authenticated still can');
select ok(pg_get_function_result('public.staff_shift_detail(uuid)'::regprocedure)
            !~* '(charge|margin|po_number|client|holiday)',
  'C: no charge rate, margin, PO, client or holiday column in the result');
select ok(pg_get_function_result('public.staff_shift_detail(uuid)'::regprocedure)
            ~ 'turned_away_at timestamp with time zone, turned_away_pay_min integer, left_early boolean',
  'D: restated from 20260928120000 — the turn-away columns stay, left_early is appended last');

select * from finish();
rollback;
