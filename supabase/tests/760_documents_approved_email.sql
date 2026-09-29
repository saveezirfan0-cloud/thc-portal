-- =====================================================================
-- 760 · Documents approved: E12 when the quiz unlocks (ADR-0074)
--   20261001216000_documents_approved_email.sql
--
--   1. Verifying a document while another is still outstanding sends
--      nothing: the quiz is still locked.
--   2. Verifying the last one moves the candidate to Quiz AND queues E12,
--      once, to the candidate's own address, with their first name.
--   3. Calling the unlock again does nothing: no second email.
--   (That the drain renders E12 is templates.test.ts, ADR-0074.)
-- =====================================================================
begin;
select plan(9);
\ir _shared/fixtures.psql

\set cand   '76000000-0000-4000-8000-000000000001'
\set d_pass '76000000-0000-4000-8000-0000000000d1'
\set d_ni   '76000000-0000-4000-8000-0000000000d2'

insert into staff (id, first_name, last_name, email, phone, dob, status, rtw_branch) values
  (:'cand', ' Aisha ', 'Bello', 'aisha@e12.test', '+447700960001', date '2001-07-07', 'documents', 'uk_irish');

insert into criminal_declarations (staff_id, source, answer) values (:'cand', 'onboarding', false);
insert into compliance_docs (id, staff_id, doc_type, file_path, review_status) values
  (:'d_pass', :'cand', 'passport', 'cand/passport.pdf', 'pending'),
  (:'d_ni',   :'cand', 'ni_evidence', 'cand/ni.jpg', 'pending');

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

-- 1 · One verified, one still pending.
select lives_ok(format($$ select verify_document(%L) $$, :'d_ni'), 'the office verifies the NI evidence');
reset role;
select is((select status::text from staff where id = :'cand'), 'documents',
  'with the passport still pending, the candidate stays in Documents');
select is((select count(*)::int from notification_outbox where template = 'E12'), 0,
  'and no approval email goes out yet');

-- 2 · The last one.
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select lives_ok(format($$ select verify_document(%L) $$, :'d_pass'), 'the office verifies the last document');
reset role;
select is((select status::text from staff where id = :'cand'), 'quiz', 'the quiz unlocks by itself (§2.3)');
select results_eq(
  $$ select channel::text, recipient_staff_id::text, recipient_emails, payload, sent_at is null
       from notification_outbox where template = 'E12' $$,
  $$ values ('email', '76000000-0000-4000-8000-000000000001', array['aisha@e12.test'],
             '{"name": "Aisha"}'::jsonb, true) $$,
  'E12 is queued once: an email to the candidate''s own address, with their first name, unsent');
select ok((select key like 'E12:staff:76000000-0000-4000-8000-000000000001:%'
             from notification_outbox where template = 'E12'),
  'keyed to the candidate and the unlock moment');

-- 3 · Nothing more to unlock.
select is(onboarding_advance_if_ready(:'cand'), false, 'a second call finds nothing to do');
select is((select count(*)::int from notification_outbox where template = 'E12'), 1,
  'and so queues no second email');
select * from finish();
rollback;
