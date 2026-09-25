-- =====================================================================
-- 524 · Right-to-work date missing → a row in Needs review
--   20260926121000_rtw_date_missing_in_queue.sql (§4.1, §2.5, §2.6,
--   ADR-0018, docs/14 §4 "From the 23.09 build")
--
-- The gap: a share code report verified before 20260923200000 carries no
-- right-to-work date, so the worker's staff.right_to_work_until is NULL and
-- nothing counts down to their visa. Only the header query of that
-- migration found them, and nobody runs it.
--
-- What this file holds:
--   A. The queue: a share-code-verified non-UK worker with no date is a
--      'rtw_date' row reading "Right-to-work date missing — re-verify",
--      keyed on the report and carrying the share code; a UK-branch worker
--      (no date required) is not; nor is a worker with no branch, a
--      Rejected profile, or a worker whose NEW share code report is already
--      pending in this queue. The tab counts the row like any other item.
--   B. can_roster_staff() for that worker — asserted, not assumed (ADR-0018).
--   C. compliance_confirm_rtw_date(): refuses a visa document
--      (not_a_share_code), a pending report (not_verified), a blank date, a
--      date already passed, no-time-limit off the EU branch, a Rejected
--      profile and a missing row; accepts a future date, writes it to the
--      report AND the worker (through compliance_docs_rtw_until), restamps
--      the reviewer, audits rtw.verified with reverified = true, queues no
--      N8, and the row disappears. The per-shift stop fires from then on.
--   D. 'infinity' (settled status, no time limit) is accepted on the EU
--      branch only, and closes the row too.
--   E. Only the latest verified report may be confirmed: once a newer one
--      is verified, the older is superseded_by_newer.
--   F. Admin only: staff and client get 42501 not_authorised; anon cannot
--      execute the function or read the queue.
-- =====================================================================
begin;
select plan(46);
\ir _shared/fixtures.psql

\set gap      'c5240000-0000-4000-8000-000000000001'
\set uk       'c5240000-0000-4000-8000-000000000002'
\set eu       'c5240000-0000-4000-8000-000000000003'
\set newer    'c5240000-0000-4000-8000-000000000004'
\set rej      'c5240000-0000-4000-8000-000000000005'
\set nobranch 'c5240000-0000-4000-8000-000000000006'

\set gap_share   'c5241000-0000-4000-8000-000000000001'
\set gap_visa    'c5241000-0000-4000-8000-000000000002'
\set uk_share    'c5241000-0000-4000-8000-000000000011'
\set eu_share    'c5241000-0000-4000-8000-000000000021'
\set new_old     'c5241000-0000-4000-8000-000000000031'
\set new_pending 'c5241000-0000-4000-8000-000000000032'
\set rej_share   'c5241000-0000-4000-8000-000000000041'
\set nb_share    'c5241000-0000-4000-8000-000000000051'
\set missing     'c5241000-0000-4000-8000-0000000000ff'

select (now() at time zone 'Europe/London')::date as today \gset

-- Six workers as the 23.09 header query would find them: verified on a
-- share code, no date anywhere. Only the branch (and one status) differs.
insert into staff (id, employee_id, first_name, last_name, email, phone, dob, status, rtw_branch, share_code) values
  (:'gap',      95241, 'Gia',  'Gap',      'gap@rtw524.test', '+447700952401', date '1995-01-01', 'compliant', 'work_visa',  'W52400001'),
  (:'uk',       95242, 'Uma',  'Kingdom',  'uk@rtw524.test',  '+447700952402', date '1995-01-01', 'compliant', 'uk_irish',   null),
  (:'eu',       95243, 'Ewa',  'Settled',  'eu@rtw524.test',  '+447700952403', date '1995-01-01', 'compliant', 'eu_settled', 'W52400003'),
  (:'newer',    95244, 'Nia',  'Renewed',  'new@rtw524.test', '+447700952404', date '1995-01-01', 'compliant', 'work_visa',  'W52400004'),
  (:'rej',      null,  'Rui',  'Rejected', 'rej@rtw524.test', '+447700952405', date '1995-01-01', 'rejected',  'work_visa',  'W52400005'),
  (:'nobranch', 95246, 'Noor', 'Branch',   'nb@rtw524.test',  '+447700952406', date '1995-01-01', 'compliant', null,         'W52400006');

