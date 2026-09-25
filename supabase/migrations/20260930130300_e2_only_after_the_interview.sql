-- =====================================================================
-- Fix round 29.09 · WP-F · E2 only once the interview is done
-- (audit D44; §2.7, §8 E2 / E2b; ADR-0017, amended by ADR-0040)
--
-- E2 is THC's interview-rejection wording: "Thank you for taking the time
-- to complete your interview…". 20260923170000 sent it for every
-- rejection at the interview STAGE, including a candidate still at
-- Interview requested — who has not done the interview. For them the
-- first sentence is untrue, which is exactly why E2b exists.
--
-- So E2 needs the interview to have happened: the candidate is at
-- Interview completed, or Willo has recorded their response
-- (willo_completed_at). Everyone else — Interview requested with no
-- response, and every stage after the interview as before — gets E2b,
-- "E2 without the interview". Neither carries the office's reason.
--
-- Restated from 20260923170000; only v_template changes.
-- =====================================================================

create or replace function public.onboarding_do_reject(
  p_staff  uuid,
  p_cause  text,
  p_reason text,
  p_by     uuid,
  p_at     timestamptz
) returns void
language plpgsql
set search_path = public, extensions
as $$
declare
  s staff;
  v_template text;
begin
  select * into s from staff where id = p_staff for update;

  update staff
     set status = 'rejected',
         rejection_cause = p_cause,
         rejection_reason = p_reason,
         rejected_by = p_by,
         willo_decision = case when p_cause = 'willo' then 'rejected' else willo_decision end,
         willo_decided_at = case when p_cause = 'willo' then p_at else willo_decided_at end,
         willo_decided_via = case when p_cause = 'willo' then 'willo' else willo_decided_via end
   where id = p_staff;

  -- E2 thanks the candidate for completing their interview, so it goes
  -- only to a candidate who has: at Interview completed, or with a Willo
  -- response on file. A candidate rejected before doing it, and one
  -- rejected after the interview stage, get E2b (ADR-0017, ADR-0040).
  v_template := case
    when s.status = 'interview_completed'
      or (s.status = 'interview_requested' and s.willo_completed_at is not null)
      then 'E2'
    else 'E2b' end;
  insert into notification_outbox (key, channel, template, recipient_emails, payload)
  values (v_template || ':staff:' || p_staff || ':' || extract(epoch from s.onboarding_started_at)::bigint,
          'email', v_template, array[s.email], jsonb_build_object('name', s.first_name))
  on conflict (key) do nothing;

  -- §4.1: a rejected candidate's pending uploads drop out of Needs review
  -- because the queue excludes Rejected profiles — nothing to write here.
end $$;

comment on function public.onboarding_do_reject(uuid, text, text, uuid, timestamptz) is
  'The one rejection path for a candidate (office Reject, Willo, the quiz): status rejected with cause, reason and who; E2 only when the interview has been done (Interview completed, or a Willo response on file), E2b otherwise (ADR-0017, ADR-0040). The reason never goes to the candidate.';

revoke execute on function public.onboarding_do_reject(uuid, text, text, uuid, timestamptz) from public, anon, authenticated;
