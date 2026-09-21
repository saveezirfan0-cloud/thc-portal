-- =====================================================================
-- The jobs layer (§7) and the outbox drain (§8)
--
-- Why this exists
-- ---------------
-- §7 is ten background rules that "run themselves, with no screen", plus
-- the cron entries in docs/01-architecture.md §4. None of them existed:
-- there were no Edge Functions at all, and `notification_outbox` had no
-- way to be drained, so every row the transition functions enqueue has
-- been sitting there unsent.
--
-- This migration builds the plumbing the jobs share, not the jobs
-- themselves. Auto-assign (§3.4), the per-booking timers (BG-01/02/02b/
-- 03/09/10), the daily compliance sweep (BG-04/05) and the Monday finance
-- send (BG-08) each belong to their own domain and their own session;
-- what they all need first is somewhere to record that they ran, a way to
-- claim outbox work without two runners sending the same push, and a
-- retry that does not lose a send.
--
-- Three things, then:
--
--   1. `job_runs` — one row per execution, with counts and an error.
--      Every job writes one. Without it a failed 12:05 cutoff is silent.
--   2. Outbox claim/complete with a lease and exponential backoff. The
--      unique `key` already makes enqueueing idempotent; this makes
--      *sending* idempotent, which is the half that was missing.
--   3. `job_schedules` — the cron registry as data, plus
--      `install_job_schedules()` to apply it.
--
-- Why the schedules are data and not `cron.schedule` calls
-- --------------------------------------------------------
-- Scheduling at migration time would start firing net.http_post every
-- minute against an Edge Function URL that does not exist yet, on every
-- `supabase start` in CI. The registry records what should be scheduled;
-- a deploy against a real project runs `select install_job_schedules()`
-- once. That also keeps the service-role key out of this file: the cron
-- command reads the URL from `settings` and the key from `vault` at
-- execution time, so neither is baked into a stored command string.
--
-- pg_cron and pg_net are already created by 0001_init.sql.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1 · job_runs
--
-- Written only by the definer functions below and by Edge Functions on
-- the service key, both of which bypass RLS. Admin reads it because the
-- Back Office will show it; a worker and a client never see it. Same
-- shape as audit_log, report_sends and notification_outbox (§9.9).
-- ---------------------------------------------------------------------
create table job_runs (
  id          bigint generated always as identity primary key,
  job         text        not null,
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  ok          boolean,
  counts      jsonb       not null default '{}'::jsonb,
  error       text,
  constraint job_runs_finished_has_verdict
    check ((finished_at is null) = (ok is null))
);

create index job_runs_job_started_idx on job_runs (job, started_at desc);
-- The "is anything stuck?" query: an unfinished run older than its lease.
create index job_runs_unfinished_idx on job_runs (started_at) where finished_at is null;

alter table job_runs enable row level security;
create policy admin_read on job_runs for select using (current_app_role() = 'admin');

create or replace function public.job_run_start(p_job text) returns bigint
language sql security definer set search_path = public, extensions as $$
  insert into job_runs (job) values (p_job) returning id;
$$;

create or replace function public.job_run_finish(
  p_id bigint, p_ok boolean, p_counts jsonb default '{}'::jsonb, p_error text default null
) returns void
language sql security definer set search_path = public, extensions as $$
  update job_runs
     set finished_at = now(), ok = p_ok, counts = coalesce(p_counts, '{}'::jsonb), error = p_error
   where id = p_id and finished_at is null;
$$;

-- ---------------------------------------------------------------------
-- 2 · Outbox: attempts, lease, backoff
--
-- `key` (0001) stops the same notification being ENQUEUED twice. It does
-- nothing about sending: two drains a minute apart both see the same
-- unsent row and both send it. The lease below is what stops that —
-- claiming pushes send_after into the future, so a second runner's
-- `send_after <= now()` no longer matches.
--
-- A send that fails must come back, not vanish. `failed_at` alone made
-- the first network blip terminal. Now a failure re-arms with backoff and
-- only becomes terminal at the attempt ceiling.
-- ---------------------------------------------------------------------
alter table notification_outbox
  add column attempts        integer not null default 0,
  add column last_attempt_at timestamptz;

comment on column notification_outbox.attempts is
  'Claims, not sends: incremented when a drain leases the row (§8).';

-- 1m, 2m, 4m, 8m, 16m, capped at 30m. Deterministic so the pgTAP test and
-- the TypeScript in packages/notifications can assert the same numbers.
create or replace function public.outbox_backoff(p_attempt integer) returns interval
language sql immutable set search_path = public, extensions as $$
  select least(interval '30 minutes',
               interval '1 minute' * power(2, greatest(p_attempt, 1) - 1));
$$;

