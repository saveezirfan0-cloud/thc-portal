-- =====================================================================
-- 786 · current_app_role() keeps its plan between calls (20261012120000)
--
-- Back as LANGUAGE sql it re-plans its body in every statement that calls
-- it, and the per-row helpers in onboarding_candidates_v run enough
-- statements to time /onboarding out (8 s). What it answers is 745's.
-- =====================================================================
begin;
select plan(4);

select is((select l.lanname::text from pg_proc p join pg_language l on l.oid = p.prolang
            where p.oid = 'public.current_app_role()'::regprocedure),
          'plpgsql', 'current_app_role() is plpgsql, so its plan is cached per session');
select is((select prosecdef from pg_proc where oid = 'public.current_app_role()'::regprocedure),
          true, 'still security definer');
select is((select provolatile::text from pg_proc where oid = 'public.current_app_role()'::regprocedure),
          's', 'still stable');
select is((select proconfig from pg_proc where oid = 'public.current_app_role()'::regprocedure),
          array['search_path=public'], 'still pinned to search_path = public');

select * from finish();
rollback;
