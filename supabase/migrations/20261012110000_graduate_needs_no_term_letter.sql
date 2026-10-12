-- =====================================================================
-- A graduate needs no University Term Dates Letter — ADR-0112
--
-- Found 10–12.10.2026 on a live candidate (Meghana Mohan Sonnak, International
-- student). She had graduated, uploaded her Official University Completion
-- Letter (verified, completion date 18.09.2026) and — as the wizard asks
-- every student to — an out-of-date Term Dates Letter, which the office
-- rejected. She stayed in Documents at "3 of 4 verified" for good:
--
--   · compliance_blockers() counts every current document that is not
--     verified, so the rejected term letter held the §2.3 quiz gate shut
--     although §4.5 says a verified completion letter stops the term letter
--     driving anything (term_letter_applies() is already false for her);
--   · the wizard and onboarding_documents_missing() ask every student for a
--     term letter and treat the completion letter as an optional extra, so a
--     graduate had no way to submit without a letter that no longer exists.
--
-- Now, for the International student branch:
--
--   1 · The term-letter requirement is met by a term letter OR by a
--       completion letter that is not rejected (submit, "missing").
--       Upload paths are untouched: onboarding_required_docs() still
--       accepts the term letter only, and the completion letter still goes
--       through submit_completion_letter() with its date and form.
--   2 · compliance_blockers() ignores an unverified term letter once
--       term_letter_applies() is false — the verified-and-completed rule of
--       20260923100100, not a new one. A future-dated completion letter
--       keeps the term letter in force, exactly as before.
--   3 · A candidate who has a completion letter and NO term letter stays
--       out of Quiz until that letter is verified and its course has
--       completed; until then the term letter is the evidence, and there is
--       none (onboarding_quiz_blockers).
--   4 · approve_completion_letter() supersedes a pending or rejected term
--       letter the moment the term letter stops applying, before the flip to
--       verified, so the queue, the "N of M verified" count and the gate all
--       agree and the §2.3 advance sees nothing outstanding. History stays:
--       superseded, never deleted.
--   5 · One-off: candidates in Documents who are already in that state (the
--       live case) get the same supersede and the same gate.
--
-- The visa still wins and nothing about the cap changes: a graduate's
-- cap, N14/CL2 and the right-to-work expiry are read where they were.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 2 · compliance_blockers(): a term letter that no longer applies is no blocker.
--
-- As 20260923100000, except the second branch of the union.
-- ---------------------------------------------------------------------
create or replace function public.compliance_blockers(p_staff uuid, p_on date default current_date)
returns table (reason text)
language sql
stable
set search_path = public, extensions
as $$
  select 'document_expired:' || d.doc_type::text
    from current_verified_docs(p_staff) d
   where d.expires_on is not null
     and d.expires_on <= p_on
     and (d.doc_type <> 'university_term_dates_letter'
          or term_letter_applies(p_staff, p_on))
  union all
  select 'document_unverified:' || d.doc_type::text
    from current_compliance_docs(p_staff) d
   where d.status <> 'verified'
     and d.doc_type <> 'university_completion_letter'
     and (d.doc_type <> 'university_term_dates_letter'
          or term_letter_applies(p_staff, p_on))
  union all
  select 'conviction_unreviewed'
    from (
      select c.answer, c.review_status
        from criminal_declarations c
       where c.staff_id = p_staff
         and not c.superseded
       order by c.declared_at desc, c.id desc
       limit 1
    ) c
   where c.answer and c.review_status = 'pending'
$$;

comment on function public.compliance_blockers(uuid, date) is
  '§4.3 full compliance re-check, as reasons. Empty = compliant. A declaration still PENDING blocks; a rejected one does not (§10.7 makes the manual block carry it). The optional completion letter is never a blocker (20260923100000). An unverified University Term Dates Letter is no blocker once term_letter_applies() is false — a verified completion letter whose course has completed (ADR-0112, 20261012110000).';

