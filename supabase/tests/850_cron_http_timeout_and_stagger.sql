-- =====================================================================
-- 850 · pg_cron's HTTP calls: 30 s timeout, staggered minutes
--   20261018120100_cron_http_timeout_and_stagger.sql · ADR-0152
--
-- Pins the registry's minutes — the three the scope fixes (§3.5 12:05
-- cutoff, §7 05:00 compliance, §9.9 Monday 09:00 finance) are still on
-- the */5 grid, and only gdpr-purge and escalation moved — and that every
-- command install_job_schedules() writes passes timeout_milliseconds and
-- still reads its base and bearer at run time. The reinstall also brings
-- back the SQL housekeeping jobs (849).
-- =====================================================================
begin;
select plan(9);

select results_eq(
  $$ select job, cron_expression from job_schedules order by job $$,
  $$ values
       ('auto-staffing-cutoff'::text,     '*/5 * * * *'::text),
       ('auto-staffing-escalation',       '4-59/10 * * * *'),
       ('auto-staffing-hourly',           '17 * * * *'),
       ('booking-tick',                   '* * * * *'),
       ('compliance-daily',               '*/5 * * * *'),
       ('event-documents',                '*/15 * * * *'),
       ('finance-reports',                '*/5 * * * *'),
       ('gdpr-purge',                     '3-59/5 * * * *'),
       ('new-starter-report',             '*/15 * * * *'),
       ('notify-drain',                   '* * * * *'),
       ('onboarding-chasers',             '7 * * * *'),
       ('rtw-check',                      '* * * * *'),
       ('willo-invite',                   '* * * * *') $$,
  'the 12:05 cutoff, the 05:00 sweep and the Monday 09:00 send stay on the five-minute grid; gdpr-purge and escalation are off it, escalation still every 10 minutes');

select is_empty(
  $$ select job from job_schedules where job in ('cron-history-purge', 'job-runs-purge') $$,
  'the SQL housekeeping jobs are not registry rows (the registry is HTTP jobs only)');

insert into settings (key, value) values ('edge_base_url', '"https://abcdefghij.supabase.co/functions/v1"')
on conflict (key) do update set value = excluded.value;
delete from vault.secrets where name in ('office_base_url', 'rtw_job_secret');
select vault.create_secret('https://office.cron850.test', 'office_base_url');
select vault.create_secret('synthetic-850-secret-0123456789abcdef', 'rtw_job_secret');
update job_schedules set enabled = true where job = 'rtw-check';

-- Take the housekeeping jobs away, as an in-place upgrade's pg_cron
-- recreation would.
select cron.unschedule(jobname) from cron.job where jobname in ('cron-history-purge', 'job-runs-purge');

select is(install_job_schedules(), (select count(*)::int from job_schedules where enabled),
  'every enabled registry row is scheduled, and the count is the registry''s alone');

select is_empty(
  $$ select s.job from job_schedules s
      where s.enabled
        and not exists (select 1 from cron.job j
                         where j.jobname = s.job
                           and j.schedule = s.cron_expression
                           and j.command like '%timeout_milliseconds := 30000%') $$,
  'each one posts with a 30 s pg_net timeout, on its registry minute');

select is_empty(
  $$ select j.jobname from cron.job j join job_schedules s on s.job = j.jobname
      where j.command like '%https://%' or j.command like '%synthetic-850%' $$,
  'no URL and no secret is baked into a command: both are still read when it runs');

select ok(
  (select command like '%public.edge_base_url() || ''/gdpr-purge''%'
      and command like '%name = ''service_role_key''%'
      and schedule = '3-59/5 * * * *'
     from cron.job where jobname = 'gdpr-purge'),
  'gdpr-purge still posts through edge_base_url() with the service key, at :03, :08, …');

select ok(
  (select command like '%public.office_base_url() || ''/api/jobs/event-documents''%'
      and command like '%name = ''rtw_job_secret''%'
      and command like '%timeout_milliseconds := 30000%'
     from cron.job where jobname = 'event-documents'),
  'a Back Office job gets the timeout too, with its own bearer');

select is((select count(*)::int from cron.job where jobname in ('cron-history-purge', 'job-runs-purge')), 2,
  'the reinstall brought the housekeeping jobs back');

select is_empty(
  $$ select jobname from cron.job
      where jobname in ('cron-history-purge', 'job-runs-purge')
        and (command like '%http%' or command like '%vault%') $$,
  'and they call SQL only — no HTTP, no secret');

select * from finish();
rollback;
