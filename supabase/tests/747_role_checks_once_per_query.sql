-- =====================================================================
-- 747 · Every policy evaluates the role checks once per query
--       (20261001200700)
--
-- current_app_role() and office_can() are security definer, so a bare
-- call in a policy runs once per ROW; wrapped as `(select …)` it runs
-- once per statement. After 20261001200500 made the role check three
-- lookups, the bare form tripled the cost of admin reads. This fails the
-- moment a new policy calls either bare — wrap it.
-- =====================================================================
begin;
select plan(3);

select is_empty(
  $$ select c.relname::text || '.' || p.polname::text
       from pg_policy p join pg_class c on c.oid = p.polrelid
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and regexp_replace(coalesce(pg_get_expr(p.polqual, p.polrelid), '') || ' '
                           || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), ''),
                           '\(\s*SELECT\s+(current_app_role|office_can)\(', '', 'gi')
            ~ '(current_app_role|office_can)\(' $$,
  'no public policy calls current_app_role() or office_can() bare (once per row)'
);

select cmp_ok(
  (select count(*)::int
     from pg_policy p join pg_class c on c.oid = p.polrelid
     join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and coalesce(pg_get_expr(p.polqual, p.polrelid), '') || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '')
          ~* '\(\s*SELECT\s+current_app_role\(\)'),
  '>=', 30, 'the admin policies read the role through (select current_app_role())');

select hasnt_function('public', '_wrap_role_calls', array['text'], 'the one-off rewrite helper was dropped');

select * from finish();
rollback;