-- ---------------------------------------------------------------------
-- 1 · What is missing: a completion letter stands in for the term letter.
--
-- As 20261002106000, except the International student branch.
-- ---------------------------------------------------------------------
create or replace function public.onboarding_documents_missing(p_staff uuid)
returns text[]
language plpgsql
stable
set search_path = public, extensions
as $$
declare
  s_id         uuid;
  s_dob        date;
  s_rtw_branch rtw_branch;
  s_share_code text;
  have doc_type[];
  missing text[] := '{}';
begin
  -- Named columns only: `authenticated` may not read staff.block_reason or
  -- staff.rejection_reason, so `select *` fails under the caller's rights.
  select id, dob, rtw_branch, share_code
    into s_id, s_dob, s_rtw_branch, s_share_code
    from staff where id = p_staff;
  if s_id is null then
    return null;
  end if;

  select coalesce(array_agg(d.doc_type), '{}') into have
    from current_compliance_docs(p_staff) d;

  if s_dob is null then
    missing := missing || 'dob'::text;             -- §2.5: mandatory in every branch
  end if;

  if s_rtw_branch is null then
    missing := missing || 'rtw_branch'::text;
  else
    case s_rtw_branch
      when 'uk_irish' then
        -- passport OR birth certificate + a document showing the NI number
        -- (List A; kept by ADR-0078)
        if not ('passport' = any(have)) then
          if 'birth_certificate' = any(have) then
            if not ('ni_evidence' = any(have)) then
              missing := missing || 'ni_evidence'::text;
            end if;
          else
            missing := missing || 'passport'::text;
          end if;
        end if;
      when 'eu_settled' then
        if not ('passport' = any(have) or 'national_id' = any(have)) then
          missing := missing || 'passport'::text;
        end if;
      when 'international_student' then
        if not ('passport' = any(have)) then missing := missing || 'passport'::text; end if;
        -- ADR-0112: a graduate uploads the completion letter INSTEAD. A
        -- rejected one answers nothing, so the term letter is owed again.
        if not ('university_term_dates_letter' = any(have))
           and not exists (select 1 from current_compliance_docs(p_staff) c
                            where c.doc_type = 'university_completion_letter'
                              and c.status <> 'rejected') then
          missing := missing || 'university_term_dates_letter'::text;
        end if;
      when 'work_visa', 'dependant_other' then
        -- The share code below is the visa evidence (ADR-0078).
        if not ('passport' = any(have)) then missing := missing || 'passport'::text; end if;
    end case;

    -- The share code is typed, never uploaded (§2.5), and every branch
    -- but the first carries one.
    if s_rtw_branch <> 'uk_irish' and s_share_code is null then
      missing := missing || 'share_code'::text;
    end if;
  end if;

  -- The declaration sits on the same step (4/11) and is part of the same
  -- single blocker (§2.10).
  if not exists (select 1 from criminal_declarations c
                  where c.staff_id = p_staff and not c.superseded) then
    missing := missing || 'criminal_declaration'::text;
  end if;

  return missing;
end $$;

comment on function public.onboarding_documents_missing(uuid) is
  '§2.5 points 1–5 as narrowed by ADR-0078: which of the branch''s required items have not been supplied at all (tokens: dob, rtw_branch, passport, ni_evidence — UK birth-certificate route only —, university_term_dates_letter, share_code, criminal_declaration). A student''s term letter is answered by a completion letter that has not been rejected (ADR-0112). No visa_document or status_document token for any branch. Empty = everything is in; whether it is verified is compliance_blockers().';

