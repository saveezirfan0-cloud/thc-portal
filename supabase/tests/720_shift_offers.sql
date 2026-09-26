-- =====================================================================
-- 720 · Offer up a shift — offer, withdraw, lapse (ADR-0045, docs/19 §4)
--   20260930201100_shift_offers.sql
--
--   A · who may call the worker RPCs: a worker, never the office, and
--       never a leaver, a rejected candidate or a removed account
--       (20260930205000: staff_caller(), 20260930202000's error shape)
--   B · offer_shift(): the worker stays confirmed; the refusals too_late
--       (at exactly 72 h — RULE-04's boundary), auto_assign_off (role or
--       event switch), already_offered, not_confirmed, event_cancelled
--   C · withdraw_shift_offer(): own offer only, once
--   D · bookings_offer_lapse: every other exit from confirmed lapses the
--       open offer, silently, with the cause as closed_reason
--
-- Every row is created inside the transaction and rolled back.
-- =====================================================================
begin;
select plan(42);
\ir _shared/fixtures.psql

\set ev      '67000000-0000-4000-8000-000000000001'
\set ev_off  '67000000-0000-4000-8000-000000000002'
\set ev_x    '67000000-0000-4000-8000-000000000003'
\set ev_c    '67000000-0000-4000-8000-000000000004'
\set s_far   '67010000-0000-4000-8000-000000000001'
\set s_edge  '67010000-0000-4000-8000-000000000002'
\set s_plus  '67010000-0000-4000-8000-000000000003'
\set s_roff  '67010000-0000-4000-8000-000000000004'
\set s_eoff  '67010000-0000-4000-8000-000000000005'
\set s_x     '67010000-0000-4000-8000-000000000006'
\set s_many  '67010000-0000-4000-8000-000000000007'
\set s_c     '67010000-0000-4000-8000-000000000008'

\set o1  '67020000-0000-4000-8000-000000000001'
\set o2  '67020000-0000-4000-8000-000000000002'
\set u1  '67030000-0000-4000-8000-000000000001'
\set u2  '67030000-0000-4000-8000-000000000002'
\set c1  '67020000-0000-4000-8000-000000000011'
\set c2  '67020000-0000-4000-8000-000000000012'
\set c3  '67020000-0000-4000-8000-000000000013'
\set c4  '67020000-0000-4000-8000-000000000014'
\set c5  '67020000-0000-4000-8000-000000000015'
\set c6  '67020000-0000-4000-8000-000000000016'
\set c7  '67020000-0000-4000-8000-000000000017'
\set c8  '67020000-0000-4000-8000-000000000018'
\set uc6 '67030000-0000-4000-8000-000000000016'
\set lv  '67020000-0000-4000-8000-000000000021'
\set rj  '67020000-0000-4000-8000-000000000022'
\set rm  '67020000-0000-4000-8000-000000000023'
\set ulv '67030000-0000-4000-8000-000000000021'
\set urj '67030000-0000-4000-8000-000000000022'
\set urm '67030000-0000-4000-8000-000000000023'

\set b_far  '67040000-0000-4000-8000-000000000001'
\set b_edge '67040000-0000-4000-8000-000000000002'
\set b_plus '67040000-0000-4000-8000-000000000003'
\set b_roff '67040000-0000-4000-8000-000000000004'
\set b_eoff '67040000-0000-4000-8000-000000000005'
\set b_x    '67040000-0000-4000-8000-000000000006'
\set b_inv  '67040000-0000-4000-8000-000000000007'
\set b_c1   '67040000-0000-4000-8000-000000000011'
\set b_c2   '67040000-0000-4000-8000-000000000012'
\set b_c3   '67040000-0000-4000-8000-000000000013'
\set b_c4   '67040000-0000-4000-8000-000000000014'
\set b_c5   '67040000-0000-4000-8000-000000000015'
\set b_c6   '67040000-0000-4000-8000-000000000016'
\set b_c7   '67040000-0000-4000-8000-000000000017'
\set b_c8   '67040000-0000-4000-8000-000000000018'

-- ---------------------------------------------------------------------
-- Fixture
-- ---------------------------------------------------------------------
insert into auth.users (id, email) values
  (:'u1', 'o1@so670.test'), (:'u2', 'o2@so670.test'), (:'uc6', 'c6@so670.test'),
  (:'ulv', 'lv@so670.test'), (:'urj', 'rj@so670.test'), (:'urm', 'rm@so670.test');
insert into profiles (id, role, full_name) values
  (:'u1', 'staff', 'Olly One'), (:'u2', 'staff', 'Olga Two'), (:'uc6', 'staff', 'Cass Six'),
  (:'ulv', 'staff', 'Lee Left'), (:'urj', 'staff', 'Rhi Rejected'), (:'urm', 'staff', 'Rex Removed');

insert into staff (id, user_id, first_name, last_name, email, phone, dob, status, rtw_branch) values
  (:'o1', :'u1',  'Olly', 'One',   'o1@so670.test', '+447700967001', date '1995-01-01', 'compliant', 'uk_irish'),
  (:'o2', :'u2',  'Olga', 'Two',   'o2@so670.test', '+447700967002', date '1995-01-02', 'compliant', 'uk_irish'),
  (:'c1', null,   'Cy',   'One',   'c1@so670.test', '+447700967011', date '1995-01-11', 'compliant', 'uk_irish'),
  (:'c2', null,   'Cy',   'Two',   'c2@so670.test', '+447700967012', date '1995-01-12', 'compliant', 'uk_irish'),
  (:'c3', null,   'Cy',   'Three', 'c3@so670.test', '+447700967013', date '1995-01-13', 'compliant', 'uk_irish'),
  (:'c4', null,   'Cy',   'Four',  'c4@so670.test', '+447700967014', date '1995-01-14', 'compliant', 'uk_irish'),
  (:'c5', null,   'Cy',   'Five',  'c5@so670.test', '+447700967015', date '1995-01-15', 'compliant', 'uk_irish'),
  (:'c6', :'uc6', 'Cass', 'Six',   'c6@so670.test', '+447700967016', date '1995-01-16', 'compliant', 'uk_irish'),
  (:'c7', null,   'Cy',   'Seven', 'c7@so670.test', '+447700967017', date '1995-01-17', 'compliant', 'uk_irish'),
  (:'c8', null,   'Cy',   'Eight', 'c8@so670.test', '+447700967018', date '1995-01-18', 'compliant', 'uk_irish'),
  (:'lv', :'ulv', 'Lee',  'Left',     'lv@so670.test', '+447700967021', date '1995-01-21', 'inactive',  'uk_irish'),
  (:'rj', :'urj', 'Rhi',  'Rejected', 'rj@so670.test', '+447700967022', date '1995-01-22', 'rejected',  'uk_irish'),
  (:'rm', :'urm', 'Rex',  'Removed',  'rm@so670.test', '+447700967023', date '1995-01-23', 'removed',   'uk_irish');
update staff set left_at = now() where id = :'lv';
insert into staff_roles (staff_id, role_id)
select id, :'role_id' from staff where email like '%@so670.test';

insert into events (id, client_id, venue_id, venue_name, venue_address, venue_location, geofence_radius_m,
                    title, event_date, pays_breaks, pays_buffer, auto_assign) values
  (:'ev',     :'clienta', :'venue_id', 'RLS Fixture Venue', '1 Test Street, London',
   st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150, 'Offer Gala', current_date + 12, true, true, true),
  (:'ev_off', :'clienta', :'venue_id', 'RLS Fixture Venue', '1 Test Street, London',
   st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150, 'Hand-picked', current_date + 12, true, true, false),
  (:'ev_x',   :'clienta', :'venue_id', 'RLS Fixture Venue', '1 Test Street, London',
   st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150, 'Called Off', current_date + 12, true, true, true),
  (:'ev_c',   :'clienta', :'venue_id', 'RLS Fixture Venue', '1 Test Street, London',
   st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150, 'To Be Cancelled', current_date + 13, true, true, true);

-- Every section 4 hours, on its own day, so nobody's week or rota collides.
insert into shift_requirements (id, event_id, role_id, starts_at, ends_at, headcount, buffer,
                                charge_rate, pay_rate, allocation_per_hour, auto_assign) values
  (:'s_far',  :'ev',     :'role_id', now() + interval '12 days',  now() + interval '12 days 4 hours', 2, 1, 20, 14, 3, true),
  -- Exactly 72 hours from now(): RULE-04's boundary, which is refused.
  (:'s_edge', :'ev',     :'role_id', now() + interval '72 hours', now() + interval '76 hours',       2, 0, 20, 14, 2, true),
  -- One second more: offered.
  (:'s_plus', :'ev',     :'role_id', now() + interval '72 hours 1 second',
                                     now() + interval '76 hours 1 second',                          2, 0, 20, 14, 2, true),
  (:'s_roff', :'ev',     :'role_id', now() + interval '14 days',  now() + interval '14 days 4 hours', 2, 0, 20, 14, 2, false),
  (:'s_eoff', :'ev_off', :'role_id', now() + interval '16 days',  now() + interval '16 days 4 hours', 2, 0, 20, 14, 2, true),
  (:'s_x',    :'ev_x',   :'role_id', now() + interval '18 days',  now() + interval '18 days 4 hours', 2, 0, 20, 14, 2, true),
  (:'s_many', :'ev',     :'role_id', now() + interval '20 days',  now() + interval '20 days 4 hours', 9, 0, 20, 14, 9, true),
  (:'s_c',    :'ev_c',   :'role_id', now() + interval '22 days',  now() + interval '22 days 4 hours', 2, 0, 20, 14, 2, true);

insert into bookings (id, shift_id, staff_id, status, source, confirmed_at) values
  (:'b_far',  :'s_far',  :'o1', 'confirmed', 'auto', now()),
  (:'b_edge', :'s_edge', :'o1', 'confirmed', 'auto', now()),
  (:'b_plus', :'s_plus', :'o2', 'confirmed', 'auto', now()),
  (:'b_roff', :'s_roff', :'o1', 'confirmed', 'auto', now()),
  (:'b_eoff', :'s_eoff', :'o1', 'confirmed', 'auto', now()),
  (:'b_x',    :'s_x',    :'o1', 'confirmed', 'auto', now()),
  (:'b_c1',   :'s_many', :'c1', 'confirmed', 'auto', now()),
  (:'b_c2',   :'s_many', :'c2', 'confirmed', 'auto', now()),
  (:'b_c3',   :'s_many', :'c3', 'confirmed', 'auto', now()),
  (:'b_c4',   :'s_many', :'c4', 'confirmed', 'auto', now()),
  (:'b_c5',   :'s_many', :'c5', 'confirmed', 'auto', now()),
  (:'b_c6',   :'s_many', :'c6', 'confirmed', 'auto', now()),
  (:'b_c7',   :'s_many', :'c7', 'confirmed', 'auto', now()),
  (:'b_c8',   :'s_c',    :'c8', 'confirmed', 'auto', now());
insert into bookings (id, shift_id, staff_id, status, source)
values (:'b_inv', :'s_many', :'o1', 'invited', 'auto');
-- Cancelled after its bookings were confirmed, as a stale screen would find it.
update events set cancelled_at = now(), cancel_reason = 'fixture' where id = :'ev_x';

-- =====================================================================
-- A · who may call it
-- =====================================================================
select ok(not has_function_privilege('anon', 'public.offer_shift(uuid)', 'execute')
          and not has_function_privilege('anon', 'public.withdraw_shift_offer(uuid)', 'execute')
          and not has_function_privilege('anon', 'public.request_cover(uuid, text)', 'execute')
          and not has_function_privilege('anon', 'public.take_offered_shift(uuid)', 'execute')
          and not has_function_privilege('anon', 'public.staff_open_offers(uuid)', 'execute')
          and not has_function_privilege('anon', 'public.staff_booking_offers()', 'execute'),
  'A: anon can call none of the worker offer RPCs');
select ok(has_function_privilege('authenticated', 'public.offer_shift(uuid)', 'execute')
          and has_function_privilege('authenticated', 'public.take_offered_shift(uuid)', 'execute'),
  'A: a signed-in worker can; the checks inside are the gate');
select ok(not has_function_privilege('authenticated', 'public.bookings_offer_lapse()', 'execute')
          and not has_function_privilege('authenticated', 'public.queue_offer_notice(text, uuid, uuid)', 'execute'),
  'A: the trigger function and the outbox writer are not RPCs');

select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(format($$ select offer_shift(%L) $$, :'b_far'), 'P0001', 'unknown_staff',
  'A: the office cannot offer a worker''s shift for them (Invariant 4)');
reset role;

-- The caller is refused by who they are before anything is looked up, in
-- 20260930202000's shape.
select set_config('request.jwt.claims', json_build_object('sub', :'ulv', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(format($$ select offer_shift(%L) $$, :'b_far'), 'P0001', 'not_editable',
  'A: a leaver cannot offer a shift');
select throws_ok(format($$ select withdraw_shift_offer(%L) $$, gen_random_uuid()), 'P0001', 'not_editable',
  'A: nor withdraw an offer');
reset role;
select set_config('request.jwt.claims', json_build_object('sub', :'urj', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(format($$ select offer_shift(%L) $$, :'b_far'), 'P0001', 'not_editable',
  'A: a rejected candidate cannot offer a shift');
select throws_ok(format($$ select take_offered_shift(%L) $$, gen_random_uuid()), 'P0001', 'not_editable',
  'A: nor take one');
reset role;
select set_config('request.jwt.claims', json_build_object('sub', :'urm', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(format($$ select offer_shift(%L) $$, :'b_far'), 'P0001', 'account_closed',
  'A: a removed account cannot offer a shift');
select throws_ok(format($$ select withdraw_shift_offer(%L) $$, gen_random_uuid()), 'P0001', 'account_closed',
  'A: nor withdraw an offer');
select throws_ok(format($$ select take_offered_shift(%L) $$, gen_random_uuid()), 'P0001', 'account_closed',
  'A: nor take one');
reset role;

select set_config('request.jwt.claims', json_build_object('sub', :'u2', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(format($$ select offer_shift(%L) $$, :'b_far'), '42501', 'not_your_booking',
  'A: nor can another worker');
reset role;

-- =====================================================================
-- B · offer_shift()
-- =====================================================================
select set_config('request.jwt.claims', json_build_object('sub', :'u1', 'role', 'authenticated')::text, true);
set local role authenticated;
select is(offer_shift(:'b_far') ->> 'ok', 'true', 'B: Olly offers his confirmed shift twelve days out');
select is(offer_shift(:'b_far'), jsonb_build_object('ok', false, 'reason', 'already_offered'),
  'B: one open offer per booking');
select is(offer_shift(:'b_edge'), jsonb_build_object('ok', false, 'reason', 'too_late'),
  'B: at exactly 72 hours it is gone — the Cancel shift boundary (RULE-04)');
select is(offer_shift(:'b_roff'), jsonb_build_object('ok', false, 'reason', 'auto_assign_off'),
  'B: the role''s auto-assign is off: ask the office instead');
select is(offer_shift(:'b_eoff'), jsonb_build_object('ok', false, 'reason', 'auto_assign_off'),
  'B: the event''s auto-assign is off: the same');
select is(offer_shift(:'b_inv'), jsonb_build_object('ok', false, 'reason', 'not_confirmed'),
  'B: an invitation is not a shift to offer');
select is(offer_shift(:'b_x'), jsonb_build_object('ok', false, 'reason', 'event_cancelled'),
  'B: nor a shift on a cancelled event');
reset role;

select set_config('request.jwt.claims', json_build_object('sub', :'u2', 'role', 'authenticated')::text, true);
set local role authenticated;
select is(offer_shift(:'b_plus') ->> 'ok', 'true',
  'B: 72 hours and one second out, Olga can still offer hers');
reset role;
select set_config('request.jwt.claims', '', true);

select is(
  (select array[mode, status, shift_id::text, offered_by_staff_id::text]
     from shift_offers where booking_id = :'b_far'),
  array['pool', 'open', :'s_far', :'o1'],
  'B: an open pool offer on the booking''s own section, by its own worker');
select is((select expires_at from shift_offers where booking_id = :'b_far'),
  (select starts_at - interval '72 hours' from shift_requirements where id = :'s_far'),
  'B: it closes at the section start − 72 h (offerExpiresAt)');
select is((select status::text from bookings where id = :'b_far'), 'confirmed',
  'B: Olly stays confirmed until somebody takes it');
select is((select confirmed from shift_fill(:'s_far')), 1,
  'B: and the fill is unchanged — 1 of 2 (+1), counting only confirmed');
select is((select count(*)::int from audit_log
            where action = 'shift_offer.offered'
              and entity_id = (select id from shift_offers where booking_id = :'b_far')
              and actor = :'u1'::uuid), 1,
  'B: the offer is audited against the worker who made it');
select is((select count(*)::int from notification_outbox
            where template like 'OF%' and payload ->> 'offerId' =
                  (select id::text from shift_offers where booking_id = :'b_far')), 0,
  'B: nothing is pushed at once — OF1 goes out in the hourly rounds');
select is((select count(*)::int from shift_offers where booking_id in (:'b_edge', :'b_roff', :'b_eoff', :'b_inv', :'b_x')), 0,
  'B: no refusal wrote an offer');

-- =====================================================================
-- C · withdraw_shift_offer()
-- =====================================================================
select id as offer_far from shift_offers where booking_id = :'b_far' \gset

select set_config('request.jwt.claims', json_build_object('sub', :'u2', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(format($$ select withdraw_shift_offer(%L) $$, :'offer_far'), '42501', 'not_your_offer',
  'C: only the worker who offered it can withdraw it');
reset role;

select set_config('request.jwt.claims', json_build_object('sub', :'u1', 'role', 'authenticated')::text, true);
set local role authenticated;
select is(withdraw_shift_offer(:'offer_far'), jsonb_build_object('ok', true), 'C: Olly withdraws his offer');
select is(withdraw_shift_offer(:'offer_far') ->> 'reason', 'offer_not_open', 'C: once');
select is(offer_shift(:'b_far') ->> 'ok', 'true', 'C: and may offer it again — a new offer');
reset role;
select set_config('request.jwt.claims', '', true);

select is(
  (select array[status, closed_reason] from shift_offers where id = :'offer_far'),
  array['withdrawn', 'withdrawn_by_worker'], 'C: the first is withdrawn');
select ok((select closed_at is not null from shift_offers where id = :'offer_far'),
  'C: and stamped closed by the state guard');
select is((select count(*)::int from shift_offers where booking_id = :'b_far' and status = 'open'), 1,
  'C: the second is the one open offer');

-- =====================================================================
-- D · bookings_offer_lapse: any other exit from confirmed
-- =====================================================================
insert into shift_offers (booking_id, expires_at)
select b.id, now() + interval '17 days'
  from bookings b where b.id in (:'b_c1', :'b_c2', :'b_c3', :'b_c4', :'b_c5', :'b_c6', :'b_c7', :'b_c8');

-- Withdraw (the board's update), the 12:05 cutoff, block, leave, GDPR and
-- check-in, as their writers leave the row.
update bookings set status = 'cancelled', cancelled_at = now(), cancel_cause = 'office_withdraw' where id = :'b_c1';
update bookings set status = 'cancelled', cancelled_at = now(), cancel_cause = 'ready_cutoff'    where id = :'b_c2';
update bookings set status = 'cancelled', cancelled_at = now(), cancel_cause = 'blocked'         where id = :'b_c3';
update bookings set status = 'cancelled', cancelled_at = now(), cancel_cause = 'left'            where id = :'b_c4';
update bookings set status = 'cancelled', cancelled_at = now(), cancel_cause = 'gdpr'            where id = :'b_c5';
update bookings set status = 'worked' where id = :'b_c7';

-- The worker's own self-cancel, through its RPC.
select set_config('request.jwt.claims', json_build_object('sub', :'uc6', 'role', 'authenticated')::text, true);
set local role authenticated;
select is(self_cancel_booking(:'b_c6') ->> 'ok', 'true', 'D: Cass self-cancels her offered shift instead');
reset role;

-- The office cancels the whole event.
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is(cancel_event(:'ev_c', 'Client pulled the event') ->> 'ok', 'true', 'D: the office cancels an event');
reset role;
select set_config('request.jwt.claims', '', true);

select bag_eq(
  format($$ select b.cancel_cause_or_status, o.status, o.closed_reason
              from shift_offers o
              join (select id, coalesce(cancel_cause, status::text) as cancel_cause_or_status from bookings) b
                on b.id = o.booking_id
             where o.booking_id in (%L, %L, %L, %L, %L, %L, %L, %L) $$,
         :'b_c1', :'b_c2', :'b_c3', :'b_c4', :'b_c5', :'b_c6', :'b_c7', :'b_c8'),
  $$ values ('office_withdraw', 'lapsed', 'office_withdraw'),
            ('ready_cutoff',    'lapsed', 'ready_cutoff'),
            ('blocked',         'lapsed', 'blocked'),
            ('left',            'lapsed', 'left'),
            ('gdpr',            'lapsed', 'gdpr'),
            ('self_cancel',     'lapsed', 'self_cancel'),
            ('worked',          'lapsed', 'worked'),
            ('event_cancelled', 'lapsed', 'event_cancelled') $$,
  'D: Withdraw, the cutoff, block, leave, GDPR, self-cancel, check-in and the event''s cancellation each lapse the offer, naming the cause');
select is((select count(*)::int from notification_outbox
            where template = 'OF3'
              and payload ->> 'bookingId' in (:'b_c1', :'b_c2', :'b_c3', :'b_c4', :'b_c5', :'b_c6', :'b_c7', :'b_c8')), 0,
  'D: silently — OF3 is for an expiry only; each cause has its own notification');
select is((select count(*)::int from notification_outbox where key = 'E10:booking:' || :'b_c6'), 1,
  'D: the self-cancel still sent the office its E10');

-- A booking that stays confirmed keeps its offer.
update bookings set day_before_confirmed_at = now() where id = :'b_far';
select is((select count(*)::int from shift_offers where booking_id = :'b_far' and status = 'open'), 1,
  'D: an update that leaves the booking confirmed does not touch its offer');

-- And the trigger is not something a caller can drive.
select is(
  (select count(*)::int from pg_trigger
    where tgname = 'bookings_offer_lapse' and tgrelid = 'public.bookings'::regclass),
  1, 'D: bookings_offer_lapse is installed on bookings');
select ok((select prosecdef from pg_proc where oid = 'public.bookings_offer_lapse()'::regprocedure),
  'D: definer, so it closes the offer whoever moved the booking (the office has no write on shift_offers)');

select * from finish();
rollback;
