-- =====================================================================
-- Migration 20261022150200 · one current completion letter, a withdrawal
--                            that takes every approval, and the drain's
--                            in-flight rows left alone (ADR-0178, QA)
--
-- 1 · approve_completion_letter(), restated from its latest body
--     (20261012110000) with ONE addition: approving a completion letter
--     supersedes any earlier VERIFIED completion letter of the same worker.
--     One current letter, as for any evidence; before this a worker could
--     carry two, and 20261022150100's Withdraw refused them
--     (another_completion_letter_verified), a dead end.
-- 2 · compliance_withdraw_completion_approval(), restated from
--     20261022150100: it supersedes EVERY verified completion letter of the
--     worker in one go, so the legacy two-approvals case is withdrawn too;
--     the audit names them all (withdrawnLetters). The refusal is gone.
-- 3 · Both it and compliance_correct_term_dates() (restated from
--     20261022150100) delete an unsent outbox row only when the drain has
--     not claimed it: the drain leases a row by bumping attempts and
--     pushing send_after ahead (20261019195000), and deleting it under the
--     runner loses the receipt of a push that may already be on its way.
--     A leased ladder rung is re-keyed like a sent one; a leased CL2 is
--     left — it is in flight.
-- Otherwise character for character the bodies they replace;
-- create or replace keeps every grant.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0 · Is an unsent outbox row in the drain's hands right now?
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
  'ADR-0178: true for an unsent notification_outbox row a drain has claimed (the claim bumps attempts and leases it by moving send_after ahead) — in flight, so never deleted from under the runner.';

revoke all on function public.outbox_row_leased(integer, timestamptz) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 1 · approve_completion_letter(), from 20261012110000.
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

  -- ADR-0112: once the term letter stops applying, an unverified one is
  -- not evidence of anything and must not hold the worker's count or gate.
  if not term_letter_applies(s.id, v_today) then
    update compliance_docs
       set review_status = 'superseded'
     where staff_id = s.id
       and doc_type = 'university_term_dates_letter'
       and review_status in ('pending', 'rejected');
  end if;

  -- 20261022150200 (ADR-0178): one current completion letter, as for any
  -- evidence — an earlier approved one is superseded (kept, read-only,
  -- audited as completion_letter.superseded), so a later Withdraw has one
  -- letter to withdraw, not two.
  update compliance_docs
     set review_status = 'superseded'
   where staff_id = s.id
     and doc_type = 'university_completion_letter'
     and review_status = 'verified'
     and id <> d.id;

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
  'Completion letter requirement §2.2. The reviewer confirms the completion date and the visa expiry; the worker''s course_completion_date and graduated_at are written (the cap follows from RULE-20, from the completion date, never backdated) and right_to_work_until becomes the earlier of the two expiries. Once the term letter stops applying, a pending or rejected one is superseded (ADR-0112). An earlier verified completion letter of the same worker is superseded: one current letter (ADR-0178, 20261022150200). Queues CL2 with the new cap and effective date, or the visa_first variant when the right to work ends first (§7).';

-- ---------------------------------------------------------------------
-- 2 · compliance_withdraw_completion_approval(), from 20261022150100.
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
  -- 20261022150200: EVERY verified completion letter of this worker goes,
  -- not only the one pressed — approval now keeps one current, but a
  -- worker approved twice before it carries two, and either alone still
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
  'ADR-0178: an owner or manager withdraws a verified Official University Completion Letter''s approval, with a reason: EVERY verified completion letter of the worker is superseded (reason kept, audited as completion_letter.superseded and completion_letter.approval_withdrawn), graduated_at and course_completion_date are cleared, right_to_work_until is kept, an unsent and unclaimed CL2 is dropped, the latest verified term letter drives the cap and its ladder again, N14 at once on a band change. No N8.';

-- ---------------------------------------------------------------------
-- 3 · compliance_correct_term_dates(), from 20261022150100.
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
    -- 20261022150200: a row the drain has claimed (attempts > 0, its
    -- lease send_after still ahead) is in flight — it is re-keyed with the
    -- sent ones, never deleted under the runner.
    with gone as (
      delete from notification_outbox
       where key in ('N1:doc:' || d.id, 'N2:doc:' || d.id, 'N3:doc:' || d.id, 'N4:doc:' || d.id)
         and sent_at is null and failed_at is null
         and not outbox_row_leased(attempts, send_after)
      returning 1
    ), kept as (
      update notification_outbox
         set key = key || ':until:' || coalesce(v_before::text, 'none') || ':' || id
       where key in ('N1:doc:' || d.id, 'N2:doc:' || d.id, 'N3:doc:' || d.id, 'N4:doc:' || d.id)
         and (sent_at is not null or failed_at is not null
              or outbox_row_leased(attempts, send_after))
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
  'ADR-0178: an owner or manager corrects the holiday periods on a worker''s CURRENT verified University Term Dates Letter, with a note. Verify''s checks; writes compliance_docs.term_dates and staff.term_dates; the expiry (ADR-0103), the ladder and the block follow; ladder receipts for an old expiry are dropped (unsent and unclaimed) or re-keyed (sent, failed, or in the drain''s hands); audit term_letter.dates_corrected (from / to / note / who); an expiry block is lifted through unblock_if_compliant; N14 at once on a band change.';
