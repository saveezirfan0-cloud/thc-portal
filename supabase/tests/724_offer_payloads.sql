-- =====================================================================
-- 724 · Every OF payload asks for exactly its template's placeholders
--   (ADR-0046; the 592 pattern; packages/notifications PAYLOAD_KEYS)
--   20260930201100_shift_offers.sql
--
-- The drain renders from the register (render(entry.title, values)), so a
-- key the sender forgets ships a brace, and a key the register does not
-- ask for is a value nobody reads. Each of OF1–OF6 is produced here by the
-- function that really sends it, and its payload's keys — less the ids
-- offerId / bookingId / shiftId / eventId carried for the office's tooling
-- where the copy does not ask for them — must equal the list
-- templates.test.ts holds the copy to:
--
--   OF1 role, event, dateTime, rate, offerId
--   OF2 event, dateTime
--   OF3 event, date, bookingId
--   OF4 event, date, bookingId
--   OF5 event, role, date, name, employeeId, client, venue, dateTime, note,
--       confirmed, headcount, buffer, autoAssign
--   OF6 event, date, bookingId
-- =====================================================================
begin;
select plan(25);
\ir _shared/fixtures.psql

\set ev   '67400000-0000-4000-8000-000000000001'
\set s    '67410000-0000-4000-8000-000000000001'
\set s2   '67410000-0000-4000-8000-000000000002'
\set s3   '67410000-0000-4000-8000-000000000003'
\set off  '67420000-0000-4000-8000-000000000001'
\set tk   '67420000-0000-4000-8000-000000000002'
\set lap  '67420000-0000-4000-8000-000000000003'
\set cov  '67420000-0000-4000-8000-000000000004'
\set uoff '67430000-0000-4000-8000-000000000001'
\set utk  '67430000-0000-4000-8000-000000000002'
\set ucov '67430000-0000-4000-8000-000000000004'
\set b1   '67440000-0000-4000-8000-000000000001'
\set b2   '67440000-0000-4000-8000-000000000002'
\set b3   '67440000-0000-4000-8000-000000000003'
\set o2   '67450000-0000-4000-8000-000000000002'

insert into auth.users (id, email) values
  (:'uoff', 'off@pl674.test'), (:'utk', 'tk@pl674.test'), (:'ucov', 'cov@pl674.test');
insert into profiles (id, role, full_name) values
  (:'uoff', 'staff', 'Ora Offer'), (:'utk', 'staff', 'Tia Taker'), (:'ucov', 'staff', 'Cora Cover');
insert into staff (id, user_id, employee_id, first_name, last_name, email, phone, dob, status, rtw_branch) values
  (:'off', :'uoff', 67401, 'Ora',  'Offer', 'off@pl674.test', '+447700967401', date '1995-01-01', 'compliant', 'uk_irish'),
  (:'tk',  :'utk',  67402, 'Tia',  'Taker', 'tk@pl674.test',  '+447700967402', date '1995-01-02', 'compliant', 'uk_irish'),
  (:'lap', null,    67403, 'Lars', 'Lapse', 'lap@pl674.test', '+447700967403', date '1995-01-03', 'compliant', 'uk_irish'),
  (:'cov', :'ucov', 67404, 'Cora', 'Cover', 'cov@pl674.test', '+447700967404', date '1995-01-04', 'compliant', 'uk_irish');
insert into staff_roles (staff_id, role_id)
select id, :'role_id' from staff where email like '%@pl674.test';
insert into client_qualifications (client_id, role_id, staff_id) values (:'clienta', :'role_id', :'tk');

insert into events (id, client_id, venue_id, venue_name, venue_address, venue_location, geofence_radius_m,
                    title, event_date, pays_breaks, pays_buffer, auto_assign) values
  (:'ev', :'clienta', :'venue_id', 'RLS Fixture Venue', '1 Test Street, London',
   st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150, 'Awards Night', current_date + 10, true, true, true);
insert into shift_requirements (id, event_id, role_id, starts_at, ends_at, headcount, buffer,
                                charge_rate, pay_rate, allocation_per_hour) values
  (:'s',  :'ev', :'role_id', now() + interval '10 days', now() + interval '10 days 10 hours', 6, 1, 20, 14, 7),
  (:'s2', :'ev', :'role_id', now() + interval '12 days', now() + interval '12 days 5 hours', 2, 0, 20, 14, 2),
  (:'s3', :'ev', :'role_id', now() + interval '48 hours', now() + interval '54 hours', 2, 0, 20, 14.5, 2);
