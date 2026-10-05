# ADR-0092 · Every change to bank details is emailed to Gisela and Payroll

**Status:** Accepted (THC, 05.10.2026). Adds E5b to the register, beside §8's E5. **§2.10, §8 (E5), §10.1**

## Context

THC: "Any changes in bank details of existing staff should be immediately emailed to both Gisela and Payroll."

A worker's own change already is. `staff_save_bank()` (the Staff App's Payment information, and onboarding's step 9 through `onboarding_save_bank()`) queues **E5** to `gisela@thehospitalitycompany.co.uk` and `thc_payroll@topsourceworldwide.com` in the same transaction as the write, one email per save, and the outbox drain runs every minute. Nothing needed to change there.

The gap was every other way a `bank_details` row can change. An office login holding the finance permission may write the table directly (`admin_all`, pinned by 571), and so may the service role. Those changes sent nothing, so Payroll could be paying into an account it had never been told about, which is the situation E5 exists to prevent. (The worker's own direct write was closed in 20260927120100 for the same reason.)

## Decision

1. **A trigger on `bank_details` closes it.** `bank_details_notify_change()`, after insert or update, queues **E5b** ("Bank & payroll details changed") for any insert, or any change to the account holder, sort code or account number, that did not come through `staff_save_bank()`. A write that changes nothing sends nothing. A delete (the GDPR removal) is not a change and sends nothing. The trigger is `security definer` and executable by nobody.
2. **One change, one email.** `staff_save_bank()` sets a transaction-local flag around its own write, and the trigger stands down for it, so a worker's save is E5 only. The flag is cleared again straight after that statement, so a later direct write in the same transaction is still emailed.
3. **E5b goes to the same two addresses as E5**, from `admin@`. It names the worker, their Employee ID, when (UK time), and **who** changed it: the office login's name, or "the system" for the service role. It says "if you were not expecting this change, check it with the office before the next payroll run". **It never carries a sort code or an account number**, so the details stay in the platform and not in an inbox. A test holds the template and the payload to that.
4. **Cosmetic:** `changedBy` reads "the system" whenever the writer has no Back Office profile (the service role, a script, a database administrator), not only for the service role.
5. **E5b is an extension code** (`EXTENSION_CODES`, like E2b and E10), not a §8 code. It has its own switch in /settings → Notifications (ADR-0083), on by default.

## Consequences

- `20261005140500_bank_changes_by_the_office_emailed.sql` (the trigger, `staff_save_bank` restated with the flag). pgTAP `775_bank_change_by_office_emailed.sql`. The fixtures' own bank inserts now queue E5b as the owner, which is correct, so `110_jobs_and_outbox.sql` pushes those two rows out of the drain it counts.
- `packages/notifications`: E5b in `templates.ts`, its eyebrow in `email-layouts.ts`, its row in the office Inbox and its switch.
- The worker's own change is exactly as before (E5).
- Today the Back Office has no screen that edits a worker's bank details. The trigger covers a direct write (an API call by an office login, a script, an import) and any screen added later.
