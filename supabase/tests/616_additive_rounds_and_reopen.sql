-- =====================================================================
-- 616 · Additive rounds keep adding; ended offers can be made again
--   20260929110100_additive_rounds_and_reopened_offers.sql (audit D3, D33, D9)
--
--   1. D3: a second round invites `allocation` more while the first
--      round's invitations are still unanswered, and the rounds stop once
--      headcount + buffer is CONFIRMED (open invitations never count).
--   2. D9: an auto or escalation invitation is refused when either switch
--      is off at the insert; a manual one is not.
--   3. D33: who may reopen an ended row — booking_reopenable_by, cause for
--      cause — and each write path honouring it: a round reopens only a
--      row ended by circumstance; the office reopens a decision; the
--      worker re-applies; a self-cancel is never reopened, by anyone, and
--      the database refuses it outright.
--   4. A reopened invitation is a new offer: fresh stamps, its own N5,
--      with the same payload queue_booking_push writes.
-- =====================================================================
begin;
select plan(46);
\ir _shared/fixtures.psql

select cap_week_start(current_date) + 14 as w \gset

\set ro   '61600000-0000-4000-8000-000000000001'
\set ev   '61600000-0000-4000-8000-0000000000e1'
\set s    '61610000-0000-4000-8000-000000000001'
\set s2   '61610000-0000-4000-8000-000000000002'
\set s3   '61610000-0000-4000-8000-000000000003'
\set w1   '61620000-0000-4000-8000-000000000001'
\set w2   '61620000-0000-4000-8000-000000000002'
\set w3   '61620000-0000-4000-8000-000000000003'
\set w4   '61620000-0000-4000-8000-000000000004'
\set w5   '61620000-0000-4000-8000-000000000005'
\set w6   '61620000-0000-4000-8000-000000000006'
\set w7   '61620000-0000-4000-8000-000000000007'
\set w8   '61620000-0000-4000-8000-000000000008'
\set rslot '61630000-0000-4000-8000-000000000001'
\set rdecl '61630000-0000-4000-8000-000000000002'
\set roffw '61630000-0000-4000-8000-000000000003'
\set rcut  '61630000-0000-4000-8000-000000000004'
\set rself '61630000-0000-4000-8000-000000000005'
\set rhist '61630000-0000-4000-8000-000000000006'
\set rlive '61630000-0000-4000-8000-000000000007'

insert into roles (id, name, pay_rate) values (:'ro', 'Additive Waiting Staff', 14.00);
insert into events (id, client_id, venue_id, venue_name, venue_address, venue_location,
                    geofence_radius_m, title, event_date, pays_breaks, pays_buffer) values
  (:'ev', :'clienta', :'venue_id', 'RLS Fixture Venue', '1 Test Street, London',
   st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150, 'Additive Gala', :'w'::date + 3, true, true);

insert into shift_requirements (id, event_id, role_id, starts_at, ends_at, headcount, buffer,
                                charge_rate, pay_rate, allocation_per_hour) values
  -- Thursday morning: 2 (+1), allocation 3 = the default headcount + buffer.
  (:'s',  :'ev', :'ro', (:'w'::date + 3 + time '07:00') at time zone 'Europe/London',
                        (:'w'::date + 3 + time '12:00') at time zone 'Europe/London', 2, 1, 22, 14, 3),
  -- Thursday afternoon: the switches.
  (:'s2', :'ev', :'ro', (:'w'::date + 3 + time '13:00') at time zone 'Europe/London',
                        (:'w'::date + 3 + time '18:00') at time zone 'Europe/London', 5, 0, 22, 14, 5),
  -- Friday: the reopens.
  (:'s3', :'ev', :'ro', (:'w'::date + 4 + time '09:00') at time zone 'Europe/London',
                        (:'w'::date + 4 + time '17:00') at time zone 'Europe/London', 5, 0, 22, 14, 5);

