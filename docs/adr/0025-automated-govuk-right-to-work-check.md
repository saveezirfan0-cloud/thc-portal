# ADR-0025 · The automated gov.uk right-to-work check: provider first, our own gov.uk check as fallback, fully automatic

**Status:** Accepted, 25.09.2026 — built and tested; **switched off until THC chooses a provider and the keys exist** (OWNER-TODO §8)
**Supersedes:** ADR-0002 (gov.uk share-code check without a public API) · **Amends:** ADR-0018 (the right-to-work date is confirmed on Verify) · **Builds on:** ADR-0019 (retention), ADR-0021 (building on an assumed, configurable API)
**Scope:** §2.3, §2.5, §2.6, §4.4 · **Code:** migrations `20260928100000_rtw_check.sql`, `20260928100100_rtw_check_schedule.sql`; pgTAP `600`, `601` (and the lists in `001`, `190`); `packages/domain/src/rtwCheck.ts`; `apps/office/app/api/jobs/rtw-check/`; the office and Staff App screens below

## Context

§2.3 and §2.6 say the system itself asks gov.uk: "Share code + DOB → gov.uk/view-right-to-work → right-to-work-until date → PDF report stored on the profile; that date becomes the expiry used for reminders. On failure or low confidence → flagged for manual review". Nobody types the date.

That was never built. ADR-0002 left three options open. ADR-0018 then made the office confirm the right-to-work date by hand on Verify, as a stopgap, and the 24.09 audit (`docs/15`, §3) listed the check as not built.

THC's product owner decided two things, and both are binding here:

1. **"Build both, provider first."** One `RightToWorkChecker` interface with two adapters. (a) A third-party right-to-work provider's HTTP API is the **primary**. (b) Our own gov.uk browser automation (Playwright) is the **fallback**. The fallback runs when the provider **errors**. It does not run when the provider returns a definitive negative.
2. **"Fully automatic."** There is no human step on success, and no photo-match confirmation. A passing result verifies the share-code document through the **same single Verify path the office uses**, with a system actor. It sets the right-to-work-until from gov.uk and stores the PDF. Only genuine failures, after retries, reach Compliance → Needs review, as §2.6 requires.

**THC has chosen to skip the Home Office photo-match step.** The Home Office's employer guidance for an online right-to-work check expects the employer to check that the photograph on the gov.uk result is the person in front of them. Without that step THC **may not hold a statutory excuse** against a civil penalty for illegal working if the share code turns out to belong to someone else. **THC accepts this risk.** The system reduces it in two ways, but does not remove it:

- gov.uk only answers for the right share code together with the right date of birth;
- both names on the gov.uk record must match the profile, or the check goes to a person.

Reinstating the step later means adding a photo-confirmation state between `running` and `passed`. See "Consequences".

Neither gov.uk nor any provider was reachable from the environment this was built in. As with Willo (ADR-0021), **every assumption about both services is isolated in one configuration module each**, is configurable where that makes sense, and is listed below under "Assumed — confirm against the live service". The tests run against **synthetic** fixtures, and they are labelled as such.

## Decisions

### 1 · One interface, two adapters, one rule for the fallback

- `RightToWorkChecker` (`apps/office/app/api/jobs/rtw-check/_lib/checker.ts`): `check({shareCode, dateOfBirth, companyName}) → {result, report}`. An adapter never throws for a failed check. It returns an `error` result with a short code (`provider_http_503`, `govuk_page_changed:next` …), never a message that could carry personal data.
- **The normalised result** (`packages/domain/src/rtwCheck.ts`, `RtwCheckResult`) has these fields:
  - `outcome`: `right_to_work`, `no_right_to_work`, `not_found` or `error`;
  - `fullName`;
  - `rightToWorkUntil`: an ISO date, or `null` on a pass, which means **no time limit**;
  - `conditions[]`;
  - `termTimeLimitHours`;
  - `referenceNumber`;
  - `checkedAt`;
  - `source`: `provider` or `govuk`.

  It never carries the share code or the date of birth.
