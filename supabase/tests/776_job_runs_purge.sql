-- =====================================================================
-- 776 · job_runs_purge() (20261007100000, ADR-0025)
--
-- The minute-by-minute rtw-check runner writes a job_runs row per pass.
-- The purge drops its idle passes after two days (keeping the newest as the
-- heartbeat) and anything older than 90 days; passes that worked and
-- failures stay.
-- =====================================================================
begin;
select plan(7);

delete from job_runs where job in ('rtw-check', 'purge-776');

insert into job_runs (job, started_at, finished_at, ok, counts) values
  ('rtw-check', now() - interval '3 days',  now() - interval '3 days',  true,  '{"claimed":0}'),                -- idle, old    → purged
  ('rtw-check', now() - interval '3 days',  now() - interval '3 days',  true,  '{"claimed":1,"passed":1}'),     -- did work     → kept
  ('rtw-check', now() - interval '3 days',  now() - interval '3 days',  false, '{}'),                           -- failed       → kept
  ('rtw-check', now() - interval '1 hour',  now() - interval '1 hour',  true,  '{"claimed":0}'),                -- idle, recent → kept (and the newest)
  ('purge-776', now() - interval '100 days', now() - interval '100 days', true, '{}'),                           -- over 90 days → purged
  ('purge-776', now() - interval '10 days',  now() - interval '10 days',  true, '{}');                           -- recent       → kept

select is(public.job_runs_purge(), 2, 'one idle old pass and one 100-day-old run are removed');
select is((select count(*)::int from job_runs where job = 'rtw-check'), 3,
  'the pass that worked, the failure and the recent idle pass stay');
select is((select count(*)::int from job_runs where job = 'purge-776'), 1, 'a recent run of another job stays');

-- The heartbeat is never purged, even when it is the only idle pass left and old.
update job_runs set started_at = now() - interval '5 days', finished_at = now() - interval '5 days'
 where job = 'rtw-check' and counts ->> 'claimed' = '0';
select is(public.job_runs_purge(), 0, 'the newest rtw-check row is the heartbeat and is kept however old');
select is((select count(*)::int from job_runs where job = 'rtw-check' and counts ->> 'claimed' = '0'), 1,
  'the heartbeat row is still there');

select ok(not has_function_privilege('anon', 'public.job_runs_purge(int, int)', 'execute')
      and not has_function_privilege('authenticated', 'public.job_runs_purge(int, int)', 'execute'),
  'neither anon nor a signed-in user can purge job runs');
select ok(has_function_privilege('service_role', 'public.job_runs_purge(int, int)', 'execute'),
  'the runner, on the service key, can');

select * from finish();
rollback;
