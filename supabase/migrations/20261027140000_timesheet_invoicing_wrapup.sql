-- =====================================================================
-- 20261027140000 · Timesheet invoicing wrap-up — ADR-0210
--
--   · Editing a client's timesheet rate card is audited
--     (timesheet_rate.created / .updated / .deleted).
--   · invoice_record_files can no longer overwrite the files of an invoice
--     that is generated, queued or void: only drawing | failed are open.
--   · resend_invoice_email is for event invoices; a timesheet invoice is
--     sent again through queue_timesheet_invoice_email.
-- Forward-only.
-- =====================================================================

create or replace function public.timesheet_rates_audit()
returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare
  r timesheet_rates := case when tg_op = 'DELETE' then old else new end;
begin
  insert into audit_log (at, actor, action, entity, entity_id, data)
  values (now(), auth.uid(),
          'timesheet_rate.' || case tg_op when 'INSERT' then 'created' when 'UPDATE' then 'updated' else 'deleted' end,
          'client', r.client_id,
          jsonb_build_object('role', r.role_name, 'aliases', to_jsonb(r.aliases),
                             'chargeRate', r.charge_rate,
                             'was', case when tg_op = 'UPDATE' then old.charge_rate end));
  return r;
end $$;
revoke execute on function public.timesheet_rates_audit() from public, anon, authenticated;
create trigger timesheet_rates_audit
  after insert or update or delete on public.timesheet_rates
  for each row execute function public.timesheet_rates_audit();

create or replace function public.invoice_record_files(
  p_invoice uuid, p_storage_path text, p_file_name text, p_attachments jsonb)
returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  update invoices
     set storage_path = p_storage_path, file_name = p_file_name, attachments = p_attachments
   where id = p_invoice and status in ('drawing', 'failed');
  if not found then raise exception 'invoice_not_open' using errcode = 'P0001'; end if;
end $$;
revoke execute on function public.invoice_record_files(uuid, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.invoice_record_files(uuid, text, text, jsonb) to service_role;
