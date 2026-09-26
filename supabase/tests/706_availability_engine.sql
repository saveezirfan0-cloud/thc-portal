-- =====================================================================
-- 706 · Availability in auto-assign (ADR-0042, docs/19 §1, Agent A)
--   20260930201000_availability_in_auto_assign.sql
--
--   A · auto_assign_unavailable(p_shift): the section's calendar entries,
--       half-open against the ROLE SECTION's window (RULE-18); office,
--       service role and a direct connection only
--   B · invite_worker(…, 'auto' | 'escalation') refuses `unavailable`,
--       writing nothing; 'manual' still invites; the worker's own Accept
--       and Radar apply still succeed
--   C · every refusal invite_worker made BEFORE the restatement, asserted
--       together in this one file (docs/10 §3b — a restated function must
--       not drop a shipped gate with a green build): not_authorised,
--       shift_not_found, event_cancelled, not_bookable, wrong_role,
--       do_not_return, blocked, self_cancelled, booked_elsewhere,
--       rtw_expired, hours_limit, outside_radius, already_has_booking,
--       target_met — and a clean invitation with N5 — and, since the body
--       is now main's 20260930110100, its auto_assign_off (D9) and the
--       reopen of an ended row (D33)
--
-- Every row is created inside the transaction and rolled back.
-- =====================================================================
begin;
select plan(49);
\ir _shared/fixtures.psql

select cap_week_start(current_date) + 14 as w \gset

\set ev      '65600000-0000-4000-8000-000000000001'
\set evx     '65600000-0000-4000-8000-000000000002'
\set s       '65610000-0000-4000-8000-000000000001'
\set s_over  '65610000-0000-4000-8000-000000000002'
\set s_full  '65610000-0000-4000-8000-000000000003'
\set s_live  '65610000-0000-4000-8000-000000000004'
\set s_apply '65610000-0000-4000-8000-000000000005'
\set s_cap   '65610000-0000-4000-8000-000000000006'
\set sx      '65610000-0000-4000-8000-000000000007'
\set s_none  '65610000-0000-4000-8000-0000000000ff'

\set w_ok     '65620000-0000-4000-8000-000000000001'
\set w_un     '65620000-0000-4000-8000-000000000002'
\set w_edge   '65620000-0000-4000-8000-000000000003'
\set w_unblk  '65620000-0000-4000-8000-000000000004'
\set w_wrong  '65620000-0000-4000-8000-000000000005'
\set w_dnr    '65620000-0000-4000-8000-000000000006'
\set w_self   '65620000-0000-4000-8000-000000000007'
\set w_booked '65620000-0000-4000-8000-000000000008'
\set w_left   '65620000-0000-4000-8000-000000000009'
\set w_rtw    '65620000-0000-4000-8000-000000000010'
\set w_cap    '65620000-0000-4000-8000-000000000011'
\set w_nohome '65620000-0000-4000-8000-000000000012'
\set w_fill   '65620000-0000-4000-8000-000000000013'
\set un_uid   '65630000-0000-4000-8000-000000000002'

-- ---------------------------------------------------------------------
-- Fixture
-- ---------------------------------------------------------------------
insert into auth.users (id, email) values (:'un_uid', 'un@av656.test');
insert into profiles (id, role, full_name) values (:'un_uid', 'staff', 'Una Available');

