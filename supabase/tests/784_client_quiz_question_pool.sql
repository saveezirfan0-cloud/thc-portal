-- =====================================================================
-- 784 · Client quizzes deal their questions from a pool · 20261009180000
--       · ADR-0111
--
--   A. Shape: client_quiz_draws is admin-only with the viewer guard, the
--      draw helper is nobody's to call, the question list is the
--      installer's.
--   B. The installer tops up a quiz that has only the original ten,
--      never rewriting one; a new install gets all thirty-five.
--   C. Opening the quiz deals ten distinct questions from the pool; a
--      reload keeps the hand; a second worker gets their own.
--   D. Marking closes the hand; the next opening deals afresh; answers for
--      a spent hand are quiz_changed.
--   E. A hand holding a retired question is thrown away and dealt again
--      without it.
--   F. A passed worker is dealt nothing; a quiz with no questions_per_
--      attempt deals every question in order.
-- =====================================================================
begin;
select plan(31);
\ir _shared/fixtures.psql

select install_bar_menu_quiz(:'clienta') as quiz_id \gset
insert into client_role_requirements (client_id, role_id, quiz_id)
values (:'clienta', :'role_id', :'quiz_id');
-- Staff B booked on the fixture role too (shift_a, client A).
\set booking_b2 '0a0a0a0a-0000-4000-8000-000000000005'
insert into bookings (id, shift_id, staff_id, status, source, confirmed_at) values
  (:'booking_b2', :'shift_a', :'staffb', 'confirmed', 'manual', now());

-- =====================================================================
-- A · Shape
-- =====================================================================
select ok((select c.relrowsecurity from pg_class c where c.oid = 'public.client_quiz_draws'::regclass),
  'A: RLS is on for client_quiz_draws');
select is((select string_agg(p.polname, ',') from pg_policy p where p.polrelid = 'public.client_quiz_draws'::regclass), 'admin_all',
  'A: admin_all is its only policy');
select ok(exists (select 1 from pg_trigger t where t.tgrelid = 'public.client_quiz_draws'::regclass and t.tgname = 'office_read_only'),
  'A: it carries the viewer write guard (ADR-0060)');
select ok(not has_function_privilege('authenticated', 'public.client_quiz_draw(uuid, uuid, boolean)', 'execute')
          and not has_function_privilege('anon', 'public.client_quiz_draw(uuid, uuid, boolean)', 'execute'),
  'A: the draw helper is internal to the RPCs');
select ok(not has_function_privilege('authenticated', 'public.bar_menu_quiz_questions()', 'execute'),
  'A: the question list (with its keys) is the installer''s, not a signed-in user''s');
select ok((select not p.provolatile = 's' from pg_proc p where p.oid = 'public.staff_client_quiz(uuid)'::regprocedure),
  'A: staff_client_quiz is no longer stable — it deals the hand');

-- =====================================================================
-- B · The installer tops up
-- =====================================================================
select is((select count(*)::int from client_quiz_questions where quiz_id = :'quiz_id'), 35,
  'B: a fresh install has thirty-five questions');
select is((select count(*)::int from bar_menu_quiz_questions()), 35,
  'B: the list has thirty-five');
select is((select count(distinct question_no)::int from bar_menu_quiz_questions()), 35,
  'B: at thirty-five distinct positions');
select ok((select bool_and(correct_index >= 0 and correct_index < array_length(options, 1)) from bar_menu_quiz_questions()),
  'B: every key points at one of its options');
-- Back to the original ten, with one reworded, as a quiz installed before this migration.
delete from client_quiz_questions where quiz_id = :'quiz_id' and position > 10;
update client_quizzes set questions_per_attempt = null where id = :'quiz_id';
update client_quiz_questions set prompt = 'Reworded by the office' where quiz_id = :'quiz_id' and position = 1;
select is((select install_bar_menu_quiz(:'clienta')), :'quiz_id'::uuid,
  'B: installing again returns the same quiz');
select is((select count(*)::int from client_quiz_questions where quiz_id = :'quiz_id'), 35,
  'B: topped up to thirty-five');
select is((select prompt from client_quiz_questions where quiz_id = :'quiz_id' and position = 1), 'Reworded by the office',
  'B: the question it already had is not rewritten');
select is((select questions_per_attempt from client_quizzes where id = :'quiz_id'), 10,
  'B: and ten per sitting is set');

-- =====================================================================
-- C · Opening the quiz deals a hand
-- =====================================================================
select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select staff_client_quiz(:'quiz_id') -> 'questions' as hand_a1 \gset
select is(jsonb_array_length(:'hand_a1'::jsonb), 10,
  'C: staff A is dealt ten questions');
select is((select count(distinct q ->> 'id')::int from jsonb_array_elements(:'hand_a1'::jsonb) q), 10,
  'C: ten different ones');
select is((select string_agg(q ->> 'questionNo', ',' order by (q ->> 'questionNo')::int) from jsonb_array_elements(:'hand_a1'::jsonb) q), '1,2,3,4,5,6,7,8,9,10',
  'C: numbered 1 to 10 as served');
