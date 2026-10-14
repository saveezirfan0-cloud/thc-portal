-- =====================================================================
-- Release audit 14.10.2026, D-M1 · every Back Office edit is in the
-- activity log (§1.7, ADR-0055)
--
-- /users tells managers "Every change is recorded in the activity log",
-- but most edits wrote nothing: a client's details and its break / buffer
-- policy, the rate card (charge rates), a worker's personal pay rate, their
-- roles and client qualifications, office feedback, a client feedback
-- marked read, venues, the role catalogue, and every event create / edit /
-- duplicate. events.created_by stayed NULL.
--
-- How: an AFTER trigger per table, SECURITY DEFINER (audit_log has no
-- INSERT policy for any API role, which is what broke Do not return —
-- 20261014093100), in the shape audit_settings_change() and
-- audit_venue_radius_change() already use: actor = auth.uid(), an action
-- code, the entity the History block files it under, and `data` holding
-- {from, to} for every changed field. A trigger rather than a line in each
-- RPC because half these writes are not RPCs at all — the Shift Builder
-- writes events and shift_requirements through PostgREST — and because a
-- trigger cannot be forgotten by the next function that writes the table.
--
-- Rules every trigger here keeps:
--   · Only a person's edit is logged: auth.uid() must be set. Jobs, the
--     seed and the automatic grant after a clean shift write no row — they
--     are not edits, and the paths that matter there already audit
--     themselves (onboarding_accept, cancel_event, link_event_series…).
--   · Nothing is logged when nothing changed.
--   · A cancelled event's sections are not "edited" by cancel_event()
--     switching auto-assign off: that is the event.cancelled row.
--   · Do not return keeps its own row (set_do_not_return); the
--     qualification trigger skips an update that moves the flag.
--   · No worker personal data goes in `data` (GDPR removal keeps history
--     rows, §1.7): ids, role and client names, ratings, money.
--   · Money (chargeRate, payRate) is written in full and withheld on READ
--     from a login without finance (ADR-0061): admin_activity and
--     admin_record_history now pass `data` through audit_data_shown().
--
-- Also: events.created_by defaults to auth.uid() (as clients and venues
-- already do), and events.duplicated_from records the event a Duplicate
-- was made from, so the log can say "Duplicated event" and from what.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0 · Helpers (internal: no API role may call them)
-- ---------------------------------------------------------------------

-- {key: {from, to}} for every key whose value differs between two
-- projections of a row. Both sides are built by the caller with readable
-- keys and display-ready values (UK times, role names).
create or replace function public.audit_changes(p_old jsonb, p_new jsonb)
returns jsonb
language sql
immutable
set search_path = public
as $$
  select coalesce(jsonb_object_agg(k, jsonb_build_object('from', p_old -> k, 'to', p_new -> k)),
                  '{}'::jsonb)
    from (select jsonb_object_keys(coalesce(p_old, '{}'::jsonb) || coalesce(p_new, '{}'::jsonb)) as k) keys
   where (p_old -> k) is distinct from (p_new -> k)
$$;

comment on function public.audit_changes(jsonb, jsonb) is
  'Release audit D-M1: {key: {from, to}} for the keys whose values differ. Used by the Back Office audit triggers (20261014093200).';

-- A role section's time as the office reads it (§1.8: UK, 24-hour).
create or replace function public.audit_uk_stamp(p_at timestamptz)
returns text
language sql
immutable
set search_path = public
as $$
  select to_char(p_at at time zone 'Europe/London', 'DD.MM.YYYY HH24:MI')
$$;

-- What a reader of the log is shown of `data`: everything, unless the
-- login may not see money (ADR-0061) — then the rates are withheld and
-- the entry says so rather than reading as if nothing was changed.
create or replace function public.audit_data_shown(p_data jsonb, p_money boolean)
returns jsonb
language sql
immutable
set search_path = public
as $$
  select case
           when p_data is null or p_money or not (p_data ?| array['chargeRate', 'payRate']) then p_data
           else (p_data - 'chargeRate' - 'payRate')
                || jsonb_build_object('rates', 'not shown to your login')
         end
$$;

comment on function public.audit_data_shown(jsonb, boolean) is
  'Release audit D-M1 / ADR-0061: an audit row''s data as a reader sees it — chargeRate and payRate withheld from a login without finance.';

