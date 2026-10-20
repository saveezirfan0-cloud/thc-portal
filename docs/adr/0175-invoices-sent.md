# ADR-0175 · Invoices: numbered from 4000, one per PO, emailed at 10:00 the next morning with the completed timesheets

**Status:** Accepted · 20.10.2026 · **Supersedes in part:** ADR-0172 ("The system still issues no
invoice: no invoice number, no VAT, no email to the client"; and "every event needs a manager's
sign-off", which now applies only to an event with a violation) · **Departs from:** §9.9 ("THC
has its own invoicing process") · **Builds on:** ADR-0056 (finance-only money), ADR-0060 (the
viewer writes nothing), ADR-0074 (the event-documents job, D2), ADR-0163 (definers pinned by
name) · **Asked by:** THC, 20.10.2026, with its own invoice as the example

`supabase/migrations/20261022100000_invoices_sent.sql` · pgTAP `909` (and `001`, `892`, `856`,
`902` follow) · `packages/pdf/src/invoice.ts`, `InvoiceDocument.tsx` ·
`packages/notifications/src/documents.ts` (INV1) ·
`apps/office/app/api/jobs/event-documents/_lib/invoices.ts`, `sendInvoice.ts` ·
`apps/office/app/api/invoices/[invoiceId]/route.ts` · the client card's **Invoicing** panel ·
`/settings` → **Invoicing**

## Context

ADR-0172 gave the office a list of events that were finished and settled, plus a CSV to key
into THC's own tool. THC then asked for the system to issue the invoice itself. It sent its own
invoice (PO 714981, Mandarin Oriental Hyde Park) as the example, and said:

- "The events need to be invoiced on a per event basis / or per PO Number."
- "The actual sign in and sign out report relating to that event … also needs to be attached
  when the invoice is sent out."
- "The completed sign in and sign out timesheet needs to be attached to the invoice and sent
  out at 10:00 the following morning. The invoice numbering should start from 4000."

Asked on 20.10.2026, THC chose:

1. **A clean event is sent by itself.** An event with no violations needs no sign-off. An
   event with a violation waits for the ADR-0172 sign-off, then goes out on the next run.
2. **One invoice per PO**, sent at 10:00 the morning after the PO's **last** day.
3. **A new accounts contact on the client card**: a name, up to five invoice emails and a
   billing address. If no invoice email is set, the client's contact emails are used.
4. **Both emails are kept.** The D2 Completed Allocation Timesheet email is unchanged.

## Decision

**Grouping.** An invoice covers one (client, PO Number), with the PO compared trimmed and in
upper case. An event with no PO is invoiced on its own. A PO's invoice takes its events dated
within `po_window_days` (7) of the earliest one not yet invoiced. So a PO a client reuses next
month starts a new invoice rather than holding this one open. Each event is linked to one
invoice, once (`invoice_event_links.event_id` is the primary key).

**When.** `_invoice_groups(now)` gives each group a verdict. They are checked in this order:

| Verdict | Meaning |
|---|---|
| `disabled` | `settings.invoicing.enabled` is off |
| `waiting` | an event in the group is still running, or inside its check-out window |
| `missing` | a check-out is unsettled (always holds the invoice) |
| `review` | an event has violations and no sign-off, or it changed after its sign-off |
| `nothing_to_invoice` | the group's net is £0 |
| `scheduled` | it is not yet 10:00 UK on the day after the last event |
| `no_recipients` | the client card has no invoice email and no contact email |
| `due` | issue and send it now |

Only events dated on or after `settings.invoicing.first_event_date` (26.10.2026, go-live) are
ever candidates. So switching this on never invoices past events.

**Issuing.** The event-documents job runs every 15 minutes (ADR-0074). After D1/D2 it does
three things in order:

1. It finishes any invoice an earlier run issued but did not send (`invoices_unfinished`: a
   10-minute lease, at most 24 attempts).
2. It claims each `due` group with `invoice_claim`. The claim re-checks the verdict under an
   advisory lock. In the same transaction it takes the next number from `invoice_counter`
   (starting at 4000, gapless), snapshots the settled lines, the bill-to and the seller, and
   works out VAT as round(net × rate / 100, 2). It is audited as `invoice.issued`.
3. It draws the invoice PDF and, for each event, a fresh Completed Allocation Timesheet. A
   cancelled event has no timesheet (§3.3) and is invoiced without one. The files are stored
   in the private `timesheets` bucket under `invoices/<number>/<stamp>/`, with a new folder
   on each attempt. The job records them and queues **INV1** (`notification_outbox` key
   `INV1:<number>`, sent from timesheets@). On any failure the invoice is released for the
   next run. The number is kept, so it is never left without its email.

An issued invoice is final. `sign_off_event_invoice` refuses an invoiced event
(`already_invoiced`). A correction is a credit note in THC's own tool.

**The document** follows THC's example:

- The company block (reg 12411407, VAT 388046760), Invoice to and Invoice details (number,
  date, event dates, PO).
- One line per shift: date, staff, role, UK start/end (24-hour), break, hours, rate and total.
- Totals, VAT (20%) and TOTAL DUE.
- The Lloyds payment details, "Payable Within 7 Days from Date of Invoice", the late-payment
  wording and "Thank you for your business".

Every value is in `settings.invoicing` and can be edited on `/settings` → Invoicing.

**The office.** Reports → Invoicing gains an **Invoiced** tile and status. An invoiced row links
to its PDF (`/api/invoices/:id`, finance only, the stored bytes). A ready row says when it will
be sent, or why it will not. The event page shows the invoice and keeps the sign-off form for
events that need review.

## Consequences

- THC must fill in each client's accounts contact, invoice emails and billing address on the
  client card before 27.10.2026. Until then invoices go to the contact emails, with no billing
  address under "Invoice to".
- Invoice numbers are gapless and in issue order, not event order.
- The client receives two emails for an event: D2's timesheet and the invoice, which attaches
  the same timesheet.
- The four new tables (`invoice_counter`, `invoices`, `invoice_event_links`, `invoice_lines`)
  are readable only by admins with finance, and the viewer writes none of them (the `office_read_only` trigger). Two definers are added for
  `authenticated`: `set_client_invoice_details` (admin with write, audited) and
  `invoice_file` (finance). The rest are service role only.
