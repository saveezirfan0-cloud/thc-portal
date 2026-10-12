-- =====================================================================
-- Migration 20261012120800 · a SANDBOX right-to-work result is never
--                            acted on by itself (§2.6, ADR-0041, ADR-0063)
--
-- The sandbox provider (apps/office/app/api/jobs/rtw-check/_lib/
-- sandbox.ts, ADR-0063) answers demo share codes with made-up results;
-- every reference it makes starts `SANDBOX-` and its PDF says "SANDBOX -
-- NOT A HOME OFFICE RESULT". rtw_check_record() (latest 20260930150000)
-- leaves every result for an admin while settings.rtw_check.admin_confirms
-- is on — but with it switched off (a real JSON false), a `verify`
-- decision went straight to compliance_verify_document_as(): a sandbox
-- left switched on in production, or a demo code matched to a real
-- worker, would VERIFY that worker's right to work with no Home Office
-- check behind it. Back Office audit 12.10.2026, MEDIUM.
--
-- Now a result whose referenceNumber starts SANDBOX- (case-insensitive)
-- is treated as admin_confirms = true whatever the setting: verify and
-- reject both stop at needs_review with the recommendation, and the
-- office's reason opens with "SANDBOX result, not a Home Office check."
-- Everything else is 20260930150000's body unchanged (restated from the
-- live definition; grants kept by create or replace).
-- 794_rtw_sandbox_never_auto_verifies pins it.
-- =====================================================================

create or replace function public.rtw_check_record(p_check uuid, p_result jsonb, p_decision jsonb, p_report_path text DEFAULT NULL::text, p_error text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
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
  v_sandbox  boolean;
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

  -- 20261012120800 · ADR-0063: a SANDBOX result (every reference the
  -- sandbox provider makes starts SANDBOX-) is not a Home Office answer.
  -- Whatever settings.rtw_check.admin_confirms says, it is left for an
  -- admin: never verified, never rejected, by this function.
  v_sandbox := upper(coalesce(v_result ->> 'referenceNumber', '')) like 'SANDBOX-%';
  if v_sandbox then
    v_confirm := true;
  end if;

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

  if v_sandbox and v_status = 'needs_review' then
    v_reason := 'SANDBOX result, not a Home Office check. ' || coalesce(v_reason, '');
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
end $function$;