revoke all on function public.audit_changes(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.audit_uk_stamp(timestamptz) from public, anon, authenticated;
revoke all on function public.audit_data_shown(jsonb, boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 1 · Clients (create_client, update_client)
-- ---------------------------------------------------------------------
create or replace function public.audit_client_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_changes jsonb;
begin
  if auth.uid() is null then
    return null;
  end if;
  if tg_op = 'INSERT' then
    insert into audit_log (actor, action, entity, entity_id, data)
    values (auth.uid(), 'client.created', 'client', new.id,
            jsonb_build_object('name', new.name,
                               'paysBreaks', new.pays_breaks,
                               'paysBuffer', new.pays_buffer));
    return null;
  end if;

  -- name_badges has its own row (set_client_name_badges, ADR-0081).
  v_changes := audit_changes(
    jsonb_build_object('name', old.name, 'contactName', old.contact_name, 'phone', old.phone,
                       'staffContactPoint', old.staff_contact_point,
                       'contactEmails', to_jsonb(old.contact_emails),
                       'paysBreaks', old.pays_breaks, 'paysBuffer', old.pays_buffer),
    jsonb_build_object('name', new.name, 'contactName', new.contact_name, 'phone', new.phone,
                       'staffContactPoint', new.staff_contact_point,
                       'contactEmails', to_jsonb(new.contact_emails),
                       'paysBreaks', new.pays_breaks, 'paysBuffer', new.pays_buffer));
  if v_changes = '{}'::jsonb then
    return null;
  end if;
  insert into audit_log (actor, action, entity, entity_id, data)
  values (auth.uid(), 'client.updated', 'client', new.id, v_changes);
  return null;
end $$;

drop trigger if exists clients_audit on clients;
create trigger clients_audit
  after insert or update on clients
  for each row execute function public.audit_client_change();

-- ---------------------------------------------------------------------
-- 2 · The rate card (add_client_role, update_client_role, remove_client_role)
--     Filed under the CLIENT, so the client card's History shows it.
-- ---------------------------------------------------------------------
create or replace function public.audit_rate_card_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row    client_rate_cards;
  v_role   text;
  v_action text;
  v_data   jsonb;
begin
  if auth.uid() is null then
    return null;
  end if;
  v_row := case when tg_op = 'DELETE' then old else new end;
  select r.name into v_role from roles r where r.id = v_row.role_id;

  if tg_op = 'INSERT' then
    v_action := 'client.rate_added';
    v_data := jsonb_build_object('chargeRate', jsonb_build_object('from', null, 'to', new.charge_rate),
                                 'dressCodes', to_jsonb(new.dress_codes));
  elsif tg_op = 'UPDATE' then
    v_action := 'client.rate_changed';
    v_data := audit_changes(
      jsonb_build_object('chargeRate', old.charge_rate, 'dressCodes', to_jsonb(old.dress_codes)),
      jsonb_build_object('chargeRate', new.charge_rate, 'dressCodes', to_jsonb(new.dress_codes)));
    if v_data = '{}'::jsonb then
      return null;
    end if;
  else
    v_action := 'client.rate_removed';
    v_data := jsonb_build_object('chargeRate', jsonb_build_object('from', old.charge_rate, 'to', null));
  end if;

  insert into audit_log (actor, action, entity, entity_id, data)
  values (auth.uid(), v_action, 'client', v_row.client_id,
          v_data || jsonb_build_object('role', v_role, 'roleId', v_row.role_id,
                                       'clientId', v_row.client_id));
  return null;
end $$;

drop trigger if exists client_rate_cards_audit on client_rate_cards;
create trigger client_rate_cards_audit
  after insert or update or delete on client_rate_cards
  for each row execute function public.audit_rate_card_change();

-- ---------------------------------------------------------------------
-- 3 · A worker's personal pay rate (set_staff_pay_rate, ADR-0072)
-- ---------------------------------------------------------------------
create or replace function public.audit_staff_pay_rate_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_staff uuid;
  v_from  numeric;
  v_to    numeric;
begin
  if auth.uid() is null then
    return null;
  end if;
  v_staff := case when tg_op = 'DELETE' then old.staff_id else new.staff_id end;
  v_from  := case when tg_op = 'INSERT' then null else old.pay_rate end;
  v_to    := case when tg_op = 'DELETE' then null else new.pay_rate end;
  if tg_op = 'UPDATE' and v_from is not distinct from v_to then
    return null;
  end if;
  insert into audit_log (actor, action, entity, entity_id, data)
  values (auth.uid(),
          case when tg_op = 'DELETE' then 'staff.pay_rate_cleared' else 'staff.pay_rate_set' end,
          'staff', v_staff,
          jsonb_build_object('payRate', jsonb_build_object('from', v_from, 'to', v_to)));
  return null;
end $$;

drop trigger if exists staff_pay_rates_audit on staff_pay_rates;
create trigger staff_pay_rates_audit
  after insert or update or delete on staff_pay_rates
  for each row execute function public.audit_staff_pay_rate_change();

-- ---------------------------------------------------------------------
-- 4 · A worker's roles (add_staff_role, remove_staff_role)
-- ---------------------------------------------------------------------
create or replace function public.audit_staff_role_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row  staff_roles;
  v_role text;
begin
  if auth.uid() is null then
    return null;
  end if;
  v_row := case when tg_op = 'DELETE' then old else new end;
  select r.name into v_role from roles r where r.id = v_row.role_id;
  insert into audit_log (actor, action, entity, entity_id, data)
  values (auth.uid(),
          case when tg_op = 'DELETE' then 'staff.role_removed' else 'staff.role_added' end,
          'staff', v_row.staff_id,
          jsonb_build_object('role', v_role, 'roleId', v_row.role_id));
  return null;
end $$;

drop trigger if exists staff_roles_audit on staff_roles;
create trigger staff_roles_audit
  after insert or delete on staff_roles
  for each row execute function public.audit_staff_role_change();

-- ---------------------------------------------------------------------
-- 5 · Client qualifications (grant_client_qualification,
--     revoke_client_qualification, and the rows remove_staff_role drops)
-- ---------------------------------------------------------------------
create or replace function public.audit_client_qualification_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row    client_qualifications;
  v_role   text;
  v_action text;
  v_data   jsonb := '{}'::jsonb;
begin
  if auth.uid() is null then
    return null;
  end if;
  v_row := case when tg_op = 'DELETE' then old else new end;

  if tg_op = 'INSERT' then
    v_action := 'client_qualification.granted';
    v_data := jsonb_build_object('note', new.note);
  elsif tg_op = 'UPDATE' then
    -- Do not return writes its own row (set_do_not_return); a re-grant
    -- that only refreshes granted_at / granted_by is not a change.
    if new.do_not_return is distinct from old.do_not_return
       or new.note is not distinct from old.note then
      return null;
    end if;
    v_action := 'client_qualification.note_changed';
    v_data := jsonb_build_object('note', jsonb_build_object('from', old.note, 'to', new.note));
  else
    v_action := 'client_qualification.revoked';
  end if;

  select r.name into v_role from roles r where r.id = v_row.role_id;
  insert into audit_log (actor, action, entity, entity_id, data)
  values (auth.uid(), v_action, 'client_qualification', v_row.id,
          v_data || jsonb_build_object('role', v_role,
                                       'staffId', v_row.staff_id::text,
                                       'clientId', v_row.client_id::text,
                                       'roleId', v_row.role_id::text));
  return null;
end $$;

drop trigger if exists client_qualifications_audit on client_qualifications;
create trigger client_qualifications_audit
  after insert or update or delete on client_qualifications
  for each row execute function public.audit_client_qualification_change();

-- ---------------------------------------------------------------------
-- 6 · Feedback (§9.10): office entries added, edited, deleted; a client
--     entry marked read or deleted. Filed under the worker. The text is
--     not copied — the entry itself is the record of what was said.
-- ---------------------------------------------------------------------
create or replace function public.audit_feedback_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row    feedback;
  v_action text;
  v_data   jsonb;
begin
  if auth.uid() is null then
    return null;
  end if;
  v_row := case when tg_op = 'DELETE' then old else new end;

  if tg_op = 'INSERT' then
    if new.author_kind <> 'office' then
      return null;   -- a client's own feedback is not a Back Office edit
    end if;
    v_action := 'feedback.added';
    v_data := jsonb_build_object('rating', new.rating);
  elsif tg_op = 'UPDATE' then
    if old.author_kind = 'client' then
      if old.read_at is null and new.read_at is not null then
        v_action := 'feedback.read';
        -- Not 'from': a top-level from/to pair reads as a settings change.
        v_data := jsonb_build_object('rating', new.rating, 'author', 'client');
      else
        return null;
      end if;
    else
      v_data := audit_changes(
        jsonb_build_object('rating', old.rating,
                           'event', (select ev.title from events ev where ev.id = old.event_id)),
        jsonb_build_object('rating', new.rating,
                           'event', (select ev.title from events ev where ev.id = new.event_id)));
      if new.text is distinct from old.text then
        v_data := v_data || jsonb_build_object('comment', 'edited');
      end if;
      if v_data = '{}'::jsonb then
        return null;
      end if;
      v_action := 'feedback.edited';
    end if;
  else
    v_action := 'feedback.deleted';
    v_data := jsonb_build_object('rating', old.rating, 'author', old.author_kind::text);
  end if;

  -- The event the entry is about, unless the edit itself moved it (then
  -- v_data already says from → to, and wins).
  insert into audit_log (actor, action, entity, entity_id, data)
  values (auth.uid(), v_action, 'staff', v_row.staff_id,
          jsonb_build_object('event', (select ev.title from events ev where ev.id = v_row.event_id))
          || v_data
          || jsonb_build_object('feedbackId', v_row.id::text));
  return null;
end $$;

drop trigger if exists feedback_audit on feedback;
create trigger feedback_audit
  after insert or update or delete on feedback
  for each row execute function public.audit_feedback_change();

-- ---------------------------------------------------------------------
-- 7 · Venues (§9.11): create, edit, soft delete
-- ---------------------------------------------------------------------
create or replace function public.audit_venue_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_changes jsonb;
begin
  if auth.uid() is null then
    return null;
  end if;
  if tg_op = 'INSERT' then
    insert into audit_log (actor, action, entity, entity_id, data)
    values (auth.uid(), 'venue.created', 'venue', new.id,
            jsonb_build_object('name', new.name, 'address', new.address,
                               'venueType', new.venue_type, 'radius', new.geofence_radius_m));
    return null;
  end if;
  if tg_op = 'DELETE' or (old.deleted_at is null and new.deleted_at is not null) then
    insert into audit_log (actor, action, entity, entity_id, data)
    values (auth.uid(), 'venue.deleted', 'venue', old.id, jsonb_build_object('name', old.name));
    return null;
  end if;

  v_changes := audit_changes(
    jsonb_build_object('name', old.name, 'address', old.address, 'venueType', old.venue_type,
                       'radius', old.geofence_radius_m),
    jsonb_build_object('name', new.name, 'address', new.address, 'venueType', new.venue_type,
                       'radius', new.geofence_radius_m));
  if new.location is distinct from old.location then
    v_changes := v_changes || jsonb_build_object('pin', 'moved');
  end if;
  if v_changes = '{}'::jsonb then
    return null;
  end if;
  insert into audit_log (actor, action, entity, entity_id, data)
  values (auth.uid(), 'venue.updated', 'venue', new.id, v_changes);
  return null;
end $$;

drop trigger if exists venues_audit on venues;
create trigger venues_audit
  after insert or update or delete on venues
  for each row execute function public.audit_venue_change();

-- ---------------------------------------------------------------------
-- 8 · The role catalogue (§9.8): base pay rate is money every new event
--     is priced from.
-- ---------------------------------------------------------------------
create or replace function public.audit_role_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_changes jsonb;
begin
  if auth.uid() is null then
    return null;
  end if;
  if tg_op = 'INSERT' then
    insert into audit_log (actor, action, entity, entity_id, data)
    values (auth.uid(), 'role.created', 'role', new.id,
            jsonb_build_object('name', new.name,
                               'payRate', jsonb_build_object('from', null, 'to', new.pay_rate)));
  elsif tg_op = 'DELETE' then
    insert into audit_log (actor, action, entity, entity_id, data)
    values (auth.uid(), 'role.deleted', 'role', old.id,
            jsonb_build_object('name', old.name,
                               'payRate', jsonb_build_object('from', old.pay_rate, 'to', null)));
  else
    v_changes := audit_changes(
      jsonb_build_object('name', old.name, 'description', old.description, 'payRate', old.pay_rate),
      jsonb_build_object('name', new.name, 'description', new.description, 'payRate', new.pay_rate));
    if v_changes <> '{}'::jsonb then
      insert into audit_log (actor, action, entity, entity_id, data)
      values (auth.uid(), 'role.updated', 'role', new.id, v_changes);
    end if;
  end if;
  return null;
end $$;

drop trigger if exists roles_audit on roles;
create trigger roles_audit
  after insert or update or delete on roles
  for each row execute function public.audit_role_change();

-- ---------------------------------------------------------------------
-- 9 · Events: who made it, and what it was duplicated from
-- ---------------------------------------------------------------------
alter table events alter column created_by set default auth.uid();
alter table events add column if not exists duplicated_from uuid
  references events (id) on delete set null;
-- 002: every foreign key is covered by an index (the ON DELETE SET NULL
-- would otherwise scan events).
create index if not exists events_duplicated_from_idx on events (duplicated_from);

comment on column events.created_by is
  'The Back Office login that created the event; auth.uid() by default since 20261014093200 (release audit D-M1). NULL for events created before then and by jobs.';
comment on column events.duplicated_from is
  'Release audit D-M1: the event this one was made from with Duplicate (§3.2), or NULL. A record of where it came from only — staff are never copied, and the multi-day link is series_id (ADR-0117).';

-- One event as the log describes it: what a manager changes in the
-- Shift Builder. Status columns (cancelled_*, payroll_exported_at,
-- series_id, document_recipients) have their own audited functions.
create or replace function public.audit_event_fields(e events)
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
    'title', e.title,
    'date', to_char(e.event_date, 'DD.MM.YYYY'),
    'client', (select c.name from clients c where c.id = e.client_id),
    'venue', e.venue_name,
    'venueAddress', e.venue_address,
    'radius', e.geofence_radius_m,
    'poNumber', e.po_number,
    'onsiteContact', e.onsite_contact,
    'notes', e.notes,
    'autoAssign', e.auto_assign,
    'languages', to_jsonb(e.required_languages),
    'paysBreaks', e.pays_breaks,
    'paysBuffer', e.pays_buffer)
$$;

revoke all on function public.audit_event_fields(events) from public, anon, authenticated;

create or replace function public.audit_event_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_changes jsonb;
begin
  if auth.uid() is null then
    return null;
  end if;
  if tg_op = 'INSERT' then
    insert into audit_log (actor, action, entity, entity_id, data)
    values (auth.uid(),
            case when new.duplicated_from is null then 'event.created' else 'event.duplicated' end,
            'event', new.id,
            jsonb_build_object('title', new.title,
                               'date', to_char(new.event_date, 'DD.MM.YYYY'),
                               'venue', new.venue_name,
                               'clientId', new.client_id::text,
                               'duplicatedFrom', (select src.title || ' · ' || to_char(src.event_date, 'DD.MM.YYYY')
                                                    from events src where src.id = new.duplicated_from)));
    return null;
  end if;
  if tg_op = 'DELETE' then
    -- Only the Shift Builder's own roll-back deletes an event (a save whose
    -- sections were refused); a real event is cancelled, never deleted.
    insert into audit_log (actor, action, entity, entity_id, data)
    values (auth.uid(), 'event.deleted', 'event', old.id,
            jsonb_build_object('title', old.title, 'date', to_char(old.event_date, 'DD.MM.YYYY'),
                               'clientId', old.client_id::text));
    return null;
  end if;

  -- cancel_event() switches auto-assign off as part of the cancellation,
  -- which has its own event.cancelled row.
  if new.cancelled_at is not null then
    return null;
  end if;
  v_changes := audit_changes(audit_event_fields(old), audit_event_fields(new));
  if v_changes = '{}'::jsonb then
    return null;
  end if;
  insert into audit_log (actor, action, entity, entity_id, data)
  values (auth.uid(), 'event.updated', 'event', new.id, v_changes);
  return null;
