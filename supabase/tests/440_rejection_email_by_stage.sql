-- =====================================================================
-- 440 · Which rejection email a candidate gets (§2.7, §8 E2 / E2b)
--   20260923170000_rejection_email_by_stage.sql
--
-- E2 is THC's interview-rejection copy and goes for every interview-stage
-- rejection, the office's and Willo's alike (380 pins both). A candidate
-- turned down after the interview gets E2b instead, which does not thank
-- them for an interview as though that were the end of it.
-- =====================================================================
begin;
select plan(5);
\ir _shared/fixtures.psql

\set c_iv   '44000000-0000-4000-8000-000000000001'
\set c_docs '44000000-0000-4000-8000-000000000002'
\set c_quiz '44000000-0000-4000-8000-000000000003'

insert into staff (id, first_name, last_name, email, phone, dob, status, rtw_branch) values
  (:'c_iv',   'Ana', 'Iv',   'ana@e2.test', '+447700944001', date '2001-01-01', 'interview_completed', null),
  (:'c_docs', 'Bea', 'Docs', 'bea@e2.test', '+447700944002', date '2001-01-01', 'documents', 'uk_irish'),
  (:'c_quiz', 'Cai', 'Quiz', 'cai@e2.test', '+447700944003', date '2001-01-01', 'quiz', 'uk_irish');

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select onboarding_reject(:'c_iv',   'Interview not strong enough');
select onboarding_reject(:'c_docs', 'Document could not be verified');
select onboarding_reject(:'c_quiz', 'Reference did not check out');
reset role;

select is((select array_agg(template order by template) from notification_outbox where recipient_emails = array['ana@e2.test']),
  array['E2'], 'rejected at the interview: E2, THC''s interview wording');
select is((select array_agg(template order by template) from notification_outbox where recipient_emails = array['bea@e2.test']),
  array['E2b'], 'rejected at documents: E2b, not the interview wording');
select is((select array_agg(template order by template) from notification_outbox where recipient_emails = array['cai@e2.test']),
  array['E2b'], 'rejected at the quiz stage: E2b');
select is((select count(*)::int from notification_outbox where recipient_emails && array['ana@e2.test','bea@e2.test','cai@e2.test'] and payload ? 'reason'),
  0, 'neither email carries the office''s reason');
select ok((select bool_and(key like template || ':staff:%') from notification_outbox where recipient_emails && array['ana@e2.test','bea@e2.test','cai@e2.test']),
  'each key is named for the email it sends, so an E2 and an E2b for one person never collide');

select * from finish();
rollback;
