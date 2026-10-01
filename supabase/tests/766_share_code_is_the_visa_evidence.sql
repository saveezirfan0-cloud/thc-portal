-- =====================================================================
-- 766 · The share-code check is the visa evidence (20261002106000,
--       ADR-0078 — THC, 01.10.2026, a change from scope §2.5)
--
--   1. step 1: no typed visa / status expiry in any branch; the work
--      visa's visa type is still required;
--   2. step 4: a work visa or dependant / other worker uploads the
--      passport only — visa_document and status_document are refused by
--      the wizard, and Submit goes through without them. The UK
--      birth-certificate route keeps its NI evidence (List A, ADR-0065);
--   3. "documents missing" (the board, the candidate profile, the quiz
--      gate, the Staff App Documents hub) never names a visa or status
--      document for any branch;
--   4. the migration's one-off: an in-wizard candidate's pending or
--      rejected visa / status document (and NI evidence off the
--      birth-certificate route) is superseded — kept, never deleted — so
--      a rejected one no longer holds the quiz gate shut; verified rows,
--      the birth-certificate route's NI evidence and workers past the
--      documents stage are not touched.
--
-- Every row is created inside the transaction and rolled back.
-- =====================================================================
begin;
select plan(37);

\set wv      '76510000-0000-4000-8000-000000000001'
\set dp      '76510000-0000-4000-8000-000000000002'
\set uk      '76510000-0000-4000-8000-000000000003'
\set legacy  '76510000-0000-4000-8000-000000000004'
\set ukpass  '76510000-0000-4000-8000-000000000005'
\set ukbc    '76510000-0000-4000-8000-000000000006'
\set working '76510000-0000-4000-8000-000000000007'
\set wv_uid  '76520000-0000-4000-8000-000000000001'
\set dp_uid  '76520000-0000-4000-8000-000000000002'
\set uk_uid  '76520000-0000-4000-8000-000000000003'
\set lg_uid  '76520000-0000-4000-8000-000000000004'
\set lg_visa '76530000-0000-4000-8000-000000000001'
\set up_ni   '76530000-0000-4000-8000-000000000002'
\set bc_ni   '76530000-0000-4000-8000-000000000003'
\set wk_visa '76530000-0000-4000-8000-000000000004'

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
  (:'wv',      :'wv_uid', 'Lukas', 'Meyer', 'lukas@share-code.test', '+447700900651', date '1997-06-08', 'documents'),
  (:'dp',      :'dp_uid', 'Dana',  'Osei',  'dana@share-code.test',  '+447700900652', date '1995-02-14', 'documents'),
  (:'uk',      :'uk_uid', 'Tom',   'Reid',  'tom@share-code.test',   '+447700900653', date '1994-01-09', 'documents'),
  (:'legacy',  :'lg_uid', 'Lena',  'Novak', 'lena@share-code.test',  '+447700900654', date '1996-05-01', 'documents'),
  (:'ukpass',  null,      'Ugo',   'Park',  'ugo@share-code.test',   '+447700900655', date '1993-03-03', 'documents'),
  (:'ukbc',    null,      'Bea',   'Cole',  'bea@share-code.test',   '+447700900656', date '1992-04-04', 'documents'),
  (:'working', null,      'Wim',   'Kok',   'wim@share-code.test',   '+447700900657', date '1991-05-05', 'quiz');

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
  'P0001', 'visa_type_required', 'the work visa still needs its visa type (§2.5 pt 3, kept by ADR-0078)');
select lives_ok(
  $$ select onboarding_save_right_to_work('work_visa', date '1997-06-08', 'W123AB4CD', 'Skilled Worker', null, null, false) $$,
  'with the visa type and no expiry, step 1 is done (ADR-0078)');
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
  'dependant / other: no expiry asked for (ADR-0078)');

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
            ('uk_irish', 'birth_certificate,ni_evidence'),
            ('work_visa', 'passport') $$,
  'each branch''s step 4 set: no visa or status document anywhere; NI evidence beside a birth certificate only');

select results_eq(
  $$ select req_key from onboarding_required_docs('uk_irish', 'passport') $$,
  $$ values ('passport') $$,
  'the UK passport route is unchanged');

-- Tom, UK birth certificate: List A's pair, unchanged.
select lives_ok(
  format($$ select onboarding_attach_document('birth_certificate', %L, 'birth.jpg', 200000, 'image/jpeg') $$,
         :'uk' || '/birth_certificate/1.jpg'),
  'the birth certificate is uploaded');
select is(onboarding_documents_missing(:'uk'), array['ni_evidence', 'criminal_declaration'],
  'and the NI document is still owed beside it (List A, ADR-0065)');