end $$;

drop trigger if exists events_audit on events;
create trigger events_audit
  after insert or update or delete on events
  for each row execute function public.audit_event_change();

-- ---------------------------------------------------------------------
-- 10 · Role sections: filed under their EVENT
-- ---------------------------------------------------------------------
create or replace function public.audit_section_fields(s shift_requirements)
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
    'role', (select r.name from roles r where r.id = s.role_id),
    'starts', audit_uk_stamp(s.starts_at),
    'ends', audit_uk_stamp(s.ends_at),
    'headcount', s.headcount,
    'buffer', s.buffer,
    'chargeRate', s.charge_rate,
    'payRate', s.pay_rate,
    'dressCode', s.dress_code,
    'autoAssign', s.auto_assign,
    'requiredGender', s.required_gender,
    'sameStaffAllDays', s.same_staff_all_days,
    'allocationPerHour', s.allocation_per_hour)
$$;

revoke all on function public.audit_section_fields(shift_requirements) from public, anon, authenticated;

create or replace function public.audit_section_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row     shift_requirements;
  v_fields  jsonb;
  v_changes jsonb;
begin
  if auth.uid() is null then
    return null;
  end if;
  v_row := case when tg_op = 'DELETE' then old else new end;

  if tg_op = 'INSERT' then
    v_fields := audit_section_fields(new);
    insert into audit_log (actor, action, entity, entity_id, data)
    values (auth.uid(), 'event.role_added', 'event', new.event_id,
            (v_fields - 'chargeRate' - 'payRate' - 'autoAssign' - 'sameStaffAllDays' - 'allocationPerHour')
            || jsonb_build_object('chargeRate', jsonb_build_object('from', null, 'to', new.charge_rate),
                                  'payRate', jsonb_build_object('from', null, 'to', new.pay_rate))
            || jsonb_build_object('sectionId', new.id::text));
    return null;
  end if;
  if tg_op = 'DELETE' then
    insert into audit_log (actor, action, entity, entity_id, data)
    values (auth.uid(), 'event.role_removed', 'event', old.event_id,
            jsonb_build_object('role', (select r.name from roles r where r.id = old.role_id),
                               'starts', audit_uk_stamp(old.starts_at),
                               'ends', audit_uk_stamp(old.ends_at),
                               'headcount', old.headcount,
                               'sectionId', old.id::text));
    return null;
  end if;

  if exists (select 1 from events ev where ev.id = new.event_id and ev.cancelled_at is not null) then
    return null;   -- cancel_event() switching auto-assign off (event.cancelled)
  end if;
  v_changes := audit_changes(audit_section_fields(old), audit_section_fields(new));
  if v_changes = '{}'::jsonb then
    return null;
  end if;
  insert into audit_log (actor, action, entity, entity_id, data)
  values (auth.uid(), 'event.role_changed', 'event', new.event_id,
          v_changes || jsonb_build_object(
            'section', (select r.name from roles r where r.id = new.role_id),
            'sectionId', new.id::text));
  return null;
