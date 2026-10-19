# 22 · Go-live audit, 17–18 October 2026 (Back Office and Staff App)

Scope: the Back Office and the Staff App, and the Supabase project they share, before go-live with
about 1,000 workers and 10–15 events a day. The Client Portal is out of scope (still changing),
except where its data path could leak Office or Staff data.

Six read-only audits ran in parallel: database performance (live timings and plans), Back Office
server speed, Staff App PWA, concurrency and caching, Supabase upgrade readiness, and security.
Seven fixers then worked in separate worktrees; every merge was checked against the **live**
function bodies before it landed (the migrations re-create functions from their live bodies and
stop if a pattern does not match).

## 1 · What the audits found on live

- **The database is undersized.** Micro/Nano compute: 2 shared cores, 60 connections, 36 used at
  rest. On 17.10 it logged 523 statement timeouts in 24 h and ran out of connection slots
  ("remaining connection slots are reserved"); the middleware hit Vercel's 25 s limit and
  `/events/[id]` ran the full 300 s.
- **The organisation is on the Free plan**: no backups, no PITR, read-only at 500 MB.
- **Migration drift**: `20261017180000_radar_reads_one_pool_row` was applied by hand during the
  17.10 incident and existed only on an unmerged branch. It is now on this branch (`6364f7e1`);
  without it the next `supabase db push` would have failed and blocked the Edge Function deploy.
- `staff_open_shifts()` (Radar) averaged 4.0 s with an 8.0 s max since 25.09; `auto_assign_candidates`
  cost ~7.5 ms per worker (≈ 7–25 s at 1,000 workers); `cron.job_run_details` was 137 MB of the
  227 MB database and never purged.
- The Staff App's Vercel functions ran in **iad1 (Washington)**, the database is in London.
- Set-returning reads were silently cut at PostgREST's `max_rows = 1000` — including the payroll
  CSV, the Monday finance email and the staff directory.
- No cross-user data leak through caching in either app; the same-shift locking (headcount,
  buffer, first-headcount check-ins) is sound; the 25.10 clock change is handled correctly.
- Security: no worker can act on another worker's data through any of the 187 authenticated
  definer functions; no live login uses the seed password.

Full reports (not committed; scratch): `audit-db.md`, `audit-office.md`, `audit-staff.md`,
`audit-concurrency.md`, `audit-supabase-upgrade.md`, `audit-security.md`.

## 2 · What this branch changes

| Area | Change | ADR |
|---|---|---|
| Radar + pool | `auto_assign_candidates_pool` computes history once per call; Radar prefilters sections and stops RULE-17 at the first qualified worker; `staff_open_shifts(p_staff, p_shift)` for `/radar/[id]`. Board per section 3.1 s → 0.20 s; rounds 1.3 s → 0.12 s; Radar worst case 69 s → 1.3 s (local, 1,000 workers / 600 sections) | 0156 |
| RULE-20 helpers | Pure helpers inline; table readers keep a plan per session. `weekly_cap_would_breach` 4.8 → 0.6 ms; `staff_bookings()` 590 → 12 ms; onboarding board 294 → 104 ms | 0155 |
| Booking races | Every path to `confirmed` locks the worker first (worker → section → booking); a double-tapped Accept answers success; one open violation of each once-only kind per booking; check-in lock is `FOR NO KEY UPDATE`; `booking_tick` reads a bounded window (570–960 ms → 60 ms at 100k bookings) | 0157 |
| Notifications | The drain records each row as it lands, has a time budget, sends six at a time; urgent register codes are claimed first | 0158 |
| Housekeeping | `cron.job_run_details` kept 7 days; idle per-minute `job_runs` pruned; 30 s pg_net timeout; two jobs staggered; four read indexes; server reads time out at 10 s, never writes | 0154 |
| Back Office | Every report, export, directory, Radar and board read pages past 1,000 rows and errors instead of returning short; `/events` fill counts from `office_event_sections()`; auto-staffing catches per section; timeouts read as a sentence | — |
| Staff App | `lhr1`; `/shifts` skips Radar; pings don't re-render; live location + Refresh location; presses never hang; `cache()` dedupe; middleware `getClaims()` + once-a-minute check; ~150 s refresh; push saved on change | 0152 |
| Middleware (both) | Bounded Supabase calls; a GoTrue outage is never cached as a sign-out (Office below aal2 answers a retryable 503) | 0154 |
| Tests | Fixtures in 120, 444, 731, 753 and 859 use the UK date; they failed for an hour every night | — |
| Office views (wave 2) | `staff_directory_v` works out booking history once per statement (4.2 s → 0.9 s at 1,000 workers); onboarding reads the login once; the compliance_blockers chain keeps its plans; the Needs-review badge is one RPC count | 0166 |
| Office streaming (wave 2) | Board, /staff, /staff/[id], /onboarding, /onboarding/[id], /clients/[id] paint at once and stream the slow parts; photo links reused for 30 min; last unbounded lists paged; client-card picker searches the server; /events refreshes every 60 s | 0161 |
| Staff App (wave 2) | Precache 115 → 32 entries (839 → 189 KiB gzipped per deploy); a stale tab reloads once on a missing chunk; uploads are one PUT to a server-signed URL (−70 kB); list cards stop prefetching | 0162 |
| Personal data (wave 2) | `dob`, `home_address`, `ni_number`, `share_code`, bank numbers and document-review columns revoked from the API roles; the office reads them through gated owner-rights views; `staff_self*` policies need a live, unbanned login; anon holds no table grants; the signed-in definer set is pinned by name | 0163 |
| Sessions and governance (wave 2) | Two-step compulsory for the Back Office (setting, enforced in `current_app_role()` too); office sign-in lasts 12 h; "Sign out others" drops those devices' push; nonce CSP, report-only; Willo deliveries applied once; GPS trail kept 90 days, delivery records 180 | 0164 |

