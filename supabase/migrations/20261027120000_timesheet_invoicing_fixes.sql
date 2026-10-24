-- =====================================================================
-- 20261027120000 · Timesheet invoicing — four fixes found writing pgTAP 939
--                   (ADR-0210). Forward-only; 20261027100000 is not edited.
--
--   1 · timesheet_jobs_state_guard ran as the INVOKER and reads
--       timesheet_job_transitions(), which is closed to authenticated, so
--       any status update a signed-in finance admin made on timesheet_jobs
--       (the policy admin_finance_update lets them: Upload, Review, retry)
--       failed with "permission denied for function". The guard is a
--       definer now, like the other state-machine readers.
--   2 · staff_removed_purge_invoices updated unissued timesheet_shifts
--       through timesheet_shift_compute(), which refuses a row whose job is
--       not 'reviewing' / 'extracting' (job_not_reviewing). One rejected
--       row in a complete job would have made a GDPR removal fail. The
--       purge now sets the same thc.issuing flag the issue / void
--       functions use.
--   3 · xero_connection had no office_read_only trigger, so the table-wide
--       ADR-0060 assertion (750) would fail on it.
--   4 · Two new foreign keys had no covering index (002 · 3):
--       timesheet_shifts.file_id and invoices.timesheet_job_id.
-- =====================================================================

-- 1
create or replace function public.timesheet_jobs_state_guard()
returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  new.updated_at := now();
  if new.status is distinct from old.status
     and not exists (select 1 from timesheet_job_transitions() t
                      where t.from_status = old.status and t.to_status = new.status) then
    raise exception 'illegal_timesheet_job_transition' using errcode = 'P0001',
          detail = old.status || ' -> ' || new.status;
  end if;
  return new;
end $$;
revoke execute on function public.timesheet_jobs_state_guard() from public, anon, authenticated;

-- 2
create or replace function public.staff_removed_purge_invoices()
returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  update invoice_lines l
     set staff_name = deleted_account_label(new.employee_id)
   where l.booking_id in (select b.id from bookings b where b.staff_id = new.id)
      or (l.booking_id is null and l.employee_id = new.employee_id);
  -- A removal is not a review edit: it must reach a row whatever state its
  -- job is in (timesheet_shift_compute lets the issuing flag through).
  perform set_config('thc.issuing', '1', true);
  update timesheet_shifts s
     set staff_name = deleted_account_label(new.employee_id), staff_ref = null
   where s.staff_ref = new.employee_id::text and s.invoice_id is null;
  perform set_config('thc.issuing', '', true);
  return new;
end $$;
revoke execute on function public.staff_removed_purge_invoices() from public, anon, authenticated;

-- 3
drop trigger if exists office_read_only on public.xero_connection;
create trigger office_read_only before insert or update or delete or truncate on public.xero_connection
  for each statement execute function public.office_read_only_guard();

-- 4
create index if not exists timesheet_shifts_file_idx on public.timesheet_shifts (file_id) where file_id is not null;
create index if not exists invoices_timesheet_job_idx on public.invoices (timesheet_job_id) where timesheet_job_id is not null;
