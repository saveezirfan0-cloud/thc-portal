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
select plan(10);

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
          'is_uk_time', 'uk_local', 'install_job_schedules',
          -- the compliance sweep (20260921170411). block_worker is the
          -- one that matters most here: a revoke that takes the service
          -- role's grant with it means an expired document never blocks
          -- anybody, and the only symptom is a job 500ing at 05:00.
          'compliance_daily', 'block_worker', 'unblock_if_compliant',
          -- §10.6 / §10.7 (20260921180312). Both are worker-initiated and
          -- reach the database through a server action holding the service
          -- key, so a revoke that took this grant with it would make
          -- "Request my P45" fail silently for every leaver.
          'request_p45', 'declare_conviction', 'released_shift_lines',
          -- §9.6's three buttons (20260921183945). reset_to_candidate
          -- supersedes every piece of a worker's compliance evidence, so
          -- a grant that went missing here fails the office's only route
          -- back for a returning worker.
          'block_worker_manually', 'unblock_worker', 'reset_to_candidate',
          -- §1.7 (20260921190118, 20260922081512). Irreversible, so the
          -- grant matters in both directions: service_role must have it,
          -- and nobody else. The Storage pair is how the erasure is
          -- actually discharged — a missing grant there leaves a passport
          -- scan on disk after the row that named it is gone.
          'remove_worker', 'claim_storage_deletions', 'complete_storage_deletion',
          -- BG-08, the Monday finance send (20260923130000). A missing grant
          -- here is a Monday with no payroll email and a job 500ing every
          -- five minutes until someone notices.
          'finance_reports_due', 'prepare_finance_reports', 'payroll_export_rows',
          'new_starter_export_rows', 'queue_finance_report_email'
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
          'release_unready_bookings', 'invite_worker', 'install_job_schedules',
          -- The compliance, lifecycle and directory write paths. Every one
          -- of them is destructive: block_worker cancels every future
          -- booking a worker holds, reset_to_candidate supersedes their
          -- whole evidence set, and remove_worker is irreversible.
          'compliance_daily', 'block_worker', 'unblock_if_compliant',
          'request_p45', 'declare_conviction', 'released_shift_lines',
          'block_worker_manually', 'unblock_worker', 'reset_to_candidate',
          'remove_worker', 'claim_storage_deletions', 'complete_storage_deletion'
        )
        and has_function_privilege('anon', p.oid, 'execute') $$,
  'anon can execute none of the job, engine, compliance or lifecycle write paths'
);

-- ---------------------------------------------------------------------
-- 2c. And neither can a signed-in worker.
--
--     This is the half the grants' own comments promise and nothing was
--     holding. `invite_worker` and the three worker-facing RPCs ARE
--     granted to `authenticated` on purpose and each checks its caller;
--     everything below is a Back Office or job path with no self-check,
--     reached through a server action holding the service key. A grant
--     here would let any signed-in worker retire a colleague, suspend
--     them on a fabricated declaration, or wipe their evidence.
--
--     docs/14 O7 is the reason this is asserted rather than assumed: a
--     `revoke ... from public` does NOT take back Supabase's
--     default-privilege grants to `authenticated` by name.
-- ---------------------------------------------------------------------
select is_empty(
  $$ select p.proname::text
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname in (
          'compliance_daily', 'block_worker', 'unblock_if_compliant',
          'request_p45', 'declare_conviction', 'released_shift_lines',
          'block_worker_manually', 'unblock_worker', 'reset_to_candidate',
          'remove_worker', 'claim_storage_deletions', 'complete_storage_deletion'
        )
        and has_function_privilege('authenticated', p.oid, 'execute') $$,
  'nor can a signed-in worker block, retire, reset or remove anybody'
);

-- ---------------------------------------------------------------------
-- 2b. Nor the worker-facing RPCs. These are granted to `authenticated`
--     on purpose and each checks that the booking is the caller's own,
--     so anon would find nothing — but a signed-out caller has no
--     booking to accept, ready or cancel even in principle, and the
--     first run of this file proved that "revoked from PUBLIC" is not
--     the same claim as "revoked from anon".
-- ---------------------------------------------------------------------
select is_empty(
  $$ select p.proname::text
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname in ('accept_invite', 'mark_ready', 'self_cancel_booking',
                          'queue_booking_push')
        and has_function_privilege('anon', p.oid, 'execute') $$,
  'anon can execute none of the worker-facing booking RPCs either'
);

-- ---------------------------------------------------------------------
-- 2c. The three worker-facing ones stay reachable by a signed-in worker,
--     which is what they are for. Asserted so a future revoke does not
--     quietly take the Staff App's own actions away.
-- ---------------------------------------------------------------------
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('accept_invite', 'mark_ready', 'self_cancel_booking')
      and has_function_privilege('authenticated', p.oid, 'execute')),
  3, 'a signed-in worker can still accept, press I am ready, and self-cancel');