insert into staff (id, first_name, last_name, email, phone, dob, status, rtw_branch) values
  (:'w1', 'Ada', 'One',   'w1@ad616.test', '+447700961601', date '1995-01-01', 'compliant', 'uk_irish'),
  (:'w2', 'Ben', 'Two',   'w2@ad616.test', '+447700961602', date '1995-01-01', 'compliant', 'uk_irish'),
  (:'w3', 'Cai', 'Three', 'w3@ad616.test', '+447700961603', date '1995-01-01', 'compliant', 'uk_irish'),
  (:'w4', 'Dee', 'Four',  'w4@ad616.test', '+447700961604', date '1995-01-01', 'compliant', 'uk_irish'),
  (:'w5', 'Eve', 'Five',  'w5@ad616.test', '+447700961605', date '1995-01-01', 'compliant', 'uk_irish'),
  (:'w6', 'Fin', 'Six',   'w6@ad616.test', '+447700961606', date '1995-01-01', 'compliant', 'uk_irish'),
  (:'w7', 'Gus', 'Seven', 'w7@ad616.test', '+447700961607', date '1995-01-01', 'compliant', 'uk_irish'),
  (:'w8', 'Hal', 'Eight', 'w8@ad616.test', '+447700961608', date '1995-01-01', 'compliant', 'uk_irish');
insert into staff_roles (staff_id, role_id) select id, :'ro' from staff where email like '%@ad616.test';

select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);

-- ---------------------------------------------------------------------
-- 1 · D3: rounds are additive until CONFIRMED reaches the target
-- ---------------------------------------------------------------------
select is((select allocation from auto_assign_due_shifts('hourly') where shift_id = :'s'), 3,
  'round 1: the section is due, allocation 3');
select is(invite_worker(:'s', :'w1') ->> 'invited', 'true', 'round 1 invites Ada');
select is(invite_worker(:'s', :'w2') ->> 'invited', 'true', 'round 1 invites Ben');
select is(invite_worker(:'s', :'w3') ->> 'invited', 'true', 'round 1 invites Cai — 3 invitations = the target');

select is((select allocation from auto_assign_due_shifts('hourly') where shift_id = :'s'), 3,
  'an hour later nobody has answered: the section is still due, for another allocation');
select is(invite_worker(:'s', :'w4') ->> 'invited', 'true',
  'round 2 invites past the unanswered round 1 — it used to answer target_met (§3.4 "it keeps adding")');
select is(invite_worker(:'s', :'w5') ->> 'invited', 'true', 'round 2, second invitation');
select is(invite_worker(:'s', :'w6') ->> 'invited', 'true', 'round 2, third: a full allocation added');
select is((select count(*)::int from bookings where shift_id = :'s' and status = 'invited'), 6,
  'every round-1 invitation stays open beside round 2''s — auto-assign never withdraws (§3.6)');

select is(accept_invite((select id from bookings where shift_id = :'s' and staff_id = :'w4')) ->> 'ok', 'true', 'Dee accepts');
select is(accept_invite((select id from bookings where shift_id = :'s' and staff_id = :'w1')) ->> 'ok', 'true', 'Ada accepts');
select is(accept_invite((select id from bookings where shift_id = :'s' and staff_id = :'w6')) ->> 'ok', 'true',
  'Fin accepts: 3 confirmed = headcount + buffer');
select is_empty(
  format($$ select 1 from auto_assign_due_shifts('hourly') where shift_id = %L $$, :'s'),
  'filled: the hourly round stops picking the section');
select is(invite_worker(:'s', :'w7'),
  jsonb_build_object('invited', false, 'reason', 'target_met'),
  'and invite_worker refuses a further auto invitation: target_met on CONFIRMED only');
select is(accept_invite((select id from bookings where shift_id = :'s' and staff_id = :'w2')) ->> 'reason', 'taken',
  'a late Accept finds the slot gone (first-to-confirm, §3.4)');

-- ---------------------------------------------------------------------
-- 2 · D9: the switches at the insert
-- ---------------------------------------------------------------------
update events set auto_assign = false where id = :'ev';
select is(invite_worker(:'s2', :'w7', 'auto'),
  jsonb_build_object('invited', false, 'reason', 'auto_assign_off'),
  'event switch off: an auto invitation already in flight is refused at the insert');
update events set auto_assign = true where id = :'ev';
update shift_requirements set auto_assign = false where id = :'s2';
select is(invite_worker(:'s2', :'w7', 'escalation', true) ->> 'reason', 'auto_assign_off',
  'role switch off: so is an escalation one');
