-- =====================================================================
-- Migration 20261022155300 · correcting a verified term letter's periods
--                            moves its reminders and says the new limit
--                            once (ADR-0183, building on ADR-0178)
--
-- set_term_letter_periods() (20261022145000, ADR-0178) replaces the
-- holiday ranges on a verified University Term Dates Letter. The cap and
-- the expiry are read from the ranges, so both follow. Three things did
-- not, and are added here — restated from that body, with only these
-- changes:
--
--   1 · The reminder ladder's RECEIPTS. The ladder is keyed per document per
--       rung (N1..N4:doc:<id>, compliance_daily); a rung sent for the old
--       expiry would stop the same rung ringing for the new one. When the
--       expiry moves, the unsent rungs for the old date are dropped and the
--       sent ones re-keyed (…:until:<old expiry>:<id>) — kept as history.
--       A rung the outbox drain has claimed (outbox_row_leased) is in flight:
--       re-keyed, never deleted. The same last day touches no receipt.
--   2 · N14 at once when the worker's band for this week changes
--       (cap_band_notify_now, 20261022155100): the same key, payload and
--       receipt as compliance_daily, so it is sent once.
--   3 · A period longer than a year is refused (term_dates_implausible,
--       term_letter_periods_problem, 20261022155000), as on Verify.
--   And an expiry block the old ranges caused comes off through the §4.3
--   re-check (unblock_if_compliant) — never a manual one. The function
--   still refuses to leave the letter expired, so this only ever lifts.
--
-- Same signature, same permission (assert_reviewer; a viewer meets
-- office_read_only); create or replace keeps the grants.
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
  v_before   date;
  v_ladder   int := 0;
  v_lifted   boolean := false;
  v_n14      boolean;
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
  -- 20261022155300: a period longer than a year is a typed year.
  if term_letter_periods_problem(v_ranges) = 'term_dates_implausible' then
    raise exception 'term_dates_implausible: a holiday period on this letter runs for more than a year'
      using errcode = '22023';
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
  v_before := doc_expires_on(d.doc_type, d.expiry_date, d.right_to_work_until,
                             s.right_to_work_until, d.uploaded_at, d.term_dates);

  update compliance_docs set term_dates = v_ranges where id = d.id;
  update staff set term_dates = v_ranges where id = s.id;

  -- 20261022155300: the ladder follows the new expiry (see the header).
  if v_expires is distinct from v_before then
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
  values (now(), v_reviewer, 'term_letter.periods_changed', 'compliance_docs', d.id,
          jsonb_build_object(
            'staffId',       s.id,
            'employeeId',    s.employee_id,
            'before',        to_jsonb(coalesce(d.term_dates, '{}')::text[]),
            'after',         to_jsonb(v_ranges::text[]),
            'expiresOn',     v_expires,
            'expiresBefore', v_before,
            'ladderReset',   v_ladder,
            'actorName',     (select full_name from profiles where id = v_reviewer)));

  -- 20261022155300: an expiry block the old ranges caused comes off through
  -- the §4.3 re-check; a manual block is a manager's to lift.
  if s.status = 'blocked' then
    v_lifted := unblock_if_compliant(s.id, v_today);
  end if;
  v_n14 := cap_band_notify_now(s.id, v_today);

  return jsonb_build_object(
    'docId',         d.id::text,
    'staffId',       s.id::text,
    'periods',       cardinality(v_ranges),
    'expiresOn',     v_expires,
    'expiresBefore', v_before,
    'unblocked',     v_lifted,
    'capNotified',   v_n14);
end $$;

comment on function public.set_term_letter_periods(uuid, daterange[]) is
  'ADR-0178, ADR-0183: replaces the holiday ranges on a VERIFIED University Term Dates Letter and the worker''s copy (staff.term_dates). Same range checks as verify, a period over a year refused; refuses a change that would leave the letter expired. The RULE-20 cap and the ADR-0103 expiry follow from the ranges; when the expiry moves, the ladder''s receipts for the old date are dropped (unsent, unclaimed) or re-keyed (sent, failed, in flight); an expiry block is lifted through unblock_if_compliant; N14 at once on a band change. Audited.';
