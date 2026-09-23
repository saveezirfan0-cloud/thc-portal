-- =====================================================================
-- The University Completion Letter and the 48-hour opt-out — everything
-- around the rule (docs/scope/university-completion-letter-requirement.pdf)
--
-- The rule itself is done: weekly_cap() / weekly_cap_for() / can_roster()
-- (20260922093000, 20260922093100) agree with packages/domain/src/cap.ts
-- across every shared vector. This migration is what feeds it evidence,
-- and what records that evidence well enough to show a Home Office audit.
--
--   §2.1 Upload        submit_completion_letter() — the worker's RPC.
--                      Lands `pending` and changes NO cap (acceptance
--                      criterion 2): the cap reads staff.graduated_at and
--                      staff.course_completion_date, and an upload writes
--                      neither.
--   §2.2 Review        approve_completion_letter() — the reviewer confirms
--                      the completion date AND the visa expiry.
--                      Rejection is compliance_reject_document() (20260923100000):
--                      reason required, push N8 with Re-upload.
--   §2.3 Effect        from the course completion date, never backdated,
--                      never past the visa (the rule already says so; this
--                      writes the two columns it reads).
--   §2.4 Opt-out       sign_wtr_optout() / cancel_wtr_optout(). Under-18s
--                      refused; cancellation takes effect at the END of
--                      the notice period.
--   §4   Audit         every upload, decision and opt-out lands in
--                      audit_log (append-only, admin-read, definer-written)
--                      and is exported through compliance_evidence_audit_v.
--   §4   Retention     employment + 2 years for the completion letter: a
--                      §1.7 removal inside that window HOLDS the letter
--                      and its file instead of deleting them (ADR-0012).
--   §4   Reporting     student_visa_v, extended (the existing §4.5 view).
--   §5   Notifications CL1–CL6 in the §8 register (packages/notifications).
--   §7   Edge cases    future completion dates, visa expiring around
--                      completion, and the switch to a Graduate or Skilled
--                      Worker visa (record_right_to_work_change()).
--
-- Also the two follow-ups the B6b brief named, which 20260922093100
-- deliberately left: term_letter_applies() keyed on the course completion
-- date instead of the verification date, and reset_to_candidate() clearing
-- the columns that joined graduated_at.
--
-- Why no new tables: every audit row here is the same shape as the ones
-- audit_log already holds (actor, action, entity, entity_id, data), and
-- that table is already append-only for every API role (0004 admin_read,
-- 010_rls_admin). A second audit table would be a second place to forget
-- to look.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1 · Columns
-- ---------------------------------------------------------------------
alter table compliance_docs
  add column if not exists evidence_form          text,
  add column if not exists completion_date_claimed date,
  add column if not exists confirmed_visa_expiry   date,
  add column if not exists mime_type               text,
  add column if not exists size_bytes              bigint,
  add column if not exists retain_until            date;

alter table compliance_docs drop constraint if exists compliance_docs_evidence_form_chk;
alter table compliance_docs add constraint compliance_docs_evidence_form_chk
  check (evidence_form is null
         or evidence_form in ('letter', 'transcript', 'university_email'));

comment on column compliance_docs.evidence_form is
  'Completion letter requirement §2.1: one document type, three acceptable forms — the official letter, a final/completers transcript showing the award or completion date, or an official university email confirming completion.';
comment on column compliance_docs.completion_date_claimed is
  'The course completion date the WORKER entered on upload (§2.1). Evidence, not effect: nothing reads it to set a cap. The reviewer confirms or corrects it into completion_date on approval (§2.2).';
comment on column compliance_docs.completion_date is
  'The course completion date the REVIEWER confirmed on approval (§2.2). Copied to staff.course_completion_date, which is what RULE-20 reads.';
comment on column compliance_docs.confirmed_visa_expiry is
  'The visa expiry the reviewer confirmed on approving a completion letter (§2.2). The worker''s right_to_work_until becomes the EARLIER of this and what was on file.';
comment on column compliance_docs.retain_until is
  'Set only by a §1.7 removal that falls inside a legal retention window (completion letter: employment + 2 years, ADR-0012). The row and its file are held until this date and purged by rtw_daily().';

alter table staff
  add column if not exists wtr_optout_signed_at   timestamptz,
  add column if not exists wtr_optout_notice_days int,
  add column if not exists wtr_optout_copy_path   text;

alter table staff drop constraint if exists staff_wtr_optout_notice_chk;
alter table staff add constraint staff_wtr_optout_notice_chk
  check (wtr_optout_notice_days is null or wtr_optout_notice_days between 7 and 92);

comment on column staff.wtr_optout_signed_at is
  '§2.4: when the current 48-hour opt-out was signed. History is in audit_log (wtr_optout.signed / wtr_optout.cancelled).';
comment on column staff.wtr_optout_notice_days is
  '§2.4: the notice the agreement requires to cancel — 7 days, or up to 3 months if the agreement says so.';
comment on column staff.wtr_optout_copy_path is
  '§2.4: the uploaded signed copy, if the worker signed on paper. Object name in the documents bucket, <staff_id>/wtr-optout/<file>.';

