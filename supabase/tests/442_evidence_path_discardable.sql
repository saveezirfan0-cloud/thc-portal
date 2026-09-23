-- =====================================================================
-- 442 · Only a fresh, unreferenced upload may be discarded
--   20260923193000_evidence_path_discardable.sql
-- =====================================================================
begin;
select plan(8);
\ir _shared/fixtures.psql

\set w '44200000-0000-4000-8000-000000000001'
insert into staff (id, first_name, last_name, email, phone, dob, status, rtw_branch)
values (:'w', 'Eve', 'Idence', 'eve@discard.test', '+447700944201', date '1995-01-01', 'compliant', 'uk_irish');

insert into storage.objects (bucket_id, name, created_at) values
  ('documents', :'w' || '/passport/verified.pdf', now() - interval '10 minutes'),
  ('documents', :'w' || '/passport/fresh.pdf',    now() - interval '2 minutes'),
  ('documents', :'w' || '/passport/old.pdf',      now() - interval '3 hours'),
  ('documents', :'w' || '/wtr-optout/copy.pdf',   now() - interval '5 minutes');
insert into compliance_docs (staff_id, doc_type, file_path, review_status)
values (:'w', 'passport', :'w' || '/passport/verified.pdf', 'verified');
update staff set wtr_optout_copy_path = :'w' || '/wtr-optout/copy.pdf' where id = :'w';

select ok(evidence_path_discardable(:'w', :'w' || '/passport/fresh.pdf'),
  'a fresh upload nothing points at may be discarded');
select ok(not evidence_path_discardable(:'w', :'w' || '/passport/verified.pdf'),
  'a document a compliance_docs row references never is — however recent');
select ok(not evidence_path_discardable(:'w', :'w' || '/wtr-optout/copy.pdf'),
  'nor the signed opt-out copy');
select ok(not evidence_path_discardable(:'w', :'w' || '/passport/old.pdf'),
  'nor anything older than an upload slot, referenced or not');
select ok(not evidence_path_discardable(gen_random_uuid(), :'w' || '/passport/fresh.pdf'),
  'nor another worker''s file');
select ok(not evidence_path_discardable(:'w', :'w' || '/../x/passport/fresh.pdf'),
  'nor a path that climbs out of the folder');
select ok(not has_function_privilege('authenticated', 'evidence_path_discardable(uuid, text)', 'execute'),
  'workers cannot probe which paths are referenced');
select ok(not has_function_privilege('anon', 'evidence_path_discardable(uuid, text)', 'execute'),
  'nor can anon');

select * from finish();
rollback;
