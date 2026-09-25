-- =====================================================================
-- Migration 20260928090000 · the automated gov.uk share-code check
--                            (§2.3, §2.5, §2.6 · ADR-0025)
--
-- The worker types a share code and date of birth; the system runs the
-- Home Office check itself and hands the office a result to confirm
-- (ADR-0025, option C: automated check, one admin click). Nothing here
-- verifies or rejects a document. The admin still does that through the
-- one verify path (verify_document / reject_document, ADR-0018), which
-- keeps assert_reviewer()'s rule — a review with no reviewer is not a
-- review — and gives the worker N8 with a reason on a rejection.
--
-- What this migration adds:
--
--   1. rtw_checks — one row per share-code submission, keyed on the
--      compliance_docs row, so a submission can never be checked twice.
--   2. An AFTER INSERT trigger on compliance_docs that queues the check,
--      for BOTH ways a share code arrives: the wizard's step 4
--      (onboarding_submit_documents) and the Documents hub
--      (submit_document_upload). Neither function is restated.
--   3. The runner's three service-role functions: claim (skip locked),
--      record, fail (retry with backoff, then "check by hand").
--   4. rerun_rtw_check() — "Run check again", admin only.
--   5. my_rtw_check() — the worker's status and outcome, nothing else.
--   6. A registry row for the rtw-check job, DISABLED. The same switch
--      turns queueing on: while the row is disabled nothing is queued and
--      the office keeps the manual flow ADR-0002 describes.
--   7. GDPR: a check row goes when its document goes (remove_worker
--      deletes compliance_docs), and the files it names are queued on
--      storage_deletions on the way out.
--
-- The share code and date of birth are read by claim_rtw_check() for the
-- runner and are never written to this table: `result` refuses the keys
-- and the runner redacts both from anything it records as an error.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1 · The table
-- ---------------------------------------------------------------------
create table rtw_checks (
  id               uuid        primary key default gen_random_uuid(),
  staff_id         uuid        not null references staff(id) on delete cascade,
  document_id      uuid        not null references compliance_docs(id) on delete cascade,
  status           text        not null default 'queued',
  outcome          text,
  source           text        not null default 'govuk',
  attempts         int         not null default 0,
  next_attempt_at  timestamptz not null default now(),
  claimed_at       timestamptz,
  finished_at      timestamptz,
  requested_by     uuid        references profiles(id) on delete set null,
  holder_name      text,
  right_to_work_until date,
  no_time_limit    boolean     not null default false,
  conditions       text,
  report_path      text,
  photo_path       text,
  result           jsonb       not null default '{}'::jsonb,
  last_error       text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint rtw_checks_one_per_document unique (document_id),
  constraint rtw_checks_status_chk
    check (status in ('queued', 'running', 'done', 'failed', 'cancelled')),
  constraint rtw_checks_outcome_chk
    check (outcome is null
           or outcome in ('pass', 'name_mismatch', 'conditions_mismatch',
                          'not_found', 'no_right_to_work')),
  -- An outcome exists exactly when the check finished with one.
  constraint rtw_checks_outcome_when_done
    check ((status = 'done') = (outcome is not null)),
  constraint rtw_checks_source_chk check (source in ('govuk')),
  constraint rtw_checks_attempts_chk check (attempts between 0 and 10),
  -- The two inputs never land in the stored result, whatever the runner
  -- sends. A check constraint is the one guard no caller can skip.
  constraint rtw_checks_result_has_no_inputs
    check (jsonb_typeof(result) = 'object'
           and not (result ?| array['shareCode', 'share_code', 'dob', 'dateOfBirth',
                                    'date_of_birth'])),
  constraint rtw_checks_error_len check (last_error is null or length(last_error) <= 500)
);

create index rtw_checks_staff_idx on rtw_checks (staff_id);
create index rtw_checks_requested_by_idx on rtw_checks (requested_by);
create index rtw_checks_due_idx on rtw_checks (next_attempt_at) where status = 'queued';

comment on table rtw_checks is
  'The automated gov.uk share-code check (§2.6, ADR-0025): one row per share_code_report submission. Written only by definer functions; admin reads it, a worker reads their own status and outcome through my_rtw_check(), a client and anon nothing. Never holds the share code or date of birth.';

alter table rtw_checks enable row level security;
create policy admin_read on rtw_checks for select using (current_app_role() = 'admin');
-- No write policy for anyone: every write is a definer function below.
revoke all on rtw_checks from anon;

