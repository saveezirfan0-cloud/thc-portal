-- =====================================================================
-- The office can give a candidate rejected by the H&S quiz three more
-- attempts (ADR-0167; a deliberate change to §2.9 / RULE-09)
--
-- §2.9: "Pass mark 80%, multiple choice, 3 attempts in total, and failing
-- the third → automatic rejection." Rejection was final on the record;
-- the only way back was Reset to candidate, which starts the whole
-- onboarding again (Willo interview, every document, the declaration).
-- The office asked, 19.10.2026, to let a candidate who failed three times
-- at 70% try again without redoing everything else.
--
--   1. staff_transitions gains ONE edge, rejected → quiz. Only
--      grant_quiz_attempts() takes it: staff.status is written by definer
--      RPCs alone (20261012120100), and this one refuses anyone not
--      rejected BY THE QUIZ (rejection_cause = 'quiz_failed'). A candidate
--      the office or Willo rejected still has only Reset to candidate.
--   2. grant_quiz_attempts(staff, reason, actor) — service role — does
--      the work, so the office RPC and a support fix from the SQL editor
--      are the same code: the attempts so far are marked superseded (kept,
--      read-only, as Reset to candidate keeps them), staff.quiz_attempts
--      goes back to 0, the rejection columns are cleared, and the
--      candidate is back in Quiz with three attempts.
--      submit_quiz_attempt() and onboarding_state() already count only
--      attempts that are not superseded, so the Staff App shows the quiz
--      with three attempts left and a third failure rejects again (a new
--      E4, keyed on the new attempt). The onboarding period does not
--      move: documents, declaration and induction stay as they are.
--   3. onboarding_grant_quiz_attempts(staff, reason) — the Back Office.
--      Office only (assert_office_caller); a viewer is refused by the
--      office_read_only guard. The reason is mandatory and goes to
--      audit_log (action quiz_attempts_granted) with who and the scores
--      set aside.
--   4. onboarding_candidates_v counts attempts used against the current
--      three (not superseded). Best score, passed-at and the scores line
--      still read the whole period, so the board keeps the history.
--      Re-created from its LIVE definition (docs/10 §3b): one named
--      pattern that must match exactly once, options read back.
--
-- Nothing is sent to the candidate: the office tells them. The Staff App
-- leaves the terminal screen the next time it reads their status.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1 · The edge
-- ---------------------------------------------------------------------
insert into staff_transitions (from_status, to_status) values
  ('rejected', 'quiz')
on conflict do nothing;

-- ---------------------------------------------------------------------
-- 2 · The work
-- ---------------------------------------------------------------------
create or replace function public.grant_quiz_attempts(
  p_staff  uuid,
  p_reason text,
  p_actor  uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  s        staff;
  v_scores int[];
  v_name   text;
begin
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'reason_required' using errcode = '22023';
  end if;

  select * into s from staff where id = p_staff for update;
  if s.id is null or s.removed_at is not null then
    raise exception 'unknown_staff' using errcode = 'P0002';
  end if;
  if s.status <> 'rejected' or s.rejection_cause is distinct from 'quiz_failed' then
    raise exception 'not_quiz_rejected: %', s.status using errcode = 'P0001';
  end if;
  perform assert_staff_transition(s.status, 'quiz'::staff_status);

  with set_aside as (
    update quiz_attempts set superseded = true
     where staff_id = p_staff and not superseded
    returning attempt_no, score
  ) select coalesce(array_agg(round(score)::int order by attempt_no), '{}')
      into v_scores from set_aside;

  update staff
     set status           = 'quiz',
         quiz_attempts    = 0,
         rejected_at      = null,
         rejected_from    = null,
         rejection_cause  = null,
         rejection_reason = null,
         rejected_by      = null
   where id = p_staff;

  select p.full_name into v_name from profiles p where p.id = p_actor;

  insert into audit_log (actor, action, entity, entity_id, data)
  values (p_actor, 'quiz_attempts_granted', 'staff', p_staff,
          jsonb_build_object('reason',     btrim(p_reason),
                             'byName',     v_name,
                             'attempts',   3,
                             'setAside',   to_jsonb(v_scores),
                             'rejectedAt', s.rejected_at));

  return jsonb_build_object('staffId', p_staff::text, 'status', 'quiz',
                            'attemptsLeft', 3, 'setAside', to_jsonb(v_scores));
end $$;

comment on function public.grant_quiz_attempts(uuid, text, uuid) is
  'ADR-0167: a candidate rejected by the H&S quiz (rejection_cause quiz_failed) goes back to Quiz with three attempts — the attempts so far superseded (kept), quiz_attempts 0, the rejection cleared, audit_log quiz_attempts_granted with the reason, p_actor and the scores set aside. Service role; the office calls onboarding_grant_quiz_attempts().';

revoke execute on function public.grant_quiz_attempts(uuid, text, uuid) from public, anon, authenticated;
grant  execute on function public.grant_quiz_attempts(uuid, text, uuid) to service_role;

-- ---------------------------------------------------------------------
-- 3 · The office's door
-- ---------------------------------------------------------------------
create or replace function public.onboarding_grant_quiz_attempts(p_staff uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  perform assert_office_caller();
  -- A viewer (ADR-0060) is refused by the office_read_only trigger.
  return grant_quiz_attempts(p_staff, p_reason, auth.uid());
end $$;

comment on function public.onboarding_grant_quiz_attempts(uuid, text) is
  'ADR-0167: the Back Office''s "Allow 3 more attempts" on a candidate the H&S quiz rejected. Office only (not_authorised otherwise; a viewer is refused by office_read_only); the reason is mandatory. See grant_quiz_attempts().';

revoke execute on function public.onboarding_grant_quiz_attempts(uuid, text) from public, anon;
grant  execute on function public.onboarding_grant_quiz_attempts(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- 4 · The board counts the current three
-- ---------------------------------------------------------------------
do $$
declare
  v_def  text;
  v_opts text;
  v_n    int;
  c_pattern constant text := 'count\(\*\)::integer AS quiz_attempts_used';
begin
  v_def := pg_get_viewdef('public.onboarding_candidates_v'::regclass, true);
  select array_to_string(c.reloptions, ', ') into v_opts
    from pg_class c where c.oid = 'public.onboarding_candidates_v'::regclass;
  select count(*) into v_n from regexp_matches(v_def, c_pattern, 'g');
  if v_n <> 1 then
    raise exception '20261021100000: onboarding_candidates_v - expected one match of %, found %', c_pattern, v_n;
  end if;
  v_def := regexp_replace(v_def, c_pattern,
    'count(*) FILTER (WHERE NOT q.superseded)::integer AS quiz_attempts_used');
  execute 'create or replace view public.onboarding_candidates_v'
          || case when v_opts is not null then ' with (' || v_opts || ')' else '' end
          || ' as ' || v_def;
end;
$$;
