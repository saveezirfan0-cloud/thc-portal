-- =====================================================================
-- A worker's home location follows their address (§10.1, §6 proximity)
--
-- 20260922180000 let a worker edit their home address on /profile/details
-- and deliberately left `staff.home_location` alone: with no geocoder, the
-- only honest thing was to tell the office (E7) and let them move the pin.
-- The pin drives the proximity factor in §6 auto-assign scoring (0.25 of
-- the score), so in practice it went stale on every move.
--
-- The Staff App now geocodes the postcode on its way in (postcodes.io, the
-- lookup the onboarding wizard already uses) and hands the point to
-- staff_update_contact_geocoded() below, WITH the address it came from.
--
-- Three rules, all enforced here rather than in the app:
--
--   · A point is only accepted alongside a change of address. The function
--     ignores p_lat/p_lng when the address is unchanged, so it is not a way
--     to move one's own pin at will (which would move one's own score).
--   · The point must be in the UK box onboarding_save_address() uses, and
--     the new address must end in a postcode — a point for an address with
--     no postcode cannot have come from a postcode lookup.
--   · A failed lookup saves the address, clears nothing, and sets
--     `home_location_stale`. The office sees the flag on the worker's
--     profile and knows proximity for this worker is off.
--
-- The flag is also kept by a trigger, so every other path that moves the
-- address without the pin (the original two-argument staff_update_contact,
-- an office edit) flags it too, and every path that moves the pin (the
-- wizard, this function, GDPR removal) clears it.
-- =====================================================================

alter table staff add column if not exists home_location_stale boolean not null default false;

comment on column staff.home_location_stale is
  'True when home_address changed without home_location following it (a failed postcode lookup, or an edit that did not re-geocode). §6 proximity for this worker is then based on their previous address. Cleared whenever home_location moves.';

-- ---------------------------------------------------------------------
-- 1 · The flag, maintained on every path
--
-- An explicit write of the flag in the same statement wins, which is how
-- the function below clears it when a new point happens to equal the old
-- one (the same postcode, re-typed) — geography equality would otherwise
-- read that as "the pin did not move".
-- ---------------------------------------------------------------------
create or replace function public.staff_home_location_staleness() returns trigger
language plpgsql set search_path = public, extensions as $$
begin
  if new.home_location_stale is distinct from old.home_location_stale then
    return new;
  end if;
  if new.home_location is distinct from old.home_location then
    new.home_location_stale := false;
  elsif new.home_address is distinct from old.home_address and new.removed_at is null then
    new.home_location_stale := true;
  end if;
  return new;
end $$;

drop trigger if exists staff_home_location_staleness on staff;
create trigger staff_home_location_staleness
  before update of home_address, home_location on staff
  for each row execute function public.staff_home_location_staleness();

revoke execute on function public.staff_home_location_staleness() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 2 · Profile details with a geocoded point (§10.1)
--
-- Everything staff_update_contact() enforces — caller from the session,
-- phone required, leavers frozen, E7 on an address change in the same
-- transaction — it still enforces: this calls it, then moves the pin.
-- Validation of the point happens BEFORE that call, so a refused point
-- saves nothing at all.
--
-- Returns staff_update_contact()'s answer plus `located`: true when the
-- pin moved, false when the address changed but no point came with it
-- (flagged stale), null when the address did not change.
-- ---------------------------------------------------------------------
create or replace function public.staff_update_contact_geocoded(
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
  v_id uuid := staff_caller();
  v_res jsonb;
  v_addr text := nullif(btrim(p_home_address), '');
  v_located boolean;
begin
  if v_id is null then
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

  v_res := staff_update_contact(p_phone, p_home_address);

  if coalesce(v_res->'changed', '[]'::jsonb) ? 'home address' then
    if p_lat is not null then
      update staff
         set home_location = st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography,
             home_location_stale = false
       where id = v_id;
      v_located := true;
    else
      update staff set home_location_stale = true where id = v_id;
      v_located := false;
    end if;
  end if;

  return v_res || jsonb_build_object('located', v_located);
end $$;

comment on function public.staff_update_contact_geocoded(text, text, double precision, double precision) is
  '§10.1 Profile details: staff_update_contact() plus the geocoded point for a changed address. The point is ignored unless the address changed; no point on a change flags home_location_stale.';

revoke execute on function public.staff_update_contact_geocoded(text, text, double precision, double precision)
  from public, anon;
grant execute on function public.staff_update_contact_geocoded(text, text, double precision, double precision)
  to authenticated;

-- ---------------------------------------------------------------------
-- 3 · Who reads the flag
--
-- #44 (20260923090000) re-granted staff column by column, and a column
-- added since is unreadable until a migration names it (445 asserts every
-- column but block_reason and rejection_reason is granted). This one
-- carries nothing internal: the office reads it through admin_all to show
-- "location out of date" on the worker's profile (§9.10), a worker may see
-- their own through staff_self, and a client has no policy on staff at all.
-- staff_profile_v is not widened for one flag on one screen.
-- ---------------------------------------------------------------------
grant select (home_location_stale) on table public.staff to anon, authenticated;
