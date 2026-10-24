-- =====================================================================
-- 941 · "Not needed — graduated" on a Term Dates Letter (ADR-0213, TK-19)
--   20261027130000_term_letter_not_needed.sql
--
--   A. Who can reach it: anon, a client, a worker, a viewer — refused.
--   B. What it refuses: not a term letter, verified, nobody graduated,
--      a completion date still to come.
--   C. A graduate's pending letter: superseded, out of the current set,
--      audited, and no message to the worker.
-- =====================================================================
begin;
select plan(13);
\ir _shared/fixtures.psql

\set s_grad   '94100000-0000-4000-8000-000000000001'
\set s_term   '94100000-0000-4000-8000-000000000002'
\set s_future '94100000-0000-4000-8000-000000000003'
\set d_term   '94100000-0000-4000-8000-0000000000d1'
\set d_cl     '94100000-0000-4000-8000-0000000000d2'
\set d_ver    '94100000-0000-4000-8000-0000000000d3'
\set d_other  '94100000-0000-4000-8000-0000000000d4'
\set d_future '94100000-0000-4000-8000-0000000000d5'
\set d_fcl    '94100000-0000-4000-8000-0000000000d6'
\set viewer   '94100000-0000-4000-8000-0000000000f1'

insert into auth.users (id, email) values (:'viewer', 'viewer.941@rls.test');
insert into profiles (id, role, office_role, full_name) values
  (:'viewer', 'admin', 'viewer', 'Vera Viewer');

insert into staff (id, first_name, last_name, email, phone, dob, status) values
  (:'s_grad',   'Raj', 'Grad',   'raj@grad.test',    '+447700994101', date '2001-01-01', 'documents'),
  (:'s_term',   'Tia', 'Term',   'tia@term.test',    '+447700994102', date '2001-02-02', 'documents'),
  (:'s_future', 'Fay', 'Future', 'fay@future.test',  '+447700994103', date '2001-03-03', 'documents');

insert into compliance_docs (id, staff_id, doc_type, file_path, mime_type, review_status, completion_date_claimed) values
  -- A graduate: a rejected Completion Letter (claimed 27.05.2026) and a pending term letter.
  (:'d_term',   :'s_grad',   'university_term_dates_letter', 'x/t1.pdf', 'application/pdf', 'pending',  null),
  (:'d_cl',     :'s_grad',   'university_completion_letter', 'x/c1.pdf', 'application/pdf', 'rejected', date '2026-05-27'),
  -- A student in term: no Completion Letter at all.
  (:'d_other',  :'s_term',   'university_term_dates_letter', 'x/t2.pdf', 'application/pdf', 'pending',  null),
  (:'d_ver',    :'s_term',   'university_term_dates_letter', 'x/t3.pdf', 'application/pdf', 'verified', null),
  -- Completion still to come.
  (:'d_future', :'s_future', 'university_term_dates_letter', 'x/t4.pdf', 'application/pdf', 'pending',  null),
  (:'d_fcl',    :'s_future', 'university_completion_letter', 'x/c2.pdf', 'application/pdf', 'pending',
                (now() at time zone 'Europe/London')::date + 30);

-- =====================================================================
-- A · who can reach it
-- =====================================================================
select ok(not has_function_privilege('anon', 'compliance_set_aside_term_letter(uuid)', 'execute'),
  'anon cannot execute it');

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
select throws_ok($$ select compliance_set_aside_term_letter('94100000-0000-4000-8000-0000000000d1') $$,
  '42501', 'not_authorised', 'a client cannot');
set local "request.jwt.claims" = '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}';
select throws_ok($$ select compliance_set_aside_term_letter('94100000-0000-4000-8000-0000000000d1') $$,
  '42501', 'not_authorised', 'nor can a worker');
set local "request.jwt.claims" = '{"sub":"94100000-0000-4000-8000-0000000000f1","role":"authenticated"}';
select throws_ok($$ select compliance_set_aside_term_letter('94100000-0000-4000-8000-0000000000d1') $$,
  null, 'read_only', 'a viewer changes nothing (ADR-0060)');
reset role;

-- =====================================================================
-- B · what it refuses (the office)
-- =====================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select throws_ok($$ select compliance_set_aside_term_letter('94100000-0000-4000-8000-0000000000d2') $$,
  'P0001', 'not_a_term_letter', 'only a Term Dates Letter');
select throws_ok($$ select compliance_set_aside_term_letter('94100000-0000-4000-8000-0000000000d3') $$,
  'P0001', 'not_pending', 'a verified letter stays the evidence it was');
select throws_ok($$ select compliance_set_aside_term_letter('94100000-0000-4000-8000-0000000000d4') $$,
  'P0001', 'no_graduation', 'a student with no Completion Letter keeps Verify / Reject');
select throws_ok($$ select compliance_set_aside_term_letter('94100000-0000-4000-8000-0000000000d5') $$,
  'P0001', 'no_graduation', 'a completion date still to come does not count');
reset role;

-- =====================================================================
-- C · a graduate's pending letter
-- =====================================================================
select is((select count(*)::int from notification_outbox where recipient_staff_id = :'s_grad'), 0,
  'nothing queued for the graduate before');
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select is(compliance_set_aside_term_letter(:'d_term') ->> 'completed', '2026-05-27',
  'set aside, on the strength of the claimed completion date');
reset role;
select is((select review_status::text from compliance_docs where id = :'d_term'), 'superseded',
  'the letter is superseded, not deleted');
select is((select count(*)::int from current_compliance_docs(:'s_grad') where doc_type = 'university_term_dates_letter'), 0,
  'and is no longer one of the worker''s current documents');
select is((select count(*)::int from notification_outbox where recipient_staff_id = :'s_grad'), 0,
  'no message to the worker — unlike Reject (N8)');

select * from finish();
rollback;
