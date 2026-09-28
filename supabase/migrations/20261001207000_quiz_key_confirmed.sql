-- =====================================================================
-- Migration 20261001207000 · THC confirmed the Health & Safety quiz
--                            (§2.9, docs/17 item 9)
--
-- On 28.09 THC confirmed the quiz as it stands: the answer key the build
-- team inferred from THC's unmarked sheet is correct (C, B, B, A, D, A, C,
-- D, C, A), Q8's multiple-choice rewording of THC's free-text question is
-- approved, and Q9 and Q10 stay as worded, with 16 kg and 25 kg correct.
-- Nothing about a question changes, so attempts already marked stay valid;
-- only Q8's placeholder flag goes, which leaves THC's ten with none.
-- pgTAP 391 pins the key.
-- =====================================================================

update quiz_questions
   set is_placeholder = false
 where active
   and position = 8
   and prompt = 'Which of these foods can cause an allergic reaction?';
