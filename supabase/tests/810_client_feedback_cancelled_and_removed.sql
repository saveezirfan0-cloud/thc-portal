-- =====================================================================
-- 806 · client feedback: none on a cancelled event, none on a removed
--       worker — 20261013100000 · §11.2, §11.5, §1.7, §3.3; ADR-0026
--
--   792 holds the 2,000-character cap (20261012120600); this file holds
--   the two refusals 20261013100000 added on top of it, and that the cap
--   and the ordinary path still answer as before.
-- =====================================================================
begin;
select plan(6);
\ir _shared/fixtures.psql

-- The fixture's own client entry would make another one a duplicate, and
-- the event must have started for feedback to open.
delete from feedback where id = :'feedback_a';
update shift_requirements set starts_at = now() - interval '9 hours', ends_at = now() - interval '1 hour'
 where id = :'shift_a';

-- ---------------------------------------------------------------------
-- 1 · a GDPR-removed worker (§1.7)
-- ---------------------------------------------------------------------
update staff set removed_at = now() where id = :'staffa';
select set_config('request.jwt.claims', json_build_object('sub', :'clienta_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(
  format($$ select submit_client_feedback(%L, 4, 'After removal') $$, :'booking_a'),
  '22023', 'This worker has been removed (§1.7); no new feedback can be added',
  '§1.7 a removed worker cannot be rated from the portal — the office''s own refusal');
reset role;
update staff set removed_at = null where id = :'staffa';

-- ---------------------------------------------------------------------
-- 2 · a cancelled event (§3.3)
-- ---------------------------------------------------------------------
update events set cancelled_at = now() where id = :'event_a';
set local role authenticated;
select throws_ok(
  format($$ select submit_client_feedback(%L, 4, 'Cancelled') $$, :'booking_a'),
  '42501', 'That booking is not on your line-up',
  'a cancelled event takes no feedback, with the same single refusal as a foreign booking');
select throws_ok(
  format($$ select submit_client_feedback(%L, 4, 'Not mine') $$, :'booking_b'),
  '42501', 'That booking is not on your line-up',
  'which is word for word what another customer''s booking answers');
reset role;
update events set cancelled_at = null where id = :'event_a';

-- ---------------------------------------------------------------------
-- 3 · 20261012120600's cap still holds, and the ordinary path still works
-- ---------------------------------------------------------------------
set local role authenticated;
select throws_ok(format($$ select submit_client_feedback(%L, 5, %L) $$, :'booking_a', repeat('a', 2001)),
  '22023', 'Feedback text must be at most 2000 characters',
  'the 2,000-character cap is unchanged');
select lives_ok(format($$ select submit_client_feedback(%L, 4, 'Polite and early') $$, :'booking_a'),
  'a live worker on a live, started event still takes feedback');
reset role;
select is((select count(*)::int from feedback
            where author_kind = 'client' and event_id = :'event_a' and staff_id = :'staffa'), 1,
  'one entry written');

select * from finish();
rollback;
