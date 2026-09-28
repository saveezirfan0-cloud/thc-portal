-- =====================================================================
-- 678 · §1.7 removal holds right-to-work evidence for employment + 2
--       years (ADR-0065, amending ADR-0019)
--   remove_worker(), retained_storage_paths(), rtw_daily()
--   from 20261001205000_rtw_evidence_held_after_removal.sql
--
-- The Home Office keeps an employer's statutory excuse only while it can
-- produce the copies of its right-to-work checks — for the length of
-- employment and two years after. So a removal of someone who WAS
-- employed holds the evidence that was relied on, exactly as ADR-0019
-- already held the completion letter, and the daily job purges it when
-- the window closes. What was never relied on (pending, rejected,
-- superseded before any decision) and anyone never employed is wiped as
-- before.
--
-- Five workers:
--   Priya  employed, left 30.06.2026, work visa — the full set
--   Ben    employed, never left, UK birth-certificate route
--   Cara   a candidate, never employed — nothing to retain against
--   Dan    employed, birth-certificate route, but the certificate was
--          never relied on — so neither is its NI document
--   Finn   employed, left more than two years before the removal — the
--          window has already closed
-- =====================================================================
begin;
select plan(41);
\set now '2026-09-28 12:00:00+01'
\ir _shared/fixtures.psql

\set pri  'd6780000-0000-4000-8000-000000000001'
\set ben  'd6780000-0000-4000-8000-000000000002'
\set cara 'd6780000-0000-4000-8000-000000000003'
\set dan  'd6780000-0000-4000-8000-000000000004'
\set finn 'd6780000-0000-4000-8000-000000000005'

-- Priya's documents
\set p_pass      'e6780000-0000-4000-8000-000000000001'
\set p_visa      'e6780000-0000-4000-8000-000000000002'
\set p_share     'e6780000-0000-4000-8000-000000000003'
\set p_share_old 'e6780000-0000-4000-8000-000000000004'
\set p_term      'e6780000-0000-4000-8000-000000000005'
\set p_cl        'e6780000-0000-4000-8000-000000000006'
\set p_pend      'e6780000-0000-4000-8000-000000000011'
\set p_rej       'e6780000-0000-4000-8000-000000000012'
\set p_sup       'e6780000-0000-4000-8000-000000000013'
\set p_ni        'e6780000-0000-4000-8000-000000000014'
\set p_share_new 'e6780000-0000-4000-8000-000000000015'
\set p_rej_sup   'e6780000-0000-4000-8000-000000000016'
-- Ben's
\set b_birth     'e6780000-0000-4000-8000-000000000021'
\set b_ni        'e6780000-0000-4000-8000-000000000022'
-- Cara's
\set c_pass      'e6780000-0000-4000-8000-000000000031'
\set c_share     'e6780000-0000-4000-8000-000000000032'
-- Dan's
\set d_birth_p   'e6780000-0000-4000-8000-000000000041'
\set d_birth_r   'e6780000-0000-4000-8000-000000000042'
\set d_ni        'e6780000-0000-4000-8000-000000000043'
-- Finn's
\set f_pass      'e6780000-0000-4000-8000-000000000051'

-- Checks
\set chk_done    'f6780000-0000-4000-8000-000000000001'
\set chk_open    'f6780000-0000-4000-8000-000000000002'
\set chk_new     'f6780000-0000-4000-8000-000000000003'
\set chk_cara    'f6780000-0000-4000-8000-000000000004'
\set chk_run     'f6780000-0000-4000-8000-000000000005'
\set chk_failed  'f6780000-0000-4000-8000-000000000006'

insert into staff (id, employee_id, contract_signed_at, left_at, first_name, last_name, email, phone,
                   dob, status, rtw_branch, share_code) values
  (:'pri', 96781, timestamptz '2025-01-10 10:00+00', timestamptz '2026-06-30 18:00+01',
   'Priya', 'Shah', 'priya@678.test', '+447700967801', date '1994-02-02', 'inactive', 'work_visa', 'W67800001'),
  (:'ben', 96782, timestamptz '2025-03-01 10:00+00', null,
   'Ben', 'Hart', 'ben@678.test', '+447700967802', date '1990-05-05', 'compliant', 'uk_irish', null),
  (:'cara', null, null, null,
   'Cara', 'Diaz', 'cara@678.test', '+447700967803', date '2000-08-08', 'documents', 'work_visa', 'W67800003'),
  (:'dan', 96784, timestamptz '2025-04-01 10:00+00', null,
   'Dan', 'Okoro', 'dan@678.test', '+447700967804', date '1992-07-07', 'compliant', 'uk_irish', null),
  (:'finn', 96785, timestamptz '2023-01-10 10:00+00', timestamptz '2024-06-30 18:00+01',
   'Finn', 'Byrne', 'finn@678.test', '+447700967805', date '1991-03-03', 'inactive', 'uk_irish', null);