- **Provider** (`provider.ts` + `provider.config.ts`): a `fetch` to `RTW_PROVIDER_URL` with `RTW_PROVIDER_API_KEY` in `RTW_PROVIDER_AUTH_HEADER` / `RTW_PROVIDER_AUTH_PREFIX`.
- **gov.uk** (`govuk.ts` + `govuk.config.ts` + `govuk.launch.ts`): `playwright-core` drives `@sparticuz/chromium`, which is serverless Chromium on Vercel. Locally it drives `RTW_CHROMIUM_EXECUTABLE_PATH` instead. It fills the form, reads the result page and prints it to PDF. It runs only with `RTW_GOVUK_ENABLED=true`. The company name gov.uk is given comes from `settings.rtw_check.company_name`.
- **Orchestration** (`sweep.ts`, `runOrchestrated`):
  - the primary's answer stands unless it is an `error`, or a pass **without the report** that §2.6 stores;
  - in either of those cases the fallback runs;
  - a definitive `not_found` or `no_right_to_work` from the provider is final.

  `settings.rtw_check.primary` and `fallback` choose which adapter plays which part. The defaults are `provider` and `govuk`.

### 2 · What a result does — the decision (`decideRtwCheck`, packages/domain)

| Result | Action |
|---|---|
| `error` | **retry**. The database backs off 30 min, 2 h, 6 h and 16 h, so 5 attempts span about a day. The fifth failure becomes **needs_review** with the reason. |
| `not_found` | **reject** through the office's Reject, so the worker gets N8: "gov.uk did not recognise this share code with your date of birth — check both and try again". |
| `no_right_to_work` | **reject** (N8) **and needs_review**. The office must know, whatever the worker does next. |
| `right_to_work` | **verify**, unless any rule below sends it to **needs_review** instead. Nothing on this list is ever auto-verified. |

A `right_to_work` result goes to **needs_review** if any of these is true:

- **The name.** Both names on the profile must appear on the gov.uk record. The match ignores case, diacritics (NFD plus ß/æ/ø/ł…), hyphens and apostrophes ("Mary-Jane" ≡ "Mary Jane" ≡ "Maryjane") and word order. Extra middle names are fine. The office reason never quotes either name.
- **The date.** It is missing, unreadable, or not after today.
- **The branch.** The worker chose UK / Irish, or no branch at all, since that branch has no share code.
- **No time limit.** The record says no time limit, but the branch is not EU settled. ADR-0018 keeps its rule: every other branch has an end date, and "no time limit" is never inferred from a blank, in either adapter.
- **A term-time limit on the wrong branch.** The record carries a term-time hours limit, but the branch is not International student. The weekly cap would be wrong.
- **No term-time limit on the student branch.** The worker chose International student, but the record carries no term-time hours limit.
- **The wrong limit.** The limit is not the one RULE-20 gives for the profile's course level: 20 h, or 10 h below degree level.
- **An unrecognised condition.** For example, "can only work for the sponsor".

The database is authoritative on the attempt limit and the backoff (`rtw_check_record`). `RTW_CHECK_BACKOFF_MINUTES` and the state machine are held equal to the SQL by `rtwCheck.sql.test.ts`.

### 3 · One Verify, with the reviewer as an argument

The bodies of `compliance_verify_document()` and `compliance_reject_document()` move, unchanged, into `compliance_verify_document_as(p_reviewer, …)` and `compliance_reject_document_as(p_reviewer, …)`. These are internal and revoked from every API role. The public functions pass `assert_reviewer()`. The automated check passes `NULL`, the system actor.

So a gov.uk pass runs exactly the code a manager's click runs:

- the right-to-work date guard;
- the worker's `right_to_work_until` recompute (earliest across current evidence);
- the §4.3 re-check and unblock;
- the quiz unlock;
- the `rtw.verified` audit row, with actor NULL and `actorName` "Automatic gov.uk check".

An automated rejection queues exactly the office's N8. Settled status is sent as `'infinity'`, the explicit no-time-limit of ADR-0018, and only on the EU branch. A pass that Verify refuses (`already_expired` …) goes to needs_review. It never goes through.

### 4 · Where it runs, and how it is called

- **A Node route in the Back Office**, `POST /api/jobs/rtw-check`, not a Supabase Edge Function, because Deno cannot run Chromium.
  - The route sets `runtime = 'nodejs'` and `maxDuration = 300`.
  - It claims `RTW_CHECK_BATCH` checks per run (default 3).
  - It records a `job_runs` row with its counts.
