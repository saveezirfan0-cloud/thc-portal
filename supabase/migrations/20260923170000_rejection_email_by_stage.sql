-- =====================================================================
-- Rejection email by stage (§2.7, §8 E2 / E2b)
--
-- 20260923110000 sent E2 for every rejection. E2 is THC's contractual
-- INTERVIEW-rejection copy ("Thank you for taking the time to complete
-- your interview…"), and §2.7 fixes it for every route that rejects at the
-- interview — the office's button and Willo alike. It read wrongly for a
-- candidate turned down later (a rejected document, a failed reference)
-- and for a returning applicant who was never interviewed this time.
--
-- Those two now get E2b: the same close, without the interview. E2 is
-- untouched and still goes for every interview-stage rejection. E4 (quiz
-- failed three times) is its own email and is not affected.
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

  -- E2 is THC's interview-rejection wording, the same whichever route
  -- rejected at the interview (§2.7). A candidate rejected after the
  -- interview — at documents, the quiz or additional info — gets E2b, whose
  -- copy does not thank them for an interview as if that were the end of
  -- it. The reason is the office's and never goes to the candidate.
  v_template := case when s.status in ('interview_requested', 'interview_completed')
                     then 'E2' else 'E2b' end;
  insert into notification_outbox (key, channel, template, recipient_emails, payload)
  values (v_template || ':staff:' || p_staff || ':' || extract(epoch from s.onboarding_started_at)::bigint,
          'email', v_template, array[s.email], jsonb_build_object('name', s.first_name))
  on conflict (key) do nothing;

  -- §4.1: a rejected candidate's pending uploads drop out of Needs review
  -- because the queue excludes Rejected profiles — nothing to write here.
end $$;

create or replace function public.onboarding_resolve_returning(
  p_application uuid,
  p_action      text,
  p_reason      text
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  a applications;
  v_reset jsonb;
begin
  perform assert_office_caller();

  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'reason_required' using errcode = '22023';
  end if;
  select * into a from applications where id = p_application for update;
  if a.id is null or a.outcome <> 'returning_applicant' then
    raise exception 'unknown_application' using errcode = 'P0002';
  end if;
  if a.resolved_at is not null then
    raise exception 'already_resolved: %', a.resolution using errcode = 'P0001';
  end if;

  if p_action = 'reset' then
    -- The same function §9.6's button calls: it refuses anything but a
    -- blocked, rejected or inactive record, supersedes the evidence and
    -- keeps the Employee ID and the history.
    v_reset := reset_to_candidate(a.staff_id, btrim(p_reason));
  elsif p_action = 'reject' then
    -- A returning applicant was never interviewed this time round, so
    -- E2's "thank you for completing your interview" would be untrue.
    insert into notification_outbox (key, channel, template, recipient_emails, payload)
    values ('E2b:application:' || a.id, 'email', 'E2b', array[a.email],
            jsonb_build_object('name', a.first_name))
    on conflict (key) do nothing;
  else
    raise exception 'unknown_action: %', p_action using errcode = '22023';
  end if;

  update applications
     set resolved_at = now(),
         resolved_by = auth.uid(),
         resolution = case when p_action = 'reset' then 'reset' else 'rejected' end,
         resolution_reason = btrim(p_reason)
   where id = p_application;

  insert into audit_log (actor, action, entity, entity_id, data)
  values (auth.uid(), 'returning_applicant_' || p_action, 'staff', a.staff_id,
          jsonb_build_object('applicationId', a.id, 'reason', btrim(p_reason),
                             'matchedOn', a.matched_on));

  return jsonb_build_object('applicationId', a.id::text, 'staffId', a.staff_id::text,
                            'resolution', p_action) || coalesce(v_reset, '{}'::jsonb);
end $$;

comment on function public.onboarding_resolve_returning(uuid, text, text) is
  '§2.12 returning applicant: reset → reset_to_candidate() on the matched record (blocked, rejected or inactive only); reject → the application is declined and E2b goes to the address on the application. Either way the entry leaves the board.';