insert into compliance_docs (id, staff_id, doc_type, review_status, reviewed_at, rejection_reason,
                             file_path, gov_report_path, share_code, ai_extracted, expiry_date,
                             right_to_work_until, uploaded_at) values
  -- Relied on: verified (one of them long expired), or verified and then
  -- superseded by a reset. HELD.
  (:'p_pass', :'pri', 'passport', 'verified', timestamptz '2025-01-05 10:00+00', null,
   :'pri' || '/passport/p.pdf', null, null, '{"name": "PRIYA SHAH", "number": "123456789"}',
   date '2031-01-01', null, timestamptz '2025-01-04 10:00+00'),
  (:'p_visa', :'pri', 'visa_document', 'verified', timestamptz '2025-01-05 10:00+00', null,
   :'pri' || '/visa/v.pdf', null, null, null,
   date '2026-01-31', null, timestamptz '2025-01-04 10:00+00'),
  (:'p_share', :'pri', 'share_code_report', 'verified', timestamptz '2025-01-06 10:00+00', null,
   :'pri' || '/share-code/s.pdf', :'pri' || '/share-code-report/gov.pdf', 'W67800001',
   '{"shareCode": "W67800001"}', null, date '2027-12-31', timestamptz '2025-01-05 10:00+00'),
  (:'p_share_old', :'pri', 'share_code_report', 'superseded', timestamptz '2024-06-01 10:00+00', null,
   null, :'pri' || '/share-code-report/gov-2024.pdf', 'W67800000', null,
   null, date '2025-12-31', timestamptz '2024-05-30 10:00+00'),
  (:'p_term', :'pri', 'university_term_dates_letter', 'verified', timestamptz '2025-01-05 10:00+00', null,
   :'pri' || '/term-letter/t.pdf', null, null, null,
   null, null, timestamptz '2025-01-04 10:00+00'),
  -- The completion letter: ADR-0019's rule, whatever its status.
  (:'p_cl', :'pri', 'university_completion_letter', 'pending', null, null,
   :'pri' || '/completion-letter/c.pdf', null, null, '{"completionDate": "2026-06-20"}',
   null, null, timestamptz '2026-06-21 10:00+00'),
  -- Never relied on, or not right-to-work evidence. DELETED.
  (:'p_pend', :'pri', 'passport', 'pending', null, null,
   :'pri' || '/passport/new.pdf', null, null, null, null, null, timestamptz '2026-06-01 10:00+00'),
  (:'p_rej', :'pri', 'visa_document', 'rejected', timestamptz '2025-01-02 10:00+00', 'Blurred — upload again',
   :'pri' || '/visa/blurred.pdf', null, null, null, null, null, timestamptz '2025-01-01 10:00+00'),
  (:'p_sup', :'pri', 'status_document', 'superseded', null, null,
   :'pri' || '/status/s.pdf', null, null, null, null, null, timestamptz '2024-12-01 10:00+00'),
  (:'p_ni', :'pri', 'ni_evidence', 'verified', timestamptz '2025-01-05 10:00+00', null,
   :'pri' || '/ni/p60.pdf', null, null, null, null, null, timestamptz '2025-01-04 10:00+00'),
  (:'p_share_new', :'pri', 'share_code_report', 'pending', null, null,
   null, :'pri' || '/share-code-report/gov-new.pdf', null, null, null, null, timestamptz '2026-06-02 10:00+00'),
  -- Rejected, THEN superseded by a reset: stamped, but with its reason.
  (:'p_rej_sup', :'pri', 'passport', 'superseded', timestamptz '2024-11-02 10:00+00', 'Photo page cut off',
   :'pri' || '/passport/cut.pdf', null, null, null, null, null, timestamptz '2024-11-01 10:00+00'),
  -- Ben: List A's birth certificate + NI document pair. Both HELD.
  (:'b_birth', :'ben', 'birth_certificate', 'verified', timestamptz '2025-02-20 10:00+00', null,
   :'ben' || '/birth-certificate/b.pdf', null, null, null, null, null, timestamptz '2025-02-19 10:00+00'),
  (:'b_ni', :'ben', 'ni_evidence', 'verified', timestamptz '2025-02-20 10:00+00', null,
   :'ben' || '/ni/letter.pdf', null, null, null, null, null, timestamptz '2025-02-19 10:00+00'),
  -- Cara: verified, but she was never employed. DELETED.
  (:'c_pass', :'cara', 'passport', 'verified', timestamptz '2026-09-20 10:00+00', null,
   :'cara' || '/passport/p.pdf', null, null, null, date '2032-01-01', null, timestamptz '2026-09-19 10:00+00'),
  (:'c_share', :'cara', 'share_code_report', 'verified', timestamptz '2026-09-21 10:00+00', null,
   null, :'cara' || '/share-code-report/gov.pdf', 'W67800003', null, null, date '2028-01-01',
   timestamptz '2026-09-20 10:00+00'),
  -- Dan: a birth certificate pending, another rejected — never relied on.
  (:'d_birth_p', :'dan', 'birth_certificate', 'pending', null, null,
   :'dan' || '/birth-certificate/new.pdf', null, null, null, null, null, timestamptz '2026-09-01 10:00+00'),
  (:'d_birth_r', :'dan', 'birth_certificate', 'rejected', timestamptz '2025-03-20 10:00+00', 'Not a full certificate',
   :'dan' || '/birth-certificate/short.pdf', null, null, null, null, null, timestamptz '2025-03-19 10:00+00'),
  (:'d_ni', :'dan', 'ni_evidence', 'verified', timestamptz '2025-03-20 10:00+00', null,
   :'dan' || '/ni/p60.pdf', null, null, null, null, null, timestamptz '2025-03-19 10:00+00'),
  -- Finn: verified, but his employment ended more than two years ago.
  (:'f_pass', :'finn', 'passport', 'verified', timestamptz '2023-01-05 10:00+00', null,
   :'finn' || '/passport/p.pdf', null, null, null, date '2030-01-01', null, timestamptz '2023-01-04 10:00+00');

