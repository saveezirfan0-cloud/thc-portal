-- =====================================================================
-- 898 · How long a GPS trail and a delivery record are kept
--       (20261020130300, ADR-0164)
--
--   · location_pings_purge(): 90 days after the role section ended, unless
--     the booking has an unresolved violation.
--   · notification_outbox_purge(): finished more than 180 days ago —
--     deleted for the time-bound families, tombstoned (key and times, no
--     personal data) for the rest, NS1/BG08 kept; never an unsent row;
--     a tombstoned key still refuses a second send. willo_deliveries go
--     after 180 days too.
--   · Both bounded per call; both run through run_housekeeping_job() and
--     are scheduled by install_housekeeping_schedules().
-- =====================================================================
begin;
select plan(30);
\ir _shared/fixtures.psql

\set sh_old    '89800000-0000-4000-8000-0000000000a1'
\set sh_recent '89800000-0000-4000-8000-0000000000a2'
\set b_old     '89800000-0000-4000-8000-0000000000b1'
\set b_held    '89800000-0000-4000-8000-0000000000b2'
\set b_recent  '89800000-0000-4000-8000-0000000000b3'
\set v_held    '89800000-0000-4000-8000-0000000000c1'

-- Past sections and their bookings: written past the booking-time triggers,
-- which refuse a shift in the past, as a fixture may.
set local session_replication_role = replica;
insert into shift_requirements (id, event_id, role_id, starts_at, ends_at, headcount, buffer, charge_rate, pay_rate, allocation_per_hour) values
  (:'sh_old',    :'event_a', :'role_id', now() - interval '100 days 8 hours', now() - interval '100 days', 3, 0, 22.97, 14.00, 3),
  (:'sh_recent', :'event_a', :'role_id', now() - interval '30 days 8 hours',  now() - interval '30 days',  3, 0, 22.97, 14.00, 3);
insert into bookings (id, shift_id, staff_id, status, source, confirmed_at) values
  (:'b_old',    :'sh_old',    :'staffa', 'confirmed', 'manual', now() - interval '101 days'),
  (:'b_held',   :'sh_old',    :'staffb', 'confirmed', 'manual', now() - interval '101 days'),
  (:'b_recent', :'sh_recent', :'staffa', 'confirmed', 'manual', now() - interval '31 days');
set local session_replication_role = origin;

-- Only this file's rows are counted: whatever the seed holds is set aside.
delete from location_pings where booking_id not in (:'booking_a', :'booking_b');
delete from notification_outbox where key <> 'RLS:fixture:outbox';
delete from willo_deliveries;

insert into location_pings (booking_id, at, location, inside_geofence)
select b, now() - interval '100 days 2 hours' + (g * interval '1 minute'),
       st_setsrid(st_makepoint(-0.1, 51.5), 4326)::geography, true
  from unnest(array[:'b_old', :'b_held', :'b_recent']::uuid[]) b, generate_series(1, 3) g;
update location_pings set at = now() - interval '30 days 2 hours' where booking_id = :'b_recent';
insert into violations (id, staff_id, booking_id, type, detected_at, resolved) values
  (:'v_held', :'staffb', :'b_held', 'no_checkout', now() - interval '100 days', false);

-- ---------------------------------------------------------------------
-- 1 · location_pings
-- ---------------------------------------------------------------------
select is(location_pings_purge(), 3, 'the trail of a shift that ended 100 days ago goes');
select is((select count(*)::int from location_pings where booking_id = :'b_old'), 0, 'all of it');
select is((select count(*)::int from location_pings where booking_id = :'b_held'), 3,
  'a booking with an unresolved violation keeps its trail');
select is((select count(*)::int from location_pings where booking_id = :'b_recent'), 3,
  'a shift that ended 30 days ago keeps its trail');
select is((select count(*)::int from location_pings where booking_id in (:'booking_a', :'booking_b')), 2,
  'and today''s pings are untouched');
update violations set resolved = true, resolved_at = now() where id = :'v_held';
select is(location_pings_purge(), 3, 'once the violation is resolved, that trail goes too');
select is(location_pings_purge(), 0, 'a second run finds nothing');

