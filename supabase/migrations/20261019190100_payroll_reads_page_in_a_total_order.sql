-- =====================================================================
-- Payroll reads page in a total order (go-live audit 17.10.2026, B1)
--
-- PostgREST cuts a set-returning function at max_rows (1000) without an
-- error, so the Monday payroll CSV (finance-reports → payroll_export_rows)
-- and the /reports Payroll tab (payroll_report_people) are now read in
-- pages of 1000 (packages/db/src/paged.ts). A page is `OFFSET n LIMIT 1000`
-- over the function's own ORDER BY, so that order must have no ties: two
-- rows that compare equal may swap between two calls, and one of them is
-- then read twice and the other never.
--
-- Neither function's columns let the caller supply the order (the sort
-- keys `removed` and `sort_surname` are not in the output), so the tie
-- breaker goes in here:
--
--   payroll_export_rows    … , l.starts_at, x.booking_id   (one row per shift)
--   payroll_report_people  … , l.staff_name, l.staff_id    (one row per worker)
--
-- payroll_report needs nothing: every sort key is one of its columns, and
-- the office pages it with that order plus booking_id from the outside.
--
-- Bodies otherwise unchanged from their live definitions
-- (20260923130000 for payroll_export_rows; 20261001200100 §7 for
-- payroll_report_people). CREATE OR REPLACE keeps the grants.
-- =====================================================================

create or replace function public.payroll_export_rows(p_send bigint)
returns table (
  booking_id uuid, employee_id int, staff_name text, event_title text, client_name text,
  role_name text, shift_date date, starts_at timestamptz, ends_at timestamptz,
  check_in_at timestamptz, check_out_at timestamptz, kind text,
  unpaid_break_min int, payable_min int, rate numeric, base numeric, holiday numeric,
  total numeric, in_export boolean
)
language plpgsql stable security definer set search_path = public, extensions as $$
#variable_conflict use_column
begin
  perform assert_reports_caller();
  return query
  select x.booking_id, l.employee_id, l.staff_name, l.event_title, l.client_name,
         l.role_name, x.shift_date, l.starts_at, l.ends_at,
         l.check_in_at, l.check_out_at, l.kind,
         l.unpaid_break_min, x.payable_min, x.rate, x.base, x.holiday,
         x.base + x.holiday, true
    from payroll_export_lines x
    join report_payroll_lines_v l on l.booking_id = x.booking_id
   where x.report_send_id = p_send and x.state = 'exported'
   order by l.removed, l.sort_surname nulls last, l.staff_name, l.staff_id, l.starts_at,
            x.booking_id;
end $$;

create or replace function public.payroll_report_people(p_from date, p_to date)
returns table(staff_id uuid, employee_id integer, staff_name text, removed boolean, photo_path text, is_total boolean, workers integer, shifts integer, pending integer, turned_away integer, payable_min integer, break_min integer, base numeric, holiday numeric, total numeric, changed_since_export integer)
language plpgsql
stable security definer
set search_path to 'public', 'extensions'
as $function$
#variable_conflict use_column
begin
  perform assert_finance_caller();
  return query
  with lines as (
    select * from payroll_report(p_from, p_to) r where r.kind <> 'no_show'
  )
  select
    l.staff_id, l.employee_id, l.staff_name, l.removed, l.photo_path,
    grouping(l.staff_id) = 1,
    count(distinct l.staff_id)::int,
    count(*)::int,
    count(*) filter (where l.status = 'pending')::int,
    count(*) filter (where l.kind = 'turned_away')::int,
    coalesce(sum(l.payable_min) filter (where l.status = 'settled'), 0)::int,
    coalesce(sum(l.unpaid_break_min) filter (where l.status = 'settled'), 0)::int,
    coalesce(sum(l.base), 0),
    coalesce(sum(l.holiday), 0),
    coalesce(sum(l.total), 0),
    count(*) filter (where l.changed_since_export)::int
  from lines l
  group by grouping sets ((l.staff_id, l.employee_id, l.staff_name, l.removed, l.photo_path, l.sort_surname), ())
  order by grouping(l.staff_id), bool_or(l.removed), min(l.sort_surname) nulls last, l.staff_name,
           l.staff_id;
end $function$;
