-- =====================================================================
-- Migration 20261023130000 · the completion date is never typed (ADR-0187)
--
-- approve_completion_letter(doc, completion_date, visa_expiry) had the
-- reviewer type the course completion date (requirement §2.2 "confirms /
-- enters"). §4.5 says "nobody types a number — verifying the document is the
-- whole action", and the office asked (23.10.2026) that the system enter it.
--
-- Now:
--   · the date is the one the AI read off the letter (compliance_docs
--     .completion_date, written by record_document_extraction()), else the
--     one supplied with the upload (completion_date_claimed — the worker's,
--     or the office's own upload, D47). Neither → `completion_date_unreadable`:
--     the office rejects the letter with a reason asking for a clearer copy.
--   · approve_completion_letter(doc, visa_expiry) replaces the three-argument
--     function, which is dropped so no API caller can still pass a date.
--   · completion_letter_date(doc) tells the reviewer's dialog which date the
--     approval will use and where it came from.
-- Everything else is character for character 20261022155200.
-- =====================================================================

drop function if exists public.approve_completion_letter(uuid, date, date);

create or replace function public.approve_completion_letter(
  p_doc         uuid,
  p_visa_expiry date
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
  v_completion  date;
begin
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

  -- ADR-0187: nobody types the completion date. It is the one read off the
  -- letter (record_document_extraction writes it to completion_date), or the
  -- one supplied with the upload when the read found none.
  v_completion := coalesce(d.completion_date, d.completion_date_claimed);
  if v_completion is null then
    raise exception 'completion_date_unreadable' using errcode = 'P0001';
  end if;
  if v_completion < date '2000-01-01' or v_completion > v_today + interval '5 years' then
    raise exception 'completion_date_implausible' using errcode = 'P0001';
  end if;

  select * into s from staff where id = d.staff_id for update;
  if s.status in ('rejected', 'removed') or s.removed_at is not null then
    raise exception 'not_reviewable: %', s.status using errcode = 'P0001';
  end if;

  v_rtw := case when s.right_to_work_until is null then p_visa_expiry
                else least(s.right_to_work_until, p_visa_expiry) end;

  update staff
     set course_completion_date = v_completion,
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

  -- 20261022155200 (ADR-0183): one current completion letter, as for any
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
         completion_date = v_completion,
         confirmed_visa_expiry = p_visa_expiry
   where id = d.id;

  v_effective := completion_effective_from(v_completion, v_today);
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


comment on function public.approve_completion_letter(uuid, date) is
  'Completion letter requirement §2.2 as changed by ADR-0187. The reviewer confirms the visa expiry; the course completion date is never typed — it is the one read off the letter, else the one supplied with the upload (completion_date_unreadable when neither exists). graduated_at and course_completion_date are written (the cap follows from RULE-20, from the completion date, never backdated) and right_to_work_until becomes the earlier of the two expiries. Once the term letter stops applying, a pending or rejected one is superseded (ADR-0112). An earlier verified completion letter of the same worker is superseded (ADR-0183). Queues CL2 with the new cap and effective date, or the visa_first variant when the right to work ends first (§7).';

revoke execute on function public.approve_completion_letter(uuid, date) from public, anon;
grant  execute on function public.approve_completion_letter(uuid, date) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- The date an approval of this letter will use, for the reviewer's dialog.
-- ---------------------------------------------------------------------
create or replace function public.completion_letter_date(p_doc uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  d compliance_docs;
begin
  perform assert_reviewer();
  select * into d from compliance_docs where id = p_doc;
  if d.id is null or d.doc_type <> 'university_completion_letter' then
    raise exception 'not_a_completion_letter' using errcode = 'P0001';
  end if;
  return jsonb_build_object(
    'date',   coalesce(d.completion_date, d.completion_date_claimed),
    'source', case when d.completion_date is not null then 'letter'
                   when d.completion_date_claimed is not null then 'upload' end);
end $$;

comment on function public.completion_letter_date(uuid) is
  'ADR-0187: the course completion date approve_completion_letter() will apply — read off the letter, else supplied with the upload — and which of the two it is. Reviewer only.';

revoke execute on function public.completion_letter_date(uuid) from public, anon;
grant  execute on function public.completion_letter_date(uuid) to authenticated, service_role;
