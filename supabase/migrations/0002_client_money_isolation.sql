-- =====================================================================
-- Migration 0002 · client money isolation (Scope of Work v1.6 §11.1)
--
-- Why this exists
-- ---------------
-- 0001_init.sql created `client_shifts`, a select policy that let the client
-- role read shift_requirements rows for its own events. shift_requirements
-- carries charge_rate and pay_rate, i.e. both sides of the margin, and every
-- table in `public` is granted to the `authenticated` PostgREST role, so a
-- client could read
--     GET /rest/v1/shift_requirements?select=charge_rate,pay_rate
-- and get the money for its own events. §11.1 is absolute: "No money
-- anywhere: no pay rates, no charge rates, no margin." The comment in 0001
-- ("money columns are hidden via views") is not enforceable while the base
-- table itself is readable, because a view cannot take privileges away.
--
-- The fix is to remove the client's direct reach into the money-bearing
-- table. The client portal does not lose anything: client_events_v reads its
-- role-section window through `event_windows`, which is a plain (non
-- security_invoker) view owned by the migration role, so it keeps resolving
-- min(starts_at)/max(ends_at) without exposing a rate column.
--
-- Forward-only: 0001 is left untouched.
-- =====================================================================

drop policy if exists client_shifts on shift_requirements;

comment on table shift_requirements is
  'Role sections (RULE-18). Carries charge_rate and pay_rate, so the client role must never hold a policy here (§11.1). Client-facing timings come from event_windows / client_events_v.';
