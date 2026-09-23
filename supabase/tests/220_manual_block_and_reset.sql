-- =====================================================================
-- 220 · The manager's three buttons (§9.6, §2.12)
--   block_worker_manually(), unblock_worker(), reset_to_candidate()
--   from 20260921183945_manual_block_and_reset.sql
--
-- What makes these worth their own file is that each one is a place the
-- obvious implementation is wrong:
--
--   Block    without a mandatory reason is an auto-block wearing the
--            wrong label, and the manager who reopens the profile later
--            has nothing to decide on (§4.3)
--   Unblock  is not `set status = compliant`. §4.3: "Pressing it runs the
--            same full compliance check described above before the block
--            is actually lifted." And a manager who presses it and sees
--            nothing happen has been told nothing.
--   Reset    keeps the Employee ID and the history, and supersedes the
--            evidence WITHOUT deleting it. Each half is a separate way to
--            get it wrong: delete the evidence and the previous period is
--            unauditable; keep it live and it satisfies the new check.
-- =====================================================================
begin;
select plan(25);
\set now '2026-09-21 12:00:00+01'
\ir _shared/fixtures.psql

\set clean 'd9000000-0000-4000-8000-000000000001'
\set stale 'd9000000-0000-4000-8000-000000000002'
\set gone  'd9000000-0000-4000-8000-000000000003'

-- 20260926120000: blanking a verified right-to-work date needs the owner-only escape.
set local thc.allow_rtw_date_clear = 'on';
update compliance_docs set expiry_date = null, right_to_work_until = null, uploaded_at = :'now'::timestamptz;
set local thc.allow_rtw_date_clear = 'off';
update staff set right_to_work_until = null, term_dates = '{}';

insert into staff (id, first_name, last_name, email, phone, dob, status, rtw_branch,
                   employee_id, graduated_at, term_dates, wtr_optout, share_code,
                   contract_signed_at, contract_version, quiz_attempts) values
  (:'clean','Clean','One',  'mb1@rls.test','+447700900301', date '1995-01-01','compliant','uk_irish',
   90301, null, '{}', false, null, '2026-01-01 10:00+00','v1.2', 2),
  -- A student who graduated, opted out and holds a dead passport: every
  -- piece of evidence a reset has to supersede, in one person.
  (:'stale','Stale','Two',  'mb2@rls.test','+447700900302', date '1995-01-01','compliant','international_student',
   90302, date '2026-06-30', '{"[2026-06-15,2026-09-28)"}', true, 'W123456AB', '2026-01-01 10:00+00','v1.2', 3),
  (:'gone', 'Left','Three', 'mb3@rls.test','+447700900303', date '1995-01-01','inactive','uk_irish',
   90303, null, '{}', false, null, '2026-01-01 10:00+00','v1.2', 1);

insert into compliance_docs (id, staff_id, doc_type, review_status, expiry_date, uploaded_at) values
  ('e9000000-0000-4000-8000-000000000001', :'clean','passport','verified', date '2031-01-01', :'now'::timestamptz),
  ('e9000000-0000-4000-8000-000000000002', :'stale','passport','verified', date '2026-09-20', :'now'::timestamptz);
insert into criminal_declarations (id, staff_id, source, answer, review_status) values
  ('f9000000-0000-4000-8000-000000000001', :'stale','onboarding', false, 'verified');
insert into hmrc_checklists (staff_id, q1_other_job, statement, declared)
values (:'stale', false, 'A', true);

-- ---------------------------------------------------------------------
-- Block (§9.6): human-triggered, always means something went wrong.
-- ---------------------------------------------------------------------
select throws_ok(
  format('select block_worker_manually(%L, %L, %L::timestamptz)', :'clean', '   ', :'now'),
  'reason_required',
  '§4.3: a manual block "requires a reason" — without one it is an auto-block wearing the wrong label');

select is((block_worker_manually(:'clean', 'Conduct under review', :'now'::timestamptz))->>'status', 'blocked',
  'Block runs the same §4.3 cascade as an expired document');
select is((select block_kind::text from staff where id = :'clean'), 'manual',
  'and records that a human pressed it, which is what keeps the automatic unblock off it');
select is((select block_reason from staff where id = :'clean'), 'Conduct under review',
  'the reason is saved, and shows on the profile as "Blocked — <reason>"');

-- ---------------------------------------------------------------------
-- Unblock (§9.6): the same full compliance check, first.
-- ---------------------------------------------------------------------
select is((unblock_worker(:'clean', date '2026-09-21'))->>'unblocked', 'true',
  'Unblock lifts a manual block when the profile is otherwise clean');
