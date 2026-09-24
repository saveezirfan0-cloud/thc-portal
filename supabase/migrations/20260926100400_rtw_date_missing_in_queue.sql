-- =====================================================================
-- Right-to-work date missing → a row in Needs review (§4.1, §2.5, §2.6,
-- ADR-0018, docs/14 §4 "From the 23.09 build")
--
-- The gap this closes
-- -------------------
-- 20260923200000 made the right-to-work date mandatory on Verify and
-- backfilled the worker's date from any DATED evidence. A share code
-- report verified before 23.09 carries no date at all, so those workers
-- still have staff.right_to_work_until = NULL — and can_roster_staff()
-- reads NULL as "no expiry recorded", so nothing stops a shift past their
-- visa and compliance_daily's ladder has no date to count down from. The
-- only thing that found them was a SELECT in that migration's header,
-- which nobody runs.
--
-- What this does
-- --------------
--   1. compliance_review_queue_v gains a third kind of row, 'rtw_date':
--      one per live non-UK worker whose LATEST verified share code report
--      has no right-to-work date and no settled-status confirmation, and
--      whose own right_to_work_until is still NULL. The row reads
--      "Right-to-work date missing — re-verify" (review_reason), is keyed
--      on that share code report (item_id), carries the share code the
--      office needs to re-run the gov.uk check, and is counted by the tab
--      and the crumb like any other review item — the screen counts rows.
--      It disappears the moment a date (or the explicit no-time-limit
--      confirmation) lands on the report or on the worker, and it is not
--      shown while a NEW share code report is pending for the worker:
--      verifying that one closes the gap and it is already in the queue,
--      so two rows would count one job twice.
--
--      Restated from its latest definition (20260923210000 — block_reason
--      read through staff_block_reason_v), every column and predicate
--      carried; review_reason is APPENDED, because create-or-replace may
--      only add columns at the end. Restated rather than a companion view
--      because the queue's row shape carries it comfortably (item_type
--      'share_code_report' even lets the existing document filter find
--      it) and the tab must count it — a second view would mean a second
--      read and a second count.
--
--   2. compliance_confirm_rtw_date(): the re-verify itself. The share
--      code report is already `verified`, so compliance_verify_document()
--      refuses it (not_pending) — and it must: the worker's right to work
--      WAS checked, only the date was never written down. This confirms
--      the date on the existing report under the same rules as Verify
--      (future date; 'infinity' = settled, no time limit, EU branch on a
--      share code only; live profiles only; the LATEST verified report
--      only, because rtw_evidence_until() reads no other), restamps the
--      reviewer on the row (§1.8: the stamp names who confirmed the date
--      now in force) and audits it as rtw.verified with reverified = true.
--      The worker's date follows through compliance_docs_rtw_until, the
--      same row trigger every other path relies on, so the Radar, the
--      ladder and the per-shift stop all pick it up with no second write.
--      An admin's direct PostgREST update of the row would also set the
--      date (admin_all reaches compliance_docs) but is neither validated
--      nor audited; the screen calls this.
--
-- What this deliberately does not do
-- ----------------------------------
--   · can_roster_staff() still reads a NULL date as "no expiry" for a
--     non-UK worker (20260922093100, asserted rather than assumed in
--     524_rtw_date_missing_in_queue.sql). The rota guard is another
--     owner's; this migration surfaces the workers it cannot stop.
--
-- Forward-only. Nothing here edits an earlier migration.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1 · The queue, with the third kind of row.
-- ---------------------------------------------------------------------
create or replace view compliance_review_queue_v with (security_invoker = true) as
select
  'document'::text                                           as kind,
  d.id                                                       as item_id,
  s.id                                                       as staff_id,
  s.first_name || ' ' || s.last_name                         as display_name,
  s.employee_id,
  s.status,
  s.status in ('interview_requested', 'interview_completed', 'documents', 'quiz', 'contract')
                                                             as is_candidate,
  s.block_kind,
  (select r.block_reason from public.staff_block_reason_v r where r.staff_id = s.id) as block_reason,
  s.rtw_branch,
  s.photo_path,
  d.doc_type::text                                           as item_type,
  doc_label(d.doc_type)                                      as item_label,
  d.uploaded_at                                              as submitted_at,
  d.file_path,
  d.ai_confidence,
  d.needs_manual_review,
  d.expiry_date,
  d.term_dates,
  d.right_to_work_until                                      as doc_right_to_work_until,
  d.share_code,
  d.awarding_institution,
  exists (select 1 from compliance_docs p
           where p.staff_id = d.staff_id and p.doc_type = d.doc_type and p.id <> d.id
             and p.review_status in ('verified', 'rejected')
             and p.uploaded_at <= d.uploaded_at)             as is_reupload,
  (select p.rejection_reason from compliance_docs p
    where p.staff_id = d.staff_id and p.doc_type = d.doc_type and p.id <> d.id
      and p.review_status = 'rejected' and p.uploaded_at <= d.uploaded_at
    order by p.uploaded_at desc limit 1)                     as previous_rejection,
  null::text                                                 as declaration_source,
  null::text                                                 as declaration_details,
  null::date                                                 as conviction_date,
  s.right_to_work_until                                      as staff_right_to_work_until,
  d.evidence_form,
  d.completion_date_claimed,
  d.mime_type,
  d.size_bytes,
  -- Appended (20260926100400): why a row that is not a pending upload is
  -- here. Null on document and declaration rows.
  null::text                                                 as review_reason
