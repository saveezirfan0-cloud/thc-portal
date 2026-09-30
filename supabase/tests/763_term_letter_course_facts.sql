-- =====================================================================
-- 763 · staff_documents_v carries what a term letter says besides its
--       holidays, and nothing else of the AI's answer
--   20261002103000_term_letter_course_facts.sql
-- =====================================================================
begin;
select plan(5);
\ir _shared/fixtures.psql

\set student 'c7630000-0000-4000-8000-000000000001'
\set letter  'c7630000-0000-4000-8000-0000000000d1'
\set passport 'c7630000-0000-4000-8000-0000000000d2'

insert into staff (id, first_name, last_name, email, phone, dob, status, rtw_branch) values
  (:'student', 'Term', 'Letter', 'tl@763.test', '+447700976301', date '2004-01-01', 'documents', 'international_student');
insert into compliance_docs (id, staff_id, doc_type, review_status, uploaded_at, ai_extracted) values
  (:'letter', :'student', 'university_term_dates_letter', 'pending', now(),
   '{"provider":"anthropic","answer":{"secret":"not for the view"},
     "termLetter":{"courseStart":"2024-09-23","courseEnd":"2027-06-25",
                   "hoursStatement":"May work up to 20 hours per week during term time.",
                   "extra":"dropped"}}'::jsonb),
  (:'passport', :'student', 'passport', 'pending', now(),
   '{"termLetter":{"courseStart":"2024-09-23","courseEnd":null,"hoursStatement":null}}'::jsonb);

select has_column('staff_documents_v', 'ai_term_letter', 'staff_documents_v names the term letter facts');
-- Appended after ni_recheck, so no existing column moved.
select is(
  (select attnum::int from pg_attribute where attrelid = 'public.staff_documents_v'::regclass
      and attname = 'ai_term_letter'),
  (select attnum::int + 1 from pg_attribute where attrelid = 'public.staff_documents_v'::regclass
      and attname = 'ni_recheck'),
  'appended at the end, so no existing column moved');

select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is(
  (select ai_term_letter from staff_documents_v where id = :'letter'),
  '{"courseStart":"2024-09-23","courseEnd":"2027-06-25","hoursStatement":"May work up to 20 hours per week during term time."}'::jsonb,
  'the office reads the three facts, in the letter''s own words');
select is(
  (select count(*)::int from staff_documents_v where id = :'letter' and ai_term_letter ? 'extra'),
  0,
  'and only those three keys — never the rest of the answer');
select is(
  (select ai_term_letter from staff_documents_v where id = :'passport'),
  null::jsonb,
  'a document that is not a term letter never carries them');
reset role;

select * from finish();
rollback;
