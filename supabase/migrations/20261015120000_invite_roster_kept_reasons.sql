-- =====================================================================
-- /staff/roster: why an applicant has no Payroll ID yet, and Link for them
-- (ADR-0143; owner request, 15.10.2026)
--
-- "Applied · no Payroll ID" is a list row whose person applied WITH the
-- listed email, but whose Payroll ID was held back (ADR-0107). The page said
-- so and nothing more: the office had to open /activity to learn why, then
-- set the ID on the profile and Remove the row by hand.
--
-- 1. invite_roster_kept() — for every such row, the person who applied and
--    the reason, first that fits:
--      payroll_id_taken  another person already holds the sheet's Payroll ID
--                        (holder named); an ID is never given to two people;
--      other_payroll_id  the applicant already carries a different Payroll ID;
--      name_differs      the app's name and the sheet's do not agree
--                        (payroll_names_compatible: first name and last word
--                        of the surname);
--      already_has       the applicant already carries this Payroll ID: the
--                        row is only left over;
--      no_payroll_id     the sheet gives no Payroll ID for them;
--      not_applied       none of those: the ID was simply never applied.
--
-- 2. invite_roster_report() gains `kept`: those rows, for the page's reason
--    text, its Reason filter and its Link. Otherwise restated unchanged
--    from 20261013170000.
--
-- 3. link_invite_roster_entry(p_entry, p_staff, p_confirm_name) — Link now
--    also serves these rows, and takes a third argument: true when the
--    office has seen both names and confirms they are the same person, which
--    lifts the name check and nothing else. A Payroll ID somebody else holds,
--    or a different one the applicant already has, is still refused: one of
--    the two records is wrong, and the office decides which on the profile.
--    The audit row records both names and whether the name was confirmed.
--    Otherwise unchanged from 20261013170000; the two-argument call still
--    works (the third defaults to false).
--
-- pgTAP: supabase/tests/842_invite_roster_kept.sql.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1 · Why each applied row has no Payroll ID (internal)
-- ---------------------------------------------------------------------
create or replace function public.invite_roster_kept()
returns table (
  entry_id         uuid,
  staff_id         uuid,
  staff_name       text,
  staff_email      text,
  staff_status     text,
  staff_payroll_id text,
  reason           text,
  holder_id        uuid,
  holder_name      text
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  select r.id, s.id,
         btrim(coalesce(s.first_name, '') || ' ' || coalesce(s.last_name, '')),
         s.email, s.status::text, s.payroll_id,
         case
           when h.id is not null                                         then 'payroll_id_taken'
           when s.payroll_id is not null and r.payroll_id is not null
                and s.payroll_id <> r.payroll_id                         then 'other_payroll_id'
           when not payroll_names_compatible(s.first_name, s.last_name, r.first_name, r.last_name)
                or payroll_name_key(r.first_name, r.last_name) is null   then 'name_differs'
           when r.payroll_id is not null and s.payroll_id = r.payroll_id then 'already_has'
           when r.payroll_id is null                                     then 'no_payroll_id'
           else 'not_applied'
         end,
         h.id,
         case when h.id is not null
              then btrim(coalesce(h.first_name, '') || ' ' || coalesce(h.last_name, '')) end
    from invite_roster r
    cross join lateral (
      select st.* from staff st
       where lower(btrim(st.email)) = r.email and st.removed_at is null
       order by st.created_at desc
       limit 1
    ) s
    -- link_invite_roster_entry()'s own test: anybody else on that ID.
    left join lateral (
      select o.id, o.first_name, o.last_name from staff o
       where r.payroll_id is not null and o.payroll_id = r.payroll_id and o.id <> s.id
       order by o.removed_at nulls first
       limit 1
    ) h on true
$$;

comment on function public.invite_roster_kept() is
  'ADR-0143: each invite-list row whose person has applied with the listed email (kept, no Payroll ID given), with the applicant and why: payroll_id_taken (holder named), other_payroll_id, name_differs, already_has, no_payroll_id, not_applied. Internal: read through invite_roster_report().';

revoke all on function public.invite_roster_kept() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 2 · The report gains `kept`
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
    -- Why each of those has no Payroll ID yet, and who applied (20261015120000).
    'kept', (select coalesce(jsonb_agg(jsonb_build_object(
                      'entryId', k.entry_id, 'staffId', k.staff_id, 'staffName', k.staff_name,
                      'staffEmail', k.staff_email, 'status', k.staff_status,
                      'staffPayrollId', k.staff_payroll_id, 'reason', k.reason,
                      'holderId', k.holder_id, 'holderName', k.holder_name)), '[]'::jsonb)
               from invite_roster_kept() k),
    'matches', (select coalesce(jsonb_agg(jsonb_build_object(
                         'entryId', m.entry_id, 'staffId', m.staff_id, 'staffName', m.staff_name,
                         'staffEmail', m.staff_email, 'status', m.staff_status,
                         'appliedAt', m.applied_at) order by m.applied_at), '[]'::jsonb)
                  from invite_roster_possible_matches() m)
  ) into v_out;

  return v_out;
