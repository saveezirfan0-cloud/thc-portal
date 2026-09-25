# ADR-0002 · gov.uk share-code check without a public API

**Status:** Superseded by ADR-0025 (25.09.2026) once its automated check is switched on. THC chose options 3 and 2 together: a right-to-work provider's API first, our own gov.uk browser check as the fallback, fully automatic — built behind a `RightToWorkChecker` interface in `apps/office/app/api/jobs/rtw-check/_lib/checker.ts` (a Node route, not an Edge Function: Chromium cannot run on Supabase's Deno runtime). Until THC's provider keys exist it ships switched off, and option 1 below — the assisted check, rewritten to describe the real seam — is what runs. **Built on by:** ADR-0014 (wizard seams), ADR-0018 (the date is confirmed on Verify).

## Context
§2.3/§2.6 say the system "queries gov.uk itself" with share code + DOB and stores the PDF report and the right-to-work-until date. The gov.uk employer service ("View a job applicant's right to work details") is a web form with no published API for employers.

## Options
1. **Assisted manual check.** The Staff App validates the code format; the office runs the gov.uk check by hand, saves the result, and the right-to-work-until date is read off the report rather than typed. Zero legal/ToS risk; adds about a minute of manager time per candidate.
2. **Browser-automation worker.** A headless-browser job performs the check and downloads the PDF. Fully automatic but fragile to gov.uk changes and possibly against its terms of use.
3. **Third-party RTW provider API** (an IDSP/RTW vendor) that returns the gov.uk result. Automatic and supported, but a paid dependency THC would own.

## Decision

Option 1, built as follows. There is no Edge Function and no separate checker interface; the seam is the document row and the extractor that every other document already uses.

- **The worker supplies the code, never the manager.** `packages/domain/shareCode.ts` validates the format (§2.5, corrected 31.07.2026) in the wizard, and step 4 in a share-code branch files a pending `compliance_docs` row of type `share_code_report` carrying the code (`apps/staff/app/onboarding/actions.ts`, ADR-0014). Nothing waits on it on the worker's side.
- **The office confirms the date on Verify.** `ShareCodeCard` on `/onboarding/:id` and the Needs review row on `/compliance` show the code with "entered by the candidate in the app with DOB — never by the manager", open the saved PDF where there is one (`gov_report_path`), and take the right-to-work-until date. ADR-0018 makes that date mandatory: a `share_code_report` cannot become `verified` without it, and on the EU branch settled status is an explicit "no time limit" tick. The worker's `right_to_work_until` is the earliest across their verified evidence.
- **The date is pre-filled, not typed, once the extractor exists.** `record_document_extraction()` (service role only, `20260923120000`) pre-fills `right_to_work_until` on a share code report the same way it pre-fills a visa expiry, so when the `DocumentExtractor` provider in `apps/staff/app/onboarding/extractor.ts` is written (ADR-0014: stubbed until `GEMINI_API_KEY` and THC's samples exist) the manager is confirming a date the system read — §2.3's "nobody types the date by hand" intent. Until then the manager enters it from the report, which ADR-0018 records as the deviation.
- **Options 2 and 3 plug in behind the same row.** An automated check would write the report PDF to the `documents` bucket, set `gov_report_path` on the pending row and call `record_document_extraction()` with the date; nothing on either screen changes. That is the "drop-in" the original ADR wanted, without an interface nobody calls. (ADR-0025, which built them, keeps the row as the seam but goes one step further, as THC decided: a passing check VERIFIES the row through the same Verify the office uses, with a system actor, rather than pre-filling a date for a manager to confirm; and its interface is called — by the job route.)

## Consequences

- Nothing in `supabase/functions/` is owed for this. docs/01's row for the check and `.claude/agents/onboarding.md`'s owned-paths list (which still names `supabase/functions/rtw-check` and `supabase/functions/extract-document`) should follow this ADR.
- The scope's "the system queries gov.uk itself" is not literally true while ADR-0025's check is off; the wireframes' assisted flow (candidate profile → gov.uk report card → Verify with the date) is what runs. THC asked for options 3 and 2 on 25.09; ADR-0025 records the build.
- Workers verified on a share code before ADR-0018 have no date; the query that finds them is in the header of `20260923200000` and the office re-verifies them.
