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
| Radar + pool | `auto_assign_candidates_pool` computes history once per call; Radar prefilters sections and stops RULE-17 at the first qualified worker; `staff_open_shifts(p_staff, p_shift)` for `/radar/[id]`. Board per section 3.1 s → 0.20 s; rounds 1.3 s → 0.12 s; Radar worst case 69 s → 1.3 s (local, 1,000 workers / 600 sections) | 0154 |
| RULE-20 helpers | Pure helpers inline; table readers keep a plan per session. `weekly_cap_would_breach` 4.8 → 0.6 ms; `staff_bookings()` 590 → 12 ms; onboarding board 294 → 104 ms | 0153 |
| Booking races | Every path to `confirmed` locks the worker first (worker → section → booking); a double-tapped Accept answers success; one open violation of each once-only kind per booking; check-in lock is `FOR NO KEY UPDATE`; `booking_tick` reads a bounded window (570–960 ms → 60 ms at 100k bookings) | 0155 |
| Notifications | The drain records each row as it lands, has a time budget, sends six at a time; urgent register codes are claimed first | 0156 |
| Housekeeping | `cron.job_run_details` kept 7 days; idle per-minute `job_runs` pruned; 30 s pg_net timeout; two jobs staggered; four read indexes; server reads time out at 10 s, never writes | 0152 |
| Back Office | Every report, export, directory, Radar and board read pages past 1,000 rows and errors instead of returning short; `/events` fill counts from `office_event_sections()`; auto-staffing catches per section; timeouts read as a sentence | 0151 |
| Staff App | `lhr1`; `/shifts` skips Radar; pings don't re-render; live location + Refresh location; presses never hang; `cache()` dedupe; middleware `getClaims()` + once-a-minute check; ~150 s refresh; push saved on change | 0150 |
| Middleware (both) | Bounded Supabase calls; a GoTrue outage is never cached as a sign-out (Office below aal2 answers a retryable 503) | 0152 |
| Tests | Fixtures in 120, 444, 731, 753 and 859 use the UK date; they failed for an hour every night | — |

Verified on the merged branch: all 301 migrations applied in order to an empty database; pgTAP
246 files, 7,652 tests, 0 failures; Vitest 5,656 tests; lint and typecheck clean; `next build`
of both apps compiles. Every function the new migrations rewrite was compared with live
(`pg_get_functiondef` / `pg_get_viewdef` md5): identical, apart from the 17.10 hotfix and a
comment-only `·`/`-` difference in `auto_assign_candidates`, which no pattern touches.

## 3 · Owner checklist

**Before go-live**
1. Move the organisation to **Pro**, then compute to **Medium** at least (Small is the floor and
   the minimum for PITR). Take a `supabase db dump` and a Storage copy first.
2. Merge this branch; `deploy-database` applies the migrations and redeploys the functions.
   Migrations before the Staff App deploy (`/radar/[id]` passes `p_shift`; the live app's
   no-argument call keeps working).
3. After the deploy, once: `select public.install_job_schedules();` (activates the 30 s timeout
   and the stagger; the purges start on their own).
4. Supabase Auth: custom SMTP (password resets otherwise reach only the project team), leaked-
   password protection, CAPTCHA (Turnstile), higher sign-in rate limits; a second factor on the
   four admin accounts.
5. Vercel: turn on **Skew Protection** for both projects; confirm the Staff App now reports
   `lhr1`.
6. Regenerate `packages/db/src/types.generated.ts` from live (close the stale #195).
7. Before any in-place Postgres upgrade: prune `cron.job_run_details` by hand and vacuum it; pick a
   window clear of every section from start − 45 min to end + 4 h 15 min.

**Decisions**
- Make two-step sign-in compulsory for owner and manager accounts (today it is opt-in).
- NS1 emails a plain CSV with NI and bank numbers to an external address; THC to sign off on a
  signed-in link instead.

**Before 31.12.2026**
- Supabase disables legacy API keys. The cron → Edge Function path, `isServiceCaller()` and
  `verify_jwt` all depend on the legacy service-role JWT. Migrate after go-live, never inside an
  upgrade window.

## 4 · Left open, deliberately

- `loading.tsx` on heavy Office routes: banned by `boundaries.test.tsx` (ADR-0109); a faster first
  paint needs an in-page Suspense per route.
- Radar is 0.5–1.7 s at scale — inside the limit, above the 300 ms target. Next step: one pool call
  judging one worker against many sections. `staff_open_offers` → `offer_wave1_exhausted()` per
  offer is the next hotspot (~0.13 s each).
- Security, medium: a signed-in phone can read its own bank and NI columns straight from PostgREST;
  no script CSP; office sessions have no server-side lifetime; Willo webhook token is replayable.
- `notification_outbox` and `location_pings` have no retention yet (proposals in ADR-0152).
- Library bumps (`@supabase/ssr` 0.12 changes cookie handling) after go-live, with an e2e run.
