-- =====================================================================
-- 765 · The share-code check is the visa evidence (20261002105000,
--       ADR-0077 — THC, 01.10.2026, a change from scope §2.5)
--
--   1. step 1: no typed visa / status expiry in any branch; the work
--      visa's visa type is still required;
--   2. step 4: a work visa or dependant / other worker uploads the
--      passport only, and a UK birth-certificate worker the birth
--      certificate only — visa_document, status_document and ni_evidence
--      are refused by the wizard, and Submit goes through without them;
--   3. "documents missing" (the board, the candidate profile, the quiz
--      gate, the Staff App Documents hub) never names them for any
--      branch;
--   4. rows already on file are kept: a pending visa document uploaded
--      before the change is still in review, and the types still exist.
--
-- Every row is created inside the transaction and rolled back.
-- =====================================================================
begin;
select plan(25);

\set wv      '76510000-0000-4000-8000-000000000001'
\set dp      '76510000-0000-4000-8000-000000000002'
\set uk      '76510000-0000-4000-8000-000000000003'
\set legacy  '76510000-0000-4000-8000-000000000004'
\set wv_uid  '76520000-0000-4000-8000-000000000001'
\set dp_uid  '76520000-0000-4000-8000-000000000002'
\set uk_uid  '76520000-0000-4000-8000-000000000003'
\set lg_uid  '76520000-0000-4000-8000-000000000004'

insert into auth.users (id, email) values
  (:'wv_uid', 'lukas@share-code.test'),
  (:'dp_uid', 'dana@share-code.test'),
  (:'uk_uid', 'tom@share-code.test'),
  (:'lg_uid', 'lena@share-code.test');

insert into profiles (id, role, full_name) values
  (:'wv_uid', 'staff', 'Lukas Meyer'),
  (:'dp_uid', 'staff', 'Dana Osei'),
  (:'uk_uid', 'staff', 'Tom Reid'),
  (:'lg_uid', 'staff', 'Lena Novak');

insert into staff (id, user_id, first_name, last_name, email, phone, dob, status) values
  (:'wv',     :'wv_uid', 'Lukas', 'Meyer', 'lukas@share-code.test', '+447700900651', date '1997-06-08', 'documents'),
  (:'dp',     :'dp_uid', 'Dana',  'Osei',  'dana@share-code.test',  '+447700900652', date '1995-02-14', 'documents'),
  (:'uk',     :'uk_uid', 'Tom',   'Reid',  'tom@share-code.test',   '+447700900653', date '1994-01-09', 'documents'),
  (:'legacy', :'lg_uid', 'Lena',  'Novak', 'lena@share-code.test',  '+447700900654', date '1996-05-01', 'documents');

-- The objects as Storage records them once the Staff App has uploaded them.
insert into storage.objects (bucket_id, name, metadata) values
  ('documents', :'wv' || '/passport/1.jpg',            '{"mimetype":"image/jpeg","size":200000}'),
  ('documents', :'wv' || '/visa_document/1.pdf',       '{"mimetype":"application/pdf","size":200000}'),
  ('documents', :'dp' || '/status_document/1.pdf',     '{"mimetype":"application/pdf","size":200000}'),
  ('documents', :'uk' || '/birth_certificate/1.jpg',   '{"mimetype":"image/jpeg","size":200000}'),
  ('documents', :'uk' || '/ni_evidence/1.jpg',         '{"mimetype":"image/jpeg","size":200000}');

-- =====================================================================
-- 1 · Step 1 — no typed expiry; the visa type stays
-- =====================================================================
set local "request.jwt.claims" = '{"sub":"76520000-0000-4000-8000-000000000001","role":"authenticated"}';

select throws_ok(
  $$ select onboarding_save_right_to_work('work_visa', date '1997-06-08', 'W123AB4CD', null, null, null, false) $$,
  'P0001', 'visa_type_required', 'the work visa still needs its visa type (§2.5 pt 3, kept by ADR-0077)');
select lives_ok(
  $$ select onboarding_save_right_to_work('work_visa', date '1997-06-08', 'W123AB4CD', 'Skilled Worker', null, null, false) $$,
  'with the visa type and no expiry, step 1 is done (ADR-0077)');
select lives_ok(
  $$ select onboarding_save_right_to_work('work_visa', date '1997-06-08', 'W123AB4CD', 'Graduate', date '2028-03-31', null, false) $$,
  'an expiry sent by an older app is accepted and ignored');
select results_eq(
  format($$ select visa_type, visa_expiry from onboarding_progress where staff_id = %L $$, :'wv'),
  $$ values ('Graduate'::text, null::date) $$,
  'the visa type is stored, the expiry is not — the gov.uk check supplies it');
select is((select share_code from staff where id = :'wv'), 'W123AB4CD',
  'the share code is still required and stored');

set local "request.jwt.claims" = '{"sub":"76520000-0000-4000-8000-000000000002","role":"authenticated"}';
select lives_ok(
  $$ select onboarding_save_right_to_work('dependant_other', date '1995-02-14', 'W987ZY6XW', null, null, null, false) $$,
  'dependant / other: no expiry asked for (ADR-0077)');

