-- =====================================================================
-- 911 · The Home Office check branch in the wizard — ADR-0182,
--       20261022190000 + 20261022190100 (THC, 21.10.2026, an addition to
--       scope §2.5)
--
--   1. the reference: what is accepted (packages/domain homeOfficeRef.ts
--      holds the same pattern);
--   2. step 1: no share code; the Home Office reference is required,
--      checked and stored where no API role can read it; it follows the
--      branch;
--   3. step 4: nothing to upload; submit files a pending result row for
--      the office, carrying the reference, and no share-code report;
--   4. the quiz gate stays shut until the office has attached the result
--      and verified it with a date, then opens — no share-code blocker;
--   5. the cap is a non-student's and canRoster stops at the date (and
--      without one);
--   6. a result the office attached before the candidate submitted is kept:
--      re-saving step 1 on the same branch and submitting add no empty row.
--
-- Every row is created inside the transaction and rolled back.
-- =====================================================================
begin;
select plan(57);
\ir _shared/fixtures.psql

\set amira     '91110000-0000-4000-8000-000000000001'
\set amira_uid '91120000-0000-4000-8000-000000000001'
\set kofi      '91110000-0000-4000-8000-000000000002'
\set kofi_uid  '91120000-0000-4000-8000-000000000002'
\set worker    '91110000-0000-4000-8000-000000000003'
\set nadia     '91110000-0000-4000-8000-000000000004'
\set nadia_uid '91120000-0000-4000-8000-000000000004'

insert into auth.users (id, email) values
  (:'amira_uid', 'amira@home-office.test'),
  (:'kofi_uid',  'kofi@home-office.test'),
  (:'nadia_uid', 'nadia@home-office.test');
insert into profiles (id, role, full_name) values
  (:'amira_uid', 'staff', 'Amira Haddad'),
  (:'kofi_uid',  'staff', 'Kofi Mensah'),
  (:'nadia_uid', 'staff', 'Nadia Yusuf');

insert into staff (id, user_id, first_name, last_name, email, phone, dob, status) values
  (:'amira', :'amira_uid', 'Amira', 'Haddad', 'amira@home-office.test', '+447700991101', date '1996-03-12', 'documents'),
  (:'kofi',  :'kofi_uid',  'Kofi',  'Mensah', 'kofi@home-office.test',  '+447700991102', date '1993-07-21', 'documents'),
  (:'nadia', :'nadia_uid', 'Nadia', 'Yusuf',  'nadia@home-office.test', '+447700991104', date '1998-11-02', 'documents');

insert into staff (id, employee_id, first_name, last_name, email, phone, dob, status, rtw_branch,
                   right_to_work_until) values
  (:'worker', 91103, 'Hana', 'Rahimi', 'hana@home-office.test', '+447700991103', date '1990-01-01',
   'compliant', 'home_office_check', null);

insert into storage.objects (bucket_id, name, metadata) values
  ('documents', :'amira' || '/home-office-check-result/ecs.pdf', '{"mimetype":"application/pdf","size":180000}'),
  ('documents', :'amira' || '/passport/1.jpg',                   '{"mimetype":"image/jpeg","size":200000}'),
  ('documents', :'nadia' || '/home-office-check-result/early.pdf', '{"mimetype":"application/pdf","size":180000}');

-- =====================================================================
-- 1 · The reference
-- =====================================================================
select is(normalise_home_office_ref('  abc 123456 '), 'ABC 123456',
  'trimmed, upper case');
select is(normalise_home_office_ref('u1234567 /  001'), 'U1234567 / 001',
  'inner runs of spaces collapse to one');
select ok(is_valid_home_office_ref('ABC123456'), 'an Application Registration Card number');
select ok(is_valid_home_office_ref('1234-5678-9012-3456'), 'a 16-digit application number with dashes');
select ok(is_valid_home_office_ref('u1234567/001'), 'a Home Office file reference, typed in lower case');
select ok(not is_valid_home_office_ref('ABCDEFGH'), 'no digit at all is not a reference');
select ok(not is_valid_home_office_ref('A123'), 'too short');
select ok(not is_valid_home_office_ref(repeat('A1', 16)), 'too long (over 30)');
select ok(not is_valid_home_office_ref('ABC#12345'), 'only letters, digits, spaces, / and -');
select ok(not is_valid_home_office_ref(null), 'blank is not a reference');
select is(normalise_home_office_ref(E'ABC\u00a0123456'), 'ABC 123456',
  'a no-break space pasted from a PDF is a space');
select ok(is_valid_home_office_ref(E'\u202fU1234567\u00a0/\u2009001\u3000'),
  'every Unicode space counts as one — as normaliseHomeOfficeRef() reads it');

-- =====================================================================
-- 2 · Step 1
-- =====================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"91120000-0000-4000-8000-000000000001","role":"authenticated"}';

select throws_ok(
  $$ select onboarding_save_right_to_work('home_office_check', date '1996-03-12', null, null, null, null, false) $$,
  'P0001', 'home_office_ref_required', 'the Home Office reference is required on this branch');