from compliance_docs d
join staff s on s.id = d.staff_id
where d.review_status = 'pending'
  and s.status not in ('rejected', 'removed')
  and s.removed_at is null
union all
select
  'declaration'::text,
  c.id,
  s.id,
  s.first_name || ' ' || s.last_name,
  s.employee_id,
  s.status,
  s.status in ('interview_requested', 'interview_completed', 'documents', 'quiz', 'contract'),
  s.block_kind,
  (select r.block_reason from public.staff_block_reason_v r where r.staff_id = s.id) as block_reason,
  s.rtw_branch,
  s.photo_path,
  'criminal_declaration'::text,
  'Criminal Record declaration'::text,
  c.declared_at,
  null::text,
  null::numeric,
  false,
  null::date,
  null::daterange[],
  null::date,
  null::text,
  null::text,
  false,
  null::text,
  c.source::text,
  c.details,
  c.conviction_date,
  s.right_to_work_until,
  null::text,
  null::date,
  null::text,
  null::bigint,
  null::text
from criminal_declarations c
join staff s on s.id = c.staff_id
where c.answer
  and c.review_status = 'pending'
  and not c.superseded
  and s.status not in ('rejected', 'removed')
  and s.removed_at is null
union all
-- A share code verified with no date (before 20260923200000). Keyed on
-- the report so the screen's Verify has something to confirm the date on;
-- the "uploaded" stamp is when it was verified without one, which is how
-- long the gap has stood. needs_manual_review is true because only a
-- human can close it: there is no upload for an extractor to read.
select
  'rtw_date'::text,
  d.id,
  s.id,
  s.first_name || ' ' || s.last_name,
  s.employee_id,
  s.status,
  s.status in ('interview_requested', 'interview_completed', 'documents', 'quiz', 'contract'),
  s.block_kind,
  (select r.block_reason from public.staff_block_reason_v r where r.staff_id = s.id) as block_reason,
  s.rtw_branch,
  s.photo_path,
  d.doc_type::text,
  doc_label(d.doc_type),
  coalesce(d.reviewed_at, d.uploaded_at),
  d.file_path,
  null::numeric,
  true,
  null::date,
  null::daterange[],
  d.right_to_work_until,
  coalesce(d.share_code, s.share_code),
  null::text,
  false,
  null::text,
  null::text,
  null::text,
  null::date,
  s.right_to_work_until,
  null::text,
  null::date,
  d.mime_type,
  d.size_bytes,
  'Right-to-work date missing — re-verify'::text
from compliance_docs d
join staff s on s.id = d.staff_id
where d.doc_type = 'share_code_report'
  and d.review_status = 'verified'
  and d.right_to_work_until is null
  and not d.rtw_no_time_limit
  -- The latest verified report is the one rtw_evidence_until() reads
  -- (same order: newest upload first, id as the tie-break).
  and d.id = (select l.id from compliance_docs l
               where l.staff_id = d.staff_id
                 and l.doc_type = 'share_code_report'
                 and l.review_status = 'verified'
               order by l.uploaded_at desc, l.id
               limit 1)
  -- The header query of 20260923200000: non-UK, live, no date on the worker.
  and s.rtw_branch is not null
  and s.rtw_branch <> 'uk_irish'
  and s.right_to_work_until is null
  and s.status in ('documents', 'quiz', 'contract', 'compliant', 'blocked')
  and s.removed_at is null
  -- A new report already waiting in this queue closes the gap on its own Verify.
  and not exists (select 1 from compliance_docs p
                   where p.staff_id = d.staff_id
                     and p.doc_type = 'share_code_report'
                     and p.review_status = 'pending');

comment on view compliance_review_queue_v is
  '§4.1 Needs review: every pending document and every pending Yes declaration on a live profile (Rejected and Removed drop out), plus — kind ''rtw_date'' — every live non-UK worker whose latest verified share code report carries no right-to-work date and no settled-status confirmation while their own date is NULL (20260926100400, ADR-0018). Oldest first is the screen''s sort; review_reason says why a non-pending row is here. security_invoker: admin_all on the base tables is the gate.';

