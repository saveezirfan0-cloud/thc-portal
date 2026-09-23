-- =====================================================================
-- 362 · The rota guard (completion letter requirement §4)
--   rota_guard_decide(), rota_guard_mode(), rota_guard_verdict(),
--   weekly_cap_would_breach(), the bookings_rota_guard trigger
--   from 20260923100200_rota_guard.sql
--
--   1. The decision, held to packages/domain/src/rotaGuard.vectors.json —
--      the same cases Vitest holds rotaGuardVerdict() to.
--   2. The setting: 'warn' only when it says exactly that; anything else,
--      including a deleted row, is 'block'.
--   3. The trigger's scope: it guards the move INTO confirmed on a shift
--      still to come, and nothing else.
-- =====================================================================
begin;
select plan(20);
\ir _shared/fixtures.psql
\ir _shared/rota_guard_vectors.psql

-- ---------------------------------------------------------------------
-- 1 · Shared vectors
-- ---------------------------------------------------------------------
select is((select count(*)::int from rota_guard_vectors), :rota_vector_count,
  format('all %s shared rota guard vectors loaded from rotaGuard.vectors.json', :rota_vector_count));
select results_eq(
  $$ select v.name, g.verdict, g.reason
       from rota_guard_vectors v
       cross join lateral rota_guard_decide(v.can_roster, v.cap_hours, v.band::cap_band,
                                            v.booked_hours, v.shift_hours, v.mode) g
      order by v.name $$,
  $$ select name, expect_verdict, expect_reason from rota_guard_vectors order by name $$,
  'rotaGuard.vectors.json: SQL rota_guard_decide() gives the same verdict AND reason as TypeScript rotaGuardVerdict(), case for case');