-- ---------------------------------------------------------------------
-- 2 · The uploaded object, checked against what Storage actually holds.
--
-- The documents bucket is service-role only (20260922183015, asserted by
-- 320_storage.sql): the Staff App's server code uploads with the service
-- key after authenticating the worker. So the path the worker hands this
-- function is only a claim. What is checked is the object Storage
-- recorded — its real size and content type — and that it sits under the
-- caller's own folder, so a worker cannot attach someone else's file.
--
-- Path convention (the S4 contract):
--   documents/<staff_id>/completion-letter/<file-id>.<pdf|jpg|jpeg|png>
--   documents/<staff_id>/wtr-optout/<file-id>.<pdf|jpg|jpeg|png>
-- The object NAME stored in file_path is bucket-relative, which is what
-- storage_deletions (§1.7) needs to delete it.
-- ---------------------------------------------------------------------
create or replace function public.evidence_upload_problem(
  p_staff  uuid,
  p_folder text,
  p_path   text
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
begin
  if p_path is null
     or p_path !~* ('^' || p_staff::text || '/' || p_folder
                    || '/[A-Za-z0-9][A-Za-z0-9._-]*\.(pdf|jpg|jpeg|png)$') then
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
     or (v_ext = 'pdf' and v_mime <> 'application/pdf')
     or (v_ext in ('jpg', 'jpeg') and v_mime <> 'image/jpeg')
     or (v_ext = 'png' and v_mime <> 'image/png') then
    return query select 'unsupported_file_type'::text, v_mime, v_size; return;
  end if;
  if v_size is null or v_size <= 0 then
    return query select 'file_empty'::text, v_mime, v_size; return;
  end if;
  -- §2.1 "Sensible max file size (e.g. 10MB)".
  if v_size > 10485760 then
    return query select 'file_too_large'::text, v_mime, v_size; return;
  end if;

  return query select null::text, v_mime, v_size;
end $$;

comment on function public.evidence_upload_problem(uuid, text, text) is
  'Why an uploaded evidence file is not acceptable, or null: path under <staff_id>/<folder>/, object present in the documents bucket, PDF/JPG/PNG by recorded content type AND extension, 1 byte to 10 MB (completion letter requirement §2.1).';

-- ---------------------------------------------------------------------
-- 3 · §2.1 Upload — the worker's RPC.
--
-- Returns {ok:false, reason} for anything the worker can correct, and
-- raises only for "you are not who you say you are". The Staff App shows
-- the reason; a raise would be a 500.
--
-- What it deliberately does NOT do: touch staff. The cap reads
-- staff.graduated_at and staff.course_completion_date, and only
-- approve_completion_letter() writes them — which is acceptance
-- criterion 2 by construction rather than by care.
--
-- One pending letter at a time. A worker who uploaded the wrong file is
-- rejected and re-uploads (§7 "reject flow with re-upload"), rather than
-- stacking unreviewed files the office has to pick between.
-- ---------------------------------------------------------------------
create or replace function public.submit_completion_letter(
  p_file_path            text,
  p_completion_date      date,
  p_evidence_form        text,
  p_awarding_institution text default null,
  p_staff                uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_me    uuid := staff_caller(p_staff);
  s       staff;
  v_check record;
  v_doc   uuid;
  v_today date := (now() at time zone 'Europe/London')::date;
begin
  if v_me is null then
    raise exception 'not_a_worker' using errcode = '42501';
  end if;
  select * into s from staff where id = v_me for update;
  if s.status in ('rejected', 'removed', 'inactive') or s.removed_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'not_eligible');
  end if;
  -- §2.1: "Any worker whose visa type is Student / Tier 4".
  if s.rtw_branch is distinct from 'international_student' then
    return jsonb_build_object('ok', false, 'reason', 'not_student_visa');
  end if;
  if p_evidence_form is null
     or p_evidence_form not in ('letter', 'transcript', 'university_email') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_form');
  end if;
  -- §2.1: "the worker must enter … the course completion date stated on
  -- the document". A date in the future is allowed — a letter issued
  -- before the final exam (§7) — and simply lifts nothing until it passes.
  if p_completion_date is null then
    return jsonb_build_object('ok', false, 'reason', 'completion_date_required');
  end if;
  if p_completion_date < date '2000-01-01' or p_completion_date > v_today + interval '5 years' then
    return jsonb_build_object('ok', false, 'reason', 'completion_date_implausible');
  end if;

  select * into v_check from evidence_upload_problem(v_me, 'completion-letter', p_file_path);
  if v_check.problem is not null then
    return jsonb_build_object('ok', false, 'reason', v_check.problem);
  end if;

  if exists (select 1 from compliance_docs d
              where d.staff_id = v_me
                and d.doc_type = 'university_completion_letter'
                and d.review_status = 'pending') then
    return jsonb_build_object('ok', false, 'reason', 'already_pending');
  end if;

  insert into compliance_docs (staff_id, doc_type, file_path, review_status,
                               evidence_form, completion_date_claimed,
                               awarding_institution, mime_type, size_bytes)
  values (v_me, 'university_completion_letter', p_file_path, 'pending',
          p_evidence_form, p_completion_date,
          nullif(trim(coalesce(p_awarding_institution, '')), ''),
          v_check.mime, v_check.size_bytes)
  returning id into v_doc;

  -- §5 · worker: upload received. admin: awaiting review.
  insert into notification_outbox (key, channel, template, recipient_staff_id, payload)
  values ('CL1:doc:' || v_doc, 'push', 'CL1', v_me,
          jsonb_build_object('documentId', v_doc::text))
  on conflict (key) do nothing;

  insert into notification_outbox (key, channel, template, recipient_emails, payload)
  values ('CL3:doc:' || v_doc, 'email', 'CL3',
          array['admin@thehospitalitycompany.co.uk'],
          jsonb_build_object(
            'name',           s.first_name || ' ' || s.last_name,
            'employeeId',     coalesce(s.employee_id::text, '(not yet issued)'),
            'uploadedAt',     to_char(now() at time zone 'Europe/London', 'DD Mon YYYY HH24:MI'),
            'form',           case p_evidence_form
                                when 'letter' then 'Official university completion letter'
                                when 'transcript' then 'Final / completers transcript'
                                else 'Official university email' end,
            'completionDate', to_char(p_completion_date, 'DD Mon YYYY')))
  on conflict (key) do nothing;

  return jsonb_build_object('ok', true, 'documentId', v_doc::text, 'status', 'pending');
end $$;

comment on function public.submit_completion_letter(text, date, text, text, uuid) is
  'Completion letter requirement §2.1, the worker''s upload. Student visa only; one of three forms; the completion date the worker read off it; the file checked against Storage (PDF/JPG/PNG, ≤10 MB, under <staff_id>/completion-letter/). Lands pending, queues CL1 and CL3, and changes NO cap (acceptance criterion 2).';

-- ---------------------------------------------------------------------
-- 4 · When an approval actually starts to count.
--
-- weekly_cap_for() gives the release to a week only when BOTH the
-- verification date has passed (§4.5, never backdated) AND the week
-- starts on or after the completion date (requirement §2.3; a week that
-- straddles it keeps the lower cap). The first day both hold is the
-- later of: the day it was verified, and the first Monday on or after the
-- completion date. That is the "effective date" the worker is told.
-- ---------------------------------------------------------------------
create or replace function public.completion_effective_from(p_completion date, p_verified date)
returns date
language sql
immutable
set search_path = public, extensions
as $$
  select greatest(
    p_verified,
    case when p_completion = cap_week_start(p_completion) then p_completion
         else cap_week_start(p_completion) + 7 end)
$$;

comment on function public.completion_effective_from(date, date) is
  'The first day an approved completion letter lifts the cap: the later of the verification date and the first Monday on/after the completion date. Mirrors completionEffectiveFrom() in packages/domain/src/completionLetter.ts.';

-- ---------------------------------------------------------------------
-- 5 · §2.2 Approve.
--
-- The reviewer confirms the completion date and the visa expiry. Both
-- are required: the requirement says the reviewer "confirms/enters" them,
-- and an approval without the expiry is a release not tied to the visa,
-- which §2.3 forbids.
--
-- The visa expiry written to the worker is the EARLIER of what the
-- reviewer typed and what the right-to-work check put on file. A reviewer
-- who reads a later date off a letter does not extend a right to work the
-- gov.uk check did not grant; one who reads an earlier date has found a
-- reason to stop sooner, and sooner is the side the civil penalty sits
-- on. A disagreement is returned so the screen can say so.
--
-- graduated_at keeps an earlier value if there is one: weekly_cap_for()
-- ANDs it with the completion date, so it can only ever delay a release,
-- and moving it later on a re-approval would retract weeks already
-- released on evidence nobody has challenged.
-- ---------------------------------------------------------------------
create or replace function public.approve_completion_letter(
  p_doc             uuid,
  p_completion_date date,
  p_visa_expiry     date
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_reviewer  uuid := assert_reviewer();
  d           compliance_docs;
  s           staff;
  v_today     date := (now() at time zone 'Europe/London')::date;
  v_rtw       date;
  v_effective date;
  v_cap       cap_assessment;
  v_variant   text;
begin
  if p_completion_date is null then
    raise exception 'completion_date_required' using errcode = 'P0001';
  end if;
  if p_visa_expiry is null then
    raise exception 'visa_expiry_required' using errcode = 'P0001';
  end if;

  select * into d from compliance_docs where id = p_doc for update;
  if d.id is null then
    raise exception 'document_not_found' using errcode = 'P0002';
  end if;
  if d.doc_type <> 'university_completion_letter' then
    raise exception 'not_a_completion_letter' using errcode = 'P0001';
  end if;
  if d.review_status <> 'pending' then
    raise exception 'not_pending: %', d.review_status using errcode = 'P0001';
  end if;

  select * into s from staff where id = d.staff_id for update;
  if s.status in ('rejected', 'removed') or s.removed_at is not null then
    raise exception 'not_reviewable: %', s.status using errcode = 'P0001';
  end if;

  v_rtw := case when s.right_to_work_until is null then p_visa_expiry
                else least(s.right_to_work_until, p_visa_expiry) end;

  update staff
     set course_completion_date = p_completion_date,
         graduated_at = coalesce(graduated_at, v_today),
         right_to_work_until = v_rtw
   where id = s.id;

  -- The flip fires compliance_docs_verified() (the §4.3 re-check) and the
  -- audit trigger below.
  update compliance_docs
     set review_status = 'verified',
         reviewed_by = v_reviewer,
         reviewed_at = now(),
         completion_date = p_completion_date,
         confirmed_visa_expiry = p_visa_expiry
   where id = d.id;

  v_effective := completion_effective_from(p_completion_date, v_today);
  select * into v_cap from weekly_cap_for(s.id, v_effective);

  -- §7: "visa expires before or shortly after completion → expiry logic
  -- takes precedence over the 48-hour release". If the release would
  -- start after the last day they may work, it never starts, and the
  -- worker is told that rather than promised hours they cannot have.
  v_variant := case
    when v_rtw < v_effective then 'visa_first'
    when v_cap.cap_hours is null then 'uncapped'
    else 'dated' end;

  insert into notification_outbox (key, channel, template, recipient_staff_id, payload)
  values ('CL2:doc:' || d.id, 'push', 'CL2', s.id,
          jsonb_strip_nulls(jsonb_build_object(
            'variant', v_variant,
            'limit',   v_cap.cap_hours::text,
            'date',    to_char(case when v_variant = 'visa_first' then v_rtw else v_effective end,
                               'DD Mon YYYY'),
            'documentId', d.id::text)))
  on conflict (key) do nothing;

  return jsonb_build_object(
    'approved', true,
    'documentId', d.id::text,
    'effectiveFrom', v_effective,
    'capHours', v_cap.cap_hours,
    'band', v_cap.band::text,
    'visaExpiry', v_rtw,
    'visaDiscrepancy', s.right_to_work_until is not null
                       and s.right_to_work_until <> p_visa_expiry,
    'releaseBlockedByVisa', v_rtw < v_effective);
end $$;

comment on function public.approve_completion_letter(uuid, date, date) is
  'Completion letter requirement §2.2. The reviewer confirms the completion date and the visa expiry; the worker''s course_completion_date and graduated_at are written (the cap follows from RULE-20, from the completion date, never backdated) and right_to_work_until becomes the earlier of the two expiries. Queues CL2 with the new cap and effective date, or the visa_first variant when the right to work ends first (§7).';

-- ---------------------------------------------------------------------
-- 5b · §2.2 on the row: no completion letter is verified without both
-- confirmations.
--
-- approve_completion_letter() is not the only function that can flip a
-- document to `verified`: any generic Verify can (the onboarding screen's
-- verify_document(), 20260923110000, is one), and so can an UPDATE from
-- psql. Through any of those, a completion letter would be verified with
-- no confirmed completion date and no confirmed visa expiry — and RULE-20
-- reads a verified letter with no completion date as "the flag alone
-- releases" (20260922093100): 48 hours from the moment of the click,
-- whatever date the letter actually carries. That is the precise failure
-- the requirement's §7 names, reached by the side door.
--
-- So the rule is on the row. A completion letter becomes verified only
-- with completion_date AND confirmed_visa_expiry set in the same write,
-- which approve_completion_letter() does and nothing else does by
-- accident. Rows INSERTED already verified (supabase/seed.sql's history)
-- are not transitions and are left alone.
-- ---------------------------------------------------------------------
create or replace function public.completion_letter_approval_guard()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
begin
  if new.completion_date is null or new.confirmed_visa_expiry is null then
    raise exception 'completion_letter_needs_approval'
      using errcode = 'P0001',
            hint = 'A completion letter is approved with approve_completion_letter(doc, completion_date, visa_expiry): the reviewer confirms both dates (completion letter requirement §2.2).';
  end if;
  return new;
end $$;

drop trigger if exists completion_letter_approval_guard on compliance_docs;
create trigger completion_letter_approval_guard
  before update of review_status on compliance_docs
  for each row
  when (new.doc_type = 'university_completion_letter'
        and new.review_status = 'verified'
        and old.review_status is distinct from 'verified')
  execute function completion_letter_approval_guard();

-- ---------------------------------------------------------------------
-- 6 · §4 Audit trail.
--
-- One audit_log row per upload and per decision on a completion letter,
-- written by trigger so no path that touches the row can skip it —
-- approve, reject, a reset's supersede, a retention purge. The row carries
-- its own snapshot (form, file, the claimed and confirmed dates, the
-- reason, who did it and their name at the time), so the trail still
-- reads when the document row is gone.
--
-- audit_log is admin_read only and has no write policy for any API role
-- (0004, 010_rls_admin): append-only evidence, written by definer code.
-- ---------------------------------------------------------------------
create or replace function public.completion_letter_audit()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  r       compliance_docs;
  v_event text;
  v_actor uuid;
  v_name  text;
  s       staff;
begin
  if tg_op = 'DELETE' then
    r := old; v_event := 'purged'; v_actor := auth.uid();
  elsif tg_op = 'INSERT' then
    r := new; v_event := 'uploaded'; v_actor := auth.uid();
  else
    if new.review_status is not distinct from old.review_status then
      return new;
    end if;
    r := new;
    v_event := case new.review_status
                 when 'verified'   then 'approved'
                 when 'rejected'   then 'rejected'
                 when 'superseded' then 'superseded'
                 else 'reopened' end;
    v_actor := case when new.review_status in ('verified', 'rejected')
                    then coalesce(new.reviewed_by, auth.uid())
                    else auth.uid() end;
  end if;

  select * into s from staff where id = r.staff_id;
  select p.full_name into v_name from profiles p where p.id = v_actor;
  if v_name is null and v_actor is not null and s.user_id = v_actor then
    v_name := s.first_name || ' ' || s.last_name || ' (worker)';
  end if;

  insert into audit_log (at, actor, action, entity, entity_id, data)
  values (now(), v_actor, 'completion_letter.' || v_event, 'compliance_doc', r.id,
          jsonb_strip_nulls(jsonb_build_object(
            'staffId',               r.staff_id,
            'employeeId',            s.employee_id,
            'actorName',             coalesce(v_name, case when v_actor is null then 'system' end),
            'evidenceForm',          r.evidence_form,
            'filePath',              r.file_path,
            'uploadedAt',            r.uploaded_at,
            'completionDateClaimed', r.completion_date_claimed,
            'completionDate',        r.completion_date,
            'visaExpiry',            r.confirmed_visa_expiry,
            'reason',                r.rejection_reason,
            'retainUntil',           r.retain_until)));

  return case when tg_op = 'DELETE' then old else new end;
end $$;

drop trigger if exists completion_letter_audit on compliance_docs;
create trigger completion_letter_audit
  after insert or update of review_status on compliance_docs
  for each row when (new.doc_type = 'university_completion_letter')
  execute function completion_letter_audit();

drop trigger if exists completion_letter_audit_delete on compliance_docs;
create trigger completion_letter_audit_delete
  after delete on compliance_docs
  for each row when (old.doc_type = 'university_completion_letter')
  execute function completion_letter_audit();

-- ---------------------------------------------------------------------
-- 7 · §2.4 The 48-hour opt-out.
--
-- "A separate document from the completion letter — one does not imply
-- the other." It is recorded for anyone 18 or over, not only a graduate:
-- the rule (weekly_cap) decides what it lifts, and it lifts nothing while
-- the Student visa condition is in force, so offering it is harmless and
-- refusing it would be a rule written twice. Under-18s are refused
-- outright (§2.4 "do not offer the opt-out flow to under-18s"), and a
-- worker whose date of birth is not on file is refused too: the office
-- cannot show it checked an age it does not have.
--
-- Cancelling records the notice and the END of the notice period, which
-- is what the cap reads (acceptance criterion 5). The tick itself stays
-- set; weekly_cap() ignores it from wtr_optout_cancelled_from on.
-- ---------------------------------------------------------------------
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
  v_me    uuid := staff_caller(p_staff);
  s       staff;
  v_today date := (now() at time zone 'Europe/London')::date;
  v_check record;
begin
  if v_me is null then
    raise exception 'not_a_worker' using errcode = '42501';
  end if;
  select * into s from staff where id = v_me for update;
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
    select * into v_check from evidence_upload_problem(v_me, 'wtr-optout', p_signed_copy_path);
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
   where id = v_me;

  insert into audit_log (at, actor, action, entity, entity_id, data)
  values (now(), auth.uid(), 'wtr_optout.signed', 'staff', v_me,
          jsonb_strip_nulls(jsonb_build_object(
            'staffId', v_me, 'employeeId', s.employee_id,
            'noticeDays', p_notice_days, 'filePath', p_signed_copy_path,
            'actorName', coalesce((select full_name from profiles where id = auth.uid()),
                                  s.first_name || ' ' || s.last_name || ' (worker)'))));

  insert into notification_outbox (key, channel, template, recipient_emails, payload)
  values ('CL5:staff:' || v_me || ':' || extract(epoch from now())::bigint, 'email', 'CL5',
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

comment on function public.sign_wtr_optout(text, int, uuid) is
  'Completion letter requirement §2.4: the worker signs (or uploads a signed copy of) the 48-hour opt-out. 18+ only, date of birth on file, notice 7–92 days. Recorded in audit_log; CL5 to the office. What it lifts is weekly_cap()''s decision, never a Student visa term-time limit.';

create or replace function public.cancel_wtr_optout(
  p_staff uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_me    uuid := staff_caller(p_staff);
  s       staff;
  v_today date := (now() at time zone 'Europe/London')::date;
  v_from  date;
  v_over  text;
begin
  if v_me is null then
    raise exception 'not_a_worker' using errcode = '42501';
  end if;
  select * into s from staff where id = v_me for update;
  if not s.wtr_optout or s.wtr_optout_cancelled_from is not null then
    return jsonb_build_object('ok', false, 'reason', 'no_active_optout');
  end if;

  v_from := v_today + coalesce(s.wtr_optout_notice_days, 7);

  update staff set wtr_optout_cancelled_from = v_from where id = v_me;

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
       where b.staff_id = v_me
         and b.status = 'confirmed'
         and (sr.starts_at at time zone 'Europe/London')::date >= cap_week_start(v_from)
       group by 1
    ) x
   where h > coalesce(weekly_cap_hours(v_me, w), 1e9);

  insert into audit_log (at, actor, action, entity, entity_id, data)
  values (now(), auth.uid(), 'wtr_optout.cancelled', 'staff', v_me,
          jsonb_strip_nulls(jsonb_build_object(
            'staffId', v_me, 'employeeId', s.employee_id,
            'noticeDays', coalesce(s.wtr_optout_notice_days, 7),
            'effectiveFrom', v_from,
            'actorName', coalesce((select full_name from profiles where id = auth.uid()),
                                  s.first_name || ' ' || s.last_name || ' (worker)'))));

  insert into notification_outbox (key, channel, template, recipient_emails, payload)
  values ('CL6:staff:' || v_me || ':' || v_from, 'email', 'CL6',
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

comment on function public.cancel_wtr_optout(uuid) is
  'Completion letter requirement §2.4 / acceptance criterion 5: the worker gives notice; the 48-hour ceiling returns from the END of the notice period (wtr_optout_cancelled_from), and a week straddling that date takes the lower cap. Names any already-booked week over the returning ceiling in CL6.';

-- ---------------------------------------------------------------------
-- 8 · §7 A new right-to-work check mid-employment.
--
-- "Worker switches visa route (Graduate/Skilled Worker) mid-employment →
-- new RTW check supersedes the student logic; student caps no longer
-- apply but the WTR 48-hour/opt-out logic still does." RULE-20 keys the
-- Student condition on rtw_branch, so the switch IS the branch changing;
-- this records it with the new expiry and says so in the audit log.
-- below_degree_level describes a Student visa condition and goes with it.
-- The opt-out is untouched: it is Working Time, not immigration.
-- ---------------------------------------------------------------------
create or replace function public.record_right_to_work_change(
  p_staff      uuid,
  p_branch     rtw_branch,
  p_until      date,
  p_share_code text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_reviewer uuid := assert_reviewer();
  s          staff;
begin
  select * into s from staff where id = p_staff for update;
  if s.id is null then
    raise exception 'unknown_staff' using errcode = 'P0001';
  end if;
  if s.status = 'removed' or s.removed_at is not null then
    raise exception 'not_reviewable: removed' using errcode = 'P0001';
  end if;
  if p_branch is null then
    raise exception 'branch_required' using errcode = 'P0001';
  end if;

  update staff
     set rtw_branch = p_branch,
         right_to_work_until = p_until,
         share_code = coalesce(nullif(upper(replace(coalesce(p_share_code, ''), ' ', '')), ''),
                               share_code),
         below_degree_level = case when p_branch = 'international_student'
                                   then below_degree_level else false end
   where id = p_staff;

  insert into audit_log (at, actor, action, entity, entity_id, data)
  values (now(), v_reviewer, 'rtw.changed', 'staff', p_staff,
          jsonb_strip_nulls(jsonb_build_object(
            'staffId', p_staff, 'employeeId', s.employee_id,
            'fromBranch', s.rtw_branch, 'toBranch', p_branch,
            'fromUntil', s.right_to_work_until, 'toUntil', p_until,
            'actorName', (select full_name from profiles where id = v_reviewer))));

  return jsonb_build_object('ok', true, 'branch', p_branch::text, 'until', p_until,
                            'studentLogicEnded', s.rtw_branch = 'international_student'
                                                 and p_branch <> 'international_student');
end $$;

comment on function public.record_right_to_work_change(uuid, rtw_branch, date, text) is
  'Completion letter requirement §7: a new right-to-work check (e.g. Student → Graduate or Skilled Worker) mid-employment. Ends the Student visa condition (RULE-20 keys on rtw_branch) and the term-letter ladder; leaves the 48-hour Working Time rules and the opt-out in force. Audited.';

-- ---------------------------------------------------------------------
-- 9 · term_letter_applies(), keyed on the course completion date.
--
-- 20260921170411 stopped the §4.2 term-letter ladder the day the
-- completion letter was VERIFIED. Under the requirement that is the wrong
-- day: a letter issued before the final exam carries a future completion
-- date, the student is still in term until then, and stopping the ladder
-- early would let their term letter lapse on 31 December with nothing
-- replacing the evidence the 20-hour cap rests on. So the ladder stops
-- when both have happened — verified, AND the course has completed.
--
-- And for a worker no longer on the Student branch at all (§7, the visa
-- switch) the term letter does not apply: without this, a Graduate-visa
-- worker is blocked on 31 December over a document that stopped meaning
-- anything the day their new right-to-work check was recorded. A worker
-- with no branch yet (a candidate before §2.5) is left as it was.
-- ---------------------------------------------------------------------
create or replace function public.term_letter_applies(p_staff uuid, p_on date default current_date)
returns boolean
language sql
stable
set search_path = public, extensions
as $$
  select not exists (
    select 1 from staff s
     where s.id = p_staff
       and (
         (s.rtw_branch is not null and s.rtw_branch <> 'international_student')
         or (s.graduated_at is not null
             and s.graduated_at <= p_on
             and (s.course_completion_date is null or s.course_completion_date <= p_on))))
$$;

comment on function public.term_letter_applies(uuid, date) is
  '§4.2/§4.5: false once a completion letter is verified AND its course completion date has passed (a future-dated letter keeps the ladder running), or once the worker is no longer on the Student branch (completion letter requirement §7).';

-- ---------------------------------------------------------------------
-- 10 · reset_to_candidate(), clearing what joined graduated_at.
--
-- 20260922093100 §8 named the gap: a reset cleared graduated_at and
-- wtr_optout but not course_completion_date or wtr_optout_cancelled_from.
-- Both are dated facts off evidence the reset has just superseded, so
-- they go with it, and so do the opt-out's own fields.
--
-- below_degree_level is deliberately KEPT. It errs at 10 h rather than 20
-- until the new §2.5 check says otherwise — the safe direction — and the
-- next right-to-work check overwrites it either way.
--
-- Body otherwise identical to 20260921192246.
-- ---------------------------------------------------------------------
create or replace function public.reset_to_candidate(
  p_staff  uuid,
  p_reason text,
  p_now    timestamptz default now()
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v staff;
  v_docs int := 0;
  v_decl int := 0;
  v_hmrc int := 0;
begin
  select * into v from staff where id = p_staff for update;
  if v.id is null then
    raise exception 'unknown_staff' using errcode = 'P0001';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'reason_required' using errcode = 'P0001';
  end if;
  if v.status not in ('blocked', 'rejected', 'inactive') then
    raise exception 'not_resettable: %', v.status using errcode = 'P0001';
  end if;
  perform assert_staff_transition(v.status, 'interview_requested'::staff_status);

  with d as (
    update compliance_docs set review_status = 'superseded'
     where staff_id = p_staff and review_status <> 'superseded'
    returning 1
  ) select count(*)::int into v_docs from d;

  with c as (
    update criminal_declarations set superseded = true
     where staff_id = p_staff and not superseded
    returning 1
  ) select count(*)::int into v_decl from c;

  with h as (
    update hmrc_checklists set superseded = true
     where staff_id = p_staff and not superseded
    returning 1
  ) select count(*)::int into v_hmrc from h;

  update staff
     set status = 'interview_requested',
         block_kind = null,
         block_reason = null,
         contract_signed_at = null,
         contract_version = null,
         quiz_attempts = 0,
         share_code = null,
         right_to_work_until = null,
         rtw_branch = null,
         term_dates = '{}',
         graduated_at = null,
         course_completion_date = null,
         wtr_optout = false,
         wtr_optout_cancelled_from = null,
         wtr_optout_signed_at = null,
         wtr_optout_notice_days = null,
         wtr_optout_copy_path = null
   where id = p_staff;

  insert into audit_log (at, actor, action, entity, entity_id, data)
  values (p_now, auth.uid(), 'reset_to_candidate', 'staff', p_staff,
          jsonb_build_object('reason', trim(p_reason),
                             'fromStatus', v.status::text,
                             'employeeId', v.employee_id,
                             'leftAt', v.left_at,
                             'leaveReason', v.leave_reason,
                             -- What the superseded evidence had set, so the
                             -- previous period's cap can still be explained.
                             'courseCompletionDate', v.course_completion_date,
                             'graduatedAt', v.graduated_at,
                             'wtrOptout', v.wtr_optout));

  return jsonb_build_object(
    'staffId', p_staff::text,
    'fromStatus', v.status::text,
    'employeeId', v.employee_id,
    'docsSuperseded', v_docs,
    'declarationsSuperseded', v_decl,
    'checklistsSuperseded', v_hmrc);
end $$;

-- ---------------------------------------------------------------------
-- 11 · §1.7 removal, with the completion letter's retention hold.
--
-- The requirement (§4): completion evidence is "retained for the duration
-- of employment plus two years after it ends (in line with right-to-work
-- evidence retention)". §1.7 wipes documents on removal. Where the two
-- meet — a worker who WAS employed asks to be removed inside that window
-- — the legal obligation wins (UK GDPR Art. 17(3)(b)) and the letter and
-- its file are held, with retain_until on the row, until rtw_daily()
-- purges them. ADR-0012 records the decision and asks THC to confirm it.
--
-- Employment ends when they left (left_at) or, if they never did, at the
-- removal itself. Someone never employed (no contract, no Employee ID) has
-- no employment to retain against, and their letter is wiped with
-- everything else, exactly as before.
--
-- Everything else is 20260922081512's body, plus the columns this
-- migration and 20260922093100 added to staff.
-- ---------------------------------------------------------------------
create or replace function public.remove_worker(
  p_staff uuid,
  p_now   timestamptz default now()
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v staff;
  v_cascade jsonb;
  v_docs int := 0;
  v_files int := 0;
  v_apps int := 0;
  v_held int := 0;
  v_today date := (p_now at time zone 'Europe/London')::date;
  v_retain date;
begin
  select * into v from staff where id = p_staff for update;
  if v.id is null then
    raise exception 'unknown_staff' using errcode = 'P0001';
  end if;
  if v.status = 'removed' then
    return jsonb_build_object('staffId', p_staff::text, 'alreadyRemoved', true);
  end if;

  v_cascade := block_worker(p_staff, null, null, p_now, 'removed', 'gdpr');

  if v.contract_signed_at is not null or v.employee_id is not null then
    v_retain := ((coalesce(v.left_at, p_now) at time zone 'Europe/London')::date
                 + interval '2 years')::date;
  end if;

  if v_retain is not null and v_retain > v_today then
    with h as (
      update compliance_docs set retain_until = v_retain
       where staff_id = p_staff
         and doc_type = 'university_completion_letter'
      returning 1
    ) select count(*)::int into v_held from h;
  end if;

  with paths as (
    select 'documents'::text as bucket, d.file_path as path
      from compliance_docs d
     where d.staff_id = p_staff and d.file_path is not null and d.retain_until is null
    union
    select 'documents', d.gov_report_path
      from compliance_docs d
     where d.staff_id = p_staff and d.gov_report_path is not null and d.retain_until is null
    union
    select 'documents', v.wtr_optout_copy_path where v.wtr_optout_copy_path is not null
    union
    select 'photos', v.photo_path where v.photo_path is not null
  ), queued as (
    insert into storage_deletions (bucket, path, staff_id)
    select bucket, path, p_staff from paths
    on conflict (bucket, path) do nothing
    returning 1
  ) select count(*)::int into v_files from queued;

  update staff
     set first_name  = 'Deleted',
         last_name   = 'account',
         email       = 'removed-' || coalesce(v.employee_id::text, replace(p_staff::text, '-', '')) || '@invalid.example',
         phone       = '+440000000000',
         dob         = date '1900-01-01',
         home_address = null,
         home_location = null,
         photo_path  = null,
         ni_number   = null,
         share_code  = null,
         right_to_work_until = null,
         rtw_branch  = null,
         term_dates  = '{}',
         graduated_at = null,
         course_completion_date = null,
         below_degree_level = false,
         wtr_optout  = false,
         wtr_optout_cancelled_from = null,
         wtr_optout_signed_at = null,
         wtr_optout_notice_days = null,
         wtr_optout_copy_path = null,
         leave_reason = null,
         willo_candidate_id = null,
         user_id     = null,
         removed_at  = p_now
   where id = p_staff;

  with d as (delete from compliance_docs
              where staff_id = p_staff and retain_until is null
             returning 1)
    select count(*)::int into v_docs from d;
  delete from bank_details      where staff_id = p_staff;
  delete from staff_references  where staff_id = p_staff;
  delete from hmrc_checklists   where staff_id = p_staff;
  delete from push_subscriptions where staff_id = p_staff;

  update criminal_declarations
     set details = null, conviction_date = null
   where staff_id = p_staff;

  with a as (
    update applications
       set first_name = 'Deleted',
           last_name  = 'account',
           email      = 'removed-' || id::text || '@invalid.example',
           phone      = '+440000000000'
     where staff_id = p_staff
       and email not like 'removed-%@invalid.example'
    returning 1
  ) select count(*)::int into v_apps from a;

  insert into audit_log (at, actor, action, entity, entity_id, data)
  values (p_now, auth.uid(), 'gdpr_remove', 'staff', p_staff,
          jsonb_build_object('employeeId', v.employee_id,
                             'fromStatus', v.status::text,
                             'documentsDeleted', v_docs,
                             'documentsHeld', v_held,
                             'retainUntil', v_retain,
                             'filesQueued', v_files,
                             'applicationsAnonymised', v_apps,
                             'willoCandidateId', v.willo_candidate_id));

  return v_cascade || jsonb_build_object(
    'label', deleted_account_label(v.employee_id),
    'documentsDeleted', v_docs,
    'documentsHeld', v_held,
    'retainUntil', case when v_held > 0 then v_retain end,
    'filesQueued', v_files,
    'applicationsAnonymised', v_apps);
end $$;

comment on function public.remove_worker(uuid, timestamptz) is
  '§1.7 GDPR removal. Irreversible anonymisation; documents, bank details, referees, checklist and push subscriptions deleted; files queued for gdpr-purge; login unlinked; future bookings released. EXCEPT a completion letter of someone who was employed, removed inside employment + 2 years: held with retain_until and purged by rtw_daily() when the window closes (completion letter requirement §4, ADR-0012).';

-- ---------------------------------------------------------------------
-- 12 · The daily half: right-to-work alerts and the retention purge.
--
-- §2.3: "should alert admin ahead of expiry (e.g. 60/30/14 days)". As
-- bands, like the §4.2 ladder, for the same reason: a missed day must not
-- skip a rung, and the outbox key makes each rung fire once. The key
-- carries the expiry date itself, so a renewed right to work rings again.
-- Every live worker with an expiry on file, not only students: the office
-- is told before anyone's right to work runs out, and can_roster() stops
-- the rota on the day either way.
--
-- Called by the compliance-daily Edge Function after compliance_daily().
-- ---------------------------------------------------------------------
create or replace function public.rtw_daily(p_now timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_today  date := (p_now at time zone 'Europe/London')::date;
  v_alerts int := 0;
  v_purged int := 0;
  r record;
begin
  with due as (
    select s.id, s.first_name, s.last_name, s.employee_id, s.rtw_branch,
           s.right_to_work_until as rtw_until,
           (s.right_to_work_until - v_today) as days_left
      from staff s
     where s.status in ('compliant', 'blocked')
       and s.left_at is null
       and s.removed_at is null
       and s.right_to_work_until is not null
       and s.right_to_work_until >= v_today
       and s.right_to_work_until - v_today <= 60
  ), q as (
    insert into notification_outbox (key, channel, template, recipient_emails, payload)
    select 'CL4:staff:' || due.id || ':' || due.rtw_until || ':'
             || case when due.days_left > 30 then 60 when due.days_left > 14 then 30 else 14 end,
           'email', 'CL4',
           array['admin@thehospitalitycompany.co.uk'],
           jsonb_build_object(
             'name',       due.first_name || ' ' || due.last_name,
             'employeeId', coalesce(due.employee_id::text, '(not yet issued)'),
             'visaExpiry', to_char(due.rtw_until, 'DD Mon YYYY'),
             'days',       due.days_left::text,
             'tier',       (case when due.days_left > 30 then 60
                                 when due.days_left > 14 then 30 else 14 end)::text,
             'route',      case due.rtw_branch
                             when 'international_student' then 'Student visa'
                             when 'work_visa' then 'Work visa'
                             when 'eu_settled' then 'EU settled / pre-settled status'
                             else coalesce(due.rtw_branch::text, 'not recorded') end)
      from due
    on conflict (key) do nothing
    returning 1
  ) select count(*)::int into v_alerts from q;

  -- The retention purge (ADR-0012). The file is queued BEFORE the row that
  -- names it is deleted; the delete writes completion_letter.purged to the
  -- audit trail through its trigger.
  for r in
    select d.id, d.file_path, d.staff_id
      from compliance_docs d
      join staff s on s.id = d.staff_id
     where d.retain_until is not null
       and d.retain_until <= v_today
       and s.removed_at is not null
  loop
    if r.file_path is not null then
      insert into storage_deletions (bucket, path, staff_id)
      values ('documents', r.file_path, r.staff_id)
      on conflict (bucket, path) do nothing;
    end if;
    delete from compliance_docs where id = r.id;
    v_purged := v_purged + 1;
  end loop;

  return jsonb_build_object('rtwAlerts', v_alerts, 'retentionPurged', v_purged);
end $$;

comment on function public.rtw_daily(timestamptz) is
  'Completion letter requirement §2.3 and §4: admin email CL4 at 60/30/14 days before any live worker''s right to work expires (bands, once each per expiry date), and the purge of completion letters whose employment + 2 years retention hold has run out.';

-- ---------------------------------------------------------------------
-- 13 · §4 Reporting — the existing §4.5 Student visa view, extended.
--
-- The requirement asks for "a view of all student-visa workers, their
-- current cap, evidence status, and visa expiry dates". student_visa_v
-- (20260922091732) already is that view, on /staff; this adds what the
-- requirement brought (completion date, evidence status including a
-- rejected letter, below-degree level, the opt-out's state, days to
-- expiry) rather than building a second one.
--
-- term_letter_expires_at is corrected in place: it read max(expiry_date),
-- which is null for every term letter because §4.2 derives the expiry
-- (31 December) rather than storing it. doc_expires_on() is that rule.
-- ---------------------------------------------------------------------
create or replace view student_visa_v with (security_invoker = true) as
select
  d.id,
  d.display_name,
  d.employee_id,
  d.photo_path,
  d.status,
  d.weekly_cap_hours,
  d.weekly_cap_band,
  d.weekly_booked_hours,
  d.right_to_work_until,
  d.graduated_at,
  d.wtr_optout,
  (select max(c.reviewed_at) from compliance_docs c
    where c.staff_id = d.id and c.doc_type = 'university_term_dates_letter'
      and c.review_status = 'verified')                      as term_letter_verified_at,
  (select max(doc_expires_on(c.doc_type, c.expiry_date, c.right_to_work_until,
                             d.right_to_work_until, c.uploaded_at))
     from compliance_docs c
    where c.staff_id = d.id and c.doc_type = 'university_term_dates_letter'
      and c.review_status = 'verified')                      as term_letter_expires_at,
  (select max(c.reviewed_at) from compliance_docs c
    where c.staff_id = d.id and c.doc_type = 'university_completion_letter'
      and c.review_status = 'verified')                      as completion_letter_verified_at,
  exists (select 1 from compliance_docs c
           where c.staff_id = d.id and c.doc_type = 'university_completion_letter'
             and c.review_status = 'pending')                as completion_letter_in_review,
  -- ---- appended by 20260923100100 --------------------------------------
  s.below_degree_level,
  s.course_completion_date,
  (select c.review_status::text from compliance_docs c
    where c.staff_id = d.id and c.doc_type = 'university_completion_letter'
      and c.review_status <> 'superseded'
    order by c.uploaded_at desc, c.id desc limit 1)          as completion_letter_status,
  (select c.rejection_reason from compliance_docs c
    where c.staff_id = d.id and c.doc_type = 'university_completion_letter'
      and c.review_status <> 'superseded'
    order by c.uploaded_at desc, c.id desc limit 1)          as completion_letter_rejection,
  (select c.completion_date_claimed from compliance_docs c
    where c.staff_id = d.id and c.doc_type = 'university_completion_letter'
      and c.review_status = 'pending'
    order by c.uploaded_at desc limit 1)                     as completion_date_claimed,
  case when s.course_completion_date is not null and s.graduated_at is not null
       then completion_effective_from(s.course_completion_date, s.graduated_at) end
                                                             as completion_effective_from,
  s.wtr_optout_cancelled_from,
  s.dob is not null
    and (s.dob + interval '18 years')::date <= (now() at time zone 'Europe/London')::date
                                                             as optout_eligible,
  (d.right_to_work_until - (now() at time zone 'Europe/London')::date)
                                                             as rtw_days_left
from staff_directory_v d
join staff s on s.id = d.id
where d.rtw_branch = 'international_student'
  and not d.removed;

comment on view student_visa_v is
  'The §4.5 Student visa view and the completion letter requirement''s §4 report: every live worker on the International student branch, the cap RULE-20 calculates for them today, the evidence behind it (term letter, completion letter status incl. rejected and pending, completion date, below-degree level, opt-out) and the right-to-work expiry with days left. Reads through staff_directory_v, so §1.7''s anonymisation and the cap are not repeated.';

-- ---------------------------------------------------------------------
-- 14 · §4 / acceptance criterion 7 — the export.
--
-- Every completion letter upload and decision and every opt-out signed or
-- cancelled, one row each, with who and when. audit_log is admin_read, so
-- this view (security_invoker) is the office's and nobody else's. The
-- worker's name is §1.7's label for a removed worker.
-- ---------------------------------------------------------------------
create or replace view compliance_evidence_audit_v with (security_invoker = true) as
select
  a.id,
  a.at,
  split_part(a.action, '.', 1)                                as record_type,
  split_part(a.action, '.', 2)                                as event,
  case when a.entity = 'compliance_doc' then a.entity_id end  as document_id,
  (a.data ->> 'staffId')::uuid                                as staff_id,
  coalesce(s.employee_id, (a.data ->> 'employeeId')::int)     as employee_id,
  case when s.removed_at is not null then deleted_account_label(s.employee_id)
       when s.id is not null then s.first_name || ' ' || s.last_name end
                                                              as worker,
  a.actor,
  coalesce(a.data ->> 'actorName', p.full_name)               as actor_name,
  a.data ->> 'evidenceForm'                                   as evidence_form,
  a.data ->> 'filePath'                                       as file_path,
  (a.data ->> 'uploadedAt')::timestamptz                      as uploaded_at,
  (a.data ->> 'completionDateClaimed')::date                  as completion_date_claimed,
  (a.data ->> 'completionDate')::date                         as completion_date,
  (a.data ->> 'visaExpiry')::date                             as visa_expiry,
  a.data ->> 'reason'                                         as reason,
  (a.data ->> 'noticeDays')::int                              as notice_days,
  (a.data ->> 'effectiveFrom')::date                          as effective_from,
  (a.data ->> 'retainUntil')::date                            as retain_until
from audit_log a
left join staff s    on s.id = (a.data ->> 'staffId')::uuid
left join profiles p on p.id = a.actor
where a.action like 'completion\_letter.%' or a.action like 'wtr\_optout.%';

comment on view compliance_evidence_audit_v is
  'Completion letter requirement §4 and acceptance criterion 7: every completion letter upload, approval, rejection, supersede and purge and every opt-out signed or cancelled — document, upload time, reviewer, decision time, completion dates, visa expiry, reasons — for the CSV export on /compliance. Reads audit_log, which is admin-read and append-only.';

-- ---------------------------------------------------------------------
-- 15 · Privileges.
-- ---------------------------------------------------------------------
revoke execute on function public.evidence_upload_problem(uuid, text, text) from public, anon, authenticated;
grant  execute on function public.evidence_upload_problem(uuid, text, text) to service_role;

revoke execute on function public.completion_letter_audit() from public, anon, authenticated;
revoke execute on function public.completion_letter_approval_guard() from public, anon, authenticated;

-- Worker-side: signed-in, and staff_caller() inside decides whose row.
revoke execute on function public.submit_completion_letter(text, date, text, text, uuid) from public, anon;
revoke execute on function public.sign_wtr_optout(text, int, uuid) from public, anon;
revoke execute on function public.cancel_wtr_optout(uuid) from public, anon;
grant  execute on function public.submit_completion_letter(text, date, text, text, uuid) to authenticated, service_role;
grant  execute on function public.sign_wtr_optout(text, int, uuid) to authenticated, service_role;
grant  execute on function public.cancel_wtr_optout(uuid) to authenticated, service_role;

-- Office-side: assert_reviewer() inside refuses anyone not an admin.
revoke execute on function public.approve_completion_letter(uuid, date, date) from public, anon;
revoke execute on function public.record_right_to_work_change(uuid, rtw_branch, date, text) from public, anon;
grant  execute on function public.approve_completion_letter(uuid, date, date) to authenticated, service_role;
grant  execute on function public.record_right_to_work_change(uuid, rtw_branch, date, text) to authenticated, service_role;

-- The daily job: service role only, like compliance_daily().
revoke execute on function public.rtw_daily(timestamptz) from public, anon, authenticated;
grant  execute on function public.rtw_daily(timestamptz) to service_role;

-- reset_to_candidate and remove_worker keep their lockdown; replacing a
-- function preserves its ACL, and these restate it for the reader.
revoke execute on function public.reset_to_candidate(uuid, text, timestamptz) from public, anon, authenticated;
revoke execute on function public.remove_worker(uuid, timestamptz) from public, anon, authenticated;
grant  execute on function public.reset_to_candidate(uuid, text, timestamptz) to service_role;
grant  execute on function public.remove_worker(uuid, timestamptz) to service_role;

revoke all on compliance_evidence_audit_v from public, anon;
grant select on compliance_evidence_audit_v to authenticated, service_role;
revoke all on student_visa_v from public, anon;
grant select on student_visa_v to authenticated, service_role;