insert into bookings (id, shift_id, staff_id, status, source, confirmed_at) values
  (:'b1', :'s',  :'off', 'confirmed', 'auto', now()),
  (:'b2', :'s2', :'lap', 'confirmed', 'auto', now()),
  (:'b3', :'s3', :'cov', 'confirmed', 'auto', now());
insert into shift_offers (id, booking_id, mode, expires_at) values (:'o2', :'b2', 'pool', now() - interval '1 minute');

-- The UK strings the payloads should carry, built here independently.
select to_char(starts_at at time zone 'Europe/London', 'Dy DD Mon HH24:MI') || '–'
       || to_char(ends_at at time zone 'Europe/London', 'HH24:MI') as when_s,
       to_char(starts_at at time zone 'Europe/London', 'Dy DD Mon') as date_s
  from shift_requirements where id = :'s' \gset
select to_char(starts_at at time zone 'Europe/London', 'Dy DD Mon') as date_s2
  from shift_requirements where id = :'s2' \gset
select to_char(starts_at at time zone 'Europe/London', 'Dy DD Mon YYYY HH24:MI') || '–'
       || to_char(ends_at at time zone 'Europe/London', 'HH24:MI') as when_s3,
       to_char(starts_at at time zone 'Europe/London', 'Dy DD Mon YYYY') as date_s3
  from shift_requirements where id = :'s3' \gset

-- The payload's keys, less the tooling ids the copy does not ask for.
create function pg_temp.asked(p_key text, p_wanted text[]) returns text[] language sql as $$
  select array_agg(k order by k)
    from notification_outbox n, jsonb_object_keys(n.payload) k
   where n.key = p_key
     and (k = any(p_wanted) or k not in ('offerId', 'bookingId', 'shiftId', 'eventId'))
$$;
create function pg_temp.sorted(p text[]) returns text[] language sql as $$
  select array_agg(x order by x) from unnest(p) x
$$;

-- ---------------------------------------------------------------------
-- The six sends, each by its real sender
-- ---------------------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', :'uoff', 'role', 'authenticated')::text, true);
set local role authenticated;
select offer_shift(:'b1') ->> 'offerId' as o1 \gset
reset role;
select set_config('request.jwt.claims', '', true);

select is(notify_offer_candidates(:'o1', array[:'tk'::uuid]), 1, 'OF1 is sent by an hourly round');

select set_config('request.jwt.claims', json_build_object('sub', :'utk', 'role', 'authenticated')::text, true);
set local role authenticated;
select take_offered_shift(:'o1') ->> 'bookingId' as taken \gset
reset role;
select set_config('request.jwt.claims', '', true);

select is(lapse_shift_offers(), 1, 'OF3 is sent by the lapse');

select set_config('request.jwt.claims', json_build_object('sub', :'ucov', 'role', 'authenticated')::text, true);
set local role authenticated;
select request_cover(:'b3') ->> 'offerId' as o3 \gset
reset role;
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is(office_decline_cover(:'o3', 'Covered in-house.') ->> 'ok', 'true', 'OF6 is sent by the decline');
reset role;
select set_config('request.jwt.claims', '', true);

-- ---------------------------------------------------------------------
-- Keys
-- ---------------------------------------------------------------------
select is(pg_temp.asked('OF1:offer:' || :'o1' || ':' || :'tk', array['role', 'event', 'dateTime', 'rate', 'offerId']),
  pg_temp.sorted(array['role', 'event', 'dateTime', 'rate', 'offerId']), 'OF1: exactly its placeholders');
select is(pg_temp.asked('OF2:offer:' || :'o1', array['event', 'dateTime']),
  pg_temp.sorted(array['event', 'dateTime']), 'OF2: exactly its placeholders');
select is(pg_temp.asked('OF3:offer:' || :'o2', array['event', 'date', 'bookingId']),
  pg_temp.sorted(array['event', 'date', 'bookingId']), 'OF3: exactly its placeholders');
select is(pg_temp.asked('OF4:offer:' || :'o1', array['event', 'date', 'bookingId']),
  pg_temp.sorted(array['event', 'date', 'bookingId']), 'OF4: exactly its placeholders');
select is(pg_temp.asked('OF5:booking:' || :'b3', array['event', 'role', 'date', 'name', 'employeeId', 'client', 'venue',
                                                      'dateTime', 'note', 'confirmed', 'headcount', 'buffer', 'autoAssign']),
  pg_temp.sorted(array['event', 'role', 'date', 'name', 'employeeId', 'client', 'venue',
                       'dateTime', 'note', 'confirmed', 'headcount', 'buffer', 'autoAssign']),
  'OF5: exactly its placeholders');
