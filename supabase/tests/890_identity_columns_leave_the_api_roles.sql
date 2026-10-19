-- =====================================================================
-- 890 · identity, bank and AI-review columns leave the API roles
--       20261020120000 · ADR-0163 · security review M1 + L3
--
-- A stolen, signed-in phone used to read the worker's NI number, share
-- code, date of birth, home address, sort code and account number off
-- PostgREST, and a worker could read the AI's verdict on their own
-- document. Proved here from both ends: the direct read now fails for
-- every API caller, and every screen's route still returns each value to
-- the caller it is for — and only that caller.
-- =====================================================================
begin;
select plan(69);
\ir _shared/fixtures.psql

\set sess_a   '89000000-0000-4000-8000-0000000000a1'
\set share_a  '89000000-0000-4000-8000-0000000000d1'
\set ni_a     '89000000-0000-4000-8000-0000000000d2'
\set letter_a '89000000-0000-4000-8000-0000000000d3'
\set sched    '89000000-0000-4000-8000-0000000000f1'

update staff set ni_number = 'QQ123456B', share_code = 'W12AB34CD', home_address = '1 Fixture Row, London E1 6AN'
 where id = :'staffa';
update staff set ni_number = 'QQ654321C', share_code = 'X98ZY76WV', home_address = '2 Fixture Row, London E1 6AN'
 where id = :'staffb';
-- bank_details comes from the fixtures: 04-00-04 / 11110001 for Staff Alpha.
insert into compliance_docs (id, staff_id, doc_type, review_status, share_code, claimed_dob) values
  (:'share_a', :'staffa', 'share_code_report', 'pending', 'W12AB34CD', date '1995-01-02');
insert into compliance_docs (id, staff_id, doc_type, file_path, review_status) values
  (:'ni_a', :'staffa', 'ni_evidence', 'documents/a/ni.pdf', 'pending');
insert into compliance_docs (id, staff_id, doc_type, file_path, review_status, ai_extracted, ai_confidence,
                             needs_manual_review, manual_review_reason) values
  (:'letter_a', :'staffa', 'university_term_dates_letter', 'documents/a/letter.pdf', 'pending',
   '{"termLetter": {"courseStart": "2025-09-22", "courseEnd": "2028-06-30", "hoursStatement": "20 hours"}}',
   0.41, true, 'completion date differs from the worker''s');

-- An office account with the finance permission, and a scheduler without it.
update profiles set office_role = 'owner' where id = :'admin_uid';
insert into auth.users (id, email) values (:'sched', 'scheduler@rls.test');
insert into profiles (id, role, full_name, office_role) values (:'sched', 'admin', 'Sam Scheduler', 'scheduler');
insert into auth.sessions (id, user_id, created_at, updated_at) values (:'sess_a', :'staffa_uid', now(), now());

-- =====================================================================
-- 1 · The privilege itself
-- =====================================================================
select is_empty(
  $$ select t.tbl || '.' || t.col || ' / ' || r.rol
       from (values ('staff', 'dob'), ('staff', 'home_address'), ('staff', 'ni_number'), ('staff', 'share_code'),
                    ('bank_details', 'sort_code'), ('bank_details', 'account_number'),
                    ('compliance_docs', 'share_code'), ('compliance_docs', 'claimed_dob'),
                    ('compliance_docs', 'ai_extracted'), ('compliance_docs', 'ai_confidence'),
                    ('compliance_docs', 'needs_manual_review'), ('compliance_docs', 'manual_review_reason')) t(tbl, col)
      cross join (values ('anon'), ('authenticated')) r(rol)
      where has_column_privilege(r.rol, format('public.%I', t.tbl), t.col, 'select') $$,
  'neither API role may SELECT any of the twelve columns');
select ok(not has_table_privilege('authenticated', 'public.bank_details', 'select')
      and not has_table_privilege('authenticated', 'public.compliance_docs', 'select'),
  'bank_details and compliance_docs no longer hold a table-wide SELECT, which no column revoke could narrow');
select ok(has_column_privilege('authenticated', 'public.bank_details', 'account_holder', 'select')
      and has_column_privilege('authenticated', 'public.compliance_docs', 'review_status', 'select')
      and has_column_privilege('authenticated', 'public.compliance_docs', 'rejection_reason', 'select'),
  'the rest is re-granted by name: the holder, and the document''s status and §2.6 rejection reason');
select ok(has_column_privilege('service_role', 'public.staff', 'ni_number', 'select')
      and has_column_privilege('service_role', 'public.bank_details', 'account_number', 'select'),
  'the service role keeps them: the jobs and the payroll files still read them');

-- =====================================================================
-- 2 · The worker: the direct read fails, the screens still work
-- =====================================================================
select set_config('request.jwt.claims', json_build_object(
  'sub', :'staffa_uid', 'role', 'authenticated', 'session_id', :'sess_a')::text, true);
set local role authenticated;

select throws_ok($$ select ni_number from staff $$, '42501', null,
  'GET /staff?select=ni_number from a worker''s own session is refused');
