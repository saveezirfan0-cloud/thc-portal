-- =====================================================================
-- 601 · The rtw-check schedule posts to the Back Office, with its own secret
--   20260928100100_rtw_check_schedule.sql · ADR-0025
--
-- The automated right-to-work check is a Node route on Vercel, not an Edge
-- Function, so its registry row names its own base (office_base_url) and
-- bearer secret (rtw_job_secret). The base is a VAULT secret, not a
-- settings row: an admin session writes settings, and must not be able to
-- redirect the bearer (security review, 26.09). Registered DISABLED until
-- THC's keys exist, like willo-invite (190's enabled list is unchanged).
-- Every other row still posts through edge_base_url() with
-- service_role_key (20260927160300).
-- =====================================================================
begin;
select plan(17);
\ir _shared/fixtures.psql

select results_eq(
  $$ select enabled, cron_expression, edge_path, base_url_source, secret_name
       from job_schedules where job = 'rtw-check' $$,
  $$ values (false, '*/10 * * * *'::text, 'api/jobs/rtw-check'::text, 'office_base_url'::text, 'rtw_job_secret'::text) $$,
  'the rtw-check row: every 10 minutes, the office route, its own secret — and disabled until the keys exist');

select is_empty(
  $$ select job from job_schedules
      where job <> 'rtw-check'
        and (base_url_source <> 'edge_base_url' or secret_name <> 'service_role_key') $$,
  'every other job still posts to an Edge Function with the service key');

select throws_ok(
  $$ update job_schedules set secret_name = 'service_role_key' where job = 'rtw-check' $$,
  '23514', null, 'the service key can never be sent to the office base (only to an Edge Function)');
select throws_ok(
  $$ update job_schedules set base_url_source = 'somewhere_url' where job = 'rtw-check' $$,
  '23514', null, 'nor to a base with no guarded reader');
select throws_ok(
  $$ update job_schedules set secret_name = 'some_other_secret' where job = 'notify-drain' $$,
  '23514', null, 'and a row may only name one of the two bearers there are');

insert into settings (key, value) values ('edge_base_url', '"https://abcdefghij.supabase.co/functions/v1"')
on conflict (key) do update set value = excluded.value;
delete from vault.secrets where name in ('office_base_url', 'rtw_job_secret');

-- ---------------------------------------------------------------------
-- An admin cannot redirect the bearer through settings.
-- ---------------------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select lives_ok($$ insert into settings (key, value) values ('office_base_url', '"https://attacker.example"') $$,
  'an admin may write a settings row called office_base_url…');
select throws_ok($$ select office_base_url() $$, '42501', null,
  'the reader is not an RPC for a signed-in caller');
reset role;
select is(office_base_url(), null::text, '…and the reader ignores that row: the base lives in the vault, which has none yet');
select lives_ok($$ select rtw_check_nudge() $$, 'the nudge skips cleanly with no vault base');

select lives_ok($$ select install_job_schedules() $$,
  'disabled, the row needs no vault secrets to install the rest');
select is((select count(*)::int from cron.job where jobname = 'rtw-check'), 0, 'and nothing is scheduled for it');

update job_schedules set enabled = true where job = 'rtw-check';
select lives_ok($$ select install_job_schedules() $$,
  'enabled without the vault secrets, the installer skips that row and installs the rest');
select is((select count(*)::int from cron.job where jobname = 'rtw-check'), 0, 'still not scheduled');

-- Through vault.create_secret, not an insert: on Supabase the table's encrypt
-- trigger is not callable by the test role, the SECURITY DEFINER API is.
select vault.create_secret('https://office.rtw601.test/', 'office_base_url');
select vault.create_secret('synthetic-601-secret-0123456789abcdef', 'rtw_job_secret');
select is(office_base_url(), 'https://office.rtw601.test', 'the base comes from the vault, without its trailing slash');
select install_job_schedules();
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

select vault.update_secret((select id from vault.secrets where name = 'office_base_url'), 'http://attacker.example/steal');
select throws_like($$ select office_base_url() $$, '%office_base_url_invalid%',
  'a vault value that is not an https origin is refused at run time');

select * from finish();
rollback;
