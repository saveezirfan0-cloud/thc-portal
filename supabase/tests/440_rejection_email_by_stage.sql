-- =====================================================================
-- 440 · Which rejection email a candidate gets (§2.7, §8 E2 / E2b)
--   20260923170000_rejection_email_by_stage.sql
--
-- E2 is THC's interview-rejection copy ("Thank you for taking the time to
-- complete your interview"), so it goes only to a candidate who HAS done
-- the interview: Interview completed, or a Willo response on file (D44,
-- 20260929150300, ADR-0037). A candidate rejected at Interview requested
-- before doing it, and one turned down after the interview, get E2b,
-- which does not thank them for an interview they never did.
-- =====================================================================
begin;
select plan(9);
\ir _shared/fixtures.psql

\set c_iv   '44000000-0000-4000-8000-000000000001'
\set c_docs '44000000-0000-4000-8000-000000000002'
\set c_quiz '44000000-0000-4000-8000-000000000003'
\set c_req  '44000000-0000-4000-8000-000000000004'
\set c_resp '44000000-0000-4000-8000-000000000005'

insert into staff (id, first_name, last_name, email, phone, dob, status, rtw_branch) values
  (:'c_iv',   'Ana', 'Iv',   'ana@e2.test', '+447700944001', date '2001-01-01', 'interview_completed', null),
  (:'c_docs', 'Bea', 'Docs', 'bea@e2.test', '+447700944002', date '2001-01-01', 'documents', 'uk_irish'),
  (:'c_quiz', 'Cai', 'Quiz', 'cai@e2.test', '+447700944003', date '2001-01-01', 'quiz', 'uk_irish'),
  (:'c_req',  'Dev', 'Req',  'dev@e2.test', '+447700944004', date '2001-01-01', 'interview_requested', null),
  (:'c_resp', 'Eli', 'Resp', 'eli@e2.test', '+447700944005', date '2001-01-01', 'interview_requested', null);
-- Eli has recorded a response in Willo; the New Response webhook that
-- moves the card has not arrived yet.
update staff set willo_completed_at = now() - interval '1 hour' where id = :'c_resp';

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select onboarding_reject(:'c_iv',   'Interview not strong enough');
select onboarding_reject(:'c_docs', 'Document could not be verified');
select onboarding_reject(:'c_quiz', 'Reference did not check out');
select onboarding_reject(:'c_req',  'Did not respond to the invitation');
select onboarding_reject(:'c_resp', 'Not the right fit');
reset role;

select is((select array_agg(template order by template) from notification_outbox where recipient_emails = array['ana@e2.test']),
  array['E2'], 'rejected at the interview: E2, THC''s interview wording');
select is((select array_agg(template order by template) from notification_outbox where recipient_emails = array['bea@e2.test']),
  array['E2b'], 'rejected at documents: E2b, not the interview wording');
select is((select array_agg(template order by template) from notification_outbox where recipient_emails = array['cai@e2.test']),
  array['E2b'], 'rejected at the quiz stage: E2b');
select is((select array_agg(template order by template) from notification_outbox where recipient_emails = array['dev@e2.test']),
  array['E2b'], 'D44: rejected at Interview requested before doing the interview: E2b — never thanked for an interview they did not do');
select is((select count(*)::int from notification_outbox where recipient_emails = array['dev@e2.test'] and template = 'E2'),
  0, 'D44: and no E2 at all');
select is((select array_agg(template order by template) from notification_outbox where recipient_emails = array['eli@e2.test']),
  array['E2'], 'a Willo response on file is a completed interview, whatever column the card is in: E2');
select is((select status::text || '/' || rejected_from::text from staff where id = :'c_req'),
  'rejected/interview_requested', 'the rejection itself is unchanged: rejected, from Interview requested');
select is((select count(*)::int from notification_outbox where recipient_emails && array['ana@e2.test','bea@e2.test','cai@e2.test','dev@e2.test','eli@e2.test'] and payload ? 'reason'),
  0, 'neither email carries the office''s reason');
select ok((select bool_and(key like template || ':staff:%') from notification_outbox where recipient_emails && array['ana@e2.test','bea@e2.test','cai@e2.test','dev@e2.test','eli@e2.test']),
  'each key is named for the email it sends, so an E2 and an E2b for one person never collide');

select * from finish();
rollback;
