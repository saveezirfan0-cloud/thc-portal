-- =====================================================================
-- 782 · the Compliance Radar says who verified each document, and still
--       lists exactly the documents it did
--   20261008160000_radar_names_the_verifier.sql
-- =====================================================================
begin;
select plan(6);
\ir _shared/fixtures.psql

\set admin2_uid 'c7820000-0000-4000-8000-000000000001'
\set doc_hand   'c7820000-0000-4000-8000-0000000000d1'
\set doc_auto   'c7820000-0000-4000-8000-0000000000d2'

insert into auth.users (id, email) values (:'admin2_uid', 'second@782.test');
insert into profiles (id, role, full_name) values (:'admin2_uid', 'admin', 'Second Reviewer');

-- staffa is compliant in the fixtures; two dated, verified documents on them.
insert into compliance_docs (id, staff_id, doc_type, review_status, expiry_date, uploaded_at, reviewed_at, reviewed_by) values
  (:'doc_hand', :'staffa', 'visa_document',    'verified', current_date + 200, now() - interval '2 hours', now() - interval '1 hour', :'admin2_uid'),
  (:'doc_auto', :'staffa', 'share_code_report', 'verified', current_date + 300, now() - interval '2 hours', now() - interval '1 hour', null);

select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;

select is((select reviewed_by_name from compliance_radar_v where doc_id = :'doc_hand'), 'Second Reviewer',
  'the Radar names the admin who verified the document, to a different admin');
select ok((select reviewed_at from compliance_radar_v where doc_id = :'doc_hand') is not null,
  'and when');
select is((select reviewed_by_name from compliance_radar_v where doc_id = :'doc_auto'), 'Automatic gov.uk check',
  'a share code the automated check verified says so');
select is((select count(*)::int from compliance_radar_v where doc_id in (:'doc_hand', :'doc_auto')), 2,
  'both documents are still on the Radar, once each (the join adds and drops no rows)');
select is((select count(*)::int from compliance_radar_v
            where doc_id in (:'doc_hand', :'doc_auto') and reviewed_at is null), 0,
  'both carry the time they were verified (older seed documents verified with no time simply show no stamp)');

set local role anon;
select throws_ok($$ select * from compliance_radar_v $$, '42501', null, 'anon still cannot read the Radar');
reset role;

select * from finish();
rollback;