select throws_ok(
  $$ select onboarding_save_right_to_work('home_office_check', date '1996-03-12', null, null, null, null, false, 'ABC') $$,
  'P0001', 'bad_home_office_ref', 'and checked for shape before it is stored');
select is(
  onboarding_save_right_to_work('home_office_check', date '1996-03-12', 'W123AB4CD', null, null, null, true,
                                ' abc 123456 ') ->> 'homeOfficeRef',
  'ABC 123456', 'with a reference, step 1 is done — a share code sent by mistake is not asked for');
select is(onboarding_state() ->> 'homeOfficeRef', 'ABC 123456',
  'the worker''s own wizard reads their reference back (onboarding_state)');
select throws_ok($$ select home_office_ref from staff where id = '91110000-0000-4000-8000-000000000001' $$,
  '42501', null, 'but not from the table: no API role holds staff.home_office_ref (ADR-0163)');
select is((select count(*)::int from staff_identity_v), 0,
  'and staff_identity_v answers nobody but the office');
reset role;

select results_eq(
  format($$ select rtw_branch::text, home_office_ref, share_code, wtr_optout from staff where id = %L $$, :'amira'),
  $$ values ('home_office_check'::text, 'ABC 123456'::text, null::text, true) $$,
  'stored: the branch, the normalised reference, no share code; the 48-hour opt-out signs as on any branch');

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select is((select home_office_ref from staff_identity_v where staff_id = :'amira'), 'ABC 123456',
  'the office reads the reference through staff_identity_v');
reset role;

-- The reference belongs to the branch.
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"91120000-0000-4000-8000-000000000002","role":"authenticated"}';
select lives_ok(
  $$ select onboarding_save_right_to_work('home_office_check', date '1993-07-21', null, null, null, null, false, 'GWF012345678') $$,
  'Kofi picks the Home Office check');
select lives_ok(
  $$ select onboarding_save_right_to_work('eu_settled', date '1993-07-21', 'W987ZY6XW', null, null, null, false, 'GWF012345678') $$,
  'then changes his mind before step 4');
reset role;
select results_eq(
  format($$ select rtw_branch::text, home_office_ref, share_code from staff where id = %L $$, :'kofi'),
  $$ values ('eu_settled'::text, null::text, 'W987ZY6XW'::text) $$,
  'off the branch, the reference is not kept — the share code is');

-- =====================================================================
-- 3 · Step 4
-- =====================================================================
select is((select count(*)::int from onboarding_required_docs('home_office_check', null)), 0,
  'step 4 asks this branch for no upload — identity is the step 3 selfie, the evidence is the Home Office''s');
select is(onboarding_documents_missing(:'amira'), array['home_office_check_result', 'criminal_declaration'],
  'missing: the office''s result and the declaration — never a share code');

update onboarding_progress set address_at = now(), selfie_at = now() where staff_id = :'amira';

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"91120000-0000-4000-8000-000000000001","role":"authenticated"}';
select throws_ok(
  format($$ select onboarding_attach_document('passport', %L, 'p.jpg', 200000, 'image/jpeg') $$,
         :'amira' || '/passport/1.jpg'),
  'P0001', null, 'nothing is uploaded at step 4 on this branch');
select lives_ok($$ select onboarding_submit_documents(false, null, null) $$,
  'Submit with no upload and a "No" declaration');
select throws_ok($$ select onboarding_reenter_share_code('W123AB4CD') $$,
  'P0001', 'no_share_code_branch', 'and there is no share code to re-enter');
reset role;

select results_eq(
  format($$ select doc_type::text, review_status::text, share_code, file_path is null
              from compliance_docs where staff_id = %L order by uploaded_at $$, :'amira'),
  $$ values ('home_office_check_result'::text, 'pending'::text, 'ABC 123456'::text, true) $$,
  'submit filed one pending Home Office check result carrying the reference, with no file yet — and no share code report');
select is((select count(*)::int from rtw_checks where staff_id = :'amira'), 0,
  'no gov.uk check is queued for it');
select is(onboarding_documents_missing(:'amira'), '{}'::text[], 'nothing is missing any more');

-- =====================================================================
-- 4 · The quiz gate
-- =====================================================================
select is((select status::text from staff where id = :'amira'), 'documents',
  'the declaration "No" is verified, but the result is not: still in Documents');
select is(onboarding_quiz_blockers(:'amira'), array['document_unverified:home_office_check_result'],
  'the only blocker is the office''s result — nothing about a share code');

-- The result was approved ten days ago (relative, so the suite never ages):
-- six months from that day is the right-to-work date.
select (current_date - 10) as approved, (current_date - 10 + interval '6 months')::date as until \gset
select id as ecs_doc from compliance_docs where staff_id = :'amira' and doc_type = 'home_office_check_result' \gset

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select throws_ok(
  format($$ select compliance_verify_home_office_check(%L, %L::date) $$, :'ecs_doc', :'approved'),
  'P0001', 'home_office_result_missing', 'Verify is refused until the result is attached');
