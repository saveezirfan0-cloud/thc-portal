-- Puts the scheduling demo back after sched-3 / 3b / 4 / 6b / 8 (and removes
-- the event sched-1 saves). Run as the project owner (SQL editor / service role).
begin;

-- Awards Night · Host: 17:00-23:00 UK (16:00-22:00Z), 4 (+1)
update shift_requirements
   set starts_at = '2026-10-06T16:00:00+00', ends_at = '2026-10-06T22:00:00+00',
       headcount = 4, buffer = 1
 where id = '61000000-0000-4000-8000-000000000008';

-- Withdrawn bookings cannot be un-cancelled (state machine): recreate them.
delete from bookings
 where shift_id = '61000000-0000-4000-8000-000000000008'
   and staff_id in (select id from staff where email in
     ('hana.kowalska@example.com','nadia.haddad@example.com','amara.kalu@example.com'));
insert into bookings (shift_id, staff_id, status, source, confirmed_at)
select '61000000-0000-4000-8000-000000000008', s.id, 'confirmed',
       (case s.email when 'hana.kowalska@example.com' then 'manual' else 'auto' end)::booking_source,
       '2026-09-28 14:24:59.358084+00'
  from staff s
 where s.email in ('hana.kowalska@example.com','nadia.haddad@example.com','amara.kalu@example.com');

-- Gala Dinner · Waiting Staff: Amara has not pressed "I'm ready" yet
update bookings set day_before_confirmed_at = null
 where id = '884b8e6b-8386-4c02-991d-e061941d6dcc';

-- Conference Lunch: drop the one manual invitation part 2 makes
delete from bookings where shift_id = '61000000-0000-4000-8000-000000000007' and source = 'manual';

-- The event sched-1 builds
delete from events where title = 'Summer Reception' and po_number = 'PO-DEMO-2210';

commit;
