# Owner to-do list

What only the owner (or THC) can do. The build is feature-complete; every item
below is a setting, a key, a deploy or content that a coding session cannot
supply. Tick items off here as they are done. `docs/14-handover.md` §5 has the
background for each.

Last updated 26.09.2026; §8 (the automated gov.uk check, ADR-0025) added after. **§1 and §2 re-checked against the live project and
GitHub on 23.09** — both are still open, they are not stale entries.

## 1 · Supabase settings (dashboard)

- [ ] **Auth → Email OTP Expiration → `86400`.** Activation (E3) and reset links
      otherwise expire after an hour.
- [ ] **Auth → turn on leaked-password protection.** The security advisor still
      reports it off (re-read 23.09). Of everything the advisor flags on this
      project, it is the only finding that is not a deliberate design decision.
- [x] ~~What created `public.rls_auto_enable()`?~~ **Answered 26.09:** it is the
      function behind an event trigger named `ensure_rls` that enables
      row-level security on every new table in `public`. That is Supabase's
      "enable RLS automatically on new tables" option, turned on in the
      dashboard, which is why no migration has it. It only ever adds
      protection; leave it (handover §3).

## 2 · GitHub

- [ ] **Branch protection on `main`**: require a pull request and a green
      `build-test` check (the job name, not the `ci` workflow):
      https://github.com/saveezirfan0-cloud/thc-portal/settings/rules/new?target=branch
      Confirmed still off on 23.09 (`"protected": false`). Worth doing now
      rather than later: several sessions push to `main` on the same day, and
      nothing currently stops one landing a red build.

## 3 · Turn sending on: email and push (ADR-0020, `docs/12-keys-and-assets.md`)

Until this is done every notification waits in the outbox as "not configured".
Nothing is lost; it all sends once the keys exist.

- [ ] Verify THC's sending domain in **Resend**: add the DKIM/SPF/DMARC records
      at THC's DNS host. The senders are `admin@` and `timesheets@`
      thehospitalitycompany.co.uk, editable on `/settings`.
- [ ] Generate the Web Push keys once: `npx web-push generate-vapid-keys`.
- [ ] Set the Supabase secrets:
      `supabase secrets set RESEND_API_KEY=… VAPID_PUBLIC_KEY=… VAPID_PRIVATE_KEY=… VAPID_SUBJECT=mailto:admin@thehospitalitycompany.co.uk`
- [ ] Vercel, **thc-portal-staff** project: add `NEXT_PUBLIC_VAPID_PUBLIC_KEY`,
      set to the same public key.
- [ ] Deploy the functions, from the repository root:
      `supabase functions deploy notify-drain` and
      `supabase functions deploy finance-reports`.
- [ ] **Only after that**, in the SQL editor: `select install_job_schedules();`
      This needs `settings.edge_base_url` and the vault secret
      `service_role_key`. Then check `job_runs` for `notify-drain`.