- **The gate:** `Authorization: Bearer <RTW_JOB_SECRET>`.
  - The two sides are compared in constant time, as SHA-256 digests through `timingSafeEqual`.
  - A missing secret, or one shorter than 32 characters, refuses everything with a 503.
  - Middleware lets exactly this path, POST only, past the session gate.
- **Database access** uses the service key and only two functions, both service-role only:
  - `rtw_check_claim()` leases due checks, `for update skip locked`, with a 10-minute lease. A lapsed lease is re-taken as a new attempt. It hands the share code and date of birth to the runner **for that run only**.
  - `rtw_check_record()` applies the decision.
- **The report** is uploaded to the private `documents` bucket at `<staff_id>/share-code-report/rtw-check-<check_id>.pdf`. The path is refused unless it is under that worker. It is written to `rtw_checks.report_path` and to `compliance_docs.gov_report_path`. §2.6: "stored on the profile".
- **The schedule:** a `job_schedules` row `rtw-check` runs every 10 minutes. `job_schedules` gained `base_url_setting` and `secret_name`:
  - this row posts to `settings.office_base_url` + `/api/jobs/rtw-check` with the vault secret `rtw_job_secret`, never the service key;
  - every other row is unchanged.

  It is registered **disabled**, like `willo-invite`. pgTAP 190's list of enabled schedules is unchanged.
- **The nudge:** filing a share code also `pg_net`-posts the route. So the worker sees the outcome within a minute or two, not at the next tick. Without `office_base_url` and the vault secret the nudge does nothing, and it can never fail the insert that triggered it.
- **Logs** carry the check id, the source and the outcome, and never a share code, a date of birth or a name. Error codes are reduced to `[a-z0-9_:.-]`, and the database replaces a share code inside one with `share_code`.

### 5 · The data

`rtw_checks` holds one row per run: `status`, `attempts`, `next_attempt_at`, `lease_until`, `source`, `outcome`, the normalised `result`, `report_path`, `error`, the office's `review_reason`, the worker's `worker_reason`, `requested_by` and `reviewed_at`/`by`.

- **RLS:** admin read. Workers have no policy. They read their own latest check per document, status and outcome only, through the definer function `my_rtw_checks()`. Clients get nothing.
- **Writes** come only from definer functions and the service role. The table is added to `scripts/check-write-paths.mjs`.
- **The share code stays where it lives today**, in `compliance_docs.share_code` and `staff.share_code`. `rtw_check_clean_result()` rebuilds the result from a whitelist and refuses one that contains the share code anywhere. A constraint refuses a `shareCode`/`dob` key.
- **The state machine** (`rtw_check_transitions()` plus a guard trigger, equal to `RTW_CHECK_TRANSITIONS` in `packages/domain/src/state.ts`):
  - queued → running | failed;
  - running → queued | passed | rejected | needs_review | failed.

  The outcomes are terminal. "Run check again" is a new row, so every run keeps its record. `failed` means the document left review before the check could finish: verified or rejected by a person, superseded, or the profile rejected or removed.
- **Enqueue:** a row trigger on `compliance_docs` fires whenever a pending share-code report is filed. That covers wizard step 4, the Documents hub and the new wizard re-entry, and any future path. The office's `rtw_check_request()` (Run check again) also enqueues, as admin, audited.

### 6 · What each side sees

**Compliance → Needs review:**

- While the check is on, a share code whose check is **queued or running is not in the queue**, because it is not the office's yet.
- **Unless it is stuck.** A check that is due but unclaimed, or whose lease lapsed, for longer than `settings.rtw_check.stale_after_minutes` (default 60) means the runner is not running: the schedule, its secret, the base URL or both adapters are missing while the switch is on. It is listed with that reason, and the hand-typed date is allowed (`rtw_check_stuck`). Backing off between retries is not stuck, because the next attempt is still in the future. A check the office then verifies by hand is stopped (`failed`) when the runner comes back.
- A share code in **needs_review** is listed with a panel showing:
  - the reason;
  - status and source;
  - when it was checked;
  - what gov.uk returned (date or no time limit, conditions, name, reference);
  - "Download gov.uk report", a 60-second signed URL whose path is read through the session;
  - "Run check again".