select is((select staff_client_quiz(:'quiz_id') -> 'questions'), :'hand_a1'::jsonb,
  'C: opening again keeps the same hand in the same order');
reset role;
select ok((select bool_and(exists (select 1 from client_quiz_questions x where x.id = (q ->> 'id')::uuid and x.quiz_id = :'quiz_id' and x.active))
             from jsonb_array_elements(:'hand_a1'::jsonb) q),
  'C: every question dealt is a live one of this quiz');
select is((select count(*)::int from client_quiz_draws where quiz_id = :'quiz_id' and staff_id = :'staffa'), 1,
  'C: one hand on record for staff A');

select set_config('request.jwt.claims', json_build_object('sub', :'staffb_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select staff_client_quiz(:'quiz_id') -> 'questions' as hand_b1 \gset
select is(jsonb_array_length(:'hand_b1'::jsonb), 10,
  'C: staff B is dealt their own ten');
reset role;

-- =====================================================================
-- D · Marking closes the hand
-- =====================================================================
select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
select jsonb_object_agg(x.id::text, x.correct_index)::text as right_a1
  from client_quiz_draws d join client_quiz_questions x on x.id = any (d.question_ids)
 where d.quiz_id = :'quiz_id' and d.staff_id = :'staffa' and d.attempt_id is null \gset
set local role authenticated;
select is((select submit_client_quiz_attempt(:'quiz_id', :'right_a1'::jsonb) ->> 'correct'), '10',
  'D: marked against the hand — 10 of 10');
reset role;
select is((select count(*)::int from client_quiz_draws d join client_quiz_attempts a on a.id = d.attempt_id
            where d.quiz_id = :'quiz_id' and d.staff_id = :'staffa' and a.attempt_no = 1), 1,
  'D: the hand is the attempt''s now');
-- A pass is for good, so staff B — not passed — shows the next deal.
select set_config('request.jwt.claims', json_build_object('sub', :'staffb_uid', 'role', 'authenticated')::text, true);
select jsonb_object_agg(x.id::text, (x.correct_index + 1) % array_length(x.options, 1))::text as wrong_b1
  from client_quiz_draws d join client_quiz_questions x on x.id = any (d.question_ids)
 where d.quiz_id = :'quiz_id' and d.staff_id = :'staffb' and d.attempt_id is null \gset
set local role authenticated;
select is((select submit_client_quiz_attempt(:'quiz_id', :'wrong_b1'::jsonb) ->> 'outcome'), 'retry',
  'D: staff B''s first sitting, all wrong — retry');
select is((select submit_client_quiz_attempt(:'quiz_id', :'wrong_b1'::jsonb) ->> 'reason'), 'quiz_changed',
  'D: the same answers again are for a spent hand — quiz_changed, not a second attempt');
select staff_client_quiz(:'quiz_id') -> 'questions' as hand_b2 \gset
select is(jsonb_array_length(:'hand_b2'::jsonb), 10,
  'D: opening again deals a fresh ten');
reset role;
select is((select count(*)::int from client_quiz_draws where quiz_id = :'quiz_id' and staff_id = :'staffb'), 2,
  'D: two hands on record for staff B — one spent, one open');

-- =====================================================================
-- E · A retired question throws the hand away
-- =====================================================================
update client_quiz_questions set active = false
 where id = ((:'hand_b2'::jsonb -> 0) ->> 'id')::uuid;
select set_config('request.jwt.claims', json_build_object('sub', :'staffb_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select staff_client_quiz(:'quiz_id') -> 'questions' as hand_b3 \gset
select ok(not exists (select 1 from jsonb_array_elements(:'hand_b3'::jsonb) q where q ->> 'id' = (:'hand_b2'::jsonb -> 0) ->> 'id')
          and jsonb_array_length(:'hand_b3'::jsonb) = 10,
  'E: the hand is dealt again without the retired question, still ten');
select is((select staff_client_quiz(:'quiz_id') ->> 'questionPool'), '34',
  'E: and the pool reads thirty-four');
reset role;

-- =====================================================================
-- F · Nothing to deal, and the old way
-- =====================================================================
select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select staff_client_quiz(:'quiz_id') -> 'questions'), '[]'::jsonb,
  'F: a passed worker is dealt nothing — the slides are theirs to read, the questions are not');
reset role;
update client_quizzes set questions_per_attempt = null where id = :'quiz_id';
select string_agg(prompt, '|' order by position) as in_order from client_quiz_questions where quiz_id = :'quiz_id' and active \gset
select set_config('request.jwt.claims', json_build_object('sub', :'staffb_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select string_agg(q ->> 'prompt', '|' order by (q ->> 'questionNo')::int)
             from jsonb_array_elements(staff_client_quiz(:'quiz_id') -> 'questions') q), :'in_order',
  'F: with no questions_per_attempt every live question is served in position order');
reset role;

select * from finish();
rollback;
