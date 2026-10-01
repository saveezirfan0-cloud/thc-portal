-- =====================================================================
-- 765 · The share code covers the visa; UK / Irish is passport only
--       — 20261002105000 (ADR-0077; §2.5 pts 1, 3, 5, 7)
--
-- What this file holds the database to:
--
--   · the document sets: UK / Irish, Work visa and Dependant / other
--     upload a passport and nothing else; no branch takes a visa or
--     status document, a birth certificate or NI evidence at onboarding;
--   · step 1 asks for no visa type, expiry or document choice, and
--     stores none;
--   · a UK / Irish worker who supplied a birth certificate + NI evidence
--     before the change is not suddenly missing a passport;
--   · a candidate part-way through step 4 is moved onto the new set.
--
-- Every row is created inside the transaction and rolled back.
-- =====================================================================
begin;
select plan(14);

\set wv      'c7650000-0000-4000-8000-000000000001'
\set uk      'c7650000-0000-4000-8000-000000000002'
\set wv_uid  'c7651000-0000-4000-8000-000000000001'
\set uk_uid  'c7651000-0000-4000-8000-000000000002'

insert into auth.users (id, email) values
  (:'wv_uid', 'wv@share-code.test'),
  (:'uk_uid', 'uk@share-code.test');

insert into profiles (id, role, full_name, client_id) values
  (:'wv_uid', 'staff', 'Wen Visa', null),
  (:'uk_uid', 'staff', 'Una Kerr', null);

insert into staff (id, user_id, first_name, last_name, email, phone, dob, status) values
  (:'wv', :'wv_uid', 'Wen', 'Visa', 'wv@share-code.test', '+447700907651',
   date '1996-05-05', 'documents'),
  (:'uk', :'uk_uid', 'Una', 'Kerr', 'uk@share-code.test', '+447700907652',
   date '1990-02-02', 'documents');

insert into storage.objects (bucket_id, name, metadata) values
  ('documents', :'wv' || '/visa_document/1.pdf', '{"mimetype":"application/pdf","size":50000}'),
  ('documents', :'wv' || '/passport/1.pdf',      '{"mimetype":"application/pdf","size":50000}');

-- =====================================================================
-- 1. The sets
-- =====================================================================
select is(
  (select array_agg(req_key || ':' || accepts::text order by req_key)
     from onboarding_required_docs('uk_irish', 'birth_certificate')),
  array['passport:{passport}'],
  'UK / Irish: passport only, whatever choice is passed');
select is(
  (select array_agg(req_key || ':' || accepts::text order by req_key)
     from onboarding_required_docs('work_visa', null)),
  array['passport:{passport}'],
  'Work visa: passport only — the share code covers the visa');
select is(
  (select array_agg(req_key || ':' || accepts::text order by req_key)
     from onboarding_required_docs('dependant_other', null)),
  array['passport:{passport}'],
  'Dependant / other: passport only — the share code covers the status');
select ok(
  not exists (
    select 1
      from unnest(enum_range(null::rtw_branch)) b,
           unnest(onboarding_accepted_docs(b, 'birth_certificate')) t
     where t in ('visa_document', 'status_document', 'birth_certificate', 'ni_evidence')),
  'no branch accepts a visa or status document, a birth certificate or NI evidence');

-- =====================================================================
-- 2. Step 1 — nothing about the visa
-- =====================================================================
set local "request.jwt.claims" = '{"sub":"c7651000-0000-4000-8000-000000000001","role":"authenticated"}';

select lives_ok(
  $$ select onboarding_save_right_to_work('work_visa', date '1996-05-05', 'W765AB1CD', null, null, null, false) $$,
  'a work visa saves step 1 with no visa type and no expiry');
select ok(
  (select visa_type is null and visa_expiry is null and uk_doc_choice is null
     from onboarding_progress where staff_id = :'wv'),
  'and none is stored');
select lives_ok(
  $$ select onboarding_save_right_to_work('work_visa', date '1996-05-05', 'W765AB1CD', 'Skilled Worker', date '2028-03-31', null, false) $$,
  'an old client that still sends them is not refused');
select ok(
  (select visa_type is null and visa_expiry is null from onboarding_progress where staff_id = :'wv'),
  'but what it sent is not kept');

select throws_ok(
  format($$ select onboarding_attach_document('visa_document', %L, 'visa.pdf', 50000, 'application/pdf') $$,
         :'wv' || '/visa_document/1.pdf'),
  'P0001', 'doc_not_for_branch', 'a work visa uploads no visa document');
select lives_ok(
  format($$ select onboarding_attach_document('passport', %L, 'passport.pdf', 50000, 'application/pdf') $$,
         :'wv' || '/passport/1.pdf'),
  'the passport is the upload');
select ok(
  not ('visa_document' = any(onboarding_documents_missing(:'wv')))
  and not ('passport' = any(onboarding_documents_missing(:'wv'))),
  'and nothing on the document list is missing for it');

-- =====================================================================
-- 3. Before the change: a UK / Irish birth certificate + NI evidence
-- =====================================================================
reset role;
set local "request.jwt.claims" = '{}';

update staff set rtw_branch = 'uk_irish' where id = :'uk';
insert into onboarding_progress (staff_id, uk_doc_choice, rtw_at, updated_at)
values (:'uk', 'birth_certificate', now(), now());
insert into compliance_docs (staff_id, doc_type, review_status, file_path, uploaded_at) values
  (:'uk', 'birth_certificate', 'verified', :'uk' || '/birth_certificate/b.pdf', now()),
  (:'uk', 'ni_evidence',       'verified', :'uk' || '/ni_evidence/n.pdf',       now());

select ok(
  not ('passport' = any(onboarding_documents_missing(:'uk'))),
  'a UK / Irish worker who supplied a birth certificate + NI evidence is not asked for a passport');

delete from compliance_docs where staff_id = :'uk' and doc_type = 'ni_evidence';
select ok(
  'passport' = any(onboarding_documents_missing(:'uk')),
  'a birth certificate alone was never enough, and is not now — the passport is what is missing');

-- =====================================================================
-- 4. The migration moved part-way candidates onto the new set
-- =====================================================================
select is_empty(
  $$ select 1 from onboarding_progress
      where uk_doc_choice = 'birth_certificate' and documents_at is null
        and staff_id not in ('c7650000-0000-4000-8000-000000000002') $$,
  'no unsubmitted candidate is left on the birth-certificate choice');

select * from finish();
rollback;