insert into location_pings (booking_id, at, location, inside_geofence)
select :'b_old', now() - interval '100 days', st_setsrid(st_makepoint(-0.1, 51.5), 4326)::geography, true
  from generate_series(1, 5);
select is(location_pings_purge(90, 2), 2, 'one call deletes no more than it is allowed');
select is(location_pings_purge(), 3, 'and the next call takes the rest');

-- Pay never reads the trail after check-out: the only functions that read
-- it are the two that write it and check-out itself (whose window closes at
-- end + 4 h, writing check_logs.last_on_site_at), removal, and this purge.
select bag_eq(
  $$ select p.proname::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prokind = 'f'
        and pg_get_functiondef(p.oid) ilike '%from location_pings%' $$,
  $$ values ('check_out'::text), ('record_ping'), ('remove_worker'), ('location_pings_purge') $$,
  'no pay or payroll function reads location_pings; check_out() keeps the last on-site fix on check_logs');

-- ---------------------------------------------------------------------
-- 2 · notification_outbox
-- ---------------------------------------------------------------------
insert into notification_outbox (key, channel, template, recipient_staff_id, recipient_emails, payload, send_after, sent_at, failed_at, error) values
  ('IR1:email:898aaaa:2026-01-01',          'email', 'IR1', null, array['old@roster.test'], '{"name":"Old"}',  now() - interval '200 days', now() - interval '200 days', null, null),
  ('E6:staff:' || :'staffa',                'email', 'E6',  :'staffa', array['payroll@thc.test'], '{"name":"Staff Alpha","ni":"QQ123456C"}', now() - interval '200 days', now() - interval '200 days', null, null),
  ('OC2:staff:' || :'staffb' || ':898:2',   'email', 'OC2', :'staffb', array['staffb@rls.test'], '{"name":"Staff","link":"https://x/activate/t","rung":2,"at":"2026-03-01T10:00:00Z","variant":"second"}', now() - interval '200 days', now() - interval '200 days', null, null),
  ('ZZ9:new:898',                           'email', 'ZZ9', null, array['someone@x.test'], '{"name":"Someone"}', now() - interval '200 days', null, now() - interval '200 days', 'bounced: someone@x.test'),
  ('NS1:2026-03-02',                        'email', 'NS1', null, null, '{"attachment":"reports/ns1.csv"}', now() - interval '200 days', null, now() - interval '200 days', 'failed'),
  ('N5:booking:' || :'b_recent' || ':1',    'push',  'N5',  :'staffa', null, '{"event":"Recent"}', now() - interval '100 days', now() - interval '100 days', null, null),
  ('N6:booking:898:never-sent',             'push',  'N6',  :'staffa', null, '{"event":"Queued"}', now() - interval '200 days', null, null, null);

select results_eq($$ select notification_outbox_purge() - 'willoDeliveries' $$,
  $$ values ('{"deleted":1,"tombstoned":3}'::jsonb) $$,
  'one old row of a time-bound family is deleted, three of other families are tombstoned');
select is((select count(*)::int from notification_outbox where key = 'IR1:email:898aaaa:2026-01-01'), 0,
  'the 200-day-old roster reminder is gone');
select results_eq(
  format($$ select template, recipient_emails is null, payload - 'retired', error, sent_at is not null
              from notification_outbox where key = %L $$, 'E6:staff:' || :'staffa'),
  $$ values ('E6'::text, true, '{}'::jsonb, null::text, true) $$,
  'a once-ever key (E6, per worker) stays as a tombstone: its template and times, no recipient, no payload');
select ok((select payload ? 'retired' from notification_outbox where key = 'E6:staff:' || :'staffa'),
  'marked retired');
select is((select payload - 'retired' from notification_outbox where key = 'OC2:staff:' || :'staffb' || ':898:2'),
  '{"at":"2026-03-01T10:00:00Z","rung":2,"variant":"second"}'::jsonb,
  'the chaser ladder keeps its rung, time and variant — and loses the name and the link');
