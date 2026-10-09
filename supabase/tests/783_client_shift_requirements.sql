-- =====================================================================
-- 783 · Client shift requirements: a menu quiz and a kit reminder per
--       client and role · 20261008180000 · ADR-0110
--
--   A. Shape: six admin-only tables, definer RPCs with a pinned
--      search_path, nothing for anon; the installer and the tick are the
--      service role's only.
--   B. The bar menu quiz installs for a client — ten slides, a pool of
--      thirty-five questions dealt ten at a time (ADR-0111), the Bar Staff
--      and Wine Waiting Service requirements with the kit message — and
--      installs again without doubling anything.
--   C. The worker sees what each live booking asks (staff_shift_
--      requirements), and reads the quiz without its key; a worker with no
--      such booking is refused.
--   D. CR1 goes out once when a booking is confirmed, never at invitation.
--   E. Marking, each sitting against the hand it was dealt (ADR-0111):
--      incomplete, retry, retry, failed (CR3 to the office), then no
--      attempts left; the office resets; a pass clears the worker and a
--      second sitting is refused.
--   F. CR2: due at 07:00 UK (or three hours before an early start), queued
--      once per booking and start, not after acknowledging, again for a
--      moved start.
--   G. Acknowledging: own confirmed booking only, idempotent, nothing to
--      acknowledge without a kit message.
--   H. Reset is the office's; the views are the office's.
-- =====================================================================
begin;
select plan(72);
\ir _shared/fixtures.psql

\set shift_c   'ffffffff-0000-4000-8000-000000000003'
\set booking_c '0a0a0a0a-0000-4000-8000-000000000003'
\set booking_d '0a0a0a0a-0000-4000-8000-000000000004'

-- A second section on client A's event, for the fixture role, and a
-- second worker invited to it (confirmed in D).
insert into shift_requirements (id, event_id, role_id, starts_at, ends_at, headcount, buffer,
                                charge_rate, pay_rate, dress_code, allocation_per_hour) values
  (:'shift_c', :'event_a', :'role_id', now() + interval '7 days 2 hours', now() + interval '7 days 9 hours',
   2, 0, 22.97, 14.00, 'Black tie', 2);

-- =====================================================================
-- A · Shape
-- =====================================================================
select bag_eq(
  $$ select c.relname::text from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
        and c.relname in ('client_quizzes', 'client_quiz_slides', 'client_quiz_questions',
                          'client_quiz_attempts', 'client_role_requirements', 'booking_kit_acknowledgements') $$,
  $$ values ('client_quizzes'::text), ('client_quiz_slides'), ('client_quiz_questions'),
            ('client_quiz_attempts'), ('client_role_requirements'), ('booking_kit_acknowledgements') $$,
  'A: RLS is on for all six tables');
select is((select count(*)::int from pg_policy p join pg_class c on c.oid = p.polrelid
            where c.relname in ('client_quizzes', 'client_quiz_slides', 'client_quiz_questions',
                                'client_quiz_attempts', 'client_role_requirements', 'booking_kit_acknowledgements')
              and p.polname <> 'admin_all'), 0,
  'A: admin_all is the only policy on any of them — the worker goes through the RPCs (ADR-0031)');