-- Claim a batch. `for update skip locked` so concurrent drains take
-- disjoint sets rather than blocking on each other.
create or replace function public.claim_outbox_batch(
  p_limit integer default 50, p_lease interval default interval '5 minutes'
) returns setof notification_outbox
language plpgsql security definer set search_path = public, extensions as $$
begin
  return query
  with due as (
    select o.id from notification_outbox o
     where o.sent_at is null and o.failed_at is null and o.send_after <= now()
     order by o.send_after
     limit greatest(p_limit, 0)
     for update skip locked
  )
  update notification_outbox o
     set attempts = o.attempts + 1,
         last_attempt_at = now(),
         send_after = now() + p_lease      -- the lease: hides it from other runners
    from due
   where o.id = due.id
  returning o.*;
end;
$$;

-- Settle a claimed row: sent, re-armed with backoff, or finally failed.
create or replace function public.complete_outbox_send(
  p_id bigint, p_ok boolean, p_error text default null, p_max_attempts integer default 6
) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if p_ok then
    update notification_outbox
       set sent_at = now(), error = null, send_after = least(send_after, now())
     where id = p_id and sent_at is null;
  else
    update notification_outbox
       set error = p_error,
           failed_at = case when attempts >= p_max_attempts then now() else null end,
           send_after = case when attempts >= p_max_attempts
                             then send_after
                             else now() + outbox_backoff(attempts) end
     where id = p_id and sent_at is null and failed_at is null;
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- 3 · The cron registry
--
-- One row per entry in docs/01-architecture.md §4. Schedules are UTC,
-- because pg_cron is: the UK wall-clock jobs (05:00 daily, 12:05 cutoff,
-- Monday 09:00) therefore drift by an hour across the DST boundary. The
-- repo's stated answer (.claude/skills/supabase-workflow) is to run those
-- more often than needed and let the function decide whether it is the
-- right UK minute, which is why `compliance-daily` and the cutoff are
-- every-5-minute entries with the decision in the function rather than
-- in the schedule. `enabled` lets a deploy install a subset while the
-- rest of the Edge Functions are still being built.
-- ---------------------------------------------------------------------
create table job_schedules (
  job             text primary key,
  cron_expression text    not null,
  edge_path       text    not null,
  enabled         boolean not null default false,
  note            text
);

alter table job_schedules enable row level security;
create policy admin_read on job_schedules for select using (current_app_role() = 'admin');

insert into job_schedules (job, cron_expression, edge_path, enabled, note) values
  ('notify-drain', '* * * * *', 'notify-drain', true,
   'Outbox drain (§8): Web Push + email, retries with backoff. The one job whose Edge Function exists.'),
  ('booking-tick', '* * * * *', 'booking-tick', false,
   'BG-01/02/02b/03/09/10 per-booking timers (§7). Edge Function not built yet.'),
  ('auto-staffing-hourly', '17 * * * *', 'auto-staffing?mode=hourly', false,
   'Auto-assign additive round (§3.4). Edge Function not built yet.'),
  ('auto-staffing-escalation', '*/10 * * * *', 'auto-staffing?mode=escalation', false,
   'Escalation for events under way and short (§3.4). Edge Function not built yet.'),
  ('auto-staffing-cutoff', '*/5 * * * *', 'auto-staffing?mode=cutoff', false,
   'The 12:05 UK cutoff (§3.5). Every 5 min; the function decides if it is the right UK minute (DST).'),
  ('compliance-daily', '*/5 * * * *', 'compliance-daily', false,
   'BG-04/05 expiry ladder, auto-block, N14 cap bands (§4). Every 5 min; the function picks 05:00 UK.'),
  ('finance-reports', '*/5 * * * *', 'finance-reports', false,
   'BG-08 Monday 09:00 UK finance send (§9.9). Every 5 min; the function picks the UK minute.');

-- Apply the registry to pg_cron. Deliberately NOT called by this
-- migration — see the header. Idempotent: unschedule then schedule.
create or replace function public.install_job_schedules() returns integer
language plpgsql security definer set search_path = public, extensions as $$
declare
  r        record;
  n        integer := 0;
  v_command text;
begin
  for r in select * from job_schedules loop
    -- cron.unschedule throws if the job is absent, which is the normal
    -- first-install case, so it is not an error here.
    begin
      perform cron.unschedule(r.job);
    exception when others then
      null;
    end;

    continue when not r.enabled;

    -- Both secrets are read when the command RUNS, not now, so nothing
    -- sensitive is stored in the pg_cron command string.
    v_command := format(
      $cmd$select net.http_post(
              url := (select value #>> '{}' from public.settings where key = 'edge_base_url') || '/%s',
              headers := jsonb_build_object(
                'Content-Type', 'application/json',
                'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')
              ),
              body := jsonb_build_object('job', %L)
            );$cmd$, r.edge_path, r.job);

    perform cron.schedule(r.job, r.cron_expression, v_command);
    n := n + 1;
  end loop;
  return n;
end;
$$;

comment on function public.install_job_schedules() is
  'Applies job_schedules to pg_cron. Run once per deploy; needs settings.edge_base_url and vault secret service_role_key.';
