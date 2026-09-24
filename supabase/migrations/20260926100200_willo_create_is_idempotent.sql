-- =====================================================================
-- "Create candidate in Willo" is idempotent (§2.4, §2.12 step 1,
-- Appendix B B1; ADR-0021 §3 and its 26.09 addendum; docs/14 §4)
--
-- The gap: the sweep (willo_invite_due → the Edge Function → Willo →
-- willo_link_candidate) leased a candidate with an audit row, created them
-- in Willo, and only then wrote the key. If that ONE write failed
-- transiently — or the function died between Willo's answer and the
-- write — the next sweep saw a candidate with no key and created them
-- again. Willo sends E1 on creation, so the candidate got two interviews.
--
-- The fix, in the order the brief asks for it:
--
--   1. THE LEASE IS ON THE ROW. willo_invite_due() sets
--      staff.willo_create_claimed_at inside the same `for update skip
--      locked` pass that picks the row, so two sweeps (the per-minute
--      schedule and the nudge) can never both hold a candidate. The lease
--      lasts as long as the retry backoff (5 min doubling to 6 h — the
--      same clock a failed attempt already waits), which is longer than a
--      sweep can run (20 rows × a 10 s Willo timeout).
--
--   2. THE KEY IS WRITTEN FIRST, ALONE. willo_create_recorded() stores the
--      key Willo answered with in staff.willo_created_candidate_id — no
--      status guard, nothing else in the statement, idempotent, and the
--      FIRST key wins. The Edge Function calls it the moment the create
--      returns and retries it in-process before anything else.
--
--   3. THE LINK IS RETRIED, THE CREATE IS NOT. A row that holds a
--      recorded key but no willo_candidate_id comes back from the sweep as
--      kind = 'link' with that key; the Edge Function then runs only
--      willo_link_candidate(). A row with a key is never offered as
--      kind = 'create', and willo_link_candidate() refuses a key that
--      differs from the recorded one.
--
--   4. A LEASE THAT EXPIRES WITHOUT AN ANSWER IS BOUNDED. When a claim is
--      neither linked nor released by the time its lease ends, the sweep
--      tries again — a stale retry — at most 3 times per onboarding
--      period (or since the office last pressed Retry). After that the row
--      is flagged, not re-created: willo_create_stuck_at is set, the
--      onboarding_candidates_v card carries willo_create_stuck_at /
--      willo_create_attempts / willo_create_last_error /
--      willo_created_candidate_id, and the office clears it with
--      willo_invite_retry() once it has looked in Willo. The surface is
--      the view, not an outbox row: the office reads this card already
--      and the §8 register has no office-facing onboarding template.
--
--   5. THE EDGE FUNCTION SAYS HOW AN ATTEMPT ENDED. willo_invite_failed()
--      takes an outcome: 'failed' (Willo said no, or was never reached:
--      the lease is released and the backoff applies), 'unknown' (a
--      timeout, a 2xx we could not read, or a key we could not write: the
--      lease is KEPT so the row goes down the bounded stale path), or
--      'stuck' (a link refused for a reason no retry fixes: flagged now).
--
-- The audit rows stay: willo_invite_claim (now with kind and
-- afterTimeout), willo_invite_failed (now with outcome), and two new
-- ones, willo_invite_duplicate and willo_invite_retry. The backoff is
-- still read from the claim rows, per period, so 482's timings hold.
--
-- No new table (001_rls_guard). Three columns on staff, granted by name
-- as 20260923210000 requires; none carries personal data or money.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1 · The columns
-- ---------------------------------------------------------------------
alter table staff
  add column if not exists willo_create_claimed_at    timestamptz,
  add column if not exists willo_created_candidate_id text,
  add column if not exists willo_create_stuck_at      timestamptz;

comment on column staff.willo_create_claimed_at is
  '§2.4 sweep lease: when the current attempt to create (or link) this candidate in Willo was claimed. Set by willo_invite_due under the row lock; cleared by willo_link_candidate, by willo_invite_failed(''failed'') and by willo_invite_retry. Still set past its backoff = the attempt never answered.';