-- The automated checks. Every check starts queued (rtw_checks_insert_guard)
-- and moves only along rtw_check_transitions().
insert into rtw_checks (id, staff_id, compliance_doc_id) values
  (:'chk_done', :'pri',  :'p_share'),
  (:'chk_new',  :'pri',  :'p_share_new'),
  (:'chk_cara', :'cara', :'c_share');
update rtw_checks set status = 'running' where id in (:'chk_done', :'chk_new', :'chk_cara');
update rtw_checks
   set status = 'needs_review', source = 'govuk', outcome = 'right_to_work', recommendation = 'verify',
       result = '{"outcome": "right_to_work", "source": "govuk", "fullName": "PRIYA SHAH", "rightToWorkUntil": "2027-12-31", "conditions": "Work permitted"}',
       report_path = case id when :'chk_done' then :'pri' || '/share-code-report/rtw-check-done.pdf'
                             when :'chk_new'  then :'pri' || '/share-code-report/rtw-check-new.pdf'
                             else :'cara' || '/share-code-report/rtw-check-cara.pdf' end,
       photo_path  = case id when :'chk_done' then :'pri' || '/share-code-report/rtw-check-done-photo.png'
                             when :'chk_new'  then :'pri' || '/share-code-report/rtw-check-new-photo.png'
                             else :'cara' || '/share-code-report/rtw-check-cara-photo.png' end,
       review_reason = 'gov.uk shows PRIYA SHAH; the profile says Priya Shah-Khan',
       worker_reason = 'Priya, please re-enter your share code',
       suggested_reason = 'Priya, please re-enter your share code',
       error = 'retry 1: page timeout for Priya Shah',
       reviewed_at = timestamptz '2025-01-06 10:00+00', finished_at = timestamptz '2025-01-06 09:00+00'
 where id in (:'chk_done', :'chk_new', :'chk_cara');
