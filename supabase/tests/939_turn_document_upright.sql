-- =====================================================================
-- 939 · A document photo turned the right way up (ADR-0212, TK-18)
--   20261027110000_turn_document_upright.sql
--
--   A. Who can reach it: anon, a client, a worker, a viewer — refused.
--   B. What it refuses: a bad turn, not pending, a stale file, a PDF,
--      a path outside the worker's folder or not a .jpg.
--   C. The office turns one: file swapped, old file owed to the purge
--      queue, audited as the office.
--   D. The AI read (service role) turns one, audited as the AI.
-- =====================================================================
begin;
select plan(20);
\ir _shared/fixtures.psql

\set s1     '93900000-0000-4000-8000-000000000001'
\set d_jpg  '93900000-0000-4000-8000-0000000000d1'
\set d_pdf  '93900000-0000-4000-8000-0000000000d2'
\set d_ver  '93900000-0000-4000-8000-0000000000d3'
\set d_ai   '93900000-0000-4000-8000-0000000000d4'
\set viewer '93900000-0000-4000-8000-0000000000f1'

insert into auth.users (id, email) values (:'viewer', 'viewer.939@rls.test');
insert into profiles (id, role, office_role, full_name) values
  (:'viewer', 'admin', 'viewer', 'Vera Viewer');

insert into staff (id, first_name, last_name, email, phone, dob, status) values
  (:'s1', 'Tara', 'Turn', 'tara@turn.test', '+447700993901', date '2001-01-01', 'documents');

insert into compliance_docs (id, staff_id, doc_type, file_path, mime_type, file_size, review_status) values
  (:'d_jpg', :'s1', 'passport', '93900000-0000-4000-8000-000000000001/passport/aaaa1111-0000-4000-8000-000000000001.jpg', 'image/jpeg', 1000, 'pending'),
  (:'d_pdf', :'s1', 'passport', '93900000-0000-4000-8000-000000000001/passport/aaaa1111-0000-4000-8000-000000000002.pdf', 'application/pdf', 1000, 'pending'),
  (:'d_ver', :'s1', 'national_id', '93900000-0000-4000-8000-000000000001/national_id/aaaa1111-0000-4000-8000-000000000003.png', 'image/png', 1000, 'verified'),
  (:'d_ai',  :'s1', 'birth_certificate', '93900000-0000-4000-8000-000000000001/birth_certificate/aaaa1111-0000-4000-8000-000000000004.png', 'image/png', 1000, 'pending');

-- =====================================================================
-- A · who can reach it
-- =====================================================================
select ok(not has_function_privilege('anon', 'turn_document_upright(uuid,text,text,int,int)', 'execute'),
  'anon cannot execute it');

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
select throws_ok($$ select turn_document_upright('93900000-0000-4000-8000-0000000000d1',
  '93900000-0000-4000-8000-000000000001/passport/aaaa1111-0000-4000-8000-000000000001.jpg',
  '93900000-0000-4000-8000-000000000001/passport/bbbb2222-0000-4000-8000-000000000001.jpg', 900, 90) $$,
  '42501', 'not_authorised', 'a client cannot turn a document');
set local "request.jwt.claims" = '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}';
select throws_ok($$ select turn_document_upright('93900000-0000-4000-8000-0000000000d1',
  '93900000-0000-4000-8000-000000000001/passport/aaaa1111-0000-4000-8000-000000000001.jpg',
  '93900000-0000-4000-8000-000000000001/passport/bbbb2222-0000-4000-8000-000000000001.jpg', 900, 90) $$,
  '42501', 'not_authorised', 'nor can a worker');
set local "request.jwt.claims" = '{"sub":"93900000-0000-4000-8000-0000000000f1","role":"authenticated"}';
select throws_ok($$ select turn_document_upright('93900000-0000-4000-8000-0000000000d1',
  '93900000-0000-4000-8000-000000000001/passport/aaaa1111-0000-4000-8000-000000000001.jpg',
  '93900000-0000-4000-8000-000000000001/passport/bbbb2222-0000-4000-8000-000000000001.jpg', 900, 90) $$,
  null, 'read_only', 'a viewer changes nothing (ADR-0060)');
reset role;

-- =====================================================================
-- B · what it refuses (the office)
-- =====================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select throws_ok($$ select turn_document_upright('93900000-0000-4000-8000-0000000000d1',
  '93900000-0000-4000-8000-000000000001/passport/aaaa1111-0000-4000-8000-000000000001.jpg',
  '93900000-0000-4000-8000-000000000001/passport/bbbb2222-0000-4000-8000-000000000001.jpg', 900, 45) $$,
  'P0001', 'bad_turn', 'only a quarter, half or three-quarter turn');
