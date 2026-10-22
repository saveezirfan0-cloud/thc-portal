-- =====================================================================
-- 928 · Left early vs Completed early (ADR-0185)
--   20261024110000_completed_early.sql
--
--   A. An unreleased Left early blocks the four-hour floor (as before).
--   B. release_early_finish() by the client inside the window -> Completed
--      early: the floor applies, the entry is closed.
--   C. A client sign-off after the window is refused; an office override works.
--   D. A note, and for client / site manager a contact, are mandatory;
--      only an admin may call it; only a left_early can be released.
--   E. left_early_state() is pending, left_early, completed_early.
-- =====================================================================
begin;
select plan(12);
\ir _shared/fixtures.psql

\set sh    'c9280000-0000-4000-8000-000000000011'
\set b1    'c9280000-0000-4000-8000-000000000021'
\set b2    'c9280000-0000-4000-8000-000000000022'
\set v1    'c9280000-0000-4000-8000-000000000031'
\set v2    'c9280000-0000-4000-8000-000000000032'

insert into shift_requirements (id, event_id, role_id, starts_at, ends_at, headcount, buffer,
                                charge_rate, pay_rate, dress_code, allocation_per_hour) values
  (:'sh', :'event_a', :'role_id', now() - interval '10 hours', now() - interval '2 hours',
   2, 0, 22.97, 14.00, 'Black tie', 1);
insert into bookings (id, shift_id, staff_id, status, source, confirmed_at) values
  (:'b1', :'sh', :'staffa', 'worked', 'auto', now() - interval '2 days');
insert into check_logs (booking_id, outcome, check_in_at, check_out_at, check_out_on_site)
values (:'b1', 'checked_in', now() - interval '10 hours', now() - interval '8 hours', true);
insert into violations (id, staff_id, booking_id, type, detected_at)
values (:'v1', :'staffa', :'b1', 'left_early', now() - interval '8 hours');

select is((select (pay->>'payableMin')::int from payable_shifts_v where booking_id = :'b1'), 120,
  'A: an unreleased Left early is paid to the check-out, no floor');

set local "request.jwt.claims" = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
set local role authenticated;

select throws_ok($$ select release_early_finish('c9280000-0000-4000-8000-000000000031','client','','Job done') $$,
  'release_contact_required', 'D: a client sign-off needs a contact');
select throws_ok($$ select release_early_finish('c9280000-0000-4000-8000-000000000031','client','Sam at venue','  ') $$,
  'note_required', 'D: a note is mandatory');

select is((release_early_finish(:'v1','client','Sam at venue','Job complete, sent home at 12:00')->>'state'),
  'completed_early', 'B: the client releasing the worker makes it Completed early');
reset role;

select is((select (pay->>'payableMin')::int from payable_shifts_v where booking_id = :'b1'), 240,
  'B: Completed early gets the four-hour floor');
select ok((select resolved and released_at is not null from violations where id = :'v1'),
  'B: the entry is closed and carries the release');
select is(left_early_state((select released_at from violations where id = :'v1'), now() - interval '8 hours'),
  'completed_early', 'E: released -> completed_early');
select is(left_early_state(null, now() - interval '1 hour'), 'pending', 'E: inside the window -> pending');
select is(left_early_state(null, now() - interval '25 hours'), 'left_early', 'E: past the window -> left_early');

-- C. a late client sign-off is refused, an office override is not
insert into bookings (id, shift_id, staff_id, status, source, confirmed_at) values
  (:'b2', :'sh', :'staffb', 'worked', 'auto', now() - interval '2 days');
insert into check_logs (booking_id, outcome, check_in_at, check_out_at, check_out_on_site)
values (:'b2', 'checked_in', now() - interval '10 hours', now() - interval '8 hours', true);
insert into violations (id, staff_id, booking_id, type, detected_at)
values (:'v2', :'staffb', :'b2', 'left_early', now() - interval '30 hours');

set local "request.jwt.claims" = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
set local role authenticated;
select throws_ok($$ select release_early_finish('c9280000-0000-4000-8000-000000000032','client','Sam','late call') $$,
  'release_window_closed', 'C: a client sign-off after the window is refused');
select is((release_early_finish(:'v2','office_override',null,'Client confirmed by email next day')->>'decision'),
  'released', 'C: the office can override after the window');
reset role;

set local "request.jwt.claims" = '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}';
set local role authenticated;
select throws_ok($$ select release_early_finish('c9280000-0000-4000-8000-000000000032','office_override',null,'x') $$,
  '42501', 'D: a worker cannot call it');
reset role;

select * from finish();
rollback;
