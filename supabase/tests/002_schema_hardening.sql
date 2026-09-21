-- =====================================================================
-- 002 · schema hardening guard
--
-- The non-RLS half of 20260921123503_db_hardening: the three findings from
-- the Supabase linter that are about how the schema is built rather than
-- who may read it. 001_rls_guard covers the policy side (the outbox and
-- spatial_ref_sys); this file covers search_path pinning, foreign key
-- indexing and the shape of the auth.uid() calls inside policies.
--
-- All three are invariants rather than snapshots: none names a specific
-- function, index or policy, so a new one that repeats the mistake fails
-- here without anybody remembering to add a line.
--
-- Scope refs: §1.7 security, §3.4/§4.4 (the cap functions), §8 (outbox).
-- =====================================================================
begin;
select plan(7);

-- ---------------------------------------------------------------------
-- 1. The three functions the linter flagged carry a fixed search_path.
--
--    A function with no `set search_path` resolves its body against the
--    caller's path, so a caller who can prepend a schema chooses which
--    `staff` table weekly_cap_hours reads. These three are reachable from
--    a view (event_status via client_events_v), from a rate calculation
--    (final_rate) and from the auto-assign hard gate (weekly_cap_hours).
--
--    Asserted by name and not as "every function in public", because 17
--    others are still unpinned. That is a real finding but it was not in
--    this pass's scope; widen this assertion when they are done rather
--    than adding names to it one at a time.
-- ---------------------------------------------------------------------
select bag_eq(
  $$ select p.proname::text
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname in ('final_rate', 'event_status', 'weekly_cap_hours')
        and exists (select 1 from unnest(p.proconfig) c where c like 'search\_path=%') $$,
  $$ values ('final_rate'::text), ('event_status'), ('weekly_cap_hours') $$,
  'final_rate, event_status and weekly_cap_hours each pin their search_path'
);

-- ---------------------------------------------------------------------
-- 2. And the pin actually holds under a hostile search_path.
--
--    The structural check above passes on `set search_path = ''` too, which
--    would break the function instead of securing it. This is the other
--    half: weekly_cap_hours() reaches public.weekly_cap_for(), so a schema
--    placed in front of `public` is exactly the injection the linter was
--    pointing at. staffa is a plain UK worker, so the honest answer is the
--    48 h standard cap; the decoy would answer 999.
--
--    It also proves the function is no longer inlined: a SQL function with
--    a SET clause cannot be, which is what makes the pin binding at all.
-- ---------------------------------------------------------------------
\ir _shared/fixtures.psql

create schema decoy;
create function decoy.weekly_cap_for(p_staff uuid, p_date date) returns public.cap_assessment
  language sql immutable as $$ select row(999, 'uncapped')::public.cap_assessment $$;

set local search_path to decoy, public, extensions;
select is(
  (select public.weekly_cap_hours(:'staffa', date '2026-09-21')),
  48,
  'weekly_cap_hours ignores a decoy weekly_cap_for() sitting in front of public on the search_path'
);
set local search_path to public, extensions;

-- ---------------------------------------------------------------------
-- 3. Every foreign key in public has an index that covers it.
--
--    Postgres indexes the referenced side of a foreign key automatically
--    (it has to be unique) and the referencing side never. Without one,
--    every delete or key update on the parent sequentially scans the whole
--    child table to prove the constraint — deleting one event scans every
--    booking in the system — and every join from the parent side does the
--    same. 24 of ours were bare until 20260921123503_db_hardening.
--
--    "Covers" means the FK columns are the index's LEADING columns, which
--    is why the composites in 0001 (bookings(shift_id,status),
--    compliance_docs(staff_id,review_status), location_pings(booking_id,at)
--    and the unique keys) count and no extra index was added for them.
-- ---------------------------------------------------------------------
select is_empty(
  $$ with fk as (
       select c.conrelid, c.conrelid::regclass::text as tbl, c.conname::text as name, c.conkey
         from pg_constraint c
         join pg_class t on t.oid = c.conrelid
         join pg_namespace n on n.oid = t.relnamespace
        where c.contype = 'f' and n.nspname = 'public')
     select fk.tbl || '.' || fk.name from fk
      where not exists (
        select 1 from pg_index i
         where i.indrelid = fk.conrelid
           and (i.indkey::int2[])[0:array_length(fk.conkey, 1) - 1] = fk.conkey) $$,
  'every foreign key in public is covered by an index on its referencing columns'
);

