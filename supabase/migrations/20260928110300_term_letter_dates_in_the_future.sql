-- =====================================================================
-- Migration 20260928110300 · §4.2: an already-expired University Term
--                            Dates Letter is not accepted
--
-- "The AI must verify that the dates found in the document are in the
-- future, not the past — an already-expired letter is not accepted."
--
-- Nothing checked it. record_document_extraction() pre-filled the ranges
-- and a confidence; Verify (compliance_verify_document_as(), behind
-- compliance_verify_document()) accepted any pending
-- row whose doc_expires_on() was still ahead — and for a term letter that
-- is 31 December of the upload year whatever the letter prints
-- (ADR-0011), so a letter for a year that has already finished sailed
-- through Verify in September. ADR-0014 defers the extractor itself, not
-- this rule: it works on whatever dates are present, whoever entered
-- them.
--
-- The rule, once, as term_letter_expired(daterange[], date): every range
-- on the letter has ended before today. It mirrors termLetterDatesVerdict
-- in packages/domain/src/documents.ts (vectors: termLetter.vectors.json):
--
--   · judged on the letter's OWN ranges, not on the 31 December expiry;
--   · ALL of them — one Christmas holiday in the past with Easter and
--     summer still to come is a current letter;
--   · no ranges at all is NOT expired: the human reviews an unread letter
--     as before (needs_manual_review from the confidence);
--   · the printed dates are inclusive; the stored daterange is half-open
--     ([from, to + 1 day), toDaterangeLiteral in the Staff App), so "the
--     last day is before today" is upper(range) <= today here.
--
-- Two places apply it:
--   1. record_document_extraction(): a term letter whose extracted ranges
--      are all past is flagged needs_manual_review with the reason
--      "letter expired" (new column manual_review_reason), whatever the
--      confidence — a confident read of last year's letter is exactly
--      the case the sentence is about.
--   2. compliance_verify_document_as(), the one body of Verify since
--      20260928100000 (ADR-0025: the office wrapper passes
--      assert_reviewer(), the automated gov.uk check passes NULL):
--      refuses to verify a term letter whose effective ranges (the
--      reviewer's p_term_dates, else the row's) are all past —
--      term_letter_expired (P0001) with a hint — before any
--      staff.term_dates write. The reviewer rejects it and the worker
--      uploads the current one (§4.1 N8). Restated verbatim from
--      20260928100000 with only that check added; the public
--      compliance_verify_document() wrapper and the _as revoke are
--      main's, the wrapper untouched and the revoke repeated here.
--
-- Merge note: this file first landed restating the monolithic
-- compliance_verify_document() of 20260923200000. It is renumbered above
-- 20260928100000 and now restates that migration's _as body instead, so
-- the rtw_check_required gate, the reviewed_at stamp on a waiting
-- rtw_checks row and the system-actor audit name all survive.
-- =====================================================================

alter table public.compliance_docs
  add column if not exists manual_review_reason text;

comment on column public.compliance_docs.manual_review_reason is
  'Why the extraction set needs_manual_review beyond the confidence threshold — "letter expired" for a term letter whose dates are all past (§4.2, 20260928110300). Null when the flag is confidence only.';

-- ---------------------------------------------------------------------
-- 1 · The rule
-- ---------------------------------------------------------------------
create or replace function public.term_letter_expired(p_ranges daterange[], p_today date)
returns boolean
language sql
immutable
set search_path = public, extensions
as $$
  select p_ranges is not null
     and cardinality(p_ranges) > 0
     and not exists (
       select 1 from unnest(p_ranges) r
        where isempty(r)          -- an empty range says nothing either way
           or upper_inf(r)
           or upper(r) > p_today  -- half-open: the last day is upper - 1
     )
     and exists (select 1 from unnest(p_ranges) r where not isempty(r))
$$;

comment on function public.term_letter_expired(daterange[], date) is
  '§4.2: true when every holiday range on a University Term Dates Letter ended before p_today — "an already-expired letter is not accepted". Null or empty ranges are false (nothing to judge; the human reviews). Mirrors termLetterDatesVerdict() in packages/domain (termLetter.vectors.json).';

