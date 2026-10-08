-- =====================================================================
-- Migration 20261007140000 · E5 is for a change to EXISTING bank details
--                            (§2.10, §8 E5; ADR-0105, THC 07.10.2026)
--
-- THC: the "Bank & payroll details updated" email should only be sent when a
-- staff member updates their existing bank details.
--
-- staff_save_bank() queued E5 on every save, including a candidate's first
-- entry at onboarding step 9 — the email arrived as "Employee ID (not yet
-- issued)", about someone who is not staff yet and has nothing to change.
--
-- E5 is now queued only when ALL of these hold:
--   1. a bank_details row already existed for this worker (not a first entry);
--   2. the holder, sort code or account number actually differ (re-saving the
--      same details is not an update);
--   3. the worker already has an Employee ID, i.e. is Staff (issued when the
--      contract is signed, §2.7) — a candidate still correcting step 9 is not.
-- The write itself is unchanged and still validated. E5b (a change by the
-- office or the service role, ADR-0092) is untouched: staff_save_bank() still
-- tells that trigger it has handled this write, so a suppressed E5 does not
-- turn into an E5b.
--
-- Restated: staff_save_bank from 20261005140500, with the prior row read and
-- the outbox insert guarded. Forward-only.
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
  v_sort_fmt text;
  v_prev   bank_details;
  v_changed boolean;
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
  v_sort_fmt := substr(v_sort,1,2) || '-' || substr(v_sort,3,2) || '-' || substr(v_sort,5,2);

  -- What was on file BEFORE this save; not found = a first entry.
  select * into v_prev from bank_details where staff_id = v_id;
  v_changed := found
    and (v_prev.account_holder, v_prev.sort_code, v_prev.account_number)
        is distinct from (v_holder, v_sort_fmt, v_acct);

  -- ADR-0092: this function owns the notification decision for its own
  -- write, so the bank_details trigger (which catches every OTHER write)
  -- stands down for this transaction.
  perform set_config('thc.bank_write', 'rpc', true);

  insert into bank_details (staff_id, account_holder, sort_code, account_number, updated_at)
  values (v_id, v_holder, v_sort_fmt, v_acct, now())
  on conflict (staff_id) do update
    set account_holder = excluded.account_holder,
        sort_code      = excluded.sort_code,
        account_number = excluded.account_number,
        updated_at     = excluded.updated_at;
  -- Only this one statement is the RPC's: a later direct write in the same
  -- transaction is somebody else's and must be emailed.
  perform set_config('thc.bank_write', '', true);

  -- ADR-0105: E5 only for a real change to existing details, by someone who
  -- is already Staff. One E5 per such save (§2.10); clock_timestamp()
  -- advances inside a transaction and the key carries microseconds, so two
  -- saves — even in one second, or one transaction — are two emails.
  if v_changed and s.employee_id is not null then
    insert into notification_outbox (key, channel, template, recipient_emails, payload)
    values ('E5:staff:' || v_id || ':' || (extract(epoch from clock_timestamp()) * 1000000)::bigint,
            'email', 'E5',
            array['gisela@thehospitalitycompany.co.uk', 'thc_payroll@topsourceworldwide.com'],
            jsonb_build_object(
              'name',       s.first_name || ' ' || s.last_name,
              'employeeId', s.employee_id::text,
              'changedAt',  to_char(now() at time zone 'Europe/London', 'DD Mon YYYY HH24:MI')))
    on conflict (key) do nothing;
  end if;

  return jsonb_build_object('ok', true);
end $$;

comment on function public.staff_save_bank(text, text, text) is
  '§2.10/§10.1: the ONLY worker write path to bank_details. Validates sort code and account number. Queues E5 to Gisela and Payroll only when existing details actually changed and the worker already has an Employee ID (ADR-0105): a first entry at onboarding, or a re-save of the same details, sends nothing. One E5 per changing save (microsecond key). Tells bank_details_notify_change() (ADR-0092) it owns the decision, so no write is emailed twice.';

revoke execute on function public.staff_save_bank(text, text, text) from public, anon;
grant  execute on function public.staff_save_bank(text, text, text) to authenticated;