insert into staff (id, user_id, first_name, last_name, email, phone, dob, status, rtw_branch,
                   home_location, left_at, right_to_work_until) values
  (:'w_ok',     null,      'Ola',  'Clean',   'ok@av656.test',   '+447700965601', date '1995-01-01', 'compliant', 'uk_irish',
   st_setsrid(st_makepoint(-0.1010, 51.5000), 4326)::geography, null, null),
  (:'w_un',     :'un_uid', 'Una',  'Away',    'un@av656.test',   '+447700965602', date '1995-01-02', 'compliant', 'uk_irish',
   st_setsrid(st_makepoint(-0.1010, 51.5000), 4326)::geography, null, null),
  (:'w_edge',   null,      'Eda',  'Edge',    'ed@av656.test',   '+447700965603', date '1995-01-03', 'compliant', 'uk_irish',
   st_setsrid(st_makepoint(-0.1010, 51.5000), 4326)::geography, null, null),
  (:'w_unblk',  null,      'Ben',  'Blocked', 'bl@av656.test',   '+447700965604', date '1995-01-04', 'blocked',   'uk_irish',
   st_setsrid(st_makepoint(-0.1010, 51.5000), 4326)::geography, null, null),
  (:'w_wrong',  null,      'Wes',  'Norole',  'wr@av656.test',   '+447700965605', date '1995-01-05', 'compliant', 'uk_irish',
   st_setsrid(st_makepoint(-0.1010, 51.5000), 4326)::geography, null, null),
  (:'w_dnr',    null,      'Dora', 'Dnr',     'dn@av656.test',   '+447700965606', date '1995-01-06', 'compliant', 'uk_irish',
   st_setsrid(st_makepoint(-0.1010, 51.5000), 4326)::geography, null, null),
  (:'w_self',   null,      'Sam',  'Selfcx',  'sc@av656.test',   '+447700965607', date '1995-01-07', 'compliant', 'uk_irish',
   st_setsrid(st_makepoint(-0.1010, 51.5000), 4326)::geography, null, null),
  (:'w_booked', null,      'Bea',  'Booked',  'bk@av656.test',   '+447700965608', date '1995-01-08', 'compliant', 'uk_irish',
   st_setsrid(st_makepoint(-0.1010, 51.5000), 4326)::geography, null, null),
  (:'w_left',   null,      'Leo',  'Left',    'lf@av656.test',   '+447700965609', date '1995-01-09', 'inactive',  'uk_irish',
   st_setsrid(st_makepoint(-0.1010, 51.5000), 4326)::geography, now(), null),
  (:'w_rtw',    null,      'Rhea', 'Visa',    'rw@av656.test',   '+447700965610', date '2001-01-10', 'compliant', 'international_student',
   st_setsrid(st_makepoint(-0.1010, 51.5000), 4326)::geography, null, :'w'::date + 2),
  (:'w_cap',    null,      'Cal',  'Capped',  'cp@av656.test',   '+447700965611', date '2001-01-11', 'compliant', 'international_student',
   st_setsrid(st_makepoint(-0.1010, 51.5000), 4326)::geography, null, null),
  (:'w_nohome', null,      'Nia',  'Nohome',  'nh@av656.test',   '+447700965612', date '1995-01-12', 'compliant', 'uk_irish',
   null, null, null),
  (:'w_fill',   null,      'Fay',  'Filler',  'fl@av656.test',   '+447700965613', date '1995-01-13', 'compliant', 'uk_irish',
   st_setsrid(st_makepoint(-0.1010, 51.5000), 4326)::geography, null, null);
-- A student in term time (no holiday ranges on file) is on the 20 h cap.
update staff set term_dates = '{}' where id = :'w_cap';

insert into staff_roles (staff_id, role_id)
select id, :'role_id' from staff where email like '%@av656.test' and id <> :'w_wrong';
insert into client_qualifications (client_id, role_id, staff_id, do_not_return)
values (:'clienta', :'role_id', :'w_dnr', true);

insert into events (id, client_id, venue_id, venue_name, venue_address, venue_location, geofence_radius_m,
                    title, event_date, pays_breaks, pays_buffer, auto_assign) values
  (:'ev', :'clienta', :'venue_id', 'RLS Fixture Venue', '1 Test Street, London',
   st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150, 'Calendar Gala', :'w'::date + 3, true, true, true),
  (:'evx', :'clienta', :'venue_id', 'RLS Fixture Venue', '1 Test Street, London',
   st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150, 'Called Off', :'w'::date + 6, true, true, true);
update events set cancelled_at = now(), cancel_reason = 'fixture' where id = :'evx';

