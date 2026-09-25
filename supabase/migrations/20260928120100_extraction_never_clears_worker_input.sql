-- =====================================================================
-- Migration 20260928120100 · an empty extraction never clears what the
--                            worker entered (§2.6, ADR-0033)
--
-- record_document_extraction() wrote p_term_dates, p_completion and
-- p_institution straight onto the row. A read that found nothing — a
-- failed call, a timeout, a letter the model could not parse, all of which
-- the Claude extractor (ADR-0033) reports as confidence 0 with every field
-- null — therefore wiped the term dates, completion date and awarding
-- institution the worker typed on the Documents tab
-- (submit_completion_letter()). It was latent while documentExtractor()
-- returned null; it goes live the day ANTHROPIC_API_KEY is set.
--
-- The AI pre-fills, it never erases (§2.6): each of the three now keeps
-- the existing value when the extraction has none. The expiry and
-- right-to-work-until already did (coalesce). Restated from its latest
-- body, 20260928110300; nothing else changes. Grants are kept by
-- `create or replace`.
-- =====================================================================

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
                           then coalesce(p_term_dates, term_dates) else term_dates end,
         completion_date = case when doc_type = 'university_completion_letter'
                                then coalesce(p_completion, completion_date) else completion_date end,
         awarding_institution = case when doc_type = 'university_completion_letter'
                                     then coalesce(nullif(btrim(p_institution), ''), awarding_institution)
                                     else awarding_institution end,
         ai_extracted = p_raw,
         ai_confidence = p_confidence,
         needs_manual_review = v_manual,
         manual_review_reason = v_reason
   where id = p_doc;

  return jsonb_strip_nulls(jsonb_build_object(
    'ok', true, 'needsManualReview', v_manual, 'reason', v_reason));
end $$;

comment on function public.record_document_extraction(uuid, date, daterange[], date, text, numeric, jsonb) is
  '§2.6 AI seam, service role only: pre-fills, never verifies. p_expiry is the expiry — or, on a share code report, the right-to-work-until read off the gov.uk report (ADR-0002). The term letter keeps its 31 December expiry (§4.2) and, when every extracted range is already past, is flagged needs_manual_review with manual_review_reason "letter expired" (§4.2, 20260928110300). Pending rows only (20260923200000). A read that finds nothing never clears what the worker entered (20260928120100).';
