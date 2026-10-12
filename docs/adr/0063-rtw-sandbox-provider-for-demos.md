# ADR-0063 · A sandbox right-to-work provider, so the check can be demonstrated

**Status:** Accepted, 28.09.2026 · **Builds on:** ADR-0025 (the automated check), ADR-0041 (no provider; an admin confirms every result) · **Code:** `apps/office/app/api/jobs/rtw-check/_lib/sandbox.ts`, `provider.ts` / `provider.config.ts` (the photo), `route.ts`; tests `__tests__/sandbox.test.ts`, `provider.test.ts`; switches `supabase/demo/rtw-check-sandbox-on.sql` / `-off.sql`

## Context

The automated check is built and switched off (ADR-0025, ADR-0041). It cannot be shown
as it stands. The gov.uk route needs a real person's share code and THC's adviser's
sign-off (OWNER-TODO §8, docs/17 item 24), and no provider is contracted. So a demo of
candidate onboarding stopped at "Checking with gov.uk…".

The provider adapter also dropped the applicant's photo. ADR-0041 has the admin compare
that photo with the app selfie, and only the gov.uk adapter supplied it.

## Decision

- **The provider adapter reads a photo**: `photo_png_base64`, `photo_base64`,
  `applicant_photo_base64` or `photo.base64`. It keeps the photo only when it is a PNG
  under 2 MB, and only for `right_to_work` or `no_right_to_work`, as the gov.uk adapter
  does. The field names are assumed, like the rest of `provider.config.ts`.
- **A sandbox provider** is a `fetch` handed to the real provider adapter, turned on only
  by `RTW_PROVIDER_URL=sandbox:` **together with** `RTW_SANDBOX_ALLOW=<project ref>`
  (the key may be left unset; see *Amendment, 12.10.2026* below). A demo therefore runs the
  real path: the adapter's mapping, the orchestrator, `decideRtwCheck`, the report and
  photo upload, `rtw_check_record()`, the Needs review queue, and the admin's Verify or
  Reject.
- **It answers only these demo share codes.** Any other code gets a 404 with no outcome.
  The adapter reads that as an error, so it is retried and then goes to the office. A
  real person is never given a made-up answer, and nobody is looked up.

  | Share code | Fits the branch | The office sees |
  |---|---|---|
  | `WDEMOPASS` | Work visa · Dependant / other · EU pre-settled | Recommend verify: right to work for 2 years, any job |
  | `WDEMOSETL` | EU settled | Recommend verify: settled, no time limit |
  | `WDEMOSTDY` | International student (degree level) | Recommend verify: 1 year, 20 h a week in term time |
  | `WDEMONAME` | any | Needs review: the name on the record is someone else's |
  | `WDEMOCOND` | Work visa | Needs review: a condition the system cannot apply |
  | `WDEMONONE` | any | Recommend reject: not recognised with this date of birth |
  | `WDEMONORW` | any | Recommend reject: no right to work |
  | `WDEMODOWN` | any | Provider down: retried at 2 min, 10 min, 30 min and 2 h, then Needs review |

  A code on a branch it does not fit goes to Needs review with the branch reason. That
  is the real rule, and it can be demonstrated too.
- **It looks the holder up by code and date of birth, as gov.uk does**: the pending
  share-code document with that code, and a worker with that date of birth. The record
  carries that worker's name. If the date of birth differs, the result is "not found".
- **Nothing it makes passes for real evidence.**
  - Every report has an amber "SANDBOX – NOT A HOME OFFICE RESULT" band.
  - Every reference starts `SANDBOX-`, and the office shows it as the gov.uk reference.
  - The photo is a grey silhouette with an amber striped band.
  - The route logs a warning on every run that uses it.
- **`admin_confirms` stays on.** The sandbox changes where results come from, not who
  decides.

## Consequences

- There is no migration. `settings.rtw_check.primary = 'provider'` is an existing
  setting, and `source` is recorded as `provider`. The office labels it "right-to-work
  provider".
- **The sandbox must never be on where real workers are.** Only the demo database is
  safe: the on-script refuses to run without the seed's demo workers. Real share codes
  never get an answer, but real candidates would wait for checks that cannot pass.
- A real provider still needs only `RTW_PROVIDER_URL` and `RTW_PROVIDER_API_KEY` (and
  `provider.config.ts` checked against its documentation). ADR-0041's decision stands
  (no provider).

## Amendment, 12.10.2026 · two keys, tied to one project (security review, item 4)

One variable used to switch the sandbox on, and the sandbox makes "right to work"
answers out of nothing. A demo's environment copied to production — or `sandbox:` left
in a Vercel project that later points at the live database — would have turned it on
where real workers are. It now takes two:

- `RTW_PROVIDER_URL=sandbox:` asks for it, as before;
- `RTW_SANDBOX_ALLOW=<project ref>` must name **the Supabase project this deployment
  uses**: the `<ref>` in `NEXT_PUBLIC_SUPABASE_URL` (`https://<ref>.supabase.co`), the URL
  the route's service client talks to. `local` matches a local stack (localhost /
  127.0.0.1). A custom-domain Supabase URL names no ref, so the sandbox cannot be
  unlocked there.

Asked for without a matching second key, the sandbox is **refused**: the route logs
`rtw-check: sandbox provider refused — …` and runs as if no provider were configured (the
gov.uk fallback if it is on, otherwise the check goes to the office). Copying a demo's
variables to production still does nothing, because production's ref is not the demo
project's. Code: `rtwSandboxSwitch()` / `supabaseProjectRef()` in `sandbox.ts`; tests in
`sandbox.test.ts`. Separately, the database no longer lets a `SANDBOX-` result verify a
document on its own (the DB half of the same review).

## Running the demo

1. **Vercel**, project `thc-portal-office`, Production:
   - `RTW_PROVIDER_URL=sandbox:`
   - `RTW_SANDBOX_ALLOW=<the demo project's ref>` — the subdomain of that deployment's
     `NEXT_PUBLIC_SUPABASE_URL`; without it the sandbox is refused (see the amendment)
   - `RTW_JOB_SECRET=<openssl rand -base64 48>`

   Leave `RTW_GOVUK_ENABLED` unset, then redeploy.
2. **Database**: in `supabase/demo/rtw-check-sandbox-on.sql`, fill in the Back Office
   origin and the same secret, then run it. It checks that it is on the demo seed,
   writes the two vault secrets, sets `rtw_check` to enabled with the provider as
   primary, no fallback and admin confirms on, and installs the `rtw-check` cron job.
3. **The story**:
   1. Apply at `/apply`, noting the date of birth, and accept the candidate on the
      kanban.
   2. In the Staff App wizard, choose e.g. *Work visa* and type **WDEMO PASS** (spaces
      are fine).
   3. Filing the code nudges the runner. The worker sees the check is with the office,
      usually within seconds; otherwise at the next 10-minute sweep.
   4. **Back Office → Compliance → Needs review**, or the candidate profile:
      - the "automatic check · your decision" badge and **Recommend verify**;
      - the read-only right-to-work date;
      - the sandbox photo beside the selfie;
      - **Download gov.uk report**;
      - **Verify**.
   5. Re-run with **WDEMONONE** to show a recommended reject with the reason pre-filled.
      The worker gets N8 only when the admin presses Reject.
4. **Afterwards**, run `rtw-check-sandbox-off.sql` and remove `RTW_PROVIDER_URL` and
   `RTW_SANDBOX_ALLOW` from Vercel.
