# Owner to-do list

What only the owner (or THC) can do. The build is feature-complete; every item
below is a setting, a key, a deploy or content that a coding session cannot
supply. Tick items off here as they are done. `docs/14-handover.md` §5 has the
background for each.

Last updated 26.09.2026: the apps now live in THC's own Vercel account (`thc7`) at
thc-portal-office.vercel.app, thc-portal-staff-two.vercel.app and
thc-portal-client-beta.vercel.app, deployed from `main` automatically; the owner supplies the Resend and Willo keys; `docs/17` v1.2 carries every THC ask (items 24–40 new). Before that, 25.09.2026 (after #59, #65 and #66): §3's keys, deploys and base URL done by a session; §4b (Claude document reading) added; the old-system import dropped. **§1 and §2 re-checked against the live project and
GitHub on 23.09** — both are still open, they are not stale entries.

## 1 · Supabase settings (dashboard)

- [ ] **Auth → Email OTP Expiration → `86400`.** Activation (E3) and reset links
      otherwise expire after an hour.
- [ ] **Auth → URL Configuration → Redirect URLs**: add
      `https://thc-portal-office.vercel.app/auth/callback**`,
      `https://thc-portal-staff-two.vercel.app/auth/callback**` and
      `https://thc-portal-client-beta.vercel.app/auth/callback**`. Forgot password
      fails without them.
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

- [ ] **Resend API key**: the owner has it (26.09). Paste it straight into the
      function secrets below as `RESEND_API_KEY` — never into a chat or a commit.
- [ ] Verify THC's sending domain in **Resend**: add the DKIM/SPF/DMARC records
      at THC's DNS host. The senders are `admin@` and `timesheets@`
      thehospitalitycompany.co.uk, editable on `/settings`.
- [x] 25.09: Web Push keys generated. Both halves are kept in the **Vault** as
      `vapid_public_key` and `vapid_private_key` (so they survive; nothing else
      reads them there). Read them in the SQL editor with
      `select name, decrypted_secret from vault.decrypted_secrets where name like 'vapid_%';`
- [ ] Set the Supabase **Edge Function** secrets (dashboard → Edge Functions →
      Secrets, or the CLI), copying the two VAPID values from the Vault:
      `supabase secrets set RESEND_API_KEY=… VAPID_PUBLIC_KEY=… VAPID_PRIVATE_KEY=… VAPID_SUBJECT=mailto:admin@thehospitalitycompany.co.uk`
- [x] 25.09: Vercel, **thc-portal-staff**: `NEXT_PUBLIC_VAPID_PUBLIC_KEY` set to
      the same public key (Production + Preview).
- [x] 25.09: every Edge Function deployed to the live project (booking-tick,
      compliance-daily, gdpr-purge, auto-staffing, finance-reports, notify-drain
      with JWT verification; willo-webhook without, it checks Willo's signature
      and answers 503 until `WILLO_WEBHOOK_SECRET` exists). CI's
      `deploy-database` job redeploys all seven on every push to `main` (#63),
      so they stay in step with the code.
- [x] 25.09: `settings.edge_base_url` set to
      `https://dgxtqvalfiisfpbwodew.supabase.co/functions/v1` (the guard accepts it).
- [ ] SQL editor: add the **service role key** to the Vault, which a session
      cannot do (the key never leaves the dashboard):
      `select vault.create_secret('<service_role key from Settings → API>', 'service_role_key');`
      It must be the same key the functions see as `SUPABASE_SERVICE_ROLE_KEY`.
- [ ] **Only after that**, in the SQL editor: `select install_job_schedules();`
      Then check `job_runs` for `booking-tick` (every minute) and `notify-drain`.
      This switches on the hourly Auto-Assign, the 12:05 release, reminders and
      the compliance sweep on the live data — do it when the data is real or
      the demo data is expected to move.
- [ ] Smoke test: send yourself a push from the Staff App's notifications screen,
      and trigger one email (for example, Send on an event's timesheet).

## 4 · Willo, once the keys arrive (ADR-0021)

The owner is supplying the Willo keys (26.09; `docs/17` item 1). Set them as
function secrets directly — never paste them into a chat or a commit.

- [ ] `supabase secrets set WILLO_WEBHOOK_SECRET=… WILLO_API_KEY=… WILLO_INTERVIEW_KEY=… STAFF_APP_URL=https://thc-portal-staff-two.vercel.app`
- [ ] `supabase functions deploy willo-webhook --no-verify-jwt`
- [ ] In Willo, point the webhook at `{SUPABASE_URL}/functions/v1/willo-webhook`.
- [ ] Check ADR-0021's "assumed about Willo" list against the first sandbox
      delivery: signature header, payload shape, create-candidate endpoint.
- [ ] Ask a session to enable the `willo-invite` schedule. That is a migration
      plus test `190`, not a dashboard change. Then re-run
      `select install_job_schedules();`

## 4b · Document reading with Claude (ADR-0033)

Built and **switched off**; until a key exists nothing is pre-filled and a
manager reads the dates off each pending upload in Compliance → Needs review,
as today.

- [ ] **THC confirms** Anthropic (Claude) instead of the scope's Gemini, and the
      privacy notice names Anthropic as the processor (`docs/17`).
- [ ] Anthropic account on THC's organisation → API key. Vercel,
      **thc-portal-staff** only, server-side: `ANTHROPIC_API_KEY` (optional
      `ANTHROPIC_MODEL`, default `claude-sonnet-5`). Redeploy the Staff App.
- [ ] Upload two or three real letters on a test account and check the
      pre-filled dates before real workers use it.

## 5 · From THC (content the app shows as placeholders)

- [x] 26.09: Health & Safety **quiz** received ("Health and Safety Presentation
      Questions") and live as the step 6 quiz (migration `20260930140000`). THC
      still has to confirm the items below. **The first two are go-live gates: no
      real candidate sits the quiz until they are done.**
  - [ ] **GATE — THC confirms the quiz answer key.** THC's sheet marks no answers,
        so the build team inferred them (C, B, B, A, D, A, C, D, C, A; the ones the
        induction deck covers agree with it). A wrong key passes or fails real
        candidates wrongly, and the third failure rejects them;
  - [ ] **GATE — THC approves Q8**, reworded from free text ("Name three (3) foods, which can cause
        an allergic reaction?") to multiple choice ("Which of these foods can cause
        an allergic reaction?" Peanuts · Milk · Shellfish · All the above); it is
        the one question still flagged placeholder;
  - [ ] **Q9–Q10 have no correct option as worded**: 16 kg / 25 kg (the answers
        marked correct, the closest offered) are HSE's figures between knuckle and
        elbow height; at elbow height HSE gives 13 kg / 20 kg. Reword to "knuckle
        height" or change the options (`docs/17` item 9);
  - [ ] **Q4, Q5, Q8** (allergies) and **Q9–Q10** (weight limits) are not covered
        by the induction deck — add slides, or change the questions.
- [x] 26.09: **Induction** slides received ("General Health & Safety Awareness", 21 slides) and
      live in the Staff App's step 5 as supplied. The deck still has empty photo
      boxes on slides 1, 2, 3, 11 and 20; send a finished file to replace it.
- [x] 26.09: Employment **contract** received ("Agency Worker Contract For
      Services", 20 pages) and published as version `thc-agency-worker-2026-09`
      (migration `20260930140100`), still flagged placeholder because of clause 28.
      THC (and its solicitor) to confirm the items below. **The first is a go-live
      gate: no real candidate signs until it is done.**
  - [ ] **GATE — THC approves clause 28, the duty to disclose criminal
        convictions**, and the approved text is published as a new, UNFLAGGED
        version (a new `contract_versions` row, `is_placeholder = false`). THC's
        document has none; §2.11 requires it, so the build team added it (wording
        in `docs/17` item 2). Every signature records its version, so anyone who
        signs the flagged one has signed text THC has not approved;
  - [ ] **pay "to the nearest quarter hour"** (clause 1, "Rate of Pay" and
        "Qualifying Period Rate of Pay", applied by clause 6) — the platform pays to
        the minute (RULE-01/02). Which is right?
  - [ ] **clause 8, time sheets "signed by an authorised representative of the
        Client"** — the platform's record is the digital check-in/out and the
        sign-out timesheet (§11.3); the clause should refer to them;
  - [ ] the document's own slips, listed in `docs/17` item 2 (e.g. "SI 1988/1833",
        "[24] hours", the holiday year "31 March to 1 April").
- [ ] Wording sign-off: **E2b** (rejection after the interview, ADR-0017) and
      the completion-letter emails **CL1–CL6**, including which are mandatory.
- [ ] **Privacy notice** legal text for `/privacy`. The "Data protection policy for
      Workers" THC sent on 26.09 is an internal policy, not this notice — it refers
      to "the Company's privacy notice for workers" itself. `/privacy` stays as it
      is until that notice arrives.
- [x] 26.09: sample **term-dates letters** (3) and a **completion letter** received. The
      document-reading prompt (ADR-0033) now refuses course or stage dates as
      terms and never takes a letter's own date as the completion date. The
      letters are personal data and are not kept in the repository.
- [ ] Decide: should right-to-work documents other than the completion letter
      also be kept for employment + 2 years after a removal (ADR-0019)?

## 6 · Decisions

- [ ] **Keep gov.uk reports and photos after a GDPR removal?** The Home Office asks
      employers to keep the right-to-work check result for the employment plus two years.
      Today a removal erases the share-code report and the gov.uk photo with everything else
      (ADR-0019 holds only the completion letter; ADR-0041 does not extend it). Say if they
      should be held like the completion letter.

- [ ] **Office pin editor?** When a worker's postcode lookup fails, their
      profile shows "location out of date" until they re-save a findable
      address. Say if managers should be able to move the pin themselves.
- [x] ~~**Close `/apply`'s last bypass?**~~ **Done in the 25.09 audit fix round
      (ADR-0039):** `submit_application` is service-role only and `/apply`
      refuses in plain words without `SUPABASE_SERVICE_ROLE_KEY` on the Staff
      App. The security advisor's anon-callable definer count drops by one.
- [ ] **Gender at step 7** is asked as Male/Female because §9.9's New Starter
      report says "Gender (M/F)" (HMRC). Confirm with THC, or ask a session to
      remove it (ADR-0024).

## 7 · If the Staff App gets its own domain

- [ ] Update `NEXT_PUBLIC_STAFF_URL` on the **thc-portal-office** and
      **thc-portal-client** Vercel projects. Both are currently
      `https://thc-portal-staff-two.vercel.app`.
- [ ] Update the `STAFF_APP_URL` Supabase secret (Willo) to match.

## 8 · The automated gov.uk right-to-work check (ADR-0025, ADR-0041)

Built and tested, and **switched off**. Until it is on, the office verifies share codes by
hand as before (ADR-0018). **No provider is needed** (ADR-0041): the system fills in the
Home Office form itself, and every result waits for an admin, who compares the gov.uk photo
with the worker's selfie and presses Verify or Reject.

- [ ] **Legal, first:** THC's adviser confirms that driving the Home Office "View a job
      applicant's right to work details" service with an automated browser is acceptable
      (ADR-0002 flagged it; ADR-0025 item 11), and that the printed result PDF is an
      acceptable retained copy.
- [ ] **Vercel Pro** on the Back Office project (commercial use; the route's
      `maxDuration = 300`).
- [ ] Vercel, **Back Office project**: `RTW_JOB_SECRET` (`openssl rand -base64 48`) and
      `RTW_GOVUK_ENABLED=true`. Redeploy. No `RTW_PROVIDER_*` variables.
- [ ] SQL editor: create two **vault** secrets (`docs/12`): `office_base_url` (the Back
      Office's https origin — not a settings row, so an admin session cannot redirect the
      job secret) and `rtw_job_secret` (the same value as `RTW_JOB_SECRET`).
- [ ] Set the name gov.uk prints as the checker, if it is not "The Hospitality Company":
      `update settings set value = value || '{"company_name": "<legal name>"}' where key = 'rtw_check';`
- [ ] **Live test** with the check still off: run **one** check by hand on a consenting
      worker's share code, then a wrong date of birth, then each branch (EU settled, EU
      pre-settled, work visa, student, dependant). Ask a session to confirm ADR-0025's
      items 7–13 and ADR-0041's photo selector against what gov.uk actually shows.
- [ ] `update settings set value = value || '{"enabled": true}' where key = 'rtw_check';`
- [ ] Ask a session to **enable the `rtw-check` schedule**. That is a migration plus test
      `190`, not a dashboard change. Then re-run `select install_job_schedules();`
- [ ] Share codes filed before the switch have no check. Press **Run gov.uk check** on each
      in Compliance → Needs review.

## 9 · After the 25.09 audit fix round (`docs/18-audit-2026-09-25.md`)

Settings the round depends on, and the choices it recorded as defaults.

- [ ] **Supabase → Auth → Email Templates → Reset Password**: paste
      `supabase/templates/recovery.html`. The link goes to
      `/auth/confirm?token_hash=…`, so it works from any browser or mail app
      (ADR-0039).
- [ ] **Supabase → Auth → URL Configuration → Redirect URLs**: for each of the
      three apps add `<url>/auth/callback**` **and** `<url>/auth/confirm**`.
- [ ] **Supabase → Auth**: sign-ups **off**, minimum password length **10**
      with letters and digits, **secure password change** on — the values in
      `supabase/config.toml`.
- [x] **Vercel**, all three projects: `NEXT_PUBLIC_OFFICE_URL`,
      `NEXT_PUBLIC_STAFF_URL`, `NEXT_PUBLIC_CLIENT_URL`. Forgot-password now
      refuses in production rather than send a link to localhost. **26.09:** each
      app holds the ones it reads in THC's Vercel account (names checked, values
      not read). Make sure they are the new addresses: `thc-portal-office`,
      `thc-portal-staff-two` and `thc-portal-client-beta` `.vercel.app`.
- [ ] **Vercel, thc-portal-staff**: keep `SUPABASE_SERVICE_ROLE_KEY` set —
      `/apply` now needs it.
- [x] **Regenerate `packages/db/src/types.generated.ts`** once the round is
      live — done 26.09 from the live project (all 145 migrations applied).
- [ ] **Before any real data**: change the six seed passwords (`password123`)
      or delete the seed users on the live project.
- [ ] **On the morning of a client walk-through**: re-run
      `supabase/demo/review-data.sql` so the "today" event sits around the
      current hour, and put a few sample files in Storage so document and photo
      previews are not empty.
- [ ] **THC decisions recorded as defaults** — confirm or change:
      - ADR-0035 — Left early = a check-out more than 15 min before the
        section's end (on or off site); an off-site check-out whose last
        on-site fix is over 30 min old goes to review as No check-out, and
        that review does not count against the show-rate.
      - ADR-0036 — Staff App failure states (fail closed), the 8-second
        check-out GPS reading, the schematic map.
      - ADR-0037 — a checked-in (`worked`) booking counts as staffed;
        automatic rounds never re-invite someone who declined, was withdrawn
        or was released at 12:05; Radar stops offering at headcount (buffer
        seats by invitation).
      - ADR-0038 — "Hours this week" shows worked / cap with booked beneath;
        the client line-up is grouped per role section.
      - ADR-0039 — GDPR removal scope (including whether the payroll /
        new-starter CSVs in the `reports` bucket are kept after a removal).
      - ADR-0040 — the 10 h below-degree band (the completion-letter PDF wins
        over the v1.5 changelog), visa hour limits, the NI number check.

## Done

- [x] 22.09: Supabase service role key rotated.
- [x] 22.09: `ANTHROPIC_API_KEY` removed from the Vercel client project.
- [x] 24.09: `SUPABASE_SERVICE_ROLE_KEY` confirmed on Office and Staff.
- [x] 24.09: `NEXT_PUBLIC_STAFF_URL` added to Office and Client.
- [x] 24.09: the live database caught up; every migration is applied.
- [x] 25.09: **Vercel SSO (deployment) protection turned off** on `office-thc`,
      `thc-portal-staff` and `thc-portal-client`. It had been on with
      `all_except_custom_domains`, and since no project has a custom domain that
      covered every URL — anyone outside the Vercel team saw Vercel's login wall
      instead of the app. Each app still gates itself, so only the sign-in screens
      are public. Open one of the three URLs in a private window to confirm.
- [x] 26.09: `APPLY_THROTTLE_SALT` set on the Staff Vercel project.
- [x] 25.09: `NEXT_PUBLIC_OFFICE_URL`, `NEXT_PUBLIC_CLIENT_URL` and the Staff
      App's own `NEXT_PUBLIC_STAFF_URL` set (Production), so Forgot password
      links come back to the right app. The Supabase redirect URLs they need
      are still open in §1.
- [x] 25.09: THC will not migrate data from the old system; the import (B5/B6)
      is out of scope.
