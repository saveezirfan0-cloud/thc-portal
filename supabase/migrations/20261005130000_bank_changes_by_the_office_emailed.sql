-- =====================================================================
-- Migration 20261005130000 · Any other change to bank details is emailed to
--                            Gisela and Payroll too (§2.10, §8 E5;
--                            ADR-0089, THC 05.10.2026)
--
-- THC: "Any changes in bank details of existing staff should be immediately
-- emailed to both Gisela and Payroll."
--
-- A worker's own change already is. staff_save_bank() (the Staff App's
-- Payment information, and onboarding's step 9 through onboarding_save_bank)
-- queues E5 to gisela@thehospitalitycompany.co.uk and
-- thc_payroll@topsourceworldwide.com in the same transaction as the write,
-- and the outbox drain runs every minute. The gap was every OTHER way a
-- bank_details row can change: an office login holding the finance
-- permission may write the table directly (admin_all, 571), and so may the
-- service role. Those changes were silent — payroll could be paying into an
-- account it was never told about, which is exactly what E5 exists to stop.
--
-- So a trigger on bank_details queues E5b — "changed outside the Staff App" —
-- to the same two addresses for ANY insert or real change (holder, sort code
-- or account number) that did not come through staff_save_bank. It names the
-- worker, their Employee ID, when, and WHO (the office login's name, or "the
-- system"), and never carries a sort code or an account number: the
-- details stay in the platform, not in an inbox.
--
-- staff_save_bank() tells the trigger it has queued E5 itself (a
-- transaction-local flag), so one change is one email, never two. A write
-- that changes nothing sends nothing. The GDPR removal's delete is not a
-- change and sends nothing (the trigger is insert/update only).
--
-- Restated: staff_save_bank from 20260930120200, with one added line.
-- Forward-only.
-- =====================================================================

create or replace function public.staff_save_bank(
  p_account_holder text,
  p_sort_code      text,
  p_account_number text
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_id uuid := staff_caller();
  s staff;
  v_holder text := nullif(btrim(p_account_holder), '');
  v_sort   text := regexp_replace(coalesce(p_sort_code, ''), '[^0-9]', '', 'g');
  v_acct   text := regexp_replace(coalesce(p_account_number, ''), '[^0-9]', '', 'g');
begin
  if v_id is null then
    raise exception 'unknown_staff' using errcode = 'P0001';
  end if;
  if v_holder is null then
    raise exception 'holder_required' using errcode = 'P0001';
  end if;
  if length(v_sort) <> 6 then
    raise exception 'bad_sort_code' using errcode = 'P0001';
  end if;
  if length(v_acct) <> 8 then
    raise exception 'bad_account_number' using errcode = 'P0001';
  end if;

  select * into s from staff where id = v_id;

  -- ADR-0089: this function queues E5 itself, so the bank_details trigger
  -- (which catches every OTHER write) stands down for this transaction.
  perform set_config('thc.bank_write', 'rpc', true);

  insert into bank_details (staff_id, account_holder, sort_code, account_number, updated_at)
  values (v_id, v_holder,
          substr(v_sort,1,2) || '-' || substr(v_sort,3,2) || '-' || substr(v_sort,5,2),
          v_acct, now())
  on conflict (staff_id) do update
    set account_holder = excluded.account_holder,
        sort_code      = excluded.sort_code,
        account_number = excluded.account_number,
        updated_at     = excluded.updated_at;
  -- Only this one statement is the RPC's: a later direct write in the same
  -- transaction is somebody else's and must be emailed.
  perform set_config('thc.bank_write', '', true);

  -- One E5 per save (§2.10). clock_timestamp() advances inside a
  -- transaction and the key carries microseconds, so two saves — even two
  -- in one second, or one transaction — are two emails.
  insert into notification_outbox (key, channel, template, recipient_emails, payload)
  values ('E5:staff:' || v_id || ':' || (extract(epoch from clock_timestamp()) * 1000000)::bigint,
          'email', 'E5',
          array['gisela@thehospitalitycompany.co.uk', 'thc_payroll@topsourceworldwide.com'],
          jsonb_build_object(
            'name',       s.first_name || ' ' || s.last_name,
            'employeeId', coalesce(s.employee_id::text, '(not yet issued)'),
            'changedAt',  to_char(now() at time zone 'Europe/London', 'DD Mon YYYY HH24:MI')))
  on conflict (key) do nothing;

  return jsonb_build_object('ok', true);
end $$;

create or replace function public.bank_details_notify_change()
returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare
  s staff;
  v_by text;
begin
  -- staff_save_bank() queued E5 for this write.
  if current_setting('thc.bank_write', true) = 'rpc' then
    return new;
  end if;
  -- An update that changes nothing the payroll pays into is not a change.
  if tg_op = 'UPDATE'
     and (old.account_holder, old.sort_code, old.account_number)
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
  'ADR-0089: queues E5b to Gisela and Payroll for any insert or real change to bank_details that did not come through staff_save_bank() (which queues E5 itself): an office login with finance, the service role. Names the worker and who, never the sort code or account number.';

revoke execute on function public.bank_details_notify_change() from public, anon, authenticated;

drop trigger if exists bank_details_notify_change on public.bank_details;
create trigger bank_details_notify_change
  after insert or update on public.bank_details
  for each row execute function public.bank_details_notify_change();

comment on function public.staff_save_bank(text, text, text) is
  '§2.10/§10.1: the ONLY worker write path to bank_details (the direct self insert/update policies were dropped in 20260927120100). Validates sort code and account number and queues E5 to payroll in the same transaction, one E5 per save (microsecond key, 20260930120200). Tells bank_details_notify_change() (ADR-0089) that E5 is queued, so any other write queues E5b instead.';

revoke execute on function public.staff_save_bank(text, text, text) from public, anon;
grant  execute on function public.staff_save_bank(text, text, text) to authenticated;
