-- =====================================================================
-- Migration 20261007130000 · a University Term Dates Letter expires
--                            where the letter does (§4.2, ADR-0103)
--
-- §4.2 gave the letter one expiry for everybody, 31 December, "regardless
-- of what dates are printed on it" (ADR-0011 moved a Nov/Dec upload to the
-- following 31 December). The office has now asked for the opposite, for
-- two reasons that are the same reason: the system always needs a valid
-- letter, and a rule keyed to the calendar chases a student for a letter
-- they already hold while saying nothing about one that is about to run
-- out.
--
-- The rule now:
--
--   · the letter expires on the LAST DAY PRINTED ON IT — the latest end of
--     the date ranges on the letter (the extractor's, or the reviewer's
--     "+ Add period"), inclusive;
--   · everything downstream is unchanged and automatic: the ladder
--     (N1 a month out, N2 two weeks, N3 one week, N4 on the day, §4.2),
--     the automatic block on the expiry day (§4.3), the Radar, the
--     Documents tab. They all read doc_expires_on(), so they follow;
--   · a letter with NO readable dates keeps the old calendar rule as a
--     fallback (31 December of the upload year, the following one if
--     uploaded in November or December). A letter must always have an
--     expiry, or "we always need a valid letter" is unenforceable for
--     exactly the letters nobody has read yet.
--
-- Unchanged on purpose: the printed graduation / course end date is still
-- not the expiry; a verified completion letter still stops the ladder
-- (term_letter_applies(), §4.5); an already-expired letter is still
-- refused on its own ranges (term_letter_expired(), 20260928110300).
--
-- doc_expires_on() grows a sixth argument, the letter's ranges. Its
-- five-argument form stays (a thin wrapper that passes none, so it gives
-- the fallback) because the AI pre-fill calls it before any ranges exist;
-- the five callers that hold a real document row are restated here to pass
-- the ranges:
--
--   current_verified_docs()      the ladder, the block, the Radar
--   student_visa_v               term_letter_expires_at
--   staff_documents_v            /staff/:id and /onboarding/:id Documents
--   staff_documents()            the worker's Documents tab
--   compliance_verify_document_as()   Verify: the "already expired" check
--
-- Each is restated from its latest definition with ONLY that call changed.
-- create or replace keeps every grant and revoke.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1 · The last day printed on a letter.
--
-- Stored ranges are half-open ([from, to + 1 day), toDaterangeLiteral in
-- the Staff App), so the printed last day is upper(range) - 1. Null when
-- there are no ranges, or none that are bounded (Verify rejects those, but
-- a pending row is not yet checked).
-- ---------------------------------------------------------------------
create or replace function public.term_letter_last_day(p_ranges daterange[])
returns date
language sql
immutable
set search_path = public, extensions
as $$
  select max(upper(r) - 1)
    from unnest(p_ranges) r
   where not isempty(r) and not upper_inf(r)
$$;

comment on function public.term_letter_last_day(daterange[]) is
  '§4.2 / ADR-0103: the last day printed on a University Term Dates Letter — the latest end of its date ranges, inclusive. Null when there are none to read. It is the letter''s expiry. Mirrors termLetterLastDay in packages/domain/src/documents.ts.';

-- ---------------------------------------------------------------------
-- 2 · doc_expires_on(), six arguments.
--
-- Same cases as ever; only the term letter changes (see the header). The
-- share code and the everything-else cases are character for character
-- what 20260921170411 had.
-- ---------------------------------------------------------------------
create or replace function public.doc_expires_on(
  p_doc_type    doc_type,
  p_expiry      date,
  p_doc_rtw     date,
  p_staff_rtw   date,
  p_uploaded_at timestamptz,
  p_term_dates  daterange[]
) returns date
language sql
immutable
set search_path = public, extensions
as $$
  with up as (
    select (p_uploaded_at at time zone 'Europe/London')::date as d
  )
  select case p_doc_type
    when 'university_term_dates_letter' then
      coalesce(
        term_letter_last_day(p_term_dates),
        -- No readable dates: the calendar rule of ADR-0011.
        (select make_date(
           extract(year from d)::int + case when extract(month from d) >= 11 then 1 else 0 end,
           12, 31)
           from up))
    when 'share_code_report' then coalesce(p_doc_rtw, p_staff_rtw, p_expiry)
    else p_expiry
  end
$$;

