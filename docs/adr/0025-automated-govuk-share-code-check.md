# ADR-0025 · The gov.uk share-code check runs itself; an admin confirms it with one click

Status: accepted · 28.09.2026 · **supersedes ADR-0002** · **amends ADR-0018** · retention per ADR-0019

## Context

§2.3, §2.5 and §2.6 say the worker types their share code and date of birth, "the
system queries gov.uk itself", and stores the PDF report and the right-to-work-until
date, which then drives the reminder ladder. ADR-0002 found no employer API and
proposed an assisted manual check. What shipped under it: the worker's code files a
pending `share_code_report`, and the office runs the gov.uk check by hand and types the
date on Verify (ADR-0018).

The product owner chose, in order:

1. **No right-to-work provider.** A provider (an IDSP or RTW vendor) only runs the same
   Home Office check for a per-check fee. For the lowest cost the system drives the
   Home Office service itself.
2. **Option C: automated check, admin click.** Everything is automatic up to the
   decision. An admin compares the photo gov.uk shows with the worker's app selfie and
   clicks Verify or Reject. That includes "not found", which is **not** rejected
   automatically.

This replaces the earlier brief's "fully automatic" route (provider first, gov.uk
automation as fallback, auto-verify with no photo match). Because a person still checks
the photo against the individual, **THC does not have to accept the risk of skipping the
Home Office photo check.** Home Office guidance requires that check for the statutory
excuse against a civil penalty of up to £45,000 per illegal worker (£60,000 for repeat
breaches). Keeping a person on the decision also keeps the rejection out of UK GDPR
Article 22's "solely automated decision" territory.

The Home Office service is still necessary. For anyone who is not British or Irish, the
online check is the only source of the share-code result, and since physical residence
permits gave way to eVisas it is the only acceptable check for most of them. British and
Irish workers are not affected: branch 1 has no share code (§2.5).

## Decision

### The flow

1. **Queue.** A share code arrives two ways: the wizard's step 4
   (`onboarding_submit_documents`) and the Documents hub (`submit_document_upload`).
   Both insert a pending `share_code_report` row. An `AFTER INSERT` trigger on
   `compliance_docs` queues exactly one `rtw_checks` row for it. The row is unique on
   `document_id`, so a submission can never be checked twice. Neither submit function
   is restated. A replaced or decided document's queued check is cancelled.
2. **Schedule.** The `rtw-check` row in `job_schedules` runs every minute and ships
   **disabled**. The same switch gates queueing (`rtw_check_enabled()`): while it is
   off nothing is queued and the office keeps ADR-0002's manual flow. When it is
   switched on, earlier pending share codes are not queued; the admin presses
   "Run check again" on each.
3. **Runner.** pg_cron → `supabase/functions/rtw-check` (a relay) → `POST
   /api/jobs/rtw-check` on the Back Office.
   - The work runs on **Vercel's Node runtime**, because Playwright drives a real
     Chromium (`@sparticuz/chromium`), which no Supabase Edge Function can run.
   - The relay exists so the office URL (`OFFICE_BASE_URL`) and `RTW_JOB_SECRET` live in
     **Supabase secrets**, which no admin session can edit. A `settings.office_base_url`
     row would be admin-writable, and a bearer posted to an admin-writable URL is the
     hole `20260926130200` (the edge_base_url guard) closes for the service key.
     `install_job_schedules()` is untouched.
   - The route compares the bearer with `RTW_JOB_SECRET` in constant time over SHA-256
     digests. A secret under 32 characters counts as unset. The middleware exempts
     exactly this POST path from the session gate, and the route answers 401 to
     everyone else, a signed-in admin included.
   - Each call claims **one** due check (`claim_rtw_check()`, `FOR UPDATE SKIP LOCKED`;
     a check left running for 15 minutes is requeued) and gives it a 110-second budget.