- A **no-right-to-work** result has a document that is already rejected, so it is an item of its own (kind `rtw_check`) until the office presses **Mark reviewed**, which is audited. Only that outcome makes such an item.
- **A person's decision answers the check.** When the office verifies or rejects a share code by hand, every needs-review check on it is stamped `reviewed_at` / `reviewed_by` inside the same Verify / Reject body. Without this, a hand-decided document whose check was in needs review turned into a false "no right to work" item (QA, 25.09).

**The manual date (amends ADR-0018):**

- While the check is on, a share code is verified by hand **only when its latest check is in needs_review, or stuck**. The database refuses anything else with `rtw_check_required`, whichever screen tries.
- `rtw_check_manual_allowed()` is executable by `authenticated`, because the office's security-invoker queue view calls it. It therefore checks its caller: it answers `NULL` to anyone but an admin or the service role.
- Off, ADR-0018 is unchanged.
- The date gov.uk returned is pre-filled into the Verify form, as the extractor seam already did.

**Candidate profile (`/onboarding/:id`) and staff profile Documents tab:** the same panel. On the candidate's share-code card the date input and Verify appear only when a hand-typed date is allowed.

**Staff App:**

- The Documents hub and the wizard's paused hub read "Checking with gov.uk…" while the check runs, and re-read themselves every 15 s for up to 10 minutes.
- A pass is "Verified", with no manual-review wording.
- A rejection shows the reason with Enter new code / Enter again.
- A check that could not decide says the result "is with the office".
- **New:** after submitting step 4, a candidate can re-enter a rejected share code **and correct their date of birth** (`onboarding_reenter_share_code`). Before this they had no way back: step 1 closes at submission, and the Documents hub is for employed workers. An employed worker's date of birth is not editable in the app, because it feeds HMRC (§2.8). The hub tells them to contact the office.
  - Re-entry is capped at `settings.rtw_check.reenter_per_day` (default 5) in 24 hours, so the form cannot be used to try dates of birth against a code (`too_many_attempts`).
  - A changed date of birth is audited with the previous and new values (`dobBefore`, `dobAfter`). Both keys are stripped from the audit trail when the person is removed (`audit_log_forget_dob`, §1.7).

### 7 · The off switch

`settings.rtw_check` is `{enabled: false, primary: 'provider', fallback: 'govuk', company_name: 'The Hospitality Company', stale_after_minutes: 60, reenter_per_day: 5, max_attempts: 5}`. `enabled` is not in the brief's list, and it is deliberate. Without it, every share code filed before the keys exist would be enqueued, hidden from the office's queue and never run.

With the switch off:

- nothing is enqueued or claimed;
- the queue hides nothing;
- ADR-0018's manual date applies.

With it on but no adapter configured (no provider keys and `RTW_GOVUK_ENABLED` unset), the route claims nothing and spends no attempts, as the Willo sweep does without keys.

A share code filed before the switch was turned on has no check. The office presses **Run gov.uk check** on it.

### 8 · Retention and GDPR (ADR-0019)

The report is right-to-work evidence on the share-code document. It is kept and purged with that document.

- A GDPR removal deletes the document, which cascades to its checks. The report paths are owed to the Storage purge twice over: `remove_worker()` already queues `gov_report_path`, and an `AFTER DELETE` trigger on `rtw_checks` queues every check's `report_path`, including a report an earlier run left.
- **No orphaned reports.** The runner uploads a report only when this run's outcome stores it (never on a retry). If recording then fails, it asks whether the check is still `running`: if so, nothing references the report and it is deleted; if the record may have landed (a lost response), it is kept.
- If THC extends ADR-0019's two-year hold to other right-to-work evidence (OWNER-TODO §5), the check rows follow the document's `retain_until`, because they are only deleted when it is.

The audit trail keeps these rows, with no share code, date of birth or name:

- `rtw.verified`;
- `rtw_check.passed`, `.rejected` and `.needs_review`;
- `rtw_check.requested` and `.reviewed`.

## Assumed — confirm against the live service

