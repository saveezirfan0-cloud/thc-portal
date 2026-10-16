-- =====================================================================
-- OC1 carries the interview's public link (ADR-0149; owner request,
-- 16.10.2026)
--
-- A candidate replied to the "Reminder: your video interview is still
-- waiting" email (OC1) saying they could not find any link. Willo sends the
-- invitation itself and nothing stores its URL (ADR-0071, "No Willo link in
-- OC1"), so a candidate whose invitation went to spam, or was deleted, had
-- nothing to click. The reminder could only say "look for the invitation
-- from Willo".
--
-- The interview has one public link, the same for everyone, which the
-- office copies out of Willo. A candidate who records through it arrives in
-- Willo as a second participant, and since ADR-0148 the webhook finds them
-- by their email (willo_relink_by_email), so they still move on the board.
--
-- So:
--   · `settings.willo_interview_public_url`, a JSON string, edited on
--     /settings next to the review-link template. No row = no link.
--   · `willo_interview_public_url()` reads it and returns it only if it is
--     one https URL on a single token (no spaces, no < > " ', at most 500
--     characters, no `@` before the first `/`: no user:password@). Anything else reads as not set, so a bad value
--     can never put an odd link in front of a candidate.
--   · onboarding_chasers() puts it in the OC1 payload as `interviewLink`
--     when there is one. The variant, keys, cadence, window and who is
--     chased do not change. Without a link the payload is as it was.
--   · packages/notifications adds the link and a button to the OC1 email,
--     only for a row that carries a valid `interviewLink`.
--
-- The link is public and identical for everybody, so it needs none of the
-- protection E3's and OC2's one-time links have.
--
-- onboarding_chasers() is restated from 20261012123000 but for the OC1
-- payload. pgTAP: supabase/tests/848_oc1_interview_link.sql.
-- =====================================================================

create or replace function public.willo_interview_public_url()
returns text
language sql
stable
security definer
set search_path = public, extensions
as $$
  select case
           when jsonb_typeof(s.value) = 'string'
            and (s.value #>> '{}') ~ '^https://[^/\s@]+(/\S*)?$'
            and (s.value #>> '{}') !~ '[<>"'']'
            and length(s.value #>> '{}') <= 500
           then s.value #>> '{}'
         end
    from settings s
   where s.key = 'willo_interview_public_url';
$$;

comment on function public.willo_interview_public_url() is
  'ADR-0149: the interview''s public Willo link from settings.willo_interview_public_url, or null when it is missing or not one https URL. Internal: read by onboarding_chasers().';

revoke all on function public.willo_interview_public_url() from public, anon, authenticated;

create or replace function public.onboarding_chasers(p_now timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_cfg        jsonb := onboarding_chaser_config();
  v_clock      time  := uk_local(p_now)::time;
  v_link       text  := willo_interview_public_url();
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
  -- app (existing_first / existing_second / existing_repeat). When the
  -- office has set the interview's public link, every OC1 carries it too.
  with ins as (
    insert into notification_outbox (key, channel, template, recipient_staff_id, recipient_emails, payload)
    select 'OC1:staff:' || d.staff_id || ':' || d.epoch || ':' || d.due_rung,
           'email', 'OC1', d.staff_id, array[d.email],
           jsonb_build_object('name', d.first_name,
                              'variant', case when onboarding_chaser_existing_staff(d.staff_id)
                                              then 'existing_' else '' end
                                         || onboarding_chaser_variant(d.due_rung),
                              'rung', d.due_rung, 'at', p_now)
             || case when v_link is not null
                     then jsonb_build_object('interviewLink', v_link)
                     else '{}'::jsonb end
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
  'ADR-0071, the onboarding-chasers job: between settings.onboarding_chasers from/until (UK), queues the OC1 interview emails (existing staff moving onto the new app get the existing_* wording, 20261012123000; each carries the interview''s public link when settings.willo_interview_public_url is set, 20261016120000) and OC3 wizard pushes due now, and returns the OC2 activation reminders due (staffId, userId, email, rung) for the Edge Function to mint a link for. Idempotent on the outbox key. Service role only.';

revoke all on function public.onboarding_chasers(timestamptz) from public, anon, authenticated;
grant execute on function public.onboarding_chasers(timestamptz) to service_role;