-- ---------------------------------------------------------------------
-- 2 · record_document_extraction(), from 20260923200000, flagging the
--     expired letter. Otherwise unchanged.
-- ---------------------------------------------------------------------
create or replace function public.record_document_extraction(
  p_doc          uuid,
  p_expiry       date,
  p_term_dates   daterange[],
  p_completion   date,
  p_institution  text,
  p_confidence   numeric,
  p_raw          jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  d compliance_docs;
  v_threshold numeric;
  v_manual boolean;
  v_reason text;
  v_today date := (now() at time zone 'Europe/London')::date;
begin
  select * into d from compliance_docs where id = p_doc for update;
  if d.id is null then
    raise exception 'unknown_document' using errcode = 'P0001';
  end if;
  if d.review_status <> 'pending' then
    -- A manager has already decided. The AI never overwrites a human.
    return jsonb_build_object('ok', true, 'skipped', true);
  end if;
  if p_confidence is not null and (p_confidence < 0 or p_confidence > 1) then
    raise exception 'bad_confidence' using errcode = 'P0001';
  end if;
  if p_expiry is not null and not isfinite(p_expiry) then
    raise exception 'bad_date' using errcode = 'P0001';
  end if;

  select (value #>> '{}')::numeric into v_threshold
    from settings where key = 'ai_confidence_threshold';
  v_manual := p_confidence is null or p_confidence < coalesce(v_threshold, 0.8);

  -- §4.2: a term letter whose dates are all in the past goes to a human
  -- with the reason on the row, however confident the read was.
  if d.doc_type = 'university_term_dates_letter'
     and term_letter_expired(p_term_dates, v_today) then
    v_manual := true;
    v_reason := 'letter expired';
  end if;

  update compliance_docs
     set expiry_date = case
                         when doc_type in ('university_term_dates_letter', 'share_code_report')
                           then expiry_date
                         else coalesce(p_expiry, expiry_date)
                       end,
         right_to_work_until = case when doc_type = 'share_code_report'
                                    then coalesce(p_expiry, right_to_work_until)
                                    else right_to_work_until end,
         term_dates = case when doc_type = 'university_term_dates_letter'
                           then p_term_dates else term_dates end,
         completion_date = case when doc_type = 'university_completion_letter'
                                then p_completion else completion_date end,
         awarding_institution = case when doc_type = 'university_completion_letter'
                                     then nullif(btrim(p_institution), '') else awarding_institution end,
         ai_extracted = p_raw,
         ai_confidence = p_confidence,
         needs_manual_review = v_manual,
         manual_review_reason = v_reason
   where id = p_doc;

  return jsonb_strip_nulls(jsonb_build_object(
    'ok', true, 'needsManualReview', v_manual, 'reason', v_reason));
end $$;

comment on function public.record_document_extraction(uuid, date, daterange[], date, text, numeric, jsonb) is
  '§2.6 AI seam, service role only: pre-fills, never verifies. p_expiry is the expiry — or, on a share code report, the right-to-work-until read off the gov.uk report (ADR-0002). The term letter keeps its 31 December expiry (§4.2) and, when every extracted range is already past, is flagged needs_manual_review with manual_review_reason "letter expired" (§4.2, 20260928110300). Pending rows only (20260923200000).';

-- ---------------------------------------------------------------------
-- 3 · compliance_verify_document_as(), from 20260928100000 (ADR-0025),
--     refusing the expired letter. Otherwise unchanged.
--
-- 20260928100000 moved the body of Verify into
-- compliance_verify_document_as(p_reviewer, …) so the automated gov.uk
-- check (reviewer NULL) and a manager's click (assert_reviewer()) run
-- exactly one body. The rule goes into that body — and only there:
-- the public compliance_verify_document() wrapper (rtw_check_required
-- gate + assert_reviewer()) is NOT restated, so main's refactor stands
-- as written. The refusal sits where it did in the monolithic version:
-- after the term_dates_invalid check, before any staff.term_dates write.
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
  -- ranges the reviewer is confirming (else the ones on the row), not on
  -- the 31 December doc_expires_on() gives every term letter
  -- (20260928110300).
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
  'The body of §4.1 Verify with the reviewer passed in (NULL = the automated gov.uk check, ADR-0025). Internal: compliance_verify_document() passes assert_reviewer(), rtw_check_record() passes NULL. Otherwise exactly 20260923200000''s compliance_verify_document() — plus, since 20260928110300, the §4.2 refusal: a University Term Dates Letter whose every holiday range (the reviewer''s p_term_dates, else the row''s) ended before today raises term_letter_expired (P0001) before any staff.term_dates write.';

-- Internal, as 20260928100000 leaves it: callable only from inside the
-- security definer functions that wrap it, by no role directly.
revoke execute on function public.compliance_verify_document_as(uuid, uuid, date, daterange[], date)
                                                                                      from public, anon, authenticated, service_role;

-- term_letter_expired is a pure rule; anyone who can read a row may ask it.
grant execute on function public.term_letter_expired(daterange[], date) to authenticated, service_role;