-- ---------------------------------------------------------------------
-- 2 · The setting fails closed
-- ---------------------------------------------------------------------
select is((select value #>> '{}' from settings where key = 'rota_guard_mode'), 'block',
  'the shipped default is block: §2.3 "treat 48 hours/week as the hard cap unless an opt-out is on file"');
select is(rota_guard_mode(), 'block', 'and it reads as block');
update settings set value = '"warn"' where key = 'rota_guard_mode';
select is(rota_guard_mode(), 'warn', 'an explicit warn reads as warn');
update settings set value = '"Warn "' where key = 'rota_guard_mode';
select is(rota_guard_mode(), 'block', 'a mistyped value reads as block');
delete from settings where key = 'rota_guard_mode';
select is(rota_guard_mode(), 'block', 'a deleted row reads as block — the guard fails closed');
insert into settings (key, value) values ('rota_guard_mode', '"block"');

-- A worker cannot read settings (admin_all only) but the mode still
-- resolves for them, so a staff-side caller of the gate gets the real rule.
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid')::text, true);
select is((select count(*)::int from settings), 0, 'a worker cannot read the settings table');
select is(rota_guard_mode(), 'block', 'but rota_guard_mode() answers for them, as the definer');
reset role;
select set_config('request.jwt.claims', '', true);
set local role anon;
select throws_ok('select rota_guard_mode()', '42501', null, 'anon cannot call it');
reset role;

-- ---------------------------------------------------------------------
-- 3 · The trigger's scope
-- ---------------------------------------------------------------------
\set stu 'c8000000-0000-4000-8000-000000000001'
\set ev  'c8100000-0000-4000-8000-000000000001'
select cap_week_start(current_date) + 14 as w \gset

insert into staff (id, first_name, last_name, email, phone, dob, status, rtw_branch, right_to_work_until)
values (:'stu', 'Rota', 'Student', 'rs@rg.test', '+447700980001', date '2001-01-01', 'compliant',
        'international_student', :'w'::date + 1);
insert into events (id, client_id, venue_id, venue_name, venue_address, venue_location, geofence_radius_m,
                    title, event_date, pays_breaks, pays_buffer)
values (:'ev', :'clienta', :'venue_id', 'RLS Fixture Venue', '1 Test Street, London',
        st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150, 'Guard Week', :'w'::date, true, true);
insert into shift_requirements (id, event_id, role_id, starts_at, ends_at, headcount, buffer,
                                charge_rate, pay_rate, allocation_per_hour) values
  -- 24 h in one go: over a student's 20 in a single shift.
  ('c8200000-0000-4000-8000-000000000001', :'ev', :'role_id',
   (:'w'::date + time '06:00') at time zone 'Europe/London',
   (:'w'::date + 1 + time '06:00') at time zone 'Europe/London', 5, 0, 20, 12, 5),
  -- A long shift that ended last month.
  ('c8200000-0000-4000-8000-000000000002', :'ev', :'role_id',
   now() - interval '40 days', now() - interval '40 days' + interval '24 hours', 5, 0, 20, 12, 5),
  -- Past the right to work (W+1 is the last valid day).
  ('c8200000-0000-4000-8000-000000000003', :'ev', :'role_id',
   (:'w'::date + 3 + time '09:00') at time zone 'Europe/London',
   (:'w'::date + 3 + time '13:00') at time zone 'Europe/London', 5, 0, 20, 12, 5);

select is(rota_guard_verdict(:'stu', 'c8200000-0000-4000-8000-000000000001') ->> 'reason', 'visa_cap',
  'rota_guard_verdict() explains a 24 h shift for a student as the visa cap');
select is(rota_guard_verdict(:'stu', 'c8200000-0000-4000-8000-000000000003') ->> 'reason', 'rtw_expired',
  'and a shift past the right to work as the expiry, whatever the hours');
select is(weekly_cap_would_breach(:'stu', 'c8200000-0000-4000-8000-000000000001'), true,
  'the existing gate agrees: block');
select is(weekly_cap_would_breach(:'staffa', 'c8200000-0000-4000-8000-000000000003'), false,
  'and a worker with no visa limit and no expiry is not gated on a 4 h shift');
select is(weekly_cap_would_breach(:'stu', gen_random_uuid()), false,
  'an unknown shift is not a breach, as before: a caller that needs "does it exist" asks shift_requirements');

select lives_ok($$ insert into bookings (shift_id, staff_id, status, source)
                   values ('c8200000-0000-4000-8000-000000000001', 'c8000000-0000-4000-8000-000000000001',
                           'invited', 'auto') $$,
  'an invitation is not rostering: the trigger lets it through');
select throws_ok($$ update bookings set status = 'confirmed'
                     where shift_id = 'c8200000-0000-4000-8000-000000000001'
                       and staff_id = 'c8000000-0000-4000-8000-000000000001' $$,
  'P0001', 'rota_guard_visa_cap', 'confirming it is');
select lives_ok($$ insert into bookings (shift_id, staff_id, status, source, confirmed_at)
                   values ('c8200000-0000-4000-8000-000000000002', 'c8000000-0000-4000-8000-000000000001',
                           'confirmed', 'manual', now() - interval '41 days') $$,
  'a shift that has already ended is history, not rostering — the trigger ignores it');
select lives_ok($$ update bookings set status = 'worked'
                     where shift_id = 'c8200000-0000-4000-8000-000000000002'
                       and staff_id = 'c8000000-0000-4000-8000-000000000001' $$,
  'and moving a booking out of confirmed is never refused');

-- The definition of done in the compliance brief, restated here because
-- it is the other half of the same promise: a worker whose document dies
-- today is blocked by the daily job, loses the shift, and is told once.
insert into compliance_docs (staff_id, doc_type, uploaded_at, expiry_date, review_status)
values (:'staffa', 'visa_document', now() - interval '5 years',
        (now() at time zone 'Europe/London')::date, 'verified');
select compliance_daily() is not null as first_sweep \gset
select compliance_daily() is not null as second_sweep \gset
select is(
  (select :'first_sweep'::boolean and :'second_sweep'::boolean
      and (select status::text from staff where id = :'staffa') = 'blocked'
      and (select status::text from bookings where id = :'booking_a') = 'cancelled'
      and (select count(*)::int from notification_outbox
            where template = 'N4' and recipient_staff_id = :'staffa') = 1),
  true,
  '§4.3: a document expiring today → blocked by compliance_daily, future booking released, N4 queued once');

select * from finish();
rollback;
