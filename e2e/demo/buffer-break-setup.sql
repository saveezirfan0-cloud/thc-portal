-- Sets up the two shifts the buffer / break policy video (policy-*.mjs) needs.
-- Re-run it before every take: it deletes and recreates both shifts' bookings,
-- check-ins and breaks, and moves both shifts to start 20 minutes from now.
--
--   80…01 Private Dining  · The Dorchester  · breaks UNPAID, buffer paid · 7 h, 3 (+1)
--          Amara Kalu (the demo worker login) is confirmed: Start break / Finish break.
--   80…02 Rooftop Reception · Mandarin Oriental · breaks paid, buffer STRICT · 5 h, 1 (+1)
--          Priya Sharma has already checked in (the one place); Tom Reid (login) is confirmed
--          and is turned away on his check-in.
begin;

delete from check_logs where booking_id in (select id from bookings where shift_id in ('81000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000002'));
delete from breaks     where booking_id in (select id from bookings where shift_id in ('81000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000002'));
delete from violations where booking_id in (select id from bookings where shift_id in ('81000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000002'));
delete from bookings   where shift_id in ('81000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000002');

insert into events (id, client_id, venue_id, venue_name, venue_address, venue_location, geofence_radius_m,
                    title, event_date, notes, onsite_contact, po_number, pays_breaks, pays_buffer, auto_assign)
select e.id::uuid, c.id, v.id, v.name, v.address, v.location, v.geofence_radius_m,
       e.title, (now() at time zone 'Europe/London')::date, e.notes, e.onsite, e.po, c.pays_breaks, c.pays_buffer, false
from (values
  ('80000000-0000-4000-8000-000000000001','The Dorchester','The Dorchester','Private Dining','Deanery St entrance. Dress: black & whites.','Events Office','4510'),
  ('80000000-0000-4000-8000-000000000002','Mandarin Oriental','Mandarin Oriental Hyde Park','Rooftop Reception','Staff entrance Knightsbridge.','Duty Manager','4511')
) as e(id, client_name, venue_name, title, notes, onsite, po)
join clients c on c.name = e.client_name
join venues v on v.name = e.venue_name
on conflict (id) do update set event_date = excluded.event_date, pays_breaks = excluded.pays_breaks,
  pays_buffer = excluded.pays_buffer, cancelled_at = null;

insert into shift_requirements (id, event_id, role_id, starts_at, ends_at, headcount, buffer,
                                charge_rate, pay_rate, dress_code, allocation_per_hour)
select x.id::uuid, x.event_id::uuid, r.id,
       date_trunc('minute', now()) + interval '20 minutes',
       date_trunc('minute', now()) + interval '20 minutes' + x.len,
       x.headcount, x.buffer, x.charge, r.pay_rate, x.dress, x.headcount + x.buffer
from (values
  ('81000000-0000-4000-8000-000000000001','80000000-0000-4000-8000-000000000001','Waiting Staff', interval '7 hours', 3, 1, 24.10,'Black & whites'),
  ('81000000-0000-4000-8000-000000000002','80000000-0000-4000-8000-000000000002','Waiting Staff', interval '5 hours', 1, 1, 23.80,'All black')
) as x(id, event_id, role_name, len, headcount, buffer, charge, dress)
join roles r on r.name = x.role_name
on conflict (id) do update set starts_at = excluded.starts_at, ends_at = excluded.ends_at,
  headcount = excluded.headcount, buffer = excluded.buffer;

insert into bookings (shift_id, staff_id, status, source, confirmed_at, day_before_confirmed_at, on_day_confirmed_at)
select p.shift_id::uuid, p.staff_id::uuid, 'confirmed', 'auto', now() - interval '3 days', now() - interval '1 day', now() - interval '1 hour'
from (values
  ('81000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001'), -- Amara
  ('81000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000003'), -- Priya
  ('81000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000010'), -- Emily
  ('81000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000003'), -- Priya: first, already in
  ('81000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000002')  -- Tom: the buffer
) as p(shift_id, staff_id);

-- Priya has checked in to the Rooftop Reception, on time: the one place is taken.
update bookings set status = 'worked'
 where shift_id = '81000000-0000-4000-8000-000000000002' and staff_id = '20000000-0000-4000-8000-000000000003';
insert into check_logs (booking_id, attempted_at, outcome, location, distance_m, check_in_at, on_site_verified)
select b.id, now() - interval '5 minutes', 'checked_in', e.venue_location, 20, now() - interval '5 minutes', true
from bookings b join shift_requirements sr on sr.id = b.shift_id join events e on e.id = sr.event_id
where b.shift_id = '81000000-0000-4000-8000-000000000002' and b.staff_id = '20000000-0000-4000-8000-000000000003';

commit;
select e.title, e.pays_breaks, e.pays_buffer, sr.starts_at at time zone 'Europe/London' as starts_uk,
       (select count(*) from bookings b where b.shift_id = sr.id) bookings
from events e join shift_requirements sr on sr.event_id = e.id where e.id::text like '80000000-%';