comment on column staff.willo_created_candidate_id is
  '§2.4: the key Willo answered the create call with, written by willo_create_recorded BEFORE the link and kept until the link succeeds. A row holding one is retried as a LINK, never created again. Null on a Reset (new interview, §2.12) and on removal (§1.7).';
comment on column staff.willo_create_stuck_at is
  '§2.4: set when the create-in-Willo attempts for this period stopped answering 3 times running, or the link was refused for good. The row leaves the sweep until the office presses Retry (willo_invite_retry).';

-- 20260923210000: every staff column is granted by name or nothing can
-- read the view. None of these three is personal or money.
grant select (willo_create_claimed_at, willo_created_candidate_id, willo_create_stuck_at)
  on table public.staff to anon, authenticated;

-- ---------------------------------------------------------------------
-- 2 · A new period, or a removal, forgets the attempt
--
-- staff_status_guard (20260923110000) nulls the Willo columns on entry to
-- interview_requested; it is not restated here (docs/14 §8) — this small
-- trigger runs beside it. §1.7's removal nulls willo_candidate_id; the
-- recorded key goes the same way.
-- ---------------------------------------------------------------------
create or replace function public.staff_willo_create_reset()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if (new.status = 'interview_requested' and old.status is distinct from new.status)
     or (new.removed_at is not null and old.removed_at is null) then
    new.willo_create_claimed_at    := null;
    new.willo_created_candidate_id := null;
    new.willo_create_stuck_at      := null;
  end if;
  return new;
end $$;

comment on function public.staff_willo_create_reset() is
  '§2.12 step 1 / §1.7: a Reset (a fresh Willo interview is due) and a removal both forget the sweep''s lease, recorded key and stuck flag. Runs beside staff_status_guard rather than restating it.';

drop trigger if exists staff_willo_create_reset on staff;
create trigger staff_willo_create_reset
  before update of status, removed_at on staff
  for each row execute function public.staff_willo_create_reset();

-- ---------------------------------------------------------------------
-- 3 · The key, written first and alone
-- ---------------------------------------------------------------------
create or replace function public.willo_create_recorded(p_staff uuid, p_willo_candidate_id text)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_key text := btrim(coalesce(p_willo_candidate_id, ''));
  v_now text;
begin
  if v_key = '' then
    raise exception 'willo_candidate_id_required' using errcode = '22023';
  end if;
  -- No status guard and nothing else in the statement: this is a fact
  -- about Willo, and the only thing that may stop it being written is the
  -- database being unreachable — which the caller retries.
  update staff
     set willo_created_candidate_id = coalesce(willo_created_candidate_id, v_key)
   where id = p_staff
  returning willo_created_candidate_id into v_now;
  if v_now is null then
    raise exception 'unknown_staff' using errcode = 'P0002';
  end if;
  if v_now <> v_key then
    -- Two candidates in Willo for one person: a stale retry created
    -- again before the first key could be written, and the first key
    -- then landed. The first is the one the link uses; the second is
    -- recorded so the office can delete it in Willo.
    insert into audit_log (actor, action, entity, entity_id, data)
    values (null, 'willo_invite_duplicate', 'staff', p_staff,
            jsonb_build_object('kept', v_now, 'duplicate', v_key));
  end if;
  return v_now;
end $$;

comment on function public.willo_create_recorded(uuid, text) is
  '§2.4: records the key Willo answered the create call with, before any linking. Idempotent; the first key is kept and a second is audited (willo_invite_duplicate). Returns the key now on the row — the one the link must use. Service role only.';

-- ---------------------------------------------------------------------
-- 4 · willo_link_candidate: restated from 20260923110000 (its latest
--     definition), now closing the lease and refusing a key that is not
--     the recorded one.
-- ---------------------------------------------------------------------
create or replace function public.willo_link_candidate(
  p_staff              uuid,
  p_willo_candidate_id text,
  p_invited_at         timestamptz default now()
) returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_key text := btrim(coalesce(p_willo_candidate_id, ''));
begin
  if v_key = '' then
    raise exception 'willo_candidate_id_required' using errcode = '22023';
  end if;
  -- The recorded key is the candidate Willo sent E1 to. A different key
  -- here is a second create trying to overwrite it: refused, never
  -- linked, so the duplicate is visible rather than silently adopted.
  if exists (select 1 from staff
              where id = p_staff
                and willo_created_candidate_id is not null
                and willo_created_candidate_id <> v_key) then
    raise exception 'willo_candidate_id_mismatch' using errcode = '22023';
  end if;
  update staff
     set willo_candidate_id     = v_key,
         willo_invited_at       = p_invited_at,
         willo_create_claimed_at = null,
         willo_create_stuck_at  = null
   where id = p_staff and status = 'interview_requested' and removed_at is null;
  if not found then
    raise exception 'not_awaiting_interview' using errcode = 'P0001';
  end if;
