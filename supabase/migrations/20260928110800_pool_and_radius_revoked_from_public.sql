-- =====================================================================
-- Migration 20260928110800 · auto_assign_candidates(uuid, boolean) and
--                            escalation_radius_miles() are revoked from
--                            PUBLIC and anon, like their neighbours
--                            (security audit 27.09, invariant 4)
--
-- 20260927140100 dropped auto_assign_candidates(uuid) and created the
-- (uuid, boolean) overload; 20260928110100 restated it. Both wrote only
-- `grant execute … to authenticated, service_role`, and neither took back
-- the EXECUTE that PostgreSQL gives PUBLIC on every new function.
-- escalation_radius_miles() (20260927140100 §1) was never revoked either.
--
-- Nothing leaks today: both are `security invoker`, so anon runs them
-- under its own (empty) RLS view and 190's definer guard keeps holding.
-- The exposure is the next edit: a function that already carries PUBLIC's
-- default EXECUTE keeps it through `create or replace`, and one made
-- `security definer` later would reach anon without a single grant line
-- saying so. Every other RPC in the tree is revoked from public and anon
-- by name; these two now are too. The grants the office (the pool read
-- behind the Auto-assign panel) and the §7 jobs rely on are restated.
--
-- 190_job_function_grants.sql names both in its anon list and asserts,
-- structurally, that no definer in public holds PUBLIC execute.
-- Forward-only; no signature changes.
-- =====================================================================

revoke execute on function public.auto_assign_candidates(uuid, boolean) from public, anon;
revoke execute on function public.escalation_radius_miles()             from public, anon;

grant execute on function public.auto_assign_candidates(uuid, boolean) to authenticated, service_role;
grant execute on function public.escalation_radius_miles()             to authenticated, service_role;
