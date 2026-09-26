-- =====================================================================
-- 723 · The hourly offer rounds and the lapse (ADR-0045, ADR-0042)
--   20260930201100_shift_offers.sql
--
--   A · lapse_shift_offers(): past expiry → lapsed, OF3 for a pool offer,
--       silent for an unopened cover request and — since 20260930205000 —
--       for any offer whose section has already started; the worker stays
--       booked
--   B · offer_rounds_due(): open pool offers with auto-assign on
--   C · notify_offer_candidates(): additive (never twice), wave 1 first
--       (RULE-17 re-checked in SQL), never the offerer, a gated or an
--       unavailable worker, never after expiry or with auto-assign off —
--       and with auto-assign off wave 1 counts as exhausted at once, so
--       Radar and the take are not held for pushes that never come
--   D · who may run them: the service role only
-- =====================================================================
begin;
select plan(33);
\ir _shared/fixtures.psql

\set ev    '67300000-0000-4000-8000-000000000001'
\set s     '67310000-0000-4000-8000-000000000001'
\set s_off '67310000-0000-4000-8000-000000000002'
\set s_old '67310000-0000-4000-8000-000000000003'
\set s_run '67310000-0000-4000-8000-000000000004'

\set off   '67320000-0000-4000-8000-000000000001'
\set q1    '67320000-0000-4000-8000-000000000002'
\set q2    '67320000-0000-4000-8000-000000000003'
\set qa    '67320000-0000-4000-8000-000000000004'
\set u1    '67320000-0000-4000-8000-000000000005'
\set u2    '67320000-0000-4000-8000-000000000006'
\set blk   '67320000-0000-4000-8000-000000000007'
\set off2  '67320000-0000-4000-8000-000000000008'
\set off3  '67320000-0000-4000-8000-000000000009'

\set b_off  '67340000-0000-4000-8000-000000000001'
\set b_off2 '67340000-0000-4000-8000-000000000002'
\set b_old  '67340000-0000-4000-8000-000000000003'
\set b_cov  '67340000-0000-4000-8000-000000000004'
\set b_run  '67340000-0000-4000-8000-000000000005'
\set o      '67350000-0000-4000-8000-000000000001'
\set o_off  '67350000-0000-4000-8000-000000000002'
\set o_old  '67350000-0000-4000-8000-000000000003'
\set o_cov  '67350000-0000-4000-8000-000000000004'
\set o_run  '67350000-0000-4000-8000-000000000005'

insert into staff (id, first_name, last_name, email, phone, dob, status, rtw_branch, home_location,
                   reliability, rating) values
  (:'off',  'Ora',  'Offer',   'off@rd673.test',  '+447700967301', date '1995-01-01', 'compliant', 'uk_irish',
   st_setsrid(st_makepoint(-0.1010, 51.5000), 4326)::geography, 90, 4.5),
  (:'q1',   'Quin', 'First',   'q1@rd673.test',   '+447700967302', date '1995-01-02', 'compliant', 'uk_irish',
   st_setsrid(st_makepoint(-0.1010, 51.5000), 4326)::geography, 90, 4.5),
  (:'q2',   'Quin', 'Second',  'q2@rd673.test',   '+447700967303', date '1995-01-03', 'compliant', 'uk_irish',
   st_setsrid(st_makepoint(-0.1010, 51.5000), 4326)::geography, 90, 4.5),
  (:'qa',   'Quin', 'Away',    'qa@rd673.test',   '+447700967304', date '1995-01-04', 'compliant', 'uk_irish',
   st_setsrid(st_makepoint(-0.1010, 51.5000), 4326)::geography, 90, 4.5),
  (:'u1',   'Una',  'Second',  'u1@rd673.test',   '+447700967305', date '1995-01-05', 'compliant', 'uk_irish',
   st_setsrid(st_makepoint(-0.1010, 51.5000), 4326)::geography, 90, 4.5),
  (:'u2',   'Uma',  'Second',  'u2@rd673.test',   '+447700967306', date '1995-01-06', 'compliant', 'uk_irish',
   st_setsrid(st_makepoint(-0.1010, 51.5000), 4326)::geography, 90, 4.5),
  (:'blk',  'Bo',   'Blocked', 'bl@rd673.test',   '+447700967307', date '1995-01-07', 'blocked',   'uk_irish',
   st_setsrid(st_makepoint(-0.1010, 51.5000), 4326)::geography, 90, 4.5),
  (:'off2', 'Otto', 'Offer',   'off2@rd673.test', '+447700967308', date '1995-01-08', 'compliant', 'uk_irish',
   st_setsrid(st_makepoint(-0.1010, 51.5000), 4326)::geography, 90, 4.5),
  (:'off3', 'Oona', 'Offer',   'off3@rd673.test', '+447700967309', date '1995-01-09', 'compliant', 'uk_irish',
   st_setsrid(st_makepoint(-0.1010, 51.5000), 4326)::geography, 90, 4.5);
