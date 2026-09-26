-- =====================================================================
-- 602 · The Needs review queue carries why the extractor flagged a
--       document (20260928110900, §4.1, §4.2)
--
--   A · The column: appended last on compliance_review_queue_v, text,
--       still security_invoker, grants unchanged.
--   B · A term letter whose every holiday range is past reads
--       manual_review_reason = 'letter expired' in the queue, beside
--       needs_manual_review = true, however confident the read; a current
--       letter, an unread letter (manual on confidence alone), a passport,
--       a Yes declaration and an rtw_date row all read null.
--   C · The reason the queue shows is the one Verify refuses on:
--       term_letter_expired (P0001) for that row and no other; Reject
--       takes the row out of the queue as before (§4.1 N8).
--   D · Nobody but the office reads it: a worker and a client read an
--       empty queue, anon cannot read the view at all.
--
-- Every row is created inside the transaction and rolled back.
-- =====================================================================
begin;
select plan(23);
\ir _shared/fixtures.psql

\set w_stu    'c6020000-0000-4000-8000-000000000001'
\set w_gap    'c6020000-0000-4000-8000-000000000002'
\set d_old    'c6021000-0000-4000-8000-000000000001'
\set d_cur    'c6021000-0000-4000-8000-000000000002'
\set d_unread 'c6021000-0000-4000-8000-000000000003'
\set d_pass   'c6021000-0000-4000-8000-000000000004'
\set d_gap    'c6021000-0000-4000-8000-000000000005'
\set c_yes    'c6022000-0000-4000-8000-000000000001'

select (now() at time zone 'Europe/London')::date as today \gset

-- =====================================================================
-- A · The column
-- =====================================================================
select has_column('public', 'compliance_review_queue_v', 'manual_review_reason',
  'the queue carries manual_review_reason');
select col_type_is('public', 'compliance_review_queue_v', 'manual_review_reason', 'text',
  'as text, the document row''s own column');
-- Appended straight after rtw_manual_allowed, the last column before it.
-- 20260930130400 appends five more after it, so "the last column" is no
-- longer the test: "no existing column moved" is.
select is(
  (select ordinal_position::int from information_schema.columns
     where table_schema = 'public' and table_name = 'compliance_review_queue_v'
       and column_name = 'manual_review_reason'),
  (select ordinal_position::int + 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'compliance_review_queue_v'
       and column_name = 'rtw_manual_allowed'),
  'appended at the end, after rtw_manual_allowed — create-or-replace may only add columns at the end, and review_reason keeps its place');
select is(
  (select c.reloptions::text[] @> array['security_invoker=true']
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'compliance_review_queue_v'),
  true, 'still security_invoker: admin_all on the base tables is the gate');
select is(has_table_privilege('anon', 'public.compliance_review_queue_v', 'select'), false,
  'anon has no select on the view (revoked, as before)');
select is(has_table_privilege('authenticated', 'public.compliance_review_queue_v', 'select'), true,
  'authenticated keeps select — RLS on the base tables decides who sees rows');

-- =====================================================================
-- Fixtures
-- =====================================================================
insert into staff (id, employee_id, first_name, last_name, email, phone, dob, status, rtw_branch, share_code) values
  (:'w_stu', 96021, 'Sam',  'Student', 'stu@602.test', '+447700960201', date '2001-01-01', 'compliant', 'international_student', null),
  (:'w_gap', 96022, 'Gia',  'Gap',     'gap@602.test', '+447700960202', date '1995-01-01', 'compliant', 'work_visa',             'W60200002');

insert into compliance_docs (id, staff_id, doc_type, uploaded_at, review_status, file_path, expiry_date) values
  (:'d_old',    :'w_stu', 'university_term_dates_letter', now() - interval '3 days', 'pending', 'documents/602/old.pdf',    null),
  (:'d_cur',    :'w_stu', 'university_term_dates_letter', now() - interval '2 days', 'pending', 'documents/602/cur.pdf',    null),
  (:'d_unread', :'w_stu', 'university_term_dates_letter', now() - interval '1 day',  'pending', 'documents/602/unread.pdf', null),
  (:'d_pass',   :'w_stu', 'passport',                     now() - interval '12 hours', 'pending', 'documents/602/pass.pdf', :'today'::date + 3000);
-- The 31 December the upload path stamps on every term letter (§4.2, ADR-0011).
update compliance_docs
   set expiry_date = doc_expires_on('university_term_dates_letter', null, null, null, uploaded_at)
 where staff_id = :'w_stu' and doc_type = 'university_term_dates_letter';
-- A share code verified before the date was required (the 'rtw_date' row).
insert into compliance_docs (id, staff_id, doc_type, uploaded_at, reviewed_at, reviewed_by, share_code, review_status) values
  (:'d_gap', :'w_gap', 'share_code_report', now() - interval '31 days', now() - interval '30 days', :'admin_uid', 'W60200002', 'verified');
