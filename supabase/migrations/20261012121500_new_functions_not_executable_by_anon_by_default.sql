-- =====================================================================
-- Migration 20261012121500 · a new function is not anon's until a
--                            migration says so (docs/14 §4)
--
-- Supabase's default privileges grant EXECUTE on every new function in
-- `public` to anon, authenticated and service_role, and PostgreSQL's own
-- default grants it to PUBLIC. So every `create function` in this repo
-- starts life callable from the anon key, and the convention — "revoke
-- execute … from public, anon" in the same file (190 2e/2f, 002) — is the
-- only thing standing between a forgotten line and an anonymous RPC.
-- Security audit 12.10.2026, NOTE.
--
-- From here on, functions created by `postgres` (the role every migration
-- runs as, locally and on the hosted project) no longer get EXECUTE for
-- PUBLIC or anon by default. authenticated and service_role keep their
-- default grant: dropping authenticated would change what every future
-- `create function` means for the three apps, which is a larger decision
-- than this round.
--
-- What does NOT change: existing functions keep the grants they have —
-- default privileges apply only to objects created after this — and
-- `create or replace` keeps a function's grants. A function that is
-- DROPPED and re-created (as 20261012121200 does for the on-shift RPCs)
-- gets the new defaults, which is why such a migration restates its
-- grants. The deliberate anon grants are made explicit below so a future
-- re-create cannot lose them silently: current_app_role() and
-- current_client_id() are read by policies that anon's requests evaluate
-- (0001; 190 lists them as the only anon-callable definers). Invoker
-- helpers anon could already reach keep that reach (existing ACLs).
-- 801_new_functions_not_anon_by_default pins it.
-- =====================================================================

alter default privileges for role postgres revoke execute on functions from public;
alter default privileges for role postgres in schema public revoke execute on functions from anon;

grant execute on function public.current_app_role()  to anon, authenticated, service_role;
grant execute on function public.current_client_id() to anon, authenticated, service_role;