select lives_ok(
  format($$ select onboarding_attach_document('ni_evidence', %L, 'p60.jpg', 200000, 'image/jpeg') $$,
         :'uk' || '/ni_evidence/1.jpg'),
  'the NI evidence is uploaded on that route');
select is(onboarding_documents_missing(:'uk'), array['criminal_declaration'],
  'with both in, only the declaration is outstanding');

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
-- 3 · The one-off for candidates already in the wizard
-- =====================================================================
reset role;
set local "request.jwt.claims" = '';

-- Lena: work visa, everything verified but the visa she uploaded before
-- the change, which the office rejected. The wizard no longer offers its
-- re-upload, so without the one-off she would be stuck.
update staff set rtw_branch = 'work_visa', share_code = 'W111AA2BB' where id = :'legacy';
insert into compliance_docs (id, staff_id, doc_type, file_path, review_status, right_to_work_until,
                             rejection_reason) values
  (gen_random_uuid(), :'legacy', 'passport', :'legacy' || '/passport/1.jpg', 'verified', null, null),
  (gen_random_uuid(), :'legacy', 'share_code_report', null, 'verified', date '2028-03-31', null),
  (:'lg_visa', :'legacy', 'visa_document', :'legacy' || '/visa_document/1.pdf', 'rejected', null,
   'Photo blurred — please re-upload');
insert into criminal_declarations (staff_id, source, answer) values (:'legacy', 'onboarding', false);

-- Ugo: UK passport route with a stray pending NI evidence. Bea: UK
-- birth-certificate route, whose pending NI evidence is List A's half.
update staff set rtw_branch = 'uk_irish' where id in (:'ukpass', :'ukbc');
insert into onboarding_progress (staff_id, uk_doc_choice) values
  (:'ukpass', 'passport'), (:'ukbc', 'birth_certificate');
insert into compliance_docs (id, staff_id, doc_type, file_path, review_status) values
  (:'up_ni', :'ukpass', 'ni_evidence', :'ukpass' || '/ni_evidence/1.jpg', 'pending'),
  (:'bc_ni', :'ukbc',   'ni_evidence', :'ukbc'   || '/ni_evidence/1.jpg', 'pending');

-- Wim: past the documents stage (Quiz), with a pending visa in review.
update staff set rtw_branch = 'work_visa', share_code = 'W222CC3DD' where id = :'working';
insert into compliance_docs (id, staff_id, doc_type, file_path, review_status) values
  (:'wk_visa', :'working', 'visa_document', :'working' || '/visa_document/1.pdf', 'pending');

select ok('document_unverified:visa_document' = any (onboarding_quiz_blockers(:'legacy')),
  'before: Lena''s rejected visa holds the quiz gate shut');
select is((select status::text from staff where id = :'legacy'), 'documents',
  'and she is stuck in Documents');

-- Run the migration's one-off again, now against these rows. Rolled back.
select is(onboarding_supersede_legacy_rtw_docs(), 2,
  'the one-off supersedes Lena''s rejected visa and Ugo''s stray NI evidence');

select is((select review_status::text from compliance_docs where id = :'lg_visa'), 'superseded',
  'after: her rejected visa is superseded');
select is(
  (select count(*)::int from compliance_docs where staff_id = :'legacy' and doc_type = 'visa_document'),
  1, 'kept, not deleted');
select is(onboarding_quiz_blockers(:'legacy'), '{}'::text[],
  'and it no longer blocks the quiz gate');
select is((select status::text from staff where id = :'legacy'), 'quiz',
  'so she moves to Quiz by herself, as a Verify would have moved her (§2.3)');
select is(
  (select count(*)::int from notification_outbox where template = 'E12' and recipient_staff_id = :'legacy'),
  1, 'with the "documents approved" email (ADR-0075)');
select is((select review_status::text from compliance_docs where id = :'up_ni'), 'superseded',
  'a stray NI evidence on the UK passport route is superseded');
select is((select review_status::text from compliance_docs where id = :'bc_ni'), 'pending',
  'the birth-certificate route''s NI evidence is List A''s half and is not touched');
select is((select review_status::text from compliance_docs where id = :'wk_visa'), 'pending',
  'a worker past the documents stage keeps a pending visa in review');
select is(
  (select review_status::text from compliance_docs
    where staff_id = :'legacy' and doc_type = 'passport'),
  'verified', 'verified rows are never touched');
select is(onboarding_documents_missing(:'legacy'), '{}'::text[],
  'and a work visa candidate is not missing a visa');
select ok(
  enum_range(null::doc_type) @> array['visa_document', 'status_document', 'ni_evidence']::doc_type[],
  'the document types stay in the schema for the rows on file');
select is(
  (select count(*)::int from compliance_docs where id in (:'lg_visa', :'up_ni', :'bc_ni', :'wk_visa')),
  4, 'nothing was deleted');

select * from finish();
rollback;