-- A Yes declaration waiting on the office (the 'declaration' row).
insert into criminal_declarations (id, staff_id, source, answer, details, review_status, superseded, declared_at) values
  (:'c_yes', :'w_stu', 'onboarding', true, 'Fixed penalty, 2024', 'pending', false, now() - interval '4 days');

-- The extractor's reads: last year's letter with total confidence, this
-- year's with the same, and one it could not read.
select lives_ok(
  format($$ select record_document_extraction(%L, null,
              array[daterange(%L::date - 400, %L::date - 300), daterange(%L::date - 200, %L::date - 100)],
              null, null, 0.99, '{"provider":"test"}'::jsonb) $$,
         :'d_old', :'today', :'today', :'today', :'today'),
  'fixture: a confident read of a letter whose dates are all past');
select lives_ok(
  format($$ select record_document_extraction(%L, null,
              array[daterange(%L::date + 60, %L::date + 90)],
              null, null, 0.99, '{"provider":"test"}'::jsonb) $$,
         :'d_cur', :'today', :'today'),
  'fixture: a confident read of a current letter');
select lives_ok(
  format($$ select record_document_extraction(%L, null, null, null, null, 0.30, '{"provider":"test"}'::jsonb) $$,
         :'d_unread'),
  'fixture: a letter the extractor could not read');

select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);

-- =====================================================================
-- B · The reason in the queue
-- =====================================================================
select results_eq(
  format($$ select kind, needs_manual_review, manual_review_reason
              from compliance_review_queue_v where item_id = %L $$, :'d_old'),
  $$ values ('document'::text, true, 'letter expired'::text) $$,
  '§4.2: a term letter whose every holiday range is past is in the queue flagged for a human WITH the reason, however confident the read');
select results_eq(
  format($$ select item_id::text, needs_manual_review, manual_review_reason
              from compliance_review_queue_v where staff_id = %L and kind = 'document' and item_id <> %L
              order by submitted_at $$, :'w_stu', :'d_old'),
  format($$ values (%L::text, false, null::text), (%L::text, true, null::text), (%L::text, false, null::text) $$,
         :'d_cur', :'d_unread', :'d_pass'),
  'a current letter carries no flag and no reason; an unread one is manual on confidence alone, reason null; a passport reads null');
select is((select manual_review_reason from compliance_review_queue_v where item_id = :'c_yes'),
  null, 'a Yes declaration reads null — there is no upload for an extractor to read');
select is((select kind || ':' || coalesce(manual_review_reason, '<null>') from compliance_review_queue_v where item_id = :'d_gap'),
  'rtw_date:<null>', 'the rtw_date row reads null too, and its own review_reason is untouched');
select is((select review_reason from compliance_review_queue_v where item_id = :'d_gap'),
  'Right-to-work date missing — re-verify', 'review_reason kept its place and its wording (20260927160000)');
select is((select count(*)::int from compliance_review_queue_v where staff_id in (:'w_stu', :'w_gap')), 6,
  'the tab counts every row as before: four documents, one declaration, one rtw_date');

-- =====================================================================
-- C · The reason the queue shows is the one Verify refuses on
-- =====================================================================
select throws_ok(
  format('select compliance_verify_document(%L)', :'d_old'),
  'P0001', 'term_letter_expired: every term date on this letter is before ' || :'today',
  'Verify refuses the flagged letter with term_letter_expired — the token the screen maps to a sentence');
select is((select manual_review_reason from compliance_review_queue_v where item_id = :'d_old'),
  'letter expired', 'and the row, reason and all, is still in the queue for the reviewer to reject');
select lives_ok(format('select compliance_verify_document(%L)', :'d_cur'),
  'the current letter, unflagged, verifies');
select lives_ok(
  format('select compliance_reject_document(%L, %L)', :'d_old', 'This is last year''s letter — please upload the current one'),
  '§4.1: Reject with a reason');
select is((select count(*)::int from compliance_review_queue_v where item_id = :'d_old'), 0,
  'and the rejected letter leaves the queue');

-- =====================================================================
-- D · Nobody but the office reads it
-- =====================================================================
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
select is((select count(*)::int from compliance_review_queue_v), 0,
  'a worker reads an empty queue — the reason column takes nothing past RLS on compliance_docs');
select set_config('request.jwt.claims', json_build_object('sub', :'clienta_uid', 'role', 'authenticated')::text, true);
select is((select count(*)::int from compliance_review_queue_v), 0,
  'a client reads an empty queue (§11.1, ADR-0004: no client policy on compliance_docs or staff)');
reset role;

set local role anon;
select set_config('request.jwt.claims', '', true);
select throws_ok('select manual_review_reason from compliance_review_queue_v', '42501', null,
  'anon cannot read the view at all');
reset role;

select * from finish();
rollback;