select is((select status::text || '/' || coalesce(block_kind::text, 'none') from staff where id = :'clean'),
  'compliant/none', 'and the kind and reason go with it');

select is((block_worker_manually(:'stale', 'Client asked us not to re-engage', :'now'::timestamptz))->>'status',
  'blocked', 'the second worker is blocked by hand too');
select is((unblock_worker(:'stale', date '2026-09-21'))->>'unblocked', 'false',
  '§4.3: pressing Unblock "runs the same full compliance check" — a dead passport underneath refuses it');
select is((unblock_worker(:'stale', date '2026-09-21'))->>'blockers', '["document_expired:passport"]',
  'and it says WHICH — a manager who presses Unblock and sees nothing happen has been told nothing');
select is((select status::text from staff where id = :'stale'), 'blocked',
  'the worker stays blocked, and their app stays locked to Documents');
select is(unblock_if_compliant(:'stale', date '2026-09-21'), false,
  'the automatic path still refuses a manual block outright, whatever the documents say');

-- ---------------------------------------------------------------------
-- Reset to candidate (§9.6, §2.12).
-- ---------------------------------------------------------------------
select throws_ok(
  format('select reset_to_candidate(%L, %L, %L::timestamptz)', :'stale', '', :'now'),
  'reason_required', 'a reset needs a reason too — the confirmation dialog states what is kept and what is cleared');

create temporary table t_reset as
  select reset_to_candidate(:'stale', 'Returning after a year away', :'now'::timestamptz) as r;

select is((select status::text from staff where id = :'stale'), 'interview_requested',
  '§2.12 step 1: the profile returns to the start of the onboarding pipeline and re-enters the kanban');
select is((select employee_id from staff where id = :'stale'), 90302,
  '§2.12 step 2: the Employee ID is RETAINED — one person, one ID across every period, so payroll and every historical timesheet still reconcile');
select is((select r->>'docsSuperseded' from t_reset), '1',
  '§2.12 step 3: every compliance document is superseded');
select is((select review_status::text from compliance_docs where id = 'e9000000-0000-4000-8000-000000000002'),
  'superseded', 'the dead passport among them');
select is((select count(*)::int from compliance_docs where staff_id = :'stale'), 1,
  'and it is RETAINED, read-only, as the record of what was held during the previous period — superseded is not deleted');
select is((select count(*)::int from current_verified_docs(:'stale')), 0,
  'while the new compliance check cannot see it: superseded evidence can never satisfy the new check');
select is((select superseded from criminal_declarations where id = 'f9000000-0000-4000-8000-000000000001'), true,
  'the criminal-convictions declaration goes with it — §2.12 says tax and criminal-record status may have changed');
select is((select superseded from hmrc_checklists where staff_id = :'stale'), true,
  'and the HMRC New Starter Checklist');
select is((select coalesce(contract_signed_at::text, 'none') || '/' || quiz_attempts::text from staff where id = :'stale'),
  'none/0', 'the signed contract and the quiz pass are cleared, so neither can satisfy §2.9 or §2.11 without being done again');

-- The consequence that is easy to miss: stale evidence that is still
-- driving a CALCULATED value (RULE-20).
select is((weekly_cap_for(:'stale', date '2026-09-21')).band::text, 'standard_48',
  'a superseded term letter and graduation stop driving the weekly cap — RULE-20 reads the profile live, so leaving them set would cap a candidate off evidence nobody may rely on');

select is((select data->>'reason' from audit_log where action = 'reset_to_candidate' and entity_id = :'stale'),
  'Returning after a year away', 'the manager''s reason is kept where the next manager will look');

-- §9.6: "available on a blocked, rejected or inactive profile".
select is((reset_to_candidate(:'gone', 'Came back to us', :'now'::timestamptz))->>'fromStatus', 'inactive',
  'a leaver can be reset — §2.12 makes this the ONLY way out of inactive, since right to work, tax and contract must all be re-established');
-- §9.6 is narrower than the transition table here. The table allows
-- `p_from = p_to`, an escape hatch so block_worker can re-block an
-- already-blocked worker without raising — which also let a second press
-- of Reset succeed on a candidate, clearing their contract and share code
-- and writing a second audit row. So the function states §9.6's own list.
select throws_ok(
  format('select reset_to_candidate(%L, %L, %L::timestamptz)', :'staffa', 'no', :'now'),
  'not_resettable: compliant',
  '§9.6: Reset is "available on a blocked, rejected or inactive profile" — a compliant worker is refused by name, not left to the transition table which would allow a candidate to be reset twice');

select * from finish();
rollback;