end $$;

drop trigger if exists shift_requirements_audit on shift_requirements;
create trigger shift_requirements_audit
  after insert or update or delete on shift_requirements
  for each row execute function public.audit_section_change();

revoke all on function public.audit_client_change()               from public, anon, authenticated;
revoke all on function public.audit_rate_card_change()            from public, anon, authenticated;
revoke all on function public.audit_staff_pay_rate_change()       from public, anon, authenticated;
revoke all on function public.audit_staff_role_change()           from public, anon, authenticated;
revoke all on function public.audit_client_qualification_change() from public, anon, authenticated;
revoke all on function public.audit_feedback_change()             from public, anon, authenticated;
revoke all on function public.audit_venue_change()                from public, anon, authenticated;
revoke all on function public.audit_role_change()                 from public, anon, authenticated;
revoke all on function public.audit_event_change()                from public, anon, authenticated;
revoke all on function public.audit_section_change()              from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 11 · The readers: money withheld from a login without finance, and the
--      new entities labelled. 20261001200000 / 20261001200300's bodies with
--      audit_data_shown() on `data` and four more label cases.
-- ---------------------------------------------------------------------
create or replace function public.admin_activity(
  p_limit  int         default 50,
  p_before bigint      default null,
  p_entity text        default null,
  p_actor  uuid        default null,
  p_query  text        default null,
  p_since  timestamptz default null
) returns table (id bigint, at timestamptz, actor uuid, actor_name text, action text,
                 entity text, entity_id uuid, entity_label text, data jsonb)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_limit int  := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_q     text := nullif(btrim(coalesce(p_query, '')), '');
  v_money boolean;
