-- =====================================================================
-- Migration 0005 · the Venues directory (§9.11)
--
-- Why this exists
-- ---------------
-- 0001_init.sql has everything the venue ENTITY needs — name, address,
-- location, venue_type, geofence_radius_m, deleted_at — and 0004_rls_gaps
-- policed venue_types. Three things the /venues screen needs are still
-- missing, and all three belong in the database rather than in the app:
--
--   1. The list's two counts. "Events" on the list is how many events have
--      taken place at the venue (§9.11); the delete confirmation needs the
--      opposite number, how many UPCOMING events use it. Counting those in
--      the app means one round trip per row.
--   2. A lat/lng the browser can read. `location` is geography(point,4326);
--      PostgREST hands that back as WKB hex, which the map would have to
--      parse. The view exposes st_y/st_x so the pin is plain numbers.
--   3. A way to write a point. A PostgREST insert cannot build a geography
--      from a JSON body, and the radius/type/coordinate rules should be
--      rejected by the database too, not only by the form.
--
-- Everything below is `security invoker` / `security_invoker = true`, so
-- RLS on `venues` is what decides who sees and writes what: admin has
-- admin_all (0001), and staff and client have no policy on venues at all.
-- Nothing here grants anybody anything they did not already have.
--
-- Forward-only: 0001, 0002 and 0004 are left untouched.
-- =====================================================================

-- ---------------------------------------------------------------------
-- venue_types.sort_order — the order §9.11 prints the standard radii in
--
-- The scope's table runs Restaurant / bar · Hotel · Private residence ·
-- Conference · Exhibition · Stadium · Racecourse · Outdoor · Other: by
-- radius, except that "Other" is last whatever its radius is. That order is
-- part of the reference data, so it lives beside the data and not in a
-- hard-coded list in the Venues screen.
-- ---------------------------------------------------------------------
alter table venue_types add column if not exists sort_order int;

update venue_types set sort_order = v.sort_order
  from (values
    ('restaurant_bar', 1), ('hotel', 2), ('private_residence', 3), ('conference', 4),
    ('exhibition', 5), ('stadium', 6), ('racecourse', 7), ('outdoor', 8), ('other', 9)
  ) as v(key, sort_order)
 where venue_types.key = v.key and venue_types.sort_order is distinct from v.sort_order;

-- A type added later without an explicit position sorts by its radius,
-- after everything the scope names.
update venue_types set sort_order = 100 + default_radius_m where sort_order is null;

alter table venue_types alter column sort_order set not null;
alter table venue_types alter column sort_order set default 999;

comment on column venue_types.sort_order is
  'Display order of the §9.11 standard-radius table. Editable in /settings alongside default_radius_m.';

-- events.venue_id is read once per venue row by the counts below and again
-- by the delete confirmation. It has no index today.
create index if not exists events_venue_id_idx on events (venue_id);

-- Soft-deleted venues are filtered out of every list (§9.11), so the index
-- the screen actually uses is the partial one over the live rows.
create index if not exists venues_live_name_idx on venues (name) where deleted_at is null;

-- ---------------------------------------------------------------------
-- venue_directory_v — one row per venue, everything /venues renders
--
-- "Today" is Europe/London, not UTC: an event on tonight's date is still
-- upcoming at 00:30 UK time, and §1.8 evaluates every rule in UK time.
-- Cancelled events are counted as neither — they did not take place, and
-- they are not upcoming.
-- ---------------------------------------------------------------------
create or replace view venue_directory_v with (security_invoker = true) as
select
  v.id,
  v.name,
  v.address,
  v.venue_type,
  vt.label                                   as venue_type_label,
  vt.default_radius_m,
  v.geofence_radius_m,
  st_y(v.location::geometry)                 as lat,
  st_x(v.location::geometry)                 as lng,
  v.deleted_at,
  v.created_at,
  (select count(*) from events e
     where e.venue_id = v.id and e.cancelled_at is null
       and e.event_date <  (now() at time zone 'Europe/London')::date)::int as events_past,
  (select count(*) from events e
     where e.venue_id = v.id and e.cancelled_at is null
       and e.event_date >= (now() at time zone 'Europe/London')::date)::int as events_upcoming
from venues v
join venue_types vt on vt.key = v.venue_type;

comment on view venue_directory_v is
  'The /venues list and map (§9.11): venue + its type label and default radius + the pin as plain lat/lng + how many events have taken place there and how many are still upcoming. security_invoker, so venues'' RLS applies unchanged.';

