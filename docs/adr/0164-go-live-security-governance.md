# ADR-0164 · Go-live security governance: compulsory two-step, a 12-hour office sign-in, a script policy, Willo replays and data retention

**Status:** Accepted (the product owner asked for complete security governance before go-live) · 19.10.2026 · **Builds on** ADR-0057 (two-step sign-in, its follow-up 1), ADR-0108 (session check), ADR-0032 (keep me signed in), ADR-0060 (office roles), ADR-0066 (Willo token), ADR-0154 (housekeeping jobs) · **§1.4, §1.7, §2.4, §8, §10.1, §10.2** · security audit 17.10 findings H1, M2, M4, L2 and ADR-0154's two retention proposals

Migrations `20261020130000` … `130300`; pgTAP 895–898; `packages/db/src/csp.ts`; `apps/office/app/login/office-policy.ts`, `login/enrol/**`; both apps' `middleware.ts`.

## Context

Measured on the live project, 19.10.2026 (read-only): four Back Office logins (two owners, two managers), **none** with an authenticator; office sessions up to 17 days old; 9,039 `notification_outbox` rows after three weeks and no retention on it or on `location_pings`. The audit's findings:

- **H1** — two-step is opt-in (ADR-0057), so one phished or reused office password reaches pay, bank details and every worker's documents.
- **M4** — nothing ends an office session server-side: a refresh token copied once keeps working. "Sign out other devices" in the Staff App left the other devices' push subscriptions, so a stolen phone kept receiving shift pushes.
- **M2** — no script policy: any HTML injection would be account takeover (`sb-*` cookies are readable by script, as @supabase/ssr requires).
- **L2** — the Willo webhook's secret is a token in its address (Willo signs nothing, ADR-0066); a captured delivery can be replayed.

## Decision

### 1 · Two-step sign-in is compulsory for the Back Office (H1)

