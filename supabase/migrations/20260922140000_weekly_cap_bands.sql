-- =====================================================================
-- RULE-20 · the two cap bands the University Completion Letter
-- Requirement adds (docs/scope/)
--
-- Alone in its own migration on purpose. Postgres refuses to use a new
-- enum value in the same transaction that added it unless the type was
-- created there too, and the Supabase CLI runs one migration per
-- transaction — so the function that returns these bands is the next
-- file, not this one. Splitting them is the fix; it is not tidiness.
--
--   visa_expired_0   no valid right to work, so no rota (requirement §3,
--                    acceptance criterion 6). The ONE band where 0 is a
--                    real answer. cap_hours null still means no ceiling,
--                    and nothing else returns 0, so the two never blur.
--   student_term_10  studying BELOW degree level, where the Student visa
--                    condition is 10 hours a week and not 20
--                    (requirement §1, §3 state table).
--
-- Ordered before student_term_20 so the enum reads from most restrictive
-- to least, which is the order the rule resolves in.
-- =====================================================================

alter type cap_band add value if not exists 'visa_expired_0'  before 'student_term_20';
alter type cap_band add value if not exists 'student_term_10' before 'student_term_20';
