-- =====================================================================
-- Migration 20261008170000 · A first entry of bank details sends nothing —
--                            by the office or the system either
--                            (§2.10; ADR-0092 / ADR-0105, THC 07.10.2026)
--
-- ADR-0105 stopped E5 for a worker's first entry (staff_save_bank). The
-- other path was left: bank_details_notify_change() still queued E5b for an
-- INSERT by an office login or the service role, i.e. for details entered
-- for the first time. THC: no email for first-time details, only for a
-- change to existing ones.
--
-- The trigger now returns on INSERT. An UPDATE that changes the holder, sort
-- code or account number still queues E5b, exactly as before. A GDPR removal
-- deletes the row, so re-entering details afterwards is a first entry again.
--
-- Restated: bank_details_notify_change from 20261005140500, with the INSERT
-- branch added. Forward-only.
-- =====================================================================

create or replace function public.bank_details_notify_change()
returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare
  s staff;
  v_by text;
begin
  -- staff_save_bank() owns the notification decision for this write.
  if current_setting('thc.bank_write', true) = 'rpc' then
    return new;
  end if;
  -- A first entry is not a change.
  if tg_op = 'INSERT' then
    return new;
  end if;
  -- An update that changes nothing the payroll pays into is not a change.
  if (old.account_holder, old.sort_code, old.account_number)
         is not distinct from (new.account_holder, new.sort_code, new.account_number) then
    return new;
  end if;

  select * into s from staff where id = new.staff_id;
  select p.full_name into v_by from profiles p where p.id = auth.uid();

  insert into notification_outbox (key, channel, template, recipient_emails, payload)
  values ('E5b:staff:' || new.staff_id || ':' || (extract(epoch from clock_timestamp()) * 1000000)::bigint,
          'email', 'E5b',
          array['gisela@thehospitalitycompany.co.uk', 'thc_payroll@topsourceworldwide.com'],
          jsonb_build_object(
            'name',       coalesce(s.first_name || ' ' || s.last_name, 'Unknown worker'),
            'employeeId', coalesce(s.employee_id::text, '(not yet issued)'),
            'changedAt',  to_char(now() at time zone 'Europe/London', 'DD Mon YYYY HH24:MI'),
            'changedBy',  coalesce(v_by, 'the system')))
  on conflict (key) do nothing;
  return new;
end $$;

comment on function public.bank_details_notify_change() is
  'ADR-0092 (amended, ADR-0105): queues E5b to Gisela and Payroll for a real change to bank_details already on file that did not come through staff_save_bank(): an office login with finance, the service role. A first entry (INSERT) sends nothing. Names the worker and who, never the sort code or account number.';

revoke execute on function public.bank_details_notify_change() from public, anon, authenticated;
