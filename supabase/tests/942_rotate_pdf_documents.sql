-- =====================================================================
-- 942 · Rotate a PDF too (ADR-0214, TK-24)
--   20261027140000_rotate_pdf_documents.sql
--
--   A PDF passport is turned by the office into a .pdf beside it, stays a
--   PDF, and the old file is owed to the purge queue. A file that is
--   neither a photo nor a PDF (HEIC) is still refused.
-- =====================================================================
begin;
select plan(6);
\ir _shared/fixtures.psql

\set s1    '94200000-0000-4000-8000-000000000001'
\set d_pdf '94200000-0000-4000-8000-0000000000d1'
\set d_hei '94200000-0000-4000-8000-0000000000d2'

insert into staff (id, first_name, last_name, email, phone, dob, status) values
  (:'s1', 'Pia', 'Pdf', 'pia@pdf.test', '+447700994201', date '2001-01-01', 'documents');
insert into compliance_docs (id, staff_id, doc_type, file_path, mime_type, file_size, review_status) values
  (:'d_pdf', :'s1', 'passport', '94200000-0000-4000-8000-000000000001/passport/aaaa1111-0000-4000-8000-000000000001.pdf', 'application/pdf', 1000, 'pending'),
  (:'d_hei', :'s1', 'passport', '94200000-0000-4000-8000-000000000001/passport/aaaa1111-0000-4000-8000-000000000002.heic', 'image/heic', 1000, 'pending');

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select throws_ok($$ select turn_document_upright('94200000-0000-4000-8000-0000000000d2',
  '94200000-0000-4000-8000-000000000001/passport/aaaa1111-0000-4000-8000-000000000002.heic',
  '94200000-0000-4000-8000-000000000001/passport/bbbb2222-0000-4000-8000-000000000002.jpg', 900, 90) $$,
  'P0001', 'not_a_photo', 'a HEIC is still not turned');
select is(turn_document_upright(:'d_pdf',
  '94200000-0000-4000-8000-000000000001/passport/aaaa1111-0000-4000-8000-000000000001.pdf',
  '94200000-0000-4000-8000-000000000001/passport/bbbb2222-0000-4000-8000-000000000001.pdf', 1200, 90) ->> 'by',
  'office', 'the office turns a pending PDF');
reset role;
select is((select file_path from compliance_docs where id = :'d_pdf'),
  '94200000-0000-4000-8000-000000000001/passport/bbbb2222-0000-4000-8000-000000000001.pdf',
  'the row reads the turned PDF');
select is((select (mime_type, file_size, review_status)::text from compliance_docs where id = :'d_pdf'),
  '(application/pdf,1200,pending)', 'still a PDF, of the new size, still pending review');
select is((select count(*)::int from storage_deletions
            where path = '94200000-0000-4000-8000-000000000001/passport/aaaa1111-0000-4000-8000-000000000001.pdf'), 1,
  'the replaced PDF is owed to the purge queue');
select is((select data ->> 'degrees' from audit_log where action = 'document.turned_upright' and entity_id = :'d_pdf'),
  '90', 'audited');

select * from finish();
rollback;