-- The pre-23.09 state, seeded as it stands in production: the row guard
-- (compliance_docs_rtw_date_guard) fires on the flip to verified, not on
-- an insert, exactly as these rows predate it.
insert into compliance_docs (id, staff_id, doc_type, uploaded_at, reviewed_at, reviewed_by, share_code, review_status) values
  (:'gap_share', :'gap',      'share_code_report', now() - interval '31 days', now() - interval '30 days', :'admin_uid', 'W52400001', 'verified'),
  (:'uk_share',  :'uk',       'share_code_report', now() - interval '31 days', now() - interval '30 days', :'admin_uid', null,        'verified'),
  (:'eu_share',  :'eu',       'share_code_report', now() - interval '31 days', now() - interval '30 days', :'admin_uid', 'W52400003', 'verified'),
  (:'new_old',   :'newer',    'share_code_report', now() - interval '41 days', now() - interval '40 days', :'admin_uid', 'W52400004', 'verified'),
  (:'rej_share', :'rej',      'share_code_report', now() - interval '31 days', now() - interval '30 days', :'admin_uid', 'W52400005', 'verified'),
  (:'nb_share',  :'nobranch', 'share_code_report', now() - interval '31 days', now() - interval '30 days', :'admin_uid', 'W52400006', 'verified');
-- Two ordinary pending uploads beside them: Gia's visa (a document row, and
-- the wrong kind of thing to confirm a date on) and Nia's NEW share code.
insert into compliance_docs (id, staff_id, doc_type, uploaded_at, expiry_date, share_code, review_status) values
  (:'gap_visa',    :'gap',   'visa_document',     now() - interval '1 hour', :'today'::date + 400, null,        'pending'),
  (:'new_pending', :'newer', 'share_code_report', now() - interval '1 hour', null,                 'W52400004', 'pending');

select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);

-- =====================================================================
-- A · The queue
-- =====================================================================
select is((select count(*)::int from compliance_review_queue_v where staff_id = :'gap' and kind = 'rtw_date'), 1,
  '§4.1: a share-code-verified non-UK worker with no right-to-work date is a row in Needs review');
select results_eq(
  format($$ select item_id::text, item_type, item_label, review_reason, share_code, needs_manual_review,
                   is_candidate, submitted_at, staff_right_to_work_until, doc_right_to_work_until
              from compliance_review_queue_v where staff_id = %L and kind = 'rtw_date' $$, :'gap'),
  format($$ select %L::text, 'share_code_report'::text, 'Right to work · share code'::text,
                   'Right-to-work date missing — re-verify'::text, 'W52400001'::text, true,
                   false, (select reviewed_at from compliance_docs where id = %L), null::date, null::date $$,
         :'gap_share', :'gap_share'),
  'keyed on the report, with the reason, the share code to re-run on gov.uk, "needs manual review", and dated from when it was verified without one');
select is((select count(*)::int from compliance_review_queue_v where staff_id = :'uk'), 0,
  '§2.5 pt 1: a UK / Irish citizen needs no date — not in the queue');
select is((select count(*)::int from compliance_review_queue_v where staff_id = :'nobranch'), 0,
  'a worker with no branch recorded is not in the queue (the header query: non-UK)');
select is((select count(*)::int from compliance_review_queue_v where staff_id = :'eu' and kind = 'rtw_date'), 1,
  '§2.5 pt 2: EU settled with neither a date nor the no-time-limit confirmation IS in the queue');
select is((select count(*)::int from compliance_review_queue_v where staff_id = :'rej'), 0,
  '§4.1: a Rejected profile drops out');
select is((select kind || ':' || item_id::text from compliance_review_queue_v where staff_id = :'newer'),
  'document:' || :'new_pending',
  'a NEW share code report already pending in the queue closes the gap on its own Verify — no second row');
select is((select count(*)::int from compliance_review_queue_v where staff_id in (:'gap', :'eu', :'newer')), 4,
  'the tab and the crumb count rows: Gia''s two (rtw_date + visa), Ewa''s one, Nia''s one');

