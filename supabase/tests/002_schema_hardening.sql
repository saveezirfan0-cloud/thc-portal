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
select plan(14);

-- ---------------------------------------------------------------------
-- 1. EVERY function this repo owns in `public` pins its search_path.
--
--    A function with no `set search_path` resolves its body against the
--    caller's path, so a caller who can prepend a schema chooses which
--    `staff` table weekly_cap_hours reads, which `settings` row decides
--    the RULE-17 gap, and which `round` final_rate applies.
--
--    This assertion used to name three functions, with a comment saying
--    "widen this when the other 17 are done rather than adding names to
--    it one at a time". The other 17 were done by 20260921130156 and the
--    assertion was never widened — so fourteen more unpinned functions
--    landed over the following day (six in 20260921141500_auto_assign,
--    four in 20260921153100_roles_directory, three in
--    20260922091447_clients_directory, one in 20260922095200_client_card)
--    and a green suite said nothing about any of them. A list of names
--    in a repo moving this fast is stale within hours; this is the
--    invariant the list was standing in for.
--
--    Extension-owned functions are excluded and must be: PostGIS, pgtap,
--    pg_net and pg_cron all install into `public` here (20260921123503
--    decided to leave them there) and none of them is ours to alter.
--    prokind 'f' keeps it to plain functions — an aggregate or a
--    procedure has no body to resolve this way.
--
--    If this fails, the fix is one `alter function … set search_path =
--    public, extensions` line in a new migration, next to the fourteen
--    in 20260922183014. It is not to add a name to an exclusion list.
--
--    ADR-0153 (20261018130000) made one deliberate class of exception,
--    and it is a SHAPE, not a list: a SECURITY INVOKER, non-volatile SQL
--    function whose every name is schema-qualified. A SET clause stops
--    the planner inlining a SQL function, and RULE-20's pure helpers were
--    being re-planned on every nested call because of it. Assertion 1b
--    proves the "every name is qualified" half for each such function by
--    running it under an EMPTY search_path, where an unqualified `staff`
--    or `weekly_cap_for` cannot be found at all; assertion 2b proves a
--    decoy in front of public changes nothing. A definer function, a
--    volatile one or a plpgsql one with no pin still fails here.
-- ---------------------------------------------------------------------
select is_empty(
  $$ select p.proname::text || '(' || pg_get_function_identity_arguments(p.oid) || ')'
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.prokind = 'f'
        and not exists (select 1 from pg_depend d
                         where d.classid = 'pg_proc'::regclass
                           and d.objid = p.oid and d.deptype = 'e')
        and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c
                         where c like 'search\_path=%')
        and (p.prosecdef
             or p.provolatile = 'v'
             or p.prolang <> (select l.oid from pg_language l where l.lanname = 'sql')) $$,
  'every function in public that this repo owns pins its search_path, unless it is an invoker, non-volatile SQL helper (ADR-0153)'
);

-- ---------------------------------------------------------------------
-- 1b. ... and every such helper resolves under an EMPTY search_path.
--
--    Each one is called, with a typed literal for every argument, while
--    search_path is ''. Only pg_catalog is searched then, so any name in
--    its body that is not schema-qualified fails to resolve and the call
--    errors. Literals rather than nulls: a STRICT function given a null is
--    answered without its body ever being read. A new argument type with
--    no sample below fails loudly rather than passing untested.
-- ---------------------------------------------------------------------
create temp table d002_unpinned (fn text, err text);
do $$
declare
  f      record;
  v_args text;
  v_sql  text;
