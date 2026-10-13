-- =====================================================================
-- OC1 for existing staff: the Willo interview is part of moving to the
-- new app (an addition to ADR-0071; owner request, 12.10.2026)
--
-- THC's own staff (and SpudBros Express staff) are being brought onto the
-- new platform from the invite list (ADR-0107): they apply, Willo sends
-- them the interview (E1), and OC1 chases them daily until it is done.
-- OC1's wording was written for a new applicant ("Thanks for applying…"),
-- so somebody who already works with us reads it as a mistake, or as not
-- meant for them, and skips the interview. They need to be told plainly
-- that the Willo interview is part of moving onto the new app, and that
-- everyone does it, even people who already work with us.
--
-- So OC1 gains three more wordings, `existing_first`, `existing_second`
-- and `existing_repeat` (packages/notifications/src/templates.ts), and the
-- job picks them for an EXISTING member of staff, meaning one of:
--
--   · their application was matched to the invite list (audit_log
--     'roster.matched' with via 'list', 'list_over_link' or
--     'list_name_mismatch' — 20261008140000), or
--   · they were already here when a list was loaded and it was applied to
--     them ('roster.applied_existing'), or
--   · they carry a Payroll ID: the payroll sheet already knows them.
--
-- Not somebody only the link decided ('roster.matched' via 'link'):
-- /apply/spudbros is a public page, so it is no evidence of employment.
--
-- Nothing else changes: who is chased, when, how often (daily, never
-- stopping, 10:00–18:00 UK), the keys, OC2 and OC3. A new applicant keeps
-- the wording they had. The variant is decided when each reminder is
-- queued, so a Payroll ID set by the office mid-run switches the next one.
--
-- onboarding_chasers() is restated from 20261001212000 but for the OC1
-- payload's `variant`. pgTAP: supabase/tests/805_oc1_existing_staff.sql.
-- =====================================================================

-- Is this candidate somebody who already works with us, being brought onto
-- the new app? Internal: the job reads it.
create or replace function public.onboarding_chaser_existing_staff(p_staff uuid)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select exists (select 1 from staff s
                  where s.id = p_staff and s.payroll_id is not null)
      or exists (select 1 from audit_log a
                  where a.entity_id = p_staff
                    and a.entity = 'staff'
                    and (a.action = 'roster.applied_existing'
                         or (a.action = 'roster.matched'
                             and a.data ->> 'via' in ('list', 'list_over_link', 'list_name_mismatch'))));
$$;

comment on function public.onboarding_chaser_existing_staff(uuid) is
  'Existing staff moving onto the new app: matched to the invite list when they applied (roster.matched via list*), had a list applied to them (roster.applied_existing), or carry a Payroll ID. OC1 uses its existing_* wording for them. Internal: read by onboarding_chasers().';

revoke all on function public.onboarding_chaser_existing_staff(uuid) from public, anon, authenticated;

create or replace function public.onboarding_chasers(p_now timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_cfg        jsonb := onboarding_chaser_config();
  v_clock      time  := uk_local(p_now)::time;
  v_oc1        integer;
  v_oc3        integer;
  v_activation jsonb;
begin
  if not coalesce((v_cfg ->> 'enabled')::boolean, true) then
    return jsonb_build_object('skipped', 'disabled in settings.onboarding_chasers');
  end if;
  if v_clock < (v_cfg ->> 'from')::time or v_clock >= (v_cfg ->> 'until')::time then
    return jsonb_build_object('skipped', 'outside ' || (v_cfg ->> 'from') || '–'
                                         || (v_cfg ->> 'until') || ' UK');
  end if;

  if to_regclass('pg_temp._due') is not null then
    drop table _due;
  end if;
  create temporary table _due on commit drop as
    select c.*, s.email, s.first_name
      from onboarding_chaser_candidates(p_now) c
      join staff s on s.id = c.staff_id
     where c.due_rung is not null;

  -- Existing staff read that the interview is part of moving onto the new
  -- app (existing_first / existing_second / existing_repeat).
  with ins as (
    insert into notification_outbox (key, channel, template, recipient_staff_id, recipient_emails, payload)
    select 'OC1:staff:' || d.staff_id || ':' || d.epoch || ':' || d.due_rung,
           'email', 'OC1', d.staff_id, array[d.email],
           jsonb_build_object('name', d.first_name,
                              'variant', case when onboarding_chaser_existing_staff(d.staff_id)
                                              then 'existing_' else '' end
                                         || onboarding_chaser_variant(d.due_rung),
                              'rung', d.due_rung, 'at', p_now)
      from _due d
     where d.template = 'OC1' and coalesce(d.email, '') <> ''
    on conflict (key) do nothing
    returning 1
  ) select count(*) into v_oc1 from ins;

  with ins as (
    insert into notification_outbox (key, channel, template, recipient_staff_id, payload)
    select 'OC3:staff:' || d.staff_id || ':' || d.epoch || ':' || d.due_rung,
           'push', 'OC3', d.staff_id,
           jsonb_build_object('step', d.step, 'stepNo', d.step_no,
                              'variant', onboarding_chaser_variant(d.due_rung),
                              'rung', d.due_rung, 'at', p_now)
      from _due d
     where d.template = 'OC3'
    on conflict (key) do nothing
    returning 1
  ) select count(*) into v_oc3 from ins;

  -- OC2 needs a link minted outside the database: name them, queue nothing.
  select coalesce(jsonb_agg(jsonb_build_object(
           'staffId', d.staff_id::text,
           'userId',  s.user_id::text,
           'email',   d.email,
           'rung',    d.due_rung) order by d.progress_at), '[]'::jsonb)
    into v_activation
    from _due d
    join staff s on s.id = d.staff_id
   where d.template = 'OC2' and coalesce(d.email, '') <> '';

  return jsonb_build_object('oc1', v_oc1, 'oc3', v_oc3,
                            'oc2_due', jsonb_array_length(v_activation),
                            'activation', v_activation);
end $$;

comment on function public.onboarding_chasers(timestamptz) is
  'ADR-0071, the onboarding-chasers job: between settings.onboarding_chasers from/until (UK), queues the OC1 interview emails (existing staff moving onto the new app get the existing_* wording, 20261012123000) and OC3 wizard pushes due now, and returns the OC2 activation reminders due (staffId, userId, email, rung) for the Edge Function to mint a link for. Idempotent on the outbox key. Service role only.';

revoke all on function public.onboarding_chasers(timestamptz) from public, anon, authenticated;
grant execute on function public.onboarding_chasers(timestamptz) to service_role;