select is(invite_worker(:'s2', :'w7', 'manual', true) ->> 'invited', 'true',
  'a manual invitation is not auto-assign and is never held to the switches (§3.4)');
update shift_requirements set auto_assign = true where id = :'s2';

-- ---------------------------------------------------------------------
-- 3 · D33: booking_reopenable_by, cause for cause (state.ts mirrors it)
-- ---------------------------------------------------------------------
select results_eq(
  $$ select c, booking_reopenable_by(st::booking_status, c)
       from (values ('cancelled','office_withdraw'), ('cancelled','ready_cutoff'),
                    ('cancelled','self_cancel'), ('cancelled','overlap_auto_withdraw'),
                    ('cancelled','event_cancelled'), ('cancelled','blocked'),
                    ('cancelled','blocked_invite'), ('cancelled','left'),
                    ('cancelled','left_invite'), ('cancelled','gdpr'), ('cancelled','gdpr_invite'),
                    ('closed','slot_taken'), ('closed','declined'), ('closed','withdrawn_by_worker'))
            as v(st, c) order by c $$,
  $$ values ('blocked','anyone'), ('blocked_invite','anyone'), ('declined','person'),
            ('event_cancelled','never'), ('gdpr','never'), ('gdpr_invite','never'),
            ('left','anyone'), ('left_invite','anyone'), ('office_withdraw','person'),
            ('overlap_auto_withdraw','anyone'), ('ready_cutoff','person'),
            ('self_cancel','never'), ('slot_taken','anyone'), ('withdrawn_by_worker','person') $$,
  'booking_reopenable_by: never (self-cancel, event cancelled, GDPR) · anyone (circumstance) · person (a decision)');
select is(booking_reopenable_by('confirmed', null), null, 'a live row is not reopened');

-- The rows on Friday.
insert into bookings (id, shift_id, staff_id, status, source, cancelled_at, cancel_cause) values
  (:'rslot', :'s3', :'w1', 'closed',    'auto', now(), 'slot_taken'),
  (:'rdecl', :'s3', :'w2', 'closed',    'auto', now(), 'declined'),
  (:'rcut',  :'s3', :'w4', 'cancelled', 'auto', now(), 'ready_cutoff'),
  (:'rhist', :'s3', :'w6', 'cancelled', 'auto', now(), 'office_withdraw');
insert into bookings (id, shift_id, staff_id, status, source, confirmed_at, day_before_confirmed_at,
                      cancelled_at, cancel_cause) values
  (:'roffw', :'s3', :'w3', 'cancelled', 'auto', now() - interval '3 days', now() - interval '1 day',
   now(), 'office_withdraw');
insert into bookings (id, shift_id, staff_id, status, source, cancelled_at, cancel_cause, self_cancelled) values
  (:'rself', :'s3', :'w5', 'cancelled', 'auto', now(), 'self_cancel', true);
insert into bookings (id, shift_id, staff_id, status, source) values
  (:'rlive', :'s3', :'w7', 'invited', 'auto');
insert into violations (staff_id, booking_id, type) values (:'w6', :'rhist', 'no_show');

-- A round (auto) reopens circumstance only.
select is(invite_worker(:'s3', :'w1'),
  jsonb_build_object('invited', true, 'bookingId', :'rslot'::uuid, 'reopened', true),
  'a round reopens an offer Ada lost to someone quicker (slot_taken): same row, invited again');
select is((select status::text || '/' || coalesce(cancel_cause, '-') from bookings where id = :'rslot'), 'invited/-',
  'the row is live again, with no cause (bookings_cancel_cause_check)');
select is(invite_worker(:'s3', :'w2') ->> 'reason', 'already_has_booking',
  'a round does not re-invite Ben, who declined — the machine does not argue with a person');
select is(invite_worker(:'s3', :'w4') ->> 'reason', 'already_has_booking',
  'nor Dee, released at 12:05 for no "I''m ready" (§3.5)');
select is(invite_worker(:'s3', :'w7') ->> 'reason', 'already_has_booking',
  'a live invitation is still one booking per worker per section');

