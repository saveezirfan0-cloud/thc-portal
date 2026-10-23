-- =====================================================================
-- Migration 20261025100000 · a passport's expiry can be set after Verify
--                             (ADR-0201)
--
-- THC (Sam Barrington-Wells, 23.10.2026): "A candidate should not be able to
-- progress through the system without a passport expiry date being in place
-- - either entered manually or automatically through AI. We cannot afford to
-- have staff members on the system who do not have a Passport expiry date
-- which is being monitored, and blocked if it becomes out of date."
--
-- The Back Office now refuses to Verify a passport with no expiry
-- (apps/office, ADR-0201). Passports verified BEFORE that — the AI read no
-- date and Verify took none — have no expiry on file, so the daily job
-- never reminds or blocks them (doc_expires_on() reads compliance_docs.
-- expiry_date for a passport). This is the office's way to put the date on
-- one:
--
--   set_passport_expiry(doc, expiry)
--       An office login (assert_reviewer(); a viewer is refused by the
--       read-only guard on compliance_docs) sets the expiry of a PENDING or
--       VERIFIED passport. A date that has already passed is refused
--       (already_expired: an out-of-date passport is Rejected and
--       re-uploaded, not dated), and so is one more than 15 years away
--       (passport_expiry_implausible: a typed year). Not a removed or
--       rejected profile. Audited as document.expiry_set with the date
--       before and after and the actor's name; the N1-N4 reminder ladder
--       and the automatic block on the day are the existing daily job
--       reading the new date.
--
-- Forward-only. Closed to anon and PUBLIC; pgTAP 931 and 892.
-- =====================================================================

create or replace function public.set_passport_expiry(p_doc uuid, p_expiry date)
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
begin
  if p_expiry is null or not isfinite(p_expiry) then
    raise exception 'date_invalid' using errcode = '22023';
  end if;

  select * into d from compliance_docs where id = p_doc for update;
  if d.id is null then
    raise exception 'document_not_found' using errcode = 'P0002';
  end if;
  if d.doc_type <> 'passport' then
    raise exception 'not_a_passport' using errcode = 'P0001';
  end if;
  if d.review_status not in ('pending', 'verified') then
    raise exception 'not_pending: %', d.review_status using errcode = 'P0001';
  end if;

  select * into s from staff where id = d.staff_id for update;
  if s.status in ('rejected', 'removed') or s.removed_at is not null then
    raise exception 'not_reviewable: %', s.status using errcode = 'P0001';
  end if;

  if p_expiry <= v_today then
    raise exception 'already_expired: %', p_expiry using errcode = 'P0001';
  end if;
  if p_expiry > v_today + interval '15 years' then
    raise exception 'passport_expiry_implausible: %', p_expiry using errcode = 'P0001';
  end if;

  update compliance_docs set expiry_date = p_expiry where id = d.id;

  insert into audit_log (at, actor, action, entity, entity_id, data)
  values (now(), v_reviewer, 'document.expiry_set', 'compliance_docs', d.id,
          jsonb_strip_nulls(jsonb_build_object(
            'staffId',      s.id,
            'employeeId',   s.employee_id,
            'docType',      d.doc_type::text,
            'expiryBefore', d.expiry_date,
            'expiryAfter',  p_expiry,
            'actorName',    (select full_name from profiles where id = v_reviewer))));

  return jsonb_build_object('ok', true, 'documentId', d.id::text, 'expiry', p_expiry);
end $$;

comment on function public.set_passport_expiry(uuid, date) is
  'ADR-0201: the office sets the expiry of a pending or verified passport (a future date, at most 15 years out), audited as document.expiry_set. The daily job then reminds and blocks from it (§4.2, §4.3). assert_reviewer(); a viewer is refused by the read-only guard. Closed to anon and PUBLIC.';

revoke all on function public.set_passport_expiry(uuid, date) from public, anon;
grant execute on function public.set_passport_expiry(uuid, date) to authenticated, service_role;
