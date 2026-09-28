-- =====================================================================
-- Two go-live items, both waiting only on this commit (28.09).
--
-- 1 · THC confirmed the Health & Safety quiz as it stands (§2.9, docs/17
--     item 9). The answer key the build team inferred from THC's unmarked
--     sheet is correct (C, B, B, A, D, A, C, D, C, A), Q8's multiple-choice
--     rewording of THC's free-text question is approved, and Q9 and Q10
--     stay as worded, with 16 kg and 25 kg correct. Nothing about a
--     question changes, so attempts already marked are still valid; only
--     Q8's placeholder flag goes, which leaves THC's ten with none.
--
-- 2 · The `willo-invite` safety net is enabled (OWNER-TODO §4). It was
--     registered disabled in 20260924110000 until its function could send,
--     but the function already refuses safely without THC's keys: with no
--     WILLO_API_KEY / WILLO_INTERVIEW_KEY it records a `skipped` run and
--     creates nothing (willo-webhook/index.ts). Since ADR-0067 (#88) the
--     job's calls are no longer refused with 401, so enabling it now means
--     a missed nudge is retried within a minute the moment the keys are
--     set, with no further commit. 190's enabled list moves with it.
--
--     Like every schedule, this only marks the row; the pg_cron job is
--     created by running `select install_job_schedules();` once the
--     function is deployed (docs/16 §4).
-- =====================================================================

update quiz_questions
   set is_placeholder = false
 where active
   and position = 8
   and prompt = 'Which of these foods can cause an allergic reaction?';

update job_schedules
   set enabled = true,
       note = '§2.4/§2.12 create candidates in Willo (E1 is Willo''s). Retries missed nudges every minute. Enabled 28.09 (20261001206000): without WILLO_API_KEY + WILLO_INTERVIEW_KEY the function records a skipped run and creates nothing (ADR-0021, ADR-0066). Deploy functions before running install_job_schedules().'
 where job = 'willo-invite';
