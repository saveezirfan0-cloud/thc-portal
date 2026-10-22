-- =====================================================================
-- 924 · ADR-0188 — 20261023140000_nudge_check_in_out.sql
--
-- The Check In / Out monitor's "Remind" button: nudge_check_in_out()
-- queues the register's own N9 / N9b for one booking, by what the monitor
-- says about the row, for an office writer only, and refuses with a reason
-- rather than queueing a push that cannot arrive.
--
-- Times are relative to now(). Each booking is a different worker, so no
-- overlap rule is in the way:
--   a  starts in 10 min, not checked in      → N9 check-in
--   b  starts in 3 h                         → check_in_not_open
--   c  started 1 h ago, on shift, > 30 min left → check_out_not_due
--   d  ended 30 min ago, still on shift      → N9b
--   e  on shift, ends in 20 min              → N9 check-out
--   f  checked out                           → nothing_to_send
--   g  like a, but the worker has no device  → no_push_device
--   h  like d, with N9b switched off         → switched_off
-- =====================================================================
begin;
select plan(17);
\ir _shared/fixtures.psql

\set r_nudge   '92400000-0000-4000-8000-000000000001'
\set sched_uid '92420000-0000-4000-8000-000000000001'
\set viewer_uid '92420000-0000-4000-8000-000000000002'
\set staff_uid '92420000-0000-4000-8000-000000000003'

insert into auth.users (id, email) values
  (:'sched_uid',  'sched.924@rls.test'),
  (:'viewer_uid', 'viewer.924@rls.test'),
  (:'staff_uid',  'staff.924@rls.test');
insert into profiles (id, role, office_role, full_name) values
  (:'sched_uid',  'admin', 'scheduler', 'Sam Scheduler'),
  (:'viewer_uid', 'admin', 'viewer',    'Vic Viewer');
insert into profiles (id, role, full_name) values (:'staff_uid', 'staff', 'Sid Staff');

insert into roles (id, name, description, pay_rate) values (:'r_nudge', 'Nudge Waiting Staff', 'fixture', 14.00);

create temp table bk (name text primary key, id uuid, staff_id uuid);
grant select on bk to authenticated, anon, service_role;

-- One worker, one section, one booking; p_in / p_out are the check-log stamps.
create function pg_temp.book(p_name text, p_n int, p_from timestamptz, p_to timestamptz,
                             p_in timestamptz, p_out timestamptz, p_device boolean default true)
returns uuid language plpgsql as $$
declare
  v_staff   uuid := gen_random_uuid();
  v_event   uuid := gen_random_uuid();
  v_shift   uuid := gen_random_uuid();
  v_booking uuid := gen_random_uuid();
begin
  insert into staff (id, user_id, employee_id, first_name, last_name, email, phone, dob, status)
  values (v_staff, null, 92400 + p_n, 'Nudge', upper(p_name), 'n-' || p_name || '@rls.test',
          '+4477009924' || lpad(p_n::text, 2, '0'), date '1990-01-01', 'compliant');
  insert into staff_roles (staff_id, role_id) values (v_staff, '92400000-0000-4000-8000-000000000001');
  insert into events (id, client_id, venue_name, venue_address, venue_location, geofence_radius_m,
                      title, event_date, pays_breaks, pays_buffer, po_number)
  values (v_event, 'aaaaaaaa-0000-4000-8000-000000000001', 'Nudge Venue', '4 Nudge St, London',
          st_setsrid(st_makepoint(-0.1, 51.5), 4326)::geography, 150,
          'Nudge ' || p_name, (p_from at time zone 'Europe/London')::date, true, false, null);
  insert into shift_requirements (id, event_id, role_id, starts_at, ends_at, headcount, buffer,
                                  charge_rate, pay_rate, allocation_per_hour)
  values (v_shift, v_event, '92400000-0000-4000-8000-000000000001', p_from, p_to, 4, 0, 22.97, 14.00, 1);
  insert into bookings (id, shift_id, staff_id, status, source, confirmed_at)
  values (v_booking, v_shift, v_staff, 'confirmed', 'manual', now() - interval '20 days');
  if p_in is not null then
    insert into check_logs (booking_id, attempted_at, outcome, check_in_at, check_out_at)
    values (v_booking, p_in, 'checked_in', p_in, p_out);
  end if;
  if p_device then
    insert into push_subscriptions (staff_id, endpoint, p256dh, auth)
    values (v_staff, 'https://push.example/924/' || p_name, 'p256dh', 'auth');
  end if;
  insert into bk values (p_name, v_booking, v_staff);
  return v_booking;
end $$;

select pg_temp.book('a', 1, now() + interval '10 minutes',  now() + interval '4 hours 10 minutes', null, null);
select pg_temp.book('b', 2, now() + interval '3 hours',     now() + interval '7 hours',           null, null);
select pg_temp.book('c', 3, now() - interval '1 hour',      now() + interval '3 hours',  now() - interval '1 hour', null);
select pg_temp.book('d', 4, now() - interval '4 hours 30 minutes', now() - interval '30 minutes',
                    now() - interval '4 hours 30 minutes', null);
select pg_temp.book('e', 5, now() - interval '3 hours 40 minutes', now() + interval '20 minutes',
                    now() - interval '3 hours 40 minutes', null);
