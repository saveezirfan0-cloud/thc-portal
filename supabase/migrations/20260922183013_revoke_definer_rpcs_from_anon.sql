-- =====================================================================
-- Migration 20260922183013 · close the security definer RPCs to anon
--                            (§1.7, §5.1, §5.2b)
--
-- Supabase's bootstrap grants EXECUTE on everything created in `public`
-- to `anon`, `authenticated` and `service_role` by default privilege.
-- A function that never says otherwise is therefore published by
-- PostgREST to anyone holding the anon key. docs/14 O7 records the other
-- half of the same trap: `revoke ... from public` does NOT take back a
-- grant held by a named role, which is why every line below names anon
-- explicitly.
--
-- 20260921162758 and 20260922140000 did this for the engine and the
-- Staff App screens. These eight were missed.
--
-- The six worker RPCs
-- -------------------
-- attempt_check_in / check_out (0006), start_break / finish_break
-- (20260921153000), record_ping (20260922090000) and booking_venue_point
-- (20260922110000). All six are `security definer` over tables a worker
-- holds no policy on, and all six guard themselves with the same shape:
--
--     if current_app_role() is distinct from 'admin'
--        and b.staff_id is distinct from (select id from staff where user_id = auth.uid())
--     then raise exception 'not_your_booking'
--
-- For anon that guard always fires, so none of them is exploitable
-- today. Two reasons to revoke anyway:
--
--   1. It is an oracle. The guard raises P0002 'booking_not_found' for
--      an id that does not exist and 42501 'not_your_booking' for one
--      that does, BEFORE any authorisation is considered. A logged-out
--      caller can therefore confirm whether a booking id is real, and
--      booking_venue_point additionally sits one line away from handing
--      out a venue's coordinates.
--   2. The guard is the only thing holding. It is repeated by hand in
--      six bodies, and a future edit to any one of them — an early
--      return, a reordered branch, an `admin` shortcut — reopens the
--      function to the whole internet rather than to signed-in workers.
--      A grant is the layer that does not depend on remembering.
--
-- `authenticated` keeps all six: that is what they are for, and 140 /
-- 240 / 300 assert the Staff App can still call them.
--
-- The two trigger functions
-- -------------------------
-- bookings_grant_qualification and violations_grant_qualification
-- (20260922094500) return `trigger`. A trigger fires as part of the
-- statement regardless of who holds EXECUTE, so nothing needs this
-- grant; all it does is publish two definer functions on an RPC path.
-- Revoked from PUBLIC, anon AND authenticated.
--
-- Deliberately NOT revoked
-- ------------------------
--   · current_app_role() / current_client_id(). Every RLS policy in the
--     schema calls them inside its predicate, so the policy is evaluated
--     as the caller and the caller needs EXECUTE. Revoking from anon
--     breaks every policy for logged-out requests — which fails closed
--     for reads but also breaks the `anon` path /apply depends on. They
--     return the caller's own role and client id and nothing else.
--     20260921123503's triage said the same; it is restated here because
--     a linter will keep flagging them.
--   · submit_application(). The public form is anon by definition
--     (§2.1); 20260922183012 bounds it instead.
--   · st_estimatedextent and friends are PostGIS's own functions, not
--     ours, and are owned by the extension.
--
-- rls_auto_enable()
-- -----------------
-- The Supabase linter reports a `public.rls_auto_enable()` on the live
-- project that is `security definer` and reachable by anon. No migration
-- or seed in this repo creates it — 20260921123503's header says so and
-- left it alone on those grounds. "Not ours" is a reason not to DROP
-- something; it is not a reason to leave an unattributed definer
-- function that manipulates RLS published to the internet. The block
-- below takes EXECUTE away from PUBLIC, anon and authenticated wherever
-- such a function exists, and does nothing where it does not (it does
-- not exist in this repo's schema, so this is a no-op locally and in
-- CI). It does not drop it: whatever created it may still need it, and
-- the service role keeps its grant.
--
-- Forward-only.
-- =====================================================================

-- ---------------------------------------------------------------------
-- The six worker RPCs: anon out, authenticated re-affirmed.
-- ---------------------------------------------------------------------
revoke execute on function public.attempt_check_in(uuid, double precision, double precision) from public, anon;
revoke execute on function public.check_out(uuid, double precision, double precision)        from public, anon;
revoke execute on function public.start_break(uuid)                                          from public, anon;
revoke execute on function public.finish_break(uuid)                                         from public, anon;
revoke execute on function public.record_ping(uuid, double precision, double precision)      from public, anon;
revoke execute on function public.booking_venue_point(uuid)                                  from public, anon;

grant execute on function public.attempt_check_in(uuid, double precision, double precision) to authenticated;
grant execute on function public.check_out(uuid, double precision, double precision)        to authenticated;
grant execute on function public.start_break(uuid)                                          to authenticated;
grant execute on function public.finish_break(uuid)                                         to authenticated;
grant execute on function public.record_ping(uuid, double precision, double precision)      to authenticated;
grant execute on function public.booking_venue_point(uuid)                                  to authenticated;

-- ---------------------------------------------------------------------
-- The two trigger functions: nobody needs EXECUTE at all.
-- ---------------------------------------------------------------------
revoke execute on function public.bookings_grant_qualification()   from public, anon, authenticated;
revoke execute on function public.violations_grant_qualification() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- rls_auto_enable(), if the project has one. See the header.
-- ---------------------------------------------------------------------
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure::text as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = 'rls_auto_enable'
       and not exists (select 1 from pg_depend d
                        where d.classid = 'pg_proc'::regclass
                          and d.objid = p.oid and d.deptype = 'e')
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', r.sig);
    raise notice 'revoked EXECUTE on unattributed definer function %s from public, anon, authenticated', r.sig;
  end loop;
end $$;
