-- =====================================================================
-- 934 · Bring your name badge (ADR-0204)
--       — 20261026110000_name_badge_reminder.sql
--
-- A client with name_badges on gets CR2 on the morning of every confirmed
-- shift, with or without a kit message; a client without gets nothing.
-- =====================================================================
begin;
select plan(7);
\ir _shared/fixtures.psql

\set ev_on   '93400000-0000-4000-8000-000000000001'
\set ev_off  '93400000-0000-4000-8000-000000000002'
\set sec_on  '93410000-0000-4000-8000-000000000001'
\set sec_off '93410000-0000-4000-8000-000000000002'
\set r_wait  '93420000-0000-4000-8000-000000000001'
\set p_luca  '93430000-0000-4000-8000-000000000001'
\set p_mia   '93430000-0000-4000-8000-000000000002'
\set bk_on   '93440000-0000-4000-8000-000000000001'
\set bk_off  '93440000-0000-4000-8000-000000000002'

insert into roles (id, name, description, pay_rate) values (:'r_wait', 'Badge Reminder Waiting', 'fixture', 14.00);
insert into staff (id, employee_id, first_name, last_name, email, phone, dob, status) values
  (:'p_luca', 93401, 'Luca', 'Moretti', 'n-1@rls.test', '+447700934001', date '1995-01-01', 'compliant'),
  (:'p_mia',  93402, 'Mia',  'Rossi',   'n-2@rls.test', '+447700934002', date '1995-01-01', 'compliant');

update clients set name_badges = true  where id = :'clienta';
update clients set name_badges = false where id = :'clientb';

insert into events (id, client_id, venue_name, venue_address, venue_location, geofence_radius_m,
                    title, event_date, pays_breaks, pays_buffer, po_number) values
  (:'ev_on', :'clienta', 'Badge Venue', '1 Badge St', st_setsrid(st_makepoint(-0.1, 51.5), 4326)::geography, 150,
   'Badge Dinner', date '2026-12-10', false, true, null),
  (:'ev_off', :'clientb', 'Badge Venue', '1 Badge St', st_setsrid(st_makepoint(-0.1, 51.5), 4326)::geography, 150,
   'No Badge Dinner', date '2026-12-10', false, true, null);
insert into shift_requirements (id, event_id, role_id, starts_at, ends_at, headcount, buffer,
                                charge_rate, pay_rate, allocation_per_hour) values
  (:'sec_on',  :'ev_on',  :'r_wait', '2026-12-10 16:00+00', '2026-12-10 22:00+00', 1, 0, 22.97, 14.00, 1),
  (:'sec_off', :'ev_off', :'r_wait', '2026-12-10 16:00+00', '2026-12-10 22:00+00', 1, 0, 22.97, 14.00, 1);
insert into bookings (id, shift_id, staff_id, status, source, confirmed_at) values
  (:'bk_on',  :'sec_on',  :'p_luca', 'confirmed', 'manual', '2026-12-01 10:00+00'),
  (:'bk_off', :'sec_off', :'p_mia',  'confirmed', 'manual', '2026-12-01 10:00+00');

select is((select client_kit_reminder_tick('2026-12-10 06:59+00')), '{"cr2": 0}'::jsonb,
  'before 07:00 UK on the day, nothing');
select is((select client_kit_reminder_tick('2026-12-10 07:00+00')), '{"cr2": 1}'::jsonb,
  'at 07:00 UK, one reminder: the client with badges, not the one without');
select is((select payload ->> 'message' from notification_outbox where template = 'CR2' and recipient_staff_id = :'p_luca'),
  'Don''t forget to bring your name badge today, if you have been given one.',
  'it asks for the name badge if they were given one');
select is((select count(*)::int from notification_outbox where template = 'CR2' and recipient_staff_id = :'p_mia'), 0,
  'a client without name badges sends nothing');
select is((select client_kit_reminder_tick('2026-12-10 07:05+00')), '{"cr2": 0}'::jsonb,
  'run again, no double send');

-- With a kit message too: one push carrying both.
insert into client_role_requirements (client_id, role_id, kit_message)
values (:'clienta', :'r_wait', 'Bring a corkscrew.');
update shift_requirements set starts_at = starts_at + interval '1 hour', ends_at = ends_at + interval '1 hour'
 where id = :'sec_on';
select is((select client_kit_reminder_tick('2026-12-10 07:10+00')), '{"cr2": 1}'::jsonb,
  'a moved start is a new key');
select is((select payload ->> 'message' from notification_outbox
            where template = 'CR2' and recipient_staff_id = :'p_luca' order by id desc limit 1),
  E'Bring a corkscrew.\n\nDon''t forget to bring your name badge today, if you have been given one.',
  'the kit message and the badge line go in one push');

select * from finish();
rollback;
