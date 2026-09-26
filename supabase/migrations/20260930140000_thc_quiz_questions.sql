-- =====================================================================
-- Migration 20260930140000 · THC's Health & Safety quiz (§2.9, Appendix B)
--
-- §2.9: "The questions and the correct answers are taken from" THC's
-- "Health and Safety Presentation Questions" — received 26.09.2026 (a
-- two-page sheet, "the pass mark for this is 80%"). This replaces the ten
-- placeholder questions of 20260923120100 with THC's ten.
--
-- What changed from THC's sheet, and why
-- --------------------------------------
--   · The wording is THC's, verbatim, except Q6: "Personnel Protective
--     Equipment" → "Personal Protective Equipment" (a typo; PPE is
--     personal protective equipment).
--   · THE ANSWER KEY IS INFERRED. THC's sheet marks no answers; the
--     correct_index values below are ours. Q1, Q2, Q3, Q6 and Q7 agree
--     with THC's own induction deck (slide 4: CO2 on electrical fires,
--     water and foam not; slide 5: 2% natural causes; slide 8: 48 hours
--     after sickness; slide 14: PPE with chemicals; slide 9: the skull and
--     crossbones is "Toxic"). The rest are the ordinary H&S reading —
--     the deck does not cover allergies (Q4, Q5, Q8) or give weight
--     limits (Q9, Q10). Q9/Q10 are keyed to the CLOSEST of THC's options,
--     not a correct one: 16 kg (women) and 25 kg (men) are HSE's
--     guideline figures for a load held close to the body between
--     KNUCKLE and elbow height; at elbow height and above (to the
--     shoulder) HSE gives 13 kg and 20 kg, which none of THC's options
--     offers. THC must reword Q9/Q10 ("knuckle height") or change the
--     options (docs/17). The rows stay is_placeholder = false because
--     the questions are THC's, but THC must confirm the key before
--     go-live (docs/17, OWNER-TODO).
--   · Q7 shows a picture ("what does this symbol mean?"). THC's sheet
--     carries the GHS06 pictogram; the Staff App ships an equivalent clean
--     drawing at apps/staff/public/quiz/coshh-toxic.svg (the sheet's copy is
--     a 74-pixel JPEG). The new image_path column carries it, and
--     onboarding_quiz_questions() now returns it.
--   · Q8 on THC's sheet is free text ("Name three (3) foods, which can
--     cause an allergic reaction?", three blank lines) — a multiple-choice
--     quiz cannot mark that. It is converted to a multiple-choice question
--     on the same subject and is the ONE row left is_placeholder = true:
--     the rewording awaits THC's approval.
--
-- Rows are deactivated, never deleted: quiz_attempts.answers holds the
-- question ids an attempt was marked against, and a worker who sat the
-- placeholder quiz keeps a readable record (§2.12 keeps old evidence).
-- The marking rules (80%, three attempts, E4) do not depend on the count
-- and are unchanged. submit_quiz_attempt() is restated (section 5) for one
-- thing only: a worker who loaded the quiz before this migration and
-- submits after it sends answers keyed by the deactivated ids. That used to
-- read as "quiz_incomplete" ("Answer every question"); it is now its own
-- refusal, `quiz_changed`, raised before anything is written, and the app
-- reloads the current questions.
--
-- Forward-only.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1 · A picture for a question
--
-- A path under the Staff App's /public, not a Storage object: the quiz
-- is the same for everyone and ships with the app. The CHECK keeps it to
-- that folder and to image types the app renders as-is.
-- ---------------------------------------------------------------------
alter table quiz_questions add column if not exists image_path text;

alter table quiz_questions drop constraint if exists quiz_questions_image_path_shape;
alter table quiz_questions add constraint quiz_questions_image_path_shape
  check (image_path is null or image_path ~ '^/quiz/[a-z0-9-]+\.(png|webp|svg)$');

comment on column quiz_questions.image_path is
  'Optional picture shown above the options (§2.9 Q7, the COSHH symbol): a path under the Staff App''s /public, e.g. /quiz/coshh-toxic.svg.';

-- ---------------------------------------------------------------------
-- 2 · The previous set steps aside
--
-- THE RULE for replacing a question set: key it on the NEW set's own
-- first prompt, never on is_placeholder. THC's Q8 is itself flagged
-- is_placeholder, so "deactivate the placeholders" would, replayed later,
-- take out one of THC's questions — and a guard of "no active rows" would
-- then skip the insert and leave a nine-question quiz. So: if THC's Q1 is
-- not active, every active row (today: the ten of 20260923120100) is
-- switched off and THC's ten go in; if it is, nothing here runs.
-- ---------------------------------------------------------------------
update quiz_questions set active = false
 where active
   and not exists (
     select 1 from quiz_questions t
      where t.active
        and t.prompt = 'What fire extinguisher from these listed would be utilised on an electrical fire?');

