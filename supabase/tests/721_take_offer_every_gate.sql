-- =====================================================================
-- 721 · take_offered_shift() — every gate in one file (ADR-0045)
--   20260930201100_shift_offers.sql
--
-- The take is the one new way into `confirmed`, so every rule a booking
-- has to pass is asserted here together (docs/10 §3b), in takeOffer()'s
-- order (shiftOffer.vectors.json):
--
--   event_cancelled › offer_not_open (taken race, office, withdrawn) ›
--   offer_expired › original_not_confirmed › own_offer › section_started ›
--   not_bookable › wrong_role › do_not_return › blocked › self_cancelled ›
--   overlap (the 2 h different-venue gap) › rtw_expired › hours_limit ›
--   already_had_booking › not_yet (RULE-17) › ok
--
-- and what a take does: taker confirmed (source offer, from an open
-- invitation here), original cancelled / handed_over / self_cancelled,
-- offer taken, confirmed count unchanged, the taker's overlapping
-- invitations withdrawn, OF2 + OF4, no N10c, and the offerer barred from
-- the event afterwards. The calendar (ADR-0042) never refuses a take.
-- =====================================================================
begin;
select plan(46);
\ir _shared/fixtures.psql

select cap_week_start(current_date) + 14 as w \gset

\set venue2  '67100000-0000-4000-8000-0000000000b2'
\set ev      '67100000-0000-4000-8000-000000000001'
\set ev_far  '67100000-0000-4000-8000-000000000002'
\set ev_x    '67100000-0000-4000-8000-000000000003'
\set s       '67110000-0000-4000-8000-000000000001'
\set s_sib   '67110000-0000-4000-8000-000000000002'
\set s_far   '67110000-0000-4000-8000-000000000003'
\set s_cap   '67110000-0000-4000-8000-000000000004'
\set s_ov    '67110000-0000-4000-8000-000000000005'
\set s_live  '67110000-0000-4000-8000-000000000006'
\set s_x     '67110000-0000-4000-8000-000000000007'

\set off     '67120000-0000-4000-8000-000000000001'
\set off2    '67120000-0000-4000-8000-000000000002'
\set t_ok    '67120000-0000-4000-8000-000000000003'
\set t_unq   '67120000-0000-4000-8000-000000000004'
\set t_wrong '67120000-0000-4000-8000-000000000005'
\set t_dnr   '67120000-0000-4000-8000-000000000006'
\set t_blk   '67120000-0000-4000-8000-000000000007'
\set t_self  '67120000-0000-4000-8000-000000000008'
\set t_over  '67120000-0000-4000-8000-000000000009'
\set t_rtw   '67120000-0000-4000-8000-000000000010'
\set t_cap   '67120000-0000-4000-8000-000000000011'
\set t_left  '67120000-0000-4000-8000-000000000012'
\set t_had   '67120000-0000-4000-8000-000000000013'
\set t_q2    '67120000-0000-4000-8000-000000000014'
\set t_late  '67120000-0000-4000-8000-000000000015'
\set t_gone  '67120000-0000-4000-8000-000000000016'

\set b_off   '67140000-0000-4000-8000-000000000001'
\set b_off2  '67140000-0000-4000-8000-000000000002'
\set b_inv   '67140000-0000-4000-8000-000000000003'
\set b_ovinv '67140000-0000-4000-8000-000000000004'
\set b_live  '67140000-0000-4000-8000-000000000005'
\set b_x     '67140000-0000-4000-8000-000000000006'
\set b_exp   '67140000-0000-4000-8000-000000000007'
\set o_live  '67150000-0000-4000-8000-000000000005'
\set o_x     '67150000-0000-4000-8000-000000000006'
\set o_exp   '67150000-0000-4000-8000-000000000007'

