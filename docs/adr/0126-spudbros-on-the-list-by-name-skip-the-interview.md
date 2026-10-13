# ADR-0126 · A SpudBros person who applied under another email skips the interview too

**Status:** Accepted · **Refines:** ADR-0118, ADR-0107, ADR-0123 · **Owner request:** 13.10.2026

## Context
ADR-0118 skips the Willo interview for everyone marked SpudBros Express. People are marked by the link they apply through (`/apply/spudbros`) or by the invite list, and the list is matched on **email** (ADR-0107). Somebody on the list as SpudBros who applied through the ordinary `/apply` with a different address was therefore never marked, and was sent the interview like a THC applicant. On 13.10 Charlotte Crossley-Smith was on the list under one address, applied under another, and sat in **Interview requested**. ADR-0123's **Link** fixes it, but only once the office spots the row and clicks. The owner: "make sure any current or future SpudBros isn't asked for an interview — the interview is not required".

## Decision
- **The list's SpudBros rows also mark by name, for people still waiting for the interview.** `spudbros_listed_by_name()` pairs a SpudBros list row nobody has applied for by email with a candidate who matches it, using the same pairing as the office's possible matches: same first name, same last word of the surname, two words on each side. The candidate must:
  - be in `interview_requested` or `interview_completed`;
  - not already be SpudBros, and have no Payroll ID;
  - not have their own address on the list;
  - never have been placed by the list (`roster.matched`, `roster.linked`) or by the office on the profile (`staff.scheduling_set`).
- **Only the restrictive half applies.** `spudbros_mark_listed_by_name()` marks them SpudBros Express with THC shifts off, and audits `roster.spudbros_by_name` with the list address. No Payroll ID moves and the row stays, so it is still listed under "Applied under another email". The office's **Link** still gives the Payroll ID, and Link stays manual (ADR-0123).
- **The existing sweep does the rest.** `spudbros_skip_due()` runs the marking before it leases, so the every-minute `willo-invite` sweep takes them to Documents as ADR-0118 describes: login, E3, `willo_decided_via = 'spudbros'`. The same goes for people already waiting. The migration marks them, and the next sweep moves them.
- **No Willo invitation in the meantime.** `willo_invite_due()` leaves out anyone `spudbros_listed_by_name()` names, so a sweep that failed before marking still cannot invite them.

## Consequences
- A THC applicant who shares a first name and surname with a SpudBros person on the list, who has not applied, is marked SpudBros and skips the interview. The board card says so ("No interview — SpudBros Express"), and the audit names the list row. Unticking SpudBros on their profile sticks: anyone the office has placed is never marked by name again. This risk is taken so that no SpudBros person is sent the interview, which is what the owner asked for. It follows ADR-0107's rule that the restrictive outcome wins.
- A Willo invitation already sent stays in Willo, as for the nine in ADR-0118. A later Willo decision is applied as before.
- One more pass over the list per sweep: about 900 rows against the handful of candidates awaiting the interview, on two name keys.
- pgTAP `814_spudbros_listed_by_name.sql`.
