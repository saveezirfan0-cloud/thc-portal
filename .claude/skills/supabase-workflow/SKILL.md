---
name: supabase-workflow
description: How this repo does Supabase — migrations, RLS policies with pgTAP tests, Edge Functions, pg_cron jobs, type generation, branching per PR, and using the Supabase MCP connector safely. Use whenever touching the database, functions, or jobs.
---

# Supabase workflow (THC)

## Migrations
- Files: `supabase/migrations/NNNN_name.sql`, forward-only, never edit an applied file. Local: `supabase db reset` (applies all + `seed.sql`). Remote: `supabase db push` (staging) — production only via CI after review.
- After schema changes: `supabase gen types typescript --linked > packages/db/src/types.ts` and commit.
- Every new table: `alter table … enable row level security;` + policies for `admin`, `client`, `staff` + a pgTAP test in `supabase/tests/NNN_table_rls.sql` (`supabase test db`).
- Calculated values are functions/views, never columns: `final_rate()`, `weekly_cap_hours()`, `event_windows`, `event_status()`, `payable_shifts_v`.
- Atomic business transitions are `security definer` functions with `select … for update` (e.g. `accept_invite`, `attempt_check_in`, `cancel_event`). They write `audit_log` and enqueue `notification_outbox` rows with unique keys.

## Edge Functions
- `supabase/functions/<name>/index.ts` (Deno). Shared code in `supabase/functions/_shared/`. Domain maths is imported from `packages/domain` (build step copies or use an import map).
- Secrets via `supabase secrets set`. Verify webhook signatures (Willo). Return quickly; long work goes through the outbox/queue tables.
- Jobs are HTTP endpoints called by `pg_cron` + `pg_net`; they must be idempotent and write a `job_runs` row (started, finished, counts, error).

## Cron (Europe/London)
`cron.schedule('auto_staffing_hourly', '17 * * * *', $$select net.http_post(...)$$)` etc. pg_cron is UTC; for jobs at fixed UK wall-clock times (05:00, 12:05, Monday 09:00) schedule both DST variants guarded by a `is_uk_time(now(), 'HH:MM')` check, or run every 5 minutes and let the function decide — the latter is simpler and is what this repo does for cutoff and daily jobs.

## Using the Supabase MCP connector in Claude
- Read before write: `list_tables`, `get_advisors` (security + performance) before `apply_migration`.
- Prefer a branch (`create_branch`) for anything experimental; merge with `merge_branch` after tests.
- Never run destructive SQL against production from a chat session; production changes go through CI.
