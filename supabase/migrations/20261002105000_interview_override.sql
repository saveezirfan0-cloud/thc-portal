-- =====================================================================
-- Mark interview complete without Willo (ADR-0077; §2.4, BO4 phase 1)
--
-- §2.4 has the card leave Interview requested only on Willo's "New
-- Response" webhook. That leaves the office stuck when Willo cannot be
-- used for one person — a test candidate, a candidate interviewed in
-- person, a webhook that never arrived — so an owner or manager may now
-- take the same edge by hand: interview_requested → interview_completed.
--
-- Nothing else changes. The candidate lands where the webhook would have
-- put them, and the office's existing Accept (role pick + E3) or Reject
-- (E2) is the decision, exactly as after a real Willo interview. A later
-- Willo "New Response" for the same person is a no-op (willo_record_event
-- only moves interview_requested), so the two routes never fight.
--
-- Owner and manager only: schedulers and viewers are refused here (and a
-- viewer's audit write is refused by office_read_only besides). The reason
-- is mandatory and kept in audit_log with who did it, which the profile
-- shows on the Interview completed panel.
-- =====================================================================

create or replace function public.onboarding_mark_interview_complete(p_staff uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  s staff;
  v_name text;
begin
  perform assert_office_caller();
  select p.full_name into v_name
    from profiles p
   where p.id = auth.uid() and p.role = 'admin' and p.office_role in ('owner', 'manager');
  if not found then
    raise exception 'not_permitted' using errcode = '42501', detail = 'interview_override';
  end if;

  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'reason_required' using errcode = '22023';
  end if;

  select * into s from staff where id = p_staff for update;
  if s.id is null or s.removed_at is not null then
    raise exception 'unknown_staff' using errcode = 'P0002';
  end if;
  if s.status <> 'interview_requested' then
    raise exception 'not_awaiting_interview: %', s.status using errcode = 'P0001';
  end if;

  update staff
     set status = 'interview_completed',
         willo_completed_at = now()
   where id = p_staff;

  insert into audit_log (actor, action, entity, entity_id, data)
  values (auth.uid(), 'interview_marked_complete', 'staff', p_staff,
          jsonb_build_object('reason', btrim(p_reason), 'byName', v_name,
                             'fromStatus', s.status::text, 'staffId', p_staff::text));

  return jsonb_build_object('staffId', p_staff::text, 'status', 'interview_completed');
end $$;

comment on function public.onboarding_mark_interview_complete(uuid, text) is
  'ADR-0077: an owner or manager moves a candidate interview_requested → interview_completed without the Willo webhook, with a mandatory reason kept in audit_log (action interview_marked_complete). The office''s Accept / Reject then decides, as after a real interview.';

revoke execute on function public.onboarding_mark_interview_complete(uuid, text) from public, anon;
grant  execute on function public.onboarding_mark_interview_complete(uuid, text) to authenticated, service_role;
