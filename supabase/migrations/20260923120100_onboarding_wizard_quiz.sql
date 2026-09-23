-- =====================================================================
-- Migration 20260923120100 · The onboarding wizard, steps 5–6
--                            (§10.3, §2.9, §2.12, §10.1 case 3, §8 E4)
--
--   5/11 Health & Safety induction — THC's deck, slide by slide.
--   6/11 Safety quiz — pass mark 80%, three attempts, the third failure
--        rejects the candidate, sends E4 and replaces the wizard with the
--        terminal screen.
--
-- Both are open only once the candidate is in `quiz`, which only
-- onboarding_advance_to_quiz() (20260923120000) moves them to: "the quiz
-- is available ONLY once every document is verified" (§2.9).
--
-- Marking happens here, against quiz_questions, which the worker cannot
-- read. The app receives the questions without their key
-- (onboarding_quiz_questions) and sends back only the chosen indexes.
--
-- PLACEHOLDER CONTENT. The ten questions below are written for the
-- wireframe's quiz ("Question 4 of 10") and are marked is_placeholder.
-- §2.9 says "the questions and the correct answers are taken from" THC's
-- "Health and Safety Presentation Questions", which is an Appendix B
-- input we do not hold. Replacing them is data, not a release: deactivate
-- these rows and insert THC's. The rules (80%, three attempts, E4) do not
-- depend on the count.
--
-- Forward-only.
-- =====================================================================

insert into quiz_questions (position, prompt, options, correct_index, is_placeholder)
select * from (values
  (1, 'You discover a small fire in the kitchen. What should you do first?',
      array['Try to put it out with water',
            'Raise the alarm and alert the people around you',
            'Finish the service you''re on, then report it',
            'Open the windows to let the smoke out'], 1, true),
  (2, 'The fire alarm sounds during an event. Where do you go?',
      array['To the assembly point given in the venue briefing',
            'Back to the staff area for your belongings',
            'To the nearest lift',
            'Wherever the guests seem to be going'], 0, true),
  (3, 'A guest slips on a wet floor but says they are fine. What do you do?',
      array['Nothing — they said they''re fine',
            'Ask them to sign something saying so',
            'Mop the floor and carry on',
            'Tell your supervisor so it is recorded, and make the area safe'], 3, true),
  (4, 'How should you lift a heavy crate of glassware?',
      array['Bend your back and lift quickly',
            'Lift it above your head to clear the guests',
            'Bend your knees, keep the load close and lift with your legs',
            'Drag it along the floor with one hand'], 2, true),
  (5, 'You spot a spill on the floor during service. What do you do?',
      array['Walk around it',
            'Put out a wet-floor sign and get it cleaned straight away',
            'Warn one guest and carry on',
            'Leave it for the cleaners at the end of the night'], 1, true),
  (6, 'A guest asks whether a dish contains nuts and you are not sure. What do you say?',
      array['That it probably doesn''t',
            'That they should pick something else',
            'That you will check the allergen information with the kitchen before they order',
            'That another guest had it and was fine'], 2, true),
  (7, 'You cut your hand on broken glass. What do you do?',
      array['Get it seen by the first aider and tell your supervisor',
            'Wrap it in a napkin and keep serving',
            'Carry on and deal with it after the shift',
            'Leave the event without telling anyone'], 0, true),
  (8, 'Which of these must you never do with a cleaning chemical?',
      array['Read the label first',
            'Wear gloves when the label says to',
            'Put it back where it is stored',
            'Mix it with another product'], 3, true),
  (9, 'A fire exit is blocked by stacked chairs. What do you do?',
      array['Leave it — it is only for emergencies',
            'Clear it or report it straight away',
            'Put a sign on the chairs',
            'Wait until the event is over'], 1, true),
  (10, 'Who do you report an accident or a near miss to?',
      array['Nobody, if no one was hurt',
            'Only the client',
            'Your supervisor or the THC manager on site',
            'The other staff on your shift'], 2, true)
) q(position, prompt, options, correct_index, is_placeholder)
where not exists (select 1 from quiz_questions);