select throws_ok($$ select share_code from staff $$, '42501', null, 'so is share_code');
select throws_ok($$ select dob from staff $$, '42501', null, 'so is dob');
select throws_ok($$ select home_address from staff $$, '42501', null, 'so is home_address');
select throws_ok($$ select * from staff $$, '42501', null,
  'and `select=*` on staff, which is why no app reader may use it');
select throws_ok($$ select account_number from bank_details $$, '42501', null,
  'GET /bank_details?select=account_number is refused');
select throws_ok($$ select sort_code from bank_details $$, '42501', null, 'so is sort_code');
select throws_ok($$ select * from bank_details $$, '42501', null, 'and select=* on bank_details');
select throws_ok($$ select ai_extracted from compliance_docs $$, '42501', null,
  'L3: the AI''s read of the worker''s own document is refused');
select throws_ok($$ select ai_confidence from compliance_docs $$, '42501', null, 'so is its confidence');
select throws_ok($$ select needs_manual_review from compliance_docs $$, '42501', null, 'and the review flag');
select throws_ok($$ select manual_review_reason from compliance_docs $$, '42501', null, 'and the review reason');
select throws_ok($$ select share_code, claimed_dob from compliance_docs $$, '42501', null,
  'and the share code and date of birth typed with it');

select is((select first_name from staff), 'Staff', 'the worker still reads their own name off the row');
select is((select account_holder from bank_details), 'Staff Alpha', 'and their own account holder');
select is((select count(*)::int from compliance_docs where staff_id = :'staffa'), 4,
  'and their own documents, with status and rejection reason (§2.6)');

-- Profile (staff_me): wireframes/staff/profile.html shows the bank form
-- filled in and the NI number masked.
select is(staff_me() ->> 'niMasked', '●●●●●●●6B', 'staff_me(): the NI number masked, as Profile shows it');
select is(staff_me() ->> 'dob', '1995-01-01', 'staff_me(): the worker''s own date of birth (Profile details)');
select is(staff_me() ->> 'homeAddress', '1 Fixture Row, London E1 6AN', 'staff_me(): their own home address');
select is(staff_me() -> 'bank' ->> 'accountNumber', '11110001',
  'staff_me(): Bank & payroll''s form, prefilled as the wireframe draws it');
select ok(staff_me() ->> 'niNumber' is null and staff_me()::text !~ 'QQ123456B',
  'staff_me() never carries the full NI number');
-- The onboarding wizard (onboarding-3.html prints the share code in full).
select is(onboarding_state() ->> 'shareCode', 'W12AB34CD', 'onboarding_state(): the share code the worker typed');
select ok(not exists (select 1 from jsonb_array_elements(onboarding_state() -> 'documents') d where d ? 'needsManualReview'),
  'L3: onboarding_state() no longer hands the worker the review flag');
-- Documents (staff_documents): the last three characters only.
select is((select d ->> 'shareCodeTail' from jsonb_array_elements(staff_documents() -> 'documents') d
            where d ->> 'id' = :'share_a'), '4CD',
  'staff_documents(): the share code''s last three characters, the rest is the office''s');
select ok(staff_documents()::text !~ 'completion date differs' and staff_documents()::text !~ '0\.41',
  'staff_documents() carries neither the AI''s confidence nor its reason');

-- The office's routes give a worker nothing.
select is((select count(*)::int from staff_identity_v), 0, 'staff_identity_v: nothing for a worker, own row included');
select is((select count(*)::int from staff_bank_masked_v), 0, 'staff_bank_masked_v: nothing for a worker');
select is((select count(*)::int from compliance_doc_review_v), 0, 'compliance_doc_review_v: nothing for a worker');
select is((select dob from staff_profile_v where id = :'staffa'), null,
  'staff_profile_v (security_invoker, the worker''s own row): no date of birth through it');
select is((select ni_number_masked from staff_profile_v where id = :'staffa'), null, 'no NI mask either');
select is((select ai_confidence from staff_documents_v where id = :'letter_a'), null,
  'staff_documents_v: no AI confidence for the worker''s own letter');
select is((select ai_term_letter from staff_documents_v where id = :'letter_a'), null, 'and no AI term-letter read');
select is((select share_code from onboarding_candidates_v where id = :'staffa'), null,
  'onboarding_candidates_v: no share code for the worker''s own row');

-- staff_identity_facts(): the worker's own two facts, nobody else's.
select is((select dob from staff_identity_facts(:'staffa')), date '1995-01-01',
  'staff_identity_facts(): the worker''s own date of birth (it is on their Profile)');
select is((select count(*)::int from staff_identity_facts(:'staffb')), 0,
  'and nothing at all for another worker, called straight over /rpc');
reset role;

-- =====================================================================
-- 3 · The office: every screen still has its value
-- =====================================================================
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;

select throws_ok($$ select ni_number from staff $$, '42501', null,
  'the office cannot read the column off the table either — admin and worker are the same Postgres role');