**Deploy order (19.10).** Production applied `20261019170500_remove_shift_sections` from main, and
`supabase db push` skips anything numbered below the newest applied version. So this branch's
first-wave migrations moved to `20261019190000…195000`, and main's own
`20261019120000_new_starter_passport_country_and_address_lines` — on main but never applied, for
the same reason — moved to `20261019180000`. Every pending migration now sorts above production's
high-water mark.

Verified on the merged branch (20.10): every migration applied in order to an empty database;
pgTAP 260 files, 8,024 tests, 0 failures; lint, typecheck, Vitest and the three `next build`s
green. Before each merge, every function and view the migrations rewrite was compared with
production (md5 of `pg_get_functiondef` / `pg_get_viewdef`, all 636 objects): main and production
differ only in comments, which no pattern matches.

## 3 · Owner checklist

**Before you merge**
1. Supabase → Authentication → Multi-Factor: confirm **TOTP is on** (the default). With two-step
   compulsory, nobody can reach Back Office data without it.
2. Compute to **Medium** (it is still the original size: 60 connections, 224 MB shared buffers);
   turn on **PITR**. Take a `supabase db dump` and a Storage copy first.

**Straight after the deploy**
3. SQL editor, once: `select public.install_job_schedules();` — the 30 s timeout, the stagger and
   the four housekeeping jobs.
4. Everyone in the office is signed out (sessions are capped at 12 h) and each of the four office
   logins is asked to set up an authenticator before seeing any data. If enrolment fails for
   everyone: `update settings set value='false' where key='office_two_step_required';`
5. Check on a real phone: a document upload, the onboarding selfie, check-in and check-out, and
   that the PWA installs and opens offline.
6. Regenerate `packages/db/src/types.generated.ts` from live (`pnpm --filter @thc/db gen:types`).

**Settings**
7. Supabase Auth: custom SMTP (password resets otherwise reach only the project team), leaked-
   password protection, CAPTCHA (Turnstile), higher sign-in rate limits. Keep `pg_graphql` off and
   remove `graphql_public` from Exposed schemas.
8. Vercel: **Skew Protection** on for both projects; confirm the Staff App reports `lhr1`.
9. Before any in-place Postgres upgrade: prune `cron.job_run_details` by hand and vacuum it; pick a
   window clear of every section from start − 45 min to end + 4 h 15 min.

**Decisions still THC's**
- NS1 emails a plain CSV with NI and bank numbers to an external address; a signed-in link
  instead needs THC's sign-off.
- The worker's own screens still show their full sort code, account number and share code
  because the wireframes draw them in full.

**Before 31.12.2026**
- Supabase disables legacy API keys. The cron → Edge Function path, `isServiceCaller()` and
  `verify_jwt` depend on the legacy service-role JWT. The follow-up PR makes the code accept both.

## 4 · Left open, deliberately

- In a follow-up PR (in progress at merge time): Radar as one pool pass per worker (it is 0.5–1.7 s
  at scale today, inside the 8 s limit, above the 300 ms target) and `offer_wave1_exhausted()` once
  per call; library updates (supabase-js, Next 15.5 patch, Edge Functions' supabase-js) and support
  for the new `sb_publishable_` / `sb_secret_` keys.
- CSP is report-only. Before enforcing it, the Staff App's six prerendered pages must become
  dynamic so they carry a nonce (ADR-0164).
- Not streamed: `/clients`, `/reports`, `/feedback`, `/settings`; `/events` and `/checkin` stay
  unstreamed by ADR-0109.
- `staff_profile_v` by id is slower (12 → 116 ms) because the directory's totals are now computed
  agency-wide; read once per visit, no auto-refresh (ADR-0166).