begin
  if current_app_role() is distinct from 'admin' then
    raise exception 'not_authorised' using errcode = '42501';
  end if;
  v_money := office_can('finance');
  return query
    with page as (
      select a.*
        from audit_log a
       where (p_before is null or a.id < p_before)
         and (p_entity is null or a.entity = p_entity)
         and (p_actor  is null or a.actor  = p_actor)
         and (p_since  is null or a.at    >= p_since)
    ), labelled as (
      select pg.id, pg.at, pg.actor,
             ap.full_name as actor_name,
             pg.action, pg.entity, pg.entity_id,
             case pg.entity
               when 'staff'           then (select st.first_name || ' ' || st.last_name from staff st where st.id = pg.entity_id)
               when 'compliance_docs' then (select st.first_name || ' ' || st.last_name || ' · ' || replace(cd.doc_type::text, '_', ' ')
                                              from compliance_docs cd join staff st on st.id = cd.staff_id where cd.id = pg.entity_id)
               when 'event'           then coalesce((select ev.title from events ev where ev.id = pg.entity_id), pg.data ->> 'title')
               when 'booking'         then (select st.first_name || ' ' || st.last_name || ' · ' || ev.title
                                              from bookings b join staff st on st.id = b.staff_id
                                              join shift_requirements sr on sr.id = b.shift_id
                                              join events ev on ev.id = sr.event_id where b.id = pg.entity_id)
               when 'account'         then (select pr.full_name from profiles pr where pr.id = pg.entity_id)
               when 'client'          then (select cl.name from clients cl where cl.id = pg.entity_id)
               when 'settings'        then pg.data ->> 'key'
               when 'client_qualification' then coalesce(
                                              (select st.first_name || ' ' || st.last_name || ' · ' || cl.name || ' · ' || r.name
                                                 from client_qualifications q join staff st on st.id = q.staff_id
                                                 join clients cl on cl.id = q.client_id
                                                 join roles r on r.id = q.role_id where q.id = pg.entity_id),
                                              (select cl.name || coalesce(' · ' || (pg.data ->> 'role'), '')
                                                 from clients cl where cl.id::text = pg.data ->> 'clientId'))
               when 'venue'           then coalesce((select v.name from venues v where v.id = pg.entity_id), pg.data ->> 'name')
               when 'role'            then coalesce((select r.name from roles r where r.id = pg.entity_id), pg.data ->> 'name')
             end as entity_label,
             pg.data
        from page pg
        left join profiles ap on ap.id = pg.actor
    )
    select l.id, l.at, l.actor, l.actor_name, l.action, l.entity, l.entity_id, l.entity_label,
           audit_data_shown(l.data, v_money)
      from labelled l
     where v_q is null
        or l.action ilike '%' || v_q || '%'
        or l.entity_label ilike '%' || v_q || '%'
        or l.actor_name ilike '%' || v_q || '%'
     order by l.id desc
     limit v_limit;
