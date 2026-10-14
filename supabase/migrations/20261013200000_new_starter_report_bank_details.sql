-- =====================================================================
-- Bank details on the New Starter (HMRC) report (§9.9 Tab 3, ADR-0130)
--
-- THC, 13.10.2026: "On the New Starter HMRC report, staff bank details
-- should also feature." Payroll sets a new starter up from this one file,
-- and without the account it had to be fetched worker by worker.
--
-- Three columns are appended after Student Loan — Account holder · Sort
-- code · Account number — in the one row builder, new_starter_rows(), so
-- the /reports preview (new_starter_report), the Export CSV and the Monday
-- email (new_starter_report_rows) all carry them. The full values, as the
-- NI number already is: the screen masks them, the file is for payroll.
--
-- Who can read them is unchanged. new_starter_report() asks
-- assert_finance_caller() (owner and manager, ADR-0056 — the same people
-- bank_details' office_finance_read lets read the table), and
-- new_starter_report_rows() is the service role's only. new_starter_rows()
-- itself stays callable by nobody but its owner.
--
-- A worker with no bank details yet reads blank; a removed worker reads
-- blank too (remove_worker() deletes the row, and the guard below would
-- hold even if it did not).
--
-- A changed result shape cannot be `create or replace`d, so the three
-- functions are dropped and re-created with their live bodies, the only
-- change being the three columns; grants are restated as they were.
-- =====================================================================

drop function if exists public.new_starter_report(date);
drop function if exists public.new_starter_report_rows(bigint);
drop function if exists public.new_starter_rows(uuid[]);

create function public.new_starter_rows(p_staff uuid[])
returns table (
  staff_id uuid, employee_id int, staff_name text, removed boolean, photo_path text,
  ni_number text, home_address text, postcode text, country text,
  date_of_birth date, gender text, first_shift_date date,
  hmrc_statement text, student_loan text,
  bank_account_holder text, bank_sort_code text, bank_account_number text
)
language sql stable security definer set search_path = public, extensions as $$
  select st.id, st.employee_id,
         case when st.removed_at is null then st.first_name || ' ' || st.last_name
              else deleted_account_label(st.employee_id) end,
         st.removed_at is not null,
         case when st.removed_at is null then st.photo_path end,
         st.ni_number,
         st.home_address,
         coalesce(st.home_postcode, new_starter_postcode(st.home_address)),
         st.home_country,
         -- A removed worker's dob is the 1900 placeholder, not a date of birth.
         case when st.removed_at is null then st.dob end,
         st.gender,
         f.first_shift_date,
         h.statement::text,
         case
           when h.staff_id is null then null
           when h.student_loan = 'none' and h.postgraduate_loan then 'Postgraduate'
           when h.student_loan = 'none' then 'No'
           else 'Plan ' || substring(h.student_loan::text from '[0-9]+')
                || case when h.postgraduate_loan then ' + Postgraduate' else '' end
         end,
         case when st.removed_at is null then bd.account_holder end,
         -- Stored as six digits (staff_save_bank); written the way a bank prints it.
         case when st.removed_at is null and bd.sort_code ~ '^[0-9]{6}$'
              then substr(bd.sort_code, 1, 2) || '-' || substr(bd.sort_code, 3, 2) || '-' || substr(bd.sort_code, 5, 2)
              when st.removed_at is null then bd.sort_code end,
         case when st.removed_at is null then bd.account_number end
    from staff st
    join report_first_shifts_v f on f.staff_id = st.id
    left join hmrc_checklists h  on h.staff_id = st.id
    left join bank_details bd    on bd.staff_id = st.id
   where st.id = any(p_staff)
   order by st.removed_at is not null, st.last_name, st.first_name, st.employee_id
$$;

revoke execute on function public.new_starter_rows(uuid[]) from public, anon, authenticated;

create function public.new_starter_report(p_date date)
returns table (
  staff_id uuid, employee_id int, staff_name text, removed boolean, photo_path text,
  ni_number text, home_address text, postcode text, country text,
  date_of_birth date, gender text, first_shift_date date,
  hmrc_statement text, student_loan text,
  bank_account_holder text, bank_sort_code text, bank_account_number text,
  period_start date, period_end date
)
language plpgsql stable security definer set search_path = public, extensions as $$
#variable_conflict use_column
declare
  v_start date := date_trunc('week', p_date)::date - 7;
begin
  perform assert_finance_caller();
  return query
  select n.*, v_start, v_start + 6
    from new_starter_rows(array(
           select f.staff_id from report_first_shifts_v f
            where f.first_shift_date between v_start and v_start + 6)) n;
end $$;

comment on function public.new_starter_report(date) is
  '§9.9 Tab 3: the people whose first paid shift fell in the Mon–Sun week before the picked date''s week, with the HMRC columns (Staff · Employee ID · NI · address · postcode · country · DOB · gender · first shift · statement · student loan) and their bank details (account holder · sort code · account number, ADR-0130). Role and salutation are deliberately absent. Owner and manager only (assert_finance_caller).';

create function public.new_starter_report_rows(p_send bigint)
returns table (
  staff_id uuid, employee_id int, staff_name text, removed boolean, photo_path text,
  ni_number text, home_address text, postcode text, country text,
  date_of_birth date, gender text, first_shift_date date,
  hmrc_statement text, student_loan text,
  bank_account_holder text, bank_sort_code text, bank_account_number text
)
language plpgsql stable security definer set search_path = public, extensions as $$
begin
  perform assert_reports_caller();
  return query
  select * from new_starter_rows(array(
    select r.staff_id from new_starter_reported r where r.report_send_id = p_send));
end $$;

comment on function public.new_starter_report_rows(bigint) is
  'ADR-0091 step 2: the CSV rows for a prepared New Starter (HMRC) send — the workers recorded against it, with the §9.9 Tab 3 columns and their bank details (ADR-0130).';

revoke execute on function public.new_starter_report(date) from public, anon;
grant execute on function public.new_starter_report(date) to authenticated, service_role;

revoke execute on function public.new_starter_report_rows(bigint) from public, anon, authenticated;
grant execute on function public.new_starter_report_rows(bigint) to service_role;