-- ---------------------------------------------------------------------
-- 2d. The on-shift RPCs, closed to anon by 20260922183013.
--
--     attempt_check_in / check_out (0006), start_break / finish_break
--     (20260921153000), record_ping (20260922090000) and
--     booking_venue_point (20260922110000) were granted to
--     `authenticated` and never revoked from anything, so Supabase's
--     default privileges left all six reachable by anon.
--
--     None was exploitable: each raises not_your_booking for a caller
--     who does not own the booking. What each one DID give a logged-out
--     caller is a booking-id oracle — 'booking_not_found' (P0002) for an
--     id that does not exist, 'not_your_booking' (42501) for one that
--     does, decided before authorisation is considered — and a standing
--     dependency on six hand-copied guards never being edited wrong.
-- ---------------------------------------------------------------------
select is_empty(
  $$ select p.proname::text
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname in ('attempt_check_in', 'check_out', 'start_break', 'finish_break',
                          'record_ping', 'booking_venue_point',
                          'bookings_grant_qualification', 'violations_grant_qualification')
        and has_function_privilege('anon', p.oid, 'execute') $$,
  'anon can execute none of the on-shift RPCs, and neither trigger function'
);

select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('attempt_check_in', 'check_out', 'start_break', 'finish_break',
                        'record_ping', 'booking_venue_point')
      and has_function_privilege('authenticated', p.oid, 'execute')),
  6, 'and a signed-in worker can still check in, check out, take a break, ping and read their venue');

-- ---------------------------------------------------------------------
-- 2e. The invariant behind 2, 2b and 2d: no `security definer` function
--     in public is reachable by anon unless it is on this list.
--
--     Every assertion above names functions, and a name list is a
--     snapshot — six definer RPCs reached anon for a day because nobody
--     added them to one. A definer function runs with the owner's
--     rights, which on this schema means past every RLS policy in it, so
--     "which of these is anon allowed to call" is the one question worth
--     asking structurally rather than per feature.
--
--     The three exceptions, and why each is not a hole:
--
--     · current_app_role() / current_client_id() — called inside the
--       predicate of essentially every policy in the schema, which is
--       evaluated as the caller. Revoking from anon does not close
--       anything; it breaks every policy for logged-out requests and
--       with it the anon path /apply needs. Each returns only the
--       caller's own role or client id, and returns NULL when there is
--       no profile, which is exactly how anon is kept out of
--       venue_types and staff_transitions. 20260921123503's triage
--       reached the same conclusion.
--     · submit_application() — the public form (§2.1) is anonymous by
--       definition. It is bounded instead: validation, two advisory
--       locks, a per-email and per-mobile throttle
--       (20260922183012), and a void return so it cannot be used as an
--       account-existence oracle. 120_apply holds that.
--
--     Extension-owned functions are excluded: PostGIS's
--     st_estimatedextent overloads are definer and are not ours.
--
--     If this fails, the answer is a revoke in a new migration. Adding a
--     name here is a decision to publish a function that runs past RLS
--     to the whole internet, and wants to be argued for in the PR.
-- ---------------------------------------------------------------------
select bag_eq(
  $$ select p.proname::text
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prosecdef
        and not exists (select 1 from pg_depend d
                         where d.classid = 'pg_proc'::regclass
                           and d.objid = p.oid and d.deptype = 'e')
        and has_function_privilege('anon', p.oid, 'execute') $$,
  $$ values ('current_app_role'::text), ('current_client_id'), ('submit_application') $$,
  'exactly three security definer functions in public are reachable by anon, and each is there on purpose'
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
          'release_unready_bookings', 'queue_booking_push', 'install_job_schedules'
        )
        and has_function_privilege('authenticated', p.oid, 'execute') $$,
  'a signed-in worker cannot run a job, drain the outbox, release a booking or send a push'
);

-- ---------------------------------------------------------------------
-- 4. Every registry entry names a job, and an enabled one should have a
--    function in the repo. The three auto-staffing modes share one.
--
--    This list is the reason the assertion exists: enabling a schedule is
--    one line in a migration, and a schedule enabled before its function
--    is deployed spends the gap posting at a 404. So the list is edited
--    in the same commit that adds the function, or not at all.
-- ---------------------------------------------------------------------
select bag_eq(
  $$ select job::text from job_schedules where enabled $$,
  $$ values ('booking-tick'::text), ('auto-staffing-hourly'),
            ('auto-staffing-cutoff'), ('auto-staffing-escalation'),
            ('compliance-daily') $$,
  'exactly the five schedules whose Edge Function exists AND whose sends can go out are enabled; finance-reports waits for the outbox drain (P2, 20260923193100)'
);

select * from finish();
rollback;