insert into shift_requirements (id, event_id, role_id, starts_at, ends_at, headcount, buffer,
                                charge_rate, pay_rate, allocation_per_hour) values
  -- Thursday 09:00–17:00 UK: the section every gate is asked about.
  (:'s',       :'ev', :'role_id', (:'w'::date + 3 + time '09:00') at time zone 'Europe/London',
                                  (:'w'::date + 3 + time '17:00') at time zone 'Europe/London', 5, 0, 20, 12, 5),
  -- Thursday 12:00–20:00, overlapping it: Bea is confirmed here, Sam self-cancelled here.
  (:'s_over',  :'ev', :'role_id', (:'w'::date + 3 + time '12:00') at time zone 'Europe/London',
                                  (:'w'::date + 3 + time '20:00') at time zone 'Europe/London', 5, 0, 20, 12, 5),
  -- Saturday, 1 (+0), already confirmed.
  (:'s_full',  :'ev', :'role_id', (:'w'::date + 5 + time '09:00') at time zone 'Europe/London',
                                  (:'w'::date + 5 + time '17:00') at time zone 'Europe/London', 1, 0, 20, 12, 1),
  -- Under way: the escalation's section (§3.4).
  (:'s_live',  :'ev', :'role_id', now() - interval '1 hour', now() + interval '6 hours', 3, 0, 20, 12, 3),
  -- Friday: Una applies on Radar through her own calendar entry.
  (:'s_apply', :'ev', :'role_id', (:'w'::date + 4 + time '09:00') at time zone 'Europe/London',
                                  (:'w'::date + 4 + time '17:00') at time zone 'Europe/London', 5, 0, 20, 12, 5),
  -- Tuesday, 16 h: Cal's week is already at 16 of 20.
  (:'s_cap',   :'ev', :'role_id', (:'w'::date + 1 + time '04:00') at time zone 'Europe/London',
                                  (:'w'::date + 1 + time '20:00') at time zone 'Europe/London', 5, 0, 20, 12, 5),
  (:'sx',      :'evx', :'role_id', (:'w'::date + 6 + time '09:00') at time zone 'Europe/London',
                                   (:'w'::date + 6 + time '17:00') at time zone 'Europe/London', 5, 0, 20, 12, 5);

insert into bookings (shift_id, staff_id, status, source, confirmed_at) values
  (:'s_over', :'w_booked', 'confirmed', 'auto', now()),
  (:'s_full', :'w_fill',   'confirmed', 'auto', now()),
  (:'s_cap',  :'w_cap',    'confirmed', 'auto', now());
insert into bookings (shift_id, staff_id, status, source, cancelled_at, cancel_cause, self_cancelled)
values (:'s_over', :'w_self', 'cancelled', 'auto', now(), 'self_cancel', true);

-- The calendar (ADR-0042), built the way the Staff App builds it.
insert into staff_unavailability (staff_id, period, all_day) values
  -- Una: all of Thursday and all of Friday (UK midnight to UK midnight).
  (:'w_un',    unavailability_range(:'w'::date + 3, :'w'::date + 4), true),
  -- Una: the hours around the section under way.
  (:'w_un',    tstzrange(now() - interval '2 hours', now() + interval '10 hours', '[)'), false),
  -- Eda: 06:00–09:00 Thursday — ends exactly as the section starts.
  (:'w_edge',  unavailability_range(:'w'::date + 3, null, time '06:00', time '09:00'), false),
  -- Ben is blocked AND away.
  (:'w_unblk', unavailability_range(:'w'::date + 3), true);

-- =====================================================================
-- A · auto_assign_unavailable()
-- =====================================================================
select ok(not has_function_privilege('anon', 'public.auto_assign_unavailable(uuid)', 'execute'),
  'A: anon cannot read anybody''s calendar through the engine');
select ok(has_function_privilege('service_role', 'public.auto_assign_unavailable(uuid)', 'execute'),
  'A: the auto-staffing job (service role) can');

select bag_eq(
  format($$ select staff_id from auto_assign_unavailable(%L) $$, :'s'),
  format($$ values (%L::uuid), (%L::uuid) $$, :'w_un', :'w_unblk'),
  'A: Thursday''s section: Una and Ben overlap it; Eda''s entry ends at 09:00, the section''s start, and does not (half-open)');
select is(
  (select array[starts_at, ends_at] from auto_assign_unavailable(:'s') where staff_id = :'w_un'),
  array[(:'w'::date + 3)::timestamp at time zone 'Europe/London',
        (:'w'::date + 5)::timestamp at time zone 'Europe/London'],
  'A: with the entry''s own window — UK midnight Thursday to UK midnight Saturday');
select is((select count(*)::int from auto_assign_unavailable(:'s_over')), 2,
  'A: measured against each ROLE SECTION (RULE-18), not the event: the overlapping section sees the same two');

select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select count(*)::int from auto_assign_unavailable(:'s')), 2,
  'A: the office reads it for the event board');
reset role;

