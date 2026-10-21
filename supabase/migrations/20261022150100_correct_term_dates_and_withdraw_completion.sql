-- =====================================================================
-- Migration 20261022150100 · correcting a verified term letter, and
--                            withdrawing a completion letter's approval
--                            (ADR-0178)
--
-- The case that asked for it: a student already on the staff, with BOTH
-- letters verified. The term letter was verified with the dates the AI
-- missed, and the completion letter approved — but the course restarts on
-- 18/01/2027, so the completion letter should never have been approved:
-- graduated_at makes the cap 48 h for good and stops the term letter's
-- ladder (term_letter_applies). Neither could be undone from the office.
--
-- 1 · compliance_correct_term_dates(doc, ranges, note, no_holidays): the
--     CURRENT verified term letter's holiday periods, corrected. The same
--     checks as Verify (complete, ordered, real, ≤ a year each, not all
--     past, not expiring today or earlier), a required note, an audit row
--     with who / when / from / to. Writes compliance_docs.term_dates and
--     staff.term_dates. The expiry is calculated from the ranges
--     (doc_expires_on, ADR-0103), so the ladder and the expiry block move
--     with them by themselves; what is stored is the ladder's RECEIPTS
--     (the outbox keys N1..N4:doc:<id>), so when the expiry moves the
--     unsent rungs for the old date are dropped and the sent ones re-keyed
--     — kept as history, and no longer standing in the way of the rungs
--     for the new date. An expiry block it lifts goes through
--     unblock_if_compliant (the §4.3 re-check).
--
-- 2 · compliance_withdraw_completion_approval(doc, reason): a verified
--     completion letter goes to `superseded` — the state a reset already
--     puts a verified letter in ("held, never used to satisfy the current
--     check"), not `rejected`, which means "re-upload" (N8) everywhere a
--     worker or the office reads it. The reason is kept on the row and in
--     the audit. graduated_at and course_completion_date are cleared;
--     right_to_work_until is NOT touched (it is the visa's, whichever
--     letter last confirmed it). term_letter_applies() is true again, so
--     the latest verified term letter drives the cap and its ladder: the
--     approval never superseded a VERIFIED term letter (ADR-0112 supersedes
--     only pending and rejected ones), so that letter is current again by
--     construction — current_verified_docs() picks it. An unsent CL2 ("48
--     hours from…") is dropped. No N8.
--
-- Both: owner or manager only — the roles that correct a date of birth
-- and mark an interview complete (ADR-0070, ADR-0077); a scheduler, a
-- viewer, a worker or a client is refused (not_permitted / not_authorised),
-- and a viewer's write would meet office_read_only anyway (ADR-0060). Both
-- queue N14 at once if the worker's band for this week changed — the same
-- push, key and receipt compliance_daily uses, so it is never sent twice.
--
-- 3 · document_review_transition_allowed(): the review states as a
--     machine, mirrored by DOCUMENT_REVIEW_TRANSITIONS in
--     packages/domain/src/state.ts; and a guard on the completion letter,
--     the one document whose approval now has a way back: once verified it
--     leaves only for `superseded`.
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
  'ADR-0178: may a document move between these review states? Mirrors DOCUMENT_REVIEW_TRANSITIONS / canTransitionDocumentReview in packages/domain/src/state.ts.';

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
            hint = 'An approved completion letter is withdrawn with compliance_withdraw_completion_approval() (ADR-0178).';
  end if;
  return new;
end $$;

comment on function public.completion_letter_state_guard() is
  'ADR-0178: a verified Official University Completion Letter leaves `verified` only for `superseded` (document_review_transition_allowed).';

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
-- 2 · Who may correct a decided letter: an owner or a manager.
-- ---------------------------------------------------------------------
create or replace function public.assert_letter_editor()
returns uuid
language plpgsql
stable
set search_path = public, extensions
as $$
declare
  v_uid uuid := assert_reviewer();   -- not_authorised for anyone not the office
begin
  if not exists (select 1 from profiles p
                  where p.id = v_uid and p.role = 'admin'
                    and p.office_role in ('owner', 'manager')) then
    raise exception 'not_permitted' using errcode = '42501', detail = 'letter_correction';
  end if;
  return v_uid;
end $$;

comment on function public.assert_letter_editor() is
  'ADR-0178: the signed-in owner or manager correcting a verified term letter or withdrawing a completion letter''s approval, or not_authorised / not_permitted (42501). Internal to those two functions.';

revoke all on function public.assert_letter_editor() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 3 · N14 now, for one worker, exactly as compliance_daily() sends it.
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
  'ADR-0178: compliance_daily()''s N14 step for one worker, run the moment an office correction changes their band (same key, payload and cap_band_notices receipt, so the 05:00 run never repeats it). Internal.';

revoke all on function public.cap_band_notify_now(uuid, date) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 4 · Correct the holiday periods on the current verified term letter.
-- ---------------------------------------------------------------------
create or replace function public.compliance_correct_term_dates(
  p_doc         uuid,
  p_term_dates  daterange[],
  p_note        text,
  p_no_holidays boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_actor   uuid := assert_letter_editor();
  v_note    text := nullif(btrim(coalesce(p_note, '')), '');
  v_today   date := (now() at time zone 'Europe/London')::date;
  d         compliance_docs;
  s         staff;
  v_problem text;
  v_before  date;
  v_after   date;
  v_ladder  int := 0;
  v_n14     boolean;
  v_lifted  boolean := false;
begin
  if v_note is null then
    raise exception 'note_required' using errcode = '22023';
  end if;
  if length(v_note) > 500 then
    raise exception 'note_too_long' using errcode = '22023';
  end if;

  select * into d from compliance_docs where id = p_doc for update;
  if d.id is null then
    raise exception 'document_not_found' using errcode = 'P0002';
  end if;
  if d.doc_type <> 'university_term_dates_letter' then
    raise exception 'not_a_term_letter' using errcode = 'P0001';
  end if;
  if d.review_status <> 'verified' then
    raise exception 'letter_not_verified: %', d.review_status using errcode = 'P0001';
  end if;

  select * into s from staff where id = d.staff_id for update;
  if s.status in ('rejected', 'removed') or s.removed_at is not null then
    raise exception 'not_reviewable: %', s.status using errcode = 'P0001';
  end if;
  if d.id is distinct from (select c.doc_id from current_verified_docs(s.id) c
                             where c.doc_type = 'university_term_dates_letter') then
    raise exception 'not_current_letter' using errcode = 'P0001',
      hint = 'Only the worker''s current term letter is corrected; an older one is history.';
  end if;

  -- The same checks as Verify.
  if p_term_dates is null then
    raise exception 'term_dates_required' using errcode = '22023';
  end if;
  v_problem := term_letter_periods_problem(p_term_dates);
  if v_problem = 'term_dates_implausible' then
    raise exception 'term_dates_implausible: a holiday period on this letter runs for more than a year'
      using errcode = '22023';
  elsif v_problem is not null then
    raise exception '%', v_problem using errcode = '22023';
  end if;
  if cardinality(p_term_dates) = 0 and not coalesce(p_no_holidays, false) then
    raise exception 'no_holidays_not_confirmed' using errcode = '22023',
      hint = 'A letter with no holiday periods limits the worker to term time all year; confirm it explicitly.';
  end if;
  if term_letter_expired(p_term_dates, v_today) then
    raise exception 'term_letter_expired: every term date on this letter is before %', v_today
      using errcode = 'P0001';
  end if;
  v_after := doc_expires_on(d.doc_type, d.expiry_date, d.right_to_work_until, s.right_to_work_until,
                            d.uploaded_at, p_term_dates);
  if v_after <= v_today then
    raise exception 'already_expired: %', v_after using errcode = 'P0001';
  end if;
  if (select coalesce(array_agg(r order by r), '{}') from unnest(p_term_dates) r)
     = (select coalesce(array_agg(r order by r), '{}') from unnest(coalesce(d.term_dates, '{}')) r) then
    raise exception 'term_dates_unchanged' using errcode = 'P0001';
  end if;

  v_before := doc_expires_on(d.doc_type, d.expiry_date, d.right_to_work_until, s.right_to_work_until,
                             d.uploaded_at, d.term_dates);

  update compliance_docs set term_dates = p_term_dates where id = d.id;
  update staff set term_dates = p_term_dates where id = s.id;

  -- The ladder follows the new expiry. Its receipts are the outbox keys,
  -- one per rung per document: drop what has not gone yet (it names the
  -- old date) and re-key what has, so the rungs for the new date can ring.
  if v_after is distinct from v_before then
    with gone as (
      delete from notification_outbox
       where key in ('N1:doc:' || d.id, 'N2:doc:' || d.id, 'N3:doc:' || d.id, 'N4:doc:' || d.id)
         and sent_at is null and failed_at is null
      returning 1
    ), kept as (
      update notification_outbox
         set key = key || ':until:' || coalesce(v_before::text, 'none') || ':' || id
       where key in ('N1:doc:' || d.id, 'N2:doc:' || d.id, 'N3:doc:' || d.id, 'N4:doc:' || d.id)
         and (sent_at is not null or failed_at is not null)
      returning 1
    ) select (select count(*) from gone) + (select count(*) from kept) into v_ladder;
  end if;

  insert into audit_log (at, actor, action, entity, entity_id, data)
  values (now(), v_actor, 'term_letter.dates_corrected', 'compliance_doc', d.id,
          jsonb_strip_nulls(jsonb_build_object(
            'staffId',       s.id,
            'employeeId',    s.employee_id,
            'actorName',     (select full_name from profiles where id = v_actor),
            'note',          v_note,
            'from',          to_jsonb(coalesce(d.term_dates, '{}')::text[]),
            'to',            to_jsonb(p_term_dates::text[]),
            'noHolidays',    cardinality(p_term_dates) = 0,
            'expiresBefore', v_before,
            'expiresAfter',  v_after,
            'ladderReset',   v_ladder)));

  -- An expiry block the old dates caused comes off through the §4.3
  -- re-check — never a manual block.
  if s.status = 'blocked' then
    v_lifted := unblock_if_compliant(s.id, v_today);
  end if;
  v_n14 := cap_band_notify_now(s.id, v_today);

  return jsonb_build_object(
    'corrected',     true,
    'documentId',    d.id::text,
    'expiresBefore', v_before,
    'expiresOn',     v_after,
    'unblocked',     v_lifted,
    'capNotified',   v_n14,
    'status',        (select status::text from staff where id = s.id));
end $$;

comment on function public.compliance_correct_term_dates(uuid, daterange[], text, boolean) is
  'ADR-0178: an owner or manager corrects the holiday periods on a worker''s CURRENT verified University Term Dates Letter, with a note. Verify''s checks; writes compliance_docs.term_dates and staff.term_dates; the expiry (ADR-0103), the ladder and the block follow; ladder receipts for an old expiry are dropped (unsent) or re-keyed (sent); audit term_letter.dates_corrected (from / to / note / who); an expiry block is lifted through unblock_if_compliant; N14 at once on a band change.';

revoke all on function public.compliance_correct_term_dates(uuid, daterange[], text, boolean) from public, anon;
grant execute on function public.compliance_correct_term_dates(uuid, daterange[], text, boolean) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 5 · Withdraw a completion letter's approval.
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
  v_actor  uuid := assert_letter_editor();
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_today  date := (now() at time zone 'Europe/London')::date;
  d        compliance_docs;
  s        staff;
  v_term   uuid;
  v_n14    boolean;
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
  if exists (select 1 from compliance_docs o
              where o.staff_id = s.id and o.id <> d.id
                and o.doc_type = 'university_completion_letter' and o.review_status = 'verified') then
    raise exception 'another_completion_letter_verified' using errcode = 'P0001';
  end if;

  -- Fires completion_letter_audit (completion_letter.superseded, with the
  -- reason) and the state guard above.
  update compliance_docs
     set review_status = 'superseded',
         rejection_reason = v_reason
   where id = d.id;

  -- The graduation goes with it; the right to work does not.
  update staff
     set graduated_at = null,
         course_completion_date = null
   where id = s.id;

  -- "48 hours from …" must not reach them if it has not gone yet.
  delete from notification_outbox
   where key = 'CL2:doc:' || d.id and sent_at is null and failed_at is null;

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
            'termLetterNowCurrent',    v_term)));

  v_n14 := cap_band_notify_now(s.id, v_today);

  return jsonb_build_object(
    'withdrawn',         true,
    'documentId',        d.id::text,
    'termLetterId',      v_term::text,
    'termLetterApplies', term_letter_applies(s.id, v_today),
    'capNotified',       v_n14);
end $$;

comment on function public.compliance_withdraw_completion_approval(uuid, text) is
  'ADR-0178: an owner or manager withdraws a verified Official University Completion Letter''s approval, with a reason: the letter is superseded (reason kept, audited as completion_letter.superseded and completion_letter.approval_withdrawn), graduated_at and course_completion_date are cleared, right_to_work_until is kept, an unsent CL2 is dropped, the latest verified term letter drives the cap and its ladder again, N14 at once on a band change. No N8.';

revoke all on function public.compliance_withdraw_completion_approval(uuid, text) from public, anon;
grant execute on function public.compliance_withdraw_completion_approval(uuid, text) to authenticated, service_role;