-- ---------------------------------------------------------------------
-- 2 · The switch, and the queue
-- ---------------------------------------------------------------------
insert into job_schedules (job, cron_expression, edge_path, enabled, note) values
  ('rtw-check', '* * * * *', 'rtw-check', false,
   'gov.uk share-code check (§2.6, ADR-0025). The Edge Function relays to the Back Office runner, which needs a Node runtime for Chromium. Disabled until ANTHROPIC_API_KEY, RTW_JOB_SECRET and RTW_COMPANY_NAME are set — see OWNER-TODO. Enabling this row also turns queueing on.')
on conflict (job) do nothing;

create or replace function public.rtw_check_enabled()
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select coalesce((select enabled from job_schedules where job = 'rtw-check'), false)
$$;

comment on function public.rtw_check_enabled() is
  'True when the rtw-check job is switched on. While it is off no share code is queued and the office checks by hand (ADR-0002''s flow).';

create or replace function public.rtw_check_enqueue()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if new.doc_type = 'share_code_report'
     and new.review_status = 'pending'
     and new.share_code is not null
     and rtw_check_enabled() then
    insert into rtw_checks (staff_id, document_id)
    values (new.staff_id, new.id)
    on conflict (document_id) do nothing;
  end if;
  return null;
end $$;

drop trigger if exists compliance_docs_rtw_check_enqueue on compliance_docs;
create trigger compliance_docs_rtw_check_enqueue
  after insert on compliance_docs
  for each row execute function public.rtw_check_enqueue();

-- A document the office has decided (or the worker has replaced) needs no
-- check. A running one is left to finish; record_rtw_check() leaves a
-- decided document alone.
create or replace function public.rtw_check_cancel_decided()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if new.review_status is distinct from old.review_status and new.review_status <> 'pending' then
    update rtw_checks
       set status = 'cancelled', updated_at = now()
     where document_id = new.id and status = 'queued';
  end if;
  return null;
end $$;

drop trigger if exists compliance_docs_rtw_check_cancel on compliance_docs;
create trigger compliance_docs_rtw_check_cancel
  after update of review_status on compliance_docs
  for each row execute function public.rtw_check_cancel_decided();

-- GDPR (§1.7): remove_worker() deletes the worker's compliance_docs, and
-- the cascade takes the check with it. The report is also on the document
-- (gov_report_path) and remove_worker() queues it there; the photo is
-- only here. on conflict: the same path queued twice is one deletion.
create or replace function public.rtw_check_queue_files()
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

drop trigger if exists rtw_checks_queue_files on rtw_checks;
create trigger rtw_checks_queue_files
  before delete on rtw_checks
  for each row execute function public.rtw_check_queue_files();

-- ---------------------------------------------------------------------
-- 3 · The runner (service role only)
-- ---------------------------------------------------------------------

-- One due check, claimed with SKIP LOCKED so two overlapping runs never
-- take the same row. A check left `running` for 15 minutes (a runner that
-- died mid-check) goes back to the queue; its attempt stays counted.
create or replace function public.claim_rtw_check(p_now timestamptz default now())
returns table (
  check_id     uuid,
  staff_id     uuid,
  document_id  uuid,
  share_code   text,
  dob          date,
  first_name   text,
  last_name    text,
  rtw_branch   text,
  attempt      int
)
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  v_id uuid;
begin
  update rtw_checks c
     set status = 'queued', updated_at = p_now
   where c.status = 'running' and c.claimed_at < p_now - interval '15 minutes';

  update rtw_checks c
     set status = 'cancelled', updated_at = p_now
    from compliance_docs d
   where d.id = c.document_id and c.status = 'queued' and d.review_status <> 'pending';

  select c.id into v_id
    from rtw_checks c
    join compliance_docs d on d.id = c.document_id
   where c.status = 'queued'
     and c.next_attempt_at <= p_now
     and d.review_status = 'pending'
   order by c.next_attempt_at, c.created_at
   for update of c skip locked
   limit 1;

  if v_id is null then
    return;
  end if;

  update rtw_checks c
     set status = 'running', attempts = c.attempts + 1, claimed_at = p_now,
         updated_at = p_now, last_error = null
   where c.id = v_id;

  return query
    select c.id, c.staff_id, c.document_id, d.share_code, s.dob, s.first_name, s.last_name,
           s.rtw_branch::text, c.attempts
      from rtw_checks c
      join compliance_docs d on d.id = c.document_id
      join staff s on s.id = c.staff_id
     where c.id = v_id;
end $$;

comment on function public.claim_rtw_check(timestamptz) is
  'Runner, service role only (ADR-0025): claims one due check with SKIP LOCKED and returns what the gov.uk form needs. The share code and date of birth leave the database here and nowhere else.';

