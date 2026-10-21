-- =====================================================================
-- 918 · A staff member's verified letters corrected (ADR-0178,
--       20261022150100) — the case THC asked about, end to end
--
-- Prabin is STAFF. His term letter was verified with no dates (the AI
-- missed them) and his completion letter approved with a completion date
-- of 15/08/2026 — but the course restarts on 18/01/2027, so it should
-- never have been approved: graduated_at made his cap 48 h for good.
--
--   A · who may: an owner or a manager; not a scheduler, a viewer, a
--       worker or a client
--   B · Withdraw approval: the completion letter is superseded with its
--       reason, graduated_at and course_completion_date cleared, the
--       right to work kept, no N8, the unsent CL2 dropped, audited, the
--       term letter applies again and is the current one; a verified
--       completion letter leaves `verified` only for `superseded`
--   C · Correct term dates on the current verified term letter:
--       16/08/2026–17/01/2027 → 48 h the week of Monday 11/01/2027, 20 h
--       from Monday 18/01/2027; the expiry is the last printed day; the
--       ladder's receipts for the old expiry are cleared; audited
--   D · N14 the moment the band changes, and never twice
--
-- Verify-style checks run on the real clock, so the corrected ranges are
-- the office's holiday plus — only once today is within a week of
-- 17/01/2027 — a later holiday relative to today, so the suite keeps
-- running after January. Every row is rolled back.
-- =====================================================================
begin;
select plan(47);
\ir _shared/fixtures.psql

\set prabin    'c9180000-0000-4000-8000-00000000000a'
\set other     'c9180000-0000-4000-8000-00000000000b'
\set term_old  'c9181000-0000-4000-8000-00000000000a'
\set term      'c9181000-0000-4000-8000-00000000000b'
\set completion 'c9181000-0000-4000-8000-00000000000c'
\set other_cl  'c9181000-0000-4000-8000-00000000000d'
\set viewer    'c9182000-0000-4000-8000-000000000001'
\set manager   'c9182000-0000-4000-8000-000000000002'
\set scheduler 'c9182000-0000-4000-8000-000000000003'

insert into auth.users (id, email) values
  (:'viewer',    'viewer.918@rls.test'),
  (:'manager',   'manager.918@rls.test'),
  (:'scheduler', 'scheduler.918@rls.test');
insert into profiles (id, role, office_role, full_name) values
  (:'viewer',    'admin', 'viewer',    'Vera Viewer'),
  (:'manager',   'admin', 'manager',   'Mona Manager'),
  (:'scheduler', 'admin', 'scheduler', 'Sam Scheduler');

insert into staff (id, first_name, last_name, email, phone, dob, status, rtw_branch, wtr_optout,
                   term_dates, graduated_at, course_completion_date, right_to_work_until) values
  (:'prabin', 'Prabin', 'T', 'prabin@918.test', '+447700991801', date '2001-01-01', 'compliant',
   'international_student', false, '{}', date '2026-09-01', date '2026-08-15', date '2028-01-31'),
  (:'other',  'Other',  'G', 'other@918.test',  '+447700991802', date '2001-01-01', 'compliant',
   'international_student', false, '{}', date '2026-09-01', date '2026-08-15', date '2028-01-31');

insert into compliance_docs (id, staff_id, doc_type, uploaded_at, review_status, file_path, term_dates,
                             reviewed_by, reviewed_at, completion_date, confirmed_visa_expiry) values
  -- Last year's letter, kept as history.
  (:'term_old', :'prabin', 'university_term_dates_letter', now() - interval '400 days', 'verified',
   'documents/918/old.pdf', array[daterange(current_date - 380, current_date - 350)],
   :'admin_uid', now() - interval '399 days', null, null),
  -- This year's, verified with the dates the AI missed: none.
  (:'term', :'prabin', 'university_term_dates_letter', now() - interval '30 days', 'verified',
   'documents/918/term.pdf', '{}', :'admin_uid', now() - interval '29 days', null, null),
  (:'completion', :'prabin', 'university_completion_letter', now() - interval '20 days', 'verified',
   'documents/918/completion.pdf', null, :'admin_uid', now() - interval '19 days',
   date '2026-08-15', date '2028-01-31'),
  (:'other_cl', :'other', 'university_completion_letter', now() - interval '20 days', 'verified',
   'documents/918/other.pdf', null, :'admin_uid', now() - interval '19 days',
   date '2026-08-15', date '2028-01-31');