select throws_ok($$ select turn_document_upright('93900000-0000-4000-8000-0000000000d3',
  '93900000-0000-4000-8000-000000000001/national_id/aaaa1111-0000-4000-8000-000000000003.png',
  '93900000-0000-4000-8000-000000000001/national_id/bbbb2222-0000-4000-8000-000000000003.jpg', 900, 90) $$,
  'P0001', 'not_pending', 'a verified document stays as it was verified');
select throws_ok($$ select turn_document_upright('93900000-0000-4000-8000-0000000000d1',
  '93900000-0000-4000-8000-000000000001/passport/old.jpg',
  '93900000-0000-4000-8000-000000000001/passport/bbbb2222-0000-4000-8000-000000000001.jpg', 900, 90) $$,
  'P0001', 'file_changed', 'a stale read never swaps a newer file');
select throws_ok($$ select turn_document_upright('93900000-0000-4000-8000-0000000000d2',
  '93900000-0000-4000-8000-000000000001/passport/aaaa1111-0000-4000-8000-000000000002.pdf',
  '93900000-0000-4000-8000-000000000001/passport/bbbb2222-0000-4000-8000-000000000002.jpg', 900, 90) $$,
  'P0001', 'bad_path', 'a PDF stays a PDF: never swapped for a .jpg (ADR-0214)');
select throws_ok($$ select turn_document_upright('93900000-0000-4000-8000-0000000000d1',
  '93900000-0000-4000-8000-000000000001/passport/aaaa1111-0000-4000-8000-000000000001.jpg',
  '44444444-4444-4444-4444-444444444444/passport/bbbb2222-0000-4000-8000-000000000001.jpg', 900, 90) $$,
  'P0001', 'bad_path', 'the copy stays in the worker''s own folder');
select throws_ok($$ select turn_document_upright('93900000-0000-4000-8000-0000000000d1',
  '93900000-0000-4000-8000-000000000001/passport/aaaa1111-0000-4000-8000-000000000001.jpg',
  '93900000-0000-4000-8000-000000000001/passport/bbbb2222-0000-4000-8000-000000000001.png', 900, 90) $$,
  'P0001', 'bad_path', 'the copy is a .jpg');
reset role;
select is((select count(*)::int from audit_log where action = 'document.turned_upright'), 0,
  'a refusal audits nothing');

-- =====================================================================
-- C · the office turns one
-- =====================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select is(turn_document_upright(:'d_jpg',
  '93900000-0000-4000-8000-000000000001/passport/aaaa1111-0000-4000-8000-000000000001.jpg',
  '93900000-0000-4000-8000-000000000001/passport/bbbb2222-0000-4000-8000-000000000001.jpg', 900, 90) ->> 'by',
  'office', 'the office turns a pending photo');
reset role;
select is((select file_path from compliance_docs where id = :'d_jpg'),
  '93900000-0000-4000-8000-000000000001/passport/bbbb2222-0000-4000-8000-000000000001.jpg',
  'the row reads the upright copy');
select is((select (mime_type, file_size, review_status)::text from compliance_docs where id = :'d_jpg'),
  '(image/jpeg,900,pending)', 'a JPEG of the new size, still pending review');
select is((select count(*)::int from storage_deletions
            where path = '93900000-0000-4000-8000-000000000001/passport/aaaa1111-0000-4000-8000-000000000001.jpg'
              and deleted_at is null), 1,
  'the replaced file is owed to the purge queue');
select is((select (actor::text, data ->> 'degrees', data ->> 'by') from audit_log
            where action = 'document.turned_upright' and entity_id = :'d_jpg')::text,
  format('(%s,90,office)', :'admin_uid'), 'audited against the manager');

-- =====================================================================
-- D · the AI read (service role)
-- =====================================================================
set local role service_role;
set local "request.jwt.claims" = '{"role":"service_role"}';
select is(turn_document_upright(:'d_ai',
  '93900000-0000-4000-8000-000000000001/birth_certificate/aaaa1111-0000-4000-8000-000000000004.png',
  '93900000-0000-4000-8000-000000000001/birth_certificate/bbbb2222-0000-4000-8000-000000000004.jpg', 800, 180) ->> 'by',
  'ai', 'the AI read turns a PNG photo into an upright JPEG');
reset role;
select is((select mime_type from compliance_docs where id = :'d_ai'), 'image/jpeg', 'stored as a JPEG');
select is((select (actor is null, data ->> 'degrees', data ->> 'by') from audit_log
            where action = 'document.turned_upright' and entity_id = :'d_ai')::text,
  '(t,180,ai)', 'audited as the AI, with no person behind it');
select is((select count(*)::int from storage_deletions where staff_id = :'s1' and deleted_at is null), 2,
  'both replaced files are queued, nothing else');

select * from finish();
rollback;