insert into staff_roles (staff_id, role_id)
select id, :'role_id' from staff where email like '%@rd673.test';

insert into events (id, client_id, venue_id, venue_name, venue_address, venue_location, geofence_radius_m,
                    title, event_date, pays_breaks, pays_buffer, auto_assign) values
  (:'ev', :'clientb', :'venue_id', 'RLS Fixture Venue', '1 Test Street, London',
   st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150, 'Rounds Gala', current_date + 15, true, true, true);

insert into shift_requirements (id, event_id, role_id, starts_at, ends_at, headcount, buffer,
                                charge_rate, pay_rate, allocation_per_hour, auto_assign) values
  (:'s',     :'ev', :'role_id', now() + interval '15 days', now() + interval '15 days 6 hours', 3, 0, 20, 14, 2, true),
  (:'s_off', :'ev', :'role_id', now() + interval '17 days', now() + interval '17 days 6 hours', 3, 0, 20, 14, 2, false),
  (:'s_old', :'ev', :'role_id', now() + interval '19 days', now() + interval '19 days 6 hours', 3, 0, 20, 14, 2, true),
  -- Started an hour ago: a cover request the office opened to the pool
  -- runs to the start, so it lapses once the section is under way.
  (:'s_run', :'ev', :'role_id', now() - interval '1 hour', now() + interval '5 hours', 3, 0, 20, 14, 2, true);

