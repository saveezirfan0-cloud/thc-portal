-- =====================================================================
-- The automated gov.uk right-to-work check (§2.3, §2.5, §2.6, §4.4;
-- ADR-0025, which supersedes ADR-0002 and amends ADR-0018)
--
-- "Share code + DOB → gov.uk/view-right-to-work → right-to-work-until date
-- → PDF report stored on the profile; that date becomes the expiry used for
-- reminders. On failure or low confidence → flagged for manual review."
--
-- Until now the office typed that date on Verify (ADR-0018). THC's decision
-- (ADR-0025): build both a third-party right-to-work provider (primary) and
-- our own gov.uk browser check (fallback), and make it FULLY AUTOMATIC — a
-- passing result verifies the share-code document through the SAME Verify
-- the office uses, with no photo match and no human step. Only genuine
-- failures, after retries, reach Compliance → Needs review.
--
-- The check itself runs in Node (Playwright cannot run in an Edge
-- Function): apps/office/app/api/jobs/rtw-check. This migration is the
-- database half:
--
--   rtw_checks                one row per run. The share code and date of
--                             birth are NOT stored here: the share code
--                             stays where it has always lived
--                             (compliance_docs.share_code, staff.share_code)
--                             and is handed to the runner at claim time only.
--   rtw_check_transitions()   the state machine, held equal to
--                             RTW_CHECK_TRANSITIONS (packages/domain) by
--                             rtwCheck.sql.test.ts; a trigger refuses any
--                             other status change.
--   enqueue                   automatically when a share-code document is
--                             filed (wizard step 4, the Documents hub, the
--                             wizard's re-entry below) — a row trigger, so
--                             every path is covered — and by the office's
--                             "Run check again" (rtw_check_request).
--   rtw_check_claim()         service role: leases due checks (skip locked).
--   rtw_check_record()        service role: applies the decision — Verify
--                             through compliance_verify_document's body with
--                             a system actor, Reject through
--                             compliance_reject_document's body (N8), or the
--                             Needs review queue with the office's reason;
--                             retries back off 30 min / 2 h / 6 h / 16 h and
--                             the fifth failure goes to the office.
--   compliance_review_queue_v a share-code document whose check is still
--                             running is not the office's yet; a needs-review
--                             check carries its reason; a check that rejected
--                             the code AND wants the office (no right to
--                             work) is an item of its own.
--   compliance_verify_document()  while the automation is on, a share-code
--                             document is verified by hand ONLY once its
--                             check is in needs_review (ADR-0018's manual
--                             date stays for exactly those).
--
-- The whole thing is OFF until settings.rtw_check.enabled is true (THC
-- chooses a provider and sets the keys first — OWNER-TODO §8). Off, nothing
-- is enqueued, nothing is claimed, and the office verifies share codes by
-- hand exactly as before.
--
-- Forward-only. Nothing here edits an earlier migration.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1 · Settings.
--
-- enabled is not in the brief's list; it is the switch the ADR argues for:
-- without it every share code filed before the provider exists would be
-- enqueued, hidden from the office's queue, and never run.
-- ---------------------------------------------------------------------
insert into settings (key, value) values
  ('rtw_check', jsonb_build_object(
     'enabled',      false,
     'primary',      'provider',
     'fallback',     'govuk',
     'company_name', 'The Hospitality Company',
     'max_attempts', 5))
on conflict (key) do nothing;

create or replace function public.rtw_check_config()
returns jsonb
language sql
stable
security definer
set search_path = public, extensions
as $$
  select jsonb_build_object(
           'enabled',      false,
           'primary',      'provider',
           'fallback',     'govuk',
           'company_name', 'The Hospitality Company',
           'max_attempts', 5)
         || coalesce((select value from settings
                       where key = 'rtw_check' and jsonb_typeof(value) = 'object'), '{}'::jsonb)
$$;

comment on function public.rtw_check_config() is
  'settings.rtw_check over its defaults: enabled (false), primary (provider), fallback (govuk), company_name (the name gov.uk is told is checking), max_attempts (5). ADR-0025.';

create or replace function public.rtw_check_enabled()
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select coalesce((rtw_check_config() ->> 'enabled')::boolean, false)
$$;

comment on function public.rtw_check_enabled() is
  'Whether the automated right-to-work check is switched on (settings.rtw_check.enabled). Off: nothing is enqueued or claimed and share codes are verified by hand (ADR-0018). A boolean only — callable by the office''s views.';

-- ---------------------------------------------------------------------
-- 2 · The table.
-- ---------------------------------------------------------------------
create table if not exists rtw_checks (
  id                uuid primary key default gen_random_uuid(),
  staff_id          uuid not null references staff(id) on delete cascade,
  -- The document IS the evidence: a GDPR removal deletes it (§1.7), and its
  -- checks — the name gov.uk holds, the conditions — go with it.
  compliance_doc_id uuid not null references compliance_docs(id) on delete cascade,
  status            text not null default 'queued',
  attempts          int  not null default 0,
  max_attempts      int  not null default 5,
  next_attempt_at   timestamptz not null default now(),
  lease_until       timestamptz,
  source            text,
  outcome           text,
  -- The normalised result (packages/domain RtwCheckResult), rebuilt from a
  -- whitelist by rtw_check_clean_result(): never the share code, never the
  -- date of birth.
  result            jsonb,
  report_path       text,
  error             text,
  review_reason     text,
  worker_reason     text,
  requested_by      uuid references profiles(id),
  reviewed_at       timestamptz,
  reviewed_by       uuid references profiles(id),
  -- clock_timestamp(), not now(): "the latest check" is ordered on it, and
  -- two checks queued in one transaction share now().
  created_at        timestamptz not null default clock_timestamp(),
  started_at        timestamptz,
  finished_at       timestamptz,
  updated_at        timestamptz not null default now(),
  constraint rtw_checks_status check (status in ('queued', 'running', 'passed', 'rejected', 'needs_review', 'failed')),
  constraint rtw_checks_source check (source is null or source in ('provider', 'govuk')),
  constraint rtw_checks_outcome check (outcome is null or outcome in ('right_to_work', 'no_right_to_work', 'not_found', 'error')),
  constraint rtw_checks_attempts check (attempts >= 0 and max_attempts between 1 and 20),
  constraint rtw_checks_result_shape check (result is null or jsonb_typeof(result) = 'object'),
  constraint rtw_checks_no_share_code check (result is null or not (result ?| array['shareCode', 'share_code', 'dob', 'dateOfBirth', 'date_of_birth']))
);

-- One check in flight per document.
create unique index if not exists rtw_checks_one_open_per_doc
  on rtw_checks (compliance_doc_id) where status in ('queued', 'running');
-- Latest per document (and the FK cover 002 asks for).
create index if not exists rtw_checks_doc_idx on rtw_checks (compliance_doc_id, created_at desc);
create index if not exists rtw_checks_staff_idx on rtw_checks (staff_id);
create index if not exists rtw_checks_due_idx on rtw_checks (next_attempt_at) where status = 'queued';
create index if not exists rtw_checks_requested_by_idx on rtw_checks (requested_by);
create index if not exists rtw_checks_reviewed_by_idx on rtw_checks (reviewed_by);

comment on table rtw_checks is
  '§2.6 automated right-to-work check, one row per run (ADR-0025). Admin-read; written only by the definer functions below and the service role. The share code and date of birth are never stored here.';
comment on column rtw_checks.result is
  'The normalised result: outcome, source, fullName, rightToWorkUntil (null on a pass = no time limit), conditions, termTimeLimitHours, referenceNumber, checkedAt, error. Built by rtw_check_clean_result(), which refuses a share code anywhere in it.';
comment on column rtw_checks.review_reason is
  'Office-facing: why this check is in Compliance → Needs review.';
comment on column rtw_checks.worker_reason is
  'Worker-facing: the N8 reason when the check asked the worker to re-enter the share code.';
comment on column rtw_checks.report_path is
  'The gov.uk / provider PDF in the private documents bucket, <staff_id>/share-code-report/…; also written to compliance_docs.gov_report_path, which the §1.7 purge already reaches.';

alter table rtw_checks enable row level security;
drop policy if exists admin_read on rtw_checks;
-- Admin-read, like job_runs and storage_deletions. Workers read their own
-- status through my_rtw_checks(); clients never.
create policy admin_read on rtw_checks for select using (current_app_role() = 'admin');

revoke all on rtw_checks from public, anon, authenticated;
grant select on rtw_checks to authenticated;
grant all on rtw_checks to service_role;

-- ---------------------------------------------------------------------
-- 3 · The state machine.
--
-- The edge list is RTW_CHECK_TRANSITIONS in packages/domain/src/state.ts;
-- rtwCheck.sql.test.ts parses the VALUES below and compares them.
-- ---------------------------------------------------------------------
create or replace function public.rtw_check_transitions()
returns table (from_status text, to_status text)
language sql
immutable
set search_path = public, extensions
as $$
  select * from (values
    ('queued', 'running'),
    ('queued', 'failed'),
    ('running', 'queued'),
    ('running', 'passed'),
    ('running', 'rejected'),
    ('running', 'needs_review'),
    ('running', 'failed')
  ) as t(from_status, to_status)
$$;

comment on function public.rtw_check_transitions() is
  'The rtw_checks state machine (ADR-0025): queued → running | failed; running → queued (retry) | passed | rejected | needs_review | failed. The four outcomes are terminal; "Run check again" is a new row. Equal to RTW_CHECK_TRANSITIONS in packages/domain.';

create or replace function public.rtw_checks_state_guard()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
begin
  new.updated_at := now();
  if new.status is distinct from old.status
     and not exists (select 1 from rtw_check_transitions() t
                      where t.from_status = old.status and t.to_status = new.status) then
    raise exception 'illegal_rtw_check_transition: % -> %', old.status, new.status
      using errcode = 'P0001';
  end if;
  return new;
end $$;

drop trigger if exists rtw_checks_state_guard on rtw_checks;
create trigger rtw_checks_state_guard
  before update on rtw_checks
  for each row execute function rtw_checks_state_guard();

-- A check starts queued; nothing inserts a finished one.
create or replace function public.rtw_checks_insert_guard()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
begin
  if new.status <> 'queued' then
    raise exception 'illegal_rtw_check_transition: (new) -> %', new.status using errcode = 'P0001';
  end if;
  return new;
end $$;

drop trigger if exists rtw_checks_insert_guard on rtw_checks;
create trigger rtw_checks_insert_guard
  before insert on rtw_checks
  for each row execute function rtw_checks_insert_guard();

-- §1.7: a removed worker's report goes with their document. The document
-- delete cascades here; this owes the Storage object to the purge queue,
-- including a report an earlier run left that is no longer the document's.
create or replace function public.rtw_checks_forget_report()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if old.report_path is not null then
    insert into storage_deletions (bucket, path, staff_id)
    values ('documents', old.report_path, old.staff_id)
    on conflict (bucket, path) do nothing;
  end if;
  return old;
end $$;

drop trigger if exists rtw_checks_forget_report on rtw_checks;
create trigger rtw_checks_forget_report
  after delete on rtw_checks
  for each row execute function rtw_checks_forget_report();

-- ---------------------------------------------------------------------
-- 4 · Backoff. RTW_CHECK_BACKOFF_MINUTES in packages/domain, the same
--     literal: 30 min, 2 h, 6 h, 16 h — five attempts over about a day.
-- ---------------------------------------------------------------------
create or replace function public.rtw_check_backoff(p_attempt int)
returns interval
language sql
immutable
set search_path = public, extensions
as $$
  select make_interval(mins => (array[30, 120, 360, 960])[least(greatest(coalesce(p_attempt, 1), 1), 4)])
$$;

comment on function public.rtw_check_backoff(int) is
  'Wait after failed attempt N before the next: 30 min, 2 h, 6 h, 16 h (RTW_CHECK_BACKOFF_MINUTES). ADR-0025.';

-- ---------------------------------------------------------------------
-- 5 · What may be stored of a result, and of an error.
-- ---------------------------------------------------------------------
create or replace function public.rtw_check_clean_error(p_error text, p_share_code text)
returns text
language sql
immutable
set search_path = public, extensions
as $$
  select nullif(left(regexp_replace(
           replace(lower(coalesce(p_error, '')),
                   lower(coalesce(nullif(regexp_replace(coalesce(p_share_code, ''), '\s', '', 'g'), ''), '#none#')),
                   'share_code'),
           '[^a-z0-9_:.-]+', '_', 'g'), 120), '')
$$;

create or replace function public.rtw_check_clean_result(p_result jsonb, p_share_code text)
returns jsonb
language plpgsql
immutable
set search_path = public, extensions
as $$
declare
  v_outcome    text;
  v_source     text;
  v_until      text;
  v_hours      int;
  v_conditions jsonb := '[]'::jsonb;
  v_checked    timestamptz;
  v_out        jsonb;
  v_code       text := upper(regexp_replace(coalesce(p_share_code, ''), '[^A-Za-z0-9]', '', 'g'));
begin
  if p_result is null or jsonb_typeof(p_result) <> 'object' then
    raise exception 'rtw_result_invalid: not an object' using errcode = '22023';
  end if;
  v_outcome := p_result ->> 'outcome';
  v_source  := p_result ->> 'source';
  if v_outcome is null or v_outcome not in ('right_to_work', 'no_right_to_work', 'not_found', 'error') then
    raise exception 'rtw_result_invalid: outcome' using errcode = '22023';
  end if;
  if v_source is null or v_source not in ('provider', 'govuk') then
    raise exception 'rtw_result_invalid: source' using errcode = '22023';
  end if;

  v_until := nullif(p_result ->> 'rightToWorkUntil', '');
  if v_until is not null then
    if v_until !~ '^\d{4}-\d{2}-\d{2}$' then
      raise exception 'rtw_result_invalid: rightToWorkUntil' using errcode = '22023';
    end if;
    perform v_until::date;
  end if;

  if jsonb_typeof(p_result -> 'termTimeLimitHours') = 'number' then
    v_hours := (p_result ->> 'termTimeLimitHours')::numeric::int;
    if v_hours not between 0 and 48 then
      raise exception 'rtw_result_invalid: termTimeLimitHours' using errcode = '22023';
    end if;
  end if;

  if jsonb_typeof(p_result -> 'conditions') = 'array' then
    select coalesce(jsonb_agg(left(btrim(x.line), 500) order by x.n), '[]'::jsonb)
      into v_conditions
      from (select e.line, e.n
              from jsonb_array_elements_text(p_result -> 'conditions') with ordinality as e(line, n)
             where btrim(e.line) <> ''
             order by e.n
             limit 30) x;
  end if;

  begin
    v_checked := (p_result ->> 'checkedAt')::timestamptz;
  exception when others then
    v_checked := null;
  end;

  v_out := jsonb_build_object(
    'outcome',            v_outcome,
    'source',             v_source,
    'fullName',           left(nullif(btrim(p_result ->> 'fullName'), ''), 200),
    'rightToWorkUntil',   v_until,
    'conditions',         v_conditions,
    'termTimeLimitHours', v_hours,
    'referenceNumber',    left(nullif(btrim(p_result ->> 'referenceNumber'), ''), 100),
    'checkedAt',          coalesce(v_checked, now()),
    'error',              case when v_outcome = 'error'
                               then coalesce(rtw_check_clean_error(p_result ->> 'error', p_share_code),
                                             'unknown_error') end);

  -- Belt and braces: whatever an adapter got wrong, the share code does
  -- not reach this table.
  if length(v_code) >= 9
     and upper(regexp_replace(v_out::text, '[^A-Za-z0-9]', '', 'g')) like '%' || v_code || '%' then
    raise exception 'rtw_result_carries_share_code' using errcode = '22023';
  end if;
  return v_out;
end $$;

comment on function public.rtw_check_clean_result(jsonb, text) is
  'The only shape rtw_checks.result may take: whitelisted keys, validated types, and refused outright if the share code appears anywhere in it (ADR-0025).';

-- ---------------------------------------------------------------------
-- 6 · One Verify, one Reject — with the reviewer as an argument.
--
-- The bodies of compliance_verify_document() (20260923200000) and
-- compliance_reject_document() (20260923100000), unchanged but for where
-- the reviewer comes from, move into two internal functions. The public
-- functions are now wrappers that pass assert_reviewer(); the automated
-- check passes NULL, the system actor. So a gov.uk pass is verified by
-- exactly the code a manager's click runs — the rtw date guard, the
-- worker's right_to_work_until recompute, the §4.3 re-check, the quiz
-- unlock and the audit row — and an automated rejection queues exactly
-- the office's N8.
-- ---------------------------------------------------------------------
create or replace function public.compliance_verify_document_as(
  p_reviewer            uuid,
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
  v_reviewer uuid := p_reviewer;
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
    raise exception 'use_approve_completion_letter' using errcode = 'P0001';
  end if;
  if d.review_status <> 'pending' then
    raise exception 'not_pending: %', d.review_status using errcode = 'P0001';
  end if;

  select * into s from staff where id = d.staff_id for update;
  if s.status in ('rejected', 'removed') or s.removed_at is not null then
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
              'actorName',        coalesce((select full_name from profiles where id = v_reviewer),
                                           case when v_reviewer is null
                                                then 'Automatic gov.uk check' end))));
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