select results_eq($$ select recipient_emails is null, error from notification_outbox where key = 'ZZ9:new:898' $$,
  $$ values (true, null::text) $$,
  'a family nobody listed is tombstoned, not deleted (the safe default), and its error text goes');
select is((select payload from notification_outbox where key = 'NS1:2026-03-02'), '{"attachment":"reports/ns1.csv"}'::jsonb,
  'NS1 is kept whole: a retry copies its payload');
select is((select count(*)::int from notification_outbox where key = 'N5:booking:' || :'b_recent' || ':1'), 1,
  'a row finished 100 days ago is kept');
select is((select count(*)::int from notification_outbox where key = 'N6:booking:898:never-sent'), 1,
  'an unsent row is never touched, however old');

-- The send-once guarantee survives the tombstone.
insert into notification_outbox (key, channel, template, recipient_staff_id, payload)
values ('E6:staff:' || :'staffa', 'email', 'E6', :'staffa', '{"name":"again"}')
on conflict (key) do nothing;
select is((select payload ->> 'name' from notification_outbox where key = 'E6:staff:' || :'staffa'), null,
  'a second E6 for the same worker is still refused by its key');

select results_eq($$ select notification_outbox_purge() - 'willoDeliveries' $$,
  $$ values ('{"deleted":0,"tombstoned":0}'::jsonb) $$, 'a second run finds nothing to do');

insert into notification_outbox (key, channel, template, payload, send_after, sent_at)
select 'CP3:event:898:' || g, 'email', 'CP3', '{}', now() - interval '200 days', now() - interval '200 days'
  from generate_series(1, 3) g;
select is((notification_outbox_purge(180, 2) ->> 'deleted')::int, 2, 'one call handles no more rows than it is allowed');

-- willo_deliveries
insert into willo_deliveries (delivery_key, willo_candidate_id, event, applied_at) values
  ('sha256:898-old', 'W-898', 'new_response', now() - interval '181 days'),
  ('sha256:898-new', 'W-898', 'accepted',     now() - interval '10 days');
select is((notification_outbox_purge() ->> 'willoDeliveries')::int, 1, 'a Willo delivery record goes after 180 days');
select results_eq($$ select delivery_key from willo_deliveries where willo_candidate_id = 'W-898' $$,
  $$ values ('sha256:898-new'::text) $$, 'a recent one stays');

-- ---------------------------------------------------------------------
-- 3 · The jobs
-- ---------------------------------------------------------------------
delete from job_runs where job in ('location-pings-purge', 'outbox-purge');
select is(run_housekeeping_job('location-pings-purge') ->> 'ok', 'true', 'the pings purge runs as a housekeeping job');
select is(run_housekeeping_job('outbox-purge') ->> 'ok', 'true', 'so does the outbox purge');
select results_eq(
  $$ select job, ok, (select array_agg(k order by k) from jsonb_object_keys(counts) k)
       from job_runs where job in ('location-pings-purge', 'outbox-purge') order by job $$,
  $$ values ('location-pings-purge'::text, true, array['deleted']::text[]),
            ('outbox-purge', true, array['deleted', 'tombstoned', 'willoDeliveries']::text[]) $$,
  'each writes a job_runs row with its counts');

select is(install_housekeeping_schedules(), 4, 'four housekeeping jobs are scheduled');
select results_eq(
  $$ select jobname::text, schedule::text, command::text from cron.job
      where jobname in ('location-pings-purge', 'outbox-purge') order by jobname $$,
  $$ values ('location-pings-purge'::text, '51 3 * * *'::text, 'select public.run_housekeeping_job(''location-pings-purge'');'::text),
            ('outbox-purge', '56 3 * * *', 'select public.run_housekeeping_job(''outbox-purge'');') $$,
  'daily at 03:51 and 03:56 UTC, calling the SQL entry point — no HTTP, no secret');

select is_empty(
  $$ select f || ' → ' || r from unnest(array[
       'public.location_pings_purge(int, int)', 'public.notification_outbox_purge(int, int)']) f
     cross join unnest(array['anon', 'authenticated', 'service_role']) r
     where has_function_privilege(r, f, 'execute') $$,
  'only pg_cron (the owner) runs the purges');

select * from finish();
rollback;
