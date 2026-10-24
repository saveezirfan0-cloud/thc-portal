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
--   5 · invoice_document_data() in 20261027100000 was written from the
--       ADR-0176 original and so dropped what 20261022110000 and
--       20261022200000 added to each line (checkInAt, checkOutAt, late,
--       leftEarly, finishByOffice, floorApplied, eventId, bookingId): the
--       event invoices' sign-in log would have lost its times and the
--       overrun fold (909, 921). Restated with both.
--   6 · clients_invoice_details_guard() in 20261027100000 was written from
--       the ADR-0176 original, not from 20261022130000's: it lost
--       invoice_cc_emails (a scheduler could rewrite the CC list) and it
--       refused an INSERT that carried an accounts contact, emails or an
--       address from a caller without finance, which create_client()
--       (910) relies on. Restated: 20261022130000's rules, plus the
--       ADR-0210 columns (an insert may not set those without finance).
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

-- 5
create or replace function public.invoice_document_data(p_invoice uuid)
returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare
  i invoices;
begin
  select * into i from invoices where id = p_invoice;
  if i.id is null then raise exception 'invoice_not_found' using errcode = 'P0002'; end if;

  return jsonb_build_object(
    'id', i.id, 'number', i.number, 'source', i.source,
    'invoiceDate', i.invoice_date, 'dueDate', i.due_date,
    'periodFrom', i.period_from, 'periodTo', i.period_to, 'poNumber', i.po_number,
    'payableMin', i.payable_min, 'net', i.net, 'vatRate', i.vat_rate, 'vat', i.vat,
    'total', i.total, 'termsDays', i.terms_days, 'billTo', i.bill_to, 'seller', i.seller,
    'recipients', to_jsonb(i.recipients),
    'events', (select coalesce(jsonb_agg(jsonb_build_object(
                         'id', e.id, 'title', e.title, 'date', e.event_date, 'venue', e.venue_name)
                       order by e.event_date, e.title), '[]'::jsonb)
                 from invoice_event_links k join events e on e.id = k.event_id
                where k.invoice_id = i.id),
    'lines', (select coalesce(jsonb_agg(jsonb_build_object(
                        'date', l.line_date, 'staffName', l.staff_name, 'employeeId', l.employee_id,
                        'role', l.role_name, 'startsAt', l.starts_at, 'endsAt', l.ends_at,
                        'breakMin', l.break_min, 'payableMin', l.payable_min, 'rate', l.rate,
                        'amount', l.amount, 'kind', l.kind,
                        'checkInAt', l.check_in_at, 'checkOutAt', l.check_out_at,
                        'late', l.late, 'leftEarly', l.left_early,
                        'finishByOffice', l.finish_by_office, 'floorApplied', l.floor_applied,
                        'eventId', l.event_id, 'bookingId', l.booking_id,
                        'hours', l.hours, 'staffCount', l.staff_count, 'quantity', l.quantity)
                        order by l.sort), '[]'::jsonb)
                from invoice_lines l where l.invoice_id = i.id));
end $$;
revoke execute on function public.invoice_document_data(uuid) from public, anon, authenticated;
grant execute on function public.invoice_document_data(uuid) to service_role;

-- 6
create or replace function public.clients_invoice_details_guard()
returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  if tg_op = 'INSERT' then
    -- create_client() sets the ADR-0176 details at creation, for whoever may
    -- add a client; the ADR-0210 settings are finance's even then.
    if new.invoicing_mode = 'events' and new.invoice_format = 'named'
       and new.invoice_display_name is null and new.invoice_venue is null
       and new.invoice_venue_address is null and new.invoice_date_label is null
       and not new.omit_event_dates_in_subject and new.timesheet_default_role is null
       and coalesce(array_length(new.timesheet_excluded_staff, 1), 0) = 0
       and not new.po_required and new.payment_terms_days is null
       and new.xero_contact_id is null then
      return new;
    end if;
  elsif (new.accounts_contact_name, new.invoice_emails, new.invoice_cc_emails, new.billing_address,
         new.invoicing_mode, new.invoice_format, new.invoice_display_name, new.invoice_venue,
         new.invoice_venue_address, new.invoice_date_label, new.omit_event_dates_in_subject,
         new.timesheet_default_role, new.timesheet_excluded_staff, new.po_required,
         new.payment_terms_days, new.xero_contact_id)
        is not distinct from
        (old.accounts_contact_name, old.invoice_emails, old.invoice_cc_emails, old.billing_address,
         old.invoicing_mode, old.invoice_format, old.invoice_display_name, old.invoice_venue,
         old.invoice_venue_address, old.invoice_date_label, old.omit_event_dates_in_subject,
         old.timesheet_default_role, old.timesheet_excluded_staff, old.po_required,
         old.payment_terms_days, old.xero_contact_id) then
    return new;
  end if;
  if not office_can('finance') then
    raise exception 'not_permitted' using errcode = '42501', detail = 'finance';
  end if;
  return new;
end $$;