-- ---------------------------------------------------------------------
-- Fixture: every worker has a login (uid = the staff id with 6713 for 6712).
-- ---------------------------------------------------------------------
insert into auth.users (id, email)
select ('67130000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid, 'u' || n || '@to671.test'
  from generate_series(1, 16) n;
insert into profiles (id, role, full_name)
select ('67130000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid, 'staff', 'Taker ' || n
  from generate_series(1, 16) n;

insert into venues (id, name, address, location, venue_type, geofence_radius_m) values
  (:'venue2', 'Across Town', '9 Far Road, London',
   st_setsrid(st_makepoint(-0.2000, 51.5200), 4326)::geography, 'hotel', 150);

insert into staff (id, user_id, first_name, last_name, email, phone, dob, status, rtw_branch,
                   home_location, left_at, right_to_work_until) values
  (:'off',     '67130000-0000-4000-8000-000000000001', 'Ora',  'Offer',   'off@to671.test',  '+447700967101', date '1995-01-01', 'compliant', 'uk_irish',
   st_setsrid(st_makepoint(-0.1010, 51.5000), 4326)::geography, null, null),
  (:'off2',    '67130000-0000-4000-8000-000000000002', 'Otto', 'Offer',   'off2@to671.test', '+447700967102', date '1995-01-02', 'compliant', 'uk_irish',
   st_setsrid(st_makepoint(-0.1010, 51.5000), 4326)::geography, null, null),
  (:'t_ok',    '67130000-0000-4000-8000-000000000003', 'Tia',  'Taker',   'ok@to671.test',   '+447700967103', date '1995-01-03', 'compliant', 'uk_irish',
   st_setsrid(st_makepoint(-0.1010, 51.5000), 4326)::geography, null, null),
  (:'t_unq',   '67130000-0000-4000-8000-000000000004', 'Uri',  'Wave2',   'unq@to671.test',  '+447700967104', date '1995-01-04', 'compliant', 'uk_irish',
   st_setsrid(st_makepoint(-0.1010, 51.5000), 4326)::geography, null, null),
  (:'t_wrong', '67130000-0000-4000-8000-000000000005', 'Wes',  'Norole',  'wr@to671.test',   '+447700967105', date '1995-01-05', 'compliant', 'uk_irish',
   st_setsrid(st_makepoint(-0.1010, 51.5000), 4326)::geography, null, null),
  (:'t_dnr',   '67130000-0000-4000-8000-000000000006', 'Dot',  'Dnr',     'dn@to671.test',   '+447700967106', date '1995-01-06', 'compliant', 'uk_irish',
   st_setsrid(st_makepoint(-0.1010, 51.5000), 4326)::geography, null, null),
  (:'t_blk',   '67130000-0000-4000-8000-000000000007', 'Bo',   'Blocked', 'bl@to671.test',   '+447700967107', date '1995-01-07', 'blocked',   'uk_irish',
   st_setsrid(st_makepoint(-0.1010, 51.5000), 4326)::geography, null, null),
  (:'t_self',  '67130000-0000-4000-8000-000000000008', 'Sol',  'Selfcx',  'sc@to671.test',   '+447700967108', date '1995-01-08', 'compliant', 'uk_irish',
   st_setsrid(st_makepoint(-0.1010, 51.5000), 4326)::geography, null, null),
  (:'t_over',  '67130000-0000-4000-8000-000000000009', 'Ove',  'Across',  'ov@to671.test',   '+447700967109', date '1995-01-09', 'compliant', 'uk_irish',
   st_setsrid(st_makepoint(-0.1010, 51.5000), 4326)::geography, null, null),
  (:'t_rtw',   '67130000-0000-4000-8000-000000000010', 'Rae',  'Visa',    'rw@to671.test',   '+447700967110', date '2001-01-10', 'compliant', 'international_student',
   st_setsrid(st_makepoint(-0.1010, 51.5000), 4326)::geography, null, :'w'::date + 2),
  (:'t_cap',   '67130000-0000-4000-8000-000000000011', 'Cam',  'Capped',  'cp@to671.test',   '+447700967111', date '2001-01-11', 'compliant', 'international_student',
   st_setsrid(st_makepoint(-0.1010, 51.5000), 4326)::geography, null, null),
  (:'t_left',  '67130000-0000-4000-8000-000000000012', 'Lou',  'Left',    'lf@to671.test',   '+447700967112', date '1995-01-12', 'inactive',  'uk_irish',
   st_setsrid(st_makepoint(-0.1010, 51.5000), 4326)::geography, now(), null),
  (:'t_had',   '67130000-0000-4000-8000-000000000013', 'Hal',  'Had',     'hd@to671.test',   '+447700967113', date '1995-01-13', 'compliant', 'uk_irish',
   st_setsrid(st_makepoint(-0.1010, 51.5000), 4326)::geography, null, null),
  (:'t_q2',    '67130000-0000-4000-8000-000000000014', 'Quin', 'Second',  'q2@to671.test',   '+447700967114', date '1995-01-14', 'compliant', 'uk_irish',
   st_setsrid(st_makepoint(-0.1010, 51.5000), 4326)::geography, null, null),
  (:'t_late',  '67130000-0000-4000-8000-000000000015', 'Lia',  'Late',    'lt@to671.test',   '+447700967115', date '1995-01-15', 'compliant', 'uk_irish',
   st_setsrid(st_makepoint(-0.1010, 51.5000), 4326)::geography, null, null),
  -- Leaving recorded, status not yet moved on: out of the pool, not refused as a caller.
  (:'t_gone',  '67130000-0000-4000-8000-000000000016', 'Gil',  'Gone',    'gn@to671.test',   '+447700967116', date '1995-01-16', 'compliant', 'uk_irish',
   st_setsrid(st_makepoint(-0.1010, 51.5000), 4326)::geography, now(), null);
update staff set term_dates = '{}' where id = :'t_cap';

insert into staff_roles (staff_id, role_id)
select id, :'role_id' from staff where email like '%@to671.test' and id <> :'t_wrong';
-- Wave 1 at this client and role: Tia and Quin (and the two offerers).
insert into client_qualifications (client_id, role_id, staff_id) values
  (:'clienta', :'role_id', :'t_ok'), (:'clienta', :'role_id', :'t_q2'),
  (:'clienta', :'role_id', :'off'),  (:'clienta', :'role_id', :'off2');
insert into client_qualifications (client_id, role_id, staff_id, do_not_return)
values (:'clienta', :'role_id', :'t_dnr', true);

insert into events (id, client_id, venue_id, venue_name, venue_address, venue_location, geofence_radius_m,
                    title, event_date, pays_breaks, pays_buffer, auto_assign) values
  (:'ev', :'clienta', :'venue_id', 'RLS Fixture Venue', '1 Test Street, London',
   st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150, 'Awards Night', :'w'::date + 3, true, true, true),
  (:'ev_far', :'clientb', :'venue2', 'Across Town', '9 Far Road, London',
   st_setsrid(st_makepoint(-0.2000, 51.5200), 4326)::geography, 150, 'Breakfast Across Town', :'w'::date + 3, true, true, true),
  (:'ev_x', :'clienta', :'venue_id', 'RLS Fixture Venue', '1 Test Street, London',
   st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150, 'Called Off', :'w'::date + 6, true, true, true);

insert into shift_requirements (id, event_id, role_id, starts_at, ends_at, headcount, buffer,
                                charge_rate, pay_rate, allocation_per_hour) values
  -- Thursday 09:00–17:00 UK, 2 (+1): the offered section.
  (:'s',     :'ev',     :'role_id', (:'w'::date + 3 + time '09:00') at time zone 'Europe/London',
                                    (:'w'::date + 3 + time '17:00') at time zone 'Europe/London', 2, 1, 20, 14, 3),
  -- A sibling section on the same event, where Sol self-cancelled.
  (:'s_sib', :'ev',     :'role_id', (:'w'::date + 4 + time '09:00') at time zone 'Europe/London',
                                    (:'w'::date + 4 + time '17:00') at time zone 'Europe/London', 2, 0, 20, 14, 2),
  -- Across town, ending 90 minutes before ours: inside the 2 h gap.
  (:'s_far', :'ev_far', :'role_id', (:'w'::date + 3 + time '03:00') at time zone 'Europe/London',
                                    (:'w'::date + 3 + time '07:30') at time zone 'Europe/London', 2, 0, 20, 14, 2),
  -- Tuesday, 16 h: Cam's week already at 16 of 20.
  (:'s_cap', :'ev_far', :'role_id', (:'w'::date + 1 + time '04:00') at time zone 'Europe/London',
                                    (:'w'::date + 1 + time '20:00') at time zone 'Europe/London', 2, 0, 20, 14, 2),
  -- Thursday 12:00–20:00 across town: Tia's other open invitation, overlapping ours.
  (:'s_ov',  :'ev_far', :'role_id', (:'w'::date + 3 + time '12:00') at time zone 'Europe/London',
                                    (:'w'::date + 3 + time '20:00') at time zone 'Europe/London', 2, 0, 20, 14, 2),
  -- Already under way.
  (:'s_live', :'ev',    :'role_id', now() - interval '1 hour', now() + interval '5 hours', 2, 0, 20, 14, 2),
  (:'s_x',    :'ev_x',  :'role_id', (:'w'::date + 6 + time '09:00') at time zone 'Europe/London',
                                    (:'w'::date + 6 + time '17:00') at time zone 'Europe/London', 2, 0, 20, 14, 2);

insert into bookings (id, shift_id, staff_id, status, source, confirmed_at) values
  (:'b_off',  :'s',      :'off',  'confirmed', 'auto', now()),
  (:'b_off2', :'s',      :'off2', 'confirmed', 'auto', now()),
  (:'b_live', :'s_live', :'off',  'confirmed', 'auto', now() - interval '3 days'),
  (:'b_x',    :'s_x',    :'off',  'confirmed', 'auto', now()),
  (:'b_exp',  :'s_sib',  :'off2', 'confirmed', 'auto', now());
insert into bookings (shift_id, staff_id, status, source, confirmed_at) values
  (:'s_far', :'t_over', 'confirmed', 'auto', now()),
  (:'s_cap', :'t_cap',  'confirmed', 'auto', now());
insert into bookings (shift_id, staff_id, status, source, cancelled_at, cancel_cause, self_cancelled) values
  (:'s_sib', :'t_self', 'cancelled', 'auto', now(), 'self_cancel', true),
  (:'s',     :'t_had',  'cancelled', 'auto', now(), 'office_withdraw', false);
-- Tia already holds an invitation to the offered section, and another
-- across town that overlaps it.
insert into bookings (id, shift_id, staff_id, status, source) values
  (:'b_inv',   :'s',    :'t_ok', 'invited', 'auto'),
  (:'b_ovinv', :'s_ov', :'t_ok', 'invited', 'auto');
update events set cancelled_at = now(), cancel_reason = 'fixture' where id = :'ev_x';

-- Tia marked Thursday unavailable after she was invited (ADR-0042).
insert into staff_unavailability (staff_id, period, all_day)
values (:'t_ok', unavailability_range(:'w'::date + 3), true);

-- The offers. Ora's through the RPC; the edge cases written as the rows
-- they would be, because no RPC can make them.
select set_config('request.jwt.claims', json_build_object('sub', '67130000-0000-4000-8000-000000000001', 'role', 'authenticated')::text, true);
set local role authenticated;
select offer_shift(:'b_off') ->> 'offerId' as offer \gset
reset role;
select set_config('request.jwt.claims', '', true);
insert into shift_offers (id, booking_id, mode, expires_at) values
  (:'o_live', :'b_live', 'pool', now() + interval '2 hours'),          -- opened by the office, section started
  (:'o_x',    :'b_x',    'pool', now() + interval '3 days'),           -- on a cancelled event
  (:'o_exp',  :'b_exp',  'pool', now() - interval '1 minute');         -- past its expiry, not yet lapsed

create function pg_temp.take_as(p_n int, p_offer uuid) returns jsonb language plpgsql as $$
declare r jsonb;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', '67130000-0000-4000-8000-0000000000' || lpad(p_n::text, 2, '0'),
                      'role', 'authenticated')::text, true);
  set local role authenticated;
  r := take_offered_shift(p_offer);
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return r;
end $$;