comment on function public.compliance_verify_document_as(uuid, uuid, date, daterange[], date) is
  'The body of §4.1 Verify with the reviewer passed in (NULL = the automated gov.uk check, ADR-0025). Internal: compliance_verify_document() passes assert_reviewer(), rtw_check_record() passes NULL. Otherwise exactly 20260923200000''s compliance_verify_document().';

-- Is a hand-typed date allowed for this share-code document right now?
-- Off: always (ADR-0018). On: only once its latest check is in
-- needs_review — the brief's "only genuine failures reach a human".
create or replace function public.rtw_check_manual_allowed(p_doc uuid)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select not rtw_check_enabled()
      or coalesce((select c.status = 'needs_review'
                     from rtw_checks c
                    where c.compliance_doc_id = p_doc
                    order by c.created_at desc, c.id desc
                    limit 1), false)
$$;

comment on function public.rtw_check_manual_allowed(uuid) is
  'Whether the office may verify this share-code report by hand: always while the automated check is off; while it is on, only when the latest check is in needs_review (ADR-0025, amending ADR-0018).';

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
begin
  if exists (select 1 from compliance_docs d
              where d.id = p_doc and d.doc_type = 'share_code_report'
                and d.review_status = 'pending')
     and not rtw_check_manual_allowed(p_doc) then
    raise exception 'rtw_check_required' using errcode = 'P0001',
      hint = 'The automated right-to-work check verifies this share code. Run it again from the profile; a hand-typed date is for a check in Needs review (ADR-0025).';
  end if;
  return compliance_verify_document_as(v_reviewer, p_doc, p_expiry, p_term_dates, p_right_to_work_until);