select pg_temp.book('f', 6, now() - interval '4 hours 30 minutes', now() - interval '30 minutes',
                    now() - interval '4 hours 30 minutes', now() - interval '35 minutes');
select pg_temp.book('g', 7, now() + interval '10 minutes',  now() + interval '4 hours 10 minutes', null, null, false);
select pg_temp.book('h', 8, now() - interval '4 hours 30 minutes', now() - interval '30 minutes',
                    now() - interval '4 hours 30 minutes', null);

create function pg_temp.as_user(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true)
$$;

-- ---------------------------------------------------------------------
-- 1-3 · a scheduler nudges a worker who is due: N9 "Time to check in"
-- ---------------------------------------------------------------------
select pg_temp.as_user(:'sched_uid');
set local role authenticated;
select is((select public.nudge_check_in_out((select id from bk where name = 'a')) ->> 'template'),
  'N9', 'a worker due in ten minutes is sent N9');
reset role;

select ok(exists (
    select 1 from notification_outbox o
     where o.template = 'N9' and o.channel = 'push'
       and o.recipient_staff_id = (select staff_id from bk where name = 'a')
       and o.payload = jsonb_build_object('variant', 'check-in',
                                           'bookingId', (select id::text from bk where name = 'a'))
       and o.key like 'N9:manual:booking:%:check-in:%'),
  'the outbox row is the register''s check-in half, in its own manual key family');

select is((select count(*)::int from audit_log
            where action = 'booking.check_in_out_nudged'
              and entity_id = (select id from bk where name = 'a')
              and actor = :'sched_uid'),
  1, 'and the send is audited with who sent it');

-- ---------------------------------------------------------------------
-- 4 · a second press inside five minutes
-- ---------------------------------------------------------------------
select pg_temp.as_user(:'sched_uid');
set local role authenticated;
select throws_ok($$ select public.nudge_check_in_out((select id from bk where name = 'a')) $$,
  'P0001', 'sent_recently', 'a second press within five minutes is refused');

-- ---------------------------------------------------------------------
-- 5-6 · too early
-- ---------------------------------------------------------------------
select throws_ok($$ select public.nudge_check_in_out((select id from bk where name = 'b')) $$,
  'P0001', 'check_in_not_open', 'check-in is not offered more than 30 minutes before the start');
select throws_ok($$ select public.nudge_check_in_out((select id from bk where name = 'c')) $$,
  'P0001', 'check_out_not_due', 'check-out is not offered until the last 30 minutes of the shift');

-- ---------------------------------------------------------------------
-- 7-9 · on shift: N9b once the shift has ended, N9 check-out in the last 30 minutes
-- ---------------------------------------------------------------------
select is((select public.nudge_check_in_out((select id from bk where name = 'd')) ->> 'template'),
  'N9b', 'on shift after the end is sent N9b');
select is((select public.nudge_check_in_out((select id from bk where name = 'e')) ->> 'variant'),
  'check-out', 'on shift in the last 30 minutes is sent the N9 check-out half');
reset role;
select is((select o.payload ->> 'event' from notification_outbox o
            where o.template = 'N9b' and o.recipient_staff_id = (select staff_id from bk where name = 'd')),
  'Nudge d', 'N9b carries the event title its copy names');

-- ---------------------------------------------------------------------
-- 10-12 · nothing to send, no device, switched off
-- ---------------------------------------------------------------------
select pg_temp.as_user(:'sched_uid');
set local role authenticated;
select throws_ok($$ select public.nudge_check_in_out((select id from bk where name = 'f')) $$,
  'P0001', 'nothing_to_send', 'a worker who has checked out has nothing to be nudged about');
select throws_ok($$ select public.nudge_check_in_out((select id from bk where name = 'g')) $$,
  'P0001', 'no_push_device', 'a worker with no device is refused, so the office knows to ring');
reset role;
update settings set value = jsonb_build_object('N9b', false) where key = 'notification_switches';
select pg_temp.as_user(:'sched_uid');
set local role authenticated;
select throws_ok($$ select public.nudge_check_in_out((select id from bk where name = 'h')) $$,
  'P0001', 'switched_off', 'a code switched off in /settings is refused, not queued to be silently settled');

-- ---------------------------------------------------------------------
-- 13-17 · who may call it
-- ---------------------------------------------------------------------
select throws_ok($$ select public.nudge_check_in_out(gen_random_uuid()) $$,
  'P0002', 'booking_not_found', 'an unknown booking is refused');

reset role;
select pg_temp.as_user(:'viewer_uid');
set local role authenticated;
select throws_ok($$ select public.nudge_check_in_out((select id from bk where name = 'a')) $$,
  '42501', 'not_permitted', 'a viewer may look but not send');

reset role;
select pg_temp.as_user(:'staff_uid');
set local role authenticated;
select throws_ok($$ select public.nudge_check_in_out((select id from bk where name = 'a')) $$,
  '42501', 'admins_only', 'a worker cannot push anybody');
reset role;

select ok(not has_function_privilege('anon', 'public.nudge_check_in_out(uuid)', 'execute'),
  'anon cannot execute it');
select ok(has_function_privilege('authenticated', 'public.nudge_check_in_out(uuid)', 'execute'),
  'a signed-in office session can');

select * from finish();
rollback;