-- =====================================================================
-- A · the refusals, in order
-- =====================================================================
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(format($$ select take_offered_shift(%L) $$, :'offer'), 'P0001', 'unknown_staff',
  'A: the office cannot take a shift for anybody');
reset role;
select set_config('request.jwt.claims', '', true);

select is(pg_temp.take_as(3, :'o_x'),      jsonb_build_object('ok', false, 'reason', 'event_cancelled'), 'A: event_cancelled');
select is(pg_temp.take_as(3, :'o_exp'),    jsonb_build_object('ok', false, 'reason', 'offer_expired'),   'A: offer_expired — at or past expires_at, before the lapse job has run');
select is(pg_temp.take_as(3, :'o_live'),   jsonb_build_object('ok', false, 'reason', 'section_started'), 'A: section_started — the escalation job owns it now');
select is(pg_temp.take_as(3, gen_random_uuid()), jsonb_build_object('ok', false, 'reason', 'offer_not_open'),
  'A: an unknown offer reads as not open — the id tells nobody anything');
select is(pg_temp.take_as(1, :'offer'),    jsonb_build_object('ok', false, 'reason', 'own_offer'),       'A: own_offer');
select throws_ok(format($$ select pg_temp.take_as(12, %L) $$, :'offer'), 'P0001', 'not_editable',
  'A: a leaver (inactive) is refused as a caller before anything is read (20260930205000)');