-- Wave 1 at clientb + role: Quin First, Quin Second, Quin Away (and the
-- fixture's own Staff Bravo). Una and Uma are wave 2.
insert into client_qualifications (client_id, role_id, staff_id) values
  (:'clientb', :'role_id', :'q1'), (:'clientb', :'role_id', :'q2'), (:'clientb', :'role_id', :'qa'),
  (:'clientb', :'role_id', :'off');
-- Quin Away has marked the section's day unavailable (ADR-0042).
insert into staff_unavailability (staff_id, period)
values (:'qa', tstzrange(now() + interval '15 days' - interval '1 hour', now() + interval '15 days 7 hours', '[)'));

insert into bookings (id, shift_id, staff_id, status, source, confirmed_at) values
  (:'b_off',  :'s',     :'off',  'confirmed', 'auto', now()),
  (:'b_off2', :'s_off', :'off2', 'confirmed', 'auto', now()),
  (:'b_old',  :'s_old', :'off3', 'confirmed', 'auto', now()),
  (:'b_cov',  :'s_old', :'off',  'confirmed', 'auto', now()),
  (:'b_run',  :'s_run', :'off2', 'confirmed', 'auto', now() - interval '3 days');

insert into shift_offers (id, booking_id, mode, expires_at) values
  (:'o',     :'b_off',  'pool', now() + interval '12 days'),
  (:'o_off', :'b_off2', 'pool', now() + interval '14 days'),
  -- Past its expiry: the lapse job's.
  (:'o_old', :'b_old',  'pool', now() - interval '5 minutes'),
  (:'o_run', :'b_run',  'pool', now() - interval '1 hour');
insert into shift_offers (id, booking_id, mode, expires_at, note) values
  (:'o_cov', :'b_cov', 'office', now() - interval '1 minute', null);

-- =====================================================================
-- A · lapse_shift_offers()
-- =====================================================================
select is(lapse_shift_offers(), 3, 'A: the three offers past their expiry lapse');
select is((select array[status, closed_reason] from shift_offers where id = :'o_old'),
  array['lapsed', 'expired'], 'A: lapsed, expired');
select is((select status::text from bookings where id = :'b_old'), 'confirmed', 'A: Oona is still booked');
select is((select recipient_staff_id from notification_outbox where key = 'OF3:offer:' || :'o_old'), :'off3'::uuid,
  'A: OF3 tells her so');
select is((select count(*)::int from notification_outbox where key = 'OF3:offer:' || :'o_cov'), 0,
  'A: a cover request the office never opened lapses silently');
select is((select status from shift_offers where id = :'o_run'), 'lapsed',
  'A: an offer on a section already under way lapses too');
select is((select count(*)::int from notification_outbox where key = 'OF3:offer:' || :'o_run'), 0,
  'A: but with no OF3 — once the section has started "you''re still booked" is news to nobody');
select is((select status from shift_offers where id = :'o'), 'open', 'A: an offer still in date is untouched');
select is(lapse_shift_offers(), 0, 'A: and a second run finds nothing — idempotent');

-- =====================================================================
-- B · offer_rounds_due()
-- =====================================================================
select bag_eq(
  format($$ select offer_id from offer_rounds_due() where event_id = %L $$, :'ev'),
  format($$ values (%L::uuid) $$, :'o'),
  'B: the open pool offer with auto-assign on is due; the role switched off is not, nor the lapsed');
select is((select allocation from offer_rounds_due() where offer_id = :'o'), 2,
  'B: with the section''s allocation_per_hour');

-- =====================================================================
-- C · notify_offer_candidates()
-- =====================================================================
select ok(not offer_wave1_exhausted(:'o'), 'C: nobody has been told yet');
select is(notify_offer_candidates(:'o', array[:'u1'::uuid, :'q1'::uuid]), 1,
  'C: a round naming Una (wave 2) and Quin First: only Quin is told — Quin Second is still untold');
select bag_eq(
  format($$ select staff_id from shift_offer_notices where offer_id = %L $$, :'o'),
  format($$ values (%L::uuid) $$, :'q1'),
  'C: one notice, Quin First''s');
select is(
  (select array[template, channel::text, recipient_staff_id::text] from notification_outbox
    where key = 'OF1:offer:' || :'o' || ':' || :'q1'),
  array['OF1', 'push', :'q1'], 'C: OF1 keyed per offer and worker');

select is(notify_offer_candidates(:'o', array[:'q1'::uuid]), 0,
  'C: additive: Quin First is never pushed twice');
select is(notify_offer_candidates(:'o', array[:'off'::uuid, :'blk'::uuid, :'qa'::uuid]), 0,
  'C: never the offerer, a blocked worker, or one marked unavailable (ADR-0042)');
select ok(not exists (select 1 from shift_offer_notices where offer_id = :'o' and staff_id in (:'off', :'blk', :'qa')),
  'C: none of them is recorded as told');

-- Quin Second, Staff Bravo (the fixture's wave-1 worker), then wave 2.
select is(notify_offer_candidates(:'o', array[:'u1'::uuid, :'q2'::uuid, :'staffb'::uuid, :'u2'::uuid]), 4,
  'C: with the rest of wave 1 in the same round, wave 2 follows it — four told');
select ok(offer_wave1_exhausted(:'o'),
  'C: wave 1 is exhausted: every qualified, ungated, available worker has been told (Quin Away never will be)');
select is((select count(*)::int from shift_offer_notices where offer_id = :'o'), 5, 'C: five notices in all');
select is((select count(*)::int from notification_outbox where template = 'OF1' and payload ->> 'offerId' = :'o'), 5,
  'C: five OF1 pushes, one each');

select is(notify_offer_candidates(:'o_off', array[:'q1'::uuid]), 0,
  'C: with the role''s auto-assign off, nothing is pushed');
select ok(offer_wave1_exhausted(:'o_off'),
  'C: so wave 1 counts as exhausted at once (20260930205000) — nobody waits for pushes that never come');
select is(notify_offer_candidates(:'o_old', array[:'q1'::uuid]), 0, 'C: nor for a lapsed offer');
update shift_offers set expires_at = now() where id = :'o';
select is(notify_offer_candidates(:'o', array[:'u1'::uuid]), 0, 'C: nor once the offer has reached its expiry');

select ok(not exists (select 1 from notification_outbox n
                       where n.template = 'OF1' and n.payload ? 'name'),
  'C: OF1 never names the offerer');

-- =====================================================================
-- D · the service role only
-- =====================================================================
select ok(not has_function_privilege('authenticated', 'public.lapse_shift_offers(timestamptz)', 'execute')
          and not has_function_privilege('authenticated', 'public.offer_rounds_due(timestamptz)', 'execute')
          and not has_function_privilege('authenticated', 'public.offer_candidates(uuid)', 'execute')
          and not has_function_privilege('authenticated', 'public.notify_offer_candidates(uuid, uuid[])', 'execute')
          and not has_function_privilege('authenticated', 'public.offer_wave1_exhausted(uuid)', 'execute'),
  'D: no signed-in caller can run a round, a lapse or read the pool');
select ok(not has_function_privilege('anon', 'public.notify_offer_candidates(uuid, uuid[])', 'execute'),
  'D: nor anon');
select ok(has_function_privilege('service_role', 'public.lapse_shift_offers(timestamptz)', 'execute')
          and has_function_privilege('service_role', 'public.offer_rounds_due(timestamptz)', 'execute')
          and has_function_privilege('service_role', 'public.offer_candidates(uuid)', 'execute')
          and has_function_privilege('service_role', 'public.notify_offer_candidates(uuid, uuid[])', 'execute'),
  'D: the auto-staffing job can');

select ok(not exists (select 1 from offer_candidates(:'o') where staff_id = :'off'),
  'D: offer_candidates never lists the offerer');
select is((select gate from offer_candidates(:'o') where staff_id = :'blk'), 'blocked',
  'D: and carries the pool''s gates, for selectOfferRecipients to drop');
select is((select count(*)::int from offer_candidates(:'o')),
  (select count(*)::int - 1 from auto_assign_candidates(:'s')),
  'D: it is the section''s pool less one');

select * from finish();
rollback;