select ok((select bool_and(p.prosecdef and exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%'))
             from pg_proc p where p.pronamespace = 'public'::regnamespace
              and p.proname in ('staff_shift_requirements', 'staff_client_quiz', 'submit_client_quiz_attempt',
                                'acknowledge_shift_kit', 'client_kit_reminder_tick', 'reset_client_quiz_attempts',
                                'install_bar_menu_quiz', 'bookings_client_quiz_notice')),
  'A: every RPC is security definer with a pinned search_path');
select ok(not has_function_privilege('anon', 'public.staff_client_quiz(uuid)', 'execute')
          and not has_function_privilege('anon', 'public.submit_client_quiz_attempt(uuid, jsonb)', 'execute')
          and not has_function_privilege('anon', 'public.acknowledge_shift_kit(uuid)', 'execute'),
  'A: anon may call none of the worker''s RPCs');
select ok(not has_function_privilege('authenticated', 'public.install_bar_menu_quiz(uuid)', 'execute')
          and not has_function_privilege('authenticated', 'public.client_kit_reminder_tick(timestamptz)', 'execute')
          and has_function_privilege('service_role', 'public.client_kit_reminder_tick(timestamptz)', 'execute'),
  'A: the installer and the minute tick are the service role''s, not a signed-in user''s');

-- =====================================================================
-- B · The bar menu quiz installs for a client
-- =====================================================================
select lives_ok(format($$ select install_bar_menu_quiz(%L) $$, :'clienta'),
  'B: the bar menu quiz installs for client A');
select is((select count(*)::int from client_quizzes where client_id = :'clienta'), 1,
  'B: one quiz');
select is((select count(*)::int from client_quiz_slides sl join client_quizzes q on q.id = sl.quiz_id
            where q.client_id = :'clienta'), 10,
  'B: ten slides — the menu, section by section');
select is((select count(*)::int from client_quiz_questions qq join client_quizzes q on q.id = qq.quiz_id
            where q.client_id = :'clienta' and qq.active), 35,
  'B: thirty-five questions in the pool');
select is((select questions_per_attempt from client_quizzes where client_id = :'clienta'), 10,
  'B: ten of them per sitting (ADR-0111)');
select is((select qq.options[qq.correct_index + 1] from client_quiz_questions qq
            join client_quizzes q on q.id = qq.quiz_id
           where q.client_id = :'clienta' and qq.position = 1), '£34.00',
  'B: the key agrees with the menu (a bottle of Pinot Grigio is £34.00)');
select is((select pass_mark_percent || '/' || max_attempts from client_quizzes where client_id = :'clienta'), '80/3',
  'B: pass mark 80%, three attempts');
select bag_eq(
  format($$ select ro.name from client_role_requirements r join roles ro on ro.id = r.role_id
             where r.client_id = %L and r.quiz_id is not null and r.kit_message is not null $$, :'clienta'),
  $$ values ('Bar Staff'::text), ('Wine Waiting Service') $$,
  'B: Bar Staff and Wine Waiting Service each name the quiz and carry the kit message');
select is((select kit_message from client_role_requirements r join roles ro on ro.id = r.role_id
            where r.client_id = :'clienta' and ro.name = 'Bar Staff'),
  'Don''t forget to bring your bottle opener, notepad and pen to your shift - without this you will not be able to work this shift',
  'B: the kit message is the owner''s, word for word');
select is((select install_bar_menu_quiz(:'clienta')), (select id from client_quizzes where client_id = :'clienta'),
  'B: installing again returns the same quiz');
select is((select count(*)::int from client_quiz_questions qq join client_quizzes q on q.id = qq.quiz_id
            where q.client_id = :'clienta'), 35,
  'B: and does not double the questions');

-- The requirement under test: the fixture role (shift_a, shift_c) names the quiz too.
select id as quiz_id from client_quizzes where client_id = :'clienta' \gset
insert into client_role_requirements (client_id, role_id, quiz_id, kit_message)
values (:'clienta', :'role_id', :'quiz_id', 'Bring a corkscrew.');

select throws_ok(
  format($$ insert into client_role_requirements (client_id, role_id, quiz_id)
            values (%L, %L, %L) $$, :'clientb', :'role_id', :'quiz_id'),
  '23503', 'quiz_belongs_to_another_client',
  'B: a requirement cannot name another client''s quiz');

-- =====================================================================
-- C · What the worker sees
-- =====================================================================
-- Read as the migration role: a worker has no policy on shift_requirements.
select kit_reminder_due_at(starts_at) as due_a_lit from shift_requirements where id = :'shift_a' \gset
select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
set local role authenticated;

select results_eq(
  $$ select booking_id, client_name, role_name, quiz_passed, quiz_attempts_used, quiz_attempts_max,
            kit_message, kit_acknowledged_at from staff_shift_requirements() $$,
  format($$ values (%L::uuid, 'RLS Fixture Client A'::text, 'RLS Fixture Role'::text, false, 0, 3,
                    'Bring a corkscrew.'::text, null::timestamptz) $$, :'booking_a'),
  'C: staff A''s confirmed booking asks for the quiz (not passed, 0 of 3) and the kit message');
select is((select kit_due_at from staff_shift_requirements() where booking_id = :'booking_a'), :'due_a_lit'::timestamptz,
  'C: and says when the kit reminder is due');
select is((select (staff_client_quiz(:'quiz_id') ->> 'title')), 'Bar menu — Leonardo Royal Hotel London',
  'C: the worker reads the quiz');
select is((select jsonb_array_length(staff_client_quiz(:'quiz_id') -> 'slides')), 10,
  'C: with its ten slides');
select is((select jsonb_array_length(staff_client_quiz(:'quiz_id') -> 'questions')), 10,
  'C: and the ten questions of this sitting');
select is((select (staff_client_quiz(:'quiz_id') ->> 'questionPool') || '/' || (staff_client_quiz(:'quiz_id') ->> 'questionsPerAttempt')), '35/10',
  'C: told they are ten of a pool of thirty-five');
select ok((select not (staff_client_quiz(:'quiz_id') #> '{questions,0}') ? 'correctIndex'
             and not (staff_client_quiz(:'quiz_id') #> '{questions,0}') ? 'correct_index'),
  'C: WITHOUT the key');
select is((select staff_client_quiz(:'quiz_id') -> 'roles'), '["Bar Staff", "RLS Fixture Role", "Wine Waiting Service"]'::jsonb,
  'C: and names every role the pass covers');
select is((select staff_client_quiz(:'quiz_id') ->> 'attemptsLeft'), '3',
  'C: three attempts left');
reset role;

select set_config('request.jwt.claims', json_build_object('sub', :'staffb_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select count(*)::int from staff_shift_requirements()), 0,
  'C: staff B (booked at client B only) is asked nothing');
select throws_ok(format($$ select staff_client_quiz(%L) $$, :'quiz_id'), '42501', 'quiz_not_required',
  'C: and cannot read a quiz no booking of theirs names');
reset role;

-- =====================================================================
-- D · CR1 once, when a booking is confirmed
-- =====================================================================
insert into bookings (id, shift_id, staff_id, status, source) values
  (:'booking_c', :'shift_c', :'staffb', 'invited', 'manual');
select is((select count(*)::int from notification_outbox where template = 'CR1'), 0,
  'D: an invitation queues no CR1 — the quiz is asked of the booked');
update bookings set status = 'confirmed', confirmed_at = now() where id = :'booking_c';
select results_eq(
  format($$ select key, channel::text, recipient_staff_id, payload ->> 'quizId', payload ->> 'client', payload ->> 'roles'
              from notification_outbox where template = 'CR1' $$),
  format($$ values ('CR1:quiz:' || %L || ':' || %L, 'push'::text, %L::uuid, %L::text,
                    'RLS Fixture Client A'::text, 'Bar Staff and RLS Fixture Role and Wine Waiting Service'::text) $$,
         :'quiz_id', :'staffb', :'staffb', :'quiz_id'),
  'D: confirming it queues CR1 to the worker, keyed on quiz + worker, naming the client and the roles');
insert into bookings (id, shift_id, staff_id, status, source, confirmed_at) values
  (:'booking_d', :'shift_a', :'staffb', 'confirmed', 'manual', now());
select is((select count(*)::int from notification_outbox where template = 'CR1'), 1,
  'D: a second booking on a role that names the same quiz — still one CR1');
delete from bookings where id = :'booking_d';

-- =====================================================================
-- E · Marking
-- =====================================================================
-- Each sitting is marked against the hand dealt when the quiz was opened
-- (C, above, for the first). `wrong` answers every question of the open
-- hand one past its key; `right` answers it with the key. Read here, as
-- the test, never by the worker; dealt again before each sitting.
\set hand 'select jsonb_object_agg(x.id::text, (x.correct_index + 1) % array_length(x.options, 1))::text as wrong, jsonb_object_agg(x.id::text, x.correct_index)::text as right from client_quiz_draws d join client_quiz_questions x on x.id = any (d.question_ids) where d.quiz_id = ' :'quiz_id' ' and d.staff_id = ' :'staffa' ' and d.attempt_id is null'
:hand \gset

select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
set local role authenticated;

select is((select submit_client_quiz_attempt(:'quiz_id', '{}'::jsonb) ->> 'reason'), 'incomplete',
  'E: an unanswered question is incomplete, not marked');
select is((select submit_client_quiz_attempt(:'quiz_id', '{"00000000-0000-4000-8000-000000000000": 1}'::jsonb) ->> 'reason'), 'quiz_changed',
  'E: an answer to a question not on the hand is quiz_changed');
select is((select submit_client_quiz_attempt(:'quiz_id', :'wrong'::jsonb) - 'percent'),
  '{"ok": true, "attemptNo": 1, "correct": 0, "total": 10, "passed": false, "attemptsLeft": 2, "outcome": "retry"}'::jsonb,
  'E: attempt 1 wrong — 0 of 10, retry, two left');
select is((select submit_client_quiz_attempt(:'quiz_id', :'wrong'::jsonb) ->> 'reason'), 'quiz_changed',
  'E: the hand is spent with the attempt — the same answers again are quiz_changed');
reset role;
-- Opening the quiz deals the next hand (read as the migration role, with
-- staff A's claims standing).
select staff_client_quiz(:'quiz_id') -> 'questionPool' as _ \gset
:hand \gset
set local role authenticated;
select is((select submit_client_quiz_attempt(:'quiz_id', :'wrong'::jsonb) ->> 'attemptsLeft'), '1',
  'E: attempt 2 wrong — one left');
reset role;
select staff_client_quiz(:'quiz_id') -> 'questionPool' as _ \gset
:hand \gset
set local role authenticated;
select is((select submit_client_quiz_attempt(:'quiz_id', :'wrong'::jsonb) ->> 'outcome'), 'failed',
  'E: attempt 3 wrong — failed');
select is((select submit_client_quiz_attempt(:'quiz_id', :'right'::jsonb) ->> 'reason'), 'no_attempts_left',
  'E: and there is no fourth');
select is((select staff_client_quiz(:'quiz_id') ->> 'failed'), 'true',
  'E: the quiz reads failed to the worker');
reset role;

select results_eq(
  $$ select channel::text, recipient_emails, payload ->> 'name', payload ->> 'client', payload ->> 'attempts', payload ->> 'best'
       from notification_outbox where template = 'CR3' $$,
  $$ values ('email'::text, array['admin@thehospitalitycompany.co.uk'], 'Staff Alpha'::text,
             'RLS Fixture Client A'::text, '3'::text, '0 of 10'::text) $$,
  'E: the third failure emails the office once — who, which client, how many attempts, their best');
select is((select count(*)::int from audit_log where action = 'client_quiz.attempt' and entity_id = :'staffa'), 3,
  'E: every sitting is audited on the worker');

-- The office gives them their attempts back.
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select reset_client_quiz_attempts(:'quiz_id', :'staffa')), '{"ok": true, "superseded": 3}'::jsonb,
  'E: the office resets — three attempts superseded');
select is((select reset_client_quiz_attempts(:'quiz_id', :'staffa') ->> 'reason'), 'nothing_to_reset',
  'E: a second reset has nothing to do');
select is((select count(*)::int from clients_quiz_results_v where staff_id = :'staffa'), 0,
  'E: superseded attempts drop out of the office''s results');
reset role;
select is((select count(*)::int from client_quiz_attempts where staff_id = :'staffa' and superseded), 3,
  'E: but stay as history');

-- Their attempts back, a fresh hand is dealt on opening.
select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
select staff_client_quiz(:'quiz_id') -> 'questionPool' as _ \gset
:hand \gset
set local role authenticated;
select is((select submit_client_quiz_attempt(:'quiz_id', :'right'::jsonb) - 'percent'),
  '{"ok": true, "attemptNo": 1, "correct": 10, "total": 10, "passed": true, "attemptsLeft": 2, "outcome": "passed"}'::jsonb,
  'E: a fresh attempt 1, all correct — passed');
select is((select submit_client_quiz_attempt(:'quiz_id', :'right'::jsonb) ->> 'reason'), 'already_passed',
  'E: a pass is for good — no second sitting');
select is((select quiz_passed from staff_shift_requirements() where booking_id = :'booking_a'), true,
  'E: the booking now reads passed');
select is((select staff_client_quiz(:'quiz_id') ->> 'passed'), 'true',
  'E: and so does the quiz');
reset role;
select is((select count(*)::int from notification_outbox where template = 'CR3'), 1,
  'E: still one CR3 — a pass tells the office nothing');

-- =====================================================================
-- F · CR2, the morning of the shift
-- =====================================================================
select is(kit_reminder_due_at(('2026-10-20 19:00'::timestamp at time zone 'Europe/London')), ('2026-10-20 07:00'::timestamp at time zone 'Europe/London'),
  'F: a 19:00 UK start is reminded at 07:00 UK that day');
select is(kit_reminder_due_at(('2026-10-20 09:00'::timestamp at time zone 'Europe/London')), ('2026-10-20 06:00'::timestamp at time zone 'Europe/London'),
  'F: a 09:00 start three hours before, at 06:00');
select is(kit_reminder_due_at(('2026-10-20 01:00'::timestamp at time zone 'Europe/London')), ('2026-10-20 00:00'::timestamp at time zone 'Europe/London'),
  'F: and never before the UK day begins');

\set due_a '(select kit_reminder_due_at(starts_at) from shift_requirements where id = ' :'shift_a' ')'
\set due_c '(select kit_reminder_due_at(starts_at) from shift_requirements where id = ' :'shift_c' ')'
-- Booking C starts two hours after booking A. Whether the two are due at the
-- same moment depends on the time of day the suite runs (both 07:00 UK, or
-- three hours before each start), so the counts are derived, not assumed.
select is((select client_kit_reminder_tick(least((:due_a), (:due_c)) - interval '1 minute')), '{"cr2": 0}'::jsonb,
  'F: a minute before the first is due, nothing');
select is((select (client_kit_reminder_tick((:due_a)) ->> 'cr2')::int),
          (select 1 + case when (:due_c) <= (:due_a) then 1 else 0 end),
  'F: at booking A''s due moment it is reminded (and booking C with it only if due by then)');
select is((select client_kit_reminder_tick((:due_a))), '{"cr2": 0}'::jsonb,
  'F: run again, nothing new');
select is((select (client_kit_reminder_tick((:due_c)) ->> 'cr2')::int),
          (select case when (:due_c) > (:due_a) then 1 else 0 end),
  'F: at booking C''s due moment, its turn if it was not already');
select is((select count(*)::int from notification_outbox where template = 'CR2'), 2,
  'F: two CR2 rows in all — one per booking');
select results_eq(
  format($$ select key, recipient_staff_id, payload ->> 'message', payload ->> 'role', payload ->> 'bookingId'
              from notification_outbox where template = 'CR2' and recipient_staff_id = %L $$, :'staffa'),
  format($$ select booking_reminder_key('CR2', %L, starts_at), %L::uuid, 'Bring a corkscrew.'::text,
                   'RLS Fixture Role'::text, %L::text from shift_requirements where id = %L $$,
         :'booking_a', :'staffa', :'booking_a', :'shift_a'),
  'F: keyed on booking + start, carrying the message, the role and the booking');

-- Staff A acknowledges; the shift then moves an hour later.
select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select acknowledge_shift_kit(:'booking_a') ->> 'acknowledgedAt' as ack_at \gset
select ok(:'ack_at'::timestamptz <= now(),
  'G: staff A acknowledges the kit message, and gets the stamp back');
select is((select kit_acknowledged_at from staff_shift_requirements() where booking_id = :'booking_a'), :'ack_at'::timestamptz,
  'G: and the booking reads acknowledged');
select is((select (acknowledge_shift_kit(:'booking_a') ->> 'acknowledgedAt')::timestamptz), :'ack_at'::timestamptz,
  'G: pressing again keeps the first stamp');
reset role;
update shift_requirements set starts_at = starts_at + interval '1 hour', ends_at = ends_at + interval '1 hour'
 where id in (:'shift_a', :'shift_c');
select is((select client_kit_reminder_tick(greatest((:due_a), (:due_c)))), '{"cr2": 1}'::jsonb,
  'F: the moved start is a new key — booking C is reminded again, booking A (acknowledged) is not');
select is((select count(*)::int from notification_outbox where template = 'CR2' and recipient_staff_id = :'staffa'), 1,
  'F: one CR2 for staff A in all');

-- =====================================================================
-- G · Acknowledging: whose booking, and is there anything to acknowledge
-- =====================================================================
select set_config('request.jwt.claims', json_build_object('sub', :'staffb_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(format($$ select acknowledge_shift_kit(%L) $$, :'booking_a'), '42501', 'not_your_booking',
  'G: staff B cannot acknowledge staff A''s booking');
select is((select acknowledge_shift_kit(:'booking_b') ->> 'reason'), 'nothing_to_acknowledge',
  'G: a booking with no kit message has nothing to acknowledge');
select throws_ok(format($$ select reset_client_quiz_attempts(%L, %L) $$, :'quiz_id', :'staffb'), '42501', 'not_authorised',
  'H: a worker cannot reset anybody''s attempts');
select is((select count(*)::int from clients_quiz_results_v), 0,
  'H: a worker reads no results (RLS)');
select is((select count(*)::int from clients_shift_requirements_v), 0,
  'H: nor the requirements');
reset role;

-- =====================================================================
-- H · The office's views
-- =====================================================================
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select results_eq(
  format($$ select display_name, employee_id, attempts_used, attempts_max, passed, failed, best_correct || ' of ' || total
              from clients_quiz_results_v where client_id = %L $$, :'clienta'),
  $$ values ('Staff Alpha'::text, 90001, 1, 3, true, false, '10 of 10'::text) $$,
  'H: the office sees who sat the quiz and where they stand');
select bag_eq(
  format($$ select role_name, quiz_title is not null, kit_message from clients_shift_requirements_v where client_id = %L $$, :'clienta'),
  $$ values ('Bar Staff'::text, true, 'Don''t forget to bring your bottle opener, notepad and pen to your shift - without this you will not be able to work this shift'::text),
            ('Wine Waiting Service', true, 'Don''t forget to bring your bottle opener, notepad and pen to your shift - without this you will not be able to work this shift'),
            ('RLS Fixture Role', true, 'Bring a corkscrew.') $$,
  'H: and what each role asks');
reset role;

select set_config('request.jwt.claims', json_build_object('sub', :'clienta_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select count(*)::int from clients_quiz_results_v) + (select count(*)::int from clients_shift_requirements_v), 0,
  'H: the client portal login reads none of it (ADR-0026)');
reset role;

select * from finish();
rollback;