Nothing below has been seen working against the real service. Each assumption is in one file. Change that file and its synthetic fixture (`apps/office/app/api/jobs/rtw-check/_lib/__tests__/fixtures/`), and the tests say whether everything else still holds.

**The provider — `provider.config.ts` (THC has not chosen one yet)**

1. **The request.** One `POST` to `RTW_PROVIDER_URL`, JSON `{share_code, date_of_birth: "YYYY-MM-DD", company_name, include_report: true}`. The check completes **synchronously** in that request, with no webhook or polling. The timeout is `RTW_PROVIDER_TIMEOUT_MS`, default 30 s.
2. **Auth.** `Authorization: Bearer <RTW_PROVIDER_API_KEY>`. The header name and prefix are env (`RTW_PROVIDER_AUTH_HEADER`, `RTW_PROVIDER_AUTH_PREFIX`; an empty prefix is allowed).
3. **The outcome.**
   - Where it is read: the first recognised word in `outcome`, `result.outcome`, `result`, `status`, `data.outcome`, `data.status` or `check.status`.
   - The vocabulary: `valid/pass/eligible/right_to_work…` means a pass; `invalid/fail/ineligible/no_right_to_work…` means no right to work; `not_found/no_match/no_record/expired_share_code…` means not found; `error/pending/unavailable` means an error.
   - HTTP: 401 and 403 are errors. 404 and 422 mean not found **only** if the body says so. Any other non-2xx is an error.
4. **Names, dates and time limit.**
   - The name comes from `full_name`, `name`, `person.*`, or first + last.
   - The expiry comes from `right_to_work_until`, `expiry_date`, `valid_until` or `permission_expiry_date`, as ISO, `DD/MM/YYYY` or `31 March 2028`.
   - "No time limit" counts **only** when stated: `no_time_limit: true`, or `permission_type` of `indefinite`, `no_time_limit`, `permanent`, `settled` or `unlimited`. A pass with neither a date nor such a statement is treated as an error, and the gov.uk fallback runs.
5. **Conditions.** `conditions`, `work_conditions` or `restrictions`, as strings, as objects with `description`/`text`, or as newline-separated text. The term-time hours come from `term_time_hours`, or are read from the condition text.
6. **The report.** Inline base64 (`report_pdf_base64`, `pdf_base64` or `report.base64`), or a URL (`report_url`, `pdf_url` or `report.url`) fetched with the same credentials. It must be a real PDF of 10 MB or less. The provider's report is taken to **be the gov.uk result**: the provider queries the Home Office service and returns its answer, name and conditions as gov.uk words them.

**gov.uk — `govuk.config.ts`**

7. **The start.** The service starts at `https://right-to-work.service.gov.uk/rtw-view` (`RTW_GOVUK_START_URL`), possibly with a "Start now" button or link.
8. **The form.** It asks for:
   - the share code (label containing "share code");
   - the date of birth as three boxes labelled Day, Month and Year;
   - the checker's company name.

   Each field is found by its label first, with CSS fallbacks. The fields may come on any pages and in any order, with a "Continue"-like button between them, and the result arrives within 6 pages.
9. **The result wording.** Every outcome statement is matched as a **whole line**, from its start, so help text elsewhere on the page cannot decide the outcome.
   - Not found: a line starting "We could not find…", "The details do not match", "The share code is not valid / has expired". It is read only on a page that states no outcome and names nobody.
   - No right: a whole line "This person / They does not have the right to work in the UK" or "… cannot work in the UK", ending there. "They cannot work in the UK for more than 20 hours a week during term time" is a student's condition, not a refusal.
   - A pass: a line starting "This person / They has/have permission to work in the UK" or "… can work in the UK". A page with both a pass and a refusal is an error.
   - A flow that never gave gov.uk both the code and the date of birth is never parsed: it is `govuk_page_changed:inputs`, retried, then the office.
   - The end date follows "until", "expires on" or "valid until", as `31 March 2028` or `31/03/2028`.
   - No time limit is stated as "no time limit", "indefinite leave" or "settled status" — never "pre-settled status", which has an end date (§2.5 pt 2).
   - The name is on a "Name" line. The reference follows "Reference number". Conditions sit under a "Conditions" heading, or are lines about hours per week, term time, or "cannot/can only … work".