end $$;

comment on function public.willo_link_candidate(uuid, text, timestamptz) is
  '§2.4: record that the candidate was created in Willo and Willo sent E1; closes the sweep''s lease. Refuses a key other than the one willo_create_recorded stored (willo_candidate_id_mismatch) and a candidate no longer awaiting the interview (not_awaiting_interview). Service role only.';

-- ---------------------------------------------------------------------
-- 5 · willo_invite_failed: restated from 20260924110000 with an outcome.
--     The signature changes, so the old overload goes first — with a
--     default on the new argument, a two-argument call would otherwise be
--     ambiguous.
-- ---------------------------------------------------------------------
drop function if exists public.willo_invite_failed(uuid, text);

create function public.willo_invite_failed(
  p_staff   uuid,
  p_error   text,
  p_outcome text default 'failed'
) returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if p_outcome not in ('failed', 'unknown', 'stuck') then
    raise exception 'willo_invite_outcome_invalid' using errcode = '22023';
  end if;
  insert into audit_log (actor, action, entity, entity_id, data)
  values (null, 'willo_invite_failed', 'staff', p_staff,
          jsonb_build_object('error', left(coalesce(p_error, ''), 300), 'outcome', p_outcome));
  update staff
     set willo_create_claimed_at = case when p_outcome = 'failed' then null else willo_create_claimed_at end,
         willo_create_stuck_at   = case when p_outcome = 'stuck'  then now() else willo_create_stuck_at end
   where id = p_staff;
end $$;

comment on function public.willo_invite_failed(uuid, text, text) is
  '§2.4: records how a "create candidate in Willo" attempt ended. ''failed'' = Willo refused or was never reached: the lease is released and willo_invite_due retries after its backoff. ''unknown'' = a timeout, an unreadable 2xx or a key that could not be written: the lease is kept, so the row takes the bounded stale path (3 retries, then stuck). ''stuck'' = a link refused for good: flagged for the office now. Service role only.';

-- ---------------------------------------------------------------------
-- 6 · willo_invite_due: restated from 20260924110000 (its latest
--     definition). The return type grows (kind, willo_candidate_id), so
--     it is dropped and re-created, and its grant restated below.
-- ---------------------------------------------------------------------
drop function if exists public.willo_invite_due(integer, timestamptz);