-- ---------------------------------------------------------------------
-- venue_upcoming_events_v — the delete confirmation's list
--
-- §9.11: the confirmation states how many upcoming events use the venue
-- and names them ("Afternoon Tea (Thu 18 Sep), …").
-- ---------------------------------------------------------------------
create or replace view venue_upcoming_events_v with (security_invoker = true) as
select e.venue_id, e.id as event_id, e.title, e.event_date
from events e
where e.venue_id is not null
  and e.cancelled_at is null
  and e.event_date >= (now() at time zone 'Europe/London')::date;

comment on view venue_upcoming_events_v is
  'Upcoming events per venue, for the §9.11 delete confirmation. security_invoker: a client sees only their own events, exactly as the events policy says.';

-- ---------------------------------------------------------------------
-- Writes
--
-- The radius range and the venue_type reference are already CHECK and FK
-- constraints on `venues`; what these add is the coordinate range, the
-- empty-string cases that a `not null` column happily accepts, and a
-- single place that builds the geography. They are `security invoker`, so
-- a caller who is not admin is stopped by RLS on venues, not by a role
-- test written here.
-- ---------------------------------------------------------------------
create or replace function venue_point(p_lat double precision, p_lng double precision)
returns geography
language sql immutable as $$
  select st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography
$$;

comment on function venue_point is
  'lat/lng → geography(point,4326). Note the argument order: st_makepoint takes X (longitude) first.';

create or replace function assert_venue_input(
  p_name text, p_address text, p_lat double precision, p_lng double precision
) returns void
language plpgsql immutable as $$
begin
  if coalesce(btrim(p_name), '') = '' then
    raise exception 'A venue needs a name' using errcode = 'check_violation';
  end if;
  -- §9.11: the address is reverse-geocoded from the pin, never typed. An
  -- empty one means the lookup did not resolve, and the row must not be
  -- written with a blank address a manager cannot correct.
  if coalesce(btrim(p_address), '') = '' then
    raise exception 'A venue needs an address from the pin' using errcode = 'check_violation';
  end if;
  if p_lat is null or p_lat < -90 or p_lat > 90 then
    raise exception 'Latitude % is out of range', p_lat using errcode = 'check_violation';
  end if;
  if p_lng is null or p_lng < -180 or p_lng > 180 then
    raise exception 'Longitude % is out of range', p_lng using errcode = 'check_violation';
  end if;
end;
$$;

create or replace function create_venue(
  p_name text,
  p_address text,
  p_lat double precision,
  p_lng double precision,
  p_venue_type text,
  p_geofence_radius_m int
) returns uuid
language plpgsql security invoker as $$
declare v_id uuid;
begin
  perform assert_venue_input(p_name, p_address, p_lat, p_lng);
  insert into venues (name, address, location, venue_type, geofence_radius_m)
  values (btrim(p_name), btrim(p_address), venue_point(p_lat, p_lng),
          p_venue_type, p_geofence_radius_m)
  returning id into v_id;
  return v_id;
end;
$$;

comment on function create_venue is
  'Creates a venue from the §9.11 modal. security invoker: venues'' admin_all policy is the gate.';

create or replace function update_venue(
  p_id uuid,
  p_name text,
  p_address text,
  p_lat double precision,
  p_lng double precision,
  p_venue_type text,
  p_geofence_radius_m int
) returns void
language plpgsql security invoker as $$
begin
  perform assert_venue_input(p_name, p_address, p_lat, p_lng);
  update venues set
    name              = btrim(p_name),
    address           = btrim(p_address),
    location          = venue_point(p_lat, p_lng),
    venue_type        = p_venue_type,
    geofence_radius_m = p_geofence_radius_m
  where id = p_id and deleted_at is null;

  if not found then
    raise exception 'No live venue %', p_id using errcode = 'no_data_found';
  end if;
end;
$$;

comment on function update_venue is
  'Edits a live venue (§9.11). Events keep their own snapshot of address, location and radius, so editing a venue never rewrites an event that is already built.';

create or replace function delete_venue(p_id uuid) returns void
language plpgsql security invoker as $$
begin
  -- Soft delete (§9.11). Deleting removes the venue from selection when
  -- new events are built; past and already-scheduled events keep the
  -- address, location and radius events copied at build time, so nothing
  -- that is already in the diary breaks.
  update venues set deleted_at = now() where id = p_id and deleted_at is null;

  if not found then
    raise exception 'No live venue %', p_id using errcode = 'no_data_found';
  end if;
end;
$$;

comment on function delete_venue is
  'Soft-deletes a venue (§9.11): sets deleted_at, keeps the row, never touches the snapshot columns on events.';