end $$;

comment on function public.compliance_verify_document(uuid, date, daterange[], date) is
  '§4.1 Verify, the only one (verify_document() wraps it): assert_reviewer() + compliance_verify_document_as(). A visa document, status document or share code report needs its right-to-work date; ''infinity'' confirms settled status (EU branch share code only). While the automated check is on, a share code report is verified by hand only once its check is in needs_review (rtw_check_required, ADR-0025). Not for the completion letter.';

create or replace function public.compliance_reject_document_as(
  p_reviewer uuid,
  p_doc      uuid,
  p_reason   text
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_reviewer uuid := p_reviewer;
  d          compliance_docs;
  s          staff;
  v_reason   text := nullif(trim(coalesce(p_reason, '')), '');
begin
  if v_reason is null then
    raise exception 'reason_required' using errcode = 'P0001';
  end if;

  select * into d from compliance_docs where id = p_doc for update;
  if d.id is null then
    raise exception 'document_not_found' using errcode = 'P0002';
  end if;
  if d.review_status <> 'pending' then
    raise exception 'not_pending: %', d.review_status using errcode = 'P0001';
  end if;

  select * into s from staff where id = d.staff_id;
  if s.status in ('rejected', 'removed') or s.removed_at is not null then
    raise exception 'not_reviewable: %', s.status using errcode = 'P0001';
  end if;

  update compliance_docs
     set review_status = 'rejected',
         rejection_reason = v_reason,
         reviewed_by = v_reviewer,
         reviewed_at = now()
   where id = d.id;

  insert into notification_outbox (key, channel, template, recipient_staff_id, payload)
  values ('N8:doc:' || d.id, 'push', 'N8', d.staff_id,
          jsonb_build_object('reason', v_reason,
                             'document', doc_label(d.doc_type),
                             'documentId', d.id::text))
  on conflict (key) do nothing;

  return jsonb_build_object('rejected', true, 'documentId', d.id::text);
end $$;

comment on function public.compliance_reject_document_as(uuid, uuid, text) is
  'The body of §4.1 Reject with the reviewer passed in (NULL = the automated gov.uk check). Mandatory reason, the document → rejected, N8 keyed per document. Internal (ADR-0025).';

create or replace function public.compliance_reject_document(
  p_doc    uuid,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  return compliance_reject_document_as(assert_reviewer(), p_doc, p_reason);
end $$;

comment on function public.compliance_reject_document(uuid, text) is
  '§4.1 Reject: mandatory reason, the document → rejected, push N8 "Document rejected — <reason>. Re-upload." keyed per document. assert_reviewer() + compliance_reject_document_as() (ADR-0025).';

-- ---------------------------------------------------------------------
-- 7 · Enqueue.
-- ---------------------------------------------------------------------

-- Wake the runner now rather than at the next 10-minute tick, so the
-- worker sees the outcome while they are still looking. A no-op without
-- settings.office_base_url and the vault secret rtw_job_secret, and it can
-- never fail the insert that called it.
create or replace function public.rtw_check_nudge()
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_base   text;
  v_secret text;
begin
  select value #>> '{}' into v_base from public.settings where key = 'office_base_url';
  if coalesce(v_base, '') = '' then
    return;
  end if;
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'rtw_job_secret';
  if coalesce(v_secret, '') = '' then
    return;
  end if;
  perform net.http_post(
    url     := rtrim(v_base, '/') || '/api/jobs/rtw-check',
    body    := jsonb_build_object('job', 'rtw-check'),
    params  := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json',
                                  'Authorization', 'Bearer ' || v_secret));
exception when others then
  raise warning 'rtw_check_nudge: %', sqlerrm;
end $$;

create or replace function public.rtw_check_enqueue(p_doc uuid, p_requested_by uuid default null)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  d    compliance_docs;
  s    staff;
  v_id uuid;
begin
  select * into d from compliance_docs where id = p_doc;
  if d.id is null or d.doc_type <> 'share_code_report' or d.review_status <> 'pending'
     or d.share_code is null then
    return null;
  end if;
  select * into s from staff where id = d.staff_id;
  if s.status in ('rejected', 'removed') or s.removed_at is not null then
    return null;
  end if;

  select c.id into v_id from rtw_checks c
   where c.compliance_doc_id = d.id and c.status in ('queued', 'running');
  if v_id is not null then
    return v_id;
  end if;

  insert into rtw_checks (staff_id, compliance_doc_id, max_attempts, requested_by)
  values (d.staff_id, d.id,
          least(greatest(coalesce((rtw_check_config() ->> 'max_attempts')::int, 5), 1), 20),
          p_requested_by)
  returning id into v_id;

  perform rtw_check_nudge();
  return v_id;
end $$;

comment on function public.rtw_check_enqueue(uuid, uuid) is
  'Queue the automated check for a pending share-code report of a live profile, once (one open check per document). Internal: the insert trigger and rtw_check_request() call it (ADR-0025).';

create or replace function public.compliance_docs_rtw_check_enqueue()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if rtw_check_enabled() then
    perform rtw_check_enqueue(new.id, null);
  end if;
  return null;
end $$;

drop trigger if exists compliance_docs_rtw_check_enqueue on compliance_docs;
-- Every path that files a share code — onboarding_submit_documents (wizard
-- step 4), submit_document_upload (the Documents hub),
-- onboarding_reenter_share_code (below) — inserts this row. A trigger
-- rather than three calls, so a fourth path cannot forget it.
create trigger compliance_docs_rtw_check_enqueue
  after insert on compliance_docs
  for each row
  when (new.doc_type = 'share_code_report' and new.review_status = 'pending'
        and new.share_code is not null)
  execute function compliance_docs_rtw_check_enqueue();

-- ---------------------------------------------------------------------
-- 8 · The runner's two doors (service role only).
-- ---------------------------------------------------------------------

-- Lease due checks. Returns the share code and date of birth to the
-- service role for this one run; nothing of either is written anywhere.
create or replace function public.rtw_check_claim(
  p_limit         int default 3,
  p_lease_seconds int default 600
) returns table (
  check_id           uuid,
  staff_id           uuid,
  document_id        uuid,
  attempt            int,
  max_attempts       int,
  share_code         text,
  date_of_birth      date,
  first_name         text,
  last_name          text,
  rtw_branch         text,
  below_degree_level boolean
)
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  r        rtw_checks;
  d        compliance_docs;
  s        staff;
  v_limit  int := least(greatest(coalesce(p_limit, 3), 1), 20);
  v_lease  int := least(greatest(coalesce(p_lease_seconds, 600), 60), 3600);
  v_taken  int := 0;
begin
  if not rtw_check_enabled() then
    return;
  end if;

  for r in
    select c.* from rtw_checks c
     where (c.status = 'queued' and c.next_attempt_at <= now())
        or (c.status = 'running' and c.lease_until < now())
     order by c.next_attempt_at, c.created_at, c.id
     limit v_limit * 3
     for update skip locked
  loop
    exit when v_taken >= v_limit;

    select * into d from compliance_docs where id = r.compliance_doc_id;
    select * into s from staff where id = r.staff_id;
    if d.id is null or d.review_status <> 'pending' or d.share_code is null
       or s.status in ('rejected', 'removed') or s.removed_at is not null then
      update rtw_checks
         set status = 'failed', error = 'document_not_pending',
             lease_until = null, finished_at = now()
       where id = r.id;
      continue;
    end if;

    -- A runner that died mid-check still spent an attempt. Once they are
    -- all spent the office decides, as for any other failure.
    if r.status = 'running' and r.attempts >= r.max_attempts then
      update rtw_checks
         set status = 'needs_review',
             review_reason = format('The automatic check could not be completed after %s attempts (runner_stopped). Run it again, or check the share code on gov.uk by hand.', r.attempts),
             lease_until = null,
             finished_at = now()
       where id = r.id;
      update compliance_docs set needs_manual_review = true where id = d.id;
      continue;
    end if;

    update rtw_checks
       set status = 'running',
           attempts = r.attempts + 1,
           started_at = now(),
           lease_until = now() + make_interval(secs => v_lease)
     where id = r.id;
    v_taken := v_taken + 1;

    check_id := r.id;
    staff_id := r.staff_id;
    document_id := r.compliance_doc_id;
    attempt := r.attempts + 1;
    max_attempts := r.max_attempts;
    share_code := d.share_code;
    date_of_birth := s.dob;
    first_name := s.first_name;
    last_name := s.last_name;
    rtw_branch := s.rtw_branch::text;
    below_degree_level := coalesce(s.below_degree_level, false);
    return next;
  end loop;
end $$;

comment on function public.rtw_check_claim(int, int) is
  'Service role only: lease up to p_limit due checks (queued and due, or running with a lapsed lease), skip locked; a check whose document has left review is failed instead. Returns the share code and DOB for this run only (ADR-0025). Nothing when the check is switched off.';

-- Apply what the runner decided (packages/domain decideRtwCheck), re-checked
-- here: a verify must carry a right_to_work result with the same date, a
-- reject a not_found / no_right_to_work result and the worker's reason; the
-- attempt limit and the backoff are this function's, not the caller's.
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
  v_result   jsonb;
  v_outcome  text;
  v_status   text;
  v_reason   text;
  v_worker   text;
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

  -- The document left review while the check ran: a manager decided it,
  -- the worker filed another, the profile was rejected or removed.
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

  -- §2.6 "PDF report stored on the profile" — whatever the outcome.
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
      -- §2.6 stores the report; a pass without one is not complete yet.
      v_action := 'retry';
      v_error := 'report_missing';
    else
      begin
        v_verify := compliance_verify_document_as(null, d.id, null, null, v_until);
        v_status := 'passed';
      exception when others then
        -- already_expired, no_time_limit_not_allowed, rtw_date_required …:
        -- the one Verify refused it, so a human looks.
        v_status := 'needs_review';
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
    perform compliance_reject_document_as(null, d.id, v_worker);
    v_reason := left(nullif(btrim(p_decision ->> 'officeReason'), ''), 500);
    v_status := case when v_reason is null then 'rejected' else 'needs_review' end;
  elsif v_action = 'retry' then
    if c.attempts < c.max_attempts then
      v_status := 'queued';
    else
      v_status := 'needs_review';
      v_reason := format('The automatic check could not be completed after %s attempts (%s). Run it again, or check the share code on gov.uk by hand.',
                         c.attempts, coalesce(v_error, 'error'));
    end if;
  elsif v_action = 'needs_review' then
    v_reason := left(nullif(btrim(p_decision ->> 'officeReason'), ''), 500);
    if v_reason is null then
      raise exception 'reason_required' using errcode = 'P0001';
    end if;
    v_status := 'needs_review';
  elsif v_action is distinct from 'verify' then
    raise exception 'rtw_decision_invalid: %', coalesce(v_action, 'null') using errcode = '22023';
  end if;

  -- Needs review with the document still pending: what gov.uk said is put
  -- in front of the reviewer (ADR-0018's manual date, pre-filled — as the
  -- extractor seam does), and the row is flagged.
  if v_status = 'needs_review'
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

  update rtw_checks
     set status          = v_status,
         source          = v_result ->> 'source',
         outcome         = v_outcome,
         result          = v_result,
         report_path     = coalesce(p_report_path, report_path),
         error           = case when v_outcome = 'error' or v_action = 'retry' then v_error end,
         review_reason   = v_reason,
         worker_reason   = v_worker,
         lease_until     = null,
         next_attempt_at = case when v_status = 'queued'
                                then now() + rtw_check_backoff(c.attempts)
                                else next_attempt_at end,
         finished_at     = case when v_status = 'queued' then null else now() end
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
              'rightToWorkUntil', v_result ->> 'rightToWorkUntil',
              'noTimeLimit',      case when v_status = 'passed' then v_no_limit end,
              'actorName',        'Automatic gov.uk check')));
  end if;

  return jsonb_strip_nulls(jsonb_build_object(
    'status',       v_status,
    'checkId',      c.id::text,
    'staffStatus',  (select status::text from staff where id = s.id),
    'nextAttemptAt', case when v_status = 'queued'
                          then (select next_attempt_at from rtw_checks where id = c.id) end));