-- ---------------------------------------------------------------------
-- 3 · THC's ten (correct_index is zero-based: A = 0)
-- ---------------------------------------------------------------------
insert into quiz_questions (position, prompt, options, correct_index, is_placeholder, image_path)
select * from (values
  (1, 'What fire extinguisher from these listed would be utilised on an electrical fire?',
      array['Water', 'Foam', 'Carbon Dioxide'], 2, false, null::text),
  (2, 'What percentage of Accidents within the workplace are caused by Natural Causes?',
      array['16%', '2%', '82%'], 1, false, null),
  (3, 'How long should you stay away from work after a bout of sickness or diarrhea?',
      array['24 Hours', '48 Hours', '72 Hours'], 1, false, null),
  (4, 'Anaphylaxis is a severe condition caused by?',
      array['An Allergic Reaction to a certain food', 'Food Poisoning', 'Food Intolerance'], 0, false, null),
  (5, 'What symptoms are associated with an Allergic Reaction?',
      array['Vomiting', 'Difficulty in Breathing', 'Itchiness', 'All the above'], 3, false, null),
  -- THC's sheet: "Personnel Protective Equipment" — corrected to "Personal".
  (6, 'When must you use Personal Protective Equipment (PPE)?',
      array['When using Chemicals', 'Serving Wine', 'Serving Food'], 0, false, null),
  (7, 'COSHH – what does this symbol mean?',
      array['Oxidising', 'Corrosive', 'Toxic'], 2, false, '/quiz/coshh-toxic.svg'),
  -- THC's sheet: "Name three (3) foods, which can cause an allergic
  -- reaction?" (free text). Reworded to be markable; awaits THC's approval.
  (8, 'Which of these foods can cause an allergic reaction?',
      array['Peanuts', 'Milk', 'Shellfish', 'All the above'], 3, true, null),
  (9, 'What are the recommended weight limits for women when carrying a load at Elbow height?',
      array['25 Kgs', '50 Kgs', '16 Kgs'], 2, false, null),
  (10, 'What are the recommended weight limits for men when carrying a load at Elbow height?',
      array['25 Kgs', '50 Kgs', '100 Kgs'], 0, false, null)
) q(position, prompt, options, correct_index, is_placeholder, image_path)
where not exists (
  select 1 from quiz_questions t
   where t.active
     and t.prompt = 'What fire extinguisher from these listed would be utilised on an electrical fire?');

-- ---------------------------------------------------------------------
-- 4 · Step 6 — the questions, without their key, now with their picture
--
-- Restated from its latest body (20260923120100; no later migration
-- redefines it). A changed RETURNS TABLE cannot be replaced in place, so
-- it is dropped and created, with the same security definer, pinned
-- search_path and grants.
-- ---------------------------------------------------------------------
drop function if exists public.onboarding_quiz_questions();

create function public.onboarding_quiz_questions()
returns table (id uuid, question_no int, prompt text, options text[], image_path text)
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
    select q.id, (row_number() over (order by q.position))::int, q.prompt, q.options, q.image_path
      from quiz_questions q
     where q.active
     order by q.position;
end $$;

comment on function public.onboarding_quiz_questions() is
  '§2.9 quiz questions for the caller, numbered 1..n, with an optional picture path, WITHOUT correct_index. Open only in the quiz stage, after the induction, with attempts left.';

revoke execute on function public.onboarding_quiz_questions() from public, anon;
grant  execute on function public.onboarding_quiz_questions() to authenticated;

-- ---------------------------------------------------------------------
-- 5 · Step 6 — marking an attempt, now refusing a replaced sheet
--
-- Restated from its latest body (20260923120100; no later migration
-- redefines it), unchanged except the `quiz_changed` check. Same
-- signature, so create or replace keeps its grants; they are restated
-- anyway, as 20260923120100 has them.
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

  -- A sheet built from questions that are no longer active — the quiz was
  -- replaced between loading and submitting — is refused as such, before
  -- anything is written, so the app can load the current questions rather
  -- than tell the worker to "answer every question" they cannot see.
  if exists (
    select 1 from jsonb_object_keys(p_answers) k
     where not exists (select 1 from quiz_questions qq where qq.active and qq.id::text = k)
  ) then
    raise exception 'quiz_changed' using errcode = 'P0001';
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

  -- The attempt is written BEFORE the status moves: a passed attempt in
  -- this onboarding period is the evidence staff_status_guard (B5,
  -- 20260923110000) requires for quiz → contract. "This period" is the
  -- same thing twice over — the guard reads taken_at against
  -- onboarding_started_at, this function counts the rows Reset to
  -- candidate has not superseded, and both move at the same reset.
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

revoke execute on function public.submit_quiz_attempt(jsonb) from public, anon;
grant  execute on function public.submit_quiz_attempt(jsonb) to authenticated;
