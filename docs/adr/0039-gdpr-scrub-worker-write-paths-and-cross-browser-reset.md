# ADR-0039 · What a GDPR removal scrubs and keeps; worker writes only through RPCs; a reset link that works in any browser

Status: accepted · 30.09.2026 · 20260930120000, 20260930120100, 20260930120200 ·
audit 25.09 D9, D9b, D12, D13, D29, D51, D52 · replaces the unmerged ADR-0035 / ADR-0036
of the 25.09 fix round, trimmed to what reached main

Where this touches something main already settled, main's decision stands:
"Keep me signed in" is ADR-0032, a worker's read of their declarations is
ADR-0031, and the office's actor on block / unblock / reset / remove is
`604_privileged_actions_carry_the_actor`.

## 1 · §1.7 removal: every copy of the person, and the history kept

`remove_worker()` (20260930120100, restated from 20260927160400) now scrubs,
in the same transaction as the anonymisation, every place the audit found the
same person written down:

| Where | What happens |
|---|---|
| `auth.users` | banned (as before); email → `removed-<staff id>@invalid.example`, phone null, `raw_user_meta_data` `{}`, outstanding confirmation / recovery / email-change tokens cleared; sessions, refresh tokens, one-time tokens deleted |
| `auth.identities` | `identity_data` → `{sub, email: <removed address>}` |
| `profiles.full_name` | the deleted-account label |
| `notification_outbox` | matched by recipient, any of the worker's ids in the key (staff, bookings, documents, declarations, applications, quiz attempts, rtw checks), or the staff id / address / NI number in the payload. **Unsent: deleted.** Sent: payload → `{gdprRemoved, label}`, the worker's own address in `recipient_emails` → the removed address (office recipients kept), `error` cleared |
| `audit_log` | rows about the worker (entity is one of their ids, or `data.staffId`) or by them (`actor` = their login) lose `name`, `fullName`, `firstName`, `lastName`, `staffName`, `workerName`, `email`, `phone`, `mobile`, `niNumber`, `shareCode`, `dob`, `dateOfBirth`, `address`, `homeAddress`, `postcode`, `fileName`, `visaType`, `visaExpiry`; `actorName` becomes the label where the worker was the actor. The manager's name and reason stay |
| `location_pings` | deleted for the worker's bookings |
| `check_logs` | `location`, `distance_m` → null; the check-in / check-out **times stay** (pay and timesheets reconcile through them) |
| `staff` | additionally `gender`, `home_postcode`, `home_country`, `applied_age_band`, `rejection_reason`, `rejection_cause`, `home_location_stale` |
| `applications` | additionally `dob` → 1900-01-01 (the column is `not null`; the same sentinel `staff.dob` takes) and `resolution_reason` → null |
| `criminal_declarations` | additionally `review_note` → null (details and date were already cleared) |
| `client_qualifications.note` | null |
| `rtw_checks` | deleted (their report PDFs are queued for the purge by the table's trigger) |
| `onboarding_progress` | already deleted by `onboarding_on_staff_change()` when `removed_at` is set (20260923120000); 670 pins it |

**Kept, deliberately** (§1.7 "keep history rows and already-issued PDFs"):
bookings, breaks, violations and their notes, feedback text verbatim (v1, as
before), `payroll_export_lines` (a payroll export is never corrected
retroactively), issued `event_documents`, the Employee ID, a completion letter
held under ADR-0019, and the `gdpr_remove` audit row itself (which names the
Willo candidate id so the office can ask Willo to delete).

**For THC to decide:** the stored CSVs behind `report_sends` (payroll and new
starter reports carry names, NI numbers, dates of birth and addresses) are
not touched. They are payroll records THC may be obliged to keep; if not, a
later migration can purge the worker's lines.

**D9b.** With the address gone from the login, a removed person who
re-applies with the same email is a new candidate and GoTrue's invite mints a
new login. `provisionStaffLogin()` also refuses to hand a link to a banned
login (`account_link_failed`, detail `login_disabled`), in case one ever
holds an address again.

## 2 · A declaration is never edited (§1.5, D29)

A trigger (20260930120000) refuses UPDATE of `staff_id`, `declared_at`,
`source`, `answer`; UPDATE of `details` / `conviction_date` except clearing
them on a removed worker (the §1.7 scrub above); and DELETE except the
cascade from a deleted staff row. The review fields and `superseded` stay
writable: they are the office's half of the row. It applies to every role,
the table owner included, because the rule is about the row. e2e cleanup
deletes the staff row and lets the declarations cascade.

Who reads a declaration is ADR-0031's: the worker has no direct policy on
the table and reads through definer RPCs that withhold the details; the
office reads it under `admin_all`. The 25.09 round's column revoke and
`criminal_declarations_office_v` were not ported — main closed the same leak
by dropping the policy.

## 3 · Worker writes only through RPCs (D51, D52)

- `staff_references` and `push_subscriptions` lose their worker INSERT /
  UPDATE / DELETE policies (as `bank_details` did in 20260927120100); the app
  already writes through `onboarding_save_references` and
  `save_push_subscription` / `forget_push_subscription`.
- `staff_set_photo` takes exactly `<own staff id>/<name>.jpg` of an object
  that exists in the `photos` bucket.
- `staff_save_bank`'s E5 key carries microseconds.
- `submit_application` is service-role only; `/apply` always calls
  `submit_application_as_caller` (ADR-0024) and refuses in words without
  `SUPABASE_SERVICE_ROLE_KEY`. The security advisor's anon-callable definer
  count drops by one.
- The Staff App's `changePassword` signs in with the session's own address,
  never one the browser sent, before it changes the password.
- The office's `reverseGeocode` server action checks for a signed-in admin
  before spending the Mapbox token.
- The three session-gate matchers skip static files only where `public/`
  serves them — the top level, and in the Staff App `public/icons/` (the
  push badge) — so a nested page path that merely ends in `.png` is gated.

## 4 · Request my P45 while blocked (D51)

§10.1 lock case 2: a manager's block is lifted "only [by] a manager pressing
Unblock". `request_p45` therefore refuses `blocked_manual`, and the Staff
App shows the on-hold line. A worker on an automatic document block may
still leave. A `conviction_review` block is not refused; if THC wants it
held the same way, it is one more value in the same condition.

## 5 · The recovery link carries a token_hash; /auth/confirm spends it (D13)

The reset email used GoTrue's PKCE `/verify` link, which only works in the
browser that asked for it (the code verifier lives in that browser's
cookies). It failed from another device, in a mail app's in-app browser, and
on iOS when the request came from the installed PWA, whose cookie jar Safari
does not share.

- `supabase/templates/recovery.html` links to
  `{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=recovery&next=/reset`.
  `{{ .RedirectTo }}`, not `{{ .SiteURL }}`: the three apps share one Auth
  project and one Site URL, and each app's forgot action sends its own
  `<origin>/auth/confirm` (`recoveryRedirect()` in `packages/db/src/origin.ts`).
- Each app has `/auth/confirm`, which calls
  `verifyOtp({ type: 'recovery', token_hash })` and redirects to the safe
  `next` (default `/reset`). It accepts `type=recovery` only. It also takes a
  PKCE `code`, so a project still on the default template keeps working.
  `/auth/callback` stays for the code exchange.
- The link's origin is the app's `NEXT_PUBLIC_{OFFICE,STAFF,CLIENT}_URL`
  and nothing else. In production without it the forgot action refuses in
  words: `VERCEL_URL` (a deployment URL, off the allow-list and behind
  Vercel SSO) and `127.0.0.1` are no longer fallbacks (`appOrigin()`). CI
  gives the e2e apps their URLs and turbo passes them through.
- `supabase/config.toml` allows `/auth/callback**` and `/auth/confirm**` on
  the three apps and nothing else. A redirect off that list makes GoTrue
  fall back to the Site URL; unlike the 25.09 round, no middleware forwards
  a token that lands on `/`, so the allow-list is what keeps the link on its
  app.

**One reset flow in the office (D12).** The unlinked `/login/forgot`,
`/login/forgot/sent`, `/login/reset` and `/login/callback` (and their own
`safeNext.ts`, which turned `/..//evil.com` into `//evil.com`) are deleted,
with the Staff App's unused copy. `/forgot` → `/forgot/sent` → the email →
`/auth/confirm` → `/reset` is the one flow, as in the other two apps, and
`next` is decided only by `safeNextPath` in `packages/db/src/redirect.ts`.

**Also in `[auth]`:** sign-ups off (the admin API's invite does not need
them; `[auth.email] enable_signup` stays on, or email + password sign-in
would stop), minimum password length 10 with letters and digits (the rule
every set-password screen already enforces), and `secure_password_change`
on (every password change in the apps runs on a fresh session).

**Known limit.** A link scanner that GETs every URL in an email spends the
token before the person clicks. GoTrue's own `/verify` link has the same
property, so this is no regression; an interstitial "Continue" button would
close it and is left for THC to ask for.

## Owner steps (hosted project)

- Authentication → Email Templates → Reset Password: the body of
  `supabase/templates/recovery.html`.
- Authentication → URL Configuration → Redirect URLs: for each app's public
  URL, `<url>/auth/callback**` and `<url>/auth/confirm**`.
- Vercel: `NEXT_PUBLIC_OFFICE_URL`, `NEXT_PUBLIC_STAFF_URL`,
  `NEXT_PUBLIC_CLIENT_URL` on their projects (Production and Preview), and
  `SUPABASE_SERVICE_ROLE_KEY` on the Staff App (`/apply` refuses without it).
- Authentication → Providers → Email / Sign In: sign-ups off, minimum
  password length 10 with letters and digits, secure password change on —
  as `supabase/config.toml` now sets locally.
