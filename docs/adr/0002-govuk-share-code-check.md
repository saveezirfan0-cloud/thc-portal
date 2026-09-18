# ADR-0002 · gov.uk share-code check without a public API

**Status:** Proposed — decide at kick-off

## Context
§2.3/§2.6 say the system "queries gov.uk itself" with share code + DOB and stores the PDF report and the right-to-work-until date. The gov.uk employer service ("View a job applicant's right to work details") is a web form with no published API for employers.

## Options
1. **Assisted manual check (recommended for v1).** The Staff App validates the code format; the Back Office shows a "Run gov.uk check" button that opens the gov.uk page with the code pre-filled (DOB copied to clipboard), the manager saves the result PDF into the candidate's profile, and the extractor reads the expiry date from it. The date is still never typed by hand. Zero legal/ToS risk; adds ~1 minute of manager time per candidate.
2. **Browser-automation worker.** A headless-browser job performs the check and downloads the PDF. Fully automatic but fragile to gov.uk changes and possibly against its terms of use.
3. **Third-party RTW provider API** (e.g. an IDSP/RTW vendor) that returns the gov.uk result. Automatic and supported, but a paid dependency THC would own.

## Decision
Pending THC. The interface `RightToWorkChecker` in `supabase/functions/rtw-check` is written so that any option is a drop-in; the wireframes show the assisted flow (candidate profile → "Run gov.uk check" → PDF card).
