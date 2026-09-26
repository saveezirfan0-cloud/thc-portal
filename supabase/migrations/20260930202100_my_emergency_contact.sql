-- =====================================================================
-- Migration 20260930202100 · the worker's own emergency contact
--   docs/19-staff-features-plan.md §2 (Phase 1, Agent B · staff-pwa)
--   ADR-0044 (proposed — awaiting THC) · Q11, Q12
--
--   my_emergency_contact()                         read
--   save_my_emergency_contact(name, relationship, phone)
--   clear_my_emergency_contact()
--
-- The table is Phase 0 (20260930200100): admin_read only, no staff and no
-- client policy, E.164 CHECK on the phone. These three are the worker's
-- only way in — ADR-0031's shape: security definer, caller resolved by
-- staff_caller() and never passed, named columns, pinned search_path,
-- EXECUTE revoked from public and anon.
--
-- Optional (Q11): an empty contact is never a lock. Office-only: nothing
-- here queues a notification, and no client_* view, PDF or report reads
-- the table (pgTAP 700).
--
-- Who may do what (ADR-0044 "Consequences"):
--   a working worker        read · save · clear
--   a leaver (inactive)     read only — not_editable on save / clear
--   a removed worker        nothing — account_closed
--
-- The phone is normalised the way normaliseEmergencyPhone() in
-- packages/domain does it: separators (space, dash, brackets) dropped,
-- the leading + and country code required, then E.164.
--
-- Forward-only.
-- =====================================================================

create or replace function public.my_emergency_contact()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_id uuid := staff_caller();
  v_status staff_status;
  v_row jsonb;
begin
  if v_id is null then
    raise exception 'unknown_staff' using errcode = 'P0001';
  end if;
  select s.status into v_status from staff s where s.id = v_id;
  if v_status = 'removed' then
    raise exception 'account_closed' using errcode = 'P0001';
  end if;

  select jsonb_build_object(
           'name',         c.name,
           'relationship', c.relationship,
           'phone',        c.phone,
           'updatedAt',    c.updated_at)
    into v_row
    from staff_emergency_contacts c
   where c.staff_id = v_id;
  return v_row;
end $$;

comment on function public.my_emergency_contact() is
  'ADR-0044: the calling worker''s own emergency contact ({name, relationship, phone, updatedAt}) or null. A leaver may read it; a removed worker is refused (account_closed). Takes no staff id; never returns updated_by.';

create or replace function public.save_my_emergency_contact(
  p_name         text,
  p_relationship text,
  p_phone        text
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_id uuid := staff_caller();
  v_status staff_status;
  v_name  text := btrim(coalesce(p_name, ''));
  v_rel   text := btrim(coalesce(p_relationship, ''));
  v_phone text := regexp_replace(btrim(coalesce(p_phone, '')), '[\s\-()]', '', 'g');
begin
  if v_id is null then
    raise exception 'unknown_staff' using errcode = 'P0001';
  end if;
  select s.status into v_status from staff s where s.id = v_id for update;
  if v_status = 'removed' then
    raise exception 'account_closed' using errcode = 'P0001';
  end if;
  -- A leaver's details are frozen (§10.6 step 7); a rejected candidate
  -- has no profile to keep.
  if v_status in ('inactive', 'rejected') then
    raise exception 'not_editable' using errcode = 'P0001';
  end if;

  if v_name = '' then
    raise exception 'name_required' using errcode = 'P0001';
  end if;
  if char_length(v_name) > 100 then
    raise exception 'name_too_long' using errcode = 'P0001';
  end if;
  if v_rel = '' then
    raise exception 'relationship_required' using errcode = 'P0001';
  end if;
  if char_length(v_rel) > 40 then
    raise exception 'relationship_too_long' using errcode = 'P0001';
  end if;
  if v_phone !~ '^\+[1-9][0-9]{6,14}$' then
    raise exception 'bad_phone' using errcode = 'P0001',
      hint = 'ADR-0044: E.164, with the country code — the /apply rule.';
  end if;

  insert into staff_emergency_contacts (staff_id, name, relationship, phone, updated_at, updated_by)
  values (v_id, v_name, v_rel, v_phone, now(),
          (select p.id from profiles p where p.id = auth.uid()))
  on conflict (staff_id) do update
    set name         = excluded.name,
        relationship = excluded.relationship,
        phone        = excluded.phone,
        updated_at   = excluded.updated_at,
        updated_by   = excluded.updated_by;

  return jsonb_build_object('ok', true, 'phone', v_phone);
end $$;

comment on function public.save_my_emergency_contact(text, text, text) is
  'ADR-0044: saves the calling worker''s emergency contact (name 1–100, relationship 1–40, phone E.164 after dropping separators). Raises name_required, name_too_long, relationship_required, relationship_too_long, bad_phone; not_editable for a leaver; account_closed for a removed worker. No notification.';

create or replace function public.clear_my_emergency_contact()
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_id uuid := staff_caller();
  v_status staff_status;
  v_cleared int;
begin
  if v_id is null then
    raise exception 'unknown_staff' using errcode = 'P0001';
  end if;
  select s.status into v_status from staff s where s.id = v_id for update;
  if v_status = 'removed' then
    raise exception 'account_closed' using errcode = 'P0001';
  end if;
  if v_status in ('inactive', 'rejected') then
    raise exception 'not_editable' using errcode = 'P0001';
  end if;

  delete from staff_emergency_contacts c where c.staff_id = v_id;
  get diagnostics v_cleared = row_count;
  return jsonb_build_object('ok', true, 'cleared', v_cleared > 0);
end $$;

comment on function public.clear_my_emergency_contact() is
  'ADR-0044: removes the calling worker''s emergency contact. not_editable for a leaver; account_closed for a removed worker.';

revoke execute on function public.my_emergency_contact()                        from public, anon;
revoke execute on function public.save_my_emergency_contact(text, text, text)   from public, anon;
revoke execute on function public.clear_my_emergency_contact()                  from public, anon;
grant  execute on function public.my_emergency_contact()                        to authenticated;
grant  execute on function public.save_my_emergency_contact(text, text, text)   to authenticated;
grant  execute on function public.clear_my_emergency_contact()                  to authenticated;