4. **The check.**
   1. Playwright fills the Home Office form: share code, date of birth, and
      `RTW_COMPANY_NAME`.
   2. It saves the result as a PDF, using the service's own download when offered and
      otherwise printing the page, and screenshots the applicant's photo.
   3. **Claude** (`claude-opus-5`, structured outputs, `fallbacks: "default"`) reads the
      PDF into a fixed shape: page kind, found, has right to work, name, until date, no
      time limit, permission type, conditions and term-time weekly hours. The share code
      and date of birth are not sent to Claude.
5. **Assessment** (`@thc/domain` `assessRtwResult()`, pure). It decides what the office
   is shown, never what happens:
   - `pass`: found, right to work, the name matches, and the conditions fit the branch.
   - `name_mismatch`: never passed.
   - `conditions_mismatch`, which covers:
     - "no time limit" off the EU settled branch;
     - a term-time limit on a worker who is not on the student branch, or none on one
       who is;
     - gov.uk allowing fewer term-time hours than RULE-20 would calculate (10 h against
       a degree-level profile);
     - no readable date.
   - `not_found`.
   - `no_right_to_work`, including a date already past.
   - Form or other pages are **failures**, not results. An outage looks exactly like
     them.
6. **Record.** `record_rtw_check()` (service role only):
   - uploads first and records second, so a stored result never points at a missing
     file;
   - puts the PDF on the document's `gov_report_path`, where the existing "Open report"
     link, the staff profile and `remove_worker()` already look;
   - **pre-fills** `right_to_work_until` through `record_document_extraction()`, the AI
     seam every document uses;
   - writes an `audit_log` row `rtw.checked` with no share code or date of birth.

   **It never verifies or rejects.**
7. **Failures.** The error is redacted of the share code and date of birth, then
   `fail_rtw_check()` retries after 5 and then 10 minutes. The third failure, or an
   unrecoverable one (for example a rejected Claude key), is final, and the document
   shows "check by hand".
8. **Decision.** The admin uses the existing `verify_document` / `reject_document`
   (ADR-0018), so `assert_reviewer()` stamps a person on every review and N8 carries a
   rejection's reason to the worker.
   - On a `pass`, the date comes from gov.uk and is shown read-only.
   - Manual date entry is offered only when there is no passing check.
   - For `not_found` and `no_right_to_work`, the Reject box is pre-filled with a
     worker-facing reason (`rtwRejectReason()`), which the admin can edit.
   - "Run check again" (`rerun_rtw_check()`) is admin-only.
9. **What each person sees.**
   - The worker sees one line on the wizard step and in the Documents hub:
     "Checking with gov.uk…", then what happens next (`my_rtw_check()` returns status,
     outcome and date only).
   - The office sees the following on the candidate profile, the staff profile's
     Documents tab and the Compliance queue: status, source, checked-at in UK time
     (§1.8), right-to-work-until, conditions, reasons, both photos side by side, the
     report, and "Run check again".

### Data protection

- `rtw_checks.result` refuses the keys `shareCode`, `share_code`, `dob`, `dateOfBirth`
  and `date_of_birth` by check constraint. The runner's error text is redacted before it
  is stored or logged (`redactRtwInputs()`), with tests.
- The report and photo sit in the private `documents` bucket. They are opened only
  through short-lived signed URLs issued after an admin check, reading the path through
  the admin's own session first.
- RLS on `rtw_checks`:
  - admin: read;
  - worker: nothing directly, only `my_rtw_check()`;
  - client: nothing (no policy, not an ADR-0004 view);
  - anon: table privileges revoked.
- Every definer function pins its `search_path`. The runner's three functions are
  service role only. pgTAP 600 and the updated 001 and 190 hold all of this.
- **Retention (ADR-0019):** a GDPR removal deletes the document rows. The checks go with
  them by cascade, and a `BEFORE DELETE` trigger queues their report and photo on
  `storage_deletions`. ADR-0019 did not extend the completion letter's legal hold to
  other right-to-work evidence, and this ADR does not either. The Home Office asks
  employers to keep the check result for the employment plus two years. Whether that
  hold should override a removal request for share-code reports is **THC's decision**
  (see OWNER-TODO §6). Until THC decides, removal erases the report as it always has.
