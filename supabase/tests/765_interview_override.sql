-- =====================================================================
-- 765 · Mark interview complete without Willo (ADR-0077)
--   20261002105000_interview_override.sql
--
--   1. Grants: closed to anon and PUBLIC.
--   2. Only an owner or a manager may: a scheduler, a viewer, a client and
--      a worker are refused, and nothing moves.
--   3. The reason is mandatory.
--   4. An owner moves interview_requested → interview_completed, stamps
--      willo_completed_at and leaves one audit row naming who and why.
--   5. Only from interview_requested: a second call, or a candidate in
--      another stage, is refused.
--   6. A later Willo "New Response" for the same person is a no-op.
-- =====================================================================
begin;
select plan(16);
\ir _shared/fixtures.psql

\set manager   '76500000-0000-4000-8000-000000000001'
\set scheduler '76500000-0000-4000-8000-000000000002'
\set viewer    '76500000-0000-4000-8000-000000000003'
\set c_req     '76510000-0000-4000-8000-000000000001'
\set c_req2    '76510000-0000-4000-8000-000000000002'
\set c_docs    '76510000-0000-4000-8000-000000000003'

insert into auth.users (id, email) values
  (:'manager',   'manager@io765.test'),
  (:'scheduler', 'scheduler@io765.test'),
  (:'viewer',    'viewer@io765.test');
insert into profiles (id, role, office_role, full_name) values
  (:'manager',   'admin', 'manager',   'Mo Manager'),
  (:'scheduler', 'admin', 'scheduler', 'Sid Scheduler'),
  (:'viewer',    'admin', 'viewer',    'Vi Viewer');

insert into staff (id, first_name, last_name, email, phone, dob, status, rtw_branch, willo_candidate_id) values
  (:'c_req',  'Sam',  'Test', 'sam@io765.test',  '+447700965001', date '1985-01-01', 'interview_requested', null, 'willo-765-1'),
  (:'c_req2', 'Ola',  'Test', 'ola@io765.test',  '+447700965002', date '1990-01-01', 'interview_requested', null, null),
  (:'c_docs', 'Dee',  'Test', 'dee@io765.test',  '+447700965003', date '1990-01-01', 'documents', 'uk_irish', null);

-- 1 · Grants.
select ok(not has_function_privilege('anon', 'public.onboarding_mark_interview_complete(uuid, text)', 'execute')
      and not has_function_privilege('public', 'public.onboarding_mark_interview_complete(uuid, text)', 'execute'),
  'anon and PUBLIC cannot execute onboarding_mark_interview_complete');

-- 2 · Who may.
select set_config('request.jwt.claims', json_build_object('sub', :'scheduler', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(format($$ select onboarding_mark_interview_complete(%L, 'testing') $$, :'c_req'),
  '42501', null, 'a scheduler is refused');
reset role;

select set_config('request.jwt.claims', json_build_object('sub', :'viewer', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(format($$ select onboarding_mark_interview_complete(%L, 'testing') $$, :'c_req'),
  '42501', null, 'a viewer is refused');
reset role;

select set_config('request.jwt.claims', json_build_object('sub', :'clienta_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(format($$ select onboarding_mark_interview_complete(%L, 'testing') $$, :'c_req'),
  '42501', null, 'a client is refused');
reset role;

select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(format($$ select onboarding_mark_interview_complete(%L, 'testing') $$, :'c_req'),
  '42501', null, 'a worker is refused');
reset role;

select is((select status::text from staff where id = :'c_req'), 'interview_requested',
  'after every refusal the candidate has not moved');

-- 3 · Reason mandatory.
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(format($$ select onboarding_mark_interview_complete(%L, '   ') $$, :'c_req'),
  '22023', 'reason_required', 'a blank reason is refused');

-- 4 · An owner moves the card.
select is(onboarding_mark_interview_complete(:'c_req', '  Test candidate  '),
  jsonb_build_object('staffId', :'c_req', 'status', 'interview_completed'),
  'an owner marks the interview complete');
reset role;

select is((select status::text from staff where id = :'c_req'), 'interview_completed',
  'the candidate is now Interview completed');
select isnt((select willo_completed_at from staff where id = :'c_req'), null,
  'willo_completed_at is stamped');
select results_eq(
  format($$ select actor::text, data ->> 'reason', data ->> 'byName', data ->> 'fromStatus'
              from audit_log where action = 'interview_marked_complete' and entity_id = %L $$, :'c_req'),
  format($$ values (%L, 'Test candidate', 'Gisela M.', 'interview_requested') $$, :'admin_uid'),
  'one audit row: who, the trimmed reason, their name and where from');

-- 5 · Only from interview_requested.
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_like(format($$ select onboarding_mark_interview_complete(%L, 'again') $$, :'c_req'),
  'not_awaiting_interview%', 'a second call is refused');
select throws_like(format($$ select onboarding_mark_interview_complete(%L, 'testing') $$, :'c_docs'),
  'not_awaiting_interview%', 'a candidate in Documents is refused');
reset role;

-- A manager may too.
select set_config('request.jwt.claims', json_build_object('sub', :'manager', 'role', 'authenticated')::text, true);
set local role authenticated;
select is(onboarding_mark_interview_complete(:'c_req2', 'Interviewed in person') ->> 'status',
  'interview_completed', 'a manager marks the interview complete');
reset role;

-- 6 · Willo's own "New Response" afterwards changes nothing.
select is(willo_record_event('willo-765-1', 'new_response', now(), '{}'::jsonb) ->> 'outcome', 'unchanged',
  'a later Willo New Response is a no-op');
select is((select status::text from staff where id = :'c_req'), 'interview_completed',
  'and the candidate stays Interview completed');

select * from finish();
rollback;