select is(office_attach_home_office_check(:'amira', :'amira' || '/home-office-check-result/ecs.pdf') ->> 'mode',
  'attached', 'the office attaches the emailed PDF to the row step 4 filed');
select throws_ok(
  format($$ select compliance_verify_home_office_check(%L, null) $$, :'ecs_doc'),
  'P0001', 'approved_on_required', 'Verify needs the date approved printed on the result');
select throws_ok(
  format($$ select verify_document(%L, %L::date) $$, :'ecs_doc', :'until'),
  'P0001', 'approved_on_required',
  'and the generic Verify cannot skip it: a result is never verified without the date approved');
select throws_ok(
  format($$ select compliance_verify_home_office_check(%L, current_date + 1) $$, :'ecs_doc'),
  '22023', 'approved_on_invalid', 'a date approved in the future is refused');
select throws_ok(
  format($$ select compliance_verify_home_office_check(%L, %L::date, 'infinity'::date) $$, :'ecs_doc', :'approved'),
  'P0001', 'no_time_limit_not_allowed: home_office_check', '"no time limit" is not a Home Office check result''s to claim');
select throws_ok(
  format($$ select compliance_verify_home_office_check(%L, %L::date, %L::date) $$, :'ecs_doc', :'approved', :'approved'),
  'P0001', 'until_before_approved', 'a typed right-to-work date must fall after the date approved');
select throws_ok(
  format($$ select compliance_verify_home_office_check(%L, %L::date, %L::date + 400) $$, :'ecs_doc', :'approved', :'approved'),
  'P0001', 'until_too_far', 'and no more than a year after it — 2099 is a typo');
select throws_ok(
  format($$ select compliance_verify_home_office_check(%L, date '1999-12-31') $$, :'ecs_doc'),
  '22023', 'approved_on_implausible', 'a date approved before 2000 is refused on its own');
select is(
  compliance_verify_home_office_check(:'ecs_doc', :'approved'::date) ->> 'confirmedUntil',
  :'until', 'Verify with the date approved: the right to work runs six months from it');
reset role;

select results_eq(
  format($$ select status::text, right_to_work_until from staff where id = %L $$, :'amira'),
  format($$ values ('quiz'::text, %L::date) $$, :'until'),
  'verified: the quiz opens and the date is the worker''s right to work');
select results_eq(
  format($$ select review_status::text, home_office_approved_on, right_to_work_until
              from compliance_docs where id = %L $$, :'ecs_doc'),
  format($$ values ('verified'::text, %L::date, %L::date) $$, :'approved', :'until'),
  'the date approved is kept on the evidence row with the date it gave');
select is((select count(*)::int from audit_log
            where action = 'rtw.home_office_check_attached' and data ->> 'staffId' = :'amira'), 1,
  'the attach is audited');
select is((select count(*)::int from audit_log
            where action = 'rtw.verified' and data ->> 'staffId' = :'amira'
              and data ->> 'docType' = 'home_office_check_result'), 1,
  'and the Verify as a right-to-work decision');

-- =====================================================================
-- 5 · The cap and canRoster
-- =====================================================================
select is((weekly_cap_for(:'worker', date '2026-11-02')).cap_hours, 48,
  'a non-student''s cap: 48 h');
select is((weekly_cap_for(:'amira', current_date)).cap_hours, null::int,
  'and the 48-hour opt-out signed at step 1 lifts it, as for any non-student');
select ok(can_roster_staff(:'amira', :'until'::date), 'rostered up to the date the result gives');
select ok(not can_roster_staff(:'amira', :'until'::date + 1), 'never past it');
select ok(not can_roster_staff(:'worker', date '2026-11-02'),
  'a worker on this branch with no right-to-work date at all cannot be rostered');

-- =====================================================================
-- 6 · A result attached before the candidate submitted is kept
-- =====================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"91120000-0000-4000-8000-000000000004","role":"authenticated"}';
select lives_ok(
  $$ select onboarding_save_right_to_work('home_office_check', date '1998-11-02', null, null, null, null, false, 'NY1234567') $$,
  'Nadia picks the Home Office check');
reset role;
update onboarding_progress set address_at = now(), selfie_at = now() where staff_id = :'nadia';

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select is(office_attach_home_office_check(:'nadia', :'nadia' || '/home-office-check-result/early.pdf') ->> 'mode',
  'new', 'the office already has her result and attaches it before she submits');
set local "request.jwt.claims" = '{"sub":"91120000-0000-4000-8000-000000000004","role":"authenticated"}';
select lives_ok(
  $$ select onboarding_save_right_to_work('home_office_check', date '1998-11-02', null, null, null, null, false, 'NY1234567') $$,
  'she saves step 1 again, on the same branch');
select lives_ok($$ select onboarding_submit_documents(false, null, null) $$, 'and submits');
reset role;
select results_eq(
  format($$ select review_status::text, file_path is not null, share_code
              from compliance_docs where staff_id = %L order by uploaded_at $$, :'nadia'),
  $$ values ('pending'::text, true, 'NY1234567'::text) $$,
  'one row: the attached result, still pending — step 1 did not supersede it and submit added no empty row');

select * from finish();
rollback;