set local "request.jwt.claims" = '{"sub":"76520000-0000-4000-8000-000000000003","role":"authenticated"}';
select lives_ok(
  $$ select onboarding_save_right_to_work('uk_irish', date '1994-01-09', null, null, null, 'birth_certificate', false) $$,
  'UK / Irish choosing the birth certificate');

-- =====================================================================
-- 2 · Step 4 — the sets per branch
-- =====================================================================
select results_eq(
  $$ select b::text, string_agg(r.req_key, ',' order by r.req_key)
       from unnest(enum_range(null::rtw_branch)) b
       cross join lateral onboarding_required_docs(b, case when b = 'uk_irish' then 'birth_certificate' end) r
      group by b order by b::text $$,
  $$ values ('dependant_other', 'passport'),
            ('eu_settled', 'identity'),
            ('international_student', 'passport,university_term_dates_letter'),
            ('uk_irish', 'birth_certificate'),
            ('work_visa', 'passport') $$,
  'each branch''s step 4 set: no visa, status document or NI evidence anywhere');

select results_eq(
  $$ select req_key from onboarding_required_docs('uk_irish', 'passport') $$,
  $$ values ('passport') $$,
  'the UK passport route is unchanged');

-- Tom, UK birth certificate.
select throws_ok(
  format($$ select onboarding_attach_document('ni_evidence', %L, 'p60.jpg', 200000, 'image/jpeg') $$,
         :'uk' || '/ni_evidence/1.jpg'),
  'P0001', 'doc_not_for_branch', 'NI evidence is no longer uploaded beside a birth certificate');
select lives_ok(
  format($$ select onboarding_attach_document('birth_certificate', %L, 'birth.jpg', 200000, 'image/jpeg') $$,
         :'uk' || '/birth_certificate/1.jpg'),
  'the birth certificate is');
select is(onboarding_documents_missing(:'uk'), array['criminal_declaration'],
  'with the birth certificate in, only the declaration is outstanding — no NI evidence');

-- Dana, dependant / other.
set local "request.jwt.claims" = '{"sub":"76520000-0000-4000-8000-000000000002","role":"authenticated"}';
select throws_ok(
  format($$ select onboarding_attach_document('status_document', %L, 'brp.pdf', 200000, 'application/pdf') $$,
         :'dp' || '/status_document/1.pdf'),
  'P0001', 'doc_not_for_branch', 'a dependant / other worker uploads no status document');
select is(onboarding_documents_missing(:'dp'), array['passport', 'criminal_declaration'],
  'and is missing the passport and the declaration only');

-- Lukas, work visa.
set local "request.jwt.claims" = '{"sub":"76520000-0000-4000-8000-000000000001","role":"authenticated"}';
select throws_ok(
  format($$ select onboarding_attach_document('visa_document', %L, 'visa.pdf', 200000, 'application/pdf') $$,
         :'wv' || '/visa_document/1.pdf'),
  'P0001', 'doc_not_for_branch', 'a work visa worker uploads no visa');
select lives_ok(
  format($$ select onboarding_attach_document('passport', %L, 'passport.jpg', 200000, 'image/jpeg') $$,
         :'wv' || '/passport/1.jpg'),
  'the passport is');
select is(onboarding_documents_missing(:'wv'), array['criminal_declaration'],
  'passport + share code: nothing but the declaration is missing');

update onboarding_progress set address_at = now(), selfie_at = now() where staff_id = :'wv';
select lives_ok($$ select onboarding_submit_documents(false, null, null) $$,
  'Submit goes through with the passport alone — no missing_document:visa_document');
select is(onboarding_documents_missing(:'wv'), '{}'::text[],
  'and nothing is missing afterwards');
select is(
  (select count(*)::int from compliance_docs
    where staff_id = :'wv' and doc_type = 'share_code_report' and review_status = 'pending'),
  1, 'the share code goes to the gov.uk check, unchanged — it is the right-to-work evidence');
select is(
  (select array_agg(distinct x order by x) from unnest(onboarding_quiz_blockers(:'wv')) x),
  array['document_unverified:passport', 'document_unverified:share_code_report'],
  'the quiz waits on the passport and the share code — never on a visa');

-- =====================================================================
-- 3 · Rows already on file are kept and still reviewed
-- =====================================================================
reset role;
update staff set rtw_branch = 'work_visa', share_code = 'W111AA2BB' where id = :'legacy';
insert into criminal_declarations (staff_id, source, answer) values (:'legacy', 'onboarding', false);
insert into compliance_docs (staff_id, doc_type, file_path, review_status) values
  (:'legacy', 'passport',      :'legacy' || '/passport/1.jpg',      'pending'),
  (:'legacy', 'visa_document', :'legacy' || '/visa_document/1.pdf', 'pending');

select is(onboarding_documents_missing(:'legacy'), '{}'::text[],
  'a worker who uploaded a visa before the change is not missing anything');
select ok('document_unverified:visa_document' = any (onboarding_quiz_blockers(:'legacy')),
  'and the visa they already uploaded is still in review, not dropped');
select is(
  (select count(*)::int from compliance_docs where staff_id = :'legacy' and doc_type = 'visa_document'),
  1, 'the row is kept');
select ok(
  enum_range(null::doc_type) @> array['visa_document', 'status_document', 'ni_evidence']::doc_type[],
  'and the three document types stay in the schema for the rows on file');

select * from finish();
rollback;