10. **The PDF.** Chromium's print of the result page (`page.pdf()`) is an acceptable "PDF report" for the profile. gov.uk's own download, if it has one, is not used.
11. **Terms and access.** gov.uk's terms of use permit an employer to use automation on this service. ADR-0002 flagged this as possibly not the case, and **THC should confirm it**. The service also serves a headless Chromium from Vercel's IP ranges without a CAPTCHA or bot wall. If either is false, run provider-only: `RTW_GOVUK_ENABLED` unset, or `settings.rtw_check.fallback` null.

**Shared wording — `packages/domain/src/rtwCheck.ts`**

12. **The conditions.** Each condition line is recognised only **whole**: a line that is only the student term-time limit ("They can work up to 20 hours a week during term time", "They cannot work in the UK for more than 20 hours a week during term time"), or one of the benign lines ("No restrictions", "They can work in any job", "They can work full-time during official vacations", "They cannot be self-employed", "They cannot work as a professional sportsperson", "They cannot fill a permanent full-time vacancy"). A benign pattern never admits a line with a digit or a qualifying word ("hours", "except", "only", "not", "unless", "maximum", "limit"), so "Can work in any job for up to 20 hours a week" goes to the office. Anything else goes to the office.

**Runtime**

13. **The browser on Vercel.** `playwright-core` ^1.63 and `@sparticuz/chromium` ^153 work together on Vercel's Node 22 runtime. `outputFileTracingIncludes` (`apps/office/next.config.ts`) ships `@sparticuz/chromium/bin/**` with the route. Both the symlinked and the pnpm real path are included; the build trace was checked locally, and the deploy was not.
14. **The time limit.** The office Vercel project's plan allows `maxDuration = 300` for a route. Check the plan's function limit; if it is lower, set `RTW_CHECK_BATCH=1` and lower `maxDuration` in the route to match, and expect the gov.uk fallback to be tight.

## Deviations from the wireframes

- **The check panel.** `backoffice/candidate.html` draws the gov.uk report card as automatic. Its "Run check again" button, the retry state, the needs-review reason and "Mark reviewed" are not drawn anywhere. `backoffice/staff-profile.html` draws a share-code row with Download, and the panel under it is added. `backoffice/compliance.html` has no automated-check column: the panel sits in the Document cell, and the "AI found" cell reads "gov.uk: right to work until …".
- **The wizard.** `staff/onboarding-3.html` shows "gov.uk check running · DOB …". That wording is kept for a share code with no automated check. While a check runs it reads "Checking with gov.uk…", as the brief asks. "Enter again" and its sheet (code + DOB) are not in the wireframe.

## Consequences

- Once switched on, a candidate's share code is verified without anyone at THC looking at it, **including the photograph**. See the risk above.
- The office types a right-to-work date only for a check in needs_review, or with the automation off.
- `packages/db/src/types.generated.ts` does not know `rtw_checks` until `gen:types` runs against the live project. The office reads the table through hand-written shapes until then.
- To reinstate the photo match later: add a status (for example `awaiting_photo`) between `running` and `passed`, show the gov.uk photo and the selfie side by side in the panel, and move the Verify call from `rtw_check_record` to the office's confirmation. The state machine and the one Verify path already allow it.

## To switch it on

These steps are in `OWNER-TODO.md` §8, with the keys in `docs/12-keys-and-assets.md`.

1. THC chooses a provider and confirms assumptions 1–6 against its documentation, or changes `provider.config.ts`.
2. Set the office Vercel env vars: `RTW_PROVIDER_URL`, `RTW_PROVIDER_API_KEY` (plus the auth header and prefix if they differ), `RTW_JOB_SECRET`, and optionally `RTW_GOVUK_ENABLED=true`.
3. Put the same `RTW_JOB_SECRET` in the Supabase vault as `rtw_job_secret`, and set `settings.office_base_url`.
4. Run one check by hand with a consenting worker's share code, and confirm assumptions 7–12.
5. Set `settings.rtw_check.enabled = true`.
6. Ask a session to enable the `rtw-check` schedule. That is a migration plus pgTAP 190's list. Then run `select install_job_schedules();`.
