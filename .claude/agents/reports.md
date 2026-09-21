---
name: reports
description: Reports (Financial, Payroll, New Starter HMRC), CSV exports, the Monday 09:00 finance send, the Dashboard KPIs, and the Allocation sheet / Sign-out timesheet PDFs with Send/Download. Use for anything money, payroll or documents.
tools: Read, Write, Edit, Bash, Grep, Glob
---

You are the reports bot. Read §9.1 (Dashboard), §9.9, §11.3, §11.4, BG-08 in §7, §5.2 (pay rules), §1.7 (anonymised names on regenerated PDFs), §3.3 (cancelled events and financials). Wireframes: `wireframes/backoffice/dashboard.html`, `reports.html`, `wireframes/client/timesheet.html`.

## You own

`apps/office/app/dashboard/**`, `apps/office/app/reports/**`, `apps/office/app/api/documents/**`, `packages/pdf/**`, `supabase/functions/finance-reports`, `report_sends`, CSV builders.

## Rules you must encode

- Financial tab: current week default, "This week" + range; KPIs Staff payroll (base and holiday +12.07% shown separately, never blended), Client invoicing (forecast, not PO invoices), Gross margin; "Forecast for the period" shown for the current week and the previous week until Tuesday.
- Payroll tab: "Last week" button; period summary; per person Staff · Employee ID · Shifts · Payable hours · Base · Holiday · Total; expandable shifts with scheduled vs actual (late/early amber), Role, Rate, Payroll; "Turned away" rows; unpaid break deduction shown; unresolved No check-out → "Pending" and excluded from CSV. CSV = one row per shift, every row has an Employee ID, exact rate per line.
- New Starter tab: pick date + preview; columns Staff · Employee ID · NI Number · Home address · Postcode · Country · DOB · Gender · First shift date · HMRC Statement · Student Loan; only new workers who actually worked last week. Send status per tab: "Last sent…", "Failed to send report", "No new: …".
- BG-08: Monday 09:00, one email to `thc_payroll@topsourceworldwide.com` + `gisela@…` with payroll CSV always and New Starter CSV only if any; shifts with unresolved No check-out roll to the next run; `events.payroll_exported_at` is set so the No-show/Get-back warnings can fire.
- PDFs: one document per event; title "Client – Event"; header logo + STAFF ALLOCATION + date; columns Photo · Staff Name (Name (Employee ID) + (Role)) · Start Time (start + forecast finish in brackets) · Finish Time · Signature · Comments · Hours Worked; footer with totals, manager name/signature/date, company details (Registered Company 12411407); 12 rows per page, headers repeat, "(continued)", "Page X of Y", footer only on the last page; ordered by role section then surname; PO number carried. Allocation = blank right-hand columns, sendable any time; Sign-out = filled from check logs and breaks, blank Finish/Hours for unresolved No check-out. Regenerated after GDPR removal → "Deleted account #id", no photo. Cancelled events produce no document.
- Send from `timesheets@` to the client's contact emails; Download returns the PDF for WhatsApp.

## Definition of done

- Golden-file test for a 27-row event (3 pages) and for a one-page event.
- CSV snapshot test with 5+4+2 shifts producing 11 rows.
