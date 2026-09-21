-- =====================================================================
-- Enable the three auto-staffing schedules (§3.4, §3.5, §7)
--
-- supabase/functions/auto-staffing exists as of this commit, which is
-- what 20260921130927 registered these three entries waiting for.
--
-- Same ordering as booking-tick, and it still matters: `supabase
-- functions deploy` first, `select install_job_schedules()` second.
-- Enabled here means "install this schedule when you install schedules",
-- not "a function is already listening".
--
-- The cutoff and the escalation keep their every-5-minute and
-- every-10-minute registrations. The cutoff is not a 12:05 cron entry
-- because pg_cron is UTC and the deadline is UK wall-clock; the function
-- asks is_uk_time() instead (20260921160624), and pgTAP holds that to
-- both DST boundaries. A cron entry could not.
-- =====================================================================

update job_schedules
   set enabled = true,
       note = 'Additive hourly round (§3.4): invites the next `allocation` highest scores for every unfilled section whose shift has not started. Ranking is packages/domain/selectInvitees, shared with the event board.'
 where job = 'auto-staffing-hourly';

update job_schedules
   set enabled = true,
       note = 'The 12:05 UK cutoff (§3.5). Every 5 minutes; the function gates on is_uk_time(now(),''12:05''), releases the unready and re-fills on the hourly rules.'
 where job = 'auto-staffing-cutoff';

update job_schedules
   set enabled = true,
       note = 'Escalation (§3.4): sections already under way and still short, inviting with p_ignore_target so the headcount + buffer cap does not apply once the shift has started.'
 where job = 'auto-staffing-escalation';

-- ---------------------------------------------------------------------
-- The jobs layer calls these as the service role. Supabase's bootstrap
-- default privileges grant EXECUTE on new functions in `public` to
-- service_role, so a `revoke ... from public` elsewhere does not take it
-- away — but that is an assumption every job now depends on, and
-- 20260921141500 revoked without re-granting. Stated explicitly here so
-- it is a fact rather than an inherited default, and asserted in
-- 190_job_function_grants.sql so it cannot quietly change.
-- ---------------------------------------------------------------------
grant execute on function public.release_unready_bookings(timestamptz)                to service_role;
grant execute on function public.invite_worker(uuid, uuid, booking_source, boolean)   to service_role;
grant execute on function public.auto_assign_due_shifts(text, timestamptz)            to service_role;
grant execute on function public.auto_assign_candidates(uuid)                         to service_role;
grant execute on function public.is_uk_time(timestamptz, text, interval)              to service_role;