-- What N14 last told him (graduated, 48 h), and the CL2 that had not gone yet.
insert into cap_band_notices (staff_id, band, cap_hours, notified_on)
values (:'prabin', 'graduated_48', 48, current_date - 19);
insert into notification_outbox (key, channel, template, recipient_staff_id, payload)
values ('CL2:doc:' || :'completion', 'push', 'CL2', :'prabin', '{"variant":"dated"}');
-- The term letter's ladder, as if a rung had gone and one were queued.
insert into notification_outbox (key, channel, template, recipient_staff_id, payload, sent_at) values
  ('N1:doc:' || :'term', 'push', 'N1', :'prabin', '{}', now() - interval '1 day'),
  ('N2:doc:' || :'term', 'push', 'N2', :'prabin', '{}', null);

select (case when current_date < date '2027-01-10'
             then array['[2026-08-16,2027-01-18)'::daterange]
             else array['[2026-08-16,2027-01-18)'::daterange, daterange(current_date + 400, current_date + 430)]
        end)::text as ranges,
       (case when current_date < date '2027-01-10' then date '2027-01-17' else current_date + 429 end)::text
         as expires_on \gset

\set viewer_claims    '{"sub":"c9182000-0000-4000-8000-000000000001","role":"authenticated"}'
\set manager_claims   '{"sub":"c9182000-0000-4000-8000-000000000002","role":"authenticated"}'
\set scheduler_claims '{"sub":"c9182000-0000-4000-8000-000000000003","role":"authenticated"}'

select is(weekly_cap_band(:'prabin', date '2027-01-18')::text, 'graduated_48',
  'before: the wrongly approved completion letter has him at 48 h for good');
select is(term_letter_applies(:'prabin', current_date), false,
  'before: and the term letter no longer applies');

-- =====================================================================
-- A · Who may
-- =====================================================================
set local role authenticated;

set local "request.jwt.claims" = '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}';
select throws_like(format('select compliance_withdraw_completion_approval(%L, %L)', :'completion', 'x'),
  '%not_authorised%', 'A: a worker cannot withdraw an approval');
select throws_like(format('select compliance_correct_term_dates(%L, %L::daterange[], %L)', :'term',
                          '{"[2026-08-16,2027-01-18)"}', 'x'),
  '%not_authorised%', 'A: nor correct a term letter');

set local "request.jwt.claims" = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
select throws_like(format('select compliance_withdraw_completion_approval(%L, %L)', :'completion', 'x'),
  '%not_authorised%', 'A: a client cannot withdraw an approval');
select throws_like(format('select compliance_correct_term_dates(%L, %L::daterange[], %L)', :'term',
                          '{"[2026-08-16,2027-01-18)"}', 'x'),
  '%not_authorised%', 'A: nor correct a term letter');

set local "request.jwt.claims" = :'viewer_claims';
select throws_like(format('select compliance_withdraw_completion_approval(%L, %L)', :'completion', 'x'),
  '%not_permitted%', 'A: a viewer cannot withdraw an approval');
select throws_like(format('select compliance_correct_term_dates(%L, %L::daterange[], %L)', :'term',
                          '{"[2026-08-16,2027-01-18)"}', 'x'),
  '%not_permitted%', 'A: nor correct a term letter');

set local "request.jwt.claims" = :'scheduler_claims';
select throws_like(format('select compliance_withdraw_completion_approval(%L, %L)', :'completion', 'x'),
  '%not_permitted%', 'A: a scheduler cannot either — owners and managers only');

reset role;
select is((select review_status::text from compliance_docs where id = :'completion'), 'verified',
  'A: nothing refused moved the letter');

-- =====================================================================
-- B · Withdraw approval (a manager)
-- =====================================================================
set local "request.jwt.claims" = :'manager_claims';
set local role authenticated;
select throws_like(format('select compliance_withdraw_completion_approval(%L, %L)', :'completion', '  '),
  '%reason_required%', 'B: a withdrawal needs a reason');