comment on function public.doc_expires_on(doc_type, date, date, date, timestamptz, daterange[]) is
  '§4.2 effective expiry. A term letter expires on the last day printed on it (ADR-0103) — or, when no dates could be read, on 31 December of the upload year (the following one if uploaded in November or December, ADR-0011). The share code report uses right_to_work_until from the doc or the worker; everything else uses expiry_date.';

-- The five-argument form: no letter dates known, so a term letter gets the
-- fallback. Kept for the AI pre-fill, which runs before there are ranges.
create or replace function public.doc_expires_on(
  p_doc_type    doc_type,
  p_expiry      date,
  p_doc_rtw     date,
  p_staff_rtw   date,
  p_uploaded_at timestamptz
) returns date
language sql
immutable
set search_path = public, extensions
as $$
  select doc_expires_on(p_doc_type, p_expiry, p_doc_rtw, p_staff_rtw, p_uploaded_at,
                        null::daterange[])
$$;

comment on function public.doc_expires_on(doc_type, date, date, date, timestamptz) is
  '§4.2 effective expiry with no term letter dates supplied — so a term letter gets the 31 December fallback. Callers holding a document row pass its term_dates to the six-argument form (ADR-0103).';

-- ---------------------------------------------------------------------
-- 2b · The pre-fill and the AI's own comment still said "31 December".
-- ---------------------------------------------------------------------
comment on function public.record_document_extraction(uuid, date, daterange[], date, text, numeric, jsonb) is
  '§2.6 AI seam, service role only: pre-fills, never verifies. p_expiry is the expiry — or, on a share code report, the right-to-work-until read off the gov.uk report (ADR-0002). A term letter expires on the last date printed on it, which is the latest of the ranges extracted here (ADR-0103); with none read it falls back to 31 December. When every extracted range is already past it is flagged needs_manual_review with manual_review_reason "letter expired" (§4.2, 20260928110300). Pending rows only (20260923200000).';


-- 3 · current_verified_docs(), from 20260921170411: the one the ladder, the block
--     and the Radar all read. Only the call changes.
create or replace function public.current_verified_docs(p_staff uuid)
returns table (
  doc_id     uuid,
  doc_type   doc_type,
  expires_on date
)
language sql
stable
set search_path = public, extensions
as $$
  select distinct on (d.doc_type)
         d.id,
         d.doc_type,
         doc_expires_on(d.doc_type, d.expiry_date, d.right_to_work_until,
                        s.right_to_work_until, d.uploaded_at, d.term_dates)
    from compliance_docs d
    join staff s on s.id = d.staff_id
   where d.staff_id = p_staff
     and d.review_status = 'verified'
   order by d.doc_type, d.uploaded_at desc, d.id
$$;

-- 4 · student_visa_v, from 20260923100100.
create or replace view student_visa_v with (security_invoker = true) as
select
  d.id,
  d.display_name,
  d.employee_id,
  d.photo_path,
  d.status,
  d.weekly_cap_hours,
  d.weekly_cap_band,
  d.weekly_booked_hours,
  d.right_to_work_until,
  d.graduated_at,
  d.wtr_optout,
  (select max(c.reviewed_at) from compliance_docs c
    where c.staff_id = d.id and c.doc_type = 'university_term_dates_letter'
      and c.review_status = 'verified')                      as term_letter_verified_at,
  (select max(doc_expires_on(c.doc_type, c.expiry_date, c.right_to_work_until,
                             d.right_to_work_until, c.uploaded_at, c.term_dates))
     from compliance_docs c
    where c.staff_id = d.id and c.doc_type = 'university_term_dates_letter'
      and c.review_status = 'verified')                      as term_letter_expires_at,
  (select max(c.reviewed_at) from compliance_docs c
    where c.staff_id = d.id and c.doc_type = 'university_completion_letter'
      and c.review_status = 'verified')                      as completion_letter_verified_at,
  exists (select 1 from compliance_docs c
           where c.staff_id = d.id and c.doc_type = 'university_completion_letter'
             and c.review_status = 'pending')                as completion_letter_in_review,
  -- ---- appended by 20260923100100 --------------------------------------
  s.below_degree_level,
  s.course_completion_date,
  (select c.review_status::text from compliance_docs c
    where c.staff_id = d.id and c.doc_type = 'university_completion_letter'
      and c.review_status <> 'superseded'
    order by c.uploaded_at desc, c.id desc limit 1)          as completion_letter_status,
  (select c.rejection_reason from compliance_docs c
    where c.staff_id = d.id and c.doc_type = 'university_completion_letter'
      and c.review_status <> 'superseded'
    order by c.uploaded_at desc, c.id desc limit 1)          as completion_letter_rejection,
  (select c.completion_date_claimed from compliance_docs c
    where c.staff_id = d.id and c.doc_type = 'university_completion_letter'
      and c.review_status = 'pending'
    order by c.uploaded_at desc limit 1)                     as completion_date_claimed,
  case when s.course_completion_date is not null and s.graduated_at is not null
       then completion_effective_from(s.course_completion_date, s.graduated_at) end
                                                             as completion_effective_from,
  s.wtr_optout_cancelled_from,
  s.dob is not null
    and (s.dob + interval '18 years')::date <= (now() at time zone 'Europe/London')::date
                                                             as optout_eligible,
  (d.right_to_work_until - (now() at time zone 'Europe/London')::date)
                                                             as rtw_days_left
