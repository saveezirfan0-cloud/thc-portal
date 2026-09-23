# Owner to-do list

What only the owner (or THC) can do. The build is feature-complete; every item
below is a setting, a key, a deploy or content that a coding session cannot
supply. Tick items off here as they are done. `docs/14-handover.md` §5 has the
background for each.

Last updated 25.09.2026.

## 1 · Supabase settings (dashboard)

- [ ] **Auth → Email OTP Expiration → `86400`.** Activation (E3) and reset links
      otherwise expire after an hour.
- [ ] **Auth → turn on leaked-password protection.** The security advisor still
      reports it off.

## 2 · GitHub

- [ ] **Branch protection on `main`**: require a pull request and a green
      `build-test` check (the job name, not the `ci` workflow):
      https://github.com/saveezirfan0-cloud/thc-portal/settings/rules/new?target=branch

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

## 6 · If the Staff App gets its own domain

- [ ] Update `NEXT_PUBLIC_STAFF_URL` on the **office-thc** and
      **thc-portal-client** Vercel projects. Both are currently
      `https://thc-portal-staff.vercel.app`.
- [ ] Update the `STAFF_APP_URL` Supabase secret (Willo) to match.

## Done

- [x] 22.09: Supabase service role key rotated.
- [x] 22.09: `ANTHROPIC_API_KEY` removed from the Vercel client project.
- [x] 24.09: `SUPABASE_SERVICE_ROLE_KEY` confirmed on Office and Staff.
- [x] 24.09: `NEXT_PUBLIC_STAFF_URL` added to Office and Client.
- [x] 24.09: the live database caught up; every migration is applied.
