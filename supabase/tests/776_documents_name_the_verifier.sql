-- =====================================================================
-- 776 · The Documents tab names the manager who verified, for any manager
--       20261007100000
--
-- staff_documents_v is security_invoker and profiles only has profiles_self,
-- so the reviewer's name used to come back NULL for every manager except the
-- one who verified. It now goes through office_user_name().
-- =====================================================================
begin;
select plan(4);
\ir _shared/fixtures.psql

-- A second manager, who did the verifying; Gisela (admin_uid) is the viewer.
insert into auth.users (id, email) values ('66666666-6666-6666-6666-666666666666', 'tom@rls.test');
insert into profiles (id, role, full_name) values ('66666666-6666-6666-6666-666666666666', 'admin', 'Tom R.');
update compliance_docs set reviewed_by = '66666666-6666-6666-6666-666666666666', reviewed_at = now()
 where id = :'doc_a';

select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select reviewed_by_name from staff_documents_v where id = :'doc_a'), 'Tom R.',
  'a manager sees a colleague''s name on the document they verified');

select set_config('request.jwt.claims', json_build_object('sub', '66666666-6666-6666-6666-666666666666', 'role', 'authenticated')::text, true);
select is((select reviewed_by_name from staff_documents_v where id = :'doc_a'), 'Tom R.',
  'and the verifier sees their own');
reset role;

select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select reviewed_by_name from staff_documents_v where id = :'doc_a'), null,
  'a worker reading their own document is not told which manager verified it');
reset role;

select is((select reviewed_by_name from staff_documents_v where id = :'doc_b'), null,
  'a document nobody verified by hand carries no name');

select * from finish();
rollback;