from staff_directory_v d
join staff s on s.id = d.id
where d.rtw_branch = 'international_student'
  and not d.removed;

-- 5 · staff_documents_v, from 20261002103000.
create or replace view staff_documents_v with (security_invoker = true) as
select
  c.id,
  c.staff_id,
  c.doc_type,
  doc_label(c.doc_type)                                      as doc_label,
  c.review_status,
  c.review_status = 'superseded'                             as superseded,
  c.file_path,
  c.uploaded_at,
  c.expiry_date,
  doc_expires_on(c.doc_type, c.expiry_date, c.right_to_work_until,
                 s.right_to_work_until, c.uploaded_at, c.term_dates) as expires_on,
  c.ai_confidence,
  c.needs_manual_review,
  c.rejection_reason,
  c.reviewed_at,
  p.full_name                                                as reviewed_by_name,
  c.share_code,
  c.gov_report_path,
  c.right_to_work_until,
  c.term_dates,
  c.completion_date,
  c.awarding_institution,
  -- Appended (20260924130300): a create-or-replace view may only add
  -- columns at the end.
  c.rtw_no_time_limit,
  -- Appended (20260930130500).
  c.ni_recheck,
  -- Appended (20261002103000): the three keys, never the raw answer.
  case
    when c.doc_type = 'university_term_dates_letter'
     and jsonb_typeof(c.ai_extracted -> 'termLetter') = 'object'
    then jsonb_build_object(
           'courseStart',    c.ai_extracted #>> '{termLetter,courseStart}',
           'courseEnd',      c.ai_extracted #>> '{termLetter,courseEnd}',
           'hoursStatement', left(c.ai_extracted #>> '{termLetter,hoursStatement}', 250))
  end                                                        as ai_term_letter
from compliance_docs c
join staff s on s.id = c.staff_id
left join profiles p on p.id = c.reviewed_by;

-- 6 · staff_documents(), from 20260923150000: the worker's Documents tab.
create or replace function public.staff_documents(p_staff uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_me    uuid := staff_caller(p_staff);
  s       staff;
  v_today date := (now() at time zone 'Europe/London')::date;
  v_cap   cap_assessment;
  v_docs  jsonb;
  v_decl  jsonb;
begin
  if v_me is null then
    raise exception 'not_a_worker' using errcode = '42501';
  end if;
  select * into s from staff where id = v_me;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id',                    d.id::text,
           'docType',               d.doc_type::text,
           'label',                 doc_label(d.doc_type),
           'reviewStatus',          d.review_status::text,
           'uploadedAt',            d.uploaded_at,
           'reviewedAt',            d.reviewed_at,
           'expiresOn',             doc_expires_on(d.doc_type, d.expiry_date, d.right_to_work_until,
                                                   s.right_to_work_until, d.uploaded_at,
                                                   d.term_dates),
           'rejectionReason',       case when d.review_status = 'rejected' then d.rejection_reason end,
           'evidenceForm',          d.evidence_form,
           'completionDateClaimed', d.completion_date_claimed,
           'completionDate',        d.completion_date,
           -- The last three characters, which is what the worker needs to
           -- recognise the code they typed; the whole code is the office's.
           'shareCodeTail',         case when d.share_code is not null then right(d.share_code, 3) end,
           'hasFile',               d.file_path is not null,
           'isCurrent',             exists (select 1 from current_compliance_docs(v_me) c
                                             where c.doc_id = d.id),
           'isCountedVerified',     exists (select 1 from current_verified_docs(v_me) c
                                             where c.doc_id = d.id))
           order by d.doc_type, d.uploaded_at desc, d.id), '[]'::jsonb)
    into v_docs
    from compliance_docs d
   where d.staff_id = v_me;

  -- No `details`, no `conviction_date`, no `review_note`. §10.7.
  select coalesce(jsonb_agg(jsonb_build_object(
           'id',           c.id::text,
           'source',       c.source::text,
           'answer',       c.answer,
           'declaredAt',   c.declared_at,
           'reviewStatus', c.review_status::text,
           'superseded',   c.superseded)
           order by c.declared_at desc, c.id desc), '[]'::jsonb)
    into v_decl
    from criminal_declarations c
   where c.staff_id = v_me;

  v_cap := weekly_cap_for(v_me, v_today);

  return jsonb_build_object(
    'staffId',              v_me::text,
    'today',                v_today,
    'status',               s.status::text,
    'blockKind',            s.block_kind::text,
    'rtwBranch',            s.rtw_branch::text,
    'dob',                  s.dob,
    'rightToWorkUntil',     s.right_to_work_until,
    'graduatedAt',          s.graduated_at,
    'courseCompletionDate', s.course_completion_date,
    'termLetterApplies',    term_letter_applies(v_me, v_today),
    'missing',              to_jsonb(coalesce(onboarding_documents_missing(v_me), '{}'::text[])),
    'documents',            v_docs,
    'declarations',         v_decl,
    'cap', jsonb_build_object(
      'hours', v_cap.cap_hours,
      'band',  v_cap.band::text,
      'label', cap_band_label(v_cap.band),
      'until', case when v_cap.band in ('student_term_10', 'student_term_20', 'student_holiday_48')
                    then cap_band_until(s.term_dates, v_today) end),
    'optOut', jsonb_build_object(
      'signed',        coalesce(s.wtr_optout, false),
      'signedAt',      s.wtr_optout_signed_at,
      'noticeDays',    s.wtr_optout_notice_days,
      'cancelledFrom', s.wtr_optout_cancelled_from,
      'hasSignedCopy', s.wtr_optout_copy_path is not null));
