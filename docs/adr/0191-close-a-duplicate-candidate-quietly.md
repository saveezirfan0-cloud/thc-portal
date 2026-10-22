# ADR-0191 · A duplicate onboarding record is closed quietly, and its IDs move to the live one

**Status:** Accepted (owner request, 22.10.2026). Refines scope §2.12 (the duplicate check) and ADR-0076 / ADR-0107 (Payroll ID, Employee ID).

## Context

A person who applies twice leaves two onboarding records. Two cases were live on 22.10.2026:

- **Pair 1.** The first application had a mistyped address and a phone one digit out. The office linked that record to the invite list (Payroll ID and Employee ID), but the person then applied again with the right address, passed the interview and is at Documents. The list's own address is the second record's.
- **Pair 2.** The same address and phone on both records, and two birth years. The second application did not match the first on email and date of birth, so it became a new candidate. The record that progressed holds a verified passport and share-code report, and its date of birth is the one on them.

The stale record kept receiving the daily interview email (13 so far each), held the Payroll ID, and shares the live record's name. The office's **Reject** is the wrong tool: it queues E2 / E2b to the record's address, which for pair 2 is the live candidate's. GDPR removal would anonymise a record that holds nothing, and cannot be undone.

## Decision

`close_duplicate_candidate(stale, keep, actor)`, service role only (the signed-in RPC surface pinned by 892 does not change):

- refuses unless it is the same person: names compatible (`payroll_names_compatible`) and the same email or the same date of birth; the stale record is at Interview, Documents or Quiz with no booking, no document and no signed contract; the kept record is live and not rejected;
- moves the Payroll ID and the Employee ID to the kept record when it has none (a kept record's own are never replaced; the stale record is cleared first because both columns are unique);
- rejects the stale record with cause `manager` and an internal reason, **without** E2 / E2b, so the chasers stop (they read status);
- drops the stale record's unsent outbox rows (not one the drain claimed in the last ten minutes) and keeps the sent ones;
- audits `staff.duplicate_closed` on the stale record and, when an ID moved, `staff.duplicate_merged_in` on the kept one, so its own history shows what it gained; a second run is a no-op (`alreadyClosed`).

Nothing is anonymised and nothing deleted: Reset to candidate reopens the record. The migration applies it to the two pairs above, each guarded so a database without those rows does nothing. The kept record's date of birth is never touched.

## Consequences

- The two stale records stop the daily email; the live ones carry the Payroll ID (and pair 1's Employee ID).
- The stale record keeps whatever else the wizard collected (selfie, NI number, bank details, any login), exactly as a normal Reject does; it is not anonymised. Removing that is a GDPR removal and the office's call.
- `issue_employee_id()` still refuses to match a payroll code while another non-removed record shares the name, and a rejected record counts. Pair 2's payroll code therefore will not become its Employee ID at contract signature; the Payroll ID is on the record, and `apply_payroll_codes()` can reconcile it. Changing that rule is a separate decision.
- No office screen yet: a "Mark as duplicate of …" action on the onboarding card would wrap this in a signed-in RPC (add it to 892 and docs/14 §4 with it).
- pgTAP `925_close_duplicate_candidate.sql` (34 assertions).
