# ADR-0168 · Ready to invoice: a per-event sign-off and a CSV of what may be invoiced

**Status:** Accepted · 19.10.2026 · **Departs from:** §9.9 ("Invoicing here is a revenue forecast
for the period, NOT the PO-based invoices. THC has its own invoicing process") · **Builds on:**
ADR-0056 (office roles, finance-only money), ADR-0060 (the viewer writes nothing), ADR-0074 (the
Completed Allocation Timesheet held for an unresolved No check-out), ADR-0163 (definers pinned by
name) · **Asked by:** THC, 19.10.2026, for go-live

`supabase/migrations/20261021100000_ready_to_invoice.sql` · pgTAP `899` (and `001`, `892`
follow) · `apps/office/app/reports/_components/InvoicingTab.tsx` ·
`apps/office/app/reports/invoicing/[eventId]/` · `packages/pdf/src/csv.ts` (`invoiceCsv`)

## Context

THC asked to "look at the invoicing after the event, once everybody has successfully signed out
and there are no violations". §9.9 keeps invoicing out of the system, and THC still invoices
from its own accounting tool. What the office lacked was the step before that: knowing which
events are finished and settled, and having their lines in a form it can key in.

The money already existed. `report_payroll_lines_v.invoicing` prices every shift at payable
minutes (RULE-01, breaks deducted) × the section's charge rate. A turn-away and a no-show are
never charged, and an event cancelled on the day is charged in full (§3.3). The Financial tab sums it
by day, client or role as a forecast. Nothing summed it per event, and nothing said when an
event's figure was final.

THC chose (19.10.2026):

1. **A ready-to-invoice list and a CSV**, not PDF invoices and not a push to accounting software.
   The system still issues no invoice: no invoice number, no VAT, no email to the client.
2. **Every violation reviewed** before an event is ready, not only the missing check-outs.
3. **A manager's sign-off** as the review. Resolving every violation would not work, because
   resolving a No-show is "Get back" (§9.5). It registers the worker as arrived, so a genuine
   no-show would be charged to the client and its show-rate penalty cleared.

## Decision

`invoice_events(from, to)` gives one row per event dated in the range that has shift lines. Its
status is the first of these steps that fails:

| Status | Rule | What the manager does |
|---|---|---|
| **Check-out open** | `now()` is before the last section's end + 4 h (RULE-02) | Nothing yet: a worker can still check out |
| **Missing check-out** | a line is pending (its hours are unknown), or any No check-out is unresolved, including one raised on a stale fix that recorded a finish (D15, ADR-0035), which is never invoiced on that default (RULE-02) | Resolve it on /checkin with the actual finish time |
| **Needs review** | no sign-off, or the sign-off is stale | Review every violation and the lines, then **Mark reviewed for invoicing** with a note |
| **Ready to invoice** | signed off and nothing has changed | Export the CSV; invoice from THC's own tool |

- **The sign-off** (`event_invoice_signoffs`, `sign_off_event_invoice`) is for owners and
  managers. It needs finance (`assert_finance_caller`) and write (`office_can('write')`), and the
  viewer guard on the table refuses a viewer regardless. The note is mandatory, as for every
  violation resolution (§9.5). Each sign-off is written to `audit_log` as `invoice.signed_off`.
  The page reads the event's verdict and fingerprint before its lines and violations, so what
  the manager sees is never older than the fingerprint they sign. The fingerprint is a
  concurrency check, not proof that anyone looked: an owner or manager is trusted to.
- **Stale by fingerprint.** The sign-off stores an md5 over every violation on the event (id,
  type, resolved, minutes late, finish time, resolver, note) and every line (booking, kind,
  status, check-in, check-out, break, payable minutes, charge rate, amount). The PO Number,
  client and title are not in it: the event edit lock fixes them once the event has started.
  Anything that changes after the sign-off sends the event back to Needs review: a violation
  raised, resolved or voided (ADR-0151), or a check-in/out corrected. The screen sends the
  fingerprint it was drawn from, and the database refuses the sign-off if it no longer matches
  (`changed_since_viewed`). Nobody signs off figures they did not see.
- **No-shows do not block.** They stay in the review list unresolved, are counted, and are never
  charged. Only a No check-out must be resolved, because only it leaves the finish unknown.
- **The CSV** (`invoice_export_rows`, `invoiceCsv`) has one row per billable shift (worked, or
  cancelled on the day) of every READY event: date, client, event, PO Number, Employee ID, staff,
  role, scheduled window, check-in/out, break, payable hours, charge rate and amount. A total row
  closes each event, with its figure in a separate Event total column so that summing the Amount
  column never double-counts. It carries no pay rate. Events that are not ready contribute nothing.
- **Where it lives:** a fourth tab on /reports, opening on last week (exported Monday, invoiced
  by Tuesday evening, §9.9), and `/reports/invoicing/:eventId` for one event. Both are
  finance-only, like the rest of /reports.

## Consequences

- §9.9's Financial tab is unchanged and is still a forecast. Its "Client invoicing" and this
  tab's amounts are the same figure, priced in the same view.
- Five new definers are callable by `authenticated` (198 in total, docs/14 §4). Each checks its
  caller in its own body, and all are closed to anon and PUBLIC.
- The client sees nothing new. There is no client policy on the new table (ADR-0004, ADR-0026),
  and the Client Portal carries no money (§11.1).
- No wireframe exists for the two screens. They are built from the Reports components and
  tokens. A wireframe can follow if THC wants the layout changed.
- **Open, for THC:** whether a sign-off should also be needed before the Completed Allocation
  Timesheet goes to the client (D2, ADR-0074). Today D2 waits only for the No check-outs, as
  §11.3 says.
