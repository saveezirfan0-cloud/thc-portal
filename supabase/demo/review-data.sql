-- =====================================================================
-- Review data: fills the screens seed.sql leaves empty, for a client
-- walk-through (docs/15 §5).
--
-- seed.sql gives the directory, the kanban and the upcoming events. It
-- leaves nothing happening TODAY and no history: no check-ins, violations,
-- breaks, client feedback, applications or cancellations, so the Check-in
-- monitor, Violations, Reports, Feedback and the worker's "today" card all
-- render empty. This file adds exactly that, on top of seed.sql.
--
-- Run it AFTER seed.sql, on the morning of a review:
--   psql "$DATABASE_URL" -f supabase/demo/review-data.sql
-- (or paste into the SQL editor). It is IDEMPOTENT: fixed UUIDs, upserts,
-- and the "today" event is re-dated to the day it is run, with its role
-- windows placed around the current hour so it always reads as in progress.
--
-- Never run it against a database holding real workers: it writes check
-- logs, violations and feedback for the seed's demo people only.
-- =====================================================================
begin;

-- Refuse to run on anything that is not the demo seed.
do $$ begin
  if not exists (select 1 from staff where id = '20000000-0000-4000-8000-000000000002' and email = 'tom.reid@example.com') then
    raise exception 'review-data.sql: the seed.sql demo workers are not present — refusing to run';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- TODAY — "Corporate Lunch & Reception" for Leonardo (the demo client
-- login's own company, so the Client Portal shows it too).
-- Waiting Staff started two hours ago and runs four more; Bar Staff starts
-- when it ends. Tom Reid (the demo worker login) is checked in on time.
-- ---------------------------------------------------------------------
insert into events (id, client_id, venue_id, venue_name, venue_address, venue_location, geofence_radius_m,
                    title, event_date, notes, onsite_contact, po_number, pays_breaks, pays_buffer, auto_assign)
select '70000000-0000-4000-8000-000000000001'::uuid, c.id, v.id, v.name, v.address, v.location, v.geofence_radius_m,
       'Corporate Lunch & Reception',
       (date_trunc('hour', now() at time zone 'Europe/London') - interval '2 hours')::date,
       'Wren Suite, then the Cathedral Suite for the reception. Staff entrance on Carter Lane.',
       'Banqueting Manager', '4502', c.pays_breaks, c.pays_buffer, true
from clients c, venues v
where c.name = 'Leonardo Hotel St Pauls' and v.name = 'Leonardo Royal Hotel'
on conflict (id) do update set event_date = excluded.event_date, title = excluded.title,
  notes = excluded.notes, cancelled_at = null, cancel_reason = null, cancelled_by = null;

with w as (select date_trunc('hour', now()) - interval '2 hours' as s)
insert into shift_requirements (id, event_id, role_id, starts_at, ends_at, headcount, buffer,
                                charge_rate, pay_rate, dress_code, allocation_per_hour)
select x.id::uuid, '70000000-0000-4000-8000-000000000001'::uuid, r.id, x.starts_at, x.ends_at,
       x.headcount, x.buffer, x.charge_rate, r.pay_rate, x.dress_code, x.headcount + x.buffer
from w, lateral (values
  ('71000000-0000-4000-8000-000000000001','Waiting Staff', w.s,                        w.s + interval '6 hours', 4, 1, 22.97, 'Black & whites'),
  ('71000000-0000-4000-8000-000000000002','Bar Staff',     w.s + interval '6 hours',   w.s + interval '11 hours', 2, 0, 26.40, 'Black shirt & apron')
) as x(id, role_name, starts_at, ends_at, headcount, buffer, charge_rate, dress_code)
join roles r on r.name = x.role_name
on conflict (id) do update set starts_at = excluded.starts_at, ends_at = excluded.ends_at,
  headcount = excluded.headcount, buffer = excluded.buffer;

insert into bookings (shift_id, staff_id, status, source, confirmed_at, day_before_confirmed_at, on_day_confirmed_at)
select p.shift_id::uuid, p.staff_id::uuid, 'confirmed', p.source::booking_source,
       now() - interval '3 days', now() - interval '1 day', now() - interval '4 hours'
from (values
  ('71000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002','auto'),    -- Tom Reid: on time
  ('71000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000003','auto'),    -- Priya Sharma: late
  ('71000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000010','manual'),  -- Emily Dawson: on a break
  ('71000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000005','auto'),    -- Grace Lindqvist: no-show
  ('71000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000008','auto'),    -- Chloe Baptiste: evening
  ('71000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000014','auto')     -- Hugo Ferreira: evening
) as p(shift_id, staff_id, source)
on conflict (shift_id, staff_id) do update set confirmed_at = excluded.confirmed_at,
  day_before_confirmed_at = excluded.day_before_confirmed_at, on_day_confirmed_at = excluded.on_day_confirmed_at;

-- ---------------------------------------------------------------------
-- CHECK LOGS — today's in-progress shift and the completed Lunch Service
-- (seed event ...006, whose six bookings are `worked` but had no log).
-- One row per accepted check-in; keyed on fixed ids so re-runs replace.
-- ---------------------------------------------------------------------
with b as (
  select bk.id as booking_id, bk.staff_id, sr.starts_at, sr.ends_at, e.venue_location
  from bookings bk join shift_requirements sr on sr.id = bk.shift_id join events e on e.id = sr.event_id
)
insert into check_logs (id, booking_id, attempted_at, outcome, location, distance_m, check_in_at,
                        check_out_at, check_out_pressed_at, check_out_on_site, last_on_site_at, on_site_verified)
select x.id::uuid, b.booking_id, b.starts_at + x.in_off, 'checked_in', b.venue_location, x.dist,
       b.starts_at + x.in_off,
       case when x.out_off is null then null else b.ends_at + x.out_off end,
       case when x.out_off is null then null else b.ends_at + x.out_off end,
       case when x.out_off is null then null else true end,
       coalesce(b.ends_at + x.out_off, now()),
       true
from (values
  -- today
  ('72000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002', interval '-6 minutes', null::interval, 35),
  ('72000000-0000-4000-8000-000000000002','71000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000003', interval '18 minutes', null, 52),
  ('72000000-0000-4000-8000-000000000003','71000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000010', interval '-3 minutes', null, 20),
  -- Lunch Service (completed): on time, late, left early, no check-out
  ('72000000-0000-4000-8000-000000000011','61000000-0000-4000-8000-000000000010','20000000-0000-4000-8000-000000000002', interval '-8 minutes', interval '4 minutes', 30),
  ('72000000-0000-4000-8000-000000000012','61000000-0000-4000-8000-000000000010','20000000-0000-4000-8000-000000000003', interval '12 minutes', interval '2 minutes', 44),
  ('72000000-0000-4000-8000-000000000013','61000000-0000-4000-8000-000000000010','20000000-0000-4000-8000-000000000005', interval '-5 minutes', interval '6 minutes', 28),
  ('72000000-0000-4000-8000-000000000014','61000000-0000-4000-8000-000000000010','20000000-0000-4000-8000-000000000008', interval '-2 minutes', null, 61),
  ('72000000-0000-4000-8000-000000000015','61000000-0000-4000-8000-000000000010','20000000-0000-4000-8000-000000000017', interval '-4 minutes', interval '-45 minutes', 38),
  ('72000000-0000-4000-8000-000000000016','61000000-0000-4000-8000-000000000010','20000000-0000-4000-8000-000000000025', interval '-7 minutes', interval '3 minutes', 25)
) as x(id, shift_id, staff_id, in_off, out_off, dist)
join bookings bk on bk.shift_id = x.shift_id::uuid and bk.staff_id = x.staff_id::uuid
join b on b.booking_id = bk.id
on conflict (id) do update set attempted_at = excluded.attempted_at, check_in_at = excluded.check_in_at,
  check_out_at = excluded.check_out_at, check_out_pressed_at = excluded.check_out_pressed_at,
  check_out_on_site = excluded.check_out_on_site, last_on_site_at = excluded.last_on_site_at;

-- Breaks: Emily is on one now; two finished 30-minute breaks at Lunch Service.
insert into breaks (id, booking_id, started_at, ended_at)
select x.id::uuid, bk.id, x.started_at, x.ended_at
from (values
  ('73000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000010', now() - interval '12 minutes', null::timestamptz)
) as x(id, shift_id, staff_id, started_at, ended_at)
join bookings bk on bk.shift_id = x.shift_id::uuid and bk.staff_id = x.staff_id::uuid
on conflict (id) do update set started_at = excluded.started_at, ended_at = excluded.ended_at;

insert into breaks (id, booking_id, started_at, ended_at)
select x.id::uuid, bk.id, sr.starts_at + interval '2 hours 30 minutes', sr.starts_at + interval '3 hours'
from (values
  ('73000000-0000-4000-8000-000000000011','20000000-0000-4000-8000-000000000002'),
  ('73000000-0000-4000-8000-000000000012','20000000-0000-4000-8000-000000000003')
) as x(id, staff_id)
join bookings bk on bk.shift_id = '61000000-0000-4000-8000-000000000010' and bk.staff_id = x.staff_id::uuid
join shift_requirements sr on sr.id = bk.shift_id
on conflict (id) do update set started_at = excluded.started_at, ended_at = excluded.ended_at;

-- ---------------------------------------------------------------------
-- VIOLATIONS — one of each kind the monitor and the profile show.
-- ---------------------------------------------------------------------
insert into violations (id, staff_id, booking_id, type, detected_at, minutes_late, resolved, resolved_at, resolution_note)
select x.id::uuid, x.staff_id::uuid, bk.id, x.type::violation_type, sr.starts_at + x.detected_off, x.minutes_late,
       x.resolved, case when x.resolved then sr.ends_at + interval '1 day' end, x.note
from (values
  ('74000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000003','late',        interval '18 minutes', 18,    false, null),
  ('74000000-0000-4000-8000-000000000002','71000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000005','no_show',     interval '30 minutes', null,  false, null),
  ('74000000-0000-4000-8000-000000000011','61000000-0000-4000-8000-000000000010','20000000-0000-4000-8000-000000000003','late',        interval '12 minutes', 12,    true,  'Tube delay on the Central line; told the Banqueting Manager in advance.'),
  ('74000000-0000-4000-8000-000000000012','61000000-0000-4000-8000-000000000010','20000000-0000-4000-8000-000000000017','left_early',  interval '4 hours 15 minutes', null, false, null),
  ('74000000-0000-4000-8000-000000000013','61000000-0000-4000-8000-000000000010','20000000-0000-4000-8000-000000000008','no_checkout', interval '9 hours', null,  false, null)
) as x(id, shift_id, staff_id, type, detected_off, minutes_late, resolved, note)
join bookings bk on bk.shift_id = x.shift_id::uuid and bk.staff_id = x.staff_id::uuid
join shift_requirements sr on sr.id = bk.shift_id
on conflict (id) do update set detected_at = excluded.detected_at, minutes_late = excluded.minutes_late,
  resolved = excluded.resolved, resolved_at = excluded.resolved_at, resolution_note = excluded.resolution_note;

-- ---------------------------------------------------------------------
-- FEEDBACK — the client (Marco V., Leonardo) on the Lunch Service, unread,
-- plus two internal office notes (§9.10).
-- ---------------------------------------------------------------------
insert into feedback (id, author_kind, author_id, staff_id, event_id, rating, text, created_at)
values
 ('75000000-0000-4000-8000-000000000001','client','10000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000002','60000000-0000-4000-8000-000000000006',5,
  'Tom was excellent — calm under pressure and our guests commented on him by name.', now() - interval '13 days'),
 ('75000000-0000-4000-8000-000000000002','client','10000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000003','60000000-0000-4000-8000-000000000006',4,
  'Good service once she arrived.', now() - interval '13 days'),
 ('75000000-0000-4000-8000-000000000003','client','10000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000017','60000000-0000-4000-8000-000000000006',2,
  'Left before the tables were cleared. Please do not send again without a word first.', now() - interval '13 days'),
 ('75000000-0000-4000-8000-000000000004','office','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000017',null,3,
  'Spoke to Isla about leaving early — family emergency, has apologised. Keep an eye on it.', now() - interval '12 days'),
 ('75000000-0000-4000-8000-000000000005','office','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000010',null,5,
  'Reliable team lead material. Consider for Head Waiter.', now() - interval '6 days')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- A self-cancellation (Unavailable list, "rejected — self-cancelled") and
-- an office withdrawal, on Awards Night.
-- ---------------------------------------------------------------------
insert into bookings (shift_id, staff_id, status, source, confirmed_at, cancelled_at, cancel_cause, self_cancelled)
values
 ('61000000-0000-4000-8000-000000000009','20000000-0000-4000-8000-000000000012','cancelled','auto', now() - interval '4 days', now() - interval '1 day', 'self_cancel', true),
 ('61000000-0000-4000-8000-000000000009','20000000-0000-4000-8000-000000000006','cancelled','auto', now() - interval '5 days', now() - interval '2 days', 'office_withdraw', false)
on conflict (shift_id, staff_id) do nothing;

-- ---------------------------------------------------------------------
-- APPLICATIONS — the /apply log: one returning applicant for the office to
-- review (Marek N., a leaver) and one fresh candidate.
-- ---------------------------------------------------------------------
insert into applications (id, first_name, last_name, email, phone, age_band, outcome, staff_id, consented_at, dob, matched_on, created_at)
select x.id::uuid, s.first_name, s.last_name, s.email, s.phone, '25+', x.outcome::application_outcome, s.id,
       now() - x.ago, s.dob, x.matched_on, now() - x.ago
from (values
  ('76000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000023','returning_applicant','email_dob', interval '2 days'),
  ('76000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000038','candidate_created',  null,        interval '1 day')
) as x(id, staff_id, outcome, matched_on, ago)
join staff s on s.id = x.staff_id::uuid
on conflict (id) do nothing;

commit;
