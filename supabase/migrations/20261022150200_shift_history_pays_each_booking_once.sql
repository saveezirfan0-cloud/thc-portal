-- =====================================================================
-- Migration 20261022150200 · staff_shift_history_v works out each
--                            booking's pay once, not once per row
--
-- /staff/[id] (p95 1.7 s) reads the worker's Shifts tab from
-- staff_shift_history_v, which joins payable_shifts_v for the pay figures:
--
--   LEFT JOIN payable_shifts_v ps ON ps.booking_id = b.id
--
-- payable_shifts_v cannot be flattened into that join with its quals (its
-- `logs` CTE ranks check-ins with a window function), so the planner runs
-- it as the inner side of a nested loop, unparameterised, and filters on
-- booking_id afterwards: for EVERY history row it computes the pay of EVERY
-- payable booking in the agency — effective_pay_rate(), unpaid_break_minutes()
-- twice and payable_minutes() each — and keeps one. On the live project
-- that is 25 history rows × 6 payable bookings = 150 pay computations for
-- one worker's tab, 2.4 ms each: 350–450 ms of a 440 ms read. It grows with
-- worker history × agency history.
--
-- Now the join is LATERAL with the condition inside and OFFSET 0, which
-- keeps the subquery from being pulled back up: it runs once per history
-- row, finds that booking through bookings_pkey, and computes its pay once.
-- `LEFT JOIN v ON v.k = b.id` and `LEFT JOIN LATERAL (SELECT … FROM v WHERE
-- v.k = b.id) ON true` are the same join — every matching row, or one row
-- of nulls — so the view returns the same rows. Its columns, their order
-- and types, security_invoker and grants are unchanged.
--
-- Measured on the live project (22.10.2026, read-only, an office session):
--   one worker's tab (25 rows)          346–446 ms → 9.4–12.8 ms
--   every row of the view, old against new, as the office: 254 rows each,
--   EXCEPT ALL empty both ways (6 of them with pay).
--
-- payable_shifts_v itself (payroll, §11.3 documents, resolve_violation())
-- is not touched.
--
-- Re-created from the LIVE definition (docs/10 §3b) with one targeted
-- replacement, required to match exactly once; the view must still read
-- only the four pay columns from payable_shifts_v.
-- =====================================================================

do $$
declare
  v_def text := pg_get_viewdef('public.staff_shift_history_v'::regclass);
  v_pat constant text := 'LEFT JOIN payable_shifts_v ps ON \(\(ps\.booking_id = b\.id\)\)';
  v_n   int;
begin
  select count(*) into v_n from regexp_matches(v_def, v_pat, 'g');
  if v_n <> 1 then
    raise exception '20261022150200: staff_shift_history_v - expected one match of the payable_shifts_v join, found %', v_n;
  end if;
  if exists (select 1 from regexp_matches(v_def, 'ps\.(\w+)', 'g') m
              where m[1] not in ('booking_id', 'check_in_at', 'check_out_at', 'kind', 'pay')) then
    raise exception '20261022150200: staff_shift_history_v reads a payable_shifts_v column this migration does not carry; add it to the lateral select list';
  end if;
  if (select reloptions from pg_class where oid = 'public.staff_shift_history_v'::regclass)
     is distinct from array['security_invoker=true'] then
    raise exception '20261022150200: staff_shift_history_v options changed; carry them over before re-creating it';
  end if;

  v_def := regexp_replace(v_def, v_pat,
    'LEFT JOIN LATERAL ( SELECT p.check_in_at, p.check_out_at, p.kind, p.pay'
    || ' FROM payable_shifts_v p WHERE p.booking_id = b.id OFFSET 0) ps ON true');

  execute 'create or replace view public.staff_shift_history_v with (security_invoker = true) as '
    || rtrim(v_def, E' \n;');
end;
$$;