select throws_like(format('select compliance_withdraw_completion_approval(%L, %L)', :'term', 'x'),
  '%not_a_completion_letter%', 'B: and only a completion letter is withdrawn');
select lives_ok(
  format('select compliance_withdraw_completion_approval(%L, %L)', :'completion',
         'Course resumes 18/01/2027 — not completed'),
  'B: a manager withdraws the approval');
select throws_like(format('select compliance_withdraw_completion_approval(%L, %L)', :'completion', 'again'),
  '%not_verified: superseded%', 'B: once — it is no longer an approval');
reset role;

select results_eq(
  format($$ select review_status::text, rejection_reason from compliance_docs where id = %L $$, :'completion'),
  $$ values ('superseded', 'Course resumes 18/01/2027 — not completed') $$,
  'B: the letter is superseded — kept, read-only, never current — with the reason on it');
select results_eq(
  format($$ select graduated_at, course_completion_date, right_to_work_until from staff where id = %L $$, :'prabin'),
  $$ values (null::date, null::date, date '2028-01-31') $$,
  'B: graduated_at and course_completion_date are cleared; the right to work is untouched');
select is(term_letter_applies(:'prabin', current_date), true,
  'B: the term letter applies again');
select is((select doc_id from current_verified_docs(:'prabin') where doc_type = 'university_term_dates_letter'),
  :'term'::uuid, 'B: and the latest verified term letter is the current one (the old one stays history)');
select is((select count(*)::int from notification_outbox where key like 'N8:%' || :'completion' || '%'), 0,
  'B: no "Document rejected — Re-upload" push');
select is((select count(*)::int from notification_outbox where key = 'CL2:doc:' || :'completion'), 0,
  'B: the unsent "48 hours from…" push is dropped');
select results_eq(
  format($$ select actor, data->>'reason', data->>'graduatedAtBefore', data->>'rightToWorkUntil'
              from audit_log where action = 'completion_letter.approval_withdrawn' and entity_id = %L $$,
         :'completion'),
  format($$ values (%L::uuid, 'Course resumes 18/01/2027 — not completed', '2026-09-01', '2028-01-31') $$,
         :'manager'),
  'B: audited — who, why, what it undid, and what it kept');
select is((select count(*)::int from audit_log
            where action = 'completion_letter.superseded' and entity_id = :'completion'
              and actor = :'manager' and data->>'reason' = 'Course resumes 18/01/2027 — not completed'), 1,
  'B: and the completion-letter evidence trail records the change of state');
select is(weekly_cap_hours(:'prabin', date '2027-01-18'), 20,
  'B: with no holiday dates on his term letter he is a term-time student again — 20 h');

-- The state machine, in the database.
select is(document_review_transition_allowed('university_completion_letter', 'verified', 'superseded'), true,
  'B: verified → superseded is a transition');
select is(document_review_transition_allowed('university_completion_letter', 'verified', 'rejected'), false,
  'B: verified → rejected is not, for a completion letter');
select is(document_review_transition_allowed('ni_evidence', 'verified', 'rejected'), true,
  'B: (it is for NI evidence — the NI check, D43)');
select is(document_review_transition_allowed('passport', 'verified', 'pending'), false,
  'B: nothing goes back to pending');
select throws_like(
  format($$update compliance_docs set review_status = 'pending' where id = %L$$, :'other_cl'),
  '%illegal_review_transition%',
  'B: a verified completion letter cannot be put back under review, whoever writes it');
select throws_like(
  format($$update compliance_docs set review_status = 'rejected', rejection_reason = 'x' where id = %L$$, :'other_cl'),
  '%illegal_review_transition%',
  'B: nor rejected (that would tell the worker to re-upload)');

-- =====================================================================
-- C · Correct term dates (the same manager)
-- =====================================================================
set local role authenticated;
select throws_like(
  format('select compliance_correct_term_dates(%L, %L::daterange[], %L)', :'term', :'ranges', ' '),
  '%note_required%', 'C: a correction needs a note');
select throws_like(
  format('select compliance_correct_term_dates(%L, %L::daterange[], %L)', :'term_old', :'ranges', 'x'),
  '%not_current_letter%', 'C: only the current letter is corrected — last year''s is history');
