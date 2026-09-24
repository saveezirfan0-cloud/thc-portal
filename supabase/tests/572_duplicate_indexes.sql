-- =====================================================================
-- 572 · no duplicate indexes (20260927120200, audit 24.09 §4)
--
-- The three named pairs are gone to one each, and — the durable half — no
-- table in public carries two indexes on the same columns with the same
-- definition apart from the name. That is how the three pairs arrived:
-- a later migration's `create index if not exists` under a new name.
-- =====================================================================
begin;
select plan(7);

select has_index('public', 'bookings', 'bookings_staff_id_status_idx',
  'bookings (staff_id, status) keeps its 0001 index');
select hasnt_index('public', 'bookings', 'bookings_staff_status_idx',
  'and its duplicate is gone');
select has_index('public', 'client_rate_cards', 'client_rate_cards_client_id_idx',
  'client_rate_cards (client_id) keeps one index');
select hasnt_index('public', 'client_rate_cards', 'client_rate_cards_client_idx',
  'and its duplicate is gone');
select has_index('public', 'feedback', 'feedback_staff_id_idx',
  'feedback (staff_id) keeps one index');
select hasnt_index('public', 'feedback', 'feedback_staff_idx',
  'and its duplicate is gone');

-- Same table, same columns and opclasses, same predicate and expressions,
-- same uniqueness: one of them is dead weight on every write.
select is_empty(
  $$ select a.indrelid::regclass::text || ': ' || ca.relname || ' = ' || cb.relname
       from pg_index a
       join pg_index b on b.indrelid = a.indrelid and a.indexrelid < b.indexrelid
       join pg_class ca on ca.oid = a.indexrelid
       join pg_class cb on cb.oid = b.indexrelid
       join pg_namespace n on n.oid = ca.relnamespace
      where n.nspname = 'public'
        and a.indkey::text = b.indkey::text
        and a.indclass::text = b.indclass::text
        and a.indisunique = b.indisunique
        and coalesce(pg_get_expr(a.indpred, a.indrelid), '') = coalesce(pg_get_expr(b.indpred, b.indrelid), '')
        and coalesce(pg_get_expr(a.indexprs, a.indrelid), '') = coalesce(pg_get_expr(b.indexprs, b.indrelid), '')
        and (select amname from pg_am where oid = ca.relam) = (select amname from pg_am where oid = cb.relam) $$,
  'no table in public has two indexes with the same definition');

select * from finish();
rollback;