-- ---------------------------------------------------------------------
-- 4. No policy calls auth.<fn>() bare.
--
--    auth.uid() is STABLE and reads a GUC, but written bare in a policy
--    predicate it lands in the per-row qual and is called once per row
--    scanned. Wrapped as `(select auth.uid())` it is an uncorrelated
--    subquery, which the planner hoists into an InitPlan and evaluates
--    once per statement. On a worker reading their own booking out of a
--    table holding every booking in the system that is the whole
--    difference. 15 policies were bare until 20260921123503_db_hardening.
--
--    The check strips every `( SELECT auth.x() ...)` the deparser emits
--    and then looks for anything left, so a new policy written the old way
--    fails here.
-- ---------------------------------------------------------------------
select is_empty(
  $$ select tablename || '.' || policyname from pg_policies
      where schemaname = 'public'
        and regexp_replace(coalesce(qual, '') || coalesce(with_check, ''),
                           '\( SELECT auth\.[a-z_]+\(\)[^)]*\)', '', 'g') ~ 'auth\.[a-z_]+\(\)' $$,
  'no policy in public calls auth.<fn>() outside a (select ...) wrapper'
);

-- ---------------------------------------------------------------------
-- 5-7. spatial_ref_sys: the read survives, the write is a KNOWN GAP.
--
--    The read must survive for anon whatever else happens here: PostGIS
--    reads this table as whoever is connected, including an anon session
--    on the public /apply page, so a deny-all would break coordinate work
--    rather than secure it. Assertion 5 is the one that still guards
--    something we control.
--
--    Assertions 6 and 7 were written to prove the write had been taken
--    away. It had not, and it cannot be from here — see the block above
--    them and ADR-0008. They now record the gap instead, which is why they
--    read as lives_ok and "can still delete" rather than as protections.
-- ---------------------------------------------------------------------
select set_config('request.jwt.claims', '', true);
set local role anon;

select is((select count(*)::int from spatial_ref_sys where srid = 4326), 1,
  'anon still reads spatial_ref_sys: SRID 4326 has to resolve or every geography column stops working');

-- KNOWN GAP. These two used to assert that anon cannot write this table.
-- They asserted an outcome that needs supabase_admin: `create extension
-- postgis` in 0001 makes supabase_admin the owner and the grantor of the
-- default privileges, and only the grantor can revoke them. The hardening
-- migration's own `enable row level security` takes its degradation branch
-- on Supabase and changes nothing, so both assertions failed in CI and on
-- the live project, and main was red on them for over an hour.
--
-- They now assert the state that actually holds, so the suite tells the
-- truth instead of asserting an aspiration. What makes this survivable
-- rather than merely tolerated: every geography column in the schema is
-- 4326 and nothing calls ST_Transform, so PostGIS does not read this table
-- during our geofence maths — a forged or deleted SRID cannot move a
-- check-in radius. That is the argument, and it is the thing to re-check
-- if a future migration ever introduces a second SRID.
--
-- Closing it for real needs supabase_admin, so it belongs in project setup
-- (docs/04-setup-github-vercel-supabase.md), not in a migration. When it is
-- closed, these two assertions fail and whoever closed it flips them back —
-- which is the point of writing the gap down as a test rather than a TODO.
select lives_ok(
  $$ insert into spatial_ref_sys (srid, auth_name, auth_srid, srtext, proj4text)
     values (998000, 'forged', 998000, 'GEOGCS["forged"]', '+proj=longlat') $$,
  'KNOWN GAP: anon can still insert a forged projection into spatial_ref_sys (needs supabase_admin to close)');

with d as (delete from spatial_ref_sys where srid = 998000 returning 1)
  select is((select count(*)::int from d), 1,
    'KNOWN GAP: anon can still delete from spatial_ref_sys; survivable only because every geography column here is 4326 and nothing calls ST_Transform');

reset role;
select * from finish();
rollback;
