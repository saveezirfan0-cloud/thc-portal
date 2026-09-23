# ADR-0015 · Where the §9.9 money lives, and how a file-carrying email is sent

**Status:** Accepted, 23.09.2026 — B11/B12 (reports, BG-08, the §11.3 PDFs).

## Context

§9.9 and BG-08 need one answer to "what is owed for this shift", used by three screens,
three CSVs and a Monday job. §11.4 and BG-08 also need to email FILES, which the §8
register and `messageFor()` were never shaped for. And §9.9's New Starter columns name
three fields nothing in the schema collects.

## Decisions

1. **Money is priced once, in SQL, per shift.** `report_payroll_lines_v`
   (20260923130000) reads `payable_shifts_v` and prices each line: base =
   `round(payable_min × rate / 60, 2)`, holiday = `round(base × 0.1207, 2)` — the SQL
   twin of `pay()` in `packages/domain/src/pay.ts`, so the export and the worker's
   earnings round the same way. Totals are sums of priced lines. The §9.1 dashboard's
   weekly *forecast* uses `final_rate() − base` per hour instead; on a forecast the two
   differ by pennies, and Payroll is what finance pays from.
2. **A payroll export is a fact.** `payroll_export_lines` records each exported shift
   with its figures as sent, never updated; a partial unique index allows one export per
   booking. Unresolved No check-outs are recorded as `held` and roll forward. A later
   change is shown on /reports beside the exported figure, never corrected.
   `events.payroll_exported_at` is still set (the §3.3 warnings read it), and
   `booking_payroll_exported(booking)` gives the exact per-shift answer.
3. **File-carrying emails are a second, small register** —
   `packages/notifications/src/documents.ts`: `BG08` (finance, from admin@, to the E5/E6
   payroll addresses), `D1` allocation sheet and `D2` sign-out timesheet (from
   timesheets@, to the client card's contacts). They go through `notification_outbox`
   like everything else, with attachments as **storage references**
   (`{bucket, path, filename}` in `payload.attachments`), never content. `TEMPLATES`
   stays exactly §8. **The P2 drain must route** `isDocumentEmail(row.template)` to
   `documentMessageFor(row)`, download each attachment with the service key, and send via
   Resend with attachments. `messageFor()` still rejects these codes, so a drain that
   forgets fails loudly. A trigger on `notification_outbox` copies sent/failed onto
   `report_sends` and `event_documents`, which is what "Last sent" / "Failed to send
   report" (§9.9) read.
4. **`staff.gender`, `home_postcode`, `home_country`** are added nullable (`if not
   exists`) for the HMRC report. Onboarding (S2) should write them; until then postcode
   falls back to the UK postcode at the end of `home_address` and the others print blank.
   A trigger wipes them on GDPR removal, so `remove_worker()` did not need editing.

## Consequences

- Until P2 ships (and `RESEND_API_KEY` + the two verified senders exist), BG-08 and Send
  run end to end up to a queued outbox row, and the UI says "Queued", not "Last sent".
- Known imprecision: an event-level `payroll_exported_at` makes `resolve_violation()`
  warn "will not add the payment" when a HELD shift is resolved, though that shift will
  in fact be paid next Monday. The fix is one line in the check-in domain:
  `v_exported := booking_payroll_exported(b.id)`.
