-- =====================================================================
-- 943 · A Completion Letter for a finished course sets the Term Dates
--       Letter aside (ADR-0215, TK-23)
--   20261027150000_completion_letter_sets_term_letter_aside.sql
--
--   A. A completion date that has passed: the pending term letter is
--      superseded and audited; nothing is sent about it.
--   B. A completion date still to come: the term letter stays in force.
--   C. A verified term letter is never touched.
-- =====================================================================
begin;
select plan(8);
\ir _shared/fixtures.psql

\set g_uid  '94300000-0000-4000-8000-0000000000a1'
\set f_uid  '94300000-0000-4000-8000-0000000000a2'
\set grad   '94300000-0000-4000-8000-000000000001'
\set fut    '94300000-0000-4000-8000-000000000002'
\set t_grad '94300000-0000-4000-8000-0000000000d1'
\set t_ver  '94300000-0000-4000-8000-0000000000d2'
\set t_fut  '94300000-0000-4000-8000-0000000000d3'

insert into auth.users (id, email) values (:'g_uid', 'grad@tl.test'), (:'f_uid', 'fut@tl.test');
insert into profiles (id, role, full_name) values
  (:'g_uid', 'staff', 'Gia Graduate'), (:'f_uid', 'staff', 'Finn Future');
insert into staff (id, user_id, first_name, last_name, email, phone, dob, status, rtw_branch) values
  (:'grad', :'g_uid', 'Gia',  'Graduate', 'grad@tl.test', '+447700994301', date '2001-01-01', 'documents', 'international_student'),
  (:'fut',  :'f_uid', 'Finn', 'Future',   'fut@tl.test',  '+447700994302', date '2001-02-02', 'documents', 'international_student');

insert into compliance_docs (id, staff_id, doc_type, file_path, mime_type, review_status, uploaded_at) values
  (:'t_ver',  :'grad', 'university_term_dates_letter', 'x/old.pdf', 'application/pdf', 'verified', now() - interval '300 days'),
  (:'t_grad', :'grad', 'university_term_dates_letter', 'x/t1.pdf',  'application/pdf', 'pending',  now() - interval '1 hour'),
  (:'t_fut',  :'fut',  'university_term_dates_letter', 'x/t2.pdf',  'application/pdf', 'pending',  now() - interval '1 hour');

insert into storage.objects (bucket_id, name, metadata) values
  ('documents', :'grad' || '/completion-letter/c1.pdf', '{"mimetype":"application/pdf","size":1000}'),
  ('documents', :'fut'  || '/completion-letter/c2.pdf', '{"mimetype":"application/pdf","size":1000}');

-- =====================================================================
-- A · a course that has finished
-- =====================================================================
select set_config('request.jwt.claims', json_build_object('sub', :'g_uid')::text, true);
select is(submit_completion_letter(:'grad' || '/completion-letter/c1.pdf',
                                   (now() at time zone 'Europe/London')::date - 100, 'letter') ->> 'ok',
  'true', 'a graduate files a Completion Letter');
select is((select review_status::text from compliance_docs where id = :'t_grad'), 'superseded',
  'their pending Term Dates Letter is set aside at once');
select is((select count(*)::int from current_compliance_docs(:'grad') where doc_type = 'university_term_dates_letter'), 1,
  'the verified older letter is still on file as it was');
select is((select data ->> 'by' from audit_log where action = 'term_letter.set_aside' and entity_id = :'t_grad'),
  'completion_letter_upload', 'audited as set aside by the upload');
select is((select count(*)::int from notification_outbox
            where recipient_staff_id = :'grad' and template not in ('CL1')), 0,
  'nothing is sent about it — only the usual "upload received"');

-- =====================================================================
-- B · a course still to finish
-- =====================================================================
select set_config('request.jwt.claims', json_build_object('sub', :'f_uid')::text, true);
select is(submit_completion_letter(:'fut' || '/completion-letter/c2.pdf',
                                   (now() at time zone 'Europe/London')::date + 300, 'letter') ->> 'ok',
  'true', 'a Completion Letter for a course still to finish is filed');
select is((select review_status::text from compliance_docs where id = :'t_fut'), 'pending',
  'and the Term Dates Letter stays in force');

-- =====================================================================
-- C · verified is never touched
-- =====================================================================
select is((select review_status::text from compliance_docs where id = :'t_ver'), 'verified',
  'a verified Term Dates Letter is left as it was');

select * from finish();
rollback;