-- ---------------------------------------------------------------------
-- Step 5 — the induction viewer reached its last slide
--
-- The deck is shown as supplied (§10.3: "re-drawing the induction content
-- as native app screens is not in scope"); what the database records is
-- that the worker got to the end of it, which is what unlocks the quiz
-- in the wireframe ("Unlocks on the last slide").
-- ---------------------------------------------------------------------
create or replace function public.onboarding_complete_induction()
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  s staff := onboarding_me();
begin
  if s.status <> 'quiz' then
    raise exception 'wrong_stage' using errcode = 'P0001';
  end if;
  -- A candidate the office moved on by hand has no progress row yet.
  insert into onboarding_progress (staff_id, induction_at, updated_at)
  values (s.id, now(), now())
  on conflict (staff_id) do update
    set induction_at = coalesce(onboarding_progress.induction_at, excluded.induction_at),
        updated_at   = excluded.updated_at;
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------------
-- Step 6 — the questions, without their key
-- ---------------------------------------------------------------------
create or replace function public.onboarding_quiz_questions()
returns table (id uuid, question_no int, prompt text, options text[])
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_id uuid := staff_caller();
  s staff;
  v_induction timestamptz;
  v_taken int;
begin
  if v_id is null then
    raise exception 'unknown_staff' using errcode = 'P0001';
  end if;
  select * into s from staff where staff.id = v_id;
  if s.status <> 'quiz' then
    raise exception 'wrong_stage' using errcode = 'P0001';
  end if;
  select p.induction_at into v_induction from onboarding_progress p where p.staff_id = v_id;
  if v_induction is null then
    raise exception 'induction_first' using errcode = 'P0001';
  end if;
  select count(*)::int into v_taken from quiz_attempts q where q.staff_id = v_id and not q.superseded;
  if v_taken >= 3 then
    raise exception 'no_attempts_left' using errcode = 'P0001';
  end if;

  return query
    select q.id, (row_number() over (order by q.position))::int, q.prompt, q.options
      from quiz_questions q
     where q.active
     order by q.position;
end $$;

comment on function public.onboarding_quiz_questions() is
  '§2.9 quiz questions for the caller, numbered 1..n, WITHOUT correct_index. Open only in the quiz stage, after the induction, with attempts left.';

-- ---------------------------------------------------------------------
-- Step 6 — marking an attempt
--
-- p_answers: {"<question id>": <zero-based option index>, …} for every
-- active question. "Your answers are checked at the end, not one by one"
-- (wireframe), so this is the only call the quiz makes.
--
--   pass (≥ 80%, compared as correct × 5 ≥ total × 4 so 8/10 is exact)
--       → contract, the next stage of §2.12;
--   fail on attempt 1 or 2 → stay in quiz, attempts left reported;
--   fail on attempt 3 → rejected, E4, and — because staff.quiz_attempts
--       reaches 3 — appLock() puts the §10.1 case 3 screen in place of
--       the wizard.
-- ---------------------------------------------------------------------
create or replace function public.submit_quiz_attempt(p_answers jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  s staff := onboarding_me();
  v_induction timestamptz;
  v_taken int;
  v_total int;
  v_correct int := 0;
  v_passed boolean;
  v_attempt int;
  v_attempt_id uuid;
  v_outcome text;
  q record;
  v_raw jsonb;
  v_pick int;
begin
  if s.status <> 'quiz' then
    raise exception 'wrong_stage' using errcode = 'P0001';
  end if;
  select induction_at into v_induction from onboarding_progress where staff_id = s.id;
  if v_induction is null then
    raise exception 'induction_first' using errcode = 'P0001';
  end if;
  select count(*)::int into v_taken from quiz_attempts where staff_id = s.id and not superseded;
  if v_taken >= 3 then
    raise exception 'no_attempts_left' using errcode = 'P0001';
  end if;
  if p_answers is null or jsonb_typeof(p_answers) <> 'object' then
    raise exception 'quiz_incomplete' using errcode = 'P0001';
  end if;

  select count(*)::int into v_total from quiz_questions where active;
  if v_total = 0 then
    raise exception 'quiz_not_configured' using errcode = 'P0001';
  end if;

  for q in select id, options, correct_index from quiz_questions where active loop
    v_raw := p_answers -> q.id::text;
    if v_raw is null or jsonb_typeof(v_raw) <> 'number' then
      raise exception 'quiz_incomplete' using errcode = 'P0001';
    end if;
    v_pick := (v_raw #>> '{}')::numeric::int;
    if v_pick < 0 or v_pick >= array_length(q.options, 1) then
      raise exception 'bad_answer' using errcode = 'P0001';
    end if;
    if v_pick = q.correct_index then
      v_correct := v_correct + 1;
    end if;
  end loop;

  v_passed := v_correct * 5 >= v_total * 4;
  v_attempt := v_taken + 1;

  insert into quiz_attempts (staff_id, attempt_no, score, passed, answers, taken_at)
  values (s.id, v_attempt, floor(v_correct * 100.0 / v_total), v_passed,
          jsonb_build_object('answers', p_answers, 'correct', v_correct, 'total', v_total),
          clock_timestamp())
  returning id into v_attempt_id;

  update staff set quiz_attempts = v_attempt where id = s.id;

  if v_passed then
    perform assert_staff_transition(s.status, 'contract'::staff_status);
    update staff set status = 'contract' where id = s.id;
    v_outcome := 'passed';
  elsif v_attempt >= 3 then
    perform assert_staff_transition(s.status, 'rejected'::staff_status);
    update staff set status = 'rejected' where id = s.id;
    -- E4: THC's own wording, identical to the terminal screen (§10.1, §8).
    -- Keyed on the attempt, so a worker reset and failed again is told again.
    insert into notification_outbox (key, channel, template, recipient_staff_id, recipient_emails, payload)
    values ('E4:quiz_attempt:' || v_attempt_id, 'email', 'E4', s.id, array[s.email],
            jsonb_build_object('name', s.first_name))
    on conflict (key) do nothing;
    v_outcome := 'rejected';
  else
    v_outcome := 'retry';
  end if;

  return jsonb_build_object(
    'attemptNo',    v_attempt,
    'correct',      v_correct,
    'total',        v_total,
    'percent',      floor(v_correct * 100.0 / v_total)::int,
    'passed',       v_passed,
    'outcome',      v_outcome,
    'attemptsLeft', greatest(3 - v_attempt, 0));
end $$;

comment on function public.submit_quiz_attempt(jsonb) is
  '§2.9: marks one H&S quiz attempt against the key the worker cannot read. 80% passes to contract; the third failure rejects and queues E4.';

revoke execute on function public.onboarding_complete_induction() from public, anon;
revoke execute on function public.onboarding_quiz_questions()     from public, anon;
revoke execute on function public.submit_quiz_attempt(jsonb)      from public, anon;
grant  execute on function public.onboarding_complete_induction() to authenticated;
grant  execute on function public.onboarding_quiz_questions()     to authenticated;
grant  execute on function public.submit_quiz_attempt(jsonb)      to authenticated;
