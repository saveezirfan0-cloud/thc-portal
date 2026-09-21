-- =====================================================================
-- Take the engine's write paths away from anon (§1.7)
--
-- What 190_job_function_grants.sql found on its first CI run:
--
--   anon can execute release_unready_bookings
--   anon can execute invite_worker
--   authenticated can execute release_unready_bookings
--
-- 20260921141500 did revoke all six of its functions, but from PUBLIC
-- only. Supabase's bootstrap sets default privileges that grant EXECUTE
-- on new functions in `public` to anon, authenticated and service_role
-- individually, and `revoke ... from public` does not touch a grant held
-- by a named role. So the revoke looked right and changed nothing for
-- the two roles that matter.
--
-- Why invite_worker's own guard does not save it. The check is:
--
--   if current_app_role() is distinct from 'admin'
--      and auth.uid() is not null then raise not_authorised
--
-- It exists so the service role passes, because a job has no auth.uid().
-- anon has no auth.uid() either. For anon the first half is true and the
-- second is false, so the guard does not fire and the call proceeds:
-- anyone holding the anon key could book a worker onto a shift. The
-- guard cannot tell the two apart, which is exactly why the grant layer
-- has to.
--
-- release_unready_bookings is the 12:05 cutoff (§3.5): it cancels
-- confirmed bookings and queues N6b. Reachable by anon, it is a way to
-- empty tomorrow's events and tell every worker they have been dropped.
--
-- queue_booking_push writes notification_outbox, so anon reaching it is
-- a way to send arbitrary pushes to workers. It was never granted to
-- anybody and was revoked from PUBLIC, so it has the same hole.
--
-- The three worker-facing ones keep `authenticated`, which is the point
-- of them, and lose anon: a signed-out caller has no booking to accept,
-- ready or cancel, so there is nothing there for them even in principle.
-- =====================================================================

revoke execute on function public.invite_worker(uuid, uuid, booking_source, boolean) from anon;
revoke execute on function public.accept_invite(uuid)                                from anon;
revoke execute on function public.mark_ready(uuid)                                   from anon;
revoke execute on function public.self_cancel_booking(uuid)                          from anon;
revoke execute on function public.release_unready_bookings(timestamptz)              from anon, authenticated;
revoke execute on function public.queue_booking_push(text, uuid)                     from anon, authenticated;

-- The jobs still need these; 190 asserts it in both directions.
grant execute on function public.release_unready_bookings(timestamptz) to service_role;
grant execute on function public.queue_booking_push(text, uuid)        to service_role;
grant execute on function public.invite_worker(uuid, uuid, booking_source, boolean) to service_role;