- **Setting** `settings.office_two_step_required`, JSON boolean, **default `true`**, owner-editable on `/settings` ("Back Office sign-in"), audited by `settings_audit` like every setting, guarded by `settings_office_security_guard` (only a boolean is accepted). A missing or unreadable row reads as **required**.
- **Database** (`current_app_role()`, restated from the live body): for a Back Office token that names its sign-in session (`session_id`, which every GoTrue token carries), the role is NULL below `aal2` while the setting is on — with or without an authenticator. The old rule (a verified factor below aal2 → NULL) still applies whatever the setting. Staff and client logins are untouched. A token with no `session_id` (none GoTrue issues: jobs, pgTAP fixtures) is judged as before — the same line `20261013100100` drew for the session clause. `service_role` and every job are unaffected (`auth.uid()` is null; the service role bypasses RLS).
- **Middleware**: an admin at aal1 with no verified factor, on any non-public path (pages, server-action posts, `/api` other than the job routes), is redirected to **`/login/enrol?next=…`**. That page and sign-out are all it can reach. A login with a factor still goes to `/login/verify`. `/login/**`, `/auth/**`, `/forgot`, `/reset`, `POST /auth/signout` stay public, so nothing loops.
- **The enrol step** reuses `/account`'s set-up word for word (`TwoStepSetup`, extracted from `TwoStepPanel`): phone name → QR code and key → first code. Only the first paragraph differs ("Every Back Office login now needs two-step sign-in…"), and the card carries "Not you? Sign out". It talks to GoTrue only (`mfa.enroll`, `challengeAndVerify`), never to our tables, which refuse the session until it is at aal2. After the first correct code the page reloads at `next`.
- **The policy is the database's answer**, read with `office_session_policy()` (authenticated only) together with GoTrue's `getUser()`, once a minute per session (ADR-0108's cache). If the database cannot be asked, an aal2 session goes on (RLS decides), a code step owed is still owed, and an aal1 login with no factor gets the existing retryable 503 — never a page, never a skipped step. A database without the function yet (`PGRST202`) keeps ADR-0057's opt-in rule, so deploying the app before the migration does not lock anyone out.
- `/account`'s Remove stays (a phone change needs it); with two-step required its hint says the next sign-in asks for it again.

**Wireframe deviation.** No wireframe exists for an enrol step. It reuses the sign-in card (`AuthCard`, as `/login/verify` does) and the `/account` panel's set-up UI unchanged. `/settings` gains a "Back Office sign-in" block in the screen's existing Panel/Select/Input furniture (the screen has no wireframe either, docs/08).

### 2 · An office sign-in lasts 12 hours (M4)

- **Setting** `settings.office_session_max_hours`, whole number 1–24, **default 12**, same block on `/settings`, same guard.
- **Database**: `current_app_role()` answers NULL for a Back Office token whose `auth.sessions.created_at` — the moment of the password, which no refresh moves — is older than the setting. A null `created_at` counts as expired. So a stolen refresh token stops working however often it is refreshed.
- **Middleware**: `office_session_policy()` also returns the caller's own `sessionStartedAt`; every request compares it with now. Past the limit the `sb-*-auth-token` cookies are deleted on this device and the manager lands on `/login?next=…&expired=12`, which says "For security, a Back Office sign-in lasts 12 hours. Sign in again to carry on where you were." The age check comes before the enrol step.
- **Staff App "Sign out others"** now also calls `forget_other_push_subscriptions(keep)` (authenticated, `staff_caller()`: the caller's own rows only, live session only), keeping this device's endpoint as the browser reports it (bounded 1.5 s; none → all go, and the next launch's reconciliation re-saves this device's).

### 3 · A nonce-based script policy, report-only first (M2)

- Both middlewares build, per request, `default-src 'self'; script-src 'self' 'nonce-…' 'strict-dynamic' 'sha256-<appearance script>'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://api.mapbox.com [office: https://tile.openstreetmap.org] <supabase>; font-src 'self' data:; connect-src 'self' <supabase https> <supabase wss>; frame-src 'self'; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; report-uri /api/csp-report` (`packages/db/src/csp.ts`; dev adds `'unsafe-eval'` and `ws:`).
- **Derived from the code** (19.10): the browser connects only to the Supabase project — Storage uploads (the Staff App's signed-URL `PUT` with the apikey header, office evidence uploads) and Realtime (check-in monitor). Mapbox, Nominatim and postcodes.io are called from server actions; Mapbox and OSM appear only as tile images. Web Push needs no `connect-src` (the browser reaches its push service itself; the server sends). Fonts are self-hosted.
- **Next's nonce support**: the policy and `x-nonce` are set on the *request* headers, which `NextResponse.next({ request })` forwards; Next 15 reads the nonce from `content-security-policy` or `content-security-policy-report-only` and puts it on every inline script it renders. Our one inline script (the appearance script) is allowed by its SHA-256, pinned in `csp.ts` and recomputed by a test in each app, so no layout needed to change.
- **Report-only** (`CSP_HEADER = 'content-security-policy-report-only'`). Reports go to `POST /api/csp-report` in each app (no session; the middleware lets that one path through; body capped at 16 KB; up to five violations logged per report, URLs cut at `?`/`#`; nothing stored). The static headers in `next.config.ts` (`security-headers.ts`, including its frame-ancestors/base-uri/form-action/object-src CSP) stay **enforced** beside it.
- **Switching to enforce** is the one line `CSP_HEADER = 'content-security-policy'`, after a week of reports. Before that: the Staff App's prerendered pages (`/activate`, `/activate/done`, `/install`, `/offline`, `/privacy`, `/_not-found` — the build's ○ routes, 19.10) carry no nonce on Next's inline scripts and would stop hydrating, so the enforcing PR makes them dynamic (`export const dynamic = 'force-dynamic'`, or the root layout reads `headers()`) and checks `/offline` from the service-worker cache. The Back Office has no static HTML route today.

### 4 · A Willo delivery is applied once (L2)

- `willo_deliveries` (admin_read, `office_read_only`, written only by `willo_record_event()`): one row per **applied** delivery, keyed `sha256:<hex of the raw body>` (`willoDeliveryKey`). Not Willo's own id: where Willo puts one is unconfirmed (ADR-0021, ADR-0066), and the body's `id` may be the participant's, which would merge every event of a candidate.
- `willo_record_event(…, p_delivery_key)` and `willo_accept_with_account(…, p_delivery_key)` (restated from the live bodies; the four- and five-argument versions dropped, so a two-argument call is not ambiguous) record the key in the same transaction as the change, after the candidate's row lock. A key already recorded → `{outcome: duplicate}`, nothing changes; a refusal rolls the key back, so Willo's retry still applies. The receiver asks `willo_delivery_seen()` **before** it mints a login or token, so a replayed Accept never kills a live activation link.
- A delivery whose own time (`occurred_at`/`created_at`/`timestamp`) is older than `WILLO_MAX_EVENT_AGE_HOURS` (default 168) is answered `200 {outcome: stale}` and applies nothing. `WILLO_TIMESTAMP_HEADER`, when set, is now checked on the token path too.
- **What this does not fix**: anyone holding the token can *forge* any body. Rotate `WILLO_WEBHOOK_SECRET` (re-register the webhook address in Willo) on a schedule and whenever it may have been seen; check that the edge-log retention hides query strings.

### 5 · Retention (GDPR minimisation; ADR-0154's proposals)

Two daily jobs through ADR-0154's entry point (`run_housekeeping_job`, `install_housekeeping_schedules`, restated with both added; `install_job_schedules()` already calls the installer): `location-pings-purge` at 03:51 UTC and `outbox-purge` at 03:56 UTC, each in batches of 5,000 and at most 50,000 rows a run, with `job_runs` rows like every job.

- **`location_pings`: 90 days after the role section's end** (`shift_requirements.ends_at`), unless the booking has an unresolved violation. There is no "query" entity on a booking in this schema; a dispute is a violation. **Pay never reads the trail after check-out** — confirmed on the live bodies: `check_out()` reads the last on-site fix from `location_pings` only while the worker presses Check out (the window closes at end + 4 h) and stores it on `check_logs.last_on_site_at`, which `record_ping()` also keeps current; payroll reads `check_logs`. pgTAP 898 pins the set of functions that read the table. Index `location_pings(at)`.
- **`notification_outbox`: rows finished more than 180 days ago.** A key is a row's send-once guarantee (`on conflict (key) do nothing`), and some readers count or read history, so every key family was audited (19.10, in the SQL of every live function that inserts or reads the outbox and in the §8 register):

| Treatment | Families | Why |
|---|---|---|
| **Deleted** | IR1, E2, E4, E5, E5b, E7, E10, E12, CL5, CL6, CP1, CP2, CP3, CR2, CR3, N5, N6, N6b, N7, N9, N9b, N10, N10b, N10c, N10d, N11, N11b, N12, N13, N14, OF1–OF6, OM1, OM2, RC1–RC5 | The key carries a time (epoch, day, period) or a one-off thing that is over (a booking whose shift has passed, an offer, a request, a message, an attempt); never numbered by counting rows; no reader needs the row. IR1's daily reminder check and the N6 release check look at the current day/shift only. |
| **Tombstoned** (key, template, channel, times kept; recipients, error and payload removed except the ladder fields `rung`/`at`/`variant`; `payload.retired` set) | E3, E6, E8, E9, E11, E2b, CL1–CL4, CR1, N1–N4, N8, N15, OC1–OC3, D1, D2, **and any family not named above** (the safe default) | Once-ever keys (E6 per worker, OC1 notice per worker, CR1 per quiz and worker, a document's N1–N4/N8/CL1–3, a declaration's E9/N8/N15, CL4 per expiry date) must never send twice; E11, E3 resend and D1/D2 number their keys by counting rows; the onboarding chasers (E3, OC1–OC3) read the last rung and its time. |
| **Kept whole** | NS1, BG08 | `retry_finance_report()` copies the failed row's payload into the retry. One row a week each. |

  The Back Office reports that read outbox history (`staff_email_report`, `invite_roster_report`, the inbox) show 180 days from now on. Partial index on `coalesce(sent_at, failed_at)` for finished, unretired rows.
- **`willo_deliveries`**: 180 days, in the same `outbox-purge` run.

## Owner checklist (before the deploy that carries this)

1. **TOTP must be on for the hosted project** (Dashboard → Authentication → Multi-Factor → TOTP enrol + verify). If it is off, no office login can enrol, and with two-step required none can reach any data. Check it first.
2. **Deploy order**: migrations first, then the Edge Function `willo-webhook` and the two apps. (Either app before the migration is safe; the Edge Function before it answers 500 to Willo until it lands, and Willo retries.)
3. **Tell the four office users**: on their next page they are asked to set up an authenticator app (Google or Microsoft Authenticator), and a sign-in now lasts 12 hours, so they sign in at least once a working day. Existing sessions older than 12 hours (all four today) end at once.
4. **Recovery if nobody can enrol** (TOTP off, a lost phone with no other owner): `/settings` is itself behind two-step, so use the SQL editor — `update settings set value = 'false' where key = 'office_two_step_required';` — then ADR-0057's recovery. Switch it back on afterwards.
5. Read `[csp] violation` warnings in both apps' Vercel logs for a week before the enforcing PR (§3).

## Known limits

- The refresh token past 12 hours still refreshes at GoTrue; it only stops reaching anything (the database refuses it, the middleware signs it out). Supabase's own `[auth.sessions] timebox` would end it in GoTrue too, but it is per project, so it would also end workers' sessions; not set.
- The middleware's session age comes from `auth.sessions` via `office_session_policy()`, cached a minute; the database's check is per statement.
- A token with no `session_id` is not held to the two new rules (none that GoTrue issues lacks one; forging one needs the project's signing key).
- `check_logs.location` (the check-in point) is not covered by the 90 days; it is part of the pay and violation record. A decision for the data protection lead, with ADR-0019's retention.
- Willo body forging with a known token (§4).

## Consequences

- Live objects re-created: `current_app_role()`, `willo_record_event` (new signature), `willo_accept_with_account` (new signature), and — not yet on the live project, from `20261019120000` — `run_housekeeping_job()`, `install_housekeeping_schedules()`. New: `settings_office_security_guard()` + trigger, `office_security_settings()`, `office_session_policy()`, `forget_other_push_subscriptions()`, `willo_deliveries`, `willo_delivery_seen()`, `location_pings_purge()`, `notification_outbox_deletable_templates()`, `notification_outbox_purge()`, two indexes, two settings rows, two pg_cron jobs.
- Changed pins: 001 (willo_deliveries in assertions 1 and 3), 756 (its live-session admin is aal2), 860 (four housekeeping jobs). Existing middleware test mocks gained an `rpc` answering the policy as "optional", ADR-0057's world; the compulsory case is `middleware-policy.test.ts`.
- `packages/db/src/types.generated.ts` hand-edited for the new functions and table; regenerate after deploy.
