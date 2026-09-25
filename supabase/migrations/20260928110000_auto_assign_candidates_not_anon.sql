-- =====================================================================
-- Migration 20260928110000 · auto_assign_candidates is not an anon RPC
--                            (§3.3, §3.4, §1.7)
--
-- 20260927140100 dropped `auto_assign_candidates(uuid)` and recreated it
-- as `auto_assign_candidates(uuid, boolean)`. A new function picks up
-- PUBLIC's default EXECUTE and, on Supabase, the bootstrap default
-- privileges that grant EXECUTE to anon, authenticated and service_role
-- BY NAME (the trap 20260921162758 describes). That migration restated
-- the authenticated and service_role grants and revoked nothing, so the
-- whole candidate pool — every worker's gate, reliability, rating and
-- distance from the venue — was published at /rest/v1/rpc/ to the anon
-- key.
--
-- Not exploitable today: the function is `language sql stable` WITHOUT
-- `security definer`, so it runs as its caller and RLS bounds every table
-- it reads. anon holds no policy on `staff` or `shift_requirements`, so
-- the pool comes back empty. But "empty because of RLS" is one careless
-- `security definer` away from "the whole workforce", and a signed-out
-- caller has no pool to see even in principle.
--
-- authenticated keeps EXECUTE: the office event board reads the pool
-- through the manager's own session, and the admin_all policies are what
-- make the rows visible. The function has no caller guard of its own — it
-- is RLS-bound instead, so a worker sees at most their own row and a
-- client none (130_auto_assign section 8 holds that). service_role keeps
-- its grant for the auto-staffing job (190 assertion 1).
-- =====================================================================

revoke execute on function public.auto_assign_candidates(uuid, boolean) from public, anon;

grant execute on function public.auto_assign_candidates(uuid, boolean) to authenticated, service_role;
