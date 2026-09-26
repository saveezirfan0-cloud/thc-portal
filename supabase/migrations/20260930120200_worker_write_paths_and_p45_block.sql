-- =====================================================================
-- Migration 20260930120200 · worker write paths close behind their RPCs,
--                            and a manual block survives Request my P45
--                            (audit 25.09 D51, D52)
--
-- 1 · request_p45 refuses a manually blocked worker (§10.1 app lock case
--     2, §4.3, §10.6). block_worker(…, 'inactive', 'left') nulls
--     block_kind and block_reason, so a worker on a manager's block could
--     call request_my_p45() through the API — the app shows them only
--     "Your account is on hold" — and walk out of the block with the
--     reason erased. §10.1: "Only a manager pressing Unblock lifts it."
--     Refused with `blocked_manual`; the Staff App maps it to the on-hold
--     sentence. The office can still retire the worker (Reset / Remove).
--
-- 2 · staff_references and push_subscriptions lose their worker write
--     policies, as bank_details did in 20260927120100. The app writes both
--     through definer RPCs only — onboarding_save_references (two
--     referees, validated, stage-checked) and save_push_subscription /
--     forget_push_subscription — so the direct policies were only ever a
--     way round those checks. The worker keeps SELECT on their own rows.
--
-- 3 · staff_set_photo takes exactly `<own staff id>/<name>.jpg`, one
--     level deep, and only when that object exists in the `photos`
--     bucket. It checked the prefix only, so `<id>/../<other>/x.jpg` or a
--     path to nothing could become the locked avatar.
--
-- 4 · staff_save_bank's E5 key had one-second resolution; a second save
--     inside the same second hit `on conflict do nothing` and payroll was
--     never told about the second change (§2.10). Microseconds now, from
--     clock_timestamp().
--
-- 5 · submit_application is service-role only. Every deployment carries
--     SUPABASE_SERVICE_ROLE_KEY (docs/16 §env: set on all three projects,
--     Production and Preview), so /apply always goes through
--     submit_application_as_caller and its per-caller limit (ADR-0024).
--     The anon grant was the way round that limit; 20260926100200 said
--     the revoke would follow "once every deployment carries the key".
--     /apply without the key now refuses rather than falling back.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1 · request_p45, from 20260921192246, with the manual-block refusal
-- ---------------------------------------------------------------------
create or replace function public.request_p45(
  p_staff  uuid,
  p_reason text        default null,
  p_now    timestamptz default now()
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v staff;
  v_cascade jsonb;
  v_last date;
begin
  select * into v from staff where id = p_staff for update;
  if v.id is null then
    raise exception 'unknown_staff' using errcode = 'P0001';
  end if;
  if v.status = 'inactive' then
    -- Idempotent, as removal is: a double-submitted confirmation must not
    -- drift the recorded leaving date onto the retry.
    return jsonb_build_object('staffId', p_staff::text, 'alreadyInactive', true);
  end if;

  -- §10.1 lock case 2 / §4.3: a manager's block is lifted by a manager
  -- pressing Unblock, and by nothing the worker can do. Leaving would null
  -- block_kind and block_reason (block_worker below), so it is refused.
  if v.status = 'blocked' and v.block_kind = 'manual' then
    raise exception 'blocked_manual' using errcode = 'P0001';
  end if;

  if exists (
    select 1
      from bookings b
      join shift_requirements s on s.id = b.shift_id
      join check_logs cl        on cl.booking_id = b.id
     where b.staff_id = p_staff
       and b.cancelled_at is null
       and cl.check_in_at is not null
       and cl.check_out_at is null
       and p_now < s.ends_at + interval '4 hours'
  ) then
    raise exception 'on_shift' using errcode = 'P0001';
  end if;

  v_cascade := block_worker(p_staff, null, p_reason, p_now, 'inactive', 'left');

  select max(s.ends_at at time zone 'Europe/London')::date into v_last
    from bookings b join shift_requirements s on s.id = b.shift_id
   where b.staff_id = p_staff and b.status = 'worked';

  insert into notification_outbox (key, channel, template, recipient_emails, payload)
  values ('E8:staff:' || p_staff || ':' || extract(epoch from p_now)::bigint, 'email', 'E8',
          array['admin@thehospitalitycompany.co.uk'],
          jsonb_build_object(
            'name',          v.first_name || ' ' || v.last_name,
            'employeeId',    coalesce(v.employee_id::text, '(not yet issued)'),
            'niNumber',      coalesce(v.ni_number, '(not on file)'),
            'requestedAt',   to_char(p_now at time zone 'Europe/London', 'DD Mon YYYY HH24:MI'),
            'reason',        coalesce(nullif(p_reason, ''), '(none given)'),
            'lastShiftDate', coalesce(to_char(v_last, 'DD Mon YYYY'), '(none worked)'),
            -- Released confirmed shifts only. The withdrawn invitations
            -- carry cause 'left_invite' and are counted, not listed.
            'releasedShifts', released_shift_lines(p_staff, 'left', p_now)))
  on conflict (key) do nothing;

  return v_cascade || jsonb_build_object('lastShiftDate', v_last);
end $$;

comment on function public.request_p45(uuid, text, timestamptz) is
  '§10.6 Request my P45: status → inactive, future bookings released, invitations withdrawn, E8 to the office. Refuses `on_shift` while checked in and `blocked_manual` while a manager''s block stands (§10.1 lock case 2: only Unblock lifts it). Service role only; the worker reaches it through request_my_p45().';

revoke execute on function public.request_p45(uuid, text, timestamptz) from public, anon, authenticated;
grant  execute on function public.request_p45(uuid, text, timestamptz) to service_role;

-- ---------------------------------------------------------------------
-- 2 · Worker writes only through the RPCs
-- ---------------------------------------------------------------------
drop policy if exists staff_self_refs_insert on staff_references;
drop policy if exists staff_self_refs_update on staff_references;

drop policy if exists staff_self_push on push_subscriptions;
create policy staff_self_push on push_subscriptions for select
  using (staff_id = (select id from staff where user_id = (select auth.uid())));

comment on policy staff_self_push on push_subscriptions is
  'The worker reads their own device subscriptions. Writes go through save_push_subscription() / forget_push_subscription() only (20260930120200).';

-- ---------------------------------------------------------------------
-- 3 · staff_set_photo, from 20260922180000, with the exact path and the
--     object required
-- ---------------------------------------------------------------------
create or replace function public.staff_set_photo(p_path text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_id uuid := staff_caller();
  s staff;
begin
  if v_id is null then
    raise exception 'unknown_staff' using errcode = 'P0001';
  end if;
  -- `<own staff id>/<name>.jpg`: one level under the worker's own folder,
  -- a plain file name, no `..`, and the extension the app writes
  -- (apps/staff/app/profile/photos.ts photoPathFor).
  if p_path is null
     or p_path !~ ('^' || v_id::text || '/[A-Za-z0-9][A-Za-z0-9_-]*(\.[A-Za-z0-9_-]+)*\.jpg$')
     or length(p_path) > 200 then
    raise exception 'wrong_path' using errcode = 'P0001';
  end if;
  -- And the object is really there: an avatar that points at nothing
  -- would be locked (§10.1) with no picture behind it.
  if not exists (select 1 from storage.objects o
                  where o.bucket_id = 'photos' and o.name = p_path) then
    raise exception 'wrong_path' using errcode = 'P0001';
  end if;

  select * into s from staff where id = v_id for update;
  if s.photo_path is not null then
    -- §10.1: locked after onboarding. Changing it goes through the office.
    raise exception 'photo_locked' using errcode = 'P0001';
  end if;

  update staff set photo_path = p_path where id = v_id;
  return jsonb_build_object('ok', true, 'photoPath', p_path);
end $$;

comment on function public.staff_set_photo(text) is
  '§10.1 set the avatar once: exactly `<own staff id>/<name>.jpg`, and only when that object exists in the photos bucket. Refuses `wrong_path` otherwise and `photo_locked` once a photo is set.';

revoke execute on function public.staff_set_photo(text) from public, anon;
grant  execute on function public.staff_set_photo(text) to authenticated;

-- ---------------------------------------------------------------------
-- 4 · staff_save_bank, from 20260922180000, with a microsecond E5 key
-- ---------------------------------------------------------------------
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

  insert into bank_details (staff_id, account_holder, sort_code, account_number, updated_at)
  values (v_id, v_holder,
          substr(v_sort,1,2) || '-' || substr(v_sort,3,2) || '-' || substr(v_sort,5,2),
          v_acct, now())
  on conflict (staff_id) do update
    set account_holder = excluded.account_holder,
        sort_code      = excluded.sort_code,
        account_number = excluded.account_number,
        updated_at     = excluded.updated_at;

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

comment on function public.staff_save_bank(text, text, text) is
  '§2.10/§10.1: the ONLY worker write path to bank_details (the direct self insert/update policies were dropped in 20260927120100). Validates sort code and account number and queues E5 to payroll in the same transaction, one E5 per save (microsecond key, 20260930120200).';

revoke execute on function public.staff_save_bank(text, text, text) from public, anon;
grant  execute on function public.staff_save_bank(text, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- 5 · submit_application: service role only (ADR-0024)
-- ---------------------------------------------------------------------
revoke execute on function public.submit_application(text, text, text, text, date, boolean)
  from public, anon, authenticated;
grant execute on function public.submit_application(text, text, text, text, date, boolean)
  to service_role;

comment on function public.submit_application(text, text, text, text, date, boolean) is
  '§2.1 /apply: validation, the 18+ gate, the §2.12 duplicate check and the write. Service role only since 20260930120200: the Staff App calls it through submit_application_as_caller(), which adds the per-caller limit (ADR-0024), and anon no longer reaches it past that limit.';
