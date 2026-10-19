-- =====================================================================
-- Migration 20261020130300 · how long a GPS trail and a delivery record
--                            are kept (ADR-0164, building on ADR-0154's
--                            housekeeping jobs; UK GDPR Art. 5(1)(c), (e))
--
-- ADR-0154 left two proposals unbuilt: location_pings and
-- notification_outbox kept every row for ever. Live, 19.10.2026: 9,039
-- outbox rows in three weeks (6.6 MB; 5,988 of them IR1), 25 pings.
--
-- 1 · location_pings: deleted 90 days after the END of the booking's role
--     section (shift_requirements.ends_at, RULE-18's own window), unless
--     the booking still has an unresolved violation. There is no "query"
--     entity on a booking in this schema (checked 19.10: no table carries
--     one), so a dispute is a violation or nothing.
--     Pay never reads the trail after check-out (checked on the live
--     bodies): check_out() reads location_pings for the last on-site fix
--     only while the worker presses Check out — the window closes at
--     end + 4 h — and writes it to check_logs.last_on_site_at, which
--     record_ping() also keeps current on every on-site fix. Payroll reads
--     check_logs. So the 90 days is never shorter than pay needs.
--     The candidate scan walks a new index on location_pings(at): a ping
--     is never later than its check-out, and a booking whose section ended
--     before the cut-off has no ping after the cut-off + 1 day except a
--     trail never checked out, which ages into the scan later.
-- 2 · notification_outbox: rows finished (sent or failed for good) more
--     than 180 days ago. A row's key is its send-once guarantee
--     (`on conflict (key) do nothing`), and some readers look at history,
--     so the families are not all treated alike — the audit of every key
--     family is in ADR-0164:
--       · DELETED — the key carries a time (an epoch, a day, a period) or
--         a one-off thing that is over (a booking whose shift has passed,
--         an offer, a request, a message, an attempt), it is never
--         numbered by counting rows, and no reader needs the row:
--           IR1 E2 E4 E5 E5b E7 E10 E12 CL5 CL6 CP1 CP2 CP3 CR2 CR3
--           N5 N6 N6b N7 N9 N9b N10 N10b N10c N10d N11 N11b N12 N13 N14
--           OF1 OF2 OF3 OF4 OF5 OF6 OM1 OM2 RC1 RC2 RC3 RC4 RC5
--       · TOMBSTONED — every other family, including any added later
--         that is not named above (the safe default). The row stays with
--         its key, template, channel and times; recipient_emails and error
--         become null and the payload keeps only the non-personal ladder
--         fields the onboarding chasers read (rung, at, variant) plus
--         {"retired": <date>}. So a once-ever key (E6 per worker, OC1
--         notice, CR1 per quiz and worker, a document's N1–N4/N8/CL1–3,
--         a declaration's E9/N8/N15) is never sent twice, the
--         row-counting families (E11, E3 resend, D1/D2) keep their
--         numbering, and the chaser ladder (E3, OC1–OC3) keeps its rungs.
--       · KEPT — NS1 and BG08: retry_finance_report() copies the failed
--         row's payload into the retry. One row a week each.
-- 3 · willo_deliveries (20261020130200): deleted 180 days after applied.
-- 4 · Two more housekeeping jobs through ADR-0154's entry point,
--         location-pings-purge   '51 3 * * *'  daily, 03:51 UTC
--         outbox-purge           '56 3 * * *'  daily, 03:56 UTC
--     both clear of every other job's minute and before the 05:00 UK
--     compliance sweep; batches of 5,000, at most 50,000 rows a run each,
--     so a backlog drains over a few nights instead of in one long
--     transaction. run_housekeeping_job() and
--     install_housekeeping_schedules() are restated from their only
--     definition (20261019120000; not yet on the live project, which still
--     runs the pre-ADR-0154 set) with the two jobs added.
--
-- pgTAP 898; 860 now counts four housekeeping jobs.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1 · location_pings
-- ---------------------------------------------------------------------
create index if not exists location_pings_at_idx on public.location_pings (at);

create or replace function public.location_pings_purge(
  p_keep_days int default 90,
  p_max_rows  int default 50000
) returns int
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  c_batch  constant int := 5000;
  v_cutoff timestamptz := now() - make_interval(days => greatest(coalesce(p_keep_days, 90), 30));
  v_limit  int;
  v_n      int;
  v_total  int := 0;
begin
  while v_total < coalesce(p_max_rows, 0) loop
    v_limit := least(c_batch, p_max_rows - v_total);
    delete from location_pings p
     where p.id in (
       select lp.id
         from location_pings lp
         join bookings b           on b.id = lp.booking_id
         join shift_requirements sr on sr.id = b.shift_id
        where lp.at < v_cutoff + interval '1 day'
          and sr.ends_at < v_cutoff
          and not exists (select 1 from violations v
                           where v.booking_id = lp.booking_id and not v.resolved)
        order by lp.at
        limit v_limit);
    get diagnostics v_n = row_count;
    v_total := v_total + v_n;
    exit when v_n < v_limit;
  end loop;
  return v_total;
end $$;

comment on function public.location_pings_purge(int, int) is
  'ADR-0164: deletes the GPS trail of bookings whose role section ended more than p_keep_days ago (default 90, floor 30), unless the booking has an unresolved violation. Pay never reads it after check-out (check_logs.last_on_site_at). Batches of 5,000, at most p_max_rows per call. Returns the number deleted. Run daily by pg_cron (location-pings-purge).';

revoke execute on function public.location_pings_purge(int, int) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- 2 · notification_outbox
-- ---------------------------------------------------------------------
create index if not exists notification_outbox_finished_idx
  on public.notification_outbox ((coalesce(sent_at, failed_at)))
  where coalesce(sent_at, failed_at) is not null and not (payload ? 'retired');

-- The families whose rows go outright (see the header). Everything else is
-- tombstoned; NS1 and BG08 are kept.
create or replace function public.notification_outbox_deletable_templates()
returns text[]
language sql
immutable
set search_path = public, extensions
as $$
  select array['IR1','E2','E4','E5','E5b','E7','E10','E12','CL5','CL6',
               'CP1','CP2','CP3','CR2','CR3',
               'N5','N6','N6b','N7','N9','N9b','N10','N10b','N10c','N10d','N11','N11b',
               'N12','N13','N14',
               'OF1','OF2','OF3','OF4','OF5','OF6','OM1','OM2',
               'RC1','RC2','RC3','RC4','RC5']::text[]
$$;

comment on function public.notification_outbox_deletable_templates() is
  'ADR-0164: the outbox families whose finished rows notification_outbox_purge() deletes after 180 days — the key carries a time or a one-off thing that is over, is never numbered by counting rows, and no reader needs the row. Every other family is tombstoned (key and times kept); NS1 and BG08 are kept whole.';

revoke execute on function public.notification_outbox_deletable_templates() from public, anon, authenticated;

create or replace function public.notification_outbox_purge(
  p_keep_days int default 180,
  p_max_rows  int default 50000
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  c_batch    constant int := 5000;
  v_cutoff   timestamptz := now() - make_interval(days => greatest(coalesce(p_keep_days, 180), 30));
  v_delete   text[] := notification_outbox_deletable_templates();
  v_today    text := to_char(now() at time zone 'Europe/London', 'YYYY-MM-DD');
  v_limit    int;
  v_gone     int;
  v_kept     int;
  v_deleted  int := 0;
  v_retired  int := 0;
  v_willo    int := 0;
begin
  while v_deleted + v_retired < coalesce(p_max_rows, 0) loop
    v_limit := least(c_batch, p_max_rows - v_deleted - v_retired);
    with batch as (
      select o.id, o.template
        from notification_outbox o
       where coalesce(o.sent_at, o.failed_at) is not null
         and coalesce(o.sent_at, o.failed_at) < v_cutoff
         and not (o.payload ? 'retired')
         and o.template not in ('NS1', 'BG08')
       order by coalesce(o.sent_at, o.failed_at)
       limit v_limit
         for update skip locked
    ), gone as (
      delete from notification_outbox d
       using batch b
       where d.id = b.id and b.template = any (v_delete)
      returning 1
    ), kept as (
      update notification_outbox u
         set payload = (select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb)
                          from jsonb_each(u.payload) e
                         where e.key in ('rung', 'at', 'variant'))
                       || jsonb_build_object('retired', v_today),
             recipient_emails = null,
             error = null
        from batch b
       where u.id = b.id and not (b.template = any (v_delete))
      returning 1
    )
    select (select count(*)::int from gone), (select count(*)::int from kept)
      into v_gone, v_kept;
    v_deleted := v_deleted + v_gone;
    v_retired := v_retired + v_kept;
    exit when v_gone + v_kept < v_limit;
  end loop;

  -- 20261020130200's replay guard: the same 180 days.
  loop
    delete from willo_deliveries w
     where w.delivery_key in (
       select d.delivery_key from willo_deliveries d
        where d.applied_at < v_cutoff
        order by d.applied_at
        limit c_batch);
    get diagnostics v_gone = row_count;
    v_willo := v_willo + v_gone;
    exit when v_gone < c_batch or v_willo >= coalesce(p_max_rows, 0);
  end loop;

  return jsonb_build_object('deleted', v_deleted, 'tombstoned', v_retired, 'willoDeliveries', v_willo);
end $$;

comment on function public.notification_outbox_purge(int, int) is
  'ADR-0164: outbox rows finished (sent or failed) more than p_keep_days ago (default 180, floor 30) — deleted for the families notification_outbox_deletable_templates() names, tombstoned for every other (key, template, channel and times kept; recipients, error and every payload field but rung/at/variant removed; payload.retired set), NS1 and BG08 kept. Also deletes willo_deliveries older than the same cut-off. Batches of 5,000, at most p_max_rows outbox rows per call. Returns {deleted, tombstoned, willoDeliveries}. Run daily by pg_cron (outbox-purge).';

revoke execute on function public.notification_outbox_purge(int, int) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- 3 · The cron entry point (20261019120000, restated with two more jobs)
-- ---------------------------------------------------------------------
create or replace function public.run_housekeeping_job(p_job text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_run    bigint;
  v_n      int;
  v_counts jsonb;
begin
  if p_job is null or p_job not in ('job-runs-purge', 'cron-history-purge',
                                    'location-pings-purge', 'outbox-purge') then
    raise exception 'unknown housekeeping job %', coalesce(p_job, '(null)')
      using errcode = '22023';
  end if;

  v_run := job_run_start(p_job);
  begin
    if p_job = 'job-runs-purge' then
      v_n := job_runs_purge();
      v_counts := jsonb_build_object('deleted', v_n);
    elsif p_job = 'cron-history-purge' then
      v_n := cron_history_purge();
      v_counts := jsonb_build_object('deleted', v_n);
    elsif p_job = 'location-pings-purge' then
      v_n := location_pings_purge();
      v_counts := jsonb_build_object('deleted', v_n);
    else
      v_counts := notification_outbox_purge();
    end if;
    perform job_run_finish(v_run, true, v_counts);
    return jsonb_build_object('job', p_job, 'ok', true, 'counts', v_counts);
  exception when others then
    perform job_run_finish(v_run, false, '{}'::jsonb, sqlerrm);
    return jsonb_build_object('job', p_job, 'ok', false, 'error', sqlerrm);
  end;
end $$;

comment on function public.run_housekeeping_job(text) is
  'pg_cron entry point for the SQL-only housekeeping jobs (job-runs-purge, cron-history-purge — ADR-0154; location-pings-purge, outbox-purge — ADR-0164). Writes a job_runs row with its counts and records a failure rather than raising.';

revoke execute on function public.run_housekeeping_job(text) from public, anon, authenticated, service_role;

create or replace function public.install_housekeeping_schedules()
returns integer
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  r record;
  n integer := 0;
begin
  if to_regnamespace('cron') is null then
    raise notice 'pg_cron is not installed; the housekeeping jobs are not scheduled';
    return 0;
  end if;

  -- UTC. None is a UK wall-clock rule, so there is no DST pair: 03:41 UTC
  -- is 03:41 GMT / 04:41 BST. Every minute avoids every HTTP job's.
  for r in
    select * from (values
      ('cron-history-purge',   '41 3 * * *', 'select public.run_housekeeping_job(''cron-history-purge'');'),
      ('job-runs-purge',       '46 * * * *', 'select public.run_housekeeping_job(''job-runs-purge'');'),
      ('location-pings-purge', '51 3 * * *', 'select public.run_housekeeping_job(''location-pings-purge'');'),
      ('outbox-purge',         '56 3 * * *', 'select public.run_housekeeping_job(''outbox-purge'');')
    ) as v(job, schedule, command)
  loop
    if exists (select 1 from cron.job j where j.jobname = r.job) then
      perform cron.unschedule(r.job);
    end if;
    perform cron.schedule(r.job, r.schedule, r.command);
    n := n + 1;
  end loop;
  return n;
end $$;

comment on function public.install_housekeeping_schedules() is
  'Schedules the SQL-only housekeeping jobs in pg_cron: cron-history-purge daily at 03:41 UTC, job-runs-purge hourly at :46 (ADR-0154), location-pings-purge daily at 03:51 UTC and outbox-purge daily at 03:56 UTC (ADR-0164). Idempotent. Called by its migrations and by install_job_schedules(), so a pg_cron reinstall keeps them. Returns the number scheduled (0 without pg_cron).';

revoke execute on function public.install_housekeeping_schedules() from public, anon, authenticated;
grant  execute on function public.install_housekeeping_schedules() to service_role;

-- No secrets, no HTTP: start them with the deploy.
select public.install_housekeeping_schedules();
