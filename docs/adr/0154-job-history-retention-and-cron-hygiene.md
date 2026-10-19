# ADR-0154 · Job history retention, cron call hygiene and server request timeouts

Status: accepted · 18.10.2026 · **Amends** ADR-0025 (`job_runs_purge`)

Scope v1.6 §7 · `supabase/migrations/20261019120000_job_history_retention.sql` ·
`20261019120100_cron_http_timeout_and_stagger.sql` · `20261019120200_go_live_read_indexes.sql` ·
`packages/db/src/request-timeout.ts`

## Context

The go-live audits (17.10.2026, read-only against the live project) found:

- `cron.job_run_details` at 130k rows / 137 MB after 19 days, never purged: 60% of the
  database, on a plan that goes read-only at 500 MB, and a table Supabase's in-place upgrade
  duplicates.
- `job_runs` at 116k rows. The four per-minute jobs write 1,440 rows a day each, nearly all
  no-ops; `job_runs_purge()` only pruned rtw-check's, and only when the Back Office route ran.
- 9% of pg_cron's HTTP calls in six hours hit pg_net's default 5 s timeout, mostly on DNS,
  with eight to eleven `net.http_post` calls firing in the same second at :00 and :05.
- Hot reads with no fitting index: `rota_guard_warnings_v` (audit_log by action),
  "not ended yet" on `shift_requirements.ends_at`, `quiz_attempts` by worker and time.
- No request timeout on the server Supabase clients: a slow PostgREST or GoTrue holds a
  Vercel function (and, in middleware, the whole page) until the platform kills it.

## Decision

1. **Housekeeping is SQL, scheduled by the database itself.** `cron-history-purge`
   (03:41 UTC daily: `cron.job_run_details` older than 7 days, ≤100k rows a call in batches of
   10k) and `job-runs-purge` (hourly at :46) run `run_housekeeping_job(job)`, which writes a
   `job_runs` row like every other job. `install_housekeeping_schedules()` schedules them; the
   migration calls it (no secrets, no HTTP, so nothing waits for the owner) and so does
   `install_job_schedules()`, so the post-upgrade reinstall keeps them. They are not
   `job_schedules` rows: that table holds HTTP jobs only, and a free-text SQL command in a
   table would be a way to run arbitrary SQL as the cron owner.
2. **An idle run is defined once.** `job_run_counts_idle(counts)`: no non-zero number, no
   `true`, no `*error*` key holding a message, at any depth. `job_runs_purge()` (same
   signature) prunes the idle runs of every per-minute job (registry rows on `* * * * *`,
   plus rtw-check and the two housekeeping jobs) after 2 days, keeping each job's newest row as
   its heartbeat. Failures and runs that did work keep 90 days. Each branch is capped at 20k
   rows a call in batches of 5k, so a PostgREST caller stays inside its 8 s limit. Other jobs'
   idle runs are unchanged (90 days); widening that needs each job's counts shape checked first.
3. **pg_cron's HTTP calls wait 30 s** (`timeout_milliseconds := 30000`); the response is never
   read, so this only stops false "timeout" rows from hiding real 401s and 404s.
4. **Staggered only where no rule fixes the minute.** `gdpr-purge` moves to `3-59/5` and
   `auto-staffing-escalation` to `4-59/10` (still every 10 minutes, §7). The 12:05 cutoff
   (§3.5), 05:00 compliance sweep (§7) and Monday 09:00 finance send (§9.9) stay on `*/5`,
   and the two Back Office document jobs stay on `*/15` (ADR-0074, ADR-0091 times), so no
   scope or ADR time moves by a minute. The per-minute jobs cannot be offset within a minute.
5. **Indexes** for the three hot reads, plain `create index if not exists` (migrations run in
   a transaction; the tables are small today).
6. **Server clients time out reads.** `createRequestTimeoutFetch()` aborts GET/HEAD to
   PostgREST and GoTrue after 10 s by default (Storage and Functions are left alone: a file
   download may be legitimately slow). Writes, and RPCs over POST, are never aborted unless
   the caller lists the RPC as read-only, because a write aborted mid-flight has an unknown
   outcome. GoTrue's `GET /auth/v1/user` (`getUser()`) can have its own shorter limit, for the
   middleware's session check. `createClient()` and `createAdminClient()` use it by default.

## Not done

- `notification_outbox` and `location_pings` retention: product decisions (how long a
  delivery record and a GPS trail are kept), proposed in the go-live report, not built.
- Watchdog alerting on a job with no `job_runs` row in its window.
- The apps' middleware call sites: they build their own `createServerClient`; the one-line
  change is for the app owners (go-live report).