-- A "Run check again" still waiting on the held share code.
insert into rtw_checks (id, staff_id, compliance_doc_id) values (:'chk_open', :'pri', :'p_share');
-- On the other held share code: one check mid-run (the runner has filed
-- its report and photo) and an earlier one that failed after its report.
insert into rtw_checks (id, staff_id, compliance_doc_id) values (:'chk_failed', :'pri', :'p_share_old');
update rtw_checks set status = 'running' where id = :'chk_failed';
update rtw_checks
   set status = 'failed', source = 'govuk', outcome = 'error',
       report_path = :'pri' || '/share-code-report/rtw-check-failed.pdf',
       error = 'gave up after 5 attempts for Priya Shah', review_reason = 'Priya Shah could not be checked',
       finished_at = timestamptz '2024-06-01 09:00+00'
 where id = :'chk_failed';
insert into rtw_checks (id, staff_id, compliance_doc_id) values (:'chk_run', :'pri', :'p_share_old');
update rtw_checks
   set status = 'running',
       report_path = :'pri' || '/share-code-report/rtw-check-run.pdf',
       photo_path  = :'pri' || '/share-code-report/rtw-check-run-photo.png'
 where id = :'chk_run';

create temporary table t_pri as select remove_worker(:'pri', :'now'::timestamptz) as r;

-- =====================================================================
-- 1 · Priya: what is held, until when
-- =====================================================================
select is((select (r ->> 'documentsHeld') || '/' || (r ->> 'documentsDeleted') from t_pri), '6/6',
  'an employed worker''s relied-on right-to-work evidence and completion letter are held (6), the rest deleted (6)');
select bag_eq(
  format($$ select id from compliance_docs where staff_id = %L $$, :'pri'),
  format($$ values (%L::uuid), (%L), (%L), (%L), (%L), (%L) $$,
         :'p_pass', :'p_visa', :'p_share', :'p_share_old', :'p_term', :'p_cl'),
  'held: the verified passport (expired or not), visa, share-code report, a share code verified then superseded by a reset, the term letter and the completion letter');
select is((select array_agg(distinct retain_until) from compliance_docs where staff_id = :'pri'),
  array[date '2028-06-30'],
  'every held row carries retain_until = the day she left + 2 years (UK date)');
select is((select r ->> 'retainUntil' from t_pri), '2028-06-30', 'and the removal reports that date');
select is((select data ->> 'documentsHeld' from audit_log where action = 'gdpr_remove' and entity_id = :'pri'), '6',
  'the gdpr_remove audit row counts what was held');

select is((select count(*)::int from compliance_docs where id in (:'p_pend', :'p_rej', :'p_sup', :'p_share_new')), 0,
  'a pending, a rejected and a never-decided superseded upload are deleted: nothing was ever relied on them');
select is((select count(*)::int from compliance_docs where id = :'p_ni'), 0,
  'NI evidence without a birth certificate is payroll evidence, not a right-to-work check: deleted');
select is((select count(*)::int from compliance_docs where id = :'p_rej_sup'), 0,
  'a row rejected and THEN superseded by a reset is deleted: reviewed, but its rejection reason says it was never relied on');

-- The held rows keep the evidence and lose what is not.
select results_eq(
  format($$ select review_status::text, reviewed_at, file_path, gov_report_path, right_to_work_until
              from compliance_docs where id = %L $$, :'p_share'),
  format($$ values ('verified'::text, timestamptz '2025-01-06 10:00+00', %L::text, %L::text, date '2027-12-31') $$,
         :'pri' || '/share-code/s.pdf', :'pri' || '/share-code-report/gov.pdf'),
  'the held share code keeps its status, when it was verified, its file, its gov.uk report and the date confirmed');
select is((select count(*)::int from compliance_docs
            where staff_id = :'pri' and doc_type <> 'university_completion_letter'
              and (share_code is not null or ai_extracted is not null)), 0,
  'but the right-to-work rows lose the share code and the raw extraction — neither is the Home Office''s copy');
select is((select ai_extracted ->> 'completionDate' from compliance_docs where id = :'p_cl'), '2026-06-20',
  'the completion letter row is untouched, as ADR-0019 left it');

-- =====================================================================
-- 2 · Priya: the gov.uk checks
-- =====================================================================
select bag_eq(
  format($$ select id from rtw_checks where staff_id = %L $$, :'pri'),
  format($$ values (%L::uuid), (%L) $$, :'chk_done', :'chk_failed'),
  'the finished checks on held share codes stay — a failed one too, it is a record of a check run; the queued and running ones on them, and the one on the deleted upload, go');