select throws_like(
  format('select compliance_correct_term_dates(%L, %L::daterange[], %L)', :'term', '{}', 'none'),
  '%no_holidays_not_confirmed%', 'C: no holidays at all must be confirmed explicitly');
select throws_like(
  format('select compliance_correct_term_dates(%L, %L::daterange[], %L)', :'term',
         array[daterange(current_date + 30, current_date + 30 + 400)], 'typo'),
  '%term_dates_implausible%', 'C: a period longer than a year is refused, as on Verify');
select throws_like(
  format('select compliance_correct_term_dates(%L, %L::daterange[], %L)', :'term',
         array[daterange(current_date - 60, current_date - 30)], 'past'),
  '%term_letter_expired%', 'C: so are dates that have all run out');
select lives_ok(
  format('select compliance_correct_term_dates(%L, %L::daterange[], %L)', :'term', :'ranges',
         'Course finished 15/08/2026, restarts 18/01/2027 — holiday missed by the AI'),
  'C: the manager corrects the term letter''s dates');
reset role;

select is((select term_dates from compliance_docs where id = :'term'), :'ranges'::daterange[],
  'C: compliance_docs.term_dates holds the corrected periods');
select is((select term_dates from staff where id = :'prabin'), :'ranges'::daterange[],
  'C: and so does staff.term_dates');
select is(weekly_cap_hours(:'prabin', date '2027-01-11'), 48,
  'C: the week of Monday 11/01/2027 is a holiday week — 48 h');
select is(weekly_cap_band(:'prabin', date '2027-01-11')::text, 'student_holiday_48',
  'C: in the holiday band, not the graduate''s');
select is(weekly_cap_hours(:'prabin', date '2027-01-18'), 20,
  'C: from Monday 18/01/2027 the course has restarted — 20 h');
select is(
  (select expires_on from current_verified_docs(:'prabin') where doc_type = 'university_term_dates_letter'),
  :'expires_on'::date,
  'C: the letter now expires on its last printed day (17/01/2027), not the calendar-year fallback');
select ok(
  not exists (select 1 from notification_outbox where key in ('N1:doc:' || :'term', 'N2:doc:' || :'term'))
  and exists (select 1 from notification_outbox where key like 'N1:doc:' || :'term' || ':until:%' and sent_at is not null),
  'C: the ladder for the old expiry is cleared — the sent rung kept under another key, the queued one dropped');
select results_eq(
  format($$ select actor, data->>'note', data->'from', data->'to', (data->>'expiresAfter')::date
              from audit_log where action = 'term_letter.dates_corrected' and entity_id = %L $$, :'term'),
  format($$ values (%L::uuid, 'Course finished 15/08/2026, restarts 18/01/2027 — holiday missed by the AI',
                    '[]'::jsonb, to_jsonb(%L::daterange[]::text[]), %L::date) $$,
         :'manager', :'ranges', :'expires_on'),
  'C: audited — who, the note, from what, to what, and the new expiry');

-- =====================================================================
-- D · N14
-- =====================================================================
select is((select band::text from cap_band_notices where staff_id = :'prabin'),
  weekly_cap_band(:'prabin', current_date)::text,
  'D: his receipt says what his week is now');
select ok(exists (select 1 from notification_outbox
                   where key = 'N14:staff:' || :'prabin' || ':student_term_20:' || current_date),
  'D: N14 went the moment the withdrawal took him off the graduate''s 48 h');
select is((select count(*)::int from notification_outbox
            where template = 'N14' and recipient_staff_id = :'prabin'
              and key = 'N14:staff:' || :'prabin' || ':' || weekly_cap_band(:'prabin', current_date) || ':' || current_date),
  1, 'D: and for the band his week is in now, exactly once');
select count(*)::int as n14_before from notification_outbox
 where template = 'N14' and recipient_staff_id = :'prabin' \gset
create temporary table t_daily on commit drop as select compliance_daily(now()) as counts;
select is((select count(*)::int from notification_outbox where template = 'N14' and recipient_staff_id = :'prabin'),
  :n14_before,
  'D: the daily run adds nothing for him — the receipt was already current');

select * from finish();
rollback;
