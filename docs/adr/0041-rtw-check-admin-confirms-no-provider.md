# ADR-0041 · The gov.uk check needs no provider, and an admin confirms every result

**Status:** Accepted, 01.10.2026 · **Amends:** ADR-0025 §1–§2 (the automated gov.uk right-to-work check) · **Code:** migration `20261001090000_rtw_check_admin_confirms.sql`; pgTAP `676` (and `600`, `190`); `apps/office/app/api/jobs/rtw-check/_lib/{govuk,govuk.config,checker,sweep}.ts`, `route.ts`; the office's `RtwCheckPanel` and its callers

## Context

ADR-0025 built the check to the first brief:

- a right-to-work provider's API as the primary route;
- our own gov.uk browser automation as the fallback;
- **fully automatic**: a pass verified by the system actor, and "not found" rejected with
  N8, with no human photo match. THC accepted the risk of losing the statutory excuse.

The product owner has since made two decisions that replace that brief:

1. **No provider.** A provider only runs the same Home Office check, for a per-check fee.
   For the lowest cost the system drives the Home Office service itself.
2. **Option C: automated check, admin click.** Everything up to the decision stays
   automatic. The decision is an admin's: they compare the photo gov.uk shows with the
   worker's app selfie and press **Verify** or **Reject**. That includes "not found",
   which is never rejected automatically.

The Home Office service stays necessary. For anyone who is not British or Irish it is the
only source of the share-code result, and since physical residence permits gave way to
eVisas it is the only acceptable check for most of them.

## Decision

- **Defaults** (`rtw_check_config()`): `primary = 'govuk'`, `fallback = null`,
  `admin_confirms = true`.
  - The stored `settings.rtw_check` row is moved only if it still carries ADR-0025's
    untouched defaults.
  - The provider adapter stays in the code, unused. `RTW_PROVIDER_*` need not be set.
    `RTW_GOVUK_ENABLED=true` is what turns the route on.
- **Every result waits for the admin.** ADR-0025 foresaw a status "between running and
  passed". Instead, the status the office already works from is reused: with
  `admin_confirms`, `rtw_check_record()` leaves each result in **`needs_review`** with a
  **recommendation**:

  | gov.uk said | recommendation | what the office sees |
  |---|---|---|
  | a right to work that fits the profile (name, branch, date, RULE-20 hours) | `verify` | "gov.uk confirms a right to work until …. Compare the gov.uk photo with the worker's selfie, then Verify." The date is shown **read-only** and sent on Verify |
  | settled status | `verify` | the same, "with no time limit" (EU settled branch only, ADR-0018) |
  | not found | `reject` | the report, and the Reject box **pre-filled** with the worker-facing reason |
  | no right to work | `reject` | the same, with its own reason |
  | a name, condition or branch that does not fit; repeated errors | `review` | ADR-0025's reasons, unchanged; the date is typed by hand from the report |

  So the following all work unchanged:
  - the queue;
  - `rtw_check_manual_allowed()`, which lets a `needs_review` item be decided;
  - the one Verify / Reject path (`compliance_verify_document` / `_reject_document`, with
    `assert_reviewer()` naming the admin);
  - the `reviewed_at` stamp that path puts on the check;
  - N8, which now goes only when the admin rejects.

  ADR-0025's automatic path is still available with `admin_confirms = false`. pgTAP 600
  sets that and keeps covering it.
- **The N8 text waits office-only.** For a `reject` recommendation, the worker-facing
  reason goes in `rtw_checks.suggested_reason`, not `worker_reason`. `my_rtw_checks()`
  shows `worker_reason` to the worker, and nothing may reach them before the office
  decides. Meanwhile the worker sees only that the check is with the office.
- **The photo.**
  - The gov.uk adapter screenshots the applicant's photo on a result page. This is best
    effort: none is filed when nothing matches, since the same photo is in the PDF.
  - The runner uploads it to `<staff_id>/share-code-report/rtw-check-<id>-photo.png` in
    the private `documents` bucket and files it with `rtw_check_attach_photo()` (service
    role only; a PNG under that worker's folder; running checks only).
  - It is shown beside the app selfie through short-lived signed URLs, issued only after
    an admin check, with both paths read through the admin's own session.
  - The row's delete trigger queues it with the report for the GDPR purge (§1.7).
- **New columns**: `rtw_checks.recommendation`, `photo_path` and `suggested_reason`,
  appended to `rtw_checks_latest_v` (admin-only). `compliance_review_queue_v` is not
  restated; the office reads the three columns from `rtw_checks_latest_v` by document.

### Hardening from the security review (01.10)

- **The worker learns nothing before the admin decides.**
  - `my_rtw_checks()` withholds the outcome while a check is `needs_review`.
  - With `admin_confirms` on, gov.uk's date is **not** pre-filled on
    `compliance_docs`, which its worker can read. It waits on the check, in
    `rtw_checks_latest_v` (admin-only), and that is where the read-only Verify date
    comes from. Otherwise a date appearing on the document would tell someone using a
    borrowed share code that gov.uk passed it.
- **The photo is evidence.**
  - `evidence_path_discardable()` refuses a check's photo and any `rtw-check-*` file
    under the worker's folder. Without this, a worker naming the path in a refused
    upload could have had the service key delete the photo before the comparison.
  - `retained_storage_paths()` keeps the photo with its report if a legal hold ever
    applies.
- **A retry drops the earlier attempt's photo** (queued for the purge). Each attempt
  writes its own `rtw-check-<id>-a<attempt>-photo.png`, so the purge never removes a
  later attempt's file.
- **Only a JSON `false` turns review off.** A missing, mistyped or string
  `admin_confirms` keeps the admin's click.
- **The photo and report actions return fixed messages**, never database text.
- **Left as they are, and recorded here:**
  - If the attach RPC lands but its response is lost, the runner deletes the photo, and
    the panel shows "could not open", with the PDF as the fallback. This affects
    availability only.
  - The read-only Verify date is enforced in the office UI, not the database.
    `compliance_verify_document` still takes an admin's date, as it does for every
    document. Enforcing it would mean restating the one Verify path.

## Consequences

- **Legal.** THC no longer has to accept the risk of skipping the Home Office photo check.
  A person compares the photo, as the employer guidance expects for the statutory excuse,
  so ADR-0025's risk acceptance does not apply while `admin_confirms` is on. A person also
  decides every rejection, which keeps it out of UK GDPR Article 22's "solely automated
  decision".
- **Cost.**
  - No provider fee.
  - One headless Chromium session per check on Vercel (the Back Office needs Vercel Pro
    for commercial use and the function duration).
  - One admin click per share code.
- **Unchanged from ADR-0025 and still to confirm against the live service:** the
  assumptions in `govuk.config.ts`, the page flow, terms of use and bot defences. The
  new photo selector adds one more assumption (fragility **high**; the PDF is the
  fallback).
- **To confirm with THC:** whether gov.uk reports and photos should be held after a GDPR
  removal (the Home Office asks for the employment plus two years; ADR-0019 holds only the
  completion letter). See OWNER-TODO §6.
- **A small drift from the §2.3 wording**, "nobody types the date": on a `verify`
  recommendation the date is confirmed, not typed. It is typed only for `review` items,
  as ADR-0025 already allowed.
