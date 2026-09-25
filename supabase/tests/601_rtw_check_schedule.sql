-- =====================================================================
-- 601 · The rtw-check schedule posts to the Back Office, with its own secret
--   20260928100100_rtw_check_schedule.sql · ADR-0025
--
-- The automated right-to-work check is a Node route on Vercel, not an Edge
-- Function, so its registry row names its own base URL setting
-- (office_base_url) and bearer secret (rtw_job_secret). Registered
-- DISABLED until THC's keys exist, like willo-invite (190's list of
-- enabled schedules is unchanged). Every other row still posts to
-- edge_base_url() with service_role_key (20260927160300), and the office
-- base is guarded the same way: a write-time rule and a run-time reader.
-- =====================================================================
begin;
select plan(15);

select results_eq(
  $$ select enabled, cron_expression, edge_path, base_url_setting, secret_name
       from job_schedules where job = 'rtw-check' $$,
  $$ values (false, '*/10 * * * *'::text, 'api/jobs/rtw-check'::text, 'office_base_url'::text, 'rtw_job_secret'::text) $$,
  'the rtw-check row: every 10 minutes, the office route, its own secret — and disabled until the keys exist');

select is_empty(
  $$ select job from job_schedules
      where job <> 'rtw-check'
        and (base_url_setting <> 'edge_base_url' or secret_name <> 'service_role_key') $$,
  'every other job still posts to an Edge Function with the service key');

select throws_ok(
  $$ update job_schedules set secret_name = 'service_role_key' where job = 'rtw-check' $$,
  '23514', null, 'the service key can never be sent to the office base (only to an Edge Function)');
select throws_ok(
  $$ update job_schedules set base_url_setting = 'somewhere_url' where job = 'rtw-check' $$,
  '23514', null, 'nor to a base with no guarded reader');

-- office_base_url: an origin, https (or local development).
select throws_like($$ insert into settings (key, value) values ('office_base_url', '"http://office.example.com"') $$,
  '%office_base_url_invalid%', 'plain http to a real host is refused');
select throws_like($$ insert into settings (key, value) values ('office_base_url', '"https://evil.example/collect?x="') $$,
  '%office_base_url_invalid%', 'a path or query is refused: an origin only');

insert into settings (key, value) values ('edge_base_url', '"https://abcdefghij.supabase.co/functions/v1"')
on conflict (key) do update set value = excluded.value;
delete from settings where key = 'office_base_url';

select lives_ok($$ select install_job_schedules() $$,
  'disabled, the row needs no office_base_url to install the rest');
select is((select count(*)::int from cron.job where jobname = 'rtw-check'), 0,
  'and nothing is scheduled for it');

update job_schedules set enabled = true where job = 'rtw-check';
select throws_like($$ select install_job_schedules() $$,
  '%settings.office_base_url is not set; rtw-check cannot be scheduled%',
  'enabled without office_base_url, the installer refuses by name rather than posting to null');

insert into settings (key, value) values ('office_base_url', '"https://office.rtw601.test/"');
select is(office_base_url(), 'https://office.rtw601.test', 'the reader hands back the origin without its trailing slash');
select lives_ok($$ select install_job_schedules() $$, 'with office_base_url set it installs');
select ok(
  (select command like '%public.office_base_url() || ''/api/jobs/rtw-check''%'
      and command like '%name = ''rtw_job_secret''%'
      and command not like '%service_role_key%'
      and command not like '%https://%'
     from cron.job where jobname = 'rtw-check'),
  'rtw-check posts to office_base_url() + /api/jobs/rtw-check with rtw_job_secret, both read at run time');
select ok(
  (select command like '%public.edge_base_url() || ''/notify-drain''%'
      and command like '%name = ''service_role_key''%'
     from cron.job where jobname = 'notify-drain'),
  'notify-drain still posts through edge_base_url() with service_role_key, as 20260927160300 left it');

select lives_ok($$ select rtw_check_nudge() $$,
  'the nudge never fails its caller, configured or not');

-- A value that reached the row around the guard posts nothing.
alter table settings disable trigger settings_office_base_url_guard;
update settings set value = '"http://attacker.example"' where key = 'office_base_url';
alter table settings enable trigger settings_office_base_url_guard;
select throws_like($$ select office_base_url() $$, '%office_base_url_invalid%',
  'the run-time reader refuses a bad value that bypassed the write-time guard');

select * from finish();
rollback;
