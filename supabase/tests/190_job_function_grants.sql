-- =====================================================================
-- 190 · The jobs layer can call what it calls, and nobody else can
--
-- Every §7 job is an Edge Function holding the service key, calling SQL.
-- Two ways that breaks, both silent until a job runs in production:
--
--   1. A function the job calls is revoked from the service role, so the
--      job 500s every minute. 20260921141500 revoked several from PUBLIC
--      without re-granting, relying on Supabase's bootstrap default
--      privileges to have granted service_role separately. That is very
--      probably true and it is still an assumption, so it is asserted.
--   2. A function the job calls is left open to anon. These raise
--      violations, write invitations and release confirmed bookings —
--      `invite_worker` alone can book a worker onto a shift. An open one
--      is not a bug in a job, it is a way for anyone holding the anon key
--      to staff an event.
--
-- Nothing here type-checks the Edge Functions; docs/14 O5 covers that
-- gap. This is the half of the contract that SQL can hold.
-- =====================================================================
begin;
select plan(4);

-- ---------------------------------------------------------------------
-- 1. Everything the jobs call is callable by the service role.
-- ---------------------------------------------------------------------
select is_empty(
  $$ select p.proname::text
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname in (
          'booking_tick', 'job_run_start', 'job_run_finish',
          'claim_outbox_batch', 'complete_outbox_send',
          'release_unready_bookings', 'invite_worker',
          'auto_assign_due_shifts', 'auto_assign_candidates',
          'is_uk_time', 'uk_local', 'install_job_schedules'
        )
        and not has_function_privilege('service_role', p.oid, 'execute') $$,
  'the service role can execute every function the §7 jobs call'
);

-- ---------------------------------------------------------------------
-- 2. The engine's write paths are closed to anon.
--
--    invite_worker is granted to `authenticated` on purpose — a manager
--    invites from the event board — and guards itself by raising
--    not_authorised for a signed-in non-admin. anon is a different
--    matter: there is no caller to check.
-- ---------------------------------------------------------------------
select is_empty(
  $$ select p.proname::text
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname in (
          'booking_tick', 'job_run_start', 'job_run_finish',
          'claim_outbox_batch', 'complete_outbox_send',
          'release_unready_bookings', 'invite_worker', 'install_job_schedules'
        )
        and has_function_privilege('anon', p.oid, 'execute') $$,
  'anon can execute none of the job or engine write paths'
);

-- ---------------------------------------------------------------------
-- 3. Nor can a signed-in worker drive the jobs directly.
--    invite_worker is excluded: it is deliberately granted to
--    authenticated and does its own authorisation.
-- ---------------------------------------------------------------------
select is_empty(
  $$ select p.proname::text
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname in (
          'booking_tick', 'job_run_start', 'job_run_finish',
          'claim_outbox_batch', 'complete_outbox_send',
          'release_unready_bookings', 'install_job_schedules'
        )
        and has_function_privilege('authenticated', p.oid, 'execute') $$,
  'a signed-in worker cannot run a job, drain the outbox or release a booking'
);

-- ---------------------------------------------------------------------
-- 4. Every registry entry names a job, and an enabled one should have a
--    function in the repo. The three auto-staffing modes share one.
-- ---------------------------------------------------------------------
select bag_eq(
  $$ select job::text from job_schedules where enabled $$,
  $$ values ('booking-tick'::text), ('auto-staffing-hourly'),
            ('auto-staffing-cutoff'), ('auto-staffing-escalation') $$,
  'exactly the four schedules whose Edge Function exists are enabled; the rest wait for theirs'
);

select * from finish();
rollback;