- Anthropic processes the result page (a name, a photo, immigration status). The
  privacy notice and the DPIA must name it (OWNER-TODO).

### Assumptions to confirm against the live service

Every one lives in `apps/office/app/api/jobs/rtw-check/_lib/govuk-assumptions.ts` and
is marked there. None has been run against the real page: this sandbox has no route to
it (the proxy refuses the tunnel) and no real share code.

| # | Assumption | Fragility |
|---|---|---|
| 1 | The employer service is at `https://right-to-work.service.gov.uk/rtw-view` | Low |
| 2 | An optional "Start now" precedes the form | Low |
| 3 | The share-code input's label contains "share code" | Medium |
| 4 | Date of birth is a GOV.UK date input labelled Day / Month / Year | Low (pattern), medium (which page) |
| 5 | The service asks for the employer's company name, with a label mentioning company, organisation or employer | Medium |
| 6 | The form advances with a button named Continue, Submit, View, Check or Find | Medium |
| 7 | The form takes at most 4 pages | Medium |
| 8 | The applicant's photo is the first non-crown image in `<main>` | **High.** When missing, the admin compares against the photo in the PDF |
| 9 | Any official PDF download is a link or button mentioning "download … pdf" or "save … pdf". Otherwise the page is printed to PDF | **High.** The fallback always produces a PDF |
| 10 | The service answers with a result page, a "not found" page, or the form again with an error summary | Medium. Claude classifies the page, so new wording does not produce a wrong outcome |
| 11 | Automated access is acceptable to the service, which is not stated either way, and it does not block cloud IP addresses | **Unknown.** See OWNER-TODO, legal check |
| 12 | The Claude request shape: PDF document block, JSON-schema output with `anyOf` nullables, `server-side-fallback-2026-07-01` | Low. SDK-typed, but not yet called with a real key |

### Cost

- No provider fee.
- Claude reads one PDF of about two pages per check. At `claude-opus-5` rates ($5 / $25
  per million tokens), our estimate is a few US cents per check. A few hundred checks a
  month costs a few dollars.
- Vercel compute: one Chromium session of 20–60 s per check (needs **Vercel Pro**:
  commercial use, and function duration).
- Retries are capped at 3 attempts per submission.

## Consequences

- ADR-0002's decision is replaced. Its option 1 remains the fallback path whenever the
  job is off or a check fails.
- ADR-0018 is amended. Its "until the extractor reads the gov.uk report, the reviewer
  enters the date" is now true only for needs-review items. On a pass, the date comes
  from gov.uk and is confirmed, not typed.
- `docs/01` and `.claude/agents/onboarding.md` described an Edge Function `rtw-check`
  holding a `RightToWorkChecker` interface. The Edge Function is now only the relay; the
  seam is `RunDeps` in `apps/office/app/api/jobs/rtw-check/_lib/run.ts`. A provider
  could later replace `checkGovUk` there without touching the database or the screens.
- The generated database types predate `rtw_checks`. The office and Staff App call the
  new functions through narrow local interfaces, as the rest of the codebase does, until
  `pnpm --filter @thc/db gen:types` is run against the live project after deploy.
- **Not verified in this change, and required before switch-on (OWNER-TODO §4b):**
  - the live gov.uk page (assumptions 1–11);
  - a live Claude call (assumption 12);
  - a real share code for each branch: EU settled, EU pre-settled, work visa, student
    and dependant;
  - "not found" with a wrong date of birth;
  - an expired code.

  Verified: the form walk against a local three-page GOV.UK-style mock in real Chromium
  (PDF and photo captured), 19 runner tests, 24 domain tests, and 49 pgTAP assertions.
