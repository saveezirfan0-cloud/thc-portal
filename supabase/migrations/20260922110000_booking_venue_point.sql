-- =====================================================================
-- booking_venue_point() — the venue's centre, as two numbers (§5.1)
--
-- The shift screen shows the worker how far they are from the venue while
-- they are still on their way ("You're 1.8 km from the venue. Check-in
-- opens within 150 m"), which needs the venue's coordinates on the client.
-- `events.venue_location` is a PostGIS geography and PostgREST hands it
-- back as WKB, so a plain select cannot give the screen a lat/lng pair.
--
-- This is deliberately a reader and nothing else. The distance that DECIDES
-- anything is computed inside attempt_check_in() and check_out() from the
-- fix the device sends, server side, against the same column — a screen
-- that got this wrong could mislead a worker, but it cannot let them check
-- in from the wrong place.
--
-- security definer with the booking's own ownership test, because a worker
-- holds no select policy on `events`: their booking is the only reason they
-- are entitled to this venue's location at all.
-- =====================================================================
create or replace function booking_venue_point(p_booking uuid)
returns jsonb language plpgsql stable security definer set search_path = public, extensions as $$
declare
  b  bookings;
  ev events;
begin
  select * into b from bookings where id = p_booking;
  if b.id is null then raise exception 'booking_not_found' using errcode = 'P0002'; end if;

  if current_app_role() is distinct from 'admin'
     and b.staff_id is distinct from (select id from staff where user_id = auth.uid()) then
    raise exception 'not_your_booking' using errcode = '42501';
  end if;

  select e.* into ev from events e
    join shift_requirements sr on sr.event_id = e.id
   where sr.id = b.shift_id;

  return jsonb_build_object(
    'lat', st_y(ev.venue_location::geometry),
    'lng', st_x(ev.venue_location::geometry),
    'radiusM', ev.geofence_radius_m);
end $$;

comment on function booking_venue_point is
  '§5.1. The venue centre and radius for the shift screen''s map and distance line. A reader only — the distance that decides a check-in is computed server side in attempt_check_in().';

grant execute on function booking_venue_point(uuid) to authenticated;
