-- =====================================================================
-- Migration 20261012121400 · the onboarding home pin is checked against
--                            the postcode the server looked up
--                            (§2.3 step 2/11, §6 proximity)
--
-- 20260928110600 closed the Profile path: a worker's session can no
-- longer name a home point, because staff_update_contact_geocoded() is
-- service-role only and the server action geocodes the postcode itself.
-- The onboarding wizard's step 2 was left on the old shape:
-- onboarding_save_address(p_line, p_town, p_postcode, p_lat, p_lng),
-- granted to `authenticated`, takes the pin from the caller and checks
-- only the UK bounding box. A candidate calling PostgREST directly could
-- therefore set the address to their real one and the pin beside the
-- busiest venue — 0.25 of every auto-assign score is proximity (§6).
-- Staff App audit 12.10.2026, item 20.
--
-- The wizard lets the candidate drag the pin (a postcode centroid can be
-- half a mile from the door), so the pin stays theirs — but within 5 km
-- of the postcode's centroid, which only the server supplies:
--
--   onboarding_save_address_geocoded(
--     p_staff uuid, p_line text, p_town text, p_postcode text,
--     p_lat double precision, p_lng double precision,
--     p_postcode_lat double precision, p_postcode_lng double precision)
--   returns jsonb                                   -- service role only
--
-- The Staff App's step-2 action resolves the candidate from THEIR session
-- (staff_me() → staffId), looks the postcode up itself (postcodes.io, as
-- profile/geocode.ts does) and calls this with the admin client. Refusals,
-- all P0001: the existing wrong_stage / previous_step /
-- documents_submitted / address_required / bad_postcode / pin_outside_uk /
-- unknown_staff, plus
--
--   postcode_not_located    p_postcode_lat/lng missing or outside the UK box
--   pin_far_from_postcode   the pin is more than 5 km from that centroid
--
-- onboarding_save_address() keeps its body (now a wrapper over the same
-- implementation, onboarding_save_address_for) but loses EXECUTE for
-- `authenticated`: a session can no longer place a pin at all.
-- 800_onboarding_home_pin_is_server_geocoded pins it.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1 · One implementation, given the candidate (20260923120000's body)
-- ---------------------------------------------------------------------
create or replace function public.onboarding_save_address_for(
  p_staff    uuid,
  p_line     text,
  p_town     text,
  p_postcode text,
  p_lat      double precision,
  p_lng      double precision
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  s staff;
  p onboarding_progress;
  v_line text := nullif(btrim(coalesce(p_line, '')), '');
  v_town text := nullif(btrim(coalesce(p_town, '')), '');
  v_pc   text := upper(regexp_replace(coalesce(p_postcode, ''), '\s', '', 'g'));
  v_addr text;
begin
  if p_staff is not null then
    select * into s from staff where id = p_staff for update;
  end if;
  if s.id is null then
    raise exception 'unknown_staff' using errcode = 'P0001';
  end if;
  if s.status <> 'documents' then
    raise exception 'wrong_stage' using errcode = 'P0001';
  end if;
  select * into p from onboarding_progress where staff_id = s.id;
  if p.rtw_at is null then
    raise exception 'previous_step' using errcode = 'P0001';
  end if;
  if p.documents_at is not null then
    raise exception 'documents_submitted' using errcode = 'P0001';
  end if;
  if v_line is null or v_town is null then
    raise exception 'address_required' using errcode = 'P0001';
  end if;
  if v_pc !~ '^[A-Z]{1,2}[0-9][A-Z0-9]?[0-9][A-Z]{2}$' then
    raise exception 'bad_postcode' using errcode = 'P0001';
  end if;
  -- Great Britain and Northern Ireland, generously. A pin in the Atlantic
  -- is a slipped finger, and it would rank every venue as far away.
  if p_lat is null or p_lng is null
     or p_lat not between 49.0 and 61.0 or p_lng not between -9.0 and 2.5 then
    raise exception 'pin_outside_uk' using errcode = 'P0001';
  end if;

  v_pc := left(v_pc, length(v_pc) - 3) || ' ' || right(v_pc, 3);
  v_addr := v_line || ', ' || v_town || ' ' || v_pc;

  update staff
     set home_address = v_addr,
         home_location = st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography
   where id = s.id;
  update onboarding_progress set address_at = now(), updated_at = now() where staff_id = s.id;

  return jsonb_build_object('ok', true, 'homeAddress', v_addr);
end $$;

comment on function public.onboarding_save_address_for(uuid, text, text, text, double precision, double precision) is
  'Step 2/11 home address for a named candidate (20260923120000''s gates). Internal: onboarding_save_address() and onboarding_save_address_geocoded() call it. 20261012121400.';

revoke execute on function public.onboarding_save_address_for(uuid, text, text, text, double precision, double precision)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 2 · The old door: unchanged behaviour, no longer a session's
-- ---------------------------------------------------------------------
create or replace function public.onboarding_save_address(
  p_line text, p_town text, p_postcode text, p_lat double precision, p_lng double precision)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  return onboarding_save_address_for(staff_caller(), p_line, p_town, p_postcode, p_lat, p_lng);
end $$;

comment on function public.onboarding_save_address(text, text, text, double precision, double precision) is
  'Step 2/11 home address for the caller. Since 20261012121400 not executable by authenticated — a session may not place its own pin; the Staff App calls onboarding_save_address_geocoded() with the service key.';

revoke execute on function public.onboarding_save_address(text, text, text, double precision, double precision)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 3 · The new door: the pin within 5 km of the server's centroid
-- ---------------------------------------------------------------------
create or replace function public.onboarding_save_address_geocoded(
  p_staff        uuid,
  p_line         text,
  p_town         text,
  p_postcode     text,
  p_lat          double precision,
  p_lng          double precision,
  p_postcode_lat double precision,
  p_postcode_lng double precision
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if p_staff is null then
    raise exception 'unknown_staff' using errcode = 'P0001';
  end if;
  if p_postcode_lat is null or p_postcode_lng is null
     or p_postcode_lat not between 49.0 and 61.0 or p_postcode_lng not between -9.0 and 2.5 then
    raise exception 'postcode_not_located' using errcode = 'P0001';
  end if;
  if p_lat is not null and p_lng is not null
     and p_lat between 49.0 and 61.0 and p_lng between -9.0 and 2.5
     and st_distance(st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography,
                     st_setsrid(st_makepoint(p_postcode_lng, p_postcode_lat), 4326)::geography) > 5000 then
    raise exception 'pin_far_from_postcode' using errcode = 'P0001';
  end if;
  return onboarding_save_address_for(p_staff, p_line, p_town, p_postcode, p_lat, p_lng);
end $$;

comment on function public.onboarding_save_address_geocoded(uuid, text, text, text, double precision, double precision, double precision, double precision) is
  'Step 2/11 home address (§2.3, §6), service role only: the Staff App resolves the candidate from their session, geocodes the postcode itself and passes its centroid; the pin must be within 5 km of it (pin_far_from_postcode), and a missing centroid is postcode_not_located. Then onboarding_save_address_for(). 20261012121400.';

revoke execute on function public.onboarding_save_address_geocoded(uuid, text, text, text, double precision, double precision, double precision, double precision)
  from public, anon, authenticated;
grant  execute on function public.onboarding_save_address_geocoded(uuid, text, text, text, double precision, double precision, double precision, double precision)
  to service_role;
