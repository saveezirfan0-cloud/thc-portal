-- =====================================================================
-- 160 · Client Portal · §11.1 event list, §11.2 event page, §11.5 feedback
--
-- The two screens read three owner-rights views and write through one
-- `security definer` RPC. The views are covered structurally by 050; what
-- is asserted here is the behaviour the screens depend on, and — more to
-- the point — every way the portal must refuse.
--
-- The RPC is the only write the Client Portal makes. §11.1 says the portal
-- is read-only "no editing whatsoever", and feedback is the one exception
-- the scope carves out (§11.2, §11.5), so its gates are worth more than
-- the happy path: wrong customer, wrong booking, too early, twice, wrong
-- role, and signed out.
-- =====================================================================
begin;
select plan(24);
\ir _shared/fixtures.psql

-- §11.2's header field. The shared fixtures leave it null, so it is set
-- here rather than asserting that null comes through null.
update events set onsite_contact = 'Marco Vitale · Banqueting manager' where id = :'event_a';

-- ---------------------------------------------------------------------
-- 1. What the customer reads. (The column lists live in 050, which owns
--    view shape; everything here is behaviour.)
-- ---------------------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', :'clienta_uid', 'role', 'authenticated')::text, true);
set local role authenticated;

select is(
  (select onsite_contact from client_events_v where id = :'event_a'),
  'Marco Vitale · Banqueting manager',
  '§11.2 the on-site contact reaches the portal through client_events_v');

select is((select count(*)::int from client_events_v where id = :'event_b'), 0,
  '§11.1 a customer still sees only its own events');

select is((select feedback_given from client_lineup_v where booking_id = :'booking_a'), true,
  '§11.2 feedback_given is true where this customer has already left an entry');

select is((select sort_key from client_lineup_v where booking_id = :'booking_a'), 'alpha',
  '§11.3 the line-up sorts by surname, lowercased, so the screen and the PDF agree');

select is((select count(*)::int from client_lineup_v where booking_id = :'booking_b'), 0,
  'another customer''s line-up is not reachable');

-- ---------------------------------------------------------------------
-- 3. Feedback is locked until the event starts (§11.2).
--    event_a is seven days out, so this is the live case rather than a
--    contrived one.
-- ---------------------------------------------------------------------
select throws_ok(
  format($$ select submit_client_feedback(%L, 5, 'Too early') $$, :'booking_a'),
  '22023', null, '§11.2 feedback is refused before the event has started');

-- ---------------------------------------------------------------------
-- 4. The gates that do not depend on timing.
-- ---------------------------------------------------------------------
select throws_ok(
  format($$ select submit_client_feedback(%L, 5, 'Not mine') $$, :'booking_b'),
  '42501', null, '§11.1 a customer cannot leave feedback on another customer''s booking');

select throws_ok(
  format($$ select submit_client_feedback(%L, 5, 'No such booking') $$, :'new_id'),
  '42501', null, 'a forged booking id is refused rather than ignored');

select throws_ok(
  format($$ select submit_client_feedback(%L, 0, 'Zero') $$, :'booking_a'),
  '22023', null, 'a rating below 1 is refused');

select throws_ok(
  format($$ select submit_client_feedback(%L, 6, 'Six') $$, :'booking_a'),
  '22023', null, 'a rating above 5 is refused');

-- ---------------------------------------------------------------------
-- 5. Once the event has started.
--    The fixtures already carry a client entry for this worker on this
--    event, so it is cleared first — otherwise every case below would be
--    testing the duplicate guard instead of what it says it tests.
-- ---------------------------------------------------------------------
reset role;
update shift_requirements set starts_at = now() - interval '2 hours',
                              ends_at   = now() + interval '6 hours'
 where id = :'shift_a';
delete from feedback where id = :'feedback_a';

select set_config('request.jwt.claims', json_build_object('sub', :'clienta_uid', 'role', 'authenticated')::text, true);
set local role authenticated;

select is((select feedback_given from client_lineup_v where booking_id = :'booking_a'), false,
  'with the entry cleared the button reads "Leave feedback" again');

select isnt(
  (select submit_client_feedback(:'booking_a', 4, '  Polite and early  ')),
  null::uuid,
  '§11.2 a started event accepts feedback and returns the new row''s id');

select is((select feedback_given from client_lineup_v where booking_id = :'booking_a'), true,
  '§11.2 the button becomes "✓ Feedback sent" straight after');

select throws_ok(
  format($$ select submit_client_feedback(%L, 5, 'Again') $$, :'booking_a'),
  '23505', null, '§11.5 one entry per worker per event from the portal');

-- ---------------------------------------------------------------------
-- 6. What was actually written.
-- ---------------------------------------------------------------------
reset role;

select is((select author_kind::text from feedback where staff_id = :'staffa' and event_id = :'event_a'),
  'client', 'the entry is recorded as client feedback (§9.10 Client tab)');

select is((select author_id from feedback where staff_id = :'staffa' and event_id = :'event_a'),
  :'clienta_uid'::uuid, 'the entry is attributed to the signed-in customer, not to the definer owner');

select is((select rating from feedback where staff_id = :'staffa' and event_id = :'event_a'),
  4, 'the rating is stored as given');

select is((select text from feedback where staff_id = :'staffa' and event_id = :'event_a'),
  'Polite and early', 'the comment is trimmed');

select is((select read_at from feedback where staff_id = :'staffa' and event_id = :'event_a'),
  null::timestamptz,
  '§9.10 read_at stays null: client feedback feeds the score only once the office marks it read (§6)');

-- ---------------------------------------------------------------------
-- 7. The office is not constrained by the portal's one-entry rule.
--    §9.10: the office leaves its own feedback "because not every client
--    uses the portal", so the unique index is partial on author_kind.
-- ---------------------------------------------------------------------
select lives_ok(
  format($$ insert into feedback (author_kind, author_id, staff_id, event_id, rating, text)
            values ('office', %L, %L, %L, 3, 'Office note on the same shift') $$,
         :'admin_uid', :'staffa', :'event_a'),
  '§9.10 the office can still record its own entry for the same worker and event');

-- ---------------------------------------------------------------------
-- 8. Who may call it at all.
-- ---------------------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(
  format($$ select submit_client_feedback(%L, 5, 'From a worker') $$, :'booking_a'),
  '42501', null, 'a worker cannot leave client feedback on the shift they worked');

reset role;
set local role anon;
select throws_ok(
  format($$ select submit_client_feedback(%L, 5, 'From anon') $$, :'booking_a'),
  '42501', null, 'anon holds no execute on submit_client_feedback');

select ok(not has_function_privilege('anon', 'public.submit_client_feedback(uuid, int, text)', 'execute'),
  'the execute grant is authenticated-only, not a world grant');

reset role;
select ok(has_function_privilege('authenticated', 'public.submit_client_feedback(uuid, int, text)', 'execute'),
  'a signed-in caller may execute it; the body decides what happens');

select * from finish();
rollback;
