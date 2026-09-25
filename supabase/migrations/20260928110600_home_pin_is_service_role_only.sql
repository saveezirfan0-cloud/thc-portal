-- =====================================================================
-- The home pin moves only through the server action that geocoded it
-- (§10.1 Profile details, §6 proximity · security audit 27.09, invariant 4)
--
-- The defect
-- ----------
-- 20260926110000 gave a worker staff_update_contact_geocoded(p_phone,
-- p_home_address, p_lat, p_lng), granted to `authenticated`, taking the
-- point from the caller with a UK bounding-box check and a "the address
-- must end in a postcode" check. The postcodes.io lookup lives in the
-- Staff App server action, not in the function — so a worker calling
-- PostgREST directly could change one character of their address and
-- place their pin beside any venue, gaming the 0.25 proximity factor of
-- their own auto-assign score.
--
-- The shape
-- ---------
-- The function becomes service-role only and takes the staff id, the same
-- shape as submit_application_as_caller (20260926100200, ADR-0024): the
-- server action resolves the worker from THEIR session (staff_me()),
-- geocodes the postcode itself, and calls this with the service key. The
-- worker's own session is still the only way to reach the action, and
-- the session can no longer reach the point.
--
-- staff_update_contact(text, text) — phone/address without a point —
-- stays a worker RPC: it cannot move the pin (the trigger flags the row
-- stale instead), so there is nothing in it to game. Its body moves into
-- staff_update_contact_for(uuid, text, text), which both wrappers call,
-- so the two paths cannot drift on phone_required / not_editable / E7.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1 · One implementation, given the worker
-- ---------------------------------------------------------------------
create or replace function public.staff_update_contact_for(
  p_staff        uuid,
  p_phone        text,
  p_home_address text
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  s staff;
  v_phone text := nullif(btrim(p_phone), '');
  v_addr  text := nullif(btrim(p_home_address), '');
  -- The ::text casts on the appends below are load-bearing. An untyped
  -- literal makes Postgres resolve `text[] || 'x'` as anyarray||anyarray
  -- and cast the literal to text[], which raises 22P02 malformed array
  -- literal at run time — not at create time, so it ships silently.
  v_changed text[] := '{}';
begin
  if p_staff is null then
    raise exception 'unknown_staff' using errcode = 'P0001';
  end if;
  if v_phone is null then
    raise exception 'phone_required' using errcode = 'P0001';
  end if;

  select * into s from staff where id = p_staff for update;
  if s.id is null then
    raise exception 'unknown_staff' using errcode = 'P0001';
  end if;

  -- A leaver keeps Payment information and nothing else (§10.6 step 7).
  if s.status in ('inactive', 'removed') then
    raise exception 'not_editable' using errcode = 'P0001';
  end if;

  if s.phone is distinct from v_phone then
    v_changed := v_changed || 'phone number'::text;
  end if;
  if s.home_address is distinct from v_addr then
    v_changed := v_changed || 'home address'::text;
  end if;

  if array_length(v_changed, 1) is null then
    return jsonb_build_object('ok', true, 'changed', to_jsonb(v_changed));
  end if;

  update staff
     set phone = v_phone,
         home_address = v_addr
   where id = p_staff;

  -- E7 for the address only (§8). A phone-only save is silent.
  if 'home address' = any (v_changed) then
    perform queue_contact_change(p_staff, 'home address');
  end if;

  return jsonb_build_object('ok', true, 'changed', to_jsonb(v_changed));
end $$;

comment on function public.staff_update_contact_for(uuid, text, text) is
  'The body of §10.1 Profile details, given the worker: phone required, a leaver frozen, E7 on an address change. Called only by staff_update_contact() (the worker''s own door) and staff_update_contact_geocoded() (the service role''s); not an RPC.';

revoke execute on function public.staff_update_contact_for(uuid, text, text)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- 2 · The worker's door, unchanged in what it does
-- ---------------------------------------------------------------------
create or replace function public.staff_update_contact(
  p_phone        text,
  p_home_address text
) returns jsonb
language sql
security definer
set search_path = public, extensions
as $$
  select staff_update_contact_for(staff_caller(), p_phone, p_home_address)
$$;

-- ---------------------------------------------------------------------
-- 3 · The geocoded save: service role only, and it names the worker
-- ---------------------------------------------------------------------
drop function if exists public.staff_update_contact_geocoded(text, text, double precision, double precision);

create function public.staff_update_contact_geocoded(
  p_staff        uuid,
  p_phone        text,
  p_home_address text,
  p_lat          double precision,
  p_lng          double precision
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_res jsonb;
  v_addr text := nullif(btrim(p_home_address), '');
  v_located boolean;
begin
  if p_staff is null then
    raise exception 'unknown_staff' using errcode = 'P0001';
  end if;
  if (p_lat is null) <> (p_lng is null) then
    raise exception 'bad_location' using errcode = 'P0001';
  end if;
  if p_lat is not null then
    if p_lat not between 49.0 and 61.0 or p_lng not between -9.0 and 2.5 then
      raise exception 'pin_outside_uk' using errcode = 'P0001';
    end if;
    if new_starter_postcode(v_addr) is null then
      raise exception 'no_postcode' using errcode = 'P0001';
    end if;
  end if;

  v_res := staff_update_contact_for(p_staff, p_phone, p_home_address);

  if coalesce(v_res->'changed', '[]'::jsonb) ? 'home address' then
    if p_lat is not null then
      update staff
         set home_location = st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography,
             home_location_stale = false
       where id = p_staff;
      v_located := true;
    else
      update staff set home_location_stale = true where id = p_staff;
      v_located := false;
    end if;
  end if;

  return v_res || jsonb_build_object('located', v_located);
end $$;

comment on function public.staff_update_contact_geocoded(uuid, text, text, double precision, double precision) is
  '§10.1 Profile details through the Staff App server action: staff_update_contact_for() plus the geocoded point for a changed address. Service role only — the action resolves the worker from their session and geocodes the postcode itself, so the point never comes from the caller. The point is ignored unless the address changed; no point on a change flags home_location_stale.';

revoke execute on function public.staff_update_contact_geocoded(uuid, text, text, double precision, double precision)
  from public, anon, authenticated;
grant execute on function public.staff_update_contact_geocoded(uuid, text, text, double precision, double precision)
  to service_role;