end $$;

comment on function public.rtw_check_record(uuid, jsonb, jsonb, text, text) is
  'Service role only: record one run of the automated check and apply the decision — verify (compliance_verify_document_as, system actor), reject (compliance_reject_document_as → N8; with an office reason it is also needs_review), retry (backoff; the last attempt → needs_review) or needs_review. The result is stored through rtw_check_clean_result(). ADR-0025.';

-- ---------------------------------------------------------------------
-- 9 · The office's two buttons.
-- ---------------------------------------------------------------------
create or replace function public.rtw_check_request(p_doc uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_reviewer uuid := assert_reviewer();
  d          compliance_docs;
  s          staff;
  v_id       uuid;
begin
  if not rtw_check_enabled() then
    raise exception 'rtw_check_disabled' using errcode = 'P0001';
  end if;
  select * into d from compliance_docs where id = p_doc for update;
  if d.id is null or d.doc_type <> 'share_code_report' then
    raise exception 'document_not_found' using errcode = 'P0002';
  end if;
  if d.review_status <> 'pending' then
    raise exception 'not_pending: %', d.review_status using errcode = 'P0001';
  end if;
  if d.share_code is null then
    raise exception 'no_share_code' using errcode = 'P0001';
  end if;
  select * into s from staff where id = d.staff_id;
  if s.status in ('rejected', 'removed') or s.removed_at is not null then
    raise exception 'not_reviewable: %', s.status using errcode = 'P0001';
  end if;
  if exists (select 1 from rtw_checks c
              where c.compliance_doc_id = d.id and c.status in ('queued', 'running')) then
    raise exception 'rtw_check_running' using errcode = 'P0001';
  end if;

  v_id := rtw_check_enqueue(d.id, v_reviewer);

  insert into audit_log (at, actor, action, entity, entity_id, data)
  values (now(), v_reviewer, 'rtw_check.requested', 'compliance_docs', d.id,
          jsonb_build_object('staffId', s.id, 'checkId', v_id,
                             'actorName', (select full_name from profiles where id = v_reviewer)));

  return jsonb_build_object('queued', true, 'checkId', v_id::text);
end $$;

comment on function public.rtw_check_request(uuid) is
  'The office''s "Run check again" on a pending share-code report (admin only, audited). A new rtw_checks row; refused while one is in flight or while the check is switched off (ADR-0025).';

create or replace function public.rtw_check_mark_reviewed(p_check uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_reviewer uuid := assert_reviewer();
  c          rtw_checks;
begin
  select * into c from rtw_checks where id = p_check for update;
  if c.id is null then
    raise exception 'rtw_check_not_found' using errcode = 'P0002';
  end if;
  if c.status <> 'needs_review' then
    raise exception 'not_needs_review: %', c.status using errcode = 'P0001';
  end if;
  if c.reviewed_at is null then
    update rtw_checks set reviewed_at = now(), reviewed_by = v_reviewer where id = c.id;
    insert into audit_log (at, actor, action, entity, entity_id, data)
    values (now(), v_reviewer, 'rtw_check.reviewed', 'compliance_docs', c.compliance_doc_id,
            jsonb_build_object('staffId', c.staff_id, 'checkId', c.id,
                               'actorName', (select full_name from profiles where id = v_reviewer)));
  end if;
  return jsonb_build_object('reviewed', true, 'checkId', c.id::text);
end $$;

comment on function public.rtw_check_mark_reviewed(uuid) is
  'Clears a needs-review check whose document is no longer pending (gov.uk said no right to work, the worker was asked to re-enter) from the Needs review queue once the office has acted. Admin only, audited (ADR-0025).';

-- ---------------------------------------------------------------------
-- 10 · The worker's view: their own checks, status and outcome only.
-- ---------------------------------------------------------------------
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
         c.compliance_doc_id, c.status, c.outcome, c.worker_reason, c.created_at, c.finished_at
    from rtw_checks c
    join staff s on s.id = c.staff_id
   where s.user_id = auth.uid()
     and auth.uid() is not null
   order by c.compliance_doc_id, c.created_at desc, c.id desc
$$;

comment on function public.my_rtw_checks() is
  'The signed-in worker''s latest check per share-code document: status, outcome, the N8 reason, when. Never the gov.uk name, conditions, report path or the office''s reason (ADR-0025).';

-- ---------------------------------------------------------------------
-- 11 · The office's read: the latest check per document.
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
  c.reviewed_at
from rtw_checks c
order by c.compliance_doc_id, c.created_at desc, c.id desc;

comment on view rtw_checks_latest_v is
  'The latest automated right-to-work check per document, for the candidate profile, the staff profile and /compliance (ADR-0025). security_invoker over admin-read rtw_checks: nobody else reads a row.';

revoke all on rtw_checks_latest_v from public, anon;
grant select on rtw_checks_latest_v to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 12 · Needs review (§4.1), with the check.
--
-- As 20260923210000 plus:
--   · a share-code document whose check is queued or running is not
--     listed while the check is switched on — it is not the office's yet
--     (§2.6: only failures are flagged for manual review);
--   · every document row carries its latest check (status, source, when,
--     the date and conditions gov.uk returned, the office's reason, the
--     report);
--   · kind 'rtw_check': a check in needs_review whose document is no
--     longer pending — gov.uk said no right to work and the worker has
--     been asked to re-enter — until the office marks it reviewed.
-- The new columns are appended, so the view keeps its existing ones.
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
  k.check_id                                                 as rtw_check_id,
  k.status                                                   as rtw_check_status,
  k.source                                                   as rtw_check_source,
  k.outcome                                                  as rtw_check_outcome,
  k.attempts                                                 as rtw_check_attempts,
  coalesce(k.finished_at, k.created_at)                      as rtw_checked_at,
  k.review_reason                                            as rtw_check_reason,
  k.right_to_work_until                                      as rtw_check_until,
  k.no_time_limit                                            as rtw_check_no_time_limit,
  k.conditions                                               as rtw_check_conditions,
  k.report_path                                              as rtw_check_report_path,
  case when d.doc_type = 'share_code_report' then rtw_check_manual_allowed(d.id) end
                                                             as rtw_manual_allowed
from compliance_docs d
join staff s on s.id = d.staff_id
left join lateral (select * from rtw_checks_latest_v l where l.document_id = d.id) k on true
where d.review_status = 'pending'
  and s.status not in ('rejected', 'removed')
  and s.removed_at is null
  and not coalesce(d.doc_type = 'share_code_report'
                   and k.status in ('queued', 'running')
                   and rtw_check_enabled(), false)
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
  null::uuid,
  null::text,
  null::text,
  null::text,
  null::int,
  null::timestamptz,
  null::text,
  null::date,
  null::boolean,
  null::jsonb,
  null::text,
  null::boolean
from criminal_declarations c
join staff s on s.id = c.staff_id
where c.answer
  and c.review_status = 'pending'
  and not c.superseded
  and s.status not in ('rejected', 'removed')
  and s.removed_at is null
union all
select
  'rtw_check'::text,
  k.check_id,
  s.id,
  s.first_name || ' ' || s.last_name,
  s.employee_id,
  s.status,
  s.status in ('interview_requested', 'interview_completed', 'documents', 'quiz', 'contract'),
  s.block_kind,
  (select r.block_reason from public.staff_block_reason_v r where r.staff_id = s.id) as block_reason,
  s.rtw_branch,
  s.photo_path,
  'share_code_report'::text,
  'gov.uk right-to-work check'::text,
  coalesce(k.finished_at, k.created_at),
  null::text,
  null::numeric,
  false,
  null::date,
  null::daterange[],
  null::date,
  d.share_code,
  null::text,
  false,
  null::text,
  null::text,
  null::text,
  null::date,
  s.right_to_work_until,
  null::text,
  null::date,
  null::text,
  null::bigint,
  k.check_id,
  k.status,
  k.source,
  k.outcome,
  k.attempts,
  coalesce(k.finished_at, k.created_at),
  k.review_reason,
  k.right_to_work_until,
  k.no_time_limit,
  k.conditions,
  k.report_path,
  false
from rtw_checks_latest_v k
join compliance_docs d on d.id = k.document_id
join staff s on s.id = k.staff_id
where k.status = 'needs_review'
  and k.reviewed_at is null
  and d.review_status <> 'pending'
  and s.status not in ('rejected', 'removed')
  and s.removed_at is null;

comment on view compliance_review_queue_v is
  '§4.1 Needs review: every pending document and every pending Yes criminal declaration, candidates and staff alike, excluding Rejected and Removed profiles — and, with the automated right-to-work check on (ADR-0025), not a share code whose check is still running; plus kind rtw_check, a needs-review check whose document is no longer pending. Each document row carries its latest check. security_invoker.';

-- ---------------------------------------------------------------------
-- 13 · The wizard's way back after a rejected share code.
--
-- Step 1 is closed once documents are submitted (documents_submitted), and
-- the Documents hub is for compliant / blocked workers, so a candidate
-- whose code gov.uk did not recognise had no way to enter another. They
-- now re-enter it here — with their date of birth, because "check both"
-- is what the N8 asks them to do. Candidates only: the date of birth of
-- someone already employed is the office's to correct (HMRC, §2.8).
-- ---------------------------------------------------------------------
create or replace function public.onboarding_reenter_share_code(
  p_share_code text,
  p_dob        date default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  s        staff := onboarding_me();
  p        onboarding_progress;
  v_code   text;
  v_status review_status;
  v_doc    uuid;
begin
  if s.status <> 'documents' then
    raise exception 'wrong_stage' using errcode = 'P0001';
  end if;
  select * into p from onboarding_progress where staff_id = s.id;
  if p.documents_at is null then
    -- Before submitting, step 1 is where the code is changed.
    raise exception 'documents_not_submitted' using errcode = 'P0001';
  end if;
  if s.rtw_branch is null or s.rtw_branch = 'uk_irish' then
    raise exception 'no_share_code_branch' using errcode = 'P0001';
  end if;

  select c.status into v_status
    from current_compliance_docs(s.id) c
   where c.doc_type = 'share_code_report';
  if v_status = 'pending' then
    raise exception 'already_pending' using errcode = 'P0001';
  end if;
  if v_status = 'verified' then
    raise exception 'already_verified' using errcode = 'P0001';
  end if;

  if not is_valid_share_code(p_share_code) then
    raise exception 'bad_share_code' using errcode = 'P0001';
  end if;
  v_code := normalise_share_code(p_share_code);

  if p_dob is not null and p_dob is distinct from s.dob then
    if p_dob > (onboarding_uk_today() - interval '18 years')::date then
      raise exception 'under_18' using errcode = 'P0001';
    end if;
    update staff set dob = p_dob where id = s.id;
  end if;
  update staff set share_code = v_code where id = s.id;

  insert into compliance_docs (staff_id, doc_type, share_code, needs_manual_review, review_status,
                               uploaded_at)
  values (s.id, 'share_code_report', v_code, true, 'pending', clock_timestamp())
  returning id into v_doc;

  insert into audit_log (at, actor, action, entity, entity_id, data)
  values (now(), auth.uid(), 'document.uploaded', 'compliance_docs', v_doc,
          jsonb_build_object('staffId', s.id, 'docType', 'share_code_report',
                             'source', 'onboarding_reenter',
                             'dobChanged', p_dob is not null and p_dob is distinct from s.dob));

  return jsonb_build_object('ok', true, 'documentId', v_doc::text, 'status', 'pending');
end $$;

comment on function public.onboarding_reenter_share_code(text, date) is
  '§2.5 / §2.6: a candidate whose share code was rejected (by the automated check or the office) enters another after submitting step 4, and may correct their date of birth (18+). A new pending share_code_report, which queues the check (ADR-0025).';

-- ---------------------------------------------------------------------
-- 14 · Privileges.
-- ---------------------------------------------------------------------
revoke execute on function public.rtw_check_config()                                  from public, anon, authenticated;
revoke execute on function public.rtw_check_enabled()                                 from public, anon;
revoke execute on function public.rtw_check_transitions()                             from public, anon;
revoke execute on function public.rtw_checks_state_guard()                            from public, anon, authenticated;
revoke execute on function public.rtw_checks_insert_guard()                           from public, anon, authenticated;
revoke execute on function public.rtw_checks_forget_report()                          from public, anon, authenticated;
revoke execute on function public.rtw_check_backoff(int)                              from public, anon;
revoke execute on function public.rtw_check_clean_error(text, text)                   from public, anon, authenticated;
revoke execute on function public.rtw_check_clean_result(jsonb, text)                 from public, anon, authenticated;
revoke execute on function public.compliance_verify_document_as(uuid, uuid, date, daterange[], date)
                                                                                      from public, anon, authenticated, service_role;
revoke execute on function public.compliance_reject_document_as(uuid, uuid, text)     from public, anon, authenticated, service_role;
revoke execute on function public.rtw_check_manual_allowed(uuid)                      from public, anon;
revoke execute on function public.rtw_check_nudge()                                   from public, anon, authenticated;
revoke execute on function public.rtw_check_enqueue(uuid, uuid)                       from public, anon, authenticated;
revoke execute on function public.compliance_docs_rtw_check_enqueue()                 from public, anon, authenticated;
revoke execute on function public.rtw_check_claim(int, int)                           from public, anon, authenticated;
revoke execute on function public.rtw_check_record(uuid, jsonb, jsonb, text, text)    from public, anon, authenticated;
revoke execute on function public.rtw_check_request(uuid)                             from public, anon;
revoke execute on function public.rtw_check_mark_reviewed(uuid)                       from public, anon;
revoke execute on function public.my_rtw_checks()                                     from public, anon;
revoke execute on function public.onboarding_reenter_share_code(text, date)           from public, anon;

-- The office's views call these as the admin.
grant execute on function public.rtw_check_enabled()              to authenticated, service_role;
grant execute on function public.rtw_check_manual_allowed(uuid)   to authenticated, service_role;
grant execute on function public.rtw_check_transitions()          to authenticated, service_role;
grant execute on function public.rtw_check_backoff(int)           to authenticated, service_role;
-- The runner (apps/office/app/api/jobs/rtw-check), on the service key.
grant execute on function public.rtw_check_claim(int, int)                        to service_role;
grant execute on function public.rtw_check_record(uuid, jsonb, jsonb, text, text) to service_role;
grant execute on function public.rtw_check_config()                               to service_role;
-- Each checks its caller: admin (assert_reviewer) or the worker themself.
grant execute on function public.rtw_check_request(uuid)                   to authenticated;
grant execute on function public.rtw_check_mark_reviewed(uuid)             to authenticated;
grant execute on function public.my_rtw_checks()                           to authenticated;
grant execute on function public.onboarding_reenter_share_code(text, date) to authenticated;
