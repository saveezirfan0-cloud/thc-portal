-- =====================================================================
-- 849 · A client's quiz comes BEFORE the confirmation · 20261018120000 ·
--       ADR-0150 (amends ADR-0110)
--
--   A. Who may open and sit a quiz before they have a booking: a worker
--      who holds a role that names it, and no other.
--   B. client_quiz_gate(): the quiz still to pass, nothing for a client
--      that names none, nothing once passed or once the quiz is inactive;
--      internal (no signed-in caller reads another worker's standing).
--   C. Every path that confirms a worker, or lets them put themselves
--      forward, answers `quiz_required` with the quiz's id and changes
--      nothing: take_offered_shift, accept_invite, apply_to_shift (their
--      own, and the one the office lodges for them), accept_application.
--   D. The same four go through once the quiz is passed.
--   E. Nothing else changed: a client that names no quiz is unaffected,
--      an invitation is not a confirmation (it is still sent and kept),
--      and a worker already confirmed stays confirmed.
-- =====================================================================
begin;
select plan(34);
\ir _shared/fixtures.psql

\set sq_inv   '79000000-0000-4000-8000-000000000001'
\set sq_app   '79000000-0000-4000-8000-000000000002'
\set sq_take  '79000000-0000-4000-8000-000000000003'
\set sq_acc   '79000000-0000-4000-8000-000000000004'
\set b_inv    '79100000-0000-4000-8000-000000000001'
\set b_off    '79100000-0000-4000-8000-000000000002'
\set b_acc    '79100000-0000-4000-8000-000000000003'
\set offer    '79200000-0000-4000-8000-000000000001'

-- The Leonardo bar menu quiz, named by the fixture role at client A.
select install_bar_menu_quiz(:'clienta') as _q \gset
select id as quiz_id from client_quizzes where client_id = :'clienta' \gset
insert into client_role_requirements (client_id, role_id, quiz_id) values (:'clienta', :'role_id', :'quiz_id');
-- Staff B is wave 1 at client A, so a take is not "not yet" (RULE-17).
insert into client_qualifications (client_id, role_id, staff_id) values (:'clienta', :'role_id', :'staffb');

insert into shift_requirements (id, event_id, role_id, starts_at, ends_at, headcount, buffer,
                                charge_rate, pay_rate, dress_code, allocation_per_hour) values
  (:'sq_inv',  :'event_a', :'role_id', now() + interval '10 days', now() + interval '10 days 8 hours', 3, 0, 22.97, 14.00, 'Black tie', 3),
  (:'sq_app',  :'event_a', :'role_id', now() + interval '11 days', now() + interval '11 days 8 hours', 3, 0, 22.97, 14.00, 'Black tie', 3),
  (:'sq_take', :'event_a', :'role_id', now() + interval '12 days', now() + interval '12 days 8 hours', 3, 0, 22.97, 14.00, 'Black tie', 3),
  (:'sq_acc',  :'event_a', :'role_id', now() + interval '13 days', now() + interval '13 days 8 hours', 3, 0, 22.97, 14.00, 'Black tie', 3);

-- =====================================================================
-- A · Sitting it needs no booking — a role that names it is enough
-- =====================================================================
select set_config('request.jwt.claims', json_build_object('sub', :'staffb_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select staff_client_quiz(:'quiz_id') ->> 'title'), 'Bar menu — Leonardo Royal Hotel London',
  'A: a worker who holds the role opens the quiz before any booking names it');
reset role;
select ok(client_quiz_required_for(:'quiz_id', :'staffb'),
  'A: and may sit it (client_quiz_required_for)');
select ok(not client_quiz_required_for(:'quiz_id', gen_random_uuid()),
  'A: a stranger may not');
-- Someone still being onboarded holds the role (the office gives it at Accept)
-- but is not a worker yet.
insert into staff (id, first_name, last_name, email, phone, dob, status) values
  ('79300000-0000-4000-8000-000000000001', 'Doc', 'Stage', 'docstage@q790.test', '+447700979001', date '1995-01-01', 'documents');
insert into staff_roles (staff_id, role_id) values ('79300000-0000-4000-8000-000000000001', :'role_id');
select ok(not client_quiz_required_for(:'quiz_id', '79300000-0000-4000-8000-000000000001'),
  'A: nor may someone still being onboarded, even holding the role');
select ok(not has_function_privilege('authenticated', 'public.client_quiz_required_for(uuid, uuid)', 'execute')
      and not has_function_privilege('authenticated', 'public.client_quiz_passed(uuid, uuid)', 'execute')
      and not has_function_privilege('authenticated', 'public.client_quiz_attempts_used(uuid, uuid)', 'execute'),
  'A: and no signed-in caller can ask where another worker stands through the helpers');

-- =====================================================================
-- B · The gate
-- =====================================================================
select is(client_quiz_gate(:'sq_inv', :'staffb'), :'quiz_id'::uuid,
  'B: a shift whose client and role name a quiz the worker has not passed — the quiz');
select is(client_quiz_gate(:'shift_b', :'staffa'), null::uuid,
  'B: a client that names no quiz — nothing');
update client_quizzes set active = false where id = :'quiz_id';
select is(client_quiz_gate(:'sq_inv', :'staffb'), null::uuid,
  'B: an inactive quiz asks nothing');
update client_quizzes set active = true where id = :'quiz_id';
update client_quiz_questions set active = false where quiz_id = :'quiz_id';
select is(client_quiz_gate(:'sq_inv', :'staffb'), null::uuid,
  'B: a quiz with no live question asks nothing — it could never be passed, so it must not lock everyone out');
update client_quiz_questions set active = true where quiz_id = :'quiz_id';
select ok(not has_function_privilege('authenticated', 'public.client_quiz_gate(uuid, uuid)', 'execute')
      and not has_function_privilege('anon', 'public.client_quiz_gate(uuid, uuid)', 'execute'),
  'B: internal — no signed-in caller reads another worker''s standing through it');

-- =====================================================================
-- C · Refused until passed, and nothing changes
-- =====================================================================
-- Staff A holds a confirmed booking at this client already (the fixture);
-- an invitation to B, a pending application from A, and a cover offer.
insert into bookings (id, shift_id, staff_id, status, source) values
  (:'b_inv', :'sq_inv', :'staffb', 'invited', 'manual');
insert into bookings (id, shift_id, staff_id, status, source, applied_at) values
  (:'b_acc', :'sq_acc', :'staffa', 'applied', 'self', now());
insert into bookings (id, shift_id, staff_id, status, source, confirmed_at) values
  (:'b_off', :'sq_take', :'staffa', 'confirmed', 'manual', now());
insert into shift_offers (id, booking_id, mode, expires_at) values
  (:'offer', :'b_off', 'pool', now() + interval '3 days');

select set_config('request.jwt.claims', json_build_object('sub', :'staffb_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is(take_offered_shift(:'offer'), jsonb_build_object('ok', false, 'reason', 'quiz_required', 'quizId', :'quiz_id'::uuid),
  'C: taking a cover on Radar is a confirmation — quiz_required, with the quiz');
select is(accept_invite(:'b_inv'), jsonb_build_object('ok', false, 'reason', 'quiz_required', 'quizId', :'quiz_id'::uuid),
  'C: accepting an invitation — quiz_required, with the quiz');
reset role;
select is((select status::text from bookings where id = :'b_inv'), 'invited',
  'C: the invitation is left live — never withdrawn, so the worker can sit the quiz and accept');
select is((select status from shift_offers where id = :'offer'), 'open',
  'C: the offer is still open');
select is((select count(*)::int from bookings where shift_id = :'sq_take' and staff_id = :'staffb'), 0,
  'C: and the refused take wrote no booking');
select is((select count(*)::int from notification_outbox where template = 'CR1' and recipient_staff_id = :'staffb'), 0,
  'C: and staff B was not told "a quiz is waiting" — they were not confirmed (CR1 follows a confirmation)');

select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is(apply_to_shift(:'sq_app'), jsonb_build_object('ok', false, 'reason', 'quiz_required', 'quizId', :'quiz_id'::uuid),
  'C: putting yourself forward on Radar — quiz_required, with the quiz');
reset role;
select is((select count(*)::int from bookings where shift_id = :'sq_app' and staff_id = :'staffa'), 0,
  'C: and no application was written');

select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is(apply_to_shift(:'sq_app', :'staffa'), jsonb_build_object('ok', false, 'reason', 'quiz_required', 'quizId', :'quiz_id'::uuid),
  'C: the application the office lodges for a worker is held to it too');
select is(accept_application(:'b_acc'), jsonb_build_object('ok', false, 'reason', 'quiz_required', 'quizId', :'quiz_id'::uuid),
  'C: the office cannot confirm an applicant who has not passed');
reset role;
select is((select status::text from bookings where id = :'b_acc'), 'applied',
  'C: the application stays pending');

-- =====================================================================
-- E · What did not change
-- =====================================================================
select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((apply_to_shift(:'shift_b') ->> 'ok'), 'true',
  'E: a client that names no quiz — Radar applies exactly as before');
reset role;
select is((select status::text from bookings where id = :'booking_a'), 'confirmed',
  'E: a worker already confirmed at this client stays confirmed');

-- An invitation is not a confirmation: the office can still send one.
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((office_invite_worker(:'sq_app', :'staffb') ->> 'invited'), 'true',
  'E: the office can still invite a worker who has not passed — they are asked on the invitation');
reset role;

-- =====================================================================
-- D · Passed — the same four go through
-- =====================================================================
insert into client_quiz_attempts (quiz_id, staff_id, attempt_no, correct, total, score, passed, answers)
values (:'quiz_id', :'staffb', 1, 9, 10, 90, true, '{}'::jsonb),
       (:'quiz_id', :'staffa', 1, 10, 10, 100, true, '{}'::jsonb);
select is(client_quiz_gate(:'sq_inv', :'staffb'), null::uuid, 'D: a pass clears the gate');

select set_config('request.jwt.claims', json_build_object('sub', :'staffb_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((accept_invite(:'b_inv') ->> 'ok'), 'true', 'D: accept_invite confirms');
select is((take_offered_shift(:'offer') ->> 'ok'), 'true', 'D: and a Radar take confirms');
reset role;
select is((select status::text from bookings where id = :'b_inv'), 'confirmed', 'D: the invitation became a confirmed booking');
select is((select status from shift_offers where id = :'offer'), 'taken', 'D: the offer was taken');

select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((apply_to_shift(:'sq_app') ->> 'ok'), 'true', 'D: Radar apply records the application');
reset role;
select is((select status::text from bookings where shift_id = :'sq_app' and staff_id = :'staffa'), 'applied',
  'D: as an application, never a confirmation (§10.4)');

select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((accept_application(:'b_acc') ->> 'ok'), 'true', 'D: the office can now confirm the applicant');
reset role;
select is((select status::text from bookings where id = :'b_acc'), 'confirmed', 'D: confirmed');

-- A pass for good: another role naming the same quiz asks nothing more.
select is(client_quiz_gate(:'sq_take', :'staffb'), null::uuid,
  'D: a pass covers every shift whose client and role name that quiz');

select * from finish();
rollback;