begin
  for f in
    select n.nspname, p.proname, p.proargtypes::oid[] as types
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prokind = 'f'
       and not exists (select 1 from pg_depend d
                        where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
       and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search\_path=%')
  loop
    select string_agg(
             case
               when t.typtype = 'e' then
                 quote_literal((select e.enumlabel from pg_enum e where e.enumtypid = t.oid
                                 order by e.enumsortorder limit 1))
                 || '::' || quote_ident(tn.nspname) || '.' || quote_ident(t.typname)
               when t.oid = 'date'::regtype        then $s$date '2026-10-19'$s$
               when t.oid = 'timestamptz'::regtype then $s$timestamptz '2026-10-19 12:00+00'$s$
               when t.oid = 'boolean'::regtype     then 'false'
               when t.oid = 'uuid'::regtype        then $s$uuid '00000000-0000-4000-8000-000000000000'$s$
               when t.oid = 'text'::regtype        then $s$''$s$
               when t.oid = 'integer'::regtype     then '1'
               when t.oid = 'numeric'::regtype     then '1.0'
               when t.oid = 'daterange[]'::regtype then $s$'{}'::pg_catalog.daterange[]$s$
               else 'no_sample_for_' || t.typname
             end, ', ' order by a.ord)
      into v_args
      from unnest(f.types) with ordinality a(typ, ord)
      join pg_type t on t.oid = a.typ
      join pg_namespace tn on tn.oid = t.typnamespace;
    v_sql := format('select %I.%I(%s)', f.nspname, f.proname, coalesce(v_args, ''));
    begin
      perform set_config('search_path', '', true);
      execute v_sql;
      perform set_config('search_path', 'public, extensions', true);
    exception when others then
      perform set_config('search_path', 'public, extensions', true);
      insert into d002_unpinned values (v_sql, sqlerrm);
    end;
  end loop;
end $$;
select is_empty($$ select fn || ' -> ' || err from d002_unpinned $$,
  'every unpinned helper runs under an empty search_path: nothing in its body depends on the caller''s path');

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

-- 2b. The same decoy test for the helpers ADR-0153 unpinned. They are
--     inlined into the caller's query, so the caller's path is the one in
--     force while their bodies are read, which is why every name in them
--     is qualified: a decoy cap_week_start() and weekly_cap() sitting in
--     front of public are never reached.
create function decoy.cap_week_start(p_date date) returns date
  language sql immutable as $$ select date '1999-01-01' $$;
create function decoy.weekly_cap(p_visa_limited boolean, p_term_state text, p_completion_letter_verified boolean,
  p_optout_48h boolean, p_week_start date, p_below_degree_level boolean, p_completion_date date, p_visa_expiry date,
  p_optout_cancelled_from date, p_under18 boolean, p_verified_on date, p_visa_hour_limit integer)
  returns public.cap_assessment language sql immutable as $$ select row(999, 'uncapped')::public.cap_assessment $$;
set local search_path to decoy, public, extensions;
select is(
  (select public.weekly_cap(false, 'none', false, false)::text || ' ' || public.cap_week_start(date '2026-10-22')),
  '(48,standard_48) 2026-10-19',
  'the inlined weekly_cap() and cap_week_start() ignore decoys sitting in front of public on the search_path'
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
-- 5-12. spatial_ref_sys: the read survives, every API write is refused.
--
--    The read must survive for anon whatever else happens here: PostGIS
--    reads this table as whoever is connected, including an anon session
--    on the public /apply page, so a deny-all would break coordinate work
--    rather than secure it.
--
--    The write is closed by 20261013210000's statement trigger (ADR-0131),
--    not by RLS. On Supabase supabase_admin owns the table and granted
--    anon/authenticated/service_role full DML on it; only the owner can
--    enable RLS or revoke those grants (ADR-0010), but postgres holds the
--    TRIGGER privilege and that is enough. Until 13.10.2026 assertions 6
--    and 7 were lives_ok "KNOWN GAP" records that anon COULD insert and
--    delete here; the hole is closed, so they assert the refusal now, and
--    the local harness's two expected failures (docs/14) are gone.
--
--    Every refusal is 42501 in every environment: the trigger's on
--    Supabase, and locally (postgres owns PostGIS there, so 20260921123503
--    also turned RLS on) the trigger fires first, before any row is read.
--    The DELETE deliberately matches no row: a statement trigger still
--    fires, which is what makes it cover TRUNCATE and empty matches too.
-- ---------------------------------------------------------------------
select set_config('request.jwt.claims', '', true);
set local role anon;

select is((select count(*)::int from spatial_ref_sys where srid = 4326), 1,
  'anon still reads spatial_ref_sys: SRID 4326 has to resolve or every geography column stops working');

select throws_ok(
  $$ insert into spatial_ref_sys (srid, auth_name, auth_srid, srtext, proj4text)
     values (998000, 'forged', 998000, 'GEOGCS["forged"]', '+proj=longlat') $$,
  '42501', null,
  'ADR-0131: anon cannot insert a forged projection into spatial_ref_sys');

select throws_ok(
  $$ delete from spatial_ref_sys where srid = 998000 $$,
  '42501', null,
  'ADR-0131: anon cannot delete from spatial_ref_sys, even a statement that matches no row');

select throws_ok(
  $$ update spatial_ref_sys set proj4text = '+proj=longlat' where srid = 4326 $$,
  '42501', null,
  'ADR-0131: anon cannot rewrite SRID 4326 in spatial_ref_sys');

select throws_ok(
  $$ truncate spatial_ref_sys $$,
  '42501', null,
  'ADR-0131: anon cannot truncate spatial_ref_sys');

reset role;
set local role authenticated;
select throws_ok(
  $$ delete from spatial_ref_sys where srid = 998000 $$,
  '42501', null,
  'ADR-0131: a signed-in session cannot delete from spatial_ref_sys');

reset role;
set local role service_role;
select throws_ok(
  $$ delete from spatial_ref_sys where srid = 998000 $$,
  '42501', null,
  'ADR-0131: the service role cannot delete from spatial_ref_sys either — nothing in this system writes it');

-- The trigger itself, pinned by shape, so a later migration cannot quietly
-- swap it for a row trigger (which would miss TRUNCATE and empty matches).
reset role;
select is(
  (select count(*)::int from pg_trigger t
    where t.tgrelid = 'public.spatial_ref_sys'::regclass
      and t.tgname = 'spatial_ref_sys_read_only'
      and t.tgfoid = 'public.spatial_ref_sys_read_only_guard()'::regprocedure
      and t.tgenabled = 'O'
      and (t.tgtype & 1) = 0       -- per statement
      and (t.tgtype & 2) = 2       -- before
      and (t.tgtype & 60) = 60),   -- insert, delete, update, truncate
  1,
  'ADR-0131: spatial_ref_sys carries the BEFORE INSERT/UPDATE/DELETE/TRUNCATE statement trigger');

reset role;
select * from finish();
rollback;
