# ADR-0106 · The bank-details email is for a change to existing details

**Status:** Accepted (THC, 07.10.2026) · **Departs from:** Scope §2.10 ("the same E5 notification as at onboarding") · **Refines:** §8 E5, ADR-0092

## Context

§2.10 and §10.1 had `staff_save_bank()` queue **E5** ("Bank & payroll details updated") on every save, including a candidate's first entry at onboarding step 9. Gisela and Payroll received an email for each new starter, headed "Employee ID (not yet issued)", about someone who is not staff yet and has no existing details to change.

THC: the email should only be sent if a staff member updates their existing bank details.

## Decision

`staff_save_bank()` still validates and writes exactly as before. It queues E5 only when **all** of these hold:

1. a `bank_details` row already existed (a first entry is not a change);
2. the account holder, sort code or account number actually differ (saving the same details again is not an update);
3. the worker already has an Employee ID, i.e. is Staff (issued at contract signature, §2.7). A candidate still correcting step 9 sends nothing.

E5b (ADR-0092, a change made by an office login or the service role) is untouched. `staff_save_bank()` still tells the `bank_details` trigger it owns the decision for its own write, so a suppressed E5 never turns into an E5b.

## Consequences

- `20261008080000_bank_email_only_for_changes_to_existing_details.sql` (`staff_save_bank` restated).
- pgTAP 330, 392, 393, 672 and 775 now expect no E5 on a first entry or an unchanged save, and one E5 per real change by a worker with an Employee ID.
- Payroll learns a new starter's bank details from the Payroll / New Starter exports (§11), not from an email.
- The E5 template and its recipients are unchanged.
