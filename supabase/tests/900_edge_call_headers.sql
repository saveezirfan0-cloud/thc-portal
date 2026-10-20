-- =====================================================================
-- 900 · Database → Edge Function calls carry the key on apikey, and as a
--       bearer only while it is a JWT
--   20261020140000_edge_calls_send_apikey.sql · ADR-0165
--
-- Supabase disables the legacy service_role JWT at the end of 2026; its
-- replacement, sb_secret_…, is not a JWT. The Vault secret
-- service_role_key may hold either, and the three callers that post to an
-- Edge Function with it — the pg_cron commands, willo_invite_nudge() and
-- auto_assign_first_round() — must work with both. A Back Office job's
-- own bearer (rtw_job_secret) is not a Supabase key and is unchanged.
-- Admin, staff, client and anon may not call the header builder.
-- =====================================================================
begin;
select plan(16);

-- ---------------------------------------------------------------------
-- The header builder
-- ---------------------------------------------------------------------
select has_function('public', 'edge_call_headers', array['text'], 'edge_call_headers(text) exists');

select is(
  edge_call_headers('eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.c2ln'),
  jsonb_build_object(
    'Content-Type', 'application/json',
    'apikey', 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.c2ln',
    'Authorization', 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.c2ln'),
  'a legacy JWT key goes on apikey AND as the bearer, as supabase-js has always sent it');

select is(
  edge_call_headers('sb_secret_0123456789abcdefABCDEF_xyz'),
  jsonb_build_object('Content-Type', 'application/json', 'apikey', 'sb_secret_0123456789abcdefABCDEF_xyz'),
  'a new sb_secret_ key goes on apikey alone: it is not a JWT, so never a bearer');

select ok(
  not (edge_call_headers('sb_publishable_abc') ? 'Authorization')
  and not (edge_call_headers('a.b') ? 'Authorization')
  and not (edge_call_headers('a.b.c.d') ? 'Authorization')
  and not (edge_call_headers('a b.c.d') ? 'Authorization'),
  'only a three-part token is treated as a JWT');

select is(edge_call_headers(null), '{"Content-Type": "application/json"}'::jsonb,
  'no key, no credential headers (the callers skip the post before this)');

-- ---------------------------------------------------------------------
-- Who may call it
-- ---------------------------------------------------------------------
select ok(not has_function_privilege('anon', 'public.edge_call_headers(text)', 'execute'),
  'anon (and so the client portal''s logged-out pages) cannot call it');
select ok(not has_function_privilege('authenticated', 'public.edge_call_headers(text)', 'execute'),
  'authenticated — admin, staff and client sessions alike — cannot call it');
select ok(has_function_privilege('service_role', 'public.edge_call_headers(text)', 'execute'),
  'service_role can');

-- ---------------------------------------------------------------------
-- The cron commands
-- ---------------------------------------------------------------------
insert into settings (key, value) values ('edge_base_url', '"https://abcdefghij.supabase.co/functions/v1"')
on conflict (key) do update set value = excluded.value;
delete from vault.secrets where name in ('office_base_url', 'rtw_job_secret', 'service_role_key');
select vault.create_secret('https://office.cron900.test', 'office_base_url');
select vault.create_secret('synthetic-900-office-secret-0123456789', 'rtw_job_secret');
select vault.create_secret('sb_secret_synthetic900_0123456789abcdef', 'service_role_key');
update job_schedules set enabled = true where job = 'rtw-check';

select is(install_job_schedules(), (select count(*)::int from job_schedules where enabled),
  'install_job_schedules() still schedules every enabled row');

select is_empty(
  $$ select s.job from job_schedules s join cron.job j on j.jobname = s.job
      where s.enabled and s.base_url_source = 'edge_base_url'
        and j.command not like '%headers := public.edge_call_headers((select decrypted_secret from vault.decrypted_secrets where name = ''service_role_key'')),%' $$,
  'every Edge Function job builds its headers with edge_call_headers() from the Vault key, read when it runs');

select is_empty(
  $$ select s.job from job_schedules s join cron.job j on j.jobname = s.job
      where s.enabled and s.base_url_source = 'edge_base_url'
        and (j.command like '%''Authorization''%' or j.command like '%sb_secret_synthetic900%') $$,
  'no Edge Function job writes a bearer of its own, and no key is baked into a command');

select ok(
  (select command like '%public.office_base_url() || ''/api/jobs/rtw-check''%'
      and command like '%''Authorization'', ''Bearer '' || (select decrypted_secret from vault.decrypted_secrets where name = ''rtw_job_secret'')%'
      and command not like '%edge_call_headers%'
      and command like '%timeout_milliseconds := 30000%'
     from cron.job where jobname = 'rtw-check'),
  'a Back Office job keeps its own rtw_job_secret bearer, unchanged');

select is(
  (select public.edge_call_headers((select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'))),
  jsonb_build_object('Content-Type', 'application/json', 'apikey', 'sb_secret_synthetic900_0123456789abcdef'),
  'with the new key in the Vault, the header expression a job runs sends it on apikey only');

-- ---------------------------------------------------------------------
-- The two direct callers
-- ---------------------------------------------------------------------
select ok(
  (select prosrc like '%headers := public.edge_call_headers(v_key)%'
      and prosrc not like '%''Bearer '' || v_key%'
     from pg_proc where oid = 'public.willo_invite_nudge()'::regprocedure),
  'willo_invite_nudge() posts to willo-webhook/invite through edge_call_headers()');

select ok(
  (select prosrc like '%headers := public.edge_call_headers(v_key)%'
      and prosrc not like '%''Bearer '' || v_key%'
     from pg_proc where oid = 'public.auto_assign_first_round(uuid)'::regprocedure),
  'auto_assign_first_round() posts to auto-staffing through edge_call_headers()');

select ok(
  (select prosrc like '%''Authorization'', ''Bearer '' || v_secret%'
     from pg_proc where oid = 'public.rtw_check_nudge()'::regprocedure),
  'rtw_check_nudge() still posts to the Back Office with its own bearer');

select * from finish();
rollback;