select results_eq(
  format($$ select status, outcome, recommendation, result ->> 'fullName', report_path, photo_path, reviewed_at
              from rtw_checks where id = %L $$, :'chk_done'),
  format($$ values ('needs_review'::text, 'right_to_work'::text, 'verify'::text, 'PRIYA SHAH'::text,
                    %L::text, %L::text, timestamptz '2025-01-06 10:00+00') $$,
         :'pri' || '/share-code-report/rtw-check-done.pdf', :'pri' || '/share-code-report/rtw-check-done-photo.png'),
  'it keeps the evidence of the check: outcome, the name gov.uk returned, the report, the photo compared, when it was decided');
select is((select count(*)::int from rtw_checks
            where staff_id = :'pri'
              and (review_reason is not null or worker_reason is not null
                   or suggested_reason is not null or error is not null)), 0,
  'and they lose their free text — the office''s reason, the N8 wording and the runner''s error can name the worker');
select results_eq(
  format($$ select status, outcome, report_path from rtw_checks where id = %L $$, :'chk_failed'),
  format($$ values ('failed'::text, 'error'::text, %L::text) $$, :'pri' || '/share-code-report/rtw-check-failed.pdf'),
  'the failed check keeps its status, outcome and the report it filed');

-- =====================================================================
-- 3 · Priya: Storage
-- =====================================================================
select bag_eq(
  format($$ select retained_storage_paths(%L) $$, :'pri'),
  format($$ values (%L::text), (%L), (%L), (%L), (%L), (%L), (%L), (%L), (%L), (%L) $$,
         :'pri' || '/passport/p.pdf', :'pri' || '/visa/v.pdf', :'pri' || '/share-code/s.pdf',
         :'pri' || '/share-code-report/gov.pdf', :'pri' || '/share-code-report/gov-2024.pdf',
         :'pri' || '/term-letter/t.pdf', :'pri' || '/completion-letter/c.pdf',
         :'pri' || '/share-code-report/rtw-check-done.pdf',
         :'pri' || '/share-code-report/rtw-check-done-photo.png',
         :'pri' || '/share-code-report/rtw-check-failed.pdf'),
  'the prefix sweep keeps every held file: documents, gov.uk reports, the kept checks'' reports and photo');
select is((select count(*)::int from storage_deletions
            where not prefix and path in (select retained_storage_paths(:'pri'))), 0,
  'and none of them is queued for deletion');
select bag_eq(
  format($$ select path from storage_deletions where staff_id = %L and not prefix $$, :'pri'),
  format($$ values (%L::text), (%L), (%L), (%L), (%L), (%L), (%L), (%L), (%L), (%L) $$,
         :'pri' || '/passport/new.pdf', :'pri' || '/visa/blurred.pdf', :'pri' || '/status/s.pdf',
         :'pri' || '/ni/p60.pdf', :'pri' || '/share-code-report/gov-new.pdf',
         :'pri' || '/passport/cut.pdf',
         :'pri' || '/share-code-report/rtw-check-new.pdf',
         :'pri' || '/share-code-report/rtw-check-new-photo.png',
         :'pri' || '/share-code-report/rtw-check-run.pdf',
         :'pri' || '/share-code-report/rtw-check-run-photo.png'),
  'what was not held is queued by name — the deleted checks'' reports and photos (the running one''s included) through their delete trigger');
select is((select count(*)::int from storage_deletions where staff_id = :'pri' and prefix), 2,
  'and the two folders are queued as prefixes, as before');

-- =====================================================================
-- 4 · Ben: the birth-certificate route
-- =====================================================================
select is((remove_worker(:'ben', :'now'::timestamptz) ->> 'documentsHeld')::int, 2,
  'List A: a UK birth certificate is held with the NI document that completes it');
select is((select array_agg(distinct retain_until) from compliance_docs where staff_id = :'ben'),
  array[date '2028-09-28'],
  'he never left, so employment ended at the removal: held two years from that UK date');

-- =====================================================================
-- 5 · Cara: never employed
-- =====================================================================
select is((remove_worker(:'cara', :'now'::timestamptz) ->> 'documentsHeld')::int, 0,
  'a candidate never employed has no employment to retain against: nothing is held');
select is((select count(*)::int from compliance_docs where staff_id = :'cara')
          + (select count(*)::int from rtw_checks where staff_id = :'cara'), 0,
  'her verified passport, share code and its check are all deleted');