end $$;

comment on function public.invite_roster_report(timestamptz) is
  'ADR-0123, /staff/roster: KPIs (not applied by group, applied from the list, rows kept after applying, possible matches; IR1 sent today/total, failed, queued, people reminded, applied after a reminder, last sent), a 14-day sent/failed series, per-email reminder counts and last failure, the ids of rows whose person has applied, why each has no Payroll ID (kept, ADR-0143), and possible matches. Office logins only.';

revoke all on function public.invite_roster_report(timestamptz) from public, anon;
grant execute on function public.invite_roster_report(timestamptz) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 3 · Link, with the office's word that the names are the same person
-- ---------------------------------------------------------------------
-- A new argument is a new signature: the old one goes, so a two-argument
-- call resolves to this one through the default.
drop function if exists public.link_invite_roster_entry(uuid, uuid);

create or replace function public.link_invite_roster_entry(
  p_entry        uuid,
  p_staff        uuid,
  p_confirm_name boolean default false
)
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
  -- The names must agree, unless the office has looked at both and says
  -- they are the same person (a nickname, a typo, a missing accent).
  if not coalesce(p_confirm_name, false)
     and (not payroll_names_compatible(s.first_name, s.last_name, r.first_name, r.last_name)
          or payroll_name_key(r.first_name, r.last_name) is null) then
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
                             'previousPayrollId', s.payroll_id, 'spudbros', v_spud,
                             'listName', btrim(coalesce(r.first_name, '') || ' ' || coalesce(r.last_name, '')),
                             'appliedName', btrim(coalesce(s.first_name, '') || ' ' || coalesce(s.last_name, '')),
                             'nameConfirmed', coalesce(p_confirm_name, false)
                                              and not payroll_names_compatible(s.first_name, s.last_name,
                                                                               r.first_name, r.last_name)));

  return jsonb_build_object('payrollId', r.payroll_id, 'group', v_group, 'spudbros', v_spud);
end $$;

comment on function public.link_invite_roster_entry(uuid, uuid, boolean) is
  'ADR-0123, ADR-0143: the office links an invite-list row to the person who applied — under another email, or with the listed one but held back — applying the Payroll ID (numeric → Employee ID where system-issued) and SpudBros marking as load_invite_roster does for somebody already here, consuming the row (the IR1 reminders stop) and auditing roster.linked. Names must agree unless p_confirm_name (the office has seen both); a Payroll ID somebody else holds, or a different one already carried, is refused. Owner and manager only.';

revoke all on function public.link_invite_roster_entry(uuid, uuid, boolean) from public, anon;
grant execute on function public.link_invite_roster_entry(uuid, uuid, boolean) to authenticated;
