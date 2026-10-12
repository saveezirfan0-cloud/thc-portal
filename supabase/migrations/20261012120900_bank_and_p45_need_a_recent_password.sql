-- =====================================================================
-- Migration 20261012120900 · bank details and a P45 need the password
--                            typed in the last ten minutes (§2.10, §10.6)
--
-- staff_save_bank() (latest 20261008150000) and request_my_p45()
-- (20260922180000) trusted any live Staff App session. A phone left
-- unlocked, or a session cookie lifted from it, was therefore enough to
-- point a worker's pay at another account (E5 tells payroll a change
-- happened, not that it was wrong) or to end their employment with a P45
-- request. Staff App audit 12.10.2026, MEDIUM.
--
-- recent_password_auth(p_seconds int default 600) reads the token's `amr`
-- claim — GoTrue's list of {method, timestamp} for how this session was
-- authenticated — and is true when a `password`, `otp` or `recovery`
-- entry is no older than p_seconds. A fresh signInWithPassword mints a new
-- session whose amr carries `password` at that moment; a refreshed token
-- keeps the original timestamp, so an old session does not pass by being
-- refreshed. `invite` / `magiclink` (the activation link) do not count:
-- they prove the inbox, not the person holding the phone.
--
-- Both RPCs now raise P0001 with the message exactly 'reauth_required'
-- (the repo's convention for an app-mapped refusal) when it is false,
-- after the unknown_staff check and before anything else. The Staff App
-- re-signs-in with the current password immediately before calling.
-- This applies to the onboarding bank step (BankStep → staff_save_bank)
-- as much as to Profile → Payment.
--
-- Not done here, deliberately: a copy of E5 to the WORKER. §8's E5 is
-- addressed to Gisela and Payroll and its register copy is written for
-- them ("A worker has updated their bank & payroll details"); a
-- worker-facing notice would be new copy outside the scope register, so
-- it is THC's to word (reported for the owner; not invented here).
--
-- request_my_p45() also resolves the worker through staff_caller() now
-- (20261012120400: a live session, an unbanned login). Grants are kept by
-- create or replace. 795_bank_and_p45_need_a_recent_password pins it; the
-- earlier files that save bank details or ask for a P45 as a worker
-- carry an `amr` claim in their fixtures.
-- =====================================================================

create or replace function public.recent_password_auth(p_seconds int default 600)
returns boolean
language sql
stable
set search_path = public
as $$
  select coalesce((
    select true
      from jsonb_array_elements(
             case when jsonb_typeof(auth.jwt() -> 'amr') = 'array'
                  then auth.jwt() -> 'amr' else '[]'::jsonb end) e
     where e ->> 'method' in ('password', 'otp', 'recovery')
       and (e ->> 'timestamp') ~ '^[0-9]{1,12}(\.[0-9]+)?$'
       and (e ->> 'timestamp')::numeric >= extract(epoch from now()) - greatest(coalesce(p_seconds, 600), 0)
     limit 1), false)
$$;

comment on function public.recent_password_auth(int) is
  '20261012120900: true when the request token''s amr claim has a password, otp or recovery entry no older than p_seconds (default 600). staff_save_bank() and request_my_p45() refuse with reauth_required otherwise.';

revoke execute on function public.recent_password_auth(int) from public, anon;
grant  execute on function public.recent_password_auth(int) to authenticated, service_role;

create or replace function public.staff_save_bank(p_account_holder text, p_sort_code text, p_account_number text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
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
  -- 20261012120900: the password was typed in the last ten minutes.
  if not recent_password_auth(600) then
    raise exception 'reauth_required' using errcode = 'P0001',
      hint = 'Sign in again with the current password, then save the bank details.';
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
end $function$;

create or replace function public.request_my_p45(p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare v_id uuid := staff_caller();
begin
  if v_id is null then
    raise exception 'unknown_staff' using errcode = 'P0001';
  end if;
  -- 20261012120900: the password was typed in the last ten minutes.
  if not recent_password_auth(600) then
    raise exception 'reauth_required' using errcode = 'P0001',
      hint = 'Sign in again with the current password, then ask for the P45.';
  end if;
  return request_p45(v_id, nullif(btrim(coalesce(p_reason, '')), ''), now());
end $$;
