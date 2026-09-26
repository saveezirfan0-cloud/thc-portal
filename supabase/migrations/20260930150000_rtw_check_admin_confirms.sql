-- =====================================================================
-- Migration 20260930150000 · the gov.uk check waits for an admin, and
--                            needs no provider (ADR-0041, amending ADR-0025)
--
-- ADR-0025 built the check to the first brief: provider first, gov.uk as
-- the fallback, fully automatic — a pass verified by the system actor and
-- a "not found" rejected with N8, with no photo match. The product owner
-- has since decided (ADR-0041):
--
--   1. No right-to-work provider. Our own gov.uk automation is the only
--      route: settings.rtw_check.primary = 'govuk', fallback = null.
--   2. Option C. Everything up to the decision is automatic; the decision
--      is an admin's click. The admin compares the photo gov.uk shows with
--      the worker's app selfie and presses Verify or Reject — including
--      for "not found". That keeps the Home Office photo check with a
--      person (the statutory excuse), and keeps a rejection out of UK GDPR
--      Article 22's "solely automated decision".
--
-- ADR-0025 anticipated this ("add a status between running and passed …
-- and move the Verify call to the office's confirmation"). It is done
-- with the status the office already works from rather than a new one:
-- every result lands in needs_review, carrying a RECOMMENDATION —
--
--   verify  gov.uk confirms a right to work that fits the profile
--   reject  gov.uk found no record, or no right to work
--   review  anything else (a name, a condition, repeated errors)
--
-- — so the queue, rtw_check_manual_allowed() (needs_review may be decided
-- by hand), the one Verify / Reject path and its reviewed_at stamp all
-- work unchanged. The fully automatic path stays available behind
-- settings.rtw_check.admin_confirms = false, which pgTAP 600 still covers.
--
-- Added:
--   · rtw_checks.recommendation, .photo_path, .suggested_reason (the N8
--     text the Reject box is pre-filled with — office-only, because
--     my_rtw_checks() shows worker_reason to the worker, and nothing may
--     reach them before the office has decided).
--   · rtw_check_attach_photo() — the runner files the gov.uk photo while
--     the check is running (service role only, path under the worker).
--   · rtw_checks_forget_report() queues the photo with the report.
--   · rtw_checks_latest_v carries the three new columns (appended).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1 · Settings: no provider, and the admin confirms.
-- ---------------------------------------------------------------------
create or replace function public.rtw_check_config()
returns jsonb
language sql
stable
security definer
set search_path = public, extensions
as $$
  select jsonb_build_object(
           'enabled',        false,
           'primary',        'govuk',
           'fallback',       null,
           'admin_confirms', true,
           'company_name',   'The Hospitality Company',
           'stale_after_minutes', 60,
           'reenter_per_day', 5,
           'max_attempts', 5)
         || coalesce((select value from settings
                       where key = 'rtw_check' and jsonb_typeof(value) = 'object'), '{}'::jsonb)
$$;

comment on function public.rtw_check_config() is
  'settings.rtw_check over its defaults: enabled (false), primary (govuk), fallback (null — no provider, ADR-0041), admin_confirms (true — every result waits for an admin''s Verify or Reject, ADR-0041), company_name (the name gov.uk is told is checking), stale_after_minutes (60), reenter_per_day (5), max_attempts (5).';

-- The stored row follows, unless someone has already chosen differently:
-- only the first brief's untouched defaults are moved.
update settings
   set value = value || jsonb_build_object('primary', 'govuk', 'fallback', null, 'admin_confirms', true),
       updated_at = now()
 where key = 'rtw_check'
   and jsonb_typeof(value) = 'object'
   and value ->> 'primary' = 'provider'
   and value ->> 'fallback' = 'govuk'
   and not (value ? 'admin_confirms');

-- ---------------------------------------------------------------------
-- 2 · The columns.
-- ---------------------------------------------------------------------
alter table rtw_checks add column if not exists recommendation   text;
alter table rtw_checks add column if not exists photo_path       text;
alter table rtw_checks add column if not exists suggested_reason text;

alter table rtw_checks drop constraint if exists rtw_checks_recommendation;
alter table rtw_checks add constraint rtw_checks_recommendation
  check (recommendation is null or recommendation in ('verify', 'reject', 'review'));

comment on column rtw_checks.recommendation is
  'What the check recommends the admin does (ADR-0041): verify, reject or review. With admin_confirms on, every result is needs_review with one of these; the admin decides through verify_document / reject_document.';
comment on column rtw_checks.photo_path is
  'The applicant photo gov.uk showed, <staff_id>/share-code-report/…png in the private documents bucket, for the admin to compare with the app selfie. Queued for deletion with the row (§1.7).';
comment on column rtw_checks.suggested_reason is
  'Office-only: the worker-facing reason the Reject box is pre-filled with when the recommendation is reject. It becomes the N8 reason only if the admin rejects. Never shown to the worker (my_rtw_checks reads worker_reason, not this).';

-- ---------------------------------------------------------------------
-- 3 · The photo, filed while the check runs.
-- ---------------------------------------------------------------------
create or replace function public.rtw_check_attach_photo(p_check uuid, p_photo_path text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  c rtw_checks;
begin
  select * into c from rtw_checks where id = p_check for update;
  if c.id is null then
    raise exception 'rtw_check_not_found' using errcode = 'P0002';
  end if;
  if c.status <> 'running' then
    raise exception 'rtw_check_not_running: %', c.status using errcode = 'P0001';
  end if;
  if p_photo_path is null
     or p_photo_path !~ ('^' || c.staff_id::text || '/share-code-report/[A-Za-z0-9][A-Za-z0-9._-]*\.png$') then
    raise exception 'rtw_photo_path_invalid' using errcode = '22023';
  end if;
  -- A photo this one replaces (a re-claim after a lapsed lease) is owed
  -- to the purge, not left behind with nothing pointing at it.
  if c.photo_path is not null and c.photo_path <> p_photo_path then
    insert into storage_deletions (bucket, path, staff_id)
    values ('documents', c.photo_path, c.staff_id)
    on conflict (bucket, path) do nothing;
  end if;
  update rtw_checks set photo_path = p_photo_path, updated_at = now() where id = c.id;
end $$;

comment on function public.rtw_check_attach_photo(uuid, text) is
  'Service role only (ADR-0041): the runner files the applicant photo gov.uk showed on a running check, under the worker''s own folder.';

revoke execute on function public.rtw_check_attach_photo(uuid, text) from public, anon, authenticated;
grant  execute on function public.rtw_check_attach_photo(uuid, text) to service_role;

-- The row's files go with the row (§1.7): the report as before, and now
-- the photo.
create or replace function public.rtw_checks_forget_report()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  insert into storage_deletions (bucket, path, staff_id)
  select 'documents', p, old.staff_id
    from unnest(array[old.report_path, old.photo_path]) p
   where p is not null
  on conflict (bucket, path) do nothing;
  return old;
end $$;

-- ---------------------------------------------------------------------
-- 4 · rtw_check_record(): restated from 20260928100000 with the
--     admin_confirms branch. Every validation, the report rule, the
--     not-pending exit, retry and backoff are unchanged.
-- ---------------------------------------------------------------------
create or replace function public.rtw_check_record(
  p_check       uuid,
  p_result      jsonb,
  p_decision    jsonb,
  p_report_path text default null,
  p_error       text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  c          rtw_checks;
  d          compliance_docs;
  s          staff;
  v_action   text := p_decision ->> 'action';
  -- Only a real JSON false turns the admin's review off; anything else
  -- (missing, a string, a typo) keeps it on (security review 26.09).
  v_confirm  boolean := not coalesce(rtw_check_config() -> 'admin_confirms' = 'false'::jsonb, false);
  v_result   jsonb;
  v_outcome  text;
  v_status   text;
  v_reason   text;
  v_worker   text;
  v_suggest  text;
  v_recommend text;
  v_until    date;
  v_no_limit boolean;
  v_error    text;
  v_verify   jsonb;
  v_today    date := (now() at time zone 'Europe/London')::date;
begin
  select * into c from rtw_checks where id = p_check for update;
  if c.id is null then
    raise exception 'rtw_check_not_found' using errcode = 'P0002';
  end if;
  if c.status <> 'running' then
    raise exception 'rtw_check_not_running: %', c.status using errcode = 'P0001';
  end if;

  select * into d from compliance_docs where id = c.compliance_doc_id for update;
  select * into s from staff where id = c.staff_id;

  v_result  := rtw_check_clean_result(p_result, d.share_code);
  v_outcome := v_result ->> 'outcome';
  v_error   := rtw_check_clean_error(coalesce(p_error, v_result ->> 'error'), d.share_code);

  if p_report_path is not null
     and p_report_path !~ ('^' || c.staff_id::text || '/share-code-report/[A-Za-z0-9][A-Za-z0-9._-]*\.pdf$') then
    raise exception 'rtw_report_path_invalid' using errcode = '22023';
  end if;

  if d.id is null or d.review_status <> 'pending'
     or s.status in ('rejected', 'removed') or s.removed_at is not null then
    update rtw_checks
       set status = 'failed', error = 'document_not_pending',
           source = v_result ->> 'source', outcome = v_outcome, result = v_result,
           report_path = coalesce(p_report_path, report_path),
           lease_until = null, finished_at = now()
     where id = c.id;
    return jsonb_build_object('status', 'failed', 'checkId', c.id::text);
  end if;

  if p_report_path is not null then
    update compliance_docs set gov_report_path = p_report_path where id = d.id;
  end if;

  if v_action = 'verify' then
    if v_outcome is distinct from 'right_to_work' then
      raise exception 'rtw_decision_inconsistent: verify needs right_to_work' using errcode = '22023';
    end if;
    v_no_limit := coalesce((p_decision ->> 'noTimeLimit')::boolean, false);
    if v_no_limit then
      if v_result ->> 'rightToWorkUntil' is not null then
        raise exception 'rtw_decision_inconsistent: no time limit with a date' using errcode = '22023';
      end if;
      v_until := 'infinity'::date;
    else
      v_until := nullif(p_decision ->> 'rightToWorkUntil', '')::date;
      if v_until is null or v_until is distinct from (v_result ->> 'rightToWorkUntil')::date then
        raise exception 'rtw_decision_inconsistent: date' using errcode = '22023';
      end if;
    end if;
    if p_report_path is null and c.report_path is null then
      v_action := 'retry';
      v_error := 'report_missing';
    elsif v_confirm then
      -- ADR-0041: the admin compares the photo and presses Verify.
      v_status := 'needs_review';
      v_recommend := 'verify';
      v_reason := case when v_no_limit
        then 'gov.uk confirms a right to work with no time limit. Compare the gov.uk photo with the worker''s selfie, then Verify.'
        else format('gov.uk confirms a right to work until %s. Compare the gov.uk photo with the worker''s selfie, then Verify.',
                    to_char(v_until, 'DD.MM.YYYY'))
      end;
    else
      begin
        v_verify := compliance_verify_document_as(null, d.id, null, null, v_until);
        v_status := 'passed';
        v_recommend := 'verify';
      exception when others then
        v_status := 'needs_review';
        v_recommend := 'review';
        v_reason := format('gov.uk passed the check but Verify refused it (%s). Check the report and verify by hand.',
                           split_part(sqlerrm, ':', 1));
      end;
    end if;
  end if;

  if v_action = 'reject' then
    if v_outcome not in ('not_found', 'no_right_to_work') then
      raise exception 'rtw_decision_inconsistent: reject needs not_found or no_right_to_work' using errcode = '22023';
    end if;
    v_worker := left(nullif(btrim(p_decision ->> 'workerReason'), ''), 300);
    if v_worker is null then
      raise exception 'reason_required' using errcode = 'P0001';
    end if;
    v_reason := left(nullif(btrim(p_decision ->> 'officeReason'), ''), 500);
    v_recommend := 'reject';
    if v_confirm then
      -- ADR-0041: nothing reaches the worker until the admin rejects. The
      -- N8 text waits, office-only, to pre-fill the Reject box.
      v_suggest := v_worker;
      v_worker := null;
      v_status := 'needs_review';
      -- The office's words are the database's here, never the runner's:
      -- the runner's reasons were written for ADR-0025's automatic reject
      -- ("the worker has been asked to re-enter it") and are false while
      -- the admin decides (QA 26.09). "Not found" has no report or photo:
      -- gov.uk shows nothing for a code it does not know.
      v_reason := case v_outcome
        when 'not_found' then 'gov.uk found no record for this share code and date of birth. Check both against what the worker entered, then Reject — the reason below goes to the worker.'
        else 'gov.uk shows NO right to work in the UK for this share code. Read the report and compare the photo, then Reject — the reason below goes to the worker. Do not roster them on this evidence.'
      end;
    else
      perform compliance_reject_document_as(null, d.id, v_worker);
      v_status := case when v_reason is null then 'rejected' else 'needs_review' end;
    end if;
  elsif v_action = 'retry' then
    if c.attempts < c.max_attempts then
      v_status := 'queued';
    else
      v_status := 'needs_review';
      v_recommend := 'review';
      v_reason := format('The automatic check could not be completed after %s attempts (%s). Run it again, or check the share code on gov.uk by hand.',
                         c.attempts, coalesce(v_error, 'error'));
    end if;
  elsif v_action = 'needs_review' then
    v_reason := left(nullif(btrim(p_decision ->> 'officeReason'), ''), 500);
    if v_reason is null then
      raise exception 'reason_required' using errcode = 'P0001';
    end if;
    v_status := 'needs_review';
    v_recommend := 'review';
  elsif v_action is distinct from 'verify' then
    raise exception 'rtw_decision_invalid: %', coalesce(v_action, 'null') using errcode = '22023';
  end if;

  -- Pre-filling the pending document is ADR-0025's path only. With the
  -- admin confirming, the date stays on the check (rtw_checks_latest_v,
  -- admin-only): compliance_docs is readable by its worker, and a
  -- right-to-work date appearing there would tell someone using a
  -- borrowed share code that gov.uk passed it before anyone has compared
  -- the photo (security review 26.09).
  if v_status = 'needs_review' and not v_confirm
     and (select review_status from compliance_docs where id = d.id) = 'pending' then
    update compliance_docs
       set needs_manual_review = true,
           right_to_work_until = case
             when v_result ->> 'rightToWorkUntil' is not null
                  and (v_result ->> 'rightToWorkUntil')::date > v_today
               then (v_result ->> 'rightToWorkUntil')::date
             else right_to_work_until end
     where id = d.id;
  end if;

  -- A retry starts again: an earlier attempt's photo must not sit beside
  -- a later attempt's result (security review 26.09). Owed to the purge.
  if v_status = 'queued' and c.photo_path is not null then
    insert into storage_deletions (bucket, path, staff_id)
    values ('documents', c.photo_path, c.staff_id)
    on conflict (bucket, path) do nothing;
  end if;

  update rtw_checks
     set status           = v_status,
         photo_path       = case when v_status = 'queued' then null else photo_path end,
         source           = v_result ->> 'source',
         outcome          = v_outcome,
         result           = v_result,
         report_path      = coalesce(p_report_path, report_path),
         error            = case when v_outcome = 'error' or v_action = 'retry' then v_error end,
         review_reason    = v_reason,
         worker_reason    = v_worker,
         suggested_reason = v_suggest,
         recommendation   = case when v_status = 'queued' then null else v_recommend end,
         lease_until      = null,
         next_attempt_at  = case when v_status = 'queued'
                                 then now() + rtw_check_backoff(c.attempts)
                                 else next_attempt_at end,
         finished_at      = case when v_status = 'queued' then null else now() end
   where id = c.id;

  if v_status <> 'queued' then
    insert into audit_log (at, actor, action, entity, entity_id, data)
    values (now(), null, 'rtw_check.' || v_status, 'compliance_docs', d.id,
            jsonb_strip_nulls(jsonb_build_object(
              'staffId',          s.id,
              'employeeId',       s.employee_id,
              'checkId',          c.id,
              'attempt',          c.attempts,
              'source',           v_result ->> 'source',
              'outcome',          v_outcome,
              'recommendation',   v_recommend,
              'rightToWorkUntil', v_result ->> 'rightToWorkUntil',
              'noTimeLimit',      case when v_status = 'passed' then v_no_limit end,
              'actorName',        'Automatic gov.uk check')));
  end if;

  return jsonb_strip_nulls(jsonb_build_object(
    'status',         v_status,
    'recommendation', case when v_status = 'queued' then null else v_recommend end,
    'checkId',        c.id::text,
    'staffStatus',    (select status::text from staff where id = s.id),
    'nextAttemptAt',  case when v_status = 'queued'
                           then (select next_attempt_at from rtw_checks where id = c.id) end));
end $$;

comment on function public.rtw_check_record(uuid, jsonb, jsonb, text, text) is
  'Service role only: record one run of the automated check. With settings.rtw_check.admin_confirms (the default, ADR-0041) every result is needs_review with a recommendation — verify, reject (the N8 text waits in suggested_reason) or review — and the admin decides through the one Verify / Reject path. With it off, ADR-0025''s automatic verify / reject. Retry and backoff unchanged. The result is stored through rtw_check_clean_result().';

-- ---------------------------------------------------------------------
-- 5 · The office's read carries the three new columns (appended, so the
--     views built on it keep their shape).
-- ---------------------------------------------------------------------
create or replace view rtw_checks_latest_v with (security_invoker = true) as
select distinct on (c.compliance_doc_id)
  c.id                                                       as check_id,
  c.compliance_doc_id                                        as document_id,
  c.staff_id,
  c.status,
  c.source,
  c.outcome,
  c.attempts,
  c.max_attempts,
  c.next_attempt_at,
  c.created_at,
  c.started_at,
  c.finished_at,
  (c.result ->> 'rightToWorkUntil')::date                    as right_to_work_until,
  coalesce(c.outcome = 'right_to_work' and c.result ->> 'rightToWorkUntil' is null, false)
                                                             as no_time_limit,
  coalesce(c.result -> 'conditions', '[]'::jsonb)            as conditions,
  (c.result ->> 'termTimeLimitHours')::int                   as term_time_limit_hours,
  c.result ->> 'fullName'                                    as record_name,
  c.result ->> 'referenceNumber'                             as reference_number,
  c.review_reason,
  c.worker_reason,
  c.error,
  c.report_path,
  c.requested_by,
  c.reviewed_at,
  rtw_check_stuck(c.status, c.next_attempt_at, c.lease_until, c.started_at) as stuck,
  c.recommendation,
  c.photo_path,
  c.suggested_reason
from rtw_checks c
order by c.compliance_doc_id, c.created_at desc, c.id desc;

comment on view rtw_checks_latest_v is
  'The latest automated right-to-work check per document, for the candidate profile, the staff profile and /compliance (ADR-0025, ADR-0041: recommendation, the gov.uk photo and the suggested N8 reason appended). security_invoker over admin-read rtw_checks: nobody else reads a row.';

-- ---------------------------------------------------------------------
-- 6 · The photo is evidence, not a discardable upload; and the worker
--     learns nothing before the admin decides (security review 26.09).
--
-- evidence_path_discardable(), restated from 20260928100000 §3c (its
-- latest definition) with two more lines: a check's photo is referenced,
-- and nothing named rtw-check-* under the worker's share-code-report
-- folder is ever the worker's to discard — only the runner writes those
-- names, and between its upload and its attach nothing references the
-- object yet. Without this a worker naming the photo's path in a refused
-- upload could have had the service key delete it before the admin
-- compared it.
-- ---------------------------------------------------------------------
create or replace function public.evidence_path_discardable(p_staff uuid, p_path text)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select p_staff is not null
     and p_path is not null
     and p_path like p_staff::text || '/%'
     and p_path !~ '(^|/)\.\.(/|$)'
     and p_path !~ ('^' || p_staff::text || '/share-code-report/rtw-check-')
     and not exists (select 1 from compliance_docs d
                      where d.file_path = p_path or d.gov_report_path = p_path)
     and not exists (select 1 from staff s where s.wtr_optout_copy_path = p_path)
     and not exists (select 1 from rtw_checks c where c.report_path = p_path or c.photo_path = p_path)
     and exists (select 1 from storage.objects o
                  where o.bucket_id = 'documents'
                    and o.name = p_path
                    and o.created_at > now() - interval '1 hour')
$$;

comment on function public.evidence_path_discardable(uuid, text) is
  'True only for a documents-bucket object under the worker''s own folder, uploaded within the hour, that no compliance_docs row, opt-out copy or automated right-to-work check (report or photo) references, and that is not one of the runner''s rtw-check-* files (ADR-0025, ADR-0041). The Staff App asks this before removing a refused upload with the service key.';

-- The photo is held with its report if THC ever extends the legal hold.
create or replace function public.retained_storage_paths(p_staff uuid)
returns setof text
language sql
stable
security definer
set search_path = public, extensions
as $$
  select d.file_path from compliance_docs d
   where d.staff_id = p_staff and d.retain_until is not null and d.file_path is not null
  union
  select d.gov_report_path from compliance_docs d
   where d.staff_id = p_staff and d.retain_until is not null and d.gov_report_path is not null
  union
  select c.report_path from rtw_checks c
    join compliance_docs d on d.id = c.compliance_doc_id
   where d.staff_id = p_staff and d.retain_until is not null and c.report_path is not null
  union
  select c.photo_path from rtw_checks c
    join compliance_docs d on d.id = c.compliance_doc_id
   where d.staff_id = p_staff and d.retain_until is not null and c.photo_path is not null
$$;

-- The worker's own view: while the result waits for the admin, the
-- outcome is withheld too — "with the office", nothing more.
create or replace function public.my_rtw_checks()
returns table (
  document_id   uuid,
  status        text,
  outcome       text,
  worker_reason text,
  created_at    timestamptz,
  checked_at    timestamptz
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  select distinct on (c.compliance_doc_id)
         c.compliance_doc_id, c.status,
         case when c.status = 'needs_review' then null else c.outcome end,
         c.worker_reason, c.created_at, c.finished_at
    from rtw_checks c
    join staff s on s.id = c.staff_id
   where s.user_id = auth.uid()
     and auth.uid() is not null
   order by c.compliance_doc_id, c.created_at desc, c.id desc
$$;

comment on function public.my_rtw_checks() is
  'The signed-in worker''s latest check per share-code document: status, outcome (withheld while the check waits for the office, ADR-0041), the N8 reason, when. Never the gov.uk name, conditions, report or photo, the office''s reason or the suggested reason (ADR-0025).';