revoke all on compliance_review_queue_v from public, anon;
grant select on compliance_review_queue_v to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 2 · The re-verify: confirm the date on an already-verified share code.
--
-- Mirrors compliance_verify_document()'s date rules for a share code
-- report (20260923200000 §6) without re-running Verify: the review status
-- does not change, so the §4.3 re-check and N8 do not fire; the row
-- trigger compliance_docs_rtw_until writes the worker's date.
-- ---------------------------------------------------------------------
create or replace function public.compliance_confirm_rtw_date(
  p_doc                 uuid,
  p_right_to_work_until date
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
  v_no_limit boolean := false;
  v_until    date;
begin
  select * into d from compliance_docs where id = p_doc for update;
  if d.id is null then
    raise exception 'document_not_found' using errcode = 'P0002';
  end if;
  if d.doc_type <> 'share_code_report' then
    raise exception 'not_a_share_code: %', d.doc_type using errcode = 'P0001',
      hint = 'Only a share code report is re-verified for its date; a visa or status document is re-uploaded and verified with its expiry.';
  end if;
  if d.review_status <> 'verified' then
    -- A pending report is verified, with its date, through compliance_verify_document().
    raise exception 'not_verified: %', d.review_status using errcode = 'P0001';
  end if;

  select * into s from staff where id = d.staff_id for update;
  if s.status in ('rejected', 'removed') or s.removed_at is not null then
    -- §4.1: their documents "no longer need review".
    raise exception 'not_reviewable: %', s.status using errcode = 'P0001';
  end if;
  if exists (select 1 from compliance_docs n
              where n.staff_id = d.staff_id
                and n.doc_type = 'share_code_report'
                and n.review_status = 'verified'
                and (n.uploaded_at > d.uploaded_at
                     or (n.uploaded_at = d.uploaded_at and n.id < d.id))) then
    -- rtw_evidence_until() reads the latest verified report only; a date
    -- on an older one would change nothing and mislead the Documents tab.
    raise exception 'superseded_by_newer' using errcode = 'P0001';
  end if;

  if p_right_to_work_until is null then
    raise exception 'rtw_date_required: share_code_report' using errcode = 'P0001';
  end if;
  if not isfinite(p_right_to_work_until) then
    if p_right_to_work_until < v_today or s.rtw_branch is distinct from 'eu_settled' then
      raise exception 'no_time_limit_not_allowed: %', coalesce(s.rtw_branch::text, 'no branch')
        using errcode = 'P0001';
    end if;
    v_no_limit := true;
  elsif p_right_to_work_until <= v_today then
    -- §4.2: a date already passed is not accepted — the worker is blocked
    -- for a current check, not re-verified onto an expired one.
    raise exception 'already_expired: %', p_right_to_work_until using errcode = 'P0001';
  end if;
  v_until := case when v_no_limit then null else p_right_to_work_until end;

  -- rtw_no_time_limit first, then the date: the check constraint wants a
  -- NULL date beside the flag, and one UPDATE satisfies it either way.
  update compliance_docs
     set right_to_work_until = v_until,
         rtw_no_time_limit = v_no_limit,
         reviewed_by = v_reviewer,
         reviewed_at = now()
   where id = d.id;

  insert into audit_log (at, actor, action, entity, entity_id, data)
  values (now(), v_reviewer, 'rtw.verified', 'compliance_docs', d.id,
          jsonb_strip_nulls(jsonb_build_object(
            'staffId',          s.id,
            'employeeId',       s.employee_id,
            'branch',           s.rtw_branch,
            'docType',          d.doc_type::text,
            'confirmedUntil',   v_until,
            'noTimeLimit',      v_no_limit,
            'reverified',       true,
            'staffUntilBefore', s.right_to_work_until,
            'staffUntilAfter',  (select right_to_work_until from staff where id = s.id),
            'actorName',        (select full_name from profiles where id = v_reviewer))));

  return jsonb_build_object(
    'ok', true,
    'documentId', d.id::text,
    'noTimeLimit', v_no_limit,
    'rightToWorkUntil', (select right_to_work_until from staff where id = s.id));
end $$;

comment on function public.compliance_confirm_rtw_date(uuid, date) is
  'The Needs review row "Right-to-work date missing — re-verify" (20260926100400): confirms the gov.uk right-to-work-until on a share code report that was verified without one. Verified, latest-for-the-worker reports on live profiles only; a future date, or ''infinity'' for settled status with no time limit (EU branch only). Restamps the reviewer, audits rtw.verified with reverified = true; staff.right_to_work_until follows through compliance_docs_rtw_until. A pending report goes through compliance_verify_document() instead.';

revoke execute on function public.compliance_confirm_rtw_date(uuid, date) from public, anon;
grant  execute on function public.compliance_confirm_rtw_date(uuid, date) to authenticated, service_role;
