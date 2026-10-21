-- =====================================================================
-- Migration 20261022155100 · withdrawing a completion letter's approval
--                            (ADR-0183, building on ADR-0178)
--
-- The case that asked for it: a student already on the staff, with BOTH
-- letters verified. The completion letter was approved — but the course
-- restarts on 18/01/2027, so it should never have been: graduated_at makes
-- the cap 48 h for good and stops the term letter's ladder
-- (term_letter_applies). The office could not undo it.
--
-- 1 · document_review_transition_allowed(): the review states as a
--     machine, mirrored by DOCUMENT_REVIEW_TRANSITIONS in
--     packages/domain/src/state.ts, and a guard on the completion letter —
--     the one document whose approval now has a way back: once verified it
--     leaves only for `superseded`.
-- 2 · cap_band_notify_now(): compliance_daily()'s N14 step for one worker,
--     so an office correction tells the worker their new limit at once and
--     the 05:00 run never repeats it. Also used by set_term_letter_periods
--     (20261022155300).
-- 3 · outbox_row_leased(): an unsent outbox row the drain has claimed is in
--     flight and is never deleted from under it.
-- 4 · compliance_withdraw_completion_approval(doc, reason): EVERY verified
--     completion letter of the worker goes to `superseded` — the state a
--     reset already puts a verified letter in ("held, never used to satisfy
--     the current check"), not `rejected`, which means "re-upload" (N8)
--     everywhere a worker or the office reads it. The reason is kept on the
--     row and in the audit. graduated_at and course_completion_date are
--     cleared; right_to_work_until is NOT touched. term_letter_applies() is
--     true again, so the latest verified term letter drives the cap and its
--     ladder: the approval never superseded a VERIFIED term letter (ADR-0112
--     supersedes only pending and rejected ones), so that letter is current
--     again by construction. An unsent, unclaimed CL2 is dropped. No N8.
--
-- Who may: the office, as for every review (assert_reviewer — the same
-- check approve_completion_letter and set_term_letter_periods use); a
-- viewer's write meets office_read_only (ADR-0060); a worker or a client is
-- not_authorised.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1 · The review states (packages/domain/src/state.ts)
--
--   pending  → verified | rejected | superseded
--   verified → superseded             (a reset, a newer letter, an
--                                      approval withdrawn)
--   verified → rejected               NI evidence only (the D43 NI check)
--   rejected → superseded
-- ---------------------------------------------------------------------
create or replace function public.document_review_transition_allowed(
  p_doc_type doc_type,
  p_from     review_status,
  p_to       review_status
) returns boolean
language sql
immutable
set search_path = public, extensions
as $$
  select p_from = p_to
      or (p_from = 'pending'  and p_to in ('verified', 'rejected', 'superseded'))
      or (p_from = 'verified' and p_to = 'superseded')
      or (p_from = 'verified' and p_to = 'rejected' and p_doc_type = 'ni_evidence')
      or (p_from = 'rejected' and p_to = 'superseded')
$$;

comment on function public.document_review_transition_allowed(doc_type, review_status, review_status) is
  'ADR-0183: may a document move between these review states? Mirrors DOCUMENT_REVIEW_TRANSITIONS / canTransitionDocumentReview in packages/domain/src/state.ts.';

revoke all on function public.document_review_transition_allowed(doc_type, review_status, review_status) from public, anon;
grant execute on function public.document_review_transition_allowed(doc_type, review_status, review_status) to authenticated, service_role;

create or replace function public.completion_letter_state_guard()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
begin
  if not document_review_transition_allowed(new.doc_type, old.review_status, new.review_status) then
    raise exception 'illegal_review_transition: % -> %', old.review_status, new.review_status
      using errcode = 'P0001',
            hint = 'An approved completion letter is withdrawn with compliance_withdraw_completion_approval() (ADR-0183).';
  end if;
  return new;
end $$;

comment on function public.completion_letter_state_guard() is
  'ADR-0183: a verified Official University Completion Letter leaves `verified` only for `superseded` (document_review_transition_allowed).';

revoke all on function public.completion_letter_state_guard() from public, anon, authenticated;

drop trigger if exists completion_letter_state_guard on compliance_docs;
create trigger completion_letter_state_guard
  before update of review_status on compliance_docs
  for each row
  when (new.doc_type = 'university_completion_letter'
        and old.review_status = 'verified'
        and new.review_status is distinct from 'verified')
  execute function completion_letter_state_guard();

-- ---------------------------------------------------------------------
-- 2 · N14 now, for one worker, exactly as compliance_daily() sends it.
--
-- Same key ('N14:staff:<id>:<band>:<UK day>'), same payload, same
-- receipt (cap_band_notices), same rule: a worker who was never assessed
-- is recorded, not told; a band that did not change says nothing. So the
-- 05:00 run finds the receipt already current and sends nothing more.
-- ---------------------------------------------------------------------
create or replace function public.cap_band_notify_now(p_staff uuid, p_today date)
returns boolean
language plpgsql
set search_path = public, extensions
as $$
declare
  s      staff;
  c      cap_assessment;
  v_last cap_band;
  v_until date;
begin
  select * into s from staff where id = p_staff;
  if s.id is null or s.status <> 'compliant' or s.left_at is not null or s.removed_at is not null then
    return false;
  end if;
  select * into c from weekly_cap_for(p_staff, p_today);
  select band into v_last from cap_band_notices where staff_id = p_staff;
  if not found then
    insert into cap_band_notices (staff_id, band, cap_hours, notified_on)
    values (p_staff, c.band, c.cap_hours, p_today)
    on conflict (staff_id) do nothing;
    return false;
  end if;
  if v_last is not distinct from c.band then
    return false;
  end if;
  v_until := case when c.band in ('student_term_10', 'student_term_20', 'student_holiday_48')
                  then cap_band_until(s.term_dates, p_today) end;
  insert into notification_outbox (key, channel, template, recipient_staff_id, payload)
  values ('N14:staff:' || p_staff || ':' || c.band || ':' || p_today,
          'push', 'N14', p_staff,
          jsonb_strip_nulls(jsonb_build_object(
            'variant', case when c.band = 'uncapped' then 'uncapped'
                            when v_until is null    then 'open'
                            else 'dated' end,
            'limit',   c.cap_hours::text,
            'band',    cap_band_label(c.band),
            'date',    to_char(v_until, 'DD Mon YYYY'))))
  on conflict (key) do nothing;
  update cap_band_notices
     set band = c.band, cap_hours = c.cap_hours, notified_on = p_today
   where staff_id = p_staff;
  return true;
end $$;

comment on function public.cap_band_notify_now(uuid, date) is
  'ADR-0183: compliance_daily()''s N14 step for one worker, run the moment an office correction changes their band (same key, payload and cap_band_notices receipt, so the 05:00 run never repeats it). Internal.';

revoke all on function public.cap_band_notify_now(uuid, date) from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- 3 · Is an unsent outbox row in the drain's hands right now?
-- ---------------------------------------------------------------------
create or replace function public.outbox_row_leased(p_attempts integer, p_send_after timestamptz)
returns boolean
language sql
stable
set search_path = public, extensions
as $$
  select coalesce(p_attempts, 0) > 0 and p_send_after > now()
$$;

comment on function public.outbox_row_leased(integer, timestamptz) is
  'ADR-0183: true for an unsent notification_outbox row a drain has claimed (the claim bumps attempts and leases it by moving send_after ahead) — in flight, so never deleted from under the runner.';

revoke all on function public.outbox_row_leased(integer, timestamptz) from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- 4 · Withdraw a completion letter's approval.
-- ---------------------------------------------------------------------
create or replace function public.compliance_withdraw_completion_approval(
  p_doc    uuid,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_actor  uuid := assert_reviewer();
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_today  date := (now() at time zone 'Europe/London')::date;
  d        compliance_docs;
  s        staff;
  v_term   uuid;
  v_n14    boolean;
  v_withdrawn uuid[];
begin
  if v_reason is null then
    raise exception 'reason_required' using errcode = 'P0001';
  end if;
  if length(v_reason) > 500 then
    raise exception 'note_too_long' using errcode = '22023';
  end if;

  select * into d from compliance_docs where id = p_doc for update;
  if d.id is null then
    raise exception 'document_not_found' using errcode = 'P0002';
  end if;
  if d.doc_type <> 'university_completion_letter' then
    raise exception 'not_a_completion_letter' using errcode = 'P0001';
  end if;
  if d.review_status <> 'verified' then
    raise exception 'letter_not_verified: %', d.review_status using errcode = 'P0001';
  end if;
  if not document_review_transition_allowed(d.doc_type, d.review_status, 'superseded') then
    raise exception 'illegal_review_transition: % -> superseded', d.review_status using errcode = 'P0001';
  end if;

  select * into s from staff where id = d.staff_id for update;
  if s.status in ('rejected', 'removed') or s.removed_at is not null then
    raise exception 'not_reviewable: %', s.status using errcode = 'P0001';
  end if;
  -- EVERY verified completion letter of this worker goes,
  -- not only the one pressed — approval keeps one current (20261022155200), but
  -- a worker approved twice before that carries two, and either alone still
  -- graduates them. Each fires completion_letter_audit
  -- (completion_letter.superseded, with the reason) and the state guard.
  with gone as (
    update compliance_docs
       set review_status = 'superseded',
           rejection_reason = v_reason
     where staff_id = s.id
       and doc_type = 'university_completion_letter'
       and review_status = 'verified'
    returning id
  ) select array_agg(id order by id) into v_withdrawn from gone;

  -- The graduation goes with it; the right to work does not.
  update staff
     set graduated_at = null,
         course_completion_date = null
   where id = s.id;

  -- "48 hours from …" must not reach them if it has not gone yet.
  -- (Not one the drain has already claimed: that one is in flight.)
  delete from notification_outbox
   where key in (select 'CL2:doc:' || w from unnest(v_withdrawn) w)
     and sent_at is null and failed_at is null
     and not outbox_row_leased(attempts, send_after);

  select c.doc_id into v_term from current_verified_docs(s.id) c
   where c.doc_type = 'university_term_dates_letter';

  insert into audit_log (at, actor, action, entity, entity_id, data)
  values (now(), v_actor, 'completion_letter.approval_withdrawn', 'compliance_doc', d.id,
          jsonb_strip_nulls(jsonb_build_object(
            'staffId',                 s.id,
            'employeeId',              s.employee_id,
            'actorName',               (select full_name from profiles where id = v_actor),
            'reason',                  v_reason,
            'completionDate',          d.completion_date,
            'graduatedAtBefore',       s.graduated_at,
            'courseCompletionBefore',  s.course_completion_date,
            'rightToWorkUntil',        s.right_to_work_until,
            'withdrawnLetters',        to_jsonb(v_withdrawn::text[]),
            'termLetterNowCurrent',    v_term)));

  v_n14 := cap_band_notify_now(s.id, v_today);

  return jsonb_build_object(
    'withdrawn',         true,
    'documentId',        d.id::text,
    'withdrawnCount',    cardinality(v_withdrawn),
    'termLetterId',      v_term::text,
    'termLetterApplies', term_letter_applies(s.id, v_today),
    'capNotified',       v_n14);
end $$;


comment on function public.compliance_withdraw_completion_approval(uuid, text) is
  'ADR-0183: the office withdraws a verified Official University Completion Letter''s approval, with a reason: EVERY verified completion letter of the worker is superseded (reason kept, audited as completion_letter.superseded and completion_letter.approval_withdrawn), graduated_at and course_completion_date are cleared, right_to_work_until is kept, an unsent and unclaimed CL2 is dropped, the latest verified term letter drives the cap and its ladder again, N14 at once on a band change. No N8.';

revoke all on function public.compliance_withdraw_completion_approval(uuid, text) from public, anon;
grant execute on function public.compliance_withdraw_completion_approval(uuid, text) to authenticated, service_role;