select is(pg_temp.take_as(16, :'offer'),   jsonb_build_object('ok', false, 'reason', 'not_bookable'),    'A: not_bookable — a worker whose leaving is recorded has no candidate row (§10.6)');
select is(pg_temp.take_as(5, :'offer'),    jsonb_build_object('ok', false, 'reason', 'wrong_role'),      'A: wrong_role');
select is(pg_temp.take_as(6, :'offer'),    jsonb_build_object('ok', false, 'reason', 'do_not_return'),   'A: do_not_return');
select is(pg_temp.take_as(7, :'offer'),    jsonb_build_object('ok', false, 'reason', 'blocked'),         'A: blocked (RULE-12)');
select is(pg_temp.take_as(8, :'offer'),    jsonb_build_object('ok', false, 'reason', 'self_cancelled'),  'A: self_cancelled off this event (RULE-04)');
select is(pg_temp.take_as(9, :'offer'),    jsonb_build_object('ok', false, 'reason', 'overlap'),
  'A: overlap — confirmed across town until 90 minutes before: inside the 2 h different-venue gap');
-- main's D2 (20260930110000, worked is staffed): a booking the worker has
-- already checked in to overlaps as much as a confirmed one — in the pool
-- gate and in the take's own accept_invite() re-read (20260930205000).
update bookings set status = 'worked' where shift_id = :'s_far' and staff_id = :'t_over';
select is(pg_temp.take_as(9, :'offer'),    jsonb_build_object('ok', false, 'reason', 'overlap'),
  'A: overlap — and still when that booking across town is already checked in (worked)');