select bag_eq(
  format($$ select path from storage_deletions where staff_id = %L and not prefix $$, :'cara'),
  format($$ values (%L::text), (%L), (%L), (%L) $$,
         :'cara' || '/passport/p.pdf', :'cara' || '/share-code-report/gov.pdf',
         :'cara' || '/share-code-report/rtw-check-cara.pdf',
         :'cara' || '/share-code-report/rtw-check-cara-photo.png'),
  'and every file of hers is queued, the check''s report and photo included');
select is_empty(format($$ select retained_storage_paths(%L) $$, :'cara'),
  'and the prefix sweep keeps nothing of hers');

-- =====================================================================
-- 5b · Dan: an NI document whose birth certificate was never relied on
-- =====================================================================
select is((remove_worker(:'dan', :'now'::timestamptz) ->> 'documentsHeld')::int, 0,
  'a pending and a rejected birth certificate are not held, so neither is the NI document beside them');
select is((select count(*)::int from compliance_docs where staff_id = :'dan'), 0,
  'all three are deleted');

-- =====================================================================
-- 5c · Finn: the window closed before the removal
-- =====================================================================
create temporary table t_finn as select remove_worker(:'finn', :'now'::timestamptz) as r;
select is((select (r ->> 'documentsHeld') || '/' || coalesce(r ->> 'retainUntil', '-') from t_finn), '0/-',
  'employed, but he left more than two years ago: employment + 2 years has already run, nothing is held');
select is((select count(*)::int from compliance_docs where staff_id = :'finn')
          + (select count(*)::int from storage_deletions
              where staff_id = :'finn' and path = :'finn' || '/passport/p.pdf'), 1,
  'his verified passport is deleted and its file queued');

-- =====================================================================
-- 6 · The purge, when the window closes
-- =====================================================================
select is((rtw_daily(timestamptz '2028-06-29 12:00+01') ->> 'retentionPurged')::int, 0,
  'the day before the window closes nothing is purged');
select is((select count(*)::int from compliance_docs where staff_id = :'pri'), 6, 'Priya''s evidence is still held');

select is((rtw_daily(timestamptz '2028-06-30 12:00+01') ->> 'retentionPurged')::int, 6,
  'on retain_until the daily job purges all six held rows');
select is((select count(*)::int from compliance_docs where staff_id = :'pri')
          + (select count(*)::int from rtw_checks where staff_id = :'pri'), 0,
  'the rows go, and the held check with its document');
select is((select count(*)::int from (
            values (:'pri' || '/passport/p.pdf'), (:'pri' || '/visa/v.pdf'), (:'pri' || '/share-code/s.pdf'),
                   (:'pri' || '/share-code-report/gov.pdf'), (:'pri' || '/share-code-report/gov-2024.pdf'),
                   (:'pri' || '/term-letter/t.pdf'), (:'pri' || '/completion-letter/c.pdf'),
                   (:'pri' || '/share-code-report/rtw-check-done.pdf'),
                   (:'pri' || '/share-code-report/rtw-check-done-photo.png'),
                   (:'pri' || '/share-code-report/rtw-check-failed.pdf')) held(p)
           where not exists (select 1 from storage_deletions s
                              where s.bucket = 'documents' and s.path = held.p and not s.prefix)), 0,
  'every held file is now queued for gdpr-purge: documents, gov.uk reports, and the kept checks'' reports and photo (their delete trigger)');
select is_empty(format($$ select retained_storage_paths(%L) $$, :'pri'),
  'and the prefix sweep keeps nothing of hers any more');
select is((select count(*)::int from audit_log where action = 'rtw.purged' and data ->> 'staffId' = :'pri'), 5,
  'each right-to-work document''s purge is on the audit trail');
select is((select count(*)::int from audit_log
            where action = 'completion_letter.purged' and data ->> 'staffId' = :'pri'), 1,
  'and the completion letter''s, by its own trigger, as before');
select is((select count(*)::int from compliance_evidence_audit_v
            where staff_id = :'pri' and record_type = 'rtw' and event = 'purged'), 5,
  'AC7: the purges are in the compliance evidence export');
select is((select count(*)::int from compliance_docs where staff_id = :'ben'), 2,
  'Ben''s window has not closed: his evidence is untouched');
select is((rtw_daily(timestamptz '2028-09-28 12:00+01') ->> 'retentionPurged')::int, 2,
  'and it goes on his own date');
select is((select count(*)::int from storage_deletions
            where path in (:'ben' || '/birth-certificate/b.pdf', :'ben' || '/ni/letter.pdf')), 2,
  'with its files queued');

select * from finish();
rollback;
