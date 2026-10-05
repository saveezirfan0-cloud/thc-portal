# ADR-0087 · A client can have up to ten contact emails

**Status:** Accepted (owner request, 05.10.2026, while loading the client list: Hackney Town Council names six contacts and the limit was five "increase limit"). Deviation from scope §9.7, which says several emails are allowed "(2–3 people)" without fixing a ceiling; the ceiling of 5 was ours (`0001_init.sql`).

## Decision

`clients.contact_emails` holds 1–10 addresses (`clients_contact_emails_check`, migration `20261005120000`). `MAX_CONTACT_EMAILS` in `apps/office/app/clients/validate.ts` is 10 and the form's message follows it.

## Consequences

- Every address still receives the Allocation Timesheet and the Completed Allocation Timesheet (§11.4); a larger list means a wider send, so the office should keep it to the people who need the document.
- Widening a CHECK cannot fail on existing rows; nothing is backfilled.
- The ceiling stays: an unbounded list would let one mistyped paste queue hundreds of sends.
