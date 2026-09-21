-- =====================================================================
-- 180 · The UK wall-clock gate (§7)
--   uk_local() and is_uk_time() from 20260921160624_uk_time_gate.sql
--
-- pg_cron is UTC. Three §7 jobs are pinned to a UK wall-clock time and
-- are therefore registered as every-5-minute entries with the decision
-- in the job rather than in the schedule (job_schedules, §4 of
-- docs/01-architecture.md).
--
-- So this gate is the only thing standing between "the 12:05 cutoff" and
-- "the cutoff, 288 times a day, releasing every confirmed worker who has
-- not pressed I'm ready and sending them N6b" (§3.5). Every case below
-- is a fixed instant: none of it depends on when the suite runs, or on
-- the server's timezone setting.
-- =====================================================================
begin;
select plan(16);

-- ---------------------------------------------------------------------
-- uk_local: the wall clock in London, with the offset for that date.
-- ---------------------------------------------------------------------
select is(uk_local('2026-01-15 12:05:00+00'), '2026-01-15 12:05:00'::timestamp,
  'in January London is GMT, so the wall clock equals UTC');
select is(uk_local('2026-07-15 12:05:00+00'), '2026-07-15 13:05:00'::timestamp,
  'in July London is BST, so the wall clock is an hour ahead of UTC');

-- The spring-forward boundary: 29 March 2026, 01:00 GMT becomes 02:00 BST.
select is(uk_local('2026-03-29 00:30:00+00'), '2026-03-29 00:30:00'::timestamp,
  'half an hour before the switch it is still GMT');
select is(uk_local('2026-03-29 01:30:00+00'), '2026-03-29 02:30:00'::timestamp,
  'half an hour after, the clocks have gone forward and 01:30 UTC reads 02:30');

-- And back: 25 October 2026, 02:00 BST becomes 01:00 GMT.
select is(uk_local('2026-10-25 00:30:00+00'), '2026-10-25 01:30:00'::timestamp,
  'before the autumn switch it is still BST');
select is(uk_local('2026-10-25 02:30:00+00'), '2026-10-25 02:30:00'::timestamp,
  'after it, GMT again');

-- ---------------------------------------------------------------------
-- is_uk_time: the same minute of the London clock, in either season.
-- This is the assertion the 12:05 cutoff actually rests on.
-- ---------------------------------------------------------------------
select ok(is_uk_time('2026-01-15 12:05:00+00', '12:05'),
  'the cutoff gate opens at 12:05 in winter, when London is UTC');
select ok(is_uk_time('2026-07-15 11:05:00+00', '12:05'),
  'and at 11:05 UTC in summer, which is the same 12:05 in London');
select ok(not is_uk_time('2026-07-15 12:05:00+00', '12:05'),
  'so 12:05 UTC in summer is 13:05 in London and the gate stays shut — the hour the DST drift would have cost');
select ok(not is_uk_time('2026-01-15 11:05:00+00', '12:05'),
  'nor does it open an hour early in winter');

-- ---------------------------------------------------------------------
-- The window. It exists because the caller is a 5-minute cron: an exact
-- minute would make the job depend on pg_cron firing on the second, and
-- one missed tick would skip the cutoff for a whole day.
-- ---------------------------------------------------------------------
select ok(is_uk_time('2026-01-15 12:09:59+00', '12:05'),
  'the window is still open four minutes and fifty-nine seconds in');
select ok(not is_uk_time('2026-01-15 12:10:00+00', '12:05'),
  'and shut at five minutes exactly, so the next 5-minute tick cannot fire it twice');
select ok(not is_uk_time('2026-01-15 12:04:59+00', '12:05'),
  'and shut one second early');

-- ---------------------------------------------------------------------
-- The other two pinned jobs.
-- ---------------------------------------------------------------------
select ok(is_uk_time('2026-07-15 04:00:00+00', '05:00'),
  'the 05:00 compliance sweep opens at 04:00 UTC in summer (§4)');
select ok(is_uk_time('2026-01-19 09:00:00+00', '09:00'),
  'the Monday 09:00 finance send opens at 09:00 UTC in winter (§9.9)');

-- The Monday in "Monday 09:00" is a UK Monday. At 23:30 UTC on a summer
-- Sunday it is already 00:30 Monday in London, which is why BG-08 has to
-- ask uk_local() for the day rather than reading it off the UTC instant.
select is(
  extract(isodow from uk_local('2026-07-19 23:30:00+00'))::int,
  1,
  'a Sunday 23:30 UTC in summer is already Monday in London, so the day comes from uk_local too'
);

select * from finish();
rollback;
