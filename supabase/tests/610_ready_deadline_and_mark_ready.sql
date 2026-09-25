-- =====================================================================
-- 610 · The 12:00 day-before deadline, in both languages, and at the button
--   ready_deadline() (20260921141500), mark_ready() and the auto-staffing
--   cutoff gate's window (20260929100000; ADR-0032; audit D24, D25)
--
--   1. ready_deadline() gives the same instant as the TypeScript
--      readyDeadline() for every case in
--      packages/domain/src/readyDeadline.vectors.json — including the two
--      DST cases the TS half used to get wrong.
--   2. mark_ready() refuses a press at or after the deadline, with
--      reason 'deadline_passed', and records nothing. §3.5: "The deadline
--      is 12:00 noon the day before" — not 12:05, when the release runs.
--   3. The window the cutoff gate now asks is_uk_time() about: every run
--      from 12:05 UK until midnight, in GMT and BST, so a failed 12:05 run
--      is retried by the next one.
--
-- mark_ready() reads now(), so section 2 places its shifts relative to
-- the transaction's clock; everything else is a fixed instant.
-- =====================================================================
begin;
select plan(20);
\ir _shared/fixtures.psql
\ir _shared/ready_deadline_vectors.psql

-- ---------------------------------------------------------------------
-- 1 · Shared vectors
-- ---------------------------------------------------------------------
select is((select count(*)::int from ready_deadline_vectors), :ready_vector_count,
  format('all %s shared deadline vectors loaded from readyDeadline.vectors.json', :ready_vector_count));
select results_eq(
  $$ select name, ready_deadline(starts_at) from ready_deadline_vectors order by name $$,
  $$ select name, deadline from ready_deadline_vectors order by name $$,
  'readyDeadline.vectors.json: SQL ready_deadline() gives the same instant as TypeScript readyDeadline(), case for case');
select is(
  (select ready_deadline(starts_at) from ready_deadline_vectors
    where name = 'autumn_2330_gmt_on_the_changeover_day'),
  timestamptz '2026-10-24 12:00+01',
  'a 23:30 GMT start on 25 Oct 2026 has its deadline at 12:00 BST on the 24th, not the 25th');
select is(
  (select ready_deadline(starts_at) from ready_deadline_vectors
    where name = 'spring_0030_bst_the_day_after_the_change'),
  timestamptz '2026-03-29 12:00+01',
  'a 00:30 BST start on 30 Mar 2026 has its deadline at 12:00 BST on the 29th, not the 28th');

-- ---------------------------------------------------------------------
-- 2 · mark_ready() at the deadline
-- ---------------------------------------------------------------------
\set s_ahead   'f6100000-0000-4000-8000-000000000001'
\set s_passed  'f6100000-0000-4000-8000-000000000002'
\set s_started 'f6100000-0000-4000-8000-000000000003'
\set b_ahead   'f6110000-0000-4000-8000-000000000001'
\set b_passed  'f6110000-0000-4000-8000-000000000002'
\set b_started 'f6110000-0000-4000-8000-000000000003'

-- ahead:   three days out — its deadline is at least a day and a half away.
-- passed:  starts in an hour — whatever the hour now, its deadline (noon
--          on the UK day before its start) has gone.
-- started: began an hour ago.
insert into shift_requirements (id, event_id, role_id, starts_at, ends_at, headcount, buffer,
                                charge_rate, pay_rate, allocation_per_hour) values
  (:'s_ahead',   :'event_a', :'role_id', now() + interval '3 days',  now() + interval '3 days 4 hours', 5, 0, 30, 15, 1),
  (:'s_passed',  :'event_a', :'role_id', now() + interval '1 hour',  now() + interval '5 hours',        5, 0, 30, 15, 1),
  (:'s_started', :'event_a', :'role_id', now() - interval '1 hour',  now() + interval '3 hours',        5, 0, 30, 15, 1);

insert into bookings (id, shift_id, staff_id, status, source, confirmed_at) values
  (:'b_ahead',   :'s_ahead',   :'staffa', 'confirmed', 'auto', now() - interval '10 days'),
  (:'b_passed',  :'s_passed',  :'staffa', 'confirmed', 'auto', now() - interval '10 days'),
  (:'b_started', :'s_started', :'staffa', 'confirmed', 'auto', now() - interval '10 days');

select ok(now() >= ready_deadline(now() + interval '1 hour'),
  'premise: a shift an hour away is always past its own deadline');

set local "request.jwt.claims" = '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}';
set local role authenticated;

select is(mark_ready(:'b_passed'), '{"ok": false, "reason": "deadline_passed"}'::jsonb,
  '§3.5: "I''m ready" pressed after 12:00 the day before is refused, with reason deadline_passed');
select is(mark_ready(:'b_started'), '{"ok": false, "reason": "shift_started"}'::jsonb,
  'a shift already under way still answers shift_started');
select is(mark_ready(:'b_ahead'), '{"ok": true}'::jsonb,
  'before the deadline the press is accepted');

reset role;

select is((select day_before_confirmed_at from bookings where id = :'b_passed'), null,
  'the refused press records nothing, so the 12:05 cutoff still sees a worker who is not ready');
select isnt((select day_before_confirmed_at from bookings where id = :'b_ahead'), null,
  'the accepted press is recorded');

-- ---------------------------------------------------------------------
-- 3 · The cutoff gate's window: 12:05 UK until midnight
--
-- supabase/functions/auto-staffing asks is_uk_time(now, '12:05',
-- '11 hours 55 minutes') on every every-5-minute run; release_unready_
-- bookings() is idempotent and never reaches a shift starting today, so
-- a run inside this window is either the 12:05 release or a harmless
-- retry of it.
-- ---------------------------------------------------------------------
select is(is_uk_time('2026-01-15 12:04+00', '12:05', interval '11 hours 55 minutes'), false,
  'GMT: not at 12:04');
select is(is_uk_time('2026-01-15 12:05+00', '12:05', interval '11 hours 55 minutes'), true,
  'GMT: from 12:05');
select is(is_uk_time('2026-01-15 17:40+00', '12:05', interval '11 hours 55 minutes'), true,
  'GMT: a retry mid-afternoon');
select is(is_uk_time('2026-01-15 23:59+00', '12:05', interval '11 hours 55 minutes'), true,
  'GMT: the last minute of the day');
select is(is_uk_time('2026-01-16 00:00+00', '12:05', interval '11 hours 55 minutes'), false,
  'GMT: not from midnight');
select is(is_uk_time('2026-07-15 11:04+00', '12:05', interval '11 hours 55 minutes'), false,
  'BST: not at 12:04 UK, which is 11:04 UTC');
select is(is_uk_time('2026-07-15 11:05+00', '12:05', interval '11 hours 55 minutes'), true,
  'BST: from 12:05 UK, which is 11:05 UTC');
select is(is_uk_time('2026-07-15 22:59+00', '12:05', interval '11 hours 55 minutes'), true,
  'BST: 23:59 UK is still inside');
select is(is_uk_time('2026-07-15 23:00+00', '12:05', interval '11 hours 55 minutes'), false,
  'BST: 00:00 UK is outside');
select is(is_uk_time('2026-01-15 12:05+00', '12:05'), true,
  'and the first-run window (the default five minutes) still opens at 12:05');

select * from finish();
rollback;