end;
$$;

comment on function public.admin_activity(int, bigint, text, uuid, text, timestamptz) is
  'ADR-0055 /activity: the audit trail, newest first, filtered and paged on id, each row labelled with who did it and what it was about. Admin only. Since 20261014093200 the rates in `data` are withheld from a login without finance (ADR-0061), and venues, roles and removed qualifications are labelled.';

create or replace function public.admin_record_history(
  p_entity text,
  p_id     uuid,
  p_limit  int    default 100,
  p_before bigint default null
) returns table (id bigint, at timestamptz, actor uuid, actor_name text, action text,
                 entity text, entity_id uuid, entity_label text, data jsonb)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_limit int  := least(greatest(coalesce(p_limit, 100), 1), 200);
  v_key   text := p_id::text;
  v_ids   bigint[];
  v_money boolean;
begin
  if current_app_role() is distinct from 'admin' then
    raise exception 'not_authorised' using errcode = '42501';
  end if;
  if p_entity is null or p_id is null then
    return;
  end if;
  v_money := office_can('finance');

  if p_entity = 'staff' then
    select coalesce(array_agg(distinct x.id), '{}') into v_ids from (
      select a.id from audit_log a
       where a.entity = 'staff' and a.entity_id = p_id
      union all
      select a.id from audit_log a
       where (a.data ->> 'staffId') = v_key
         and a.entity in ('compliance_docs', 'booking', 'client_qualification', 'staff')
      union all
      select a.id from audit_log a join compliance_docs cd on cd.id = a.entity_id
       where a.entity = 'compliance_docs' and cd.staff_id = p_id
      union all
      select a.id from audit_log a join bookings b on b.id = a.entity_id
       where a.entity = 'booking' and b.staff_id = p_id
      union all
      select a.id from audit_log a join client_qualifications q on q.id = a.entity_id
       where a.entity = 'client_qualification' and q.staff_id = p_id
    ) x where p_before is null or x.id < p_before;

  elsif p_entity = 'event' then
    select coalesce(array_agg(distinct x.id), '{}') into v_ids from (
      select a.id from audit_log a
       where a.entity = 'event' and a.entity_id = p_id
      union all
      select a.id from audit_log a
        join bookings b on b.id = a.entity_id
        join shift_requirements sr on sr.id = b.shift_id
       where a.entity = 'booking' and sr.event_id = p_id
    ) x where p_before is null or x.id < p_before;

  elsif p_entity = 'client' then
    select coalesce(array_agg(distinct x.id), '{}') into v_ids from (
      select a.id from audit_log a
       where a.entity = 'client' and a.entity_id = p_id
      union all
      select a.id from audit_log a join events ev on ev.id = a.entity_id
       where a.entity = 'event' and ev.client_id = p_id
      union all
      select a.id from audit_log a
       where a.entity in ('client_qualification', 'account') and (a.data ->> 'clientId') = v_key
      union all
      select a.id from audit_log a join client_qualifications q on q.id = a.entity_id
       where a.entity = 'client_qualification' and q.client_id = p_id
      union all
      select a.id from audit_log a join profiles pr on pr.id = a.entity_id
       where a.entity = 'account' and pr.client_id = p_id
    ) x where p_before is null or x.id < p_before;

  else
    select coalesce(array_agg(a.id), '{}') into v_ids
      from audit_log a
     where a.entity = p_entity and a.entity_id = p_id
       and (p_before is null or a.id < p_before);
  end if;

  return query
    with page as (
      select a.*
        from audit_log a
       where a.id = any (v_ids)
       order by a.id desc
       limit v_limit
    )
    select pg.id, pg.at, pg.actor,
           ap.full_name,
           pg.action, pg.entity, pg.entity_id,
           case pg.entity
             when 'staff'           then (select st.first_name || ' ' || st.last_name from staff st where st.id = pg.entity_id)
             when 'compliance_docs' then coalesce(
                                           (select st.first_name || ' ' || st.last_name || ' · ' || replace(cd.doc_type::text, '_', ' ')
                                              from compliance_docs cd join staff st on st.id = cd.staff_id where cd.id = pg.entity_id),
                                           replace(pg.data ->> 'docType', '_', ' '))
             when 'event'           then coalesce((select ev.title from events ev where ev.id = pg.entity_id), pg.data ->> 'title')
             when 'booking'         then (select st.first_name || ' ' || st.last_name || ' · ' || ev.title
                                            from bookings b join staff st on st.id = b.staff_id
                                            join shift_requirements sr on sr.id = b.shift_id
                                            join events ev on ev.id = sr.event_id where b.id = pg.entity_id)
             when 'client_qualification' then coalesce(
                                                 (select st.first_name || ' ' || st.last_name || ' · ' || cl.name || ' · ' || r.name
                                                    from client_qualifications q join staff st on st.id = q.staff_id
                                                    join clients cl on cl.id = q.client_id
                                                    join roles r on r.id = q.role_id where q.id = pg.entity_id),
                                                 (select cl.name || coalesce(' · ' || (pg.data ->> 'role'), '')
                                                    from clients cl where cl.id::text = pg.data ->> 'clientId'))
             when 'account'         then (select pr.full_name from profiles pr where pr.id = pg.entity_id)
             when 'client'          then (select cl.name from clients cl where cl.id = pg.entity_id)
             when 'settings'        then pg.data ->> 'key'
             when 'venue'           then coalesce((select v.name from venues v where v.id = pg.entity_id), pg.data ->> 'name')
             when 'role'            then coalesce((select r.name from roles r where r.id = pg.entity_id), pg.data ->> 'name')
           end,
           audit_data_shown(pg.data, v_money)
      from page pg
      left join profiles ap on ap.id = pg.actor
     order by pg.id desc;
end;
$$;

comment on function public.admin_record_history(text, uuid, int, bigint) is
  'ADR-0055 · §1.7: the History tab / block on a record page — every audit row about a worker, an event or a client, newest first, paged on id. Admin only. Since 20261014093200 the rates in `data` are withheld from a login without finance (ADR-0061).';

revoke all on function public.admin_activity(int, bigint, text, uuid, text, timestamptz) from public, anon;
revoke all on function public.admin_record_history(text, uuid, int, bigint)                from public, anon;
grant execute on function public.admin_activity(int, bigint, text, uuid, text, timestamptz) to authenticated;
grant execute on function public.admin_record_history(text, uuid, int, bigint)              to authenticated;