select is((select dob from staff_profile_v where id = :'staffa'), date '1995-01-01', 'staff_profile_v: the date of birth');
select is((select home_address from staff_profile_v where id = :'staffa'), '1 Fixture Row, London E1 6AN', 'the home address');
select is((select share_code from staff_profile_v where id = :'staffa'), 'W12AB34CD', 'the share code');
select is((select ni_number_masked from staff_profile_v where id = :'staffa'), '●●●●●●●6B', 'the NI mask');
select is((select has_ni_number from staff_profile_v where id = :'staffa'), true, 'and whether one is held');
select is((select bank_sort_code_masked || ' ' || bank_account_masked from staff_profile_v where id = :'staffa'),
  '04-••-•• ••••0001', 'the two bank masks, for an office account with the finance permission');
select is((select bank_account_holder from staff_profile_v where id = :'staffa'), 'Staff Alpha', 'and the holder');
select is((select dob from onboarding_candidates_v where id = :'staffa'), date '1995-01-01', 'onboarding_candidates_v: the date of birth');
select is((select share_code from onboarding_candidates_v where id = :'staffa'), 'W12AB34CD', 'the share code');
select is((select ni_entered from onboarding_candidates_v where id = :'staffa'), true, 'and NI entered');
select is((select ni_number from staff_identity_v where staff_id = :'staffa'), 'QQ123456B',
  'staff_identity_v: the full NI number beside the NI evidence (D43)');
select is((select ai_confidence from compliance_review_queue_v where item_id = :'letter_a'), 0.41::numeric,
  'compliance_review_queue_v: the AI confidence');
select is((select manual_review_reason from compliance_review_queue_v where item_id = :'letter_a'),
  'completion date differs from the worker''s', 'the manual-review reason');
select is((select needs_manual_review from compliance_review_queue_v where item_id = :'letter_a'), true, 'the flag');
select is((select ni_number from compliance_review_queue_v where item_id = :'ni_a'), 'QQ123456B',
  'the NI number on an NI evidence row');
select is((select share_code from compliance_review_queue_v where item_id = :'share_a'), 'W12AB34CD',
  'the share code on a pending share code');
select is((select ai_term_letter ->> 'courseEnd' from staff_documents_v where id = :'letter_a'), '2028-06-30',
  'staff_documents_v: the AI''s term-letter read');
select is((select claimed_dob from share_code_dob_claims_v where document_id = :'share_a'), date '1995-01-02',
  'share_code_dob_claims_v: the date typed with the code');
select is((select profile_dob from share_code_dob_claims_v where document_id = :'share_a'), date '1995-01-01',
  'and the profile''s, so ADR-0070''s line can say they differ');
reset role;

-- A scheduler: identity yes, bank no (bank_details' office_finance_read).
select set_config('request.jwt.claims', json_build_object('sub', :'sched', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select dob from staff_profile_v where id = :'staffa'), date '1995-01-01', 'a scheduler still sees the profile''s date of birth');
select is((select bank_account_masked from staff_profile_v where id = :'staffa'), null,
  'but not the bank masks: staff_bank_masked_v asks office_can(''finance''), as bank_details does');
reset role;

-- A client: none of the three.
select set_config('request.jwt.claims', json_build_object('sub', :'clienta_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select count(*)::int from staff_identity_v) + (select count(*)::int from staff_bank_masked_v)
          + (select count(*)::int from compliance_doc_review_v), 0, 'a client reads nothing from the three views');
reset role;

-- =====================================================================
-- 4 · The cap and onboarding helpers agree in every context
--
-- weekly_cap_for() and onboarding_documents_missing() run as the caller.
-- A worker who turned 18 three days ago, with a signed opt-out, is capped
-- at 48 h for a week a month back (an under-18 cannot opt out) and
-- uncapped today; the office's board, the worker's own read and every
-- definer chain must say the same.
-- =====================================================================
update staff set dob = (current_date - interval '18 years' - interval '3 days')::date,
                 wtr_optout = true, wtr_optout_signed_at = now(), rtw_branch = 'work_visa'
 where id = :'staffa';
select is(weekly_cap_hours(:'staffa', current_date - 30), 48, 'as the owner (every definer chain): 48 h while under 18');
select onboarding_documents_missing(:'staffa')::text as missing_owner \gset
select ok(not (onboarding_documents_missing(:'staffa') && array['dob', 'share_code']),
  'the owner''s answer: the date of birth and the share code are both on file');
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is(weekly_cap_hours(:'staffa', current_date - 30), 48,
  'as the office, through the invoker path: the same 48 h, the date of birth read through staff_identity_facts()');
select is(onboarding_documents_missing(:'staffa')::text, :'missing_owner',
  'onboarding_documents_missing() gives the office the owner''s answer, read through staff_identity_facts()');
reset role;
select set_config('request.jwt.claims', json_build_object(
  'sub', :'staffa_uid', 'role', 'authenticated', 'session_id', :'sess_a')::text, true);
set local role authenticated;
select is(weekly_cap_hours(:'staffa', current_date - 30), 48, 'and as the worker themselves');
select ok(not (onboarding_documents_missing(:'staffa') && array['dob', 'share_code']),
  'whose own missing list still finds their date of birth and share code');
select is(weekly_cap_hours(:'staffb', current_date - 30), null, 'another worker''s cap is not theirs to read (staff''s RLS)');
reset role;

select * from finish();
rollback;
