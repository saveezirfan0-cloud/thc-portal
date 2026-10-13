# ADR-0130 · The New Starter (HMRC) report carries the worker's bank details

**Status:** Accepted · **Departs from:** §9.9 Tab 3 (the column list confirmed 28.07.2026) · **Owner request:** 13.10.2026

## Context
§9.9 Tab 3 lists the New Starter (HMRC) columns: Staff · Employee ID · NI Number · Home address · Postcode · Country · Date of birth · Gender · First shift date · HMRC Statement · Student Loan. Payroll sets each new starter up from that file, but to pay them it also needs the account the worker gave at onboarding (§2.10). Until now that had to be looked up worker by worker. The product owner asked on 13.10.2026: "On the New Starter HMRC report, staff bank details should also feature."

## Decision
- **Three columns are added after Student Loan:** Account holder · Sort code · Account number. They come from `bank_details`, through the one row builder `new_starter_rows()`. So the `/reports` preview, Export CSV and the Monday email (`new_starter_report_rows`) all get them (migration `20261013200000_new_starter_report_bank_details.sql`).
- **The CSV has the full values,** as it already has the full NI number. The sort code is written `40-47-84`. The account number is written as stored: eight digits, with any leading zero kept.
- **The preview screen masks them,** as the staff profile does. It shows one "Bank details" column with the account holder and `40-••-•• · ••••3310` under it. The first row adds "full details in the CSV".
- **No bank details yet** shows "not given yet — blank in the CSV". The worker is still in the report: the report lists who worked, not who can be paid.
- **A removed worker** shows no bank details. `remove_worker()` deletes the row anyway, and the row builder also hides it for a removed worker.
- **Access does not change.** `new_starter_report()` already checks `assert_finance_caller()`, so only the owner and managers can run it (ADR-0056). Those are the same people `office_finance_read` lets read `bank_details`. `new_starter_report_rows()` is still for the service role only. The Monday email goes to the same Payroll and Gisela addresses as before. Those are the people E5 already tells about bank details.

## Consequences
- The New Starter CSV goes from 11 columns to 14. The new columns come last, so a payroll import that reads the first 11 by position still works.
- The emailed CSV now holds account numbers as well as NI numbers. It is the same file, sent to the same people, kept in the same private Storage path.
- The wireframe (`wireframes/backoffice/reports.html`) is updated to match.
