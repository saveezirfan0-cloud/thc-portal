-- =====================================================================
-- Migration 20261022145000 · a verified term letter's holiday periods can
-- be corrected by hand (ADR-0178)
--
-- The University Term Dates Letter's holiday ranges drive RULE-20 (48 h in
-- the holidays, 20 h / 10 h in term) and, since ADR-0103, the letter's own
-- expiry. They were editable only while the letter was pending: the
-- reviewer's "+ Add period" fed verify_document(). Once verified they were
-- frozen, so a vacation the AI did not read — and the reviewer missed —
-- left the worker on the term-time cap for the whole of it, with no way
-- back short of a fresh upload.
--
-- set_term_letter_periods() replaces the ranges on the worker's CURRENT
-- verified letter, under the same checks verify gives them:
--   * every range bounded and non-empty (term_dates_invalid);
--   * the letter not left expired by the new ranges (§4.2's
--     term_letter_expired(), and its ADR-0103 expiry still after today):
--     term_periods_expire_letter — a correction never back-dates a letter
--     into a block;
--   * the worker's own copy (staff.term_dates) follows, as at verify.
-- The cap and the expiry are read from the ranges (RULE-20, ADR-0103), so
-- both follow from this moment; nothing booked is re-judged or removed.
-- Audited as term_letter.periods_changed with the ranges before and after.
-- =====================================================================

create or replace function public.set_term_letter_periods(p_doc uuid, p_term_dates daterange[])
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_reviewer uuid := assert_reviewer();
  v_today    date := (now() at time zone 'Europe/London')::date;
  d          compliance_docs;
  s          staff;
  v_ranges   daterange[] := coalesce(p_term_dates, '{}');
  v_expires  date;
begin
  select * into d from compliance_docs where id = p_doc for update;
  if d.id is null then
    raise exception 'document_not_found' using errcode = 'P0002';
  end if;
  if d.doc_type <> 'university_term_dates_letter' then
    raise exception 'not_a_term_letter' using errcode = 'P0001';
  end if;
  if d.review_status <> 'verified' then
    raise exception 'term_letter_not_verified: %', d.review_status using errcode = 'P0001',
      hint = 'A pending letter''s periods are confirmed with Verify.';
  end if;

  select * into s from staff where id = d.staff_id for update;
  if s.removed_at is not null then
    raise exception 'not_reviewable: removed' using errcode = 'P0001';
  end if;

  if exists (select 1 from unnest(v_ranges) r where isempty(r) or lower_inf(r) or upper_inf(r)) then
    raise exception 'term_dates_invalid' using errcode = '22023';
  end if;
  if term_letter_expired(v_ranges, v_today) then
    raise exception 'term_periods_expire_letter: every range is before %', v_today
      using errcode = 'P0001';
  end if;
  v_expires := doc_expires_on(d.doc_type, d.expiry_date, d.right_to_work_until,
                              s.right_to_work_until, d.uploaded_at, v_ranges);
  if v_expires is not null and v_expires <= v_today then
    raise exception 'term_periods_expire_letter: %', v_expires using errcode = 'P0001';
  end if;

  update compliance_docs set term_dates = v_ranges where id = d.id;
  update staff set term_dates = v_ranges where id = s.id;

  insert into audit_log (at, actor, action, entity, entity_id, data)
  values (now(), v_reviewer, 'term_letter.periods_changed', 'compliance_docs', d.id,
          jsonb_build_object(
            'staffId',    s.id,
            'employeeId', s.employee_id,
            'before',     to_jsonb(coalesce(d.term_dates, '{}')::text[]),
            'after',      to_jsonb(v_ranges::text[]),
            'expiresOn',  v_expires,
            'actorName',  (select full_name from profiles where id = v_reviewer)));

  return jsonb_build_object(
    'docId',     d.id::text,
    'staffId',   s.id::text,
    'periods',   cardinality(v_ranges),
    'expiresOn', v_expires);
end $$;

comment on function public.set_term_letter_periods(uuid, daterange[]) is
  'ADR-0178: replaces the holiday ranges on a VERIFIED University Term Dates Letter and the worker''s copy (staff.term_dates). Same range checks as verify; refuses a change that would leave the letter expired. The RULE-20 cap and the ADR-0103 expiry follow from the ranges. Audited.';

revoke execute on function public.set_term_letter_periods(uuid, daterange[]) from public, anon;
grant execute on function public.set_term_letter_periods(uuid, daterange[]) to authenticated;
