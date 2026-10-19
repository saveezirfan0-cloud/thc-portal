-- =====================================================================
-- 858 · Payroll reads page in a total order (go-live audit 17.10.2026, B1)
--   20261019190100_payroll_reads_page_in_a_total_order.sql
--
--   The Monday CSV and the /reports people table are read in pages of
--   1000 (PostgREST max_rows). A page is OFFSET/LIMIT over the function's
--   own ORDER BY, so that order must end on a key no two rows share.
--
--   1. payroll_export_rows ends on booking_id; payroll_report_people on
--      staff_id.
--   2. The grants are unchanged by the replace: the export rows stay the
--      service role's, the people table the office's.
-- =====================================================================
begin;
select plan(5);

select ok(pg_get_functiondef('public.payroll_export_rows(bigint)'::regprocedure)
            ~ 'l\.starts_at,\s+x\.booking_id;',
  'payroll_export_rows orders by the shift last, so a page boundary cannot split a tie');
select ok(pg_get_functiondef('public.payroll_report_people(date, date)'::regprocedure)
            ~ 'l\.staff_name,\s+l\.staff_id;',
  'payroll_report_people orders by the worker last');

select ok(not has_function_privilege('authenticated', 'public.payroll_export_rows(bigint)', 'execute'),
  'the export rows are still not callable by a signed-in session');
select ok(has_function_privilege('service_role', 'public.payroll_export_rows(bigint)', 'execute'),
  'the finance-reports job can still read them');
select ok(has_function_privilege('authenticated', 'public.payroll_report_people(date, date)', 'execute'),
  'the office can still read the people table (the function refuses anyone else itself)');

select * from finish();
rollback;