-- =====================================================================
-- B · can_roster_staff() — asserted, not assumed (ADR-0018)
-- =====================================================================
select is((select right_to_work_until from staff where id = :'gap'), null,
  'before: the worker has no right-to-work date');
select ok(can_roster_staff(:'gap', :'today'::date + 5000),
  'ADR-0018 gap, unchanged here: can_roster_staff() still reads a NULL date as "no expiry" for a non-UK worker — this row is what surfaces them (20260922093100; the rota guard is another owner''s)');

-- =====================================================================
-- C · The confirm
-- =====================================================================
select throws_ok(format('select compliance_confirm_rtw_date(%L, %L::date)', :'gap_visa', :'today'::date + 400),
  'P0001', 'not_a_share_code: visa_document',
  'a visa document is refused: it is re-uploaded and verified with its expiry, never re-dated');
select throws_ok(format('select compliance_confirm_rtw_date(%L, %L::date)', :'new_pending', :'today'::date + 400),
  'P0001', 'not_verified: pending',
  'a pending report is refused: it is verified, with its date, through compliance_verify_document()');
select throws_ok(format('select compliance_confirm_rtw_date(%L, null)', :'gap_share'),
  'P0001', 'rtw_date_required: share_code_report', '§2.6: a blank date is refused');
select throws_like(format('select compliance_confirm_rtw_date(%L, %L::date)', :'gap_share', :'today'::date - 1),
  'already_expired%', '§4.2: a date already passed is refused');
select throws_like(format('select compliance_confirm_rtw_date(%L, %L::date)', :'gap_share', :'today'::date),
  'already_expired%', 'and so is today — the last day to work is inclusive, so today is already over for rostering');
select throws_like(format('select compliance_confirm_rtw_date(%L, %L::date)', :'gap_share', 'infinity'),
  'no_time_limit_not_allowed%', '§2.5 pt 3: a work visa always ends — "no time limit" is refused off the EU branch');
select throws_ok(format('select compliance_confirm_rtw_date(%L, %L::date)', :'rej_share', :'today'::date + 300),
  'P0001', 'not_reviewable: rejected', '§4.1: a Rejected profile''s report is refused');
select throws_ok(format('select compliance_confirm_rtw_date(%L, %L::date)', :'missing', :'today'::date + 300),
  'P0002', 'document_not_found', 'a report that does not exist');
select is((select count(*)::int from compliance_review_queue_v where staff_id = :'gap' and kind = 'rtw_date'), 1,
  'every refusal above left the row where it was');

select is((compliance_confirm_rtw_date(:'gap_share', :'today'::date + 300) ->> 'rightToWorkUntil')::date, :'today'::date + 300,
  'a future date is accepted, and the reply carries the worker''s date now in force');
select is((select right_to_work_until from compliance_docs where id = :'gap_share'), :'today'::date + 300,
  'the date lives on the share code report, where compliance_daily reads it');
select is((select right_to_work_until from staff where id = :'gap'), :'today'::date + 300,
  'and on the worker, through compliance_docs_rtw_until — the same trigger every verify path relies on');
select is((select count(*)::int from compliance_review_queue_v where staff_id = :'gap' and kind = 'rtw_date'), 0,
  'the row is gone');
select is((select count(*)::int from compliance_review_queue_v where staff_id = :'gap'), 1,
  '(the pending visa still waits, as it should)');
select results_eq(
  format($$ select review_status::text, reviewed_by::text, reviewed_at > now() - interval '1 minute'
              from compliance_docs where id = %L $$, :'gap_share'),
  format($$ values ('verified', %L::text, true) $$, :'admin_uid'),
  '§1.8: still verified — no re-check, no status flip — and restamped with who confirmed the date now in force');
select isnt_empty(
  format($$ select 1 from audit_log where action = 'rtw.verified' and entity = 'compliance_docs' and entity_id = %L
             and actor = %L and (data ->> 'reverified')::boolean and data ->> 'confirmedUntil' = %L
             and data ->> 'staffUntilAfter' = %L and not (data ? 'staffUntilBefore') $$,
         :'gap_share', :'admin_uid', (:'today'::date + 300)::text, (:'today'::date + 300)::text),
  'audited as rtw.verified with reverified = true, the date confirmed, and the worker''s date before (none) and after');
