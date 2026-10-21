# ADR-0179 · The office gets a hidden copy (BCC) of every timesheet sent to a client

**Status:** Accepted · 21.10.2026 · **Adds to:** §11.4 ("the addresses come from the client card
(§9.7)") and §9.12 (senders) · **Builds on:** ADR-0074 (the event-documents job), ADR-0088 (the
"(updated)" resend), ADR-0089 (recipients per event), ADR-0026 / ADR-0004 (the client reads views
only) · **Asked by:** THC, 21.10.2026, for go-live: "Sam should receive a copy of every timesheet
document sent to clients, without clients seeing Sam's address."

`supabase/migrations/20261022160000_document_office_copy.sql` · pgTAP `914` ·
`packages/notifications/src/office-copy.ts`, `documents.ts`, `resend.ts`, `drain.ts` ·
`apps/office/app/settings/OfficeCopyBlock.tsx`, `officeCopy.ts`, `officeCopyActions.ts` ·
`apps/office/app/api/documents/[eventId]/send/route.ts`, `events/[id]/_components/DocumentActions.tsx`

## Context

The two client documents — the Allocation Timesheet (D1: automatic at 16:00 UK the day before
once the line-up is whole, resent "(updated)" after a change; and the Send button) and the
Completed Allocation Timesheet (D2: the Send button; its automatic send is off since
20261022120000) — went To the event's own recipients, else the client card's contact emails, with
a Reply-To. There was no CC or BCC, so the only way for the office to see what a client was sent
was to add itself as a recipient — which the client then sees, on the email and on the Client
Portal ("Timesheets go to", `client_events_v.timesheet_recipients`).

## Decision

1. **One setting, `settings.document_office_copy` = `{"emails": [...]}`**, 0–5 addresses, seeded
   empty (= off). Edited on /settings → General → **Office copy of timesheets** by whoever may edit
   settings today (owners: `office_can('settings')`, the restrictive `office_settings_*` policies);
   every change is a `settings.update` audit row (`settings_audit`). A database guard
   (`settings_document_office_copy_guard`) stores the list trimmed, lower-cased and de-duplicated,
   and refuses another shape, a sixth address or one that is not an email (`22023`). A client or a
   worker cannot read the row (the `admin_all` policy).
2. **Every D1 and D2 email carries it as BCC**: the manual Send (`queue_event_document_email`), the
   automatic D1 and every "(updated)" resend (`queue_event_document_autosend`), and an automatic
   D2 should it be switched back on. Both functions, restated from their latest bodies
   (20261005140200), read `document_office_copy(to)` — the setting less anyone already in To,
   compared lower-case — and add it to the outbox row's payload as `bcc` (no key at all when there
   is nobody to copy). The row is the record of who was copied; their answer names it too, and the
   event page's Send confirmation says "A hidden office copy goes to …" (office only).
3. **The drain sends `payload.bcc` as Resend's `bcc`** (`ResendEmail.bcc?: string[]`, only when
   non-empty), never as To or CC. `documentMessageFor` reads it as an envelope field — it is never
   a value the email's copy can print — drops anyone in To again, and fails the row if `bcc` is not
   a list of addresses.
4. **Nothing the client reads changes.** `event_document_recipients()`, `events.document_
   recipients`, `event_documents.recipients`, `client_events_v`, `client_account_v` and every other
   `client_*` view name the client's own recipients only; `notification_outbox` is admin-read only.
   pgTAP 914 reads every `client_*` view as the client and finds the copy address in none.

## Consequences

- To switch it on: /settings → General → Office copy of timesheets → type the address (one per
  line, up to 5) → **Save office copy**. Clear the box and save to switch it off.
- The setting is read when an email is **queued**, not when it is sent: a row already in the outbox
  keeps the copy list it was queued with, and a change applies from the next send on.
- An address that is both a copy address and one of the event's recipients gets the email once, in
  To — the client chose it, so it is not hidden from them.
- Each copy address is one more recipient of the same Resend email (one send, one outbox row, one
  idempotency key) — not a second email. An event's To list is at most 10, so 15 in all.
- **Not in scope:** invoices (INV1) carry no office copy. The same `payload.bcc` would carry one if
  THC asks: `queue_invoice_email` and `resend_invoice_email` add `document_office_copy(to)` to
  their payload, and nothing else changes.
- **With PR #295** (a real `cc` on invoices): its `cc` and this `bcc` are parallel fields on
  `ResendEmail`, `EmailWithAttachments` and the payload, placed so the two merge without conflict.
  Once both are in, a BCC address that is also a CC address would get the email twice; nothing
  today puts a CC on D1/D2, so that case does not arise.
