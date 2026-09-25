-- =====================================================================
-- Role checks evaluated once per query, not once per row
-- (security review of ADR-0035…0039, finding 2)
--
-- 20260930160000 made current_app_role() stricter (switched-off logins,
-- two-step below aal2), which made each call three lookups instead of
-- one. Most policies call it bare — `current_app_role() = 'admin'` — and
-- a security definer function is never inlined, so Postgres ran it once
-- PER ROW: an admin scan of 100k audit_log rows went from 0.64 s to
-- 1.88 s in the review's measurement. The same holds for office_can() in
-- the restrictive policies (20260930110000).
--
-- Wrapped as `(select current_app_role())` the planner runs it once per
-- statement as an InitPlan. The answer cannot differ between rows of one
-- statement (it reads only the caller's JWT and their own rows), so the
-- rule is unchanged — only when it is computed.
--
-- Done by rewriting each policy's own expression in place with ALTER
-- POLICY, so no policy is dropped, renamed or re-granted, and every
-- policy that already wrapped the call is left exactly as it is. public
-- schema only: storage.objects belongs to Supabase's storage role.
-- =====================================================================
-- A one-off text helper for the block below, dropped at the end. It wraps
-- every bare call; calls already inside `(SELECT …)` are parked first so
-- they are not wrapped twice.
create or replace function public._wrap_role_calls(p_expr text)
returns text
language plpgsql
immutable
as $fn$
declare
  v text := p_expr;
begin
  if v is null then
    return null;
  end if;
  v := regexp_replace(v, '\(\s*select\s+current_app_role\(\)\s*(as\s+\w+\s*)?\)', '@@CAR@@', 'gi');
  v := regexp_replace(v, '\(\s*select\s+office_can\((''[a-z]+''(::text)?)\)\s*(as\s+\w+\s*)?\)', '@@OC[\1]@@', 'gi');
  v := replace(v, 'current_app_role()', '(SELECT current_app_role())');
  v := regexp_replace(v, 'office_can\((''[a-z]+''(::text)?)\)', '(SELECT office_can(\1))', 'g');
  v := replace(v, '@@CAR@@', '(SELECT current_app_role())');
  v := regexp_replace(v, '@@OC\[([^]]*)\]@@', '(SELECT office_can(\1))', 'g');
  return v;
end;
$fn$;

do $$
declare
  r        record;
  v_qual   text;
  v_check  text;
  v_sql    text;
  v_done   int := 0;
begin
  for r in
    select c.relname, p.polname,
           pg_get_expr(p.polqual, p.polrelid)      as qual,
           pg_get_expr(p.polwithcheck, p.polrelid) as wcheck
      from pg_policy p
      join pg_class c on c.oid = p.polrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and (coalesce(pg_get_expr(p.polqual, p.polrelid), '') ~ '(current_app_role|office_can)\('
         or coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '') ~ '(current_app_role|office_can)\(')
  loop
    v_qual  := public._wrap_role_calls(r.qual);
    v_check := public._wrap_role_calls(r.wcheck);
    if v_qual is not distinct from r.qual and v_check is not distinct from r.wcheck then
      continue;
    end if;
    v_sql := format('alter policy %I on public.%I', r.polname, r.relname);
    if v_qual is not null then
      v_sql := v_sql || ' using (' || v_qual || ')';
    end if;
    if v_check is not null then
      v_sql := v_sql || ' with check (' || v_check || ')';
    end if;
    execute v_sql;
    v_done := v_done + 1;
  end loop;
  raise notice 'role checks wrapped in % policies', v_done;
end;
$$;

drop function public._wrap_role_calls(text);