select is((select count(*)::int from notification_outbox where key = 'N8:doc:' || :'gap_share'), 0,
  'no N8: nothing was rejected, and the status did not change');
select ok(not can_roster_staff(:'gap', :'today'::date + 301),
  'from now on can_roster_staff() is false the day after — the per-shift hard stop fires');
select ok(can_roster_staff(:'gap', :'today'::date + 300), 'and true on the last day (inclusive)');
select lives_ok(format('select compliance_confirm_rtw_date(%L, %L::date)', :'gap_share', :'today'::date + 200),
  'a correction is accepted: the same report is still the latest verified one');
select is((select right_to_work_until from staff where id = :'gap'), :'today'::date + 200,
  'and the worker''s date follows the correction');

-- =====================================================================
-- D · Settled status: no time limit, EU branch only
-- =====================================================================
select is((compliance_confirm_rtw_date(:'eu_share', 'infinity'::date) ->> 'noTimeLimit')::boolean, true,
  '§2.5 pt 2: settled status is confirmed explicitly as no time limit on the EU branch');
select results_eq(
  format($$ select d.right_to_work_until, d.rtw_no_time_limit, s.right_to_work_until
              from compliance_docs d join staff s on s.id = d.staff_id where d.id = %L $$, :'eu_share'),
  $$ values (null::date, true, null::date) $$,
  'recorded as no time limit on the report; the worker has no right-to-work expiry — correctly');
select is((select count(*)::int from compliance_review_queue_v where staff_id = :'eu'), 0,
  'the no-time-limit confirmation closes the row too');
select ok(can_roster_staff(:'eu', :'today'::date + 5000),
  'and a settled worker is rostered on any date, by design');

-- =====================================================================
-- E · The latest verified report only
-- =====================================================================
select lives_ok(format('select compliance_verify_document(%L, null, null, %L::date)', :'new_pending', :'today'::date + 500),
  'Nia''s new gov.uk check is verified, with its date, through the ordinary Verify');
select is((select right_to_work_until from staff where id = :'newer'), :'today'::date + 500,
  'which puts the date on the worker');
select throws_ok(format('select compliance_confirm_rtw_date(%L, %L::date)', :'new_old', :'today'::date + 600),
  'P0001', 'superseded_by_newer',
  'the old report cannot be re-dated: rtw_evidence_until() reads only the latest verified one');
select is((select count(*)::int from compliance_review_queue_v where staff_id = :'newer'), 0,
  'and nothing of Nia''s is left in the queue');

-- =====================================================================
-- F · Admin only
-- =====================================================================
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
select throws_ok(format('select compliance_confirm_rtw_date(%L, %L::date)', :'gap_share', :'today'::date + 300),
  '42501', 'not_authorised', 'a worker cannot confirm a right-to-work date');
select is((select count(*)::int from compliance_review_queue_v), 0,
  'and reads an empty queue (security_invoker: admin_all is the gate)');
select set_config('request.jwt.claims', json_build_object('sub', :'clienta_uid', 'role', 'authenticated')::text, true);
select throws_ok(format('select compliance_confirm_rtw_date(%L, %L::date)', :'gap_share', :'today'::date + 300),
  '42501', 'not_authorised', 'nor can a client');
select is((select count(*)::int from compliance_review_queue_v), 0, 'and a client reads an empty queue');
reset role;

set local role anon;
select set_config('request.jwt.claims', '', true);
select throws_ok(format('select compliance_confirm_rtw_date(%L, %L::date)', :'gap_share', :'today'::date + 300),
  '42501', null, 'anon cannot execute the function at all (revoked)');
select throws_ok('select count(*) from compliance_review_queue_v',
  '42501', null, 'nor read the queue');
reset role;

-- Back as the office: the confirmations above stood, and nothing in F changed them.
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
select is((select right_to_work_until from staff where id = :'gap'), :'today'::date + 200,
  'the refused calls changed nothing');

select * from finish();
rollback;
