# ADR-0203 · A client can be left out of invoicing

**Status:** Accepted (request of THC, 23.10.2026) · amends ADR-0172 (Ready to invoice) and ADR-0176 (invoices sent) · scope §9.9

## Context

THC asked whether Leonardo Hotel St Paul's M&E could be excluded from the invoicing system: that client is invoiced outside the platform. Until now every event with shift lines was listed on Ready to invoice, and the daily job issued an invoice for any un-invoiced event of any client.

## Decision

1. `clients.exclude_from_invoicing` (default false), set from the client card's **Invoicing** row through `set_client_exclude_from_invoicing()` (admin only, audited as `client.exclude_from_invoicing`).
2. While on, the client's **un-invoiced** events are not listed by `invoice_events()`, so they cannot be signed off or exported (`sign_off_event_invoice` and `invoice_export_rows` read that list), and `_invoice_groups()` never makes them a candidate, so no invoice number is taken and no INV1 email is sent. An event already on an invoice stays listed as invoiced.
3. Invoicing only. Payroll, worker pay, holds, the Financial tab's forecast and every report are unchanged.
4. Switched on by the migration for the client card named Leonardo Hotel St Paul's M&E (matched like ADR-0081); any other card is the same switch on its client page.

## Consequences

- Turning it on mid-way leaves already-issued invoices untouched; turning it off makes un-invoiced events appear again (from the job's go-live date).
- **Raise with THC:** whether the Financial tab's "Client invoicing" forecast should also leave the client out. It is left in, because it is a revenue forecast rather than an invoice.
