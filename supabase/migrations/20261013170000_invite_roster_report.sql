-- =====================================================================
-- Migration 20261013170000 · /staff/roster: the reminder report, and a
--                            Link for people who applied under another
--                            email (ADR-0123; owner request, 13.10.2026)
--
-- 1. invite_roster_report() — what the invite list page draws above the
--    list: who has not applied, who applied from the list, the IR1 daily
--    reminders (ADR-0122) sent, failed and still queued, a 14-day series,
--    per-person "reminded N times, last on …, last failure", and the
--    possible matches below. Office only (any office login, the viewer
--    included: it reads, it changes nothing).
--
-- 2. Possible matches. The list is matched on email (ADR-0107), so
--    somebody who applied with a DIFFERENT address is never matched: their
--    row stays, they keep getting IR1, and they get neither their group
--    nor their Payroll ID. Eight people on 13.10. A row is shown as a
--    possible match when a live staff record, with no Payroll ID and not
--    itself on the list, has the same first name and the same last word of
--    the surname (payroll_name_key, the key ADR-0076 matches payroll on).
--    A suggestion only: the office decides.
--
-- 3. link_invite_roster_entry(p_entry, p_staff) — the office's "Link":
--    applies the row to that person exactly as loading the list applies it
--    to somebody already here (load_invite_roster, 20261008140000): the
--    Payroll ID (and a numeric one as the Employee ID where the system
--    issued theirs), SpudBros marking unless it would strand an upcoming
--    shift. Then the row is consumed, so the reminders stop. Owner and
--    manager only, like every Payroll ID write. The names must agree
--    (payroll_names_compatible), so a slip of the mouse cannot move a
--    Payroll ID onto the wrong person.
--
-- 4. set_invite_roster_reminders(p_enabled) — the page's On/Off for the
--    daily reminder (settings.invite_roster_reminders.enabled). Off also
--    cancels the reminders already queued and not yet sent (they are paced
--    over half an hour), so it stops at once. Any office login that may
--    write; audited. The /settings → Notifications switch for IR1
--    (ADR-0083) still stops the sending as well; the report says which.
--
-- pgTAP: supabase/tests/812_invite_roster_report.sql.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1 · Possible matches (internal)
-- ---------------------------------------------------------------------
create or replace function public.invite_roster_possible_matches()
returns table (
  entry_id    uuid,
  entry_email text,
  staff_id    uuid,
  staff_name  text,
  staff_email text,
  staff_status text,
  applied_at  timestamptz
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  with r as (
    select ir.id, ir.email, payroll_name_key(ir.first_name, ir.last_name) as k
      from invite_roster ir
     where not exists (select 1 from staff s
                        where lower(btrim(s.email)) = ir.email and s.removed_at is null)
  ), s as (
    select st.id, st.first_name, st.last_name, st.email, st.status, st.created_at,
           payroll_name_key(st.first_name, st.last_name) as k
      from staff st
     where st.removed_at is null
       and st.payroll_id is null
       and not exists (select 1 from invite_roster ir where ir.email = lower(btrim(st.email)))
  )
  select r.id, r.email, s.id,
         btrim(coalesce(s.first_name, '') || ' ' || coalesce(s.last_name, '')),
         s.email, s.status::text, s.created_at
    from r
    join s on split_part(s.k, ' ', 1) = split_part(r.k, ' ', 1)
          and regexp_replace(s.k, '^.* ', '') = regexp_replace(r.k, '^.* ', '')
   where r.k is not null and s.k is not null
     -- Two words at least on each side, so "Amrita" alone matches nobody.
     and position(' ' in r.k) > 0 and position(' ' in s.k) > 0
$$;

comment on function public.invite_roster_possible_matches() is
  'ADR-0123: invite-list rows nobody has applied for by email, each with any live staff record (no Payroll ID, not itself on the list) of the same first name and last word of the surname — people who probably applied under another address. Internal: read through invite_roster_report().';

revoke all on function public.invite_roster_possible_matches() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 2 · The report
-- ---------------------------------------------------------------------
create or replace function public.invite_roster_report(p_now timestamptz default now())
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_today date := uk_local(p_now)::date;
  v_cfg   jsonb := invite_roster_reminder_config();
  v_out   jsonb;
begin
  perform assert_office_caller();

  with held as (
    select ir.*, exists (select 1 from staff s
                          where lower(btrim(s.email)) = ir.email and s.removed_at is null) as applied
      from invite_roster ir
  ), ir1 as (
    select o.recipient_emails[1] as email, o.sent_at, o.failed_at, o.error, o.queued_at,
           uk_local(coalesce(o.sent_at, o.failed_at, o.queued_at))::date as day
      from notification_outbox o
     where o.template = 'IR1'
  ), per_email as (
    select email,
           count(*) filter (where sent_at is not null)                     as sent,
           max(sent_at)                                                     as last_sent_at,
           min(sent_at)                                                     as first_sent_at,
           (array_agg(error order by failed_at desc) filter (where failed_at is not null))[1] as last_error,
           max(failed_at)                                                   as last_failed_at
      from ir1 group by email
  ), matched as (
    select count(distinct a.entity_id) as n
      from audit_log a
     where (a.action = 'roster.matched' and a.data ->> 'via' in ('list', 'list_over_link', 'list_name_mismatch'))
        or a.action = 'roster.linked'
  )
  select jsonb_build_object(
    'today', v_today,
    'settings', jsonb_build_object(
      'enabled', coalesce((v_cfg ->> 'enabled')::boolean, true),
      'switchOn', notification_switched_on('IR1'),
      'from', v_cfg ->> 'from', 'until', v_cfg ->> 'until'),
    'kpis', jsonb_build_object(
      'notAppliedThc',      (select count(*) from held where grp = 'thc' and not applied),
      'notAppliedSpudbros', (select count(*) from held where grp = 'spudbros' and not applied),
      'appliedKept',        (select count(*) from held where applied),
      'appliedFromList',    (select n from matched),
      'possibleMatches',    (select count(distinct entry_id) from invite_roster_possible_matches()),
      'sentToday',          (select count(*) from ir1 where sent_at is not null and day = v_today),
      'sentTotal',          (select count(*) from ir1 where sent_at is not null),
      'failedTotal',        (select count(*) from ir1 where failed_at is not null),
      'failedToday',        (select count(*) from ir1 where failed_at is not null and day = v_today),
      'queued',             (select count(*) from ir1 where sent_at is null and failed_at is null),
      'peopleReminded',     (select count(*) from per_email where sent > 0),
      'appliedAfterReminder', (select count(*) from per_email pe
                                where pe.first_sent_at is not null
                                  and exists (select 1 from staff s
                                               where lower(btrim(s.email)) = pe.email
                                                 and s.removed_at is null
                                                 and s.created_at > pe.first_sent_at)),
      'lastSentAt',         (select max(sent_at) from ir1)),
    'daily', (select coalesce(jsonb_agg(jsonb_build_object(
                       'day', d::date,
                       'sent',   (select count(*) from ir1 where sent_at is not null and ir1.day = d::date),
                       'failed', (select count(*) from ir1 where failed_at is not null and ir1.day = d::date))
                     order by d), '[]'::jsonb)
                from generate_series(v_today - 13, v_today, interval '1 day') d),
    'reminders', (select coalesce(jsonb_object_agg(pe.email, jsonb_build_object(
                           'sent', pe.sent, 'lastSentAt', pe.last_sent_at,
                           'lastError', case when pe.last_failed_at > coalesce(pe.last_sent_at, '-infinity')
                                             then left(pe.last_error, 160) end)), '{}'::jsonb)
                    from per_email pe
                    where pe.email in (select email from invite_roster)),
    'applied', (select coalesce(jsonb_agg(h.id), '[]'::jsonb) from held h where h.applied),
    'matches', (select coalesce(jsonb_agg(jsonb_build_object(
                         'entryId', m.entry_id, 'staffId', m.staff_id, 'staffName', m.staff_name,
                         'staffEmail', m.staff_email, 'status', m.staff_status,
                         'appliedAt', m.applied_at) order by m.applied_at), '[]'::jsonb)
                  from invite_roster_possible_matches() m)
  ) into v_out;

  return v_out;
end $$;

comment on function public.invite_roster_report(timestamptz) is
  'ADR-0123, /staff/roster: KPIs (not applied by group, applied from the list, rows kept after applying, possible matches; IR1 sent today/total, failed, queued, people reminded, applied after a reminder, last sent), a 14-day sent/failed series, per-email reminder counts and last failure, the ids of rows whose person has applied, and possible matches. Office logins only.';

revoke all on function public.invite_roster_report(timestamptz) from public, anon;
grant execute on function public.invite_roster_report(timestamptz) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 3 · Link a list row to the person who applied under another email
-- ---------------------------------------------------------------------
create or replace function public.link_invite_roster_entry(p_entry uuid, p_staff uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  r       invite_roster;
  s       staff;
  v_code  int;
  v_group text;
  v_spud  text := 'unchanged';
begin
  perform assert_office_caller();
  perform assert_not_read_only();
  -- A Payroll ID is the key the pay is filed under (ADR-0076, ADR-0107).
  perform assert_finance_caller();

  select * into r from invite_roster where id = p_entry for update;
  if not found then
    raise exception 'unknown_entry' using errcode = 'P0001';
  end if;
  select * into s from staff where id = p_staff for update;
  if not found or s.removed_at is not null then
    raise exception 'unknown_staff' using errcode = 'P0001';
  end if;
  if not payroll_names_compatible(s.first_name, s.last_name, r.first_name, r.last_name)
     or payroll_name_key(r.first_name, r.last_name) is null then
    raise exception 'name_mismatch' using errcode = 'P0001';
  end if;
  if r.payroll_id is not null
     and exists (select 1 from staff o where o.payroll_id = r.payroll_id and o.id <> s.id) then
    raise exception 'payroll_id_taken' using errcode = 'P0001';
  end if;
  if s.payroll_id is not null and s.payroll_id is distinct from r.payroll_id then
    raise exception 'has_other_payroll_id' using errcode = 'P0001';
  end if;

  -- What load_invite_roster() does for somebody already here (20261008140000).
  if r.payroll_id is not null and s.payroll_id is distinct from r.payroll_id then
    update staff set payroll_id = r.payroll_id where id = s.id;
    if r.payroll_id ~ '^[0-9]{1,5}$' then
      v_code := r.payroll_id::int;
      if v_code between 1 and 10000
         and (s.employee_id is null or s.employee_id >= 10001)
         and not exists (select 1 from staff o where o.employee_id = v_code) then
        update staff set employee_id = v_code where id = s.id;
        delete from payroll_codes where code = v_code;
        insert into audit_log (actor, action, entity, entity_id, data)
        values (auth.uid(), 'employee_id_from_payroll', 'staff', s.id,
                jsonb_build_object('employeeId', v_code, 'replaced', s.employee_id,
                                   'when', 'invite_list_link'));
      end if;
    end if;
  end if;

  v_group := r.grp;
  if v_group = 'spudbros' and not s.spudbros_express then
    if exists (select 1 from bookings b join shift_requirements sr on sr.id = b.shift_id
                where b.staff_id = s.id
                  and b.status in ('invited', 'applied', 'confirmed')
                  and sr.ends_at + interval '4 hours' > now()) then
      v_spud := 'held_upcoming_shifts';
    else
      update staff set spudbros_express = true, thc_shifts_enabled = false where id = s.id;
      v_spud := 'marked';
    end if;
  elsif v_group = 'thc' and s.spudbros_express then
    v_spud := 'kept_spudbros';
  end if;

  delete from invite_roster where id = r.id;

  insert into audit_log (actor, action, entity, entity_id, data)
  values (auth.uid(), 'roster.linked', 'staff', s.id,
          jsonb_build_object('staffId', s.id::text, 'group', v_group, 'payrollId', r.payroll_id,
                             'listEmail', r.email, 'appliedEmail', s.email,
                             'previousPayrollId', s.payroll_id, 'spudbros', v_spud));

  return jsonb_build_object('payrollId', r.payroll_id, 'group', v_group, 'spudbros', v_spud);
end $$;

comment on function public.link_invite_roster_entry(uuid, uuid) is
  'ADR-0123: the office links an invite-list row to the person who applied under another email — applies the Payroll ID (numeric → Employee ID where system-issued) and SpudBros marking as load_invite_roster does for somebody already here, consumes the row (the IR1 reminders stop) and audits roster.linked. Names must agree. Owner and manager only.';

revoke all on function public.link_invite_roster_entry(uuid, uuid) from public, anon;
grant execute on function public.link_invite_roster_entry(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 4 · The page's On/Off
-- ---------------------------------------------------------------------
create or replace function public.set_invite_roster_reminders(p_enabled boolean)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_cancelled int := 0;
begin
  perform assert_office_caller();
  perform assert_not_read_only();
  if p_enabled is null then
    raise exception 'enabled_required' using errcode = '22023';
  end if;

  insert into settings (key, value)
  values ('invite_roster_reminders', jsonb_build_object('enabled', p_enabled))
  on conflict (key) do update
    set value = (case when jsonb_typeof(settings.value) = 'object' then settings.value else '{}'::jsonb end)
                || jsonb_build_object('enabled', p_enabled),
        updated_at = now();

  -- Off stops today's too: the queued rows are paced over ~30 minutes.
  if not p_enabled then
    update notification_outbox
       set failed_at = now(), error = 'not sent: the daily reminder was switched off on /staff/roster'
     where template = 'IR1' and sent_at is null and failed_at is null;
    get diagnostics v_cancelled = row_count;
  end if;

  insert into audit_log (actor, action, entity, entity_id, data)
  values (auth.uid(), 'settings.invite_roster_reminders', 'settings', null,
          jsonb_build_object('enabled', p_enabled, 'cancelled', v_cancelled));

  return jsonb_build_object('enabled', p_enabled, 'cancelled', v_cancelled);
end $$;

comment on function public.set_invite_roster_reminders(boolean) is
  'ADR-0123: /staff/roster turns the daily IR1 reminder on or off (settings.invite_roster_reminders.enabled); off also cancels the IR1 rows queued and not yet sent. Office logins that may write; audited.';

revoke all on function public.set_invite_roster_reminders(boolean) from public, anon;
grant execute on function public.set_invite_roster_reminders(boolean) to authenticated;
