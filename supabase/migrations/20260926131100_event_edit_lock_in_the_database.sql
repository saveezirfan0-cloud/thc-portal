-- =====================================================================
-- Migration 20260926111100 · §3.2's edit lock is held in the database
--
-- §3.2: "Editing is only allowed up to the event's start time. Once the
-- event has started — and therefore for any past event — editing is
-- locked." The lock lived only in TypeScript (isEditLocked, the edit
-- page and its server action); admin_all on events and shift_requirements
-- accepted a schedule change at any time. CLAUDE.md wants every rule in
-- both layers.
--
-- Scope of the lock: the columns that ARE the event as built — the
-- section's window, headcount, buffer, role and rates; the event's date,
-- venue, fence, title, PO and client — once the event's derived window
-- (min start, RULE-18) has started. Everything that legitimately moves
-- after the start is untouched: cancellation (§3.3), payroll_exported_at
-- (BG-08), the Auto-Assign switch (§3.4 escalation runs during the
-- event), notes, the on-site contact, reconfirm flags.
--
-- Held against the MANAGER'S PostgREST session (current_app_role() =
-- 'admin' under the `authenticated` database role), which is the only
-- human write path. The service role (jobs, Edge Functions) and the
-- table owner (migrations, seed, tests) are not managers editing an
-- event and are not locked; the fixtures that move a started section's
-- times to build a scenario keep working.
-- =====================================================================

create or replace function public.event_edit_lock_guard()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
declare
  v_event_id uuid;
  v_start    timestamptz;
begin
  if current_app_role() is distinct from 'admin' or current_user <> 'authenticated' then
    return new;
  end if;

  if tg_table_name = 'shift_requirements' then
    if new.starts_at   is not distinct from old.starts_at
   and new.ends_at     is not distinct from old.ends_at
   and new.headcount   is not distinct from old.headcount
   and new.buffer      is not distinct from old.buffer
   and new.role_id     is not distinct from old.role_id
   and new.charge_rate is not distinct from old.charge_rate
   and new.pay_rate    is not distinct from old.pay_rate
   and new.dress_code  is not distinct from old.dress_code
   and new.allocation_per_hour is not distinct from old.allocation_per_hour then
      return new;
    end if;
    v_event_id := old.event_id;
  else
    if new.event_date        is not distinct from old.event_date
   and new.venue_id          is not distinct from old.venue_id
   and new.venue_name        is not distinct from old.venue_name
   and new.venue_address     is not distinct from old.venue_address
   and new.venue_location::text is not distinct from old.venue_location::text
   and new.geofence_radius_m is not distinct from old.geofence_radius_m
   and new.title             is not distinct from old.title
   and new.po_number         is not distinct from old.po_number
   and new.client_id         is not distinct from old.client_id
   and new.pays_breaks       is not distinct from old.pays_breaks
   and new.pays_buffer       is not distinct from old.pays_buffer then
      return new;
    end if;
    v_event_id := old.id;
  end if;

  select min(s.starts_at) into v_start from shift_requirements s where s.event_id = v_event_id;
  if v_start is not null and now() >= v_start then
    raise exception 'event_started_editing_locked' using errcode = 'P0001',
      detail = 'This event has started. Editing is locked (§3.2).';
  end if;
  return new;
end $$;

comment on function public.event_edit_lock_guard() is
  '§3.2: once the event''s derived window has started, a manager''s session may not change the event as built (a section''s window, headcount, buffer, role, rates; the event''s date, venue, fence, title, PO, client, break/buffer terms). Cancellation, payroll_exported_at, the Auto-Assign switch, notes and reconfirm flags stay editable.';

revoke execute on function public.event_edit_lock_guard() from public, anon, authenticated;

drop trigger if exists shift_requirements_edit_lock on shift_requirements;
create trigger shift_requirements_edit_lock
  before update on shift_requirements
  for each row execute function public.event_edit_lock_guard();

drop trigger if exists events_edit_lock on events;
create trigger events_edit_lock
  before update on events
  for each row execute function public.event_edit_lock_guard();