select set_config('request.jwt.claims', json_build_object('sub', :'un_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(format($$ select * from auto_assign_unavailable(%L) $$, :'s'), '42501', 'not_authorised',
  'A: a worker is refused — not even their own row comes back this way');
reset role;
select set_config('request.jwt.claims', '', true);

-- =====================================================================
-- B · the new refusal, and what it never stops
-- =====================================================================
select is(invite_worker(:'s', :'w_un', 'auto'),
  jsonb_build_object('invited', false, 'reason', 'unavailable'),
  'B: an hourly round never invites a worker who marked the section unavailable');
select is(invite_worker(:'s_live', :'w_un', 'escalation', true),
  jsonb_build_object('invited', false, 'reason', 'unavailable'),
  'B: nor does the same-day escalation, though she lives inside the radius');
select is(invite_worker(:'s', :'w_unblk', 'auto') ->> 'reason', 'blocked',
  'B: a blocked worker who is also away is refused as blocked — the pool gate is the truer reason');
select is(invite_worker(:'s', :'w_edge', 'auto') ->> 'invited', 'true',
  'B: an entry ending exactly at the section start does not stop the round');
select is((select count(*)::int from bookings where staff_id in (:'w_un', :'w_unblk')), 0,
  'B: the refusals wrote no booking');
select is((select count(*)::int from notification_outbox where recipient_staff_id in (:'w_un', :'w_unblk')), 0,
  'B: and queued no N5');

select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is(office_invite_worker(:'s', :'w_un') ->> 'invited', 'true',
  'B: the manager''s Invite anyway still invites her (source manual)');
reset role;
select is((select source::text from bookings where shift_id = :'s' and staff_id = :'w_un'), 'manual',
  'B: the invitation is recorded as the office''s, not the machine''s');

select set_config('request.jwt.claims', json_build_object('sub', :'un_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is(accept_invite((select id from bookings where shift_id = :'s' and staff_id = :'w_un')) ->> 'ok', 'true',
  'B: and she can accept it — the calendar never refuses the worker''s own choice');
select is(apply_to_shift(:'s_apply') ->> 'ok', 'true',
  'B: nor her Radar application for Friday, inside her own entry');
reset role;
select set_config('request.jwt.claims', '', true);
select is((select status::text from bookings where shift_id = :'s' and staff_id = :'w_un'), 'confirmed',
  'B: she is confirmed on Thursday');
select is((select count(*)::int from staff_unavailability where staff_id = :'w_un'), 2,
  'B: and nothing touched her calendar');

-- =====================================================================
-- C · every earlier refusal, together
-- =====================================================================
select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(format($$ select invite_worker(%L, %L) $$, :'s', :'staffa'), '42501', 'not_authorised',
  'C: a worker cannot write an invitation (20260921162758)');
reset role;
select set_config('request.jwt.claims', '', true);

select throws_ok(format($$ select invite_worker(%L, %L) $$, :'s_none', :'w_ok'), 'P0002', 'shift_not_found',
  'C: an unknown section is an error');
select is(invite_worker(:'sx', :'w_ok') ->> 'reason', 'event_cancelled', 'C: event_cancelled');
select is(invite_worker(:'s', :'w_left') ->> 'reason', 'not_bookable',
  'C: not_bookable — a leaver has no candidate row at all (§10.6)');
select is(invite_worker(:'s', :'w_wrong') ->> 'reason', 'wrong_role', 'C: wrong_role');
select is(invite_worker(:'s', :'w_dnr') ->> 'reason', 'do_not_return', 'C: do_not_return');
select is(invite_worker(:'s', :'w_unblk', 'manual') ->> 'reason', 'blocked',
  'C: blocked — for a manual invitation too');
select is(invite_worker(:'s', :'w_self') ->> 'reason', 'self_cancelled',
  'C: self_cancelled off this event (RULE-04)');
select is(invite_worker(:'s', :'w_booked') ->> 'reason', 'booked_elsewhere',
  'C: booked_elsewhere — confirmed on an overlapping section');
select is(invite_worker(:'s', :'w_rtw') ->> 'reason', 'rtw_expired',
  'C: rtw_expired — the section is past the right to work');
select is(invite_worker(:'s', :'w_cap') ->> 'reason', 'hours_limit',
  'C: hours_limit — 16 h + 8 h is over the 20 h term-time cap (RULE-20)');
select is(invite_worker(:'s_live', :'w_nohome', 'escalation', true) ->> 'reason', 'outside_radius',
  'C: outside_radius — escalation only (§3.4)');
select is(invite_worker(:'s', :'w_ok') ->> 'invited', 'true', 'C: a clean worker is invited');
select is(
  (select template from notification_outbox
    where key = 'N5:booking:' || (select id from bookings where shift_id = :'s' and staff_id = :'w_ok')::text),
  'N5', 'C: with N5 under the key auto-assign uses');
select is(invite_worker(:'s', :'w_ok') ->> 'reason', 'already_has_booking',
  'C: already_has_booking on a second round');
select is(invite_worker(:'s_full', :'w_edge') ->> 'reason', 'target_met',
  'C: target_met once CONFIRMED reaches headcount + buffer (20260928110200)');
select is(invite_worker(:'s_full', :'w_edge', 'escalation', true) ->> 'invited', 'true',
  'C: and the escalation''s p_ignore_target still passes it');
select is(invite_worker(:'s', :'w_ok', 'escalation', true) ->> 'reason', 'already_has_booking',
  'C: the escalation path answers already_has_booking too');

select is(
  (select count(*)::int from bookings
    where staff_id in (:'w_left', :'w_wrong', :'w_dnr', :'w_rtw', :'w_nohome')
       or (staff_id = :'w_self' and shift_id = :'s')
       or (staff_id = :'w_booked' and shift_id = :'s')
       or (staff_id = :'w_cap' and shift_id = :'s')
       or (staff_id = :'w_unblk')),
  0, 'C: no refusal wrote a booking');

-- The order of the refusals, held on one worker: every gate beats the
-- calendar, and the calendar beats already_has_booking.
insert into staff_unavailability (staff_id, period, all_day)
values (:'w_ok', unavailability_range(:'w'::date + 3), true),
       (:'w_self', unavailability_range(:'w'::date + 3), true),
       (:'w_cap', unavailability_range(:'w'::date + 3), true);
select is(invite_worker(:'s', :'w_self') ->> 'reason', 'self_cancelled',
  'C: self_cancelled + away → self_cancelled');
select is(invite_worker(:'s', :'w_cap') ->> 'reason', 'hours_limit',
  'C: hours_limit + away → hours_limit');
select is(invite_worker(:'s', :'w_ok') ->> 'reason', 'unavailable',
  'C: an existing invitation + away → unavailable (the calendar is read before the booking)');
select is((select status::text from bookings where shift_id = :'s' and staff_id = :'w_ok'), 'invited',
  'C: and the open invitation is untouched — never withdrawn by auto-assign (§3.4)');
select is(invite_worker(:'s', :'w_ok', 'manual') ->> 'reason', 'already_has_booking',
  'C: a manual invitation skips the calendar and meets the one-booking rule');

-- The body this restates is main's 20260930110100, so its two changes are
-- held here together with the calendar clause (docs/10 §3b):
--   D9  the switches are read at the insert, before any gate;
--   D33 an ended row is reopened rather than refused — by a round only
--       when it ended by circumstance, by the office whenever a person may.
update shift_requirements set auto_assign = false where id = :'s';
select is(invite_worker(:'s', :'w_ok') ->> 'reason', 'auto_assign_off',
  'C: D9 — role switch off: an automatic invitation is refused at the insert, before the calendar');
update shift_requirements set auto_assign = true where id = :'s';
update bookings set status = 'closed', cancelled_at = now(), cancel_cause = 'slot_taken'
 where shift_id = :'s' and staff_id = :'w_ok';
select is(invite_worker(:'s', :'w_ok') ->> 'reason', 'unavailable',
  'C: D33 — a slot_taken row a round could reopen, but she is away: the machine is still refused');
select is(invite_worker(:'s', :'w_ok', 'manual') ->> 'reopened', 'true',
  'C: and the office reopens it by hand (D33) — the calendar is never read on that path');
select is((select status::text from bookings where shift_id = :'s' and staff_id = :'w_ok'), 'invited',
  'C: the one row is invited again, not a second booking');

select ok(has_function_privilege('authenticated', 'public.invite_worker(uuid, uuid, booking_source, boolean)', 'execute')
          and not has_function_privilege('anon', 'public.invite_worker(uuid, uuid, booking_source, boolean)', 'execute'),
  'C: the restatement kept invite_worker''s grants: authenticated (checked inside), never anon');
select ok((select prosecdef from pg_proc where oid = 'public.invite_worker(uuid, uuid, booking_source, boolean)'::regprocedure),
  'C: and it is still security definer');

select * from finish();
rollback;
