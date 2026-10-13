# ADR-0116 · Plan 5 on the HMRC New Starter Checklist

**Status:** Accepted · Wizard step 7/11 (`staff/onboarding-2.html`), Back Office candidate and staff profiles, New Starter report · §2.8, §9.9 Tab 3 · Product owner, 12.10.2026

## Context

§2.8 asks for "the full HMRC option set" on the student loan question and then lists it as "No · Plan 1 · Plan 2 · Plan 4 · Postgraduate Loan". HMRC's current New Starter Checklist (question 13) also has **Plan 5**: anyone who applied to Student Finance England for a course that started on or after 1 August 2023. The list in §2.8 was written from the older form, so a worker on Plan 5 had nothing to tick and would have been reported on the wrong plan or none, and had the wrong deduction taken.

## Decision

- The student loan radio set is **No · Plan 1 · Plan 2 · Plan 4 · Plan 5**, in HMRC's order. The Postgraduate Loan stays a separate tick that can go with any plan.
- `student_loan_plan` gains `plan5` (`20261012130000`). `submit_hmrc_checklist()` and `new_starter_rows()` already handle any value of the type, so the report prints "Plan 5", or "Plan 5 + Postgraduate".
- There is **no Plan 3** option. HMRC's form has none. The Student Loans Company's "Plan 3" is the Postgraduate Loan, which already has its own tick.

## Consequences

- This follows §2.8's intent ("the full HMRC option set") rather than its list. If HMRC adds another plan, the same three places change: the enum, `STUDENT_LOAN_OPTIONS` in `packages/domain/src/hmrc.ts`, and the Overview label map.
- A worker on Plan 5 who submitted step 7 before this change had to pick another answer, likely Plan 2 or No. Nothing here asks them again, so the office should check with any such worker before payroll.