- [ ] Smoke test: send yourself a push from the Staff App's notifications screen,
      and trigger one email (for example, Send on an event's timesheet).

## 4 · Willo, once THC sends the keys (ADR-0021)

- [ ] `supabase secrets set WILLO_WEBHOOK_SECRET=… WILLO_API_KEY=… WILLO_INTERVIEW_KEY=… STAFF_APP_URL=https://thc-portal-staff.vercel.app`
- [ ] `supabase functions deploy willo-webhook --no-verify-jwt`
- [ ] In Willo, point the webhook at `{SUPABASE_URL}/functions/v1/willo-webhook`.
- [ ] Check ADR-0021's "assumed about Willo" list against the first sandbox
      delivery: signature header, payload shape, create-candidate endpoint.
- [ ] Ask a session to enable the `willo-invite` schedule. That is a migration
      plus test `190`, not a dashboard change. Then re-run
      `select install_job_schedules();`

## 5 · From THC (content the app shows as placeholders)

- [ ] Health & Safety **quiz**: the 10 questions and answers.
- [ ] **Induction** slides.
- [ ] Employment **contract** text (goes into `contract_versions`).
- [ ] Wording sign-off: **E2b** (rejection after the interview, ADR-0017) and
      the completion-letter emails **CL1–CL6**, including which are mandatory.
- [ ] **Privacy notice** legal text for `/privacy`.
- [ ] Sample **completion letters**, for the document-reading (Gemini) step.
- [ ] Decide: should right-to-work documents other than the completion letter
      also be kept for employment + 2 years after a removal (ADR-0019)?
- [ ] The export from the old system, if data is to be migrated.

## 6 · Decisions

- [ ] **Office pin editor?** When a worker's postcode lookup fails, their
      profile shows "location out of date" until they re-save a findable
      address. Say if managers should be able to move the pin themselves.
- [ ] **Close `/apply`'s last bypass?** Revoking anon from `submit_application`
      makes the per-caller limit unbypassable, but then `/apply` depends on
      `SUPABASE_SERVICE_ROLE_KEY` being set on the Staff App (it is today).
- [ ] **Gender at step 7** is asked as Male/Female because §9.9's New Starter
      report says "Gender (M/F)" (HMRC). Confirm with THC, or ask a session to
      remove it (ADR-0024).
- [ ] **Data import**: after importing workers from the old system, re-verify
      any non-UK worker with no right-to-work date (query in migration
      `20260923200000`). Today only 5 seed demo accounts match.

## 7 · If the Staff App gets its own domain

- [ ] Update `NEXT_PUBLIC_STAFF_URL` on the **office-thc** and
      **thc-portal-client** Vercel projects. Both are currently
      `https://thc-portal-staff.vercel.app`.
- [ ] Update the `STAFF_APP_URL` Supabase secret (Willo) to match.

## 8 · The automated gov.uk right-to-work check (ADR-0025)

Built and tested, and **switched off**. Until it is on, the office verifies share codes by
hand as before (ADR-0018). THC has accepted that a passing check verifies a worker
**without the Home Office photo match**, which may cost THC the statutory excuse
(ADR-0025).

- [ ] **Choose a right-to-work provider** (an IDSP / right-to-work checking service with an
      API that returns the gov.uk result and its PDF). Sign up and get a sandbox key.
- [ ] Give its API documentation to a session, to check ADR-0025's "Assumed" items 1–6
      against it and change `apps/office/app/api/jobs/rtw-check/_lib/provider.config.ts` if
      they differ.
- [ ] **Confirm with THC** that gov.uk's terms of use allow our own browser check as the
      fallback (ADR-0002 flagged it). If they do not, leave `RTW_GOVUK_ENABLED` unset:
      provider only.
- [ ] Vercel, **Back Office project**: `RTW_PROVIDER_URL`, `RTW_PROVIDER_API_KEY` (plus
      `RTW_PROVIDER_AUTH_HEADER` / `RTW_PROVIDER_AUTH_PREFIX` if the provider's differ),
      `RTW_JOB_SECRET` (`openssl rand -base64 48`), and `RTW_GOVUK_ENABLED=true` if
      allowed. Redeploy. Check the plan allows the route's `maxDuration = 300`.
- [ ] SQL editor: create two **vault** secrets (`docs/12`): `office_base_url` (the Back
      Office's https origin — not a settings row, so an admin session cannot redirect the
      job secret) and `rtw_job_secret` (the same value as `RTW_JOB_SECRET`).
- [ ] With the check still off, run **one** check by hand on a consenting worker's share
      code. Ask a session to confirm ADR-0025's items 7–12 (gov.uk's pages and wording)
      and item 13 (Chromium on Vercel).
- [ ] `update settings set value = value || '{"enabled": true}' where key = 'rtw_check';`
- [ ] Ask a session to **enable the `rtw-check` schedule**. That is a migration plus test
      `190`, not a dashboard change. Then re-run `select install_job_schedules();`
- [ ] Share codes filed before the switch have no check. Press **Run gov.uk check** on each
      in Compliance → Needs review.

## Done

- [x] 22.09: Supabase service role key rotated.
- [x] 22.09: `ANTHROPIC_API_KEY` removed from the Vercel client project.
- [x] 24.09: `SUPABASE_SERVICE_ROLE_KEY` confirmed on Office and Staff.
- [x] 24.09: `NEXT_PUBLIC_STAFF_URL` added to Office and Client.
- [x] 24.09: the live database caught up; every migration is applied.
- [x] 26.09: `APPLY_THROTTLE_SALT` set on the Staff Vercel project.