-- ---------------------------------------------------------------------
-- 3 · The quiz gate: no term letter, so the completion letter must carry it.
--
-- As 20260923191000, plus one clause. A student who has a completion letter
-- but no term letter has no term evidence at all; until that letter is
-- verified AND the course has completed (term_letter_applies() false) the
-- quiz stays shut, so the cap rests on something.
-- ---------------------------------------------------------------------
create or replace function public.onboarding_quiz_blockers(p_staff uuid)
returns text[]
language sql
stable
set search_path = public, extensions
as $$
  select coalesce(onboarding_documents_missing(p_staff), '{}')
         || coalesce((select array_agg(b.reason order by b.reason)
                        from compliance_blockers(p_staff, (now() at time zone 'Europe/London')::date) b),
                     '{}')
         || coalesce((select array['conviction_rejected']
                        from (select c.answer, c.review_status
                                from criminal_declarations c
                               where c.staff_id = p_staff
                                 and not c.superseded
                               order by c.declared_at desc, c.id desc
                               limit 1) c
                       where c.answer and c.review_status = 'rejected'),
                     '{}')
         || coalesce((select array['document_unverified:university_completion_letter']
                        from staff s
                       where s.id = p_staff
                         and s.rtw_branch = 'international_student'
                         and term_letter_applies(p_staff, (now() at time zone 'Europe/London')::date)
                         and not exists (select 1 from current_compliance_docs(p_staff) c
                                          where c.doc_type = 'university_term_dates_letter')
                         and exists (select 1 from current_compliance_docs(p_staff) c
                                      where c.doc_type = 'university_completion_letter'
                                        and c.status <> 'rejected')),
                     '{}')
$$;

comment on function public.onboarding_quiz_blockers(uuid) is
  'The §2.3 quiz gate as reasons: missing items, anything unverified or expired, a rejected Yes declaration (conviction_rejected) until a new one is verified, and — for a student with a completion letter and no term letter — that letter until it is verified and the course has completed (ADR-0112). Empty = the quiz unlocks.';

