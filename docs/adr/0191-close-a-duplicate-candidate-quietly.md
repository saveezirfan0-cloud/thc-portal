# ADR-0191 · A duplicate onboarding record is closed quietly, and its IDs move to the live one

**Status:** Accepted (owner request, 22.10.2026). Refines scope §2.12 (the duplicate check) and ADR-0076 / ADR-0107 (Payroll ID, Employee ID).

## Context

A person who applies twice leaves two onboarding records. Two cases were live on 22.10.2026:

- **Sai Jillapelli.** The first application had a mistyped address and a phone one digit out. The office linked that record to the invite list (Payroll ID 6064, Employee ID 6064), but the person then applied again with the right address, passed the interview and is at Documents. The list's own address is the second record's.
- **Bivek Oli.** The same address and phone on both records, and two birth years (2005, 2004). The second application did not match the first on email and date of birth, so it became a new candidate. The record that progressed holds a verified passport and share-code report with 2004-09-06.

The stale record kept receiving the daily interview email (13 so far each), held the Payroll ID, and shares the live record's name. The office's **Reject** is the wrong tool: it queues E2 / E2b to the record's address, which for Bivek is the live candidate's. GDPR removal would anonymise a record that holds nothing, and cannot be undone.

## Decision

`close_duplicate_candidate(stale, keep, actor)`, service role only (the signed-in RPC surface pinned by 892 does not change):

- refuses unless it is the same person: names compatible (`payroll_names_compatible`) and the same email or the same date of birth; the stale record is at Interview, Documents or Quiz with no booking, no document and no signed contract; the kept record is live and not rejected;
- moves the Payroll ID and the Employee ID to the kept record when it has none (a kept record's own are never replaced; the stale record is cleared first because both columns are unique);
- rejects the stale record with cause `manager` and an internal reason, **without** E2 / E2b, so the chasers stop (they read status);
- drops the stale record's unsent outbox rows and keeps the sent ones;
- audits `staff.duplicate_closed` with what moved; a second run is a no-op (`alreadyClosed`).

Nothing is anonymised and nothing deleted: Reset to candidate reopens the record. The migration applies it to the two pairs above, each guarded so a database without those rows does nothing. The kept record's date of birth is never touched.

## Consequences

- The two stale records stop the daily email; the live ones carry the Payroll ID (and Sai's Employee ID, 6064).
- `issue_employee_id()` still refuses to match a payroll code while another non-removed record shares the name, and a rejected record counts. Bivek's code (6099) therefore will not become his Employee ID at contract signature; his Payroll ID is on his record, and `apply_payroll_codes()` can reconcile it. Changing that rule is a separate decision.
- No office screen yet: a "Mark as duplicate of …" action on the onboarding card would wrap this in a signed-in RPC (add it to 892 and docs/14 §4 with it).
- pgTAP `925_close_duplicate_candidate.sql` (30 assertions).
