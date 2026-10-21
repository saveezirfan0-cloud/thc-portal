-- =====================================================================
-- Migration 20261022140000 · a started event takes a new role section
-- (ADR-0177, a deliberate change to §3.2)
--
-- §3.2 locks an event from its derived start. The lock (event_edit_lock_
-- guard, 20260927161200) is BEFORE UPDATE only, so a manager's session
-- could already INSERT a section into a started event with any times —
-- one that began hours ago included. ADR-0177 makes the insert a rule:
-- the client's same-day "one more person from 12:30" is added as a NEW
-- section, and it must start later than now. Nothing already saved moves.
--
-- Held against the manager's PostgREST session only, as the edit lock is:
-- jobs, Edge Functions, migrations, seed and tests are not managers.
-- =====================================================================

create or replace function public.late_section_guard()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
declare
  v_start timestamptz;
begin
  if current_app_role() is distinct from 'admin' or current_user <> 'authenticated' then
    return new;
  end if;

  select min(s.starts_at) into v_start
    from shift_requirements s
   where s.event_id = new.event_id;

  if v_start is not null and now() >= v_start and new.starts_at <= now() then
    raise exception 'late_section_starts_in_past' using errcode = 'P0001',
      detail = 'This event has started. A role added now must start later than the current time (ADR-0177).';
  end if;
  return new;
end $$;

comment on function public.late_section_guard() is
  'ADR-0177: once an event has started, a manager may still add a NEW role section to it, but only one that starts later than now. Saved sections stay under event_edit_lock_guard.';

revoke execute on function public.late_section_guard() from public, anon, authenticated;

drop trigger if exists shift_requirements_late_section on shift_requirements;
create trigger shift_requirements_late_section
  before insert on shift_requirements
  for each row execute function public.late_section_guard();
