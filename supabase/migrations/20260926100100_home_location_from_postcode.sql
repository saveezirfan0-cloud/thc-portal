-- =====================================================================
-- home_location follows the postcode (ADR-0025)
--
-- Until now a worker who edited their home address on the profile kept
-- the pin they dropped at onboarding 2/11. 20260922180000 said so in
-- staff_update_contact's header — "re-deriving it from free text with no
-- geocoder would move a worker's score on a typo" — and left it to E7 and
-- the office. docs/14 §4 carried that as a gap: nothing made the office
-- do it, there is no office screen to do it on, and the §6 proximity
-- factor (100 − km × 9) — and every distance the app prints from
-- home_location — scored the worker from an address they had left.
--
-- The decision (ADR-0025): a changed address re-derives home_location
-- from its UK postcode via postcodes.io — the centroid, ~100 m, which is
-- under one proximity point — and records where the point came from. The
-- lookup happens in the app (no geocoder in the database, and none
-- wanted); what the database holds is the rule that makes a point from a
-- phone safe to accept:
--
--   · the caller only. staff_caller(), no id argument, as every §10.1
--     function.
--   · the postcode must appear in the caller's CURRENT home_address. A
--     worker can move their own pin to a postcode they have just typed
--     into their own address, and to nothing else — so a forged call
--     cannot park them next to every venue in the city, and the typo the
--     old header feared is bounded to the postcode the worker wrote.
--   · inside the UK box onboarding_save_address() already refuses outside
--     of. postcodes.io never answers outside it; a forged point can.
--
-- staff_update_contact() is untouched: it still saves the address, still
-- queues E7, and still does not move the pin itself. The app calls this
-- second, after the address is saved, so an unreachable lookup leaves the
-- address saved, the old point in place, E7 queued — and the screen says
-- the office will update the pin, which is what E7 asks of them anyway.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1 · Where the current point came from
-- ---------------------------------------------------------------------
alter table staff
  add column if not exists home_location_source text not null default 'pin'
  constraint staff_home_location_source_known
  check (home_location_source in ('pin', 'postcode', 'office'));

comment on column staff.home_location_source is
  'Where home_location came from. ''pin'': the worker placed it (onboarding 2/11) — also the label while there is no point. ''postcode'': the centroid of the postcode in home_address, ~100 m (ADR-0025). ''office'': a manager moved it. A write that moves the point without restating this in a SECOND statement is labelled ''pin'' by staff_home_location_moved().';

-- #44 (20260923090000) revoked the table-wide SELECT on staff and grants
-- columns by name; 445 asserts every column but the two reasons carries
-- the grant. The label says nothing about the worker that their own
-- address on the same row does not.
grant select (home_location_source) on table public.staff to anon, authenticated;

-- ---------------------------------------------------------------------
-- 2 · The label stays honest whoever moves the point
--
-- Three things write home_location today: onboarding_save_address() (the
-- worker's pin), GDPR removal (null) and the function below. Neither of
-- the first two knows the label exists, and a future office "move the
-- pin" may not either. So a statement that moves the point and does not
-- restate the source gets 'pin' — the label for a point somebody placed —
-- and a writer that means something else says so in a SECOND statement,
-- as staff_set_home_location_from_postcode() does. It updates twice
-- rather than once because "set the point and the label together" cannot
-- be told apart from "set the point and leave the label alone" when the
-- old label already reads 'postcode'.
-- ---------------------------------------------------------------------
create or replace function public.staff_home_location_moved() returns trigger
language plpgsql set search_path = public, extensions as $$
begin
  if new.home_location is distinct from old.home_location
     and new.home_location_source is not distinct from old.home_location_source then
    new.home_location_source := 'pin';
  end if;
  return new;
end $$;

comment on function public.staff_home_location_moved() is
  'A move of staff.home_location that does not restate home_location_source is a placed pin (ADR-0025). Writers meaning ''postcode'' or ''office'' set the label in a second statement.';

drop trigger if exists staff_home_location_moved on staff;
create trigger staff_home_location_moved
  before update of home_location on staff
  for each row execute function public.staff_home_location_moved();

-- ---------------------------------------------------------------------
-- 3 · The worker's pin follows the postcode they wrote (§10.1, ADR-0025)
--
-- Called by the profile's address save AFTER staff_update_contact() has
-- saved the address and queued E7, with the centroid postcodes.io gave
-- for the postcode the app pulled out of the new address. The point is
-- not taken on trust: the postcode must be in the address the caller
-- themselves saved, and the point must be inside the UK.
-- ---------------------------------------------------------------------
create or replace function public.staff_set_home_location_from_postcode(
  p_postcode text,
  p_lat      double precision,
  p_lng      double precision
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_id uuid := staff_caller();
  s staff;
  -- Normalised the way every postcode in the system is compared: upper
  -- case, no whitespace, so "e2 0ry" and "E20RY" are one value.
  v_pc   text := upper(regexp_replace(coalesce(p_postcode, ''), '\s', '', 'g'));
  v_addr text;
begin
  if v_id is null then
    raise exception 'unknown_staff' using errcode = 'P0001';
  end if;
  if v_pc !~ '^[A-Z]{1,2}[0-9][A-Z0-9]?[0-9][A-Z]{2}$' then
    raise exception 'bad_postcode' using errcode = 'P0001';
  end if;

  select * into s from staff where id = v_id for update;

  -- A leaver's details are frozen (§10.6 step 7), the pin included.
  if s.status in ('inactive', 'removed') then
    raise exception 'not_editable' using errcode = 'P0001';
  end if;

  -- The one thing that makes a point from a phone safe to accept: it is
  -- the postcode of the address the worker themselves saved, compared
  -- with the same normalisation on both sides.
  v_addr := upper(regexp_replace(coalesce(s.home_address, ''), '\s', '', 'g'));
  if position(v_pc in v_addr) = 0 then
    raise exception 'postcode_not_in_address' using errcode = 'P0001';
  end if;

  -- The same box onboarding_save_address() refuses outside of.
  if p_lat is null or p_lng is null
     or p_lat not between 49.0 and 61.0 or p_lng not between -9.0 and 2.5 then
    raise exception 'pin_outside_uk' using errcode = 'P0001';
  end if;

  -- Two statements, not one: see staff_home_location_moved() above.
  update staff
     set home_location = st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography
   where id = v_id;
  update staff set home_location_source = 'postcode' where id = v_id;

  return jsonb_build_object(
    'ok',       true,
    'source',   'postcode',
    'postcode', left(v_pc, length(v_pc) - 3) || ' ' || right(v_pc, 3),
    'lat',      p_lat,
    'lng',      p_lng);
end $$;

comment on function public.staff_set_home_location_from_postcode(text, double precision, double precision) is
  'ADR-0025: the caller''s own home_location from the centroid of a postcode that appears in their current home_address, inside the UK. Called after staff_update_contact(); E7 is that function''s and unchanged.';

-- ---------------------------------------------------------------------
-- Grants: the worker, and nobody else. No job calls it and it has no
-- subject but auth.uid(), so service_role's bootstrap grant is taken
-- back as well — a call from a service key could only ever be a bug.
-- ---------------------------------------------------------------------
revoke execute on function public.staff_set_home_location_from_postcode(text, double precision, double precision)
  from public, anon, service_role;
grant execute on function public.staff_set_home_location_from_postcode(text, double precision, double precision)
  to authenticated;