select is(pg_temp.asked('OF6:offer:' || :'o3', array['event', 'date', 'bookingId']),
  pg_temp.sorted(array['event', 'date', 'bookingId']), 'OF6: exactly its placeholders');

-- ---------------------------------------------------------------------
-- Channels, recipients and the values that matter
-- ---------------------------------------------------------------------
select is(
  (select array_agg(template || ':' || channel::text order by template) from notification_outbox
    where template like 'OF%' and payload ->> 'eventId' = :'ev'),
  array['OF1:push', 'OF2:push', 'OF3:push', 'OF4:push', 'OF5:email', 'OF6:push'],
  'one of each, OF5 the only email');
select is((select recipient_staff_id from notification_outbox where key = 'OF1:offer:' || :'o1' || ':' || :'tk'), :'tk'::uuid,
  'OF1 to the candidate');
select is((select recipient_staff_id from notification_outbox where key = 'OF2:offer:' || :'o1'), :'off'::uuid,
  'OF2 to the offerer');
select is((select recipient_staff_id from notification_outbox where key = 'OF3:offer:' || :'o2'), :'lap'::uuid,
  'OF3 to the offerer');
select is((select recipient_staff_id from notification_outbox where key = 'OF4:offer:' || :'o1'), :'tk'::uuid,
  'OF4 to the taker');
select is((select recipient_emails from notification_outbox where key = 'OF5:booking:' || :'b3'),
  array['admin@thehospitalitycompany.co.uk'], 'OF5 to admin@ only');
select is((select recipient_staff_id from notification_outbox where key = 'OF6:offer:' || :'o3'), :'cov'::uuid,
  'OF6 to the worker who asked');

select is(
  (select array[payload ->> 'role', payload ->> 'event', payload ->> 'dateTime', payload ->> 'rate', payload ->> 'offerId']
     from notification_outbox where key = 'OF1:offer:' || :'o1' || ':' || :'tk'),
  array['RLS Fixture Role', 'Awards Night', :'when_s', '£14.00', :'o1'],
  'OF1: the role section''s own UK window (RULE-18) and the BASE rate — never charge, never holiday-blended');
select ok((select payload ->> 'dateTime' ~ '^[A-Z][a-z]{2} \d{2} [A-Z][a-z]{2} \d{2}:\d{2}–\d{2}:\d{2}$'
             from notification_outbox where key = 'OF2:offer:' || :'o1'),
  'OF2: dateTime in N5''s shape, "Tue 23 Sep 16:00–02:00"');
select is((select payload ->> 'bookingId' from notification_outbox where key = 'OF4:offer:' || :'o1'), :'taken',
  'OF4 deep-links to the TAKER''s booking');
select is((select payload ->> 'bookingId' from notification_outbox where key = 'OF3:offer:' || :'o2'), :'b2',
  'OF3 deep-links to the offerer''s booking, which is still theirs');
select is((select payload ->> 'date' from notification_outbox where key = 'OF3:offer:' || :'o2'), :'date_s2',
  'OF3: the date, UK');
select is((select payload ->> 'date' from notification_outbox where key = 'OF4:offer:' || :'o1'), :'date_s',
  'OF4: the date, UK');
select is(
  (select array[payload ->> 'name', payload ->> 'employeeId', payload ->> 'client', payload ->> 'venue',
                payload ->> 'role', payload ->> 'dateTime', payload ->> 'date', payload ->> 'note']
     from notification_outbox where key = 'OF5:booking:' || :'b3'),
  array['Cora Cover', '67404', 'RLS Fixture Client A', 'RLS Fixture Venue', 'RLS Fixture Role',
        :'when_s3', :'date_s3', '—'],
  'OF5: E10''s fields and dates; no note written as —');
select is(
  (select array[payload ->> 'confirmed', payload ->> 'headcount', payload ->> 'buffer', payload ->> 'autoAssign']
     from notification_outbox where key = 'OF5:booking:' || :'b3'),
  array['1', '2', '0', 'on'], 'OF5: the fill as confirmed of headcount (+buffer), buffer never added in');
select ok(not exists (select 1 from notification_outbox
                       where template in ('OF1', 'OF2', 'OF3', 'OF4', 'OF6') and payload->>'eventId' = :'ev'
                         and (payload ? 'name' or payload ? 'employeeId' or payload ? 'note')),
  'no worker push carries a name, an Employee ID or the office''s note');

select * from finish();
rollback;
