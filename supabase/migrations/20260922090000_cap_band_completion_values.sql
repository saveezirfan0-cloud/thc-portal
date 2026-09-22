-- =====================================================================
-- Migration 20260922090000 · two new cap bands (RULE-20, §4.4–4.5 +
-- docs/scope/university-completion-letter-requirement.pdf)
--
-- Why this is a migration of its own
-- ---------------------------------
-- `alter type ... add value` cannot be followed, IN THE SAME TRANSACTION,
-- by anything that evaluates the value it added: Postgres raises
-- "unsafe use of new value of enum type" because the new label is not
-- visible to other snapshots until the adding transaction commits. The
-- Supabase CLI runs one transaction per migration FILE, so the only
-- reliable way to add a label and then use it in a function body — and
-- `row(0, 'visa_expired_0')::cap_assessment` is exactly that use, resolved
-- at parse-analysis time when the function is created — is two files.
--
-- 20260922090100_completion_letter_cap.sql is the other half and is
-- meaningless without this one. They must be applied in order, which their
-- timestamps guarantee.
--
-- The two labels
-- --------------
--   visa_expired_0    A week that begins after the worker's recorded right
--                     to work has expired. 0 hours, blocked from the rota.
--                     Outranks everything else in RULE-20, the completion
--                     letter included (requirement §3 state table, §7,
--                     acceptance criterion 6).
--   student_term_10   The Student visa condition for a course BELOW degree
--                     level is 10 hours a week in term time, not 20
--                     (requirement §1, §3 state table).
--
-- Both mirror CapBand in packages/domain/src/cap.ts. The enum exists so
-- that a band added on one side fails loudly on the other rather than
-- silently becoming a string nobody handles.
--
-- `if not exists` so a re-run, or a branch that already carries one of
-- them, is a no-op rather than a failed deploy.
-- =====================================================================

alter type cap_band add value if not exists 'visa_expired_0';
alter type cap_band add value if not exists 'student_term_10';

comment on type cap_band is
  'RULE-20 band (§4.4-4.5 + the University Completion Letter requirement). Mirrors CapBand in packages/domain/src/cap.ts one label for one label; held to packages/domain/src/cap.vectors.json on both sides.';
