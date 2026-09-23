# ADR-0018 · The right-to-work date is confirmed on Verify, and one Verify serves both screens

**Status:** Accepted (migration `20260923200000`, pgTAP 460–461) · **Builds on:** ADR-0002 (gov.uk share-code check), ADR-0012 (completion letter and rota guard), ADR-0014 (wizard seams)

## Context
`/onboarding/:id` and `/compliance` each had their own Verify on the same pending documents. The onboarding one verified expired documents and those of Rejected / Removed profiles, and neither put a right-to-work date on the worker: nothing copied a visa or status document's expiry onto `staff.right_to_work_until`, the extractor seam skipped the share code report, and neither screen asked for the date. `can_roster_staff()` reads a NULL date as "no expiry recorded", so for every non-UK worker the per-shift hard stop, the `rtw_daily` CL4 alerts and the rota guard's `rtw_expired` never fired.

§2.3 says of the share code that "nobody types the date by hand" — the system queries gov.uk. ADR-0002 found no employer API and chose an assisted check in which the office saves the report and the extractor reads the date off it. That extractor is not written yet (ADR-0014).

## Decisions
- **One body.** `verify_document()`, `reject_document()`, `verify_declaration()` and `reject_declaration()` are wrappers over the `compliance_*` functions with their original signatures. Both screens raise the same refusals, stamp the same reviewer and queue the same N8.
- **The date is required, on the row.** A visa document, status document or share code report cannot become `verified` without the date it confirms (`compliance_docs_rtw_date_guard`), whatever path flips it.
- **The worker's date is the earliest across current verified evidence** (latest verified visa, status document and share code), written by a row trigger on every verify. A renewed visa with a stale share code does not extend the right to work.
- **Per branch (§2.5):** UK / Irish has no limit. On the EU branch a share code may be confirmed as **settled — no time limit** (pre-settled has an expiry, §2.5 pt 2); it is an explicit tick, sent as the date `infinity` and stored as `rtw_no_time_limit`, never inferred from a blank date. Work visa, international student and dependant / other always need a date: the scope gives each of them an expiry with no exception.
- **Deviation from §2.3's wording.** Until the extractor reads the gov.uk report, the reviewer confirms the right-to-work-until on Verify, and enters it from the report when nothing pre-filled it. `record_document_extraction()` now pre-fills `right_to_work_until` on a share code report, so once the extractor is live the manager is only confirming a date the system read — the scope's intent.

## Consequences
- Non-UK workers verified from now on carry a right-to-work date, and `canRoster()` stops them after it.
- Workers verified before this migration with a dated document were backfilled (tightening only). Those verified on a share code with no date still read as NULL. The migration header has the query that finds them, and the office has to re-verify them.
- A live Verify of those three document types opens a date confirmation on both screens.
