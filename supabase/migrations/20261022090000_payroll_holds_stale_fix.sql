-- =====================================================================
-- 20261022090000 · Payroll holds a shift whose No check-out is unresolved,
--                  even when a finish was recorded — ADR-0174
--
-- §9.9 Tab 2: "A shift with an unresolved "No check-out" Violation shows
-- "Pending" in place of Payable hours/Payroll and is excluded from the CSV
-- export (§7, BG-08) until a manager resolves it." RULE-02: never a silent
-- default.
--
-- The gap (found reviewing ADR-0172): a worker who presses Check out away
-- from the venue has the last on-site fix recorded as their finish and a
-- No check-out raised for review (D15, ADR-0035, check_out() in
-- 20261012121200). payable_minutes() prices that line as settled, on the
-- stale fix, so report_payroll_lines_v called it settled: the Payroll tab
-- showed a figure, the CSV carried it and BG-08 exported it — paying, say,
-- 5 minutes for a 4-hour shift with nobody having looked.
--
-- The fix is one expression in report_payroll_lines_v: a worked line is
-- `settled` only when its pay is settled AND no No check-out on its booking
-- is unresolved. Everything that reads the view follows, unchanged:
--
--   · payroll_report / payroll_report_people — Pending, no money, out of
--     `in_export` (the CSV rule is `status = 'settled'`);
--   · prepare_finance_reports (BG-08) — the line goes in as `held`, and is
--     exported the first Monday after a manager resolves it, as for every
--     other pending line;
--   · a line already exported that turns pending shows changed_since_export,
--     the existing warning — never a silent correction (RULE-06);
--   · finance_report — the shift counts as pending, no actual figure;
--   · invoice_events (ADR-0172) — already held such an event at "Missing
--     check-out"; the line now also carries no amount.
--
-- The pay engine (payable_shifts_v, payable_minutes) is not touched: the
-- worker's own screens and the check-out answer read it, and are a
-- separate question. This is about what goes to payroll.
--
-- Re-created from the LIVE definition with the one expression replaced
-- (docs/10 §3b: a hand-copied body is how a shipped rule gets dropped).
-- The pattern must match exactly once or the migration stops. create or
-- replace keeps the grants; security_barrier is restated.
-- =====================================================================
do $$
declare
  v_def text;
  v_n   int;
  v_pat constant text :=
    $re$WHEN\s+\(?\(ps\.pay\s*->>\s*'status'::text\)\s*=\s*'settled'::text\)?\s+THEN\s+'settled'::text$re$;
  v_new constant text :=
    $sql$WHEN (ps.pay ->> 'status'::text) = 'settled'::text
                     AND NOT (EXISTS ( SELECT 1
                                 FROM violations v_nc
                                WHERE v_nc.booking_id = ps.booking_id
                                  AND v_nc.type = 'no_checkout'::violation_type
                                  AND NOT v_nc.resolved)) THEN 'settled'::text$sql$;
begin
  v_def := pg_get_viewdef('public.report_payroll_lines_v'::regclass, true);
  select count(*) into v_n from regexp_matches(v_def, v_pat, 'g');
  if v_n <> 1 then
    raise exception '20261022090000: report_payroll_lines_v - expected one match of the settled status, found %', v_n;
  end if;
  v_def := regexp_replace(v_def, v_pat, v_new);
  execute 'create or replace view public.report_payroll_lines_v with (security_barrier = true) as ' || v_def;
end $$;

-- create or replace keeps a view's grants; restated so this file alone
-- shows who may read it (20260923130000, 20261001215000).
revoke all on public.report_payroll_lines_v from public, anon, authenticated;

comment on view public.report_payroll_lines_v is
  'One row per shift that can carry money (§9.9): worked, turned away, no-show (0) and §3.3 same-day cancellations (full scheduled hours). Pay from payable_shifts_v only; base and holiday priced separately; pending has no figure. Pending = the pay is undetermined OR a No check-out on the booking is unresolved, including one raised on a stale fix with a recorded finish (ADR-0174). Owner-rights and granted to nobody: read through the report functions.';
