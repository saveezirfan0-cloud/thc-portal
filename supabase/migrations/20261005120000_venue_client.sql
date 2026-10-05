-- =====================================================================
-- A venue can belong to a client (§3.2, §9.11) — ADR-0087
--
-- Why this exists
-- ---------------
-- §3.2 builds an event as "client → venue": the manager picks a client,
-- then picks that client's venue from the whole Venues directory. For a
-- client with one site (Leonardo Hotel St Pauls → 10 Godliman Street) the
-- pick is pure friction and an invitation to choose the wrong address, and
-- the address is what every worker is sent to and what the geofence guards.
-- The agency's own client list pairs each client with its address(es), so
-- the link is data the office already has — it just had nowhere to live.
--
--   venues.client_id — the client this site belongs to. NULLABLE and
--   `on delete set null`: a venue that serves nobody in particular (a
--   public site, a venue not yet assigned) stays valid, and removing a
--   client never takes a geofence with it. One client may have several
--   venues (Hackney Town Council has five); a venue belongs to at most one
--   client, so a site two clients both use is entered once per client —
--   each with its own name, as the client knows it.
--
-- The Shift Builder reads it to pre-select the venue when a client is
-- chosen and the client has exactly one. Nothing here changes who can read
-- or write `venues` (admin_all only), nor what an event stores: the event
-- still copies the venue's name, address, pin and radius at build time.
--
-- Forward-only. `create or replace view` only appends a column, so every
-- existing column keeps its position and every grant on the view is kept.
-- The two write functions gain a trailing defaulted argument, which is a new
-- signature in Postgres, so the old ones are dropped first.
-- =====================================================================

alter table venues
  add column if not exists client_id uuid references clients(id) on delete set null;

comment on column venues.client_id is
  'The client this venue belongs to (ADR-0087), or NULL for a venue that is not tied to one. The Shift Builder pre-selects it when its client is chosen. Events copy the venue''s address at build time, so changing this never rewrites an event.';

-- Every foreign key is indexed (20260921123503_db_hardening).
create index if not exists venues_client_id_idx on venues (client_id);

-- ---------------------------------------------------------------------
-- venue_directory_v gains client_id and client_name
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
  v.created_at,
  (select count(*) from events e
     where e.venue_id = v.id and e.cancelled_at is null
       and e.event_date <  (now() at time zone 'Europe/London')::date)::int as events_past,
  (select count(*) from events e
     where e.venue_id = v.id and e.cancelled_at is null
       and e.event_date >= (now() at time zone 'Europe/London')::date)::int as events_upcoming,
  v.created_by,
  office_user_name(v.created_by)             as created_by_name,
  v.client_id,
  c.name                                     as client_name
from venues v
join venue_types vt on vt.key = v.venue_type
left join clients c on c.id = v.client_id
where v.deleted_at is null;

-- ---------------------------------------------------------------------
-- The write functions take the client
-- ---------------------------------------------------------------------
drop function if exists public.create_venue(text, text, double precision, double precision, text, integer);
drop function if exists public.update_venue(uuid, text, text, double precision, double precision, text, integer);

create or replace function create_venue(
  p_name text,
  p_address text,
  p_lat double precision,
  p_lng double precision,
  p_venue_type text,
  p_geofence_radius_m int,
  p_client_id uuid default null
) returns uuid
language plpgsql security invoker
set search_path = public, extensions
as $$
declare v_id uuid;
begin
  perform assert_venue_input(p_name, p_address, p_lat, p_lng);
  insert into venues (name, address, location, venue_type, geofence_radius_m, client_id)
  values (btrim(p_name), btrim(p_address), venue_point(p_lat, p_lng),
          p_venue_type, p_geofence_radius_m, p_client_id)
  returning id into v_id;
  return v_id;
end;
$$;

comment on function create_venue is
  'Creates a venue from the §9.11 modal, optionally tied to a client (ADR-0087). security invoker: venues'' admin_all policy is the gate.';

create or replace function update_venue(
  p_id uuid,
  p_name text,
  p_address text,
  p_lat double precision,
  p_lng double precision,
  p_venue_type text,
  p_geofence_radius_m int,
  p_client_id uuid default null
) returns void
language plpgsql security invoker
set search_path = public, extensions
as $$
begin
  perform assert_venue_input(p_name, p_address, p_lat, p_lng);
  update venues set
    name              = btrim(p_name),
    address           = btrim(p_address),
    location          = venue_point(p_lat, p_lng),
    venue_type        = p_venue_type,
    geofence_radius_m = p_geofence_radius_m,
    client_id         = p_client_id
  where id = p_id and deleted_at is null;

  if not found then
    raise exception 'No live venue %', p_id using errcode = 'no_data_found';
  end if;
end;
$$;

comment on function update_venue is
  'Edits a live venue (§9.11), including the client it belongs to (ADR-0087). Events keep their own snapshot of address, location and radius, so editing a venue never rewrites an event that is already built.';
