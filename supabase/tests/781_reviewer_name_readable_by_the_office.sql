-- =====================================================================
-- 781 · "Verified by <name>" reaches every office reader, not only the
--       reviewer themselves; profiles stays closed
--   20261008110000_reviewer_name_readable_by_the_office.sql
-- =====================================================================
begin;
select plan(17);
\ir _shared/fixtures.psql

\set admin2_uid 'c7790000-0000-4000-8000-000000000001'
\set doc_hand   'c7790000-0000-4000-8000-0000000000d1'
\set doc_auto   'c7790000-0000-4000-8000-0000000000d2'
\set doc_open   'c7790000-0000-4000-8000-0000000000d3'
\set decl_yes   'c7790000-0000-4000-8000-0000000000e1'

insert into auth.users (id, email) values (:'admin2_uid', 'second@779.test');
insert into profiles (id, role, full_name) values (:'admin2_uid', 'admin', 'Second Reviewer');

insert into compliance_docs (id, staff_id, doc_type, review_status, uploaded_at, reviewed_at, reviewed_by) values
  (:'doc_hand', :'staffa', 'birth_certificate',          'verified', now() - interval '2 hours', now() - interval '1 hour', :'admin2_uid'),
  (:'doc_auto', :'staffa', 'share_code_report', 'verified', now() - interval '2 hours', now() - interval '1 hour', null),
  (:'doc_open', :'staffa', 'national_id',  'pending',  now(), null, null);
insert into criminal_declarations (id, staff_id, source, answer, review_status, reviewed_at, reviewed_by) values
  (:'decl_yes', :'staffa', 'in_employment', true, 'verified', now() - interval '1 hour', :'admin2_uid');

select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;

select is((select reviewed_by_name from staff_documents_v where id = :'doc_hand'), 'Second Reviewer',
  'an admin reads the name of a DIFFERENT admin who verified the document');
select is((select reviewed_by_name from staff_documents_v where id = :'doc_auto'), 'Automatic gov.uk check',
  'a share code the automated check verified says so');
select is((select reviewed_by_name from staff_documents_v where id = :'doc_open'), null,
  'a document nobody has reviewed carries no name');
select is((select reviewed_by_name from staff_declarations_v where id = :'decl_yes'), 'Second Reviewer',
  'the declaration view names the admin who verified a Yes');
select is((select reviewed_by_name from staff_declarations_v where id = :'decl_a'), null,
  'a declaration nobody reviewed carries no name');
select is((select count(*)::int from staff_declarations_v where staff_id = :'staffa'),
          (select count(*)::int from criminal_declarations where staff_id = :'staffa'),
  'and the view returns every declaration row the admin could already read');
select is((select count(*)::int from pg_attribute where attrelid = 'public.staff_declarations_v'::regclass
            and attname = 'reviewed_by' and not attisdropped), 0,
  'the reviewer''s uuid is never exposed, only the name');
select is((select count(*)::int from profiles where id = :'admin2_uid'), 0,
  'and profiles stays closed: the admin still cannot read another account''s row');
select is(reviewer_name(:'admin2_uid'), 'Second Reviewer', 'the lookup returns the one column, for a Back Office account, to an admin session');
select is(reviewer_name(:'staffa_uid'), null, 'but not a worker''s name, even to an admin');
select is(reviewer_name(:'clienta_uid'), null, 'nor a client login''s');
select ok(has_table_privilege('authenticated', 'public.staff_declarations_v', 'select'), 'the declarations view is readable');
select ok(not has_table_privilege('authenticated', 'public.staff_declarations_v', 'insert')
      and not has_table_privilege('authenticated', 'public.staff_declarations_v', 'update')
      and not has_table_privilege('authenticated', 'public.staff_declarations_v', 'delete'), 'and read-only');
select ok(not has_table_privilege('anon', 'public.staff_declarations_v', 'select'), 'and closed to anon');

select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
select is(reviewer_name(:'admin2_uid'), null, 'a worker session gets nothing from it');
select is((select count(*)::int from staff_declarations_v), 0, 'and no declaration rows from the view (admin_all is the only policy)');

reset role;
set local role anon;
select throws_ok($$ select reviewer_name('c7790000-0000-4000-8000-000000000001') $$, '42501', null,
  'anon cannot call it at all');
reset role;

select * from finish();
rollback;
