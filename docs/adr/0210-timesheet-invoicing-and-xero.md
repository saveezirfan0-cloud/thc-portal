# ADR-0210 · Timesheet invoicing moves into the Back Office; every invoice goes to Xero

**Status:** Accepted (request of THC, 24.10.2026) · **Departs from:** §9.9 ("THC has its own invoicing process") · **Builds on:** ADR-0176 (invoices sent, numbered from 4000), ADR-0203 (a client can be left out of invoicing), ADR-0056 (finance-only money), ADR-0060 (the viewer writes nothing), ADR-0033 (AI document extraction) · **Source:** `docs/legacy-invoicing-audit.md` (audit of thc.northerncodes.com, 24.10.2026)

`supabase/migrations/20261027100000_timesheet_invoicing.sql` · pgTAP `939`

## Context

THC runs two invoicing systems. The Back Office issues an invoice for each PO from the sign-in / sign-out
log of events scheduled on the platform (ADR-0176). A separate tool built by Northern Codes
(thc.northerncodes.com) issues invoices from **timesheets uploaded by the office**: scanned paper sheets
(Leonardo Hotel St Paul's M+E) and the export of Taster's own rota system (Taster Liverpool, Taster
London, All Taster). None of the three schedules on this platform. The two systems number
separately (the old one is at 3258, last invoice 3256), neither pushes to Xero (the audit found no
connection), and the old one has no payment, credit-note or reminder features.

THC asked (24.10.2026) for the old system to be added to the Admin Portal so invoicing is under one roof,
in the Back Office branding, with **one invoice-number series** and **every invoice flowing into Xero**.

## Decision

1. **A second source of invoices, the same `invoices` table.** `invoices.source` is `events`
   (ADR-0176, unchanged) or `timesheet`. Both take their number from the one `invoice_counter`, in the
   transaction that creates the invoice, so the series is gapless across both and runs on from 4000.
   THC chose to **keep 4000**: the old system's 3257 onwards is never used by the platform, so the printed
   series jumps from 3256 (old tool) to 4000. The old tool must be switched off for these clients on the
   day the first number is taken here, so the two never issue in parallel.
2. **A client is invoiced either from events or from timesheets** (`clients.invoicing_mode`). Setting a
   client to `timesheet` also sets ADR-0203's `exclude_from_invoicing`, so the daily job never takes a
   number for it. The migration sets Leonardo Hotel St Paul's M&E, Taster (Liverpool and London) and
   All Taster to `timesheet` where a card of that name exists.
3. **The workflow of the old tool, as it is today** (audit §5): Upload → Review → Confirm → Generate →
   Email.
   - **Upload** one or more files (xlsx / xls / csv / PDF / image, 25 MB, 10 files) for a client.
   - **Extract:** spreadsheets are parsed directly (Taster's "All Employees" export: weekly hh:mm totals,
     one line per person per week, no start/end); scans and images are read by Claude vision (ADR-0033's
     extractor family — Anthropic, **not** the old tool's Azure resource, which belongs to the
     developer). Each row carries a confidence, the original reading and where in the source it came from.
   - **Review** against the source: edit cells, add rows, approve / reject, "Approve all clean". The
     client's excluded staff are rejected automatically; its default role fills a missing role column.
   - **Confirm:** split the approved rows into invoices, each with its own PO, invoice date, event date
     range and format. A PO already invoiced for the client is warned about.
   - **Generate:** takes the next number, snapshots bill-to / seller / VAT / terms, draws the PDF.
   - **Email:** the office composes the message (From, To, Cc, Bcc, subject, body, attachments including
     the original timesheet) and sends. The wording is the old tool's saved template.
4. **Amounts.** One line per row: `hours × charge rate × staff count`, **rounded to the penny per line**;
   the subtotal is the sum of the printed lines and VAT is `round(subtotal × rate, 2)`. This is a
   deliberate change from the old tool, which rounded once per invoice and so printed lines up to 1p out of
   step with the subtotal (13 lines on 9 invoices). Hours are to the minute (`4h03 = 4.05`). Expenses
   (train fares, travel receipts) are `custom` lines: description × quantity × unit price. There is no
   overtime, holiday uplift, discount or minimum-hours rule: none exists in the old data. Raise with THC if
   any client needs one.
5. **Invoice states.** `drawing → generated → queued (sent)`, `drawing/failed → failed`, and `void` from
   `generated` or `queued`. A voided invoice keeps its number, which is never reused. A `generated` invoice
   is final like a `queued` one: the number, money, bill-to and seller never change. A correction is a
   void and a new invoice, or a credit note raised in Xero (**raise with THC** which they want — the old
   tool's "Re-generate keeps the number" is not carried over because it rewrites an issued invoice).
   The event invoices' automatic job (`invoices_unfinished`) takes `source = 'events'` only.
6. **Xero.** Every invoice that reaches `generated` or `queued` is queued for Xero in `xero_sync`; a job
   pushes it as a **Draft** (THC's choice), `Type ACCREC`, `InvoiceNumber` = our number (Xero rejects a
   duplicate, which makes a retry safe), `Reference` = PO, `DueDate`, GBP, `LineAmountTypes` exclusive, one
   Xero line per invoice line with the configured sales account and 20% output tax type, and the PDF
   attached. The Xero contact is matched by name once and remembered in `clients.xero_contact_id`. Only
   numbers from `settings.xero.from_number` (default 4000) are pushed, so the history is never sent. A
   total that differs from ours by even a penny is marked `mismatch` for the office, not silently accepted.
   The connection is Xero's OAuth 2.0 authorisation-code flow, connected once from `/settings`; tokens
   live in a service-role-only table. Switched off until connected (`settings.xero.enabled`).
7. **Roles.** Finance callers that may write, like the rest of invoicing (ADR-0056, ADR-0060). Staff pay and
   margin, which the old tool showed, are **not** carried over: nothing in invoicing needs them and the
   worker-pay rate is not for the invoicing screens (**raise with THC**).
8. **Branding.** Screens use the Back Office tokens and the wireframe conventions. The PDF keeps the
   content and layout of the existing Back Office invoice (`packages/pdf`), with the old tool's two
   timesheet layouts — named staff (Date · Staff name · Role · Start · End · Break · Hours · Rate · Total)
   and role-aggregated (Date · Role · Start · End · Break · No. of staff · Hours · Rate · Total) — and a
   per-client date-column header (Taster's "W/C Date").

## Not carried over (audit §10)

The Azure OCR dependency; "Clear test data"; "Delete client permanently"; the all-powerful manager role
(the Back Office roles apply); the empty Invoice Preview; "Grouped Detail" (never used); the Google
Sheets / Drive stubs; Re-generate; the global payment-terms text (terms come from the client card, so
COMO's 30 days is honoured and a due date is printed).

## Awaiting THC

Credit notes; whether staff pay / margin is needed; the email From address (the old tool sent as Gisela
Duncan through Microsoft 365; the platform sends through Resend); the Xero account code, tax type and
organisation; whether the old history should be imported (it is not).

## Consequences

- One number series, one list, one Xero feed. Invoices already issued by the old tool stay there.
- `invoice_lines` no longer assumes an event or a booking; readers of it branch on `invoices.source`.
- The old tool can be switched off client by client once its three clients are issuing here.
