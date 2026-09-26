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
--     limits (Q9, Q10: HSE's elbow-height guideline figures, 16 kg women
--     / 25 kg men). The rows stay
--     is_placeholder = false because the questions are THC's, but THC
--     must confirm the key before go-live (docs/17, OWNER-TODO).
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
-- and are unchanged — submit_quiz_attempt() is not restated.
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
-- 2 · The placeholders step aside
-- ---------------------------------------------------------------------
update quiz_questions set active = false where active and is_placeholder;

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
where not exists (select 1 from quiz_questions where active);

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
