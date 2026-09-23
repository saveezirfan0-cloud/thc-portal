-- =====================================================================
-- One verify path, and a right-to-work date on every non-UK worker
-- (§2.3, §2.5, §2.6, §4.1–§4.4, RULE-20 / completion letter requirement
-- §2.3 "never beyond the visa expiry")
--
-- The defect this closes
-- ----------------------
-- Two sets of review functions acted on the same pending rows:
-- verify_document() / reject_document() / verify_declaration() /
-- reject_declaration() behind /onboarding/:id (20260923110000), and the
-- compliance_* four behind /compliance (20260923100000). The onboarding
-- set verified an already-expired document (§4.2 forbids it), verified
-- the documents of Rejected and Removed profiles (§4.1: theirs "no longer
-- need review") and never copied a share code's right-to-work date onto
-- the worker.
--
-- Worse, NEITHER path ever put a right-to-work date on a non-UK worker in
-- practice: nothing wrote staff.right_to_work_until from a visa or status
-- document, record_document_extraction() skipped the share code report,
-- and neither screen asked for the date. So every non-UK worker onboarded
-- had staff.right_to_work_until = NULL, and can_roster_staff() reads NULL
-- as "no expiry recorded" (20260922093100) — the per-shift hard stop, the
-- rtw_daily CL4 alerts and the rota guard's rtw_expired never saw them.
-- CLAUDE.md: right-to-work expiry outranks everything.
--
-- What this does
-- --------------
--   1. One body. verify_document() and friends are now thin wrappers over
--      the compliance_* functions, with the parameter names and types they
--      already had (Postgres will not rename a parameter in place). Both
--      screens therefore raise the same refusals, stamp the same reviewer,
--      queue the same N8 and fire the same row triggers. What stays
--      onboarding-only: the term dates are passed through only for the
--      term letter, the completion letter is refused with a pointer to
--      approve_completion_letter() (the requirement makes the reviewer
--      confirm two dates on it, §2.2), and the reply still carries
--      docId / staffId / status / quizUnlocked for the candidate screen.
--
--   2. The right-to-work date is required, on the ROW. A visa document, a
--      status document or a share code report cannot become `verified`
--      without a confirmed date (compliance_docs_rtw_date_guard), whatever
--      path flips it — either screen, an admin's direct PostgREST update
--      (admin_all reaches compliance_docs), a psql fix. The one exception
--      is below.
--
--   3. staff.right_to_work_until follows the evidence. Whenever one of
--      those three is verified, or a verified one's date changes, the
--      worker's date becomes the EARLIEST confirmed date across their
--      current verified right-to-work evidence (the latest verified row of
--      each of the three types) — compliance_docs_rtw_until, a row trigger
--      so it holds on every path, and named to fire BEFORE
--      compliance_docs_verified so the §4.3 re-check reads the new date.
--      Earliest, because a renewed visa with a stale share code is not a
--      renewed right to work: both must be current, and the side the civil
--      penalty sits on is the earlier one. compliance_daily already blocks
--      on whichever of them runs out first, so the hard stop and the block
--      now agree.
--
-- The decision, per branch (§2.5, §2.6)
-- -------------------------------------
--   1 UK / Irish       No right-to-work limit; nothing collected carries
--                      one. right_to_work_until stays NULL, correctly.
--   2 EU settled /     Share code report: a date, OR an explicit "no time
--     pre-settled      limit" confirmation. §2.5 pt 2 says "Pre-settled:
--                      expiry + reminders" — so pre-settled has a date and
--                      settled status (the EU scheme's indefinite leave)
--                      legitimately has none. The confirmation is explicit
--                      (the reviewer ticks it; the RPC receives the date
--                      'infinity'; the row stores rtw_no_time_limit = true
--                      and a NULL date) and is never inferred from a blank:
--                      a forgotten date must not read as "settled".
--   3 Work visa        Visa document: expiry required ("visa type +
--                      expiry (date)", §2.5 pt 3). Share code report: date
--                      required. No exception — every work visa ends.
--   4 International    Share code report: date required. A Student visa
--     student          always has an end date, and it is what the
--                      completion letter's release can never pass (§4.5).
--   5 Dependant /      Status document: expiry required ("visa / status
--     other            document (upload) + expiry", §2.5 pt 5; the wizard
--                      already refuses step 1 without it). Share code
--                      report: date required. Someone holding ILR under
--                      "other" is the case to be cautious about: the scope
--                      gives branch 5 an expiry without exception, so the
--                      database does too, and an ILR holder is recorded
--                      through the EU/settled route or record_right_to_
--                      work_change() by the office — never by leaving a
--                      date blank.
--   So: a verified right-to-work document with no date is REFUSED on every
--   non-UK branch, except a share code report on branch 2 carrying the
--   explicit no-time-limit confirmation.
--
-- Where the share code date comes from. §2.3 wants it read, not typed:
-- "the system queries gov.uk itself, gets back … the right-to-work expiry
-- date". ADR-0002's assisted check (no gov.uk API) has the office save the
-- report and the extractor read the date off it — so
-- record_document_extraction() now pre-fills right_to_work_until on a
-- share code report, and both screens show that date for the reviewer to
-- CONFIRM (or enter it from the report when no extractor has run). ADR-0018.
--
-- Also in this migration (same PR, docs/14 hot spot list)
-- -------------------------------------------------------
--   · onboarding_save_right_to_work() no longer writes wtr_optout
--     directly: ticking signs through the same body as sign_wtr_optout()
--     (signed_at, notice days, audit_log, CL5) and unticking gives notice
--     through the body of cancel_wtr_optout() (the ceiling returns at the
--     END of the notice period, CL6).
--   · sign_wtr_optout() / cancel_wtr_optout() act only for the worker
--     themself, or the service role. An opt-out is the worker's own
--     written agreement (Working Time Regulations reg. 5); staff_caller()
--     let an admin name any worker.
--   · The 5-argument onboarding_accept() is revoked from `authenticated`:
--     the office accepts through onboarding_accept_with_account()
--     (20260923180000), which calls it as owner.
--   · compliance_docs.size_bytes is THE size column. file_size (the
--     wizard's, 20260923120000) is backfilled into it and deprecated, not
--     dropped. onboarding_attach_document() now reads the size and content
--     type from the Storage object itself, through evidence_upload_problem(),
--     as the Documents hub does — never from the caller's metadata.
--
-- Forward-only. Nothing here edits an earlier migration.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1 · The explicit "no time limit" confirmation (branch 2, settled).
-- ---------------------------------------------------------------------
alter table compliance_docs
  add column if not exists rtw_no_time_limit boolean not null default false;

alter table compliance_docs drop constraint if exists compliance_docs_no_time_limit_share_code;
alter table compliance_docs add constraint compliance_docs_no_time_limit_share_code
  check (not rtw_no_time_limit or (doc_type = 'share_code_report' and right_to_work_until is null));

comment on column compliance_docs.rtw_no_time_limit is
  'Branch 2 only: the reviewer confirmed the gov.uk result shows settled status with no time limit (§2.5 pt 2). Only ever set with a NULL right_to_work_until on a share code report; never inferred from a missing date (20260923200000).';

-- ---------------------------------------------------------------------
-- 2 · One size column.
--
-- The hub (20260923100100) wrote size_bytes bigint from the Storage
-- object; the wizard (20260923120000) wrote file_size int from the
-- caller. size_bytes wins: it is the one read off Storage, and bigint is
-- what Storage records. file_size stays for live data safety.
-- ---------------------------------------------------------------------
update compliance_docs
   set size_bytes = file_size
 where size_bytes is null
   and file_size is not null;

comment on column compliance_docs.file_size is
  'DEPRECATED (20260923200000): use size_bytes. Kept, backfilled into size_bytes, and no longer written by anything.';
comment on column compliance_docs.size_bytes is
  'The uploaded object''s size in bytes as Storage recorded it (evidence_upload_problem), for every upload path — the wizard and the Documents hub alike.';

-- ---------------------------------------------------------------------
-- 3 · The date a right-to-work document confirms.
--
-- A share code report carries the gov.uk right-to-work-until; a visa or a
-- status document carries its expiry. Anything else is not right-to-work
-- evidence and has no date here. Deliberately NOT doc_expires_on(): that
-- falls back to the WORKER's date for a share code, which is exactly the
-- value this is about to recompute.
-- ---------------------------------------------------------------------
create or replace function public.rtw_doc_until(
  p_doc_type            doc_type,
  p_expiry              date,
  p_right_to_work_until date
) returns date
language sql
immutable
set search_path = public, extensions
as $$
  select case p_doc_type
    when 'share_code_report' then p_right_to_work_until
    when 'visa_document'     then p_expiry
    when 'status_document'   then p_expiry
    else null
  end
$$;

comment on function public.rtw_doc_until(doc_type, date, date) is
  'The right-to-work date a document confirms: a share code report''s right_to_work_until, a visa or status document''s expiry, null for anything else (20260923200000).';

-- The earliest confirmed date across the worker's CURRENT verified
-- right-to-work evidence: the latest verified row of each of the three
-- types. Nulls (a settled share code) contribute nothing, so a worker
-- whose only evidence is settled status gets NULL — no limit.
create or replace function public.rtw_evidence_until(p_staff uuid)
returns date
language sql
stable
set search_path = public, extensions
as $$
  select min(rtw_doc_until(d.doc_type, d.expiry_date, d.right_to_work_until))
    from (
      select distinct on (c.doc_type) c.doc_type, c.expiry_date, c.right_to_work_until
        from compliance_docs c
       where c.staff_id = p_staff
         and c.review_status = 'verified'
         and c.doc_type in ('visa_document', 'status_document', 'share_code_report')
       order by c.doc_type, c.uploaded_at desc, c.id
    ) d
$$;

comment on function public.rtw_evidence_until(uuid) is
  'staff.right_to_work_until as the evidence says it: the earliest date across the latest verified visa document, status document and share code report. Null when none carries a date (settled status, 20260923200000).';

-- ---------------------------------------------------------------------
-- 4 · On the row: no right-to-work document verified without its date.
-- ---------------------------------------------------------------------
create or replace function public.compliance_docs_rtw_date_guard()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_branch rtw_branch;
begin
  if new.rtw_no_time_limit then
    select rtw_branch into v_branch from staff where id = new.staff_id;
    if new.doc_type <> 'share_code_report' or v_branch is distinct from 'eu_settled' then
      raise exception 'no_time_limit_not_allowed: %', coalesce(v_branch::text, 'no branch')
        using errcode = 'P0001',
              hint = 'Only a share code report on the EU settled branch may be confirmed with no time limit (§2.5 pt 2).';
    end if;
  elsif rtw_doc_until(new.doc_type, new.expiry_date, new.right_to_work_until) is null then
    raise exception 'rtw_date_required: %', new.doc_type
      using errcode = 'P0001',
            hint = 'A visa document, status document or share code report is verified with the right-to-work date it confirms (§2.5, §2.6).';
  end if;
  return new;
end $$;

drop trigger if exists compliance_docs_rtw_date_guard on compliance_docs;
-- On the flip to verified. A later write to a verified row's dates is an
-- admin data fix (the pgTAP suites neutralise the seed that way) and is
-- not refused; the recompute below still follows it.
create trigger compliance_docs_rtw_date_guard
  before update of review_status on compliance_docs
  for each row
  when (new.doc_type in ('visa_document', 'status_document', 'share_code_report')
        and new.review_status = 'verified'
        and old.review_status is distinct from 'verified')
  execute function compliance_docs_rtw_date_guard();

-- ---------------------------------------------------------------------
-- 5 · On the row: the worker's date follows the evidence.
--
-- Named so it sorts before compliance_docs_verified: Postgres fires
-- same-event triggers in name order, and the §4.3 re-check that trigger
-- runs should see the worker's new date (a share code confirmed as
-- settled falls back to the worker's date in doc_expires_on).
-- ---------------------------------------------------------------------
create or replace function public.compliance_docs_rtw_until()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_until date;
begin
  if new.review_status = 'verified'
     and (old.review_status is distinct from 'verified'
          or new.expiry_date is distinct from old.expiry_date
          or new.right_to_work_until is distinct from old.right_to_work_until
          or new.rtw_no_time_limit is distinct from old.rtw_no_time_limit) then
    v_until := rtw_evidence_until(new.staff_id);
    update staff
       set right_to_work_until = v_until
     where id = new.staff_id
       and right_to_work_until is distinct from v_until;
  end if;
  return new;
end $$;

drop trigger if exists compliance_docs_rtw_until on compliance_docs;
create trigger compliance_docs_rtw_until
  after update of review_status, expiry_date, right_to_work_until, rtw_no_time_limit on compliance_docs
  for each row
  when (new.doc_type in ('visa_document', 'status_document', 'share_code_report'))
  execute function compliance_docs_rtw_until();

-- ---------------------------------------------------------------------
-- 5b · Live data: workers verified before this migration.
--
-- A visa or status document verified with an expiry, or a share code
-- verified with a date, never reached the worker. Put the evidence's
-- earliest date on them now — TIGHTENING ONLY: a worker who already has a
-- date keeps the earlier of the two, so this can bring a hard stop
-- forward and never push one back. Removed workers are left alone (their
-- evidence is wiped). Evidence verified with no date at all cannot be
-- repaired here; those workers are the ones to re-verify:
--
--   select s.id, s.employee_id, s.rtw_branch from staff s
--    where s.rtw_branch <> 'uk_irish' and s.removed_at is null
--      and s.status in ('compliant', 'blocked', 'documents', 'quiz', 'contract')
--      and s.right_to_work_until is null
--      and not exists (select 1 from compliance_docs d where d.staff_id = s.id
--                        and d.review_status = 'verified' and d.rtw_no_time_limit);
-- ---------------------------------------------------------------------
update staff s
   set right_to_work_until = least(coalesce(s.right_to_work_until, e.until), e.until)
  from (select st.id, rtw_evidence_until(st.id) as until from staff st
         where st.removed_at is null) e
 where e.id = s.id
   and e.until is not null
   and s.right_to_work_until is distinct from least(coalesce(s.right_to_work_until, e.until), e.until);

-- ---------------------------------------------------------------------
-- 6 · compliance_verify_document(), the one Verify.
--
-- As 20260923100000, plus:
--   · a right-to-work document needs its date (§2), confirmed here or
--     already on the row (the wizard's typed visa expiry, the extractor's
--     read of the gov.uk report) — refused up front with the same token
--     the row guard uses, so the screen can say what is missing;
--   · p_right_to_work_until = 'infinity' is the explicit "no time limit"
--     confirmation, share code report on branch 2 only; any other
--     infinite date is refused (the Radar subtracts dates);
--   · the already-expired check reads the confirmed date for a
--     right-to-work document, never the worker's old one;
--   · the worker's right_to_work_until is no longer written here — the
--     row trigger (§5) does it for every path;
--   · the verification of a right-to-work document is audited with the
--     date confirmed (§1.8), because it is now the input to the hard stop.
-- ---------------------------------------------------------------------
create or replace function public.compliance_verify_document(
  p_doc                 uuid,
  p_expiry              date        default null,
  p_term_dates          daterange[] default null,
  p_right_to_work_until date        default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_reviewer uuid := assert_reviewer();
  d          compliance_docs;
  s          staff;
  v_today    date := (now() at time zone 'Europe/London')::date;
  v_is_rtw   boolean;
  v_no_limit boolean := false;
  v_expiry   date;
  v_rtw      date;
  v_until    date;
  v_expires  date;
  v_blockers text[];
begin
  select * into d from compliance_docs where id = p_doc for update;
  if d.id is null then
    raise exception 'document_not_found' using errcode = 'P0002';
  end if;
  if d.doc_type = 'university_completion_letter' then
    -- The requirement (§2.2) makes the reviewer confirm the completion
    -- date and the visa expiry on this one, so it is approved through the
    -- function that asks for both.
    raise exception 'use_approve_completion_letter' using errcode = 'P0001';
  end if;
  if d.review_status <> 'pending' then
    raise exception 'not_pending: %', d.review_status using errcode = 'P0001';
  end if;

  select * into s from staff where id = d.staff_id for update;
  if s.status in ('rejected', 'removed') or s.removed_at is not null then
    -- §4.1: their outstanding documents "no longer need review".
    raise exception 'not_reviewable: %', s.status using errcode = 'P0001';
  end if;
  if p_term_dates is not null and exists (
       select 1 from unnest(p_term_dates) r where isempty(r) or lower_inf(r) or upper_inf(r)) then
    raise exception 'term_dates_invalid' using errcode = '22023';
  end if;

  v_is_rtw := d.doc_type in ('visa_document', 'status_document', 'share_code_report');

  if p_expiry is not null and not isfinite(p_expiry) then
    raise exception 'date_invalid' using errcode = '22023';
  end if;
  if p_right_to_work_until is not null and not isfinite(p_right_to_work_until) then
    if p_right_to_work_until < v_today or d.doc_type <> 'share_code_report'
       or s.rtw_branch is distinct from 'eu_settled' then
      raise exception 'no_time_limit_not_allowed: %', coalesce(s.rtw_branch::text, 'no branch')
        using errcode = 'P0001';
    end if;
    v_no_limit := true;
  end if;

  v_expiry := coalesce(p_expiry, d.expiry_date);
  v_rtw := case when v_no_limit then null
                else coalesce(p_right_to_work_until, d.right_to_work_until) end;

  if v_is_rtw then
    v_until := rtw_doc_until(d.doc_type, v_expiry, v_rtw);
    if v_until is null and not v_no_limit then
      raise exception 'rtw_date_required: %', d.doc_type using errcode = 'P0001';
    end if;
    v_expires := v_until;
  else
    v_expires := doc_expires_on(d.doc_type, v_expiry, v_rtw, s.right_to_work_until, d.uploaded_at);
  end if;
  if v_expires is not null and v_expires <= v_today then
    raise exception 'already_expired: %', v_expires using errcode = 'P0001';
  end if;

  if d.doc_type = 'university_term_dates_letter' then
    update staff set term_dates = coalesce(p_term_dates, d.term_dates, '{}')
     where id = s.id;
  elsif d.doc_type = 'share_code_report' and d.share_code is not null then
    update staff set share_code = d.share_code where id = s.id;
  end if;

  -- The flip. compliance_docs_rtw_until() writes the worker's date, then
  -- compliance_docs_verified() runs the §4.3 full re-check; nothing here
  -- second-guesses either.
  update compliance_docs
     set review_status = 'verified',
         reviewed_by = v_reviewer,
         reviewed_at = now(),
         expiry_date = v_expiry,
         term_dates = coalesce(p_term_dates, term_dates),
         right_to_work_until = v_rtw,
         rtw_no_time_limit = v_no_limit
   where id = d.id;

  if v_is_rtw then
    insert into audit_log (at, actor, action, entity, entity_id, data)
    values (now(), v_reviewer, 'rtw.verified', 'compliance_docs', d.id,
            jsonb_strip_nulls(jsonb_build_object(
              'staffId',          s.id,
              'employeeId',       s.employee_id,
              'branch',           s.rtw_branch,
              'docType',          d.doc_type::text,
              'confirmedUntil',   v_until,
              'noTimeLimit',      v_no_limit,
              'staffUntilBefore', s.right_to_work_until,
              'staffUntilAfter',  (select right_to_work_until from staff where id = s.id),
              'actorName',        (select full_name from profiles where id = v_reviewer))));
  end if;

  select array_agg(reason order by reason) into v_blockers
    from compliance_blockers(s.id, v_today);

  return jsonb_build_object(
    'verified', true,
    'documentId', d.id::text,
    'wasStatus', s.status::text,
    'status', (select status::text from staff where id = s.id),
    'unblocked', s.status = 'blocked'
                 and (select status from staff where id = s.id) = 'compliant',
    'rightToWorkUntil', (select right_to_work_until from staff where id = s.id),
    'blockers', coalesce(to_jsonb(v_blockers), '[]'::jsonb));
end $$;

comment on function public.compliance_verify_document(uuid, date, daterange[], date) is
  '§4.1 Verify, the only one (verify_document() wraps it). Pending documents of live profiles only; an already-expired one is refused (§4.2). A visa document, status document or share code report needs its right-to-work date (p_expiry / p_right_to_work_until, or already on the row); ''infinity'' as p_right_to_work_until confirms settled status with no time limit, share code report on the EU branch only. The flip sets staff.right_to_work_until to the earliest date across current verified RTW evidence (compliance_docs_rtw_until) and runs the §4.3 re-check. Not for the completion letter: approve_completion_letter().';

-- ---------------------------------------------------------------------
-- 7 · The onboarding screen's four, as wrappers.
--
-- Same names, parameter names and types as 20260923110000, so the grants
-- and the office's calls stand. Refusals are the compliance_* ones —
-- not_pending, not_reviewable, already_expired, rtw_date_required,
-- use_approve_completion_letter — so the two screens cannot disagree.
-- ---------------------------------------------------------------------
create or replace function public.verify_document(
  p_doc             uuid,
  p_expiry          date        default null,
  p_term_dates      daterange[] default null,
  p_completion_date date        default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_type   doc_type;
  v_staff  uuid;
  v_result jsonb;
begin
  -- The caller check first, so a non-admin learns nothing about the row.
  perform assert_reviewer();
  select doc_type, staff_id into v_type, v_staff from compliance_docs where id = p_doc;

  -- The candidate screen has one date field. On a share code report it is
  -- the gov.uk right-to-work-until; everywhere else it is the expiry.
  -- p_completion_date is kept for the signature only: a completion letter
  -- is refused by the body and approved with approve_completion_letter().
  if v_type = 'share_code_report' then
    v_result := compliance_verify_document(p_doc, null, null, p_expiry);
  else
    v_result := compliance_verify_document(
      p_doc, p_expiry,
      case when v_type = 'university_term_dates_letter' then p_term_dates end,
      null);
  end if;

  return v_result || jsonb_build_object(
    'docId',        p_doc::text,
    'staffId',      v_staff::text,
    'staffStatus',  v_result ->> 'status',
    'status',       'verified',
    'quizUnlocked', coalesce((select status = 'quiz' from staff where id = v_staff), false));
end $$;

comment on function public.verify_document(uuid, date, daterange[], date) is
  '§2.3 Verify from /onboarding/:id: a wrapper over compliance_verify_document() (20260923200000). p_expiry is the expiry, or on a share code report the right-to-work-until (''infinity'' = settled, no time limit, EU branch only). Term dates pass through for the term letter only. The completion letter is refused: approve_completion_letter(). The quiz unlocks by itself if this was the last item.';

create or replace function public.reject_document(p_doc uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_staff  uuid;
  v_result jsonb;
begin
  perform assert_reviewer();
  select staff_id into v_staff from compliance_docs where id = p_doc;
  v_result := compliance_reject_document(p_doc, p_reason);
  return v_result || jsonb_build_object('docId', p_doc::text, 'staffId', v_staff::text,
                                        'status', 'rejected');
end $$;

comment on function public.reject_document(uuid, text) is
  '§2.3 Reject from /onboarding/:id: a wrapper over compliance_reject_document() — mandatory reason, N8 keyed per document, refused for Rejected / Removed profiles (20260923200000).';

create or replace function public.verify_declaration(p_declaration uuid, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_staff  uuid;
  v_result jsonb;
begin
  perform assert_reviewer();
  select staff_id into v_staff from criminal_declarations where id = p_declaration;
  v_result := compliance_verify_declaration(p_declaration, p_note);
  return v_result || jsonb_build_object('declarationId', p_declaration::text,
                                        'staffId', v_staff::text, 'status', 'verified');
end $$;

comment on function public.verify_declaration(uuid, text) is
  '§2.3 / §2.10 Verify on a Yes declaration from /onboarding/:id: a wrapper over compliance_verify_declaration() (20260923200000). A No never reaches here — it is verified on insert.';

create or replace function public.reject_declaration(p_declaration uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_staff  uuid;
  v_result jsonb;
begin
  perform assert_reviewer();
  select staff_id into v_staff from criminal_declarations where id = p_declaration;
  v_result := compliance_reject_declaration(p_declaration, p_reason);
  return v_result || jsonb_build_object('declarationId', p_declaration::text,
                                        'staffId', v_staff::text, 'status', 'rejected');
end $$;

comment on function public.reject_declaration(uuid, text) is
  '§2.3 / §2.10 Reject on a Yes declaration from /onboarding/:id: a wrapper over compliance_reject_declaration() — N8 for an onboarding declaration, none for an in-employment one (§10.7), one key either way (20260923200000).';

-- ---------------------------------------------------------------------
-- 8 · The 48-hour opt-out is the worker's own agreement.
--
-- Working Time Regulations reg. 5: the opt-out is an agreement IN WRITING
-- with the worker. 20260923100100 resolved the subject through
-- staff_caller(p_staff), which lets an admin name any worker — so an
-- office session could sign a worker out of the 48-hour limit, or cancel
-- their opt-out, without them. Now: the signed-in worker acts for
-- themself, and only the service role (server-side tooling holding the
-- key, e.g. a signed paper copy imported by a job) may name someone.
--
-- The bodies move, unchanged, into two internal functions so the wizard's
-- step 1 (§9 below) signs and cancels through exactly the same code —
-- signed_at, notice days, audit_log, CL5 / CL6 — instead of writing the
-- flag.
-- ---------------------------------------------------------------------
create or replace function public.wtr_optout_subject(p_staff uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_self uuid;
begin
  if coalesce(auth.role(), '') = 'service_role' then
    return p_staff;
  end if;
  select id into v_self from staff where user_id = auth.uid() and auth.uid() is not null;
  if p_staff is not null and p_staff is distinct from v_self then
    -- An admin included: the office cannot sign or cancel for a worker.
    raise exception 'not_your_worker' using errcode = '42501';
  end if;
  return v_self;
end $$;

comment on function public.wtr_optout_subject(uuid) is
  'Whose 48-hour opt-out this is: the signed-in worker''s own, or — service role only — the one named. Nobody else, an admin included: the opt-out is the worker''s written agreement (20260923200000).';

create or replace function public.wtr_optout_do_sign(
  p_staff            uuid,
  p_signed_copy_path text,
  p_notice_days      int
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  s       staff;
  v_today date := (now() at time zone 'Europe/London')::date;
  v_check record;
begin
  select * into s from staff where id = p_staff for update;
  if s.id is null then
    raise exception 'not_a_worker' using errcode = '42501';
  end if;
  if s.status in ('rejected', 'removed', 'inactive') or s.removed_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'not_eligible');
  end if;
  if s.dob is null then
    return jsonb_build_object('ok', false, 'reason', 'age_unknown');
  end if;
  if (s.dob + interval '18 years')::date > v_today then
    return jsonb_build_object('ok', false, 'reason', 'under_18');
  end if;
  if p_notice_days is null or p_notice_days not between 7 and 92 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_notice_period');
  end if;
  -- Signing during a running notice period withdraws the cancellation.
  if s.wtr_optout and s.wtr_optout_cancelled_from is null then
    return jsonb_build_object('ok', false, 'reason', 'already_signed');
  end if;
  if p_signed_copy_path is not null then
    select * into v_check from evidence_upload_problem(s.id, 'wtr-optout', p_signed_copy_path);
    if v_check.problem is not null then
      return jsonb_build_object('ok', false, 'reason', v_check.problem);
    end if;
  end if;

  update staff
     set wtr_optout = true,
         wtr_optout_cancelled_from = null,
         wtr_optout_signed_at = now(),
         wtr_optout_notice_days = p_notice_days,
         wtr_optout_copy_path = p_signed_copy_path
   where id = s.id;

  insert into audit_log (at, actor, action, entity, entity_id, data)
  values (now(), auth.uid(), 'wtr_optout.signed', 'staff', s.id,
          jsonb_strip_nulls(jsonb_build_object(
            'staffId', s.id, 'employeeId', s.employee_id,
            'noticeDays', p_notice_days, 'filePath', p_signed_copy_path,
            'actorName', coalesce((select full_name from profiles where id = auth.uid()),
                                  s.first_name || ' ' || s.last_name || ' (worker)'))));

  insert into notification_outbox (key, channel, template, recipient_emails, payload)
  values ('CL5:staff:' || s.id || ':' || extract(epoch from now())::bigint, 'email', 'CL5',
          array['admin@thehospitalitycompany.co.uk'],
          jsonb_build_object(
            'name',       s.first_name || ' ' || s.last_name,
            'employeeId', coalesce(s.employee_id::text, '(not yet issued)'),
            'signedAt',   to_char(now() at time zone 'Europe/London', 'DD Mon YYYY HH24:MI'),
            'noticeDays', p_notice_days::text,
            'signedCopy', case when p_signed_copy_path is null then 'signed in the app'
                               else 'signed copy uploaded' end))
  on conflict (key) do nothing;

  return jsonb_build_object('ok', true, 'noticeDays', p_notice_days);
end $$;

create or replace function public.wtr_optout_do_cancel(p_staff uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  s       staff;
  v_today date := (now() at time zone 'Europe/London')::date;
  v_from  date;
  v_over  text;
begin
  select * into s from staff where id = p_staff for update;
  if s.id is null then
    raise exception 'not_a_worker' using errcode = '42501';
  end if;
  if not coalesce(s.wtr_optout, false) or s.wtr_optout_cancelled_from is not null then
    return jsonb_build_object('ok', false, 'reason', 'no_active_optout');
  end if;

  v_from := v_today + coalesce(s.wtr_optout_notice_days, 7);

  update staff set wtr_optout_cancelled_from = v_from where id = s.id;

  -- Weeks already booked above the ceiling that comes back. Not undone —
  -- the office decides — but named, so the email is something to act on.
  select string_agg(to_char(w, 'DD Mon YYYY') || ' (' || trim(to_char(h, 'FM999990.0')) || ' h)',
                    ', ' order by w)
    into v_over
    from (
      select cap_week_start((sr.starts_at at time zone 'Europe/London')::date) as w,
             sum(extract(epoch from (sr.ends_at - sr.starts_at)) / 3600.0) as h
        from bookings b
        join shift_requirements sr on sr.id = b.shift_id
       where b.staff_id = s.id
         and b.status = 'confirmed'
         and (sr.starts_at at time zone 'Europe/London')::date >= cap_week_start(v_from)
       group by 1
    ) x
   where h > coalesce(weekly_cap_hours(s.id, w), 1e9);

  insert into audit_log (at, actor, action, entity, entity_id, data)
  values (now(), auth.uid(), 'wtr_optout.cancelled', 'staff', s.id,
          jsonb_strip_nulls(jsonb_build_object(
            'staffId', s.id, 'employeeId', s.employee_id,
            'noticeDays', coalesce(s.wtr_optout_notice_days, 7),
            'effectiveFrom', v_from,
            'actorName', coalesce((select full_name from profiles where id = auth.uid()),
                                  s.first_name || ' ' || s.last_name || ' (worker)'))));

  insert into notification_outbox (key, channel, template, recipient_emails, payload)
  values ('CL6:staff:' || s.id || ':' || v_from, 'email', 'CL6',
          array['admin@thehospitalitycompany.co.uk'],
          jsonb_build_object(
            'name',          s.first_name || ' ' || s.last_name,
            'employeeId',    coalesce(s.employee_id::text, '(not yet issued)'),
            'cancelledAt',   to_char(now() at time zone 'Europe/London', 'DD Mon YYYY HH24:MI'),
            'effectiveFrom', to_char(v_from, 'DD Mon YYYY'),
            'overCapWeeks',  coalesce(v_over, 'none')))
  on conflict (key) do nothing;

  return jsonb_build_object('ok', true, 'effectiveFrom', v_from,
                            'overCapWeeks', coalesce(v_over, ''));
end $$;

create or replace function public.sign_wtr_optout(
  p_signed_copy_path text default null,
  p_notice_days      int  default 7,
  p_staff            uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_me uuid := wtr_optout_subject(p_staff);
begin
  if v_me is null then
    raise exception 'not_a_worker' using errcode = '42501';
  end if;
  return wtr_optout_do_sign(v_me, p_signed_copy_path, p_notice_days);
end $$;

comment on function public.sign_wtr_optout(text, int, uuid) is
  'Completion letter requirement §2.4: the worker signs (or uploads a signed copy of) the 48-hour opt-out — for themself only; p_staff is honoured for the service role alone (20260923200000). 18+ only, date of birth on file, notice 7–92 days. Recorded in audit_log; CL5 to the office. What it lifts is weekly_cap()''s decision, never a Student visa term-time limit.';

create or replace function public.cancel_wtr_optout(
  p_staff uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_me uuid := wtr_optout_subject(p_staff);
begin
  if v_me is null then
    raise exception 'not_a_worker' using errcode = '42501';
  end if;
  return wtr_optout_do_cancel(v_me);
end $$;

comment on function public.cancel_wtr_optout(uuid) is
  'Completion letter requirement §2.4 / acceptance criterion 5: the worker gives notice — for themself only; p_staff is honoured for the service role alone (20260923200000). The 48-hour ceiling returns from the END of the notice period (wtr_optout_cancelled_from); CL6 names any week already booked over it.';

-- ---------------------------------------------------------------------
-- 9 · Step 1 of the wizard: the opt-out tick signs or gives notice.
--
-- Identical to 20260923120000 except the last assignment. The tick used to
-- be written straight onto staff.wtr_optout: no signed_at, no notice
-- period, no audit row, no CL5 — and unticking cleared it on the spot,
-- which lifts the ceiling back with no notice at all. Now:
--   ticked, no standing opt-out     → wtr_optout_do_sign(7 days' notice)
--   unticked, a standing opt-out    → wtr_optout_do_cancel()
--   anything else (or null)         → nothing changes
-- A standing opt-out is one with no notice running. The date of birth is
-- written first, because signing checks the age.
-- ---------------------------------------------------------------------
create or replace function public.onboarding_save_right_to_work(
  p_branch        text,
  p_dob           date,
  p_share_code    text,
  p_visa_type     text,
  p_visa_expiry   date,
  p_uk_doc_choice text,
  p_wtr_optout    boolean
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  s staff := onboarding_me();
  p onboarding_progress;
  v_branch rtw_branch;
  v_today date := onboarding_uk_today();
  v_code text;
  v_choice text;
  v_visa_type text;
  v_expiry date;
  v_dropped int := 0;
  v_standing boolean;
  v_optout jsonb;
begin
  if s.status <> 'documents' then
    raise exception 'wrong_stage' using errcode = 'P0001';
  end if;
  select * into p from onboarding_progress where staff_id = s.id;
  if p.documents_at is not null then
    -- The office reviews the set as one (§2.10); the branch that decided
    -- the set cannot move under it.
    raise exception 'documents_submitted' using errcode = 'P0001';
  end if;

  begin
    v_branch := p_branch::rtw_branch;
  exception when invalid_text_representation then
    raise exception 'bad_branch' using errcode = 'P0001';
  end;
  if v_branch is null then
    raise exception 'bad_branch' using errcode = 'P0001';
  end if;

  -- "Date of birth is mandatory in every branch" (§2.5); 18+ (§2.1).
  if p_dob is null then
    raise exception 'dob_required' using errcode = 'P0001';
  end if;
  if p_dob > (v_today - interval '18 years')::date then
    raise exception 'under_18' using errcode = 'P0001';
  end if;

  if v_branch = 'uk_irish' then
    v_code := null;
    v_choice := coalesce(p_uk_doc_choice, '');
    if v_choice not in ('passport', 'birth_certificate') then
      raise exception 'doc_choice_required' using errcode = 'P0001';
    end if;
  else
    -- Validated before anything goes near gov.uk (§2.5).
    if not is_valid_share_code(p_share_code) then
      raise exception 'bad_share_code' using errcode = 'P0001';
    end if;
    v_code := normalise_share_code(p_share_code);
    v_choice := null;
  end if;

  if v_branch = 'work_visa' then
    v_visa_type := nullif(btrim(coalesce(p_visa_type, '')), '');
    if v_visa_type is null
       or v_visa_type not in ('Skilled Worker', 'Youth Mobility Scheme', 'Graduate', 'Other work visa') then
      raise exception 'visa_type_required' using errcode = 'P0001';
    end if;
  end if;

  if v_branch in ('work_visa', 'dependant_other') then
    if p_visa_expiry is null then
      raise exception 'expiry_required' using errcode = 'P0001';
    end if;
    if p_visa_expiry <= v_today then
      raise exception 'expiry_past' using errcode = 'P0001';
    end if;
    v_expiry := p_visa_expiry;
  end if;

  update staff
     set rtw_branch = v_branch,
         dob = p_dob,
         share_code = v_code
   where id = s.id;

  -- The 48-hour opt-out, through the same body as the Documents tab.
  v_standing := coalesce(s.wtr_optout, false) and s.wtr_optout_cancelled_from is null;
  if p_wtr_optout and not v_standing then
    v_optout := wtr_optout_do_sign(s.id, null, 7);
  elsif p_wtr_optout = false and v_standing then
    v_optout := wtr_optout_do_cancel(s.id);
  end if;
  if v_optout is not null and not (v_optout ->> 'ok')::boolean then
    raise exception '%', v_optout ->> 'reason' using errcode = 'P0001';
  end if;

  insert into onboarding_progress (staff_id, uk_doc_choice, visa_type, visa_expiry, rtw_at, updated_at)
  values (s.id, v_choice, v_visa_type, v_expiry, now(), now())
  on conflict (staff_id) do update
    set uk_doc_choice = excluded.uk_doc_choice,
        visa_type     = excluded.visa_type,
        visa_expiry   = excluded.visa_expiry,
        rtw_at        = excluded.rtw_at,
        updated_at    = excluded.updated_at;

  -- A changed branch changes the set (§2.5 pt 8: nothing beyond it is
  -- collected). Uploads the new branch does not ask for leave the queue.
  with d as (
    update compliance_docs
       set review_status = 'superseded'
     where staff_id = s.id
       and review_status = 'pending'
       and doc_type <> 'share_code_report'
       and doc_type <> all (onboarding_accepted_docs(v_branch, v_choice))
    returning 1
  ) select count(*)::int into v_dropped from d;

  return jsonb_build_object('ok', true, 'branch', v_branch::text,
                            'shareCode', v_code, 'uploadsDropped', v_dropped,
                            'wtrOptOut', v_optout);
end $$;

comment on function public.onboarding_save_right_to_work(text, date, text, text, date, text, boolean) is
  '§2.5 step 1 of the wizard: branch, DOB (18+), share code, visa type and typed expiry, UK document choice. The 48-hour opt-out tick signs through wtr_optout_do_sign() and an untick gives notice through wtr_optout_do_cancel() — never a bare write to the flag (20260923200000).';

-- ---------------------------------------------------------------------
-- 10 · The uploaded object, with HEIC for the wizard.
--
-- §2.5 pt 7: onboarding uploads are "PDF, JPG, PNG or HEIC, up to 10 MB
-- per file". evidence_upload_problem() (20260923100100) was written for
-- the completion letter and the opt-out copy, which the requirement
-- limits to PDF / JPG / PNG, so the three-argument form keeps exactly
-- that and the wizard asks for HEIC by name.
-- ---------------------------------------------------------------------
create or replace function public.evidence_upload_problem(
  p_staff      uuid,
  p_folder     text,
  p_path       text,
  p_allow_heic boolean
) returns table (problem text, mime text, size_bytes bigint)
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_meta jsonb;
  v_mime text;
  v_size bigint;
  v_ext  text;
  v_exts text := case when p_allow_heic then 'pdf|jpg|jpeg|png|heic|heif' else 'pdf|jpg|jpeg|png' end;
begin
  if p_path is null
     or p_path !~* ('^' || p_staff::text || '/' || p_folder
                    || '/[A-Za-z0-9][A-Za-z0-9._-]*\.(' || v_exts || ')$') then
    return query select 'invalid_path'::text, null::text, null::bigint; return;
  end if;

  select o.metadata into v_meta
    from storage.objects o
   where o.bucket_id = 'documents' and o.name = p_path;
  if not found then
    return query select 'file_not_found'::text, null::text, null::bigint; return;
  end if;

  v_mime := lower(coalesce(v_meta ->> 'mimetype', ''));
  v_size := nullif(v_meta ->> 'size', '')::bigint;
  v_ext  := lower(substring(p_path from '\.([A-Za-z]+)$'));

  if v_mime not in ('application/pdf', 'image/jpeg', 'image/png')
       and not (p_allow_heic and v_mime in ('image/heic', 'image/heif'))
     or (v_ext = 'pdf' and v_mime <> 'application/pdf')
     or (v_ext in ('jpg', 'jpeg') and v_mime <> 'image/jpeg')
     or (v_ext = 'png' and v_mime <> 'image/png')
     or (v_ext in ('heic', 'heif') and v_mime not in ('image/heic', 'image/heif')) then
    return query select 'unsupported_file_type'::text, v_mime, v_size; return;
  end if;
  if v_size is null or v_size <= 0 then
    return query select 'file_empty'::text, v_mime, v_size; return;
  end if;
  -- §2.1 / §2.5 pt 7: 10 MB.
  if v_size > 10485760 then
    return query select 'file_too_large'::text, v_mime, v_size; return;
  end if;

  return query select null::text, v_mime, v_size;
end $$;

comment on function public.evidence_upload_problem(uuid, text, text, boolean) is
  'Why an uploaded file is not acceptable, or null, judged on the object Storage recorded: path under <staff_id>/<folder>/, present in the documents bucket, PDF/JPG/PNG (+ HEIC when p_allow_heic, §2.5 pt 7) by content type AND extension, 1 byte to 10 MB (20260923200000).';

create or replace function public.evidence_upload_problem(
  p_staff  uuid,
  p_folder text,
  p_path   text
) returns table (problem text, mime text, size_bytes bigint)
language sql
stable
security definer
set search_path = public, extensions
as $$
  select * from evidence_upload_problem(p_staff, p_folder, p_path, false)
$$;

comment on function public.evidence_upload_problem(uuid, text, text) is
  'Why an uploaded evidence file is not acceptable, or null: path under <staff_id>/<folder>/, object present in the documents bucket, PDF/JPG/PNG by recorded content type AND extension, 1 byte to 10 MB (completion letter requirement §2.1). The four-argument form adds HEIC for the onboarding wizard.';

-- ---------------------------------------------------------------------
-- 11 · Step 4 — one upload, judged on the Storage object.
--
-- As 20260923120000, except where the size and type come from: the
-- object's own Storage record, through evidence_upload_problem(), not
-- p_file_size / p_mime. Those two stay in the signature (the Staff App
-- sends them) and are ignored — a worker who can call this RPC directly
-- can say anything in them. The path must be the one the Staff App
-- builds, <staff_id>/<doc_type>/<file>. The size lands in size_bytes.
-- ---------------------------------------------------------------------
create or replace function public.onboarding_attach_document(
  p_doc_type  text,
  p_path      text,
  p_file_name text,
  p_file_size int,
  p_mime      text
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  s staff := onboarding_me();
  p onboarding_progress;
  v_type doc_type;
  v_req doc_type[];
  v_current review_status;
  v_expiry date;
  v_id uuid;
  v_check record;
begin
  if s.status <> 'documents' then
    raise exception 'wrong_stage' using errcode = 'P0001';
  end if;
  select * into p from onboarding_progress where staff_id = s.id;
  if p.rtw_at is null or s.rtw_branch is null then
    raise exception 'previous_step' using errcode = 'P0001';
  end if;

  begin
    v_type := p_doc_type::doc_type;
  exception when invalid_text_representation then
    raise exception 'doc_not_for_branch' using errcode = 'P0001';
  end;

  select r.accepts into v_req
    from onboarding_required_docs(s.rtw_branch, p.uk_doc_choice) r
   where v_type = any (r.accepts)
   limit 1;
  if v_req is null then
    -- §2.5 pt 8: exactly the branch's set, nothing further.
    raise exception 'doc_not_for_branch' using errcode = 'P0001';
  end if;

  if p_path is null or p_path not like s.id::text || '/' || v_type::text || '/%' then
    raise exception 'wrong_path' using errcode = 'P0001';
  end if;
  select * into v_check from evidence_upload_problem(s.id, v_type::text, p_path, true);
  if v_check.problem is not null then
    raise exception '%',
      case v_check.problem
        when 'invalid_path' then
          case when lower(coalesce(substring(p_path from '\.([A-Za-z0-9]+)$'), ''))
                    in ('pdf', 'jpg', 'jpeg', 'png', 'heic', 'heif')
               then 'wrong_path' else 'file_type' end
        when 'file_not_found'        then 'wrong_path'
        when 'unsupported_file_type' then 'file_type'
        else v_check.problem            -- file_empty, file_too_large
      end
      using errcode = 'P0001';
  end if;

  -- Where this requirement stands now: the latest current row of any type
  -- that satisfies it.
  select c.status into v_current
    from current_compliance_docs(s.id) c
    join compliance_docs d on d.id = c.doc_id
   where c.doc_type = any (v_req)
   order by d.uploaded_at desc
   limit 1;

  if p.documents_at is null then
    if v_current = 'verified' then
      raise exception 'already_verified' using errcode = 'P0001';
    end if;
    update compliance_docs set review_status = 'superseded'
     where staff_id = s.id and doc_type = any (v_req) and review_status = 'pending';
  else
    if v_current is distinct from 'rejected' then
      raise exception 'not_rejected' using errcode = 'P0001';
    end if;
    -- A rejected passport answered with a national ID (EU branch): the
    -- passport row must stop counting, or its rejection blocks for ever.
    update compliance_docs set review_status = 'superseded'
     where staff_id = s.id and doc_type = any (v_req) and doc_type <> v_type
       and review_status in ('pending', 'rejected');
  end if;

  -- Pre-filled expiries. The term letter's is §4.2's 31 December however
  -- the letter reads (doc_expires_on, ADR-0011); a visa or status
  -- document starts from what the worker typed on step 1, for the AI and
  -- then the office to confirm.
  v_expiry := case
    when v_type = 'university_term_dates_letter'
      then doc_expires_on(v_type, null, null, null, now())
    when v_type in ('visa_document', 'status_document') then p.visa_expiry
    else null
  end;

  -- clock_timestamp(), not now(): "the latest upload" is how
  -- current_compliance_docs() tells a re-upload from the row it replaces,
  -- and two statements in one transaction share now().
  insert into compliance_docs (staff_id, doc_type, file_path, file_name, size_bytes, mime_type,
                               expiry_date, needs_manual_review, review_status, uploaded_at)
  values (s.id, v_type, p_path, left(coalesce(nullif(btrim(p_file_name), ''), 'upload'), 200),
          v_check.size_bytes, v_check.mime, v_expiry, true, 'pending', clock_timestamp())
  returning id into v_id;

  return jsonb_build_object('ok', true, 'docId', v_id, 'docType', v_type::text,
                            'expiryDate', v_expiry);
end $$;

comment on function public.onboarding_attach_document(text, text, text, int, text) is
  '§2.5 pt 7 step 4 upload, as the worker: the branch''s set only, into <staff_id>/<doc_type>/, judged on the Storage object itself (evidence_upload_problem, PDF/JPG/PNG/HEIC up to 10 MB) — p_file_size and p_mime are ignored. Size recorded in size_bytes (20260923200000).';

-- ---------------------------------------------------------------------
-- 12 · The extraction seam pre-fills the share code's date.
--
-- ADR-0002 option 1: the office saves the gov.uk report onto the row and
-- the extractor reads the right-to-work-until off it. 20260923120000
-- skipped the share code report altogether, so the date could only ever
-- be typed. Now p_expiry on a share code report pre-fills
-- right_to_work_until — pending rows only, never over a human (the
-- reviewer still confirms it on Verify, §2.6 "the final word belongs to a
-- human"). Otherwise unchanged.
-- ---------------------------------------------------------------------
create or replace function public.record_document_extraction(
  p_doc          uuid,
  p_expiry       date,
  p_term_dates   daterange[],
  p_completion   date,
  p_institution  text,
  p_confidence   numeric,
  p_raw          jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  d compliance_docs;
  v_threshold numeric;
  v_manual boolean;
begin
  select * into d from compliance_docs where id = p_doc for update;
  if d.id is null then
    raise exception 'unknown_document' using errcode = 'P0001';
  end if;
  if d.review_status <> 'pending' then
    -- A manager has already decided. The AI never overwrites a human.
    return jsonb_build_object('ok', true, 'skipped', true);
  end if;
  if p_confidence is not null and (p_confidence < 0 or p_confidence > 1) then
    raise exception 'bad_confidence' using errcode = 'P0001';
  end if;
  if p_expiry is not null and not isfinite(p_expiry) then
    raise exception 'bad_date' using errcode = 'P0001';
  end if;

  select (value #>> '{}')::numeric into v_threshold
    from settings where key = 'ai_confidence_threshold';
  v_manual := p_confidence is null or p_confidence < coalesce(v_threshold, 0.8);

  update compliance_docs
     set expiry_date = case
                         when doc_type in ('university_term_dates_letter', 'share_code_report')
                           then expiry_date
                         else coalesce(p_expiry, expiry_date)
                       end,
         right_to_work_until = case when doc_type = 'share_code_report'
                                    then coalesce(p_expiry, right_to_work_until)
                                    else right_to_work_until end,
         term_dates = case when doc_type = 'university_term_dates_letter'
                           then p_term_dates else term_dates end,
         completion_date = case when doc_type = 'university_completion_letter'
                                then p_completion else completion_date end,
         awarding_institution = case when doc_type = 'university_completion_letter'
                                     then nullif(btrim(p_institution), '') else awarding_institution end,
         ai_extracted = p_raw,
         ai_confidence = p_confidence,
         needs_manual_review = v_manual
   where id = p_doc;

  return jsonb_build_object('ok', true, 'needsManualReview', v_manual);
end $$;

comment on function public.record_document_extraction(uuid, date, daterange[], date, text, numeric, jsonb) is
  '§2.6 AI seam, service role only: pre-fills, never verifies. p_expiry is the expiry — or, on a share code report, the right-to-work-until read off the gov.uk report (ADR-0002). The term letter keeps its 31 December expiry (§4.2). Pending rows only (20260923200000).';

-- ---------------------------------------------------------------------
-- 13 · onboarding_state(): the size from size_bytes, and the opt-out as
--      the worker chose it.
--
-- As 20260923120000 but for two fields: fileSize reads size_bytes (the
-- wizard no longer writes file_size), and wtrOptOut is true only for a
-- STANDING opt-out — after an untick the flag stays set until the notice
-- runs out (the cap reads it), but the worker has said no, and step 1
-- must show it unticked.
-- ---------------------------------------------------------------------
create or replace function public.onboarding_state()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_id uuid := staff_caller();
  s staff;
  p onboarding_progress;
  v_docs jsonb;
  v_decl jsonb;
  v_quiz jsonb;
  v_hmrc jsonb;
  v_refs jsonb;
  v_bank jsonb;
  v_contract jsonb;
  v_version text := current_contract_version();
begin
  if v_id is null then
    return null;
  end if;
  select * into s from staff where id = v_id;
  select * into p from onboarding_progress where staff_id = v_id;

  -- The latest non-superseded row per type: what the office is looking at.
  select coalesce(jsonb_agg(jsonb_build_object(
           'id',                d.id,
           'docType',           d.doc_type::text,
           'status',            d.review_status::text,
           'fileName',          d.file_name,
           'fileSize',          coalesce(d.size_bytes, d.file_size),
           'uploadedAt',        d.uploaded_at,
           'expiryDate',        d.expiry_date,
           'rightToWorkUntil',  d.right_to_work_until,
           'rejectionReason',   d.rejection_reason,
           'reviewedAt',        d.reviewed_at,
           'needsManualReview', d.needs_manual_review,
           'termDates',         case when d.term_dates is null then null
                                     else (select jsonb_agg(jsonb_build_object(
                                             'from', lower(r), 'to', upper(r) - 1))
                                             from unnest(d.term_dates) r) end,
           'shareCode',         d.share_code)
           order by d.uploaded_at), '[]'::jsonb)
    into v_docs
    from compliance_docs d
    join current_compliance_docs(v_id) c on c.doc_id = d.id;

  select jsonb_build_object(
           'answer',       c.answer,
           'status',       c.review_status::text,
           'declaredAt',   c.declared_at,
           'reviewedAt',   c.reviewed_at)
    into v_decl
    from criminal_declarations c
   where c.staff_id = v_id and not c.superseded and c.source = 'onboarding'
   order by c.declared_at desc, c.id desc
   limit 1;

  select coalesce(jsonb_agg(jsonb_build_object(
           'attemptNo', q.attempt_no,
           'percent',   q.score,
           'passed',    q.passed,
           'correct',   (q.answers->>'correct')::int,
           'total',     (q.answers->>'total')::int,
           'takenAt',   q.taken_at)
           order by q.attempt_no), '[]'::jsonb)
    into v_quiz
    from quiz_attempts q
   where q.staff_id = v_id and not q.superseded;

  select jsonb_build_object(
           'q1OtherJob',       h.q1_other_job,
           'q2Pension',        h.q2_pension,
           'q3Since6April',    h.q3_since_6_april,
           'studentLoan',      h.student_loan::text,
           'postgraduateLoan', h.postgraduate_loan,
           'submittedAt',      h.submitted_at)
    into v_hmrc
    from hmrc_checklists h
   where h.staff_id = v_id and not h.superseded;

  select coalesce(jsonb_agg(jsonb_build_object(
           'name', r.name, 'relationship', r.relationship,
           'phone', r.phone, 'email', r.email) order by r.name), '[]'::jsonb)
    into v_refs
    from staff_references r where r.staff_id = v_id;

  select jsonb_build_object(
           'accountHolder', b.account_holder,
           'sortCode',      b.sort_code,
           'accountNumber', b.account_number)
    into v_bank
    from bank_details b where b.staff_id = v_id;

  select jsonb_build_object(
           'version',       cv.version,
           'title',         cv.title,
           'body',          cv.body,
           'isPlaceholder', cv.is_placeholder)
    into v_contract
    from contract_versions cv where cv.version = v_version;

  return jsonb_build_object(
    'staffId',        s.id,
    'firstName',      s.first_name,
    'lastName',       s.last_name,
    'status',         s.status::text,
    'employeeId',     s.employee_id,
    'dob',            s.dob,
    'rtwBranch',      s.rtw_branch::text,
    'shareCode',      s.share_code,
    'wtrOptOut',      coalesce(s.wtr_optout, false) and s.wtr_optout_cancelled_from is null,
    'homeAddress',    s.home_address,
    'homeLat',        case when s.home_location is null then null
                           else st_y(s.home_location::geometry) end,
    'homeLng',        case when s.home_location is null then null
                           else st_x(s.home_location::geometry) end,
    'photoPath',      s.photo_path,
    'niMasked',       case when s.ni_number is null then null
                           else repeat('●', greatest(length(s.ni_number) - 2, 0))
                                || right(s.ni_number, 2) end,
    'quizAttempts',   s.quiz_attempts,
    'contractSignedAt', s.contract_signed_at,
    'contractVersion',  s.contract_version,
    'contractStamp',  case when s.contract_signed_at is null then null
                           else to_char(s.contract_signed_at at time zone 'Europe/London',
                                        'DD.MM.YYYY HH24:MI') || ' UK time' end,
    'progress', jsonb_build_object(
      'ukDocChoice',  p.uk_doc_choice,
      'visaType',     p.visa_type,
      'visaExpiry',   p.visa_expiry,
      'rtwAt',        p.rtw_at,
      'addressAt',    p.address_at,
      'selfieAt',     p.selfie_at,
      'documentsAt',  p.documents_at,
      'inductionAt',  p.induction_at,
      'hmrcAt',       p.hmrc_at,
      'referencesAt', p.references_at,
      'bankAt',       p.bank_at,
      'contractAt',   p.contract_at,
      'tutorialAt',   p.tutorial_at),
    'documents',   v_docs,
    'declaration', v_decl,
    'quiz',        v_quiz,
    'hmrc',        v_hmrc,
    'references',  v_refs,
    'bank',        v_bank,
    'contract',    v_contract);
end $$;


comment on function public.onboarding_state() is
  'The §10.3 wizard''s whole read, for the caller. Never returns the HMRC statement letter (§2.8), block_reason (§10.1), the declaration details or the quiz key. fileSize is size_bytes; wtrOptOut is a standing opt-out (no notice running) (20260923200000).';

-- ---------------------------------------------------------------------
-- 14 · Privileges.
-- ---------------------------------------------------------------------
-- The office accepts through onboarding_accept_with_account() (security
-- definer, so it still reaches this as owner). Left granted, the bare
-- five-argument form is a way to queue E3 with a link to an account that
-- was never linked — exactly what 20260923180000 closed.
revoke execute on function public.onboarding_accept(uuid, uuid[], text, text, text) from public, anon, authenticated;

-- Internal: only the definer functions above call these.
revoke execute on function public.wtr_optout_do_sign(uuid, text, int) from public, anon, authenticated, service_role;
revoke execute on function public.wtr_optout_do_cancel(uuid)          from public, anon, authenticated, service_role;
revoke execute on function public.wtr_optout_subject(uuid)             from public, anon, authenticated, service_role;
revoke execute on function public.compliance_docs_rtw_date_guard()     from public, anon, authenticated;
revoke execute on function public.compliance_docs_rtw_until()          from public, anon, authenticated;
revoke execute on function public.evidence_upload_problem(uuid, text, text, boolean) from public, anon, authenticated;
grant  execute on function public.evidence_upload_problem(uuid, text, text, boolean) to service_role;

-- A pure date helper carries nothing personal.
revoke execute on function public.rtw_doc_until(doc_type, date, date) from public, anon;
grant  execute on function public.rtw_doc_until(doc_type, date, date) to authenticated, service_role;
-- Reads a worker's documents: owner and service role only.
revoke execute on function public.rtw_evidence_until(uuid) from public, anon, authenticated;
grant  execute on function public.rtw_evidence_until(uuid) to service_role;