select is(pg_temp.take_as(10, :'offer'),   jsonb_build_object('ok', false, 'reason', 'rtw_expired'),     'A: rtw_expired');
select is(pg_temp.take_as(11, :'offer'),   jsonb_build_object('ok', false, 'reason', 'hours_limit'),     'A: hours_limit — 16 h + 8 h over the 20 h term cap (RULE-20)');
select is(pg_temp.take_as(13, :'offer'),   jsonb_build_object('ok', false, 'reason', 'already_had_booking'),
  'A: already_had_booking — withdrawn from this section by the office, so not by a take either');

select ok(not offer_wave1_exhausted(:'offer'), 'A: nobody in wave 1 has been told yet');
select is(pg_temp.take_as(4, :'offer'),    jsonb_build_object('ok', false, 'reason', 'not_yet'),
  'A: not_yet — Uri is not qualified here, and wave 1 has not been exhausted (RULE-17)');

select is((select status::text from bookings where id = :'b_off'), 'confirmed', 'A: after every refusal Ora is still booked');
select is((select status from shift_offers where id = :'offer'), 'open', 'A: and her offer is still open');
select is((select count(*)::int from bookings b join staff st on st.id = b.staff_id
            where b.shift_id = :'s' and st.email like '%@to671.test'
              and b.staff_id not in (:'off', :'off2', :'t_ok', :'t_had')), 0,
  'A: no refusal wrote a booking');

-- original_not_confirmed can only happen if the lapse trigger is not there,
-- so the check behind it is proved with the trigger off for one statement.
alter table bookings disable trigger bookings_offer_lapse;
update bookings set status = 'cancelled', cancelled_at = now(), cancel_cause = 'office_withdraw' where id = :'b_exp';
update shift_offers set expires_at = now() + interval '1 day' where id = :'o_exp';
select is(pg_temp.take_as(3, :'o_exp'), jsonb_build_object('ok', false, 'reason', 'original_not_confirmed'),
  'A: original_not_confirmed — the take re-reads the offerer''s booking under the lock');
alter table bookings enable trigger bookings_offer_lapse;

-- =====================================================================
-- B · the take
-- =====================================================================
select is((select confirmed from shift_fill(:'s')), 2, 'B: before: 2 confirmed of 2 (+1)');
select pg_temp.take_as(3, :'offer') as took \gset
select is((:'took'::jsonb) ->> 'ok', 'true',
  'B: Tia takes it — marked unavailable that day, which never refuses the worker''s own choice');
select is((:'took'::jsonb) ->> 'bookingId', :'b_inv', 'B: through her own open invitation on the section');
select is((select array[status::text, source::text] from bookings where id = :'b_inv'),
  array['confirmed', 'offer'], 'B: now confirmed, source offer');
select ok((select confirmed_at is not null from bookings where id = :'b_inv'), 'B: stamped confirmed');
select is(
  (select array[status::text, cancel_cause, self_cancelled::text] from bookings where id = :'b_off'),
  array['cancelled', 'handed_over', 'true'],
  'B: Ora''s booking: cancelled, handed_over, self_cancelled (Q15)');
