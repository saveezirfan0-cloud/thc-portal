-- =====================================================================
-- Migration 20261008190000 · the invite list shows who has applied
--                            (ADR-0107 follow-up; owner request, 09.10.2026)
--
-- /staff/roster listed only the people still waiting: a row is deleted
-- when its person applies, so "who has applied" was nowhere on the page.
-- The rows stay deleted (the list holds emails and names of people who
-- never applied, §1.7), but every match has always been written to
-- audit_log, so the answer already exists:
--
--   roster.matched          an application was matched to its row (via
--                           list / list_over_link / list_name_mismatch);
--                           via = link is somebody who was NOT on the list
--                           and is left out — this page is about the list;
--   roster.name_mismatch    applied with an invited email, name differs;
--   roster.applied_existing the list was loaded for somebody already here.
--
-- invite_list_applied_v reads those and joins the person, one row each,
-- latest event first. security_invoker: it runs with the caller's rights,
-- so only the office (audit_log admin_read + staff RLS) reads anything.
-- A removed worker reads deleted_account_label() (§1.7).
-- =====================================================================

create or replace view public.invite_list_applied_v with (security_invoker = true) as
select distinct on (a.entity_id)
  a.entity_id                                              as staff_id,
  a.at                                                     as applied_at,
  case
    when a.action = 'roster.applied_existing'              then 'already_here'
    when a.action = 'roster.name_mismatch'
      or a.data ->> 'via' = 'list_name_mismatch'           then 'name_mismatch'
    else 'applied'
  end                                                      as how,
  coalesce(a.data ->> 'group',
           case when s.spudbros_express then 'spudbros' else 'thc' end) as grp,
  case when s.removed_at is null then s.email end          as email,
  case
    when s.removed_at is not null then deleted_account_label(s.employee_id)
    else s.first_name || ' ' || s.last_name
  end                                                      as display_name,
  case when s.removed_at is null then s.payroll_id end     as payroll_id,
  coalesce((a.data ->> 'payrollIdTaken')::boolean, false)  as payroll_id_taken,
  s.status,
  s.removed_at is not null                                 as removed
from public.audit_log a
join public.staff s on s.id = a.entity_id
where a.entity = 'staff'
  and (   a.action in ('roster.applied_existing', 'roster.name_mismatch')
       or (a.action = 'roster.matched' and a.data ->> 'via' in ('list', 'list_over_link', 'list_name_mismatch')))
order by a.entity_id, a.at desc, a.id desc;

comment on view public.invite_list_applied_v is
  '20261008190000 (ADR-0107): who on the invite list has applied — one row per person, from the roster.* audit rows the matcher and load_invite_roster() already write (the list rows themselves are deleted on use). how = applied (matched by email and name) / name_mismatch (applied with an invited email under a different name; nothing moved) / already_here (in the system when the list was loaded). Excludes people who used /apply/spudbros but were not on the list. security_invoker: office only. A removed person reads deleted_account_label() and no email or Payroll ID (§1.7).';

revoke all on public.invite_list_applied_v from public, anon, authenticated;
grant select on public.invite_list_applied_v to authenticated, service_role;
