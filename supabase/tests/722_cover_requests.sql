-- =====================================================================
-- 722 · "Ask the office for cover" (ADR-0046, docs/19 §4 point 3)
--   20260930201100_shift_offers.sql
--
--   A · request_cover(): inside 72 h (or with auto-assign off) an `office`
--       offer — not visible, not pushed, not takeable; OF5 to admin@ at
--       once; the worker stays confirmed. Refusals use_offer,
--       note_too_long, already_offered, not_confirmed, section_started.
--   B · office_open_offer_to_pool(): office → pool until the section's
--       start; then Radar shows it and it can be taken
--   C · office_decline_cover(): open → cancelled, OF6 to the worker
--   D · Withdraw (the office's cover by hand) lapses the request
--   E · with auto-assign off, a request the office opens to the pool goes
--       to everyone at once — wave 1 counts as exhausted, since no OF1 is
--       ever pushed (20260930205000, QA S1: the RULE-17 deadlock)
--   F · ask / withdraw / ask again: recently_requested within 24 h, and
--       OF5 keyed on the booking, so admin@ is emailed once (security #1)
--
-- The callers (20260930205000): a leaver or a removed account cannot ask.
-- =====================================================================
begin;
select plan(56);
\ir _shared/fixtures.psql

\set ev    '67200000-0000-4000-8000-000000000001'
\set ev2   '67200000-0000-4000-8000-000000000002'
\set s_in  '67210000-0000-4000-8000-000000000001'
\set s_out '67210000-0000-4000-8000-000000000002'
\set s_off '67210000-0000-4000-8000-000000000003'
\set s_go  '67210000-0000-4000-8000-000000000004'
\set s_hand  '67210000-0000-4000-8000-000000000005'
\set s_flood '67210000-0000-4000-8000-000000000006'

\set k1   '67220000-0000-4000-8000-000000000001'
\set k2   '67220000-0000-4000-8000-000000000002'
\set k3   '67220000-0000-4000-8000-000000000003'
\set q1   '67220000-0000-4000-8000-000000000004'
\set uk1  '67230000-0000-4000-8000-000000000001'
\set uk2  '67230000-0000-4000-8000-000000000002'
\set uk3  '67230000-0000-4000-8000-000000000003'
\set uq1  '67230000-0000-4000-8000-000000000004'
\set e1   '67220000-0000-4000-8000-000000000005'
\set lv   '67220000-0000-4000-8000-000000000006'
\set rm   '67220000-0000-4000-8000-000000000007'
\set ue1  '67230000-0000-4000-8000-000000000005'
\set ulv  '67230000-0000-4000-8000-000000000006'
\set urm  '67230000-0000-4000-8000-000000000007'

\set b_in  '67240000-0000-4000-8000-000000000001'
\set b_out '67240000-0000-4000-8000-000000000002'
\set b_off '67240000-0000-4000-8000-000000000003'
\set b_in2 '67240000-0000-4000-8000-000000000004'
\set b_go  '67240000-0000-4000-8000-000000000005'
\set b_hand  '67240000-0000-4000-8000-000000000006'
\set b_flood '67240000-0000-4000-8000-000000000007'

insert into auth.users (id, email) values
  (:'uk1', 'k1@cv672.test'), (:'uk2', 'k2@cv672.test'), (:'uk3', 'k3@cv672.test'), (:'uq1', 'q1@cv672.test'),
  (:'ue1', 'e1@cv672.test'), (:'ulv', 'lv@cv672.test'), (:'urm', 'rm@cv672.test');
insert into profiles (id, role, full_name) values
  (:'uk1', 'staff', 'Kit One'), (:'uk2', 'staff', 'Kit Two'), (:'uk3', 'staff', 'Kit Three'),
  (:'uq1', 'staff', 'Quill One'), (:'ue1', 'staff', 'Esme Elsewhere'), (:'ulv', 'staff', 'Lee Left'),
  (:'urm', 'staff', 'Rex Removed');
insert into staff (id, user_id, employee_id, first_name, last_name, email, phone, dob, status, rtw_branch,
                   home_location) values
  (:'k1', :'uk1', 67201, 'Kit',   'One',   'k1@cv672.test', '+447700967201', date '1995-01-01', 'compliant', 'uk_irish',
   st_setsrid(st_makepoint(-0.1010, 51.5000), 4326)::geography),
  (:'k2', :'uk2', 67202, 'Kit',   'Two',   'k2@cv672.test', '+447700967202', date '1995-01-02', 'compliant', 'uk_irish',
   st_setsrid(st_makepoint(-0.1010, 51.5000), 4326)::geography),
  (:'k3', :'uk3', 67203, 'Kit',   'Three', 'k3@cv672.test', '+447700967203', date '1995-01-03', 'compliant', 'uk_irish',
   st_setsrid(st_makepoint(-0.1010, 51.5000), 4326)::geography),
  (:'q1', :'uq1', 67204, 'Quill', 'One',   'q1@cv672.test', '+447700967204', date '1995-01-04', 'compliant', 'uk_irish',
   st_setsrid(st_makepoint(-0.1010, 51.5000), 4326)::geography),
  -- Esme is qualified at client B, not here: wave 2 on every section below.
  (:'e1', :'ue1', 67205, 'Esme',  'Elsewhere', 'e1@cv672.test', '+447700967205', date '1995-01-05', 'compliant', 'uk_irish',
   st_setsrid(st_makepoint(-0.1010, 51.5000), 4326)::geography),
  (:'lv', :'ulv', 67206, 'Lee',   'Left',    'lv@cv672.test', '+447700967206', date '1995-01-06', 'inactive',  'uk_irish',
   st_setsrid(st_makepoint(-0.1010, 51.5000), 4326)::geography),
  (:'rm', :'urm', 67207, 'Rex',   'Removed', 'rm@cv672.test', '+447700967207', date '1995-01-07', 'removed',   'uk_irish',
   st_setsrid(st_makepoint(-0.1010, 51.5000), 4326)::geography);
update staff set left_at = now() where id = :'lv';
insert into staff_roles (staff_id, role_id)
select id, :'role_id' from staff where email like '%@cv672.test';
insert into client_qualifications (client_id, role_id, staff_id) values
  (:'clienta', :'role_id', :'q1'), (:'clientb', :'role_id', :'e1');

insert into events (id, client_id, venue_id, venue_name, venue_address, venue_location, geofence_radius_m,
                    title, event_date, pays_breaks, pays_buffer, auto_assign) values
  (:'ev',  :'clienta', :'venue_id', 'RLS Fixture Venue', '1 Test Street, London',
   st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150, 'Product Launch — Bar', current_date + 2, true, true, true),
  (:'ev2', :'clienta', :'venue_id', 'RLS Fixture Venue', '1 Test Street, London',
   st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150, 'Board Dinner', current_date + 20, true, true, true);

insert into shift_requirements (id, event_id, role_id, starts_at, ends_at, headcount, buffer,
                                charge_rate, pay_rate, allocation_per_hour, auto_assign) values
  -- Two days out: inside RULE-04's 72 hours.
  (:'s_in',  :'ev',  :'role_id', now() + interval '48 hours', now() + interval '55 hours', 3, 1, 20, 14, 4, true),
  -- Twenty days out, auto-assign on: the worker offers it themself.
  (:'s_out', :'ev2', :'role_id', now() + interval '20 days',  now() + interval '20 days 5 hours', 2, 0, 20, 14, 2, true),
  -- Twenty-two days out, the role's auto-assign off: only the office.
  (:'s_off', :'ev2', :'role_id', now() + interval '22 days',  now() + interval '22 days 5 hours', 2, 0, 20, 14, 2, false),
  -- Twenty-four days out: the request the office declines.
  (:'s_go',  :'ev2', :'role_id', now() + interval '24 days',  now() + interval '24 days 5 hours', 2, 0, 20, 14, 2, false),
  -- Twenty-six days out, the role's auto-assign off: opened to the pool (E).
  (:'s_hand',  :'ev2', :'role_id', now() + interval '26 days', now() + interval '26 days 5 hours', 2, 0, 20, 14, 2, false),
  -- Twenty-eight days out, auto-assign off: asked, withdrawn, asked again (F).
  (:'s_flood', :'ev2', :'role_id', now() + interval '28 days', now() + interval '28 days 5 hours', 2, 0, 20, 14, 2, false);

insert into bookings (id, shift_id, staff_id, status, source, confirmed_at) values
  (:'b_in',  :'s_in',  :'k1', 'confirmed', 'auto', now()),
  (:'b_in2', :'s_in',  :'k3', 'confirmed', 'auto', now()),
  (:'b_out', :'s_out', :'k1', 'confirmed', 'auto', now()),
  (:'b_off', :'s_off', :'k1', 'confirmed', 'auto', now()),
  (:'b_go',  :'s_go',  :'k2', 'confirmed', 'auto', now()),
  (:'b_hand',  :'s_hand',  :'k3', 'confirmed', 'auto', now()),
  (:'b_flood', :'s_flood', :'k2', 'confirmed', 'auto', now());

-- =====================================================================
-- A · request_cover()
-- =====================================================================
select set_config('request.jwt.claims', json_build_object('sub', :'uk1', 'role', 'authenticated')::text, true);
set local role authenticated;
select is(offer_shift(:'b_in') ->> 'reason', 'too_late', 'A: two days out, Kit cannot offer it to the pool');
select is(request_cover(:'b_out'), jsonb_build_object('ok', false, 'reason', 'use_offer'),
  'A: twenty days out with auto-assign on, he offers it himself instead');
select is(request_cover(:'b_in', repeat('x', 301)), jsonb_build_object('ok', false, 'reason', 'note_too_long'),
  'A: a note is at most 300 characters');
select is(request_cover(:'b_in', '  Exam moved to Friday evening — sorry.  ') ->> 'ok', 'true',
  'A: inside 72 hours he asks the office for cover');
select is(request_cover(:'b_in'), jsonb_build_object('ok', false, 'reason', 'already_offered'),
  'A: once');
select is(request_cover(:'b_off') ->> 'ok', 'true',
  'A: with the role''s auto-assign off he may ask the office however far out it is');
reset role;

select set_config('request.jwt.claims', json_build_object('sub', :'uk2', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(format($$ select request_cover(%L) $$, :'b_in'), '42501', 'not_your_booking',
  'A: nobody asks for cover on somebody else''s shift');
select is(request_cover(:'b_go') ->> 'ok', 'true', 'A: Kit Two asks for cover on hers, with no note');
reset role;

select set_config('request.jwt.claims', json_build_object('sub', :'ulv', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(format($$ select request_cover(%L) $$, :'b_in'), 'P0001', 'not_editable',
  'A: a leaver cannot ask the office for cover (20260930202000''s error shape)');
reset role;
select set_config('request.jwt.claims', json_build_object('sub', :'urm', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(format($$ select request_cover(%L) $$, :'b_in'), 'P0001', 'account_closed',
  'A: nor a removed account');
reset role;
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(format($$ select request_cover(%L) $$, :'b_in'), 'P0001', 'unknown_staff',
  'A: nor the office on a worker''s behalf');
reset role;
select set_config('request.jwt.claims', '', true);

select id as cover from shift_offers where booking_id = :'b_in' \gset
select id as cover_off from shift_offers where booking_id = :'b_off' \gset
select id as cover_go from shift_offers where booking_id = :'b_go' \gset

select is(
  (select array[mode, status, note] from shift_offers where id = :'cover'),
  array['office', 'open', 'Exam moved to Friday evening — sorry.'],
  'A: an office offer, open, the note trimmed');
select is((select expires_at from shift_offers where id = :'cover'),
  (select starts_at from shift_requirements where id = :'s_in'),
  'A: it runs to the section start; after that the escalation job owns the section');
select is((select status::text from bookings where id = :'b_in'), 'confirmed',
  'A: Kit is still booked until the office acts');
select is((select confirmed from shift_fill(:'s_in')), 2, 'A: and the fill is unchanged');

select is(
  (select array[channel::text, template, array_to_string(recipient_emails, ',')]
     from notification_outbox where key = 'OF5:booking:' || :'b_in'),
  array['email', 'OF5', 'admin@thehospitalitycompany.co.uk'],
  'A: OF5 goes to admin@ at once — and to nobody else');
select is(
  (select array[payload ->> 'name', payload ->> 'employeeId', payload ->> 'note',
                payload ->> 'confirmed', payload ->> 'headcount', payload ->> 'buffer', payload ->> 'autoAssign']
     from notification_outbox where key = 'OF5:booking:' || :'b_in'),
  array['Kit One', '67201', 'Exam moved to Friday evening — sorry.', '2', '3', '1', 'on'],
  'A: naming the worker and the fill — 2 of 3 (+1), buffer apart — with auto-assign on');
select is((select payload ->> 'note' from notification_outbox where key = 'OF5:booking:' || :'b_go'), '—',
  'A: a blank note is written as —, never a bare placeholder');
select is((select payload ->> 'autoAssign' from notification_outbox where key = 'OF5:booking:' || :'b_off'),
  'off — this slot will only be filled by hand',
  'A: with the role''s switch off, the email says so');

-- Not visible, not pushed, not takeable.
select set_config('request.jwt.claims', json_build_object('sub', :'uq1', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select count(*)::int from staff_open_offers() where offer_id = :'cover'), 0,
  'A: Radar does not show a cover request, even to a qualified worker');
select is(take_offered_shift(:'cover'), jsonb_build_object('ok', false, 'reason', 'offer_not_open'),
  'A: and it cannot be taken');
reset role;
select set_config('request.jwt.claims', '', true);
select is(notify_offer_candidates(:'cover', array[:'q1'::uuid]), 0, 'A: nor pushed');

-- =====================================================================
-- B · office_open_offer_to_pool()
-- =====================================================================
select set_config('request.jwt.claims', json_build_object('sub', :'uk1', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(format($$ select office_open_offer_to_pool(%L) $$, :'cover'), '42501', 'not_authorised',
  'B: a worker cannot open their own request to the pool');
reset role;

select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is(office_open_offer_to_pool(:'cover') ->> 'ok', 'true', 'B: the office opens it to the pool');
select is(office_open_offer_to_pool(:'cover'), jsonb_build_object('ok', false, 'reason', 'not_a_cover_request'),
  'B: once — it is a pool offer now');
select is(office_decline_cover(:'cover'), jsonb_build_object('ok', false, 'reason', 'not_a_cover_request'),
  'B: and a pool offer is not the office''s to decline');
reset role;
select set_config('request.jwt.claims', '', true);

select is(
  (select array[mode, status, decided_by::text] from shift_offers where id = :'cover'),
  array['pool', 'open', :'admin_uid'], 'B: mode pool, still open, the deciding manager recorded');
select is((select count(*)::int from audit_log
            where action = 'shift_offer.opened_to_pool' and entity_id = :'cover'::uuid and actor = :'admin_uid'::uuid), 1,
  'B: audited');

select set_config('request.jwt.claims', json_build_object('sub', :'uq1', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select count(*)::int from staff_open_offers() where offer_id = :'cover'), 1,
  'B: Radar shows it now, to a worker qualified at the client and role (RULE-17)');
select ok(not exists (select 1 from staff_open_offers() o
                       where to_jsonb(o) ?| array['offered_by_staff_id', 'booking_id', 'note']),
  'B: never the offerer, their booking or their note');
reset role;

-- s_in's auto-assign is on: RULE-17 as before. Wave 1 (Quill, the
-- fixture's Staff Alpha) has not been told, so Esme — qualified only at
-- another client — waits.
select ok(not offer_wave1_exhausted(:'cover'),
  'B: auto-assign on: wave 1 is not exhausted until every wave-1 worker has been told');
select set_config('request.jwt.claims', json_build_object('sub', :'ue1', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select count(*)::int from staff_open_offers() where offer_id = :'cover'), 0,
  'B: so Radar does not show it to Esme yet (wave 2)');
select is(take_offered_shift(:'cover'), jsonb_build_object('ok', false, 'reason', 'not_yet'),
  'B: and she cannot take it yet');
reset role;

select set_config('request.jwt.claims', json_build_object('sub', :'uq1', 'role', 'authenticated')::text, true);
set local role authenticated;
select is(take_offered_shift(:'cover') ->> 'ok', 'true', 'B: Quill takes it');
reset role;
select set_config('request.jwt.claims', '', true);
select is((select array[status::text, cancel_cause] from bookings where id = :'b_in'),
  array['cancelled', 'handed_over'], 'B: and Kit is released — covered');
select is((select count(*)::int from notification_outbox
            where template = 'E10' and key = 'E10:booking:' || :'b_in'), 0,
  'B: a hand-over sends the office no self-cancel email — no slot was lost (Q18)');

-- =====================================================================
-- C · office_decline_cover()
-- =====================================================================
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is(office_decline_cover(:'cover_go', 'We have enough cover.'), jsonb_build_object('ok', true),
  'C: the office declines Kit Two''s request');
select is(office_decline_cover(:'cover_go') ->> 'reason', 'offer_not_open', 'C: once');
reset role;
select set_config('request.jwt.claims', '', true);
select is(
  (select array[status, closed_reason] from shift_offers where id = :'cover_go'),
  array['cancelled', 'We have enough cover.'], 'C: cancelled, the note kept as the office''s record');
select is(
  (select data from audit_log where action = 'shift_offer.cover_declined' and entity_id = :'cover_go'::uuid),
  jsonb_build_object('bookingId', :'b_go', 'has_note', true),
  'C: the audit row records that a note was written, never its text (20260930205000)');
select is(
  (select array[recipient_staff_id::text, payload ->> 'bookingId'] from notification_outbox where key = 'OF6:offer:' || :'cover_go'),
  array[:'k2', :'b_go'], 'C: OF6 to her, pointing at her shift — she is still booked');

-- =====================================================================
-- D · the office covers by hand: Withdraw lapses the request
-- =====================================================================
update bookings set status = 'cancelled', cancelled_at = now(), cancel_cause = 'office_withdraw' where id = :'b_off';
select is((select array[status, closed_reason] from shift_offers where id = :'cover_off'),
  array['lapsed', 'office_withdraw'], 'D: withdrawing the booking lapses the cover request with it');

-- =====================================================================
-- E · auto-assign off: opened to the pool, open to everyone at once
-- =====================================================================
select set_config('request.jwt.claims', json_build_object('sub', :'uk3', 'role', 'authenticated')::text, true);
set local role authenticated;
select request_cover(:'b_hand', 'Wedding that weekend') ->> 'offerId' as cover_hand \gset
reset role;
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is(office_open_offer_to_pool(:'cover_hand') ->> 'ok', 'true',
  'E: the office opens a hand-picked section''s cover request to the pool');
reset role;
select set_config('request.jwt.claims', '', true);

select is(notify_offer_candidates(:'cover_hand', array[:'q1'::uuid]), 0,
  'E: auto-assign is off, so nobody is ever pushed it (OF1 follows the switches)');
select ok(offer_wave1_exhausted(:'cover_hand'),
  'E: so wave 1 counts as exhausted at once — waiting for pushes that never come would wait for ever');

select set_config('request.jwt.claims', json_build_object('sub', :'ue1', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select count(*)::int from staff_open_offers() where offer_id = :'cover_hand'), 1,
  'E: Radar shows it to Esme, qualified only at another client');
select is(take_offered_shift(:'cover_hand') ->> 'ok', 'true', 'E: and she takes it');
reset role;
select set_config('request.jwt.claims', '', true);
select is(
  (select array[status::text, source::text] from bookings where shift_id = :'s_hand' and staff_id = :'e1'),
  array['confirmed', 'offer'], 'E: Esme is confirmed, source offer');
select is((select array[status::text, cancel_cause] from bookings where id = :'b_hand'),
  array['cancelled', 'handed_over'], 'E: Kit Three is released — covered');

-- =====================================================================
-- F · ask, withdraw, ask again — one email per booking
-- =====================================================================
select set_config('request.jwt.claims', json_build_object('sub', :'uk2', 'role', 'authenticated')::text, true);
set local role authenticated;
select request_cover(:'b_flood') ->> 'offerId' as f1 \gset
select is(withdraw_shift_offer(:'f1'), jsonb_build_object('ok', true), 'F: Kit Two asks, then withdraws');
select is(request_cover(:'b_flood'), jsonb_build_object('ok', false, 'reason', 'recently_requested'),
  'F: asking again within 24 hours of withdrawing is refused');
reset role;
select set_config('request.jwt.claims', '', true);

-- A day later (the withdrawal moved back past the 24 hours) — twice more.
update shift_offers set closed_at = now() - interval '25 hours' where id = :'f1';
select set_config('request.jwt.claims', json_build_object('sub', :'uk2', 'role', 'authenticated')::text, true);
set local role authenticated;
select request_cover(:'b_flood') ->> 'offerId' as f2 \gset
select is(withdraw_shift_offer(:'f2') ->> 'ok', 'true', 'F: after a day she may ask again, and withdraws again');
reset role;
select set_config('request.jwt.claims', '', true);
update shift_offers set closed_at = now() - interval '25 hours' where id = :'f2';
select set_config('request.jwt.claims', json_build_object('sub', :'uk2', 'role', 'authenticated')::text, true);
set local role authenticated;
select request_cover(:'b_flood') ->> 'offerId' as f3 \gset
select is(withdraw_shift_offer(:'f3') ->> 'ok', 'true', 'F: and a third time');
reset role;
select set_config('request.jwt.claims', '', true);

select is((select count(*)::int from shift_offers where booking_id = :'b_flood' and mode = 'office'), 3,
  'F: three cover requests on the one booking');
select is((select count(*)::int from notification_outbox
            where template = 'OF5' and payload ->> 'bookingId' = :'b_flood'), 1,
  'F: but admin@ was emailed once — OF5 is keyed on the booking');
select is((select payload ->> 'offerId' from notification_outbox where key = 'OF5:booking:' || :'b_flood'), :'f1',
  'F: the first request''s email, under OF5:booking:<id>');

select * from finish();
rollback;