select is(
  (select array[status, taken_by_booking_id::text, taken_by_staff_id::text] from shift_offers where id = :'offer'),
  array['taken', :'b_inv', :'t_ok'], 'B: the offer is taken, naming the taker');
select is((select confirmed from shift_fill(:'s')), 2, 'B: after: still 2 confirmed — net zero');
select is(
  (select array[status::text, cancel_cause] from bookings where id = :'b_ovinv'),
  array['cancelled', 'overlap_auto_withdraw'],
  'B: her overlapping invitation across town is withdrawn, as on Accept (§3.4)');
select is((select recipient_staff_id from notification_outbox where key = 'OF2:offer:' || :'offer'), :'off'::uuid,
  'B: OF2 to Ora: handed over');
select is((select recipient_staff_id from notification_outbox where key = 'OF4:offer:' || :'offer'), :'t_ok'::uuid,
  'B: OF4 to Tia: you''re booked');
select is((select count(*)::int from notification_outbox n
            where n.template = 'N10c' and n.payload ->> 'shiftId' = :'s'), 0,
  'B: no N10c — the confirmed count did not move');
select is((select count(*)::int from audit_log where action = 'shift_offer.taken' and entity_id = :'offer'::uuid), 1,
  'B: the hand-over is audited');

select is(pg_temp.take_as(14, :'offer'), jsonb_build_object('ok', false, 'reason', 'offer_not_open'),
  'B: Quin, a moment later, finds it taken (the race)');
select is((select gate from auto_assign_candidates(:'s') where staff_id = :'off'), 'self_cancelled',
  'B: Ora is now barred from the event, as after a self-cancel');
select is(invite_worker(:'s_sib', :'off', 'manual') ->> 'reason', 'self_cancelled',
  'B: not even the office can invite her back onto it (RULE-04)');

-- =====================================================================
-- C · RULE-17 on a second offer: wave 2 once wave 1 is told
-- =====================================================================
select set_config('request.jwt.claims', json_build_object('sub', '67130000-0000-4000-8000-000000000002', 'role', 'authenticated')::text, true);
set local role authenticated;
select offer_shift(:'b_off2') ->> 'offerId' as offer2 \gset
reset role;
select set_config('request.jwt.claims', '', true);

select is(pg_temp.take_as(4, :'offer2'), jsonb_build_object('ok', false, 'reason', 'not_yet'),
  'C: Uri still waits — Quin (wave 1) has not been told');
insert into shift_offer_notices (offer_id, staff_id) values (:'offer2', :'t_q2');
select ok(not offer_wave1_exhausted(:'offer2'),
  'C: Quin alone is not all of wave 1 — the fixture''s Staff Alpha is qualified here too');
-- Every other wave-1 worker is pushed it too (the rounds do this in order).
insert into shift_offer_notices (offer_id, staff_id)
select :'offer2', c.staff_id from auto_assign_candidates(:'s') c
 where c.qualified and c.gate is null and c.staff_id <> :'off2'
on conflict do nothing;
select ok(offer_wave1_exhausted(:'offer2'),
  'C: once all of wave 1 has been pushed it, wave 1 is exhausted (Tia is booked, the offerers excluded)');
select is(pg_temp.take_as(4, :'offer2') ->> 'ok', 'true', 'C: and Uri, from wave 2, may take it');
select is(
  (select array[status::text, source::text] from bookings where shift_id = :'s' and staff_id = :'t_unq'),
  array['confirmed', 'offer'], 'C: a new booking, confirmed, source offer');
select is((select confirmed from shift_fill(:'s')), 2, 'C: still 2 confirmed');

-- An office cover request is not the pool's to take.
insert into bookings (shift_id, staff_id, status, source, confirmed_at)
values (:'s_sib', :'t_late', 'confirmed', 'auto', now());
insert into shift_offers (booking_id, mode, expires_at, note)
select id, 'office', now() + interval '20 days', 'exam' from bookings where shift_id = :'s_sib' and staff_id = :'t_late';
select is(pg_temp.take_as(14, (select o.id from shift_offers o join bookings b on b.id = o.booking_id
                                where b.staff_id = :'t_late' and o.status = 'open')),
  jsonb_build_object('ok', false, 'reason', 'offer_not_open'),
  'C: a cover request the office has not opened is not takeable');

select * from finish();
rollback;