-- The office reopens a decision.
select is(office_invite_worker(:'s3', :'w2') ->> 'invited', 'true',
  'the manager invites Ben again by hand — "at any point" (§3.4); only self-cancel is permanent (§3.6)');
select is((select source::text from bookings where id = :'rdecl'), 'manual', 'and the reopened row says manual');
select is(office_invite_worker(:'s3', :'w4') ->> 'invited', 'true',
  'and Dee, released at the cutoff, if the office decides so');

-- The worker re-applies.
select is(apply_to_shift(:'s3', :'w3') ->> 'ok', 'true',
  'Cai, withdrawn by the office, may apply again on Radar (§10.4)');
select is((select status::text from bookings where id = :'roffw'), 'applied', 'the row is an application now');
select ok((select confirmed_at is null and day_before_confirmed_at is null and cancelled_at is null
             from bookings where id = :'roffw'),
  'with none of the old booking''s stamps: a reopened row is a fresh offer');

-- RULE-04: never, by anyone.
select is(office_invite_worker(:'s3', :'w5') ->> 'reason', 'self_cancelled',
  'RULE-04: the manager cannot invite Eve back onto an event she self-cancelled');
select is(apply_to_shift(:'s3', :'w5') ->> 'reason', 'self_cancelled',
  'nor can she apply to it');
select throws_ok(
  format($$ update bookings set status = 'invited', cancel_cause = null, cancelled_at = null where id = %L $$, :'rself'),
  '23514', null,
  'and the database refuses a self-cancelled row leaving cancelled by any route (bookings_self_cancel_is_final)');

-- A row with history stays ended.
select is(office_invite_worker(:'s3', :'w6') ->> 'reason', 'already_has_booking',
  'a row carrying a violation is never reopened: that history belongs to the booking that ended');

-- ---------------------------------------------------------------------
-- 4 · A reopened invitation is a new offer, with its own N5
-- ---------------------------------------------------------------------
select is((select count(*)::int from notification_outbox
            where template = 'N5' and payload ->> 'bookingId' = :'rslot'), 1,
  'Ada gets N5 for the reopened offer');
select ok((select key like 'N5:booking:' || :'rslot' || ':%' from notification_outbox
            where template = 'N5' and payload ->> 'bookingId' = :'rslot'),
  'under its own key — N5:booking:<id> alone would dedupe against the first offer');
select is(invite_worker(:'s3', :'w8') ->> 'invited', 'true', 'a fresh invitation for Hal');
select is(
  (select payload from notification_outbox
    where key = 'N5:booking:' || (select id from bookings where shift_id = :'s3' and staff_id = :'w8')::text),
  booking_push_payload((select id from bookings where shift_id = :'s3' and staff_id = :'w8')),
  'booking_push_payload is exactly what queue_booking_push writes, so both N5 routes carry the same values');
select ok((select created_at > now() - interval '1 minute' from bookings where id = :'rdecl'),
  'the reopened invitation reads as sent now on the board');

-- ---------------------------------------------------------------------
-- 5 · The state machine and the grants
-- ---------------------------------------------------------------------
select ok(booking_transition_allowed('cancelled', 'invited') and booking_transition_allowed('closed', 'invited')
      and booking_transition_allowed('cancelled', 'applied'),
  'the three reopen edges exist (ADR-0031)');
select ok(not booking_transition_allowed('cancelled', 'confirmed'),
  'and none skips the fresh offer');
select ok(not has_function_privilege('anon', 'public.booking_reopenable_by(booking_status, text)', 'execute'),
  'anon cannot execute booking_reopenable_by');
select ok(not has_function_privilege('anon', 'public.booking_push_payload(uuid)', 'execute')
      and not has_function_privilege('authenticated', 'public.booking_push_payload(uuid)', 'execute'),
  'nor read a booking''s push payload — definer and internal');
select ok(has_function_privilege('service_role', 'public.booking_push_payload(uuid)', 'execute'),
  'the job may');
select ok(not has_function_privilege('anon', 'public.invite_worker(uuid, uuid, booking_source, boolean)', 'execute'),
  'invite_worker stays closed to anon after the restatement');

select * from finish();
rollback;