create function public.willo_invite_due(
  p_limit integer     default 20,
  p_now   timestamptz default now()
) returns table (
  staff_id           uuid,
  first_name         text,
  last_name          text,
  email              text,
  phone              text,
  attempt            integer,
  kind               text,
  willo_candidate_id text
)
language plpgsql
security definer
set search_path = public, extensions
as $$
#variable_conflict use_column
declare
  -- A lease that ends without an answer is retried this many times per
  -- period (or since the office's last Retry) before the row is flagged.
  c_max_stale constant integer := 3;
  r          staff;
  v_attempts integer;
  v_last     timestamptz;
  v_stale    integer;
  v_since    timestamptz;
  v_backoff  interval;
  v_taken    integer := 0;
begin
  for r in
    select * from staff s
     where s.status = 'interview_requested'
       and s.willo_candidate_id is null
       and s.removed_at is null
       and s.willo_create_stuck_at is null
     order by s.onboarding_started_at, s.id
     for update skip locked
  loop
    exit when v_taken >= greatest(coalesce(p_limit, 20), 1);

    -- The stale-retry budget restarts on a Reset (a new period) and on
    -- the office's Retry; the attempt count and the backoff are per period.
    select greatest(coalesce(r.onboarding_started_at, '-infinity'::timestamptz),
                    coalesce(max(a.at), '-infinity'::timestamptz))
      into v_since
      from audit_log a
     where a.entity_id = r.id and a.action = 'willo_invite_retry' and a.entity = 'staff';

    select count(*)::int,
           max(a.at),
           (count(*) filter (where a.at >= v_since
                               and coalesce((a.data ->> 'afterTimeout')::boolean, false)))::int
      into v_attempts, v_last, v_stale
      from audit_log a
     where a.entity_id = r.id
       and a.action = 'willo_invite_claim'
       and a.entity = 'staff'
       and a.at >= coalesce(r.onboarding_started_at, '-infinity'::timestamptz);

    -- 5 min after the first attempt, doubling, capped at 6 h. This is
    -- both the wait after a failed attempt and the length of the lease:
    -- a claim is not offered again before it, answered or not.
    v_backoff := least(interval '5 minutes' * power(2, greatest(v_attempts - 1, 0)), interval '6 hours');
    continue when v_last is not null and v_last > p_now - v_backoff;

    if r.willo_create_claimed_at is not null then
      -- The lease ran out without a link, a release or a flag: the
      -- function died mid-flight, or told us the outcome was unknown.
      -- Willo may or may not hold this candidate. Bounded, then the office.
      if v_stale >= c_max_stale then
        perform willo_invite_failed(
          r.id,
          format('no answer from %s attempts in a row (lease expired %s times); check Willo for %s before retrying',
                 case when r.willo_created_candidate_id is null then 'create' else 'link' end,
                 v_stale, r.email),
          'stuck');
        continue;
      end if;
    end if;

    update staff set willo_create_claimed_at = p_now where id = r.id;

    insert into audit_log (at, actor, action, entity, entity_id, data)
    values (p_now, null, 'willo_invite_claim', 'staff', r.id,
            jsonb_build_object('attempt', v_attempts + 1,
                               'kind', case when r.willo_created_candidate_id is null then 'create' else 'link' end,
                               'afterTimeout', r.willo_create_claimed_at is not null));

    staff_id           := r.id;
    first_name         := r.first_name;
    last_name          := r.last_name;
    email              := r.email;
    phone              := r.phone;
    attempt            := v_attempts + 1;
    kind               := case when r.willo_created_candidate_id is null then 'create' else 'link' end;
    willo_candidate_id := r.willo_created_candidate_id;
    v_taken            := v_taken + 1;
    return next;
  end loop;
end $$;

comment on function public.willo_invite_due(integer, timestamptz) is
  '§2.4/§2.12: leases up to p_limit candidates in interview_requested with no Willo candidate yet, setting willo_create_claimed_at under `for update skip locked` so two sweeps never hold the same row. kind = ''create'' (no key yet) or ''link'' (willo_create_recorded stored one; retry only the link, never a second create). Backoff 5 min doubling to 6 h per period, which is also the lease. A lease that expires unanswered is retried 3 times, then the row is flagged willo_create_stuck_at for the office. Service role only.';

-- ---------------------------------------------------------------------
-- 7 · The office's Retry (after looking in Willo)
-- ---------------------------------------------------------------------
create or replace function public.willo_invite_retry(
  p_staff uuid,
  p_now   timestamptz default now()
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  s staff;
begin
  perform assert_office_caller();
  select * into s from staff where id = p_staff and removed_at is null for update;
  if s.id is null then
    raise exception 'unknown_staff' using errcode = 'P0002';
  end if;
  if s.status <> 'interview_requested' or s.willo_candidate_id is not null then
    raise exception 'not_awaiting_interview' using errcode = 'P0001';
  end if;
  if s.willo_create_stuck_at is null then
    raise exception 'willo_create_not_stuck' using errcode = 'P0001';
  end if;
  update staff
     set willo_create_stuck_at   = null,
         willo_create_claimed_at = null
   where id = p_staff;
  -- Dated: the sweep's stale-retry budget restarts from here.
  insert into audit_log (at, actor, action, entity, entity_id, data)
  values (p_now, auth.uid(), 'willo_invite_retry', 'staff', p_staff,
          jsonb_build_object('createdCandidateId', s.willo_created_candidate_id));
  return jsonb_build_object('staffId', p_staff::text,
                            'kind', case when s.willo_created_candidate_id is null then 'create' else 'link' end);
end $$;

comment on function public.willo_invite_retry(uuid, timestamptz) is
  '§2.4: the office clears a stuck "create candidate in Willo" after checking Willo. The next sweep (the willo-invite schedule) retries — the LINK if a key was recorded, otherwise the create — with a fresh stale-retry budget. Audited with the manager as actor. Office only; refuses a candidate who is not stuck.';

-- ---------------------------------------------------------------------
-- 8 · onboarding_candidates_v: restated from 20260924160000 (its latest
--     definition — #48's view with 20260924110000's `activated`), with
--     the four Willo-create columns appended. Nothing else changes.
-- ---------------------------------------------------------------------
create or replace view onboarding_candidates_v with (security_invoker = true) as
select
  s.id,
  s.first_name,
  s.last_name,
  s.first_name || ' ' || s.last_name                           as display_name,
  s.email,
  s.phone,
  s.dob,
  case when s.dob is not null
       then extract(year from age((now() at time zone 'Europe/London')::date, s.dob))::int end as age,
  s.applied_age_band,
  s.photo_path,
  s.status,
  s.stage_entered_at,
  s.onboarding_started_at,
  s.created_at                                                 as applied_at,
  s.gdpr_consent_at,
  s.employee_id,
  s.rtw_branch,
  s.right_to_work_until,
  s.share_code,
  coalesce(staff_account_activated(s.id), false)               as activated,
  coalesce((select array_agg(r.name order by r.name)
              from staff_roles sr join roles r on r.id = sr.role_id
             where sr.staff_id = s.id), '{}'::text[])           as role_names,
  coalesce((select array_agg(sr.role_id)
              from staff_roles sr where sr.staff_id = s.id), '{}'::uuid[]) as role_ids,
  -- Willo (§2.4)
  s.willo_candidate_id is not null                             as willo_linked,
  case when s.willo_candidate_id is not null
        and jsonb_typeof((select value from settings where key = 'willo_review_url_template')) = 'string'
       then replace((select value #>> '{}' from settings where key = 'willo_review_url_template'),
                    '{id}', s.willo_candidate_id) end         as willo_review_url,
  s.willo_invited_at,
  s.willo_answers_done,
  s.willo_answers_total,
  s.willo_completed_at,
  s.willo_decision,
  s.willo_decided_at,
  s.willo_decided_via,
  -- Documents (§2.3): current rows only; superseded ones are the previous
  -- period's record and never count (§2.12).
  (select count(*) from current_compliance_docs(s.id))::int                        as docs_total,
  (select count(*) from current_compliance_docs(s.id) d where d.status = 'verified')::int as docs_verified,
  (select count(*) from current_compliance_docs(s.id) d where d.status = 'pending')::int  as docs_pending,
  (select count(*) from current_compliance_docs(s.id) d where d.status = 'rejected')::int as docs_rejected,
  (select max(c.reviewed_at) from compliance_docs c
    where c.staff_id = s.id and c.review_status = 'rejected')                      as last_doc_rejected_at,
  onboarding_documents_missing(s.id)                                               as docs_missing,
  onboarding_quiz_blockers(s.id)                                                   as quiz_blockers,
  (select c.answer from criminal_declarations c
    where c.staff_id = s.id and not c.superseded
    order by c.declared_at desc limit 1)                                           as declaration_answer,
  (select c.review_status from criminal_declarations c
    where c.staff_id = s.id and not c.superseded
    order by c.declared_at desc limit 1)                                           as declaration_status,
  -- Quiz (§2.9), this period only
  (select count(*) from quiz_attempts q
    where q.staff_id = s.id and q.taken_at >= s.onboarding_started_at)::int        as quiz_attempts_used,
  (select max(q.score) from quiz_attempts q
    where q.staff_id = s.id and q.taken_at >= s.onboarding_started_at)             as quiz_best_score,
  (select min(q.taken_at) from quiz_attempts q
    where q.staff_id = s.id and q.passed and q.taken_at >= s.onboarding_started_at) as quiz_passed_at,
  -- Additional info (§2.10), wizard steps 7-9
  (select h.submitted_at from hmrc_checklists h
    where h.staff_id = s.id and not h.superseded)                                  as hmrc_submitted_at,
  (select count(*) from staff_references r where r.staff_id = s.id)::int           as references_count,
  exists (select 1 from bank_details b where b.staff_id = s.id)                     as bank_saved,
  s.ni_number is not null                                                          as ni_entered,
  -- Contract (§2.11)
  s.contract_signed_at,
  s.contract_version,
  -- Rejection
  s.rejected_at,
  s.rejected_from,
  s.rejection_cause,
  -- §2.9 / ADR-0017: the office's free-text reason for rejecting a
  -- candidate is internal. E2 and E2b never carry it, and this view runs
  -- with the caller's privileges, so it is read through the owner-rights
  -- sub-view rather than off `s` — the caller no longer holds the column.
  (select r.rejection_reason from public.staff_rejection_reason_v r
    where r.staff_id = s.id)                                   as rejection_reason,
  p.full_name                                                                      as rejected_by_name,
  -- Create-in-Willo (§2.4, 20260926100200): the card says when the sweep
  -- gave up and why, so the office can look in Willo and press Retry.
  s.willo_create_stuck_at,
  s.willo_created_candidate_id,
  (select count(*) from audit_log a
    where a.entity_id = s.id and a.action = 'willo_invite_claim' and a.entity = 'staff'
      and a.at >= s.onboarding_started_at)::int                                    as willo_create_attempts,
  (select a.data ->> 'error' from audit_log a
    where a.entity_id = s.id and a.action = 'willo_invite_failed' and a.entity = 'staff'
      and a.at >= s.onboarding_started_at
    order by a.at desc, a.id desc limit 1)                                         as willo_create_last_error
from staff s
left join profiles p on p.id = s.rejected_by
where s.removed_at is null;

comment on view onboarding_candidates_v is
  'One row per non-removed person for /onboarding and /onboarding/:id (§2.2, §2.3): stage and days in it, Willo tracking (including whether the create-in-Willo sweep is stuck: willo_create_stuck_at, willo_create_attempts, willo_create_last_error, willo_created_candidate_id — 20260926100200), current-period document / declaration / quiz / additional-info progress, and the rejection record. `activated` = the login has a password (staff_account_activated, 20260924110000). security_invoker: staff is admin_all only, so a client sees nobody and a worker only themselves.';

-- ---------------------------------------------------------------------
-- 9 · Grants (docs/14 O7: by name)
-- ---------------------------------------------------------------------
revoke execute on function public.staff_willo_create_reset()                    from public, anon, authenticated;
revoke execute on function public.willo_create_recorded(uuid, text)             from public, anon, authenticated;
revoke execute on function public.willo_link_candidate(uuid, text, timestamptz) from public, anon, authenticated;
revoke execute on function public.willo_invite_failed(uuid, text, text)         from public, anon, authenticated;
revoke execute on function public.willo_invite_due(integer, timestamptz)        from public, anon, authenticated;
grant  execute on function public.willo_create_recorded(uuid, text)             to service_role;
grant  execute on function public.willo_link_candidate(uuid, text, timestamptz) to service_role;
grant  execute on function public.willo_invite_failed(uuid, text, text)         to service_role;
grant  execute on function public.willo_invite_due(integer, timestamptz)        to service_role;

-- The office's one: signed-in, and it refuses a non-admin itself.
revoke execute on function public.willo_invite_retry(uuid, timestamptz) from public, anon;
grant  execute on function public.willo_invite_retry(uuid, timestamptz) to authenticated;

-- Loud if a column slipped past the by-name grant (20260923210000's rule).
do $$
declare v_missing text;
begin
  select string_agg(a.attname, ', ')
    into v_missing
    from pg_attribute a
   where a.attrelid = 'public.staff'::regclass
     and a.attnum > 0 and not a.attisdropped
     and a.attname in ('willo_create_claimed_at', 'willo_created_candidate_id', 'willo_create_stuck_at')
     and not has_column_privilege('authenticated', 'public.staff', a.attname, 'select');
  if v_missing is not null then
    raise exception 'staff columns added without a grant: %', v_missing;
  end if;
end $$;