-- ---------------------------------------------------------------------
-- 1 · Submit: the same stand-in, so a graduate can press Submit.
--
-- As 20260923120000 §onboarding_submit_documents, except v_missing: the
-- term-letter requirement is also answered by a pending or verified
-- completion letter. Nothing else changes.
-- ---------------------------------------------------------------------
create or replace function public.onboarding_submit_documents(
  p_has_conviction  boolean,
  p_details         text,
  p_conviction_date date
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  s staff := onboarding_me();
  p onboarding_progress;
  v_missing text;
  v_details text := nullif(btrim(coalesce(p_details, '')), '');
  v_advanced boolean;
begin
  if s.status <> 'documents' then
    raise exception 'wrong_stage' using errcode = 'P0001';
  end if;
  select * into p from onboarding_progress where staff_id = s.id;
  if p.rtw_at is null or p.address_at is null or p.selfie_at is null then
    raise exception 'previous_step' using errcode = 'P0001';
  end if;
  if p.documents_at is not null then
    raise exception 'already_submitted' using errcode = 'P0001';
  end if;

  select r.req_key into v_missing
    from onboarding_required_docs(s.rtw_branch, p.uk_doc_choice) r
   where not exists (
     select 1 from current_compliance_docs(s.id) c
      where (c.doc_type = any (r.accepts)
             or (r.req_key = 'university_term_dates_letter'
                 and c.doc_type = 'university_completion_letter'))
        and c.status in ('pending', 'verified'))
   limit 1;
  if v_missing is not null then
    raise exception 'missing_document:%', v_missing using errcode = 'P0001';
  end if;

  if p_has_conviction is null then
    raise exception 'declaration_required' using errcode = 'P0001';
  end if;
  if p_has_conviction and v_details is null then
    raise exception 'details_required' using errcode = 'P0001';
  end if;
  if p_conviction_date is not null and p_conviction_date > onboarding_uk_today() then
    raise exception 'bad_conviction_date' using errcode = 'P0001';
  end if;

  -- The share code goes to gov.uk with the DOB (§2.6, ADR-0002). The row
  -- is the check's place in the office's queue until it is run.
  if s.rtw_branch <> 'uk_irish' then
    update compliance_docs set review_status = 'superseded'
     where staff_id = s.id and doc_type = 'share_code_report' and review_status = 'pending';
    insert into compliance_docs (staff_id, doc_type, share_code, needs_manual_review, review_status,
                                 uploaded_at)
    values (s.id, 'share_code_report', s.share_code, true, 'pending', clock_timestamp());
  end if;

  update onboarding_progress set documents_at = now(), updated_at = now() where staff_id = s.id;

  -- §2.10: No is verified the moment it is submitted and never enters the
  -- review queue; Yes is reviewed like a document. Filed as the answer
  -- only: criminal_declaration_no_is_verified (B5) verifies a No on the
  -- row, and onboarding_declaration_advance then runs the §2.3 gate — so
  -- an office that verified every upload before the worker pressed
  -- Submit moves them to Quiz right here, with no second rule in this file.
  insert into criminal_declarations (staff_id, source, answer, details, conviction_date)
  values (s.id, 'onboarding', p_has_conviction,
          case when p_has_conviction then v_details end,
          case when p_has_conviction then p_conviction_date end);

  select status = 'quiz' into v_advanced from staff where id = s.id;

  return jsonb_build_object('ok', true, 'advanced', v_advanced,
    'declarationStatus',
    (select c.review_status::text from criminal_declarations c
      where c.staff_id = s.id and not c.superseded
      order by c.declared_at desc, c.id desc limit 1));
end $$;

revoke execute on function public.onboarding_submit_documents(boolean, text, date) from public, anon;
grant  execute on function public.onboarding_submit_documents(boolean, text, date) to authenticated;

-- ---------------------------------------------------------------------
-- 4 · approve_completion_letter(): the term letter that no longer applies
--     is superseded in the same step.
--
-- As 20260923100100, plus the supersede between the staff update (which
-- writes graduated_at / course_completion_date, the facts
-- term_letter_applies() reads) and the flip to verified (which fires the
-- §4.3 re-check and the §2.3 advance). A verified term letter is left as
-- the evidence it was.
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
  'Completion letter requirement §2.2. The reviewer confirms the completion date and the visa expiry; the worker''s course_completion_date and graduated_at are written (the cap follows from RULE-20, from the completion date, never backdated) and right_to_work_until becomes the earlier of the two expiries. Once the term letter stops applying, a pending or rejected one is superseded (ADR-0112). Queues CL2 with the new cap and effective date, or the visa_first variant when the right to work ends first (§7).';

-- ---------------------------------------------------------------------
-- 5 · One-off: candidates already stuck the way the live case was.
--
-- International-student candidates in Documents whose term letter no longer
-- applies (verified completion letter, course completed) and who still
-- carry a pending or rejected term letter. Superseded, never deleted; then
-- the §2.3 gate for each one touched — onboarding_docs_advance fires on a
-- Verify only, so removing the last blocker would otherwise leave them in
-- Documents with nothing outstanding. The gate does nothing unless they
-- are in `documents` with no blocker left, and queues E12 (ADR-0075) when
-- it moves them.
-- ---------------------------------------------------------------------
do $$
declare
  r record;
  v_today date := (now() at time zone 'Europe/London')::date;
begin
  for r in
    select s.id
      from staff s
     where s.status = 'documents'
       and s.rtw_branch = 'international_student'
       and not term_letter_applies(s.id, v_today)
       and exists (select 1 from compliance_docs d
                    where d.staff_id = s.id
                      and d.doc_type = 'university_term_dates_letter'
                      and d.review_status in ('pending', 'rejected'))
  loop
    update compliance_docs
       set review_status = 'superseded'
     where staff_id = r.id
       and doc_type = 'university_term_dates_letter'
       and review_status in ('pending', 'rejected');
    perform onboarding_advance_if_ready(r.id);
  end loop;
end $$;
