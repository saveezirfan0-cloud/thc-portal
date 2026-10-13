-- =====================================================================
-- Plan 5 on the HMRC New Starter Checklist (§2.8, ADR-0116)
--
-- HMRC's checklist (question 13) lists Plan 1, Plan 2, Plan 4, Plan 5 and
-- the Postgraduate Loan; Plan 5 is anyone who applied to Student Finance
-- England for a course starting on or after 1 August 2023. 0001_init only
-- carried 1, 2 and 4, so a worker on Plan 5 had nothing to tick.
--
-- Nothing else needs to change: submit_hmrc_checklist() casts the text it
-- is given to this type, and new_starter_rows() prints 'Plan ' and the
-- plan's digits, so 'plan5' reads "Plan 5" in the report. There is no
-- Plan 3 on HMRC's form — the Student Loans Company's "Plan 3" is the
-- Postgraduate Loan, which stays its own tick.
-- =====================================================================

alter type public.student_loan_plan add value if not exists 'plan5' after 'plan4';