-- The result, as the runner read it. The document stays pending: the
-- office confirms on it. The date is pre-filled through the AI seam every
-- other document uses (record_document_extraction), so both screens show
-- it the same way, and the report lands on gov_report_path, where the
-- existing "Open report" link and remove_worker() already look.
create or replace function public.record_rtw_check(
  p_check         uuid,
  p_outcome       text,
  p_result        jsonb   default '{}'::jsonb,
  p_holder_name   text    default null,
  p_until         date    default null,
  p_no_time_limit boolean default false,
  p_conditions    text    default null,
  p_report_path   text    default null,
  p_photo_path    text    default null,
  p_now           timestamptz default now()
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  c rtw_checks;
  d compliance_docs;
begin
  select * into c from rtw_checks where id = p_check for update;
  if c.id is null then
    raise exception 'unknown_check' using errcode = 'P0002';
  end if;
  if c.status <> 'running' then
    raise exception 'not_running' using errcode = 'P0001';
  end if;
  if p_outcome is null or p_outcome not in ('pass', 'name_mismatch', 'conditions_mismatch',
                                            'not_found', 'no_right_to_work') then
    raise exception 'bad_outcome' using errcode = 'P0001';
  end if;
  if p_outcome = 'pass' and p_until is null and not coalesce(p_no_time_limit, false) then
    raise exception 'pass_needs_a_date' using errcode = 'P0001';
  end if;
  if p_until is not null and not isfinite(p_until) then
    raise exception 'bad_date' using errcode = 'P0001';
  end if;

  update rtw_checks
     set status = 'done',
         outcome = p_outcome,
         result = coalesce(p_result, '{}'::jsonb),
         holder_name = nullif(btrim(p_holder_name), ''),
         right_to_work_until = p_until,
         no_time_limit = coalesce(p_no_time_limit, false),
         conditions = nullif(btrim(p_conditions), ''),
         report_path = p_report_path,
         photo_path = p_photo_path,
         finished_at = p_now,
         updated_at = p_now
   where id = c.id;

  select * into d from compliance_docs where id = c.document_id for update;
  if d.review_status = 'pending' then
    if p_report_path is not null then
      update compliance_docs set gov_report_path = p_report_path where id = d.id;
    end if;
    if p_until is not null then
      perform record_document_extraction(d.id, p_until, null, null, null, null,
                                         coalesce(p_result, '{}'::jsonb));
    end if;
  end if;

  insert into audit_log (at, actor, action, entity, entity_id, data)
  values (p_now, null, 'rtw.checked', 'compliance_docs', c.document_id,
          jsonb_strip_nulls(jsonb_build_object(
            'checkId',          c.id,
            'staffId',          c.staff_id,
            'source',           c.source,
            'outcome',          p_outcome,
            'rightToWorkUntil', p_until,
            'noTimeLimit',      nullif(coalesce(p_no_time_limit, false), false),
            'attempt',          c.attempts)));

  return jsonb_build_object('ok', true, 'checkId', c.id, 'outcome', p_outcome,
                            'documentPending', d.review_status = 'pending');
end $$;

comment on function public.record_rtw_check(uuid, text, jsonb, text, date, boolean, text, text, text, timestamptz) is
  'Runner, service role only (ADR-0025): stores the result, pre-fills the right-to-work-until on the pending document and sets gov_report_path. Never verifies or rejects: the admin does, through verify_document / reject_document.';

-- A failure. Retries with backoff (5, then 10 minutes); the third failure
-- is final and the document shows "check by hand" in the queue.
create or replace function public.fail_rtw_check(
  p_check     uuid,
  p_error     text,
  p_retryable boolean default true,
  p_now       timestamptz default now()
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  c rtw_checks;
  v_final boolean;
  v_error text := left(coalesce(nullif(btrim(p_error), ''), 'unknown error'), 500);
begin
  select * into c from rtw_checks where id = p_check for update;
  if c.id is null then
    raise exception 'unknown_check' using errcode = 'P0002';
  end if;
  if c.status <> 'running' then
    raise exception 'not_running' using errcode = 'P0001';
  end if;

  v_final := not coalesce(p_retryable, true) or c.attempts >= 3;

  if v_final then
    update rtw_checks
       set status = 'failed', last_error = v_error, finished_at = p_now, updated_at = p_now
     where id = c.id;
    insert into audit_log (at, actor, action, entity, entity_id, data)
    values (p_now, null, 'rtw.check_failed', 'compliance_docs', c.document_id,
            jsonb_build_object('checkId', c.id, 'staffId', c.staff_id, 'source', c.source,
                               'attempts', c.attempts));
  else
    update rtw_checks
       set status = 'queued', last_error = v_error, updated_at = p_now,
           next_attempt_at = p_now + interval '5 minutes' * power(2, greatest(c.attempts - 1, 0))
     where id = c.id;
  end if;

  return jsonb_build_object('ok', true, 'checkId', c.id,
                            'status', case when v_final then 'failed' else 'queued' end);
end $$;

comment on function public.fail_rtw_check(uuid, text, boolean, timestamptz) is
  'Runner, service role only (ADR-0025): a failed attempt. Retryable failures go back on the queue after 5 then 10 minutes; the third, or any non-retryable one, is final and leaves the document for a manual check. p_error must already be redacted of the share code and date of birth.';

-- ---------------------------------------------------------------------
-- 4 · "Run check again" — admin only
-- ---------------------------------------------------------------------
create or replace function public.rerun_rtw_check(p_document uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_reviewer uuid := assert_reviewer();
  d compliance_docs;
  c rtw_checks;
begin
  select * into d from compliance_docs where id = p_document for update;
  if d.id is null then
    raise exception 'document_not_found' using errcode = 'P0002';
  end if;
  if d.doc_type <> 'share_code_report' or d.share_code is null then
    raise exception 'not_a_share_code' using errcode = 'P0001';
  end if;
  if d.review_status <> 'pending' then
    raise exception 'not_pending' using errcode = 'P0001';
  end if;
  if not rtw_check_enabled() then
    return jsonb_build_object('ok', false, 'reason', 'not_enabled');
  end if;

  select * into c from rtw_checks where document_id = d.id for update;
  if c.id is not null and c.status in ('queued', 'running') then
    return jsonb_build_object('ok', true, 'checkId', c.id, 'alreadyQueued', true);
  end if;

  insert into rtw_checks (staff_id, document_id, requested_by)
  values (d.staff_id, d.id, v_reviewer)
  on conflict (document_id) do update
     set status = 'queued', outcome = null, attempts = 0, next_attempt_at = now(),
         claimed_at = null, finished_at = null, requested_by = v_reviewer,
         holder_name = null, right_to_work_until = null, no_time_limit = false,
         conditions = null, result = '{}'::jsonb, last_error = null, updated_at = now()
  returning * into c;

  insert into audit_log (at, actor, action, entity, entity_id, data)
  values (now(), v_reviewer, 'rtw.check_requested', 'compliance_docs', d.id,
          jsonb_build_object('checkId', c.id, 'staffId', d.staff_id,
                             'actorName', (select full_name from profiles where id = v_reviewer)));

  return jsonb_build_object('ok', true, 'checkId', c.id, 'alreadyQueued', false);
end $$;

comment on function public.rerun_rtw_check(uuid) is
  '"Run check again" on /onboarding/:id, the staff profile and /compliance (ADR-0025). Admin only (assert_reviewer), pending share code reports only; keeps the row and its file paths, so the new report overwrites the old one.';

-- ---------------------------------------------------------------------
-- 5 · The worker's view: status and outcome only
-- ---------------------------------------------------------------------
create or replace function public.my_rtw_check()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_me uuid := staff_caller();
  c rtw_checks;
begin
  if v_me is null then
    return null;
  end if;
  select * into c from rtw_checks
   where staff_id = v_me
   order by created_at desc
   limit 1;
  if c.id is null then
    return null;
  end if;
  return jsonb_build_object('status', c.status, 'outcome', c.outcome,
                            'checkedAt', c.finished_at);
end $$;

comment on function public.my_rtw_check() is
  'The Staff App''s "Checking with gov.uk…" line (ADR-0025): the caller''s latest check, status and outcome only. The name, dates, conditions and files stay office-side.';

-- ---------------------------------------------------------------------
-- 6 · Who may call what
-- ---------------------------------------------------------------------
revoke execute on function public.rtw_check_enabled()                from public, anon, authenticated;
revoke execute on function public.rtw_check_enqueue()                from public, anon, authenticated;
revoke execute on function public.rtw_check_cancel_decided()         from public, anon, authenticated;
revoke execute on function public.rtw_check_queue_files()            from public, anon, authenticated;
revoke execute on function public.claim_rtw_check(timestamptz)       from public, anon, authenticated;
revoke execute on function public.record_rtw_check(uuid, text, jsonb, text, date, boolean, text, text, text, timestamptz)
  from public, anon, authenticated;
revoke execute on function public.fail_rtw_check(uuid, text, boolean, timestamptz)
  from public, anon, authenticated;
revoke execute on function public.rerun_rtw_check(uuid)              from public, anon;
revoke execute on function public.my_rtw_check()                     from public, anon;

grant execute on function public.claim_rtw_check(timestamptz)        to service_role;
grant execute on function public.record_rtw_check(uuid, text, jsonb, text, date, boolean, text, text, text, timestamptz)
  to service_role;
grant execute on function public.fail_rtw_check(uuid, text, boolean, timestamptz) to service_role;
grant execute on function public.rtw_check_enabled()                 to service_role;
grant execute on function public.rerun_rtw_check(uuid)               to authenticated;
grant execute on function public.my_rtw_check()                      to authenticated;
