-- =====================================================================
-- Migration 20260926130900 · no trigger function is an RPC, and the
--                            live-only rls_auto_enable() goes
--                            (security brief Invariant 4; docs/14 §4)
--
-- 1 · 20260922183013 set the rule for trigger functions declared
--     SECURITY DEFINER: "A trigger fires as part of the statement
--     regardless of who holds EXECUTE, so nothing needs this grant; all
--     it does is publish two definer functions on an RPC path. Revoked
--     from PUBLIC, anon AND authenticated." Two later ones were created
--     without that revoke — report_sends_follow_outbox()
--     (20260923130000) and event_documents_follow_outbox()
--     (20260923130100) — so Supabase's default privilege left EXECUTE
--     with authenticated. Both are revoked by name, and then EVERY
--     function in public that returns `trigger` is revoked from the
--     PostgREST roles in one pass, so the next one is caught without a
--     name list. 190_job_function_grants pins the invariant.
--
-- 2 · public.rls_auto_enable() exists on the live project and in no
--     migration (docs/14 §4: "A SECURITY DEFINER function that
--     manipulates RLS, origin unknown"). 20260922183013 revoked its
--     EXECUTE without anyone having read its body. Nothing in this repo
--     or in Supabase's own tooling creates a function of that name; an
--     unowned definer that touches pg_class.relrowsecurity has no place
--     next to a schema whose every table is asserted by 001_rls_guard.
--     Dropped if present. If something on the live project depends on it
--     (an event trigger), the drop is refused with a notice rather than
--     failing the deploy, and docs/14 §4 keeps the item.
-- =====================================================================

revoke execute on function public.report_sends_follow_outbox()   from public, anon, authenticated;
revoke execute on function public.event_documents_follow_outbox() from public, anon, authenticated;

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prorettype = 'trigger'::regtype
       and (has_function_privilege('anon', p.oid, 'execute')
         or has_function_privilege('authenticated', p.oid, 'execute')
         or has_function_privilege('public', p.oid, 'execute'))
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', r.sig);
  end loop;
end $$;

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'rls_auto_enable'
  loop
    begin
      execute format('drop function %s', r.sig);
      raise notice 'dropped %', r.sig;
    exception when dependent_objects_still_exist then
      raise notice 'rls_auto_enable() kept: something depends on it (%). Read docs/14 §4.', sqlerrm;
    end;
  end loop;
end $$;