end $$;

-- 7 · compliance_verify_document_as(), from 20260928110300.
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
  v_ranges   daterange[];
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

  -- §4.2: "an already-expired letter is not accepted". Judged on the
  -- ranges the reviewer is confirming (else the ones on the row)
  -- (20260928110300). Those same ranges now also give the letter its
  -- expiry, below (ADR-0103).
  if d.doc_type = 'university_term_dates_letter' then
    v_ranges := coalesce(p_term_dates, d.term_dates);
    if term_letter_expired(v_ranges, v_today) then
      raise exception 'term_letter_expired: every term date on this letter is before %', v_today
        using errcode = 'P0001',
              hint = 'An already-expired University Term Dates Letter is not accepted (§4.2). Reject it and ask the worker for the current year''s letter.';
    end if;
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
    -- A term letter expires on the last day the reviewer is confirming it
    -- for (ADR-0103), so the ranges they typed count, not only the row's.
    v_expires := doc_expires_on(d.doc_type, v_expiry, v_rtw, s.right_to_work_until, d.uploaded_at,
                                coalesce(p_term_dates, d.term_dates));
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

  -- A person decided the document: a check that was waiting on the office
  -- for it has its answer, and must not linger in Needs review.
  if v_reviewer is not null then
    update rtw_checks
       set reviewed_at = now(), reviewed_by = v_reviewer
     where compliance_doc_id = d.id and status = 'needs_review' and reviewed_at is null;
  end if;

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
  'The body of §4.1 Verify with the reviewer passed in (NULL = the automated gov.uk check, ADR-0025). Internal: compliance_verify_document() passes assert_reviewer(), rtw_check_record() passes NULL. Otherwise exactly 20260923200000''s compliance_verify_document() — plus, since 20260928110300, the §4.2 refusal: a University Term Dates Letter whose every holiday range (the reviewer''s p_term_dates, else the row''s) ended before today raises term_letter_expired (P0001) before any staff.term_dates write. Since 20261007130000 those same ranges give the letter its expiry (ADR-0103).';

grant execute on function public.term_letter_last_day(daterange[]) to authenticated, service_role;
