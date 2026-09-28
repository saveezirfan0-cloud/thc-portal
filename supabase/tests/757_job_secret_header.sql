-- =====================================================================
-- 757 · pg_cron proves itself to the Edge Functions with the job secret
--   20261001205000_job_secret_header.sql
--
-- Every Edge Function row's cron command sends x-job-secret, read from
-- the vault secret job_secret when the command runs (never stored in the
-- command string). The rtw-check row posts to the Back Office and must
-- never receive it. The two nudges send the same header.
-- =====================================================================
begin;
select plan(7);
\ir _shared/fixtures.psql

insert into settings (key, value) values ('edge_base_url', '"https://abcdefghij.supabase.co/functions/v1"')
on conflict (key) do update set value = excluded.value;
delete from vault.secrets where name in ('job_secret', 'office_base_url', 'rtw_job_secret');
select vault.create_secret('synthetic-757-job-secret-0123456789abcdef', 'job_secret');
select vault.create_secret('https://office.jobsecret757.test', 'office_base_url');
select vault.create_secret('synthetic-757-rtw-secret-0123456789abcdef', 'rtw_job_secret');
update job_schedules set enabled = true where job = 'rtw-check';

select lives_ok($$ select install_job_schedules() $$, 'the schedules install');

select is_empty(
  $$ select j.jobname
       from cron.job j join job_schedules s on s.job = j.jobname
      where s.base_url_source = 'edge_base_url'
        and j.command not like '%''x-job-secret'', coalesce((select decrypted_secret from vault.decrypted_secrets where name = ''job_secret''), '''')%' $$,
  'every Edge Function command sends x-job-secret from the vault''s job_secret');

select is_empty(
  $$ select jobname from cron.job where command like '%synthetic-757-job-secret%' $$,
  'the secret itself is read at run time, never written into a command');

select ok(
  (select command not like '%x-job-secret%' and command not like '%name = ''job_secret''%'
      and command like '%name = ''rtw_job_secret''%'
     from cron.job where jobname = 'rtw-check'),
  'the rtw-check command (a Back Office route) never carries the job secret');

select ok(
  (select prosrc like '%''x-job-secret'', coalesce((select decrypted_secret from vault.decrypted_secrets where name = ''job_secret''), '''')%'
     from pg_proc where oid = 'public.willo_invite_nudge()'::regprocedure),
  'willo_invite_nudge sends the job secret');

select ok(
  (select prosrc like '%''x-job-secret'', coalesce((select decrypted_secret from vault.decrypted_secrets where name = ''job_secret''), '''')%'
     from pg_proc where oid = 'public.auto_assign_first_round(uuid)'::regprocedure),
  'auto_assign_first_round sends the job secret');

-- Without the vault secret the header is empty (job.ts then falls back to
-- the bearer), and nothing fails to install.
delete from vault.secrets where name = 'job_secret';
select lives_ok($$ select install_job_schedules() $$, 'without job_secret the schedules still install');

select * from finish();
rollback;
