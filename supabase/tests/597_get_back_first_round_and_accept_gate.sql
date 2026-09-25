-- =====================================================================
-- 597 · The 26.09 scope audit, scheduling half (20260928110200 and
--       20260928110400):
--
--   A · get_back() — the event board's Get back goes through
--       resolve_violation(): arrival registered, booking → worked, the
--       no-show reclassified to late in place (§3.3, RULE-01)
--   B · office_mark_no_show() — the manual No-show with its guards
--       (confirmed only, no check-in, the §3.3 window, one per booking)
--   C · auto_assign_first_round() — one hourly round for a new event,
--       posted exactly as the cron command posts (§3.4 "from the moment
--       the event is created"), never raising into the save
--   D · RULE-12 on the Accept path: accept_invite() re-reads the gate, and
--       block_worker() withdraws an invitation on a section already under
--       way
--   E · RULE-05: allocation_per_hour defaults to headcount + buffer
--
-- Every row is created inside the transaction and rolled back.
-- =====================================================================
begin;
select plan(44);
\ir _shared/fixtures.psql

\set ev_live   'e5970000-0000-4000-8000-000000000001'
\set ev_new    'e5970000-0000-4000-8000-000000000002'
\set sh_live   'f5970000-0000-4000-8000-000000000001'
\set sh_later  'f5970000-0000-4000-8000-000000000002'
\set sh_new    'f5970000-0000-4000-8000-000000000003'
\set w_ns      'd5970000-0000-4000-8000-000000000001'
\set w_ok      'd5970000-0000-4000-8000-000000000002'
\set w_esc     'd5970000-0000-4000-8000-000000000003'
\set w_leak    'd5970000-0000-4000-8000-000000000004'
\set w_left    'd5970000-0000-4000-8000-000000000005'
\set w_new     'd5970000-0000-4000-8000-000000000006'
\set bk_ns     '05970000-0000-4000-8000-000000000001'
\set bk_ok     '05970000-0000-4000-8000-000000000002'
\set bk_inv    '05970000-0000-4000-8000-000000000003'
\set bk_leak   '05970000-0000-4000-8000-000000000004'
\set bk_left   '05970000-0000-4000-8000-000000000005'
\set bk_later  '05970000-0000-4000-8000-000000000006'
\set v_ns      '0d970000-0000-4000-8000-000000000001'

-- A section that started 90 minutes ago at the fixture venue, headcount 3
-- so the escalation case below has room; and one tomorrow for the window.
insert into events (id, client_id, venue_id, venue_name, venue_address, venue_location,
                    geofence_radius_m, title, event_date, pays_breaks, pays_buffer, auto_assign) values
  (:'ev_live', :'clienta', :'venue_id', 'RLS Fixture Venue', '1 Test Street, London',
   st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150,
   'Audit 597 live event', current_date, true, true, true),
  (:'ev_new', :'clienta', :'venue_id', 'RLS Fixture Venue', '1 Test Street, London',
   st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150,
   'Audit 597 new event', current_date + 10, true, true, true);

insert into shift_requirements (id, event_id, role_id, starts_at, ends_at, headcount, buffer,
                                charge_rate, pay_rate, allocation_per_hour) values
  (:'sh_live',  :'ev_live', :'role_id', now() - interval '90 minutes', now() + interval '6 hours 30 minutes',
   3, 0, 22.97, 14.00, 3),
  (:'sh_later', :'ev_live', :'role_id', now() + interval '1 day', now() + interval '1 day 8 hours',
   2, 0, 22.97, 14.00, 2),
  (:'sh_new',   :'ev_new',  :'role_id', now() + interval '10 days', now() + interval '10 days 8 hours',
   2, 1, 22.97, 14.00, 3);

insert into staff (id, first_name, last_name, email, phone, dob, status, rtw_branch, home_location,
                   reliability, rating) values
  (:'w_ns',   'No',     'Show',   'ns@597.test',   '+447700959701', date '1995-01-01', 'compliant', 'uk_irish',
   st_setsrid(st_makepoint(-0.1010, 51.5000), 4326)::geography, 90, 4.5),
  (:'w_ok',   'Still',  'Coming', 'ok@597.test',   '+447700959702', date '1995-01-02', 'compliant', 'uk_irish',
   st_setsrid(st_makepoint(-0.1010, 51.5000), 4326)::geography, 90, 4.5),
  (:'w_esc',  'Esca',   'Lation', 'esc@597.test',  '+447700959703', date '1995-01-03', 'compliant', 'uk_irish',
   st_setsrid(st_makepoint(-0.1010, 51.5000), 4326)::geography, 90, 4.5),
  (:'w_leak', 'Al',     'Ready',  'leak@597.test', '+447700959704', date '1995-01-04', 'compliant', 'uk_irish',
   st_setsrid(st_makepoint(-0.1010, 51.5000), 4326)::geography, 90, 4.5),
  (:'w_left', 'Has',    'Left',   'left@597.test', '+447700959705', date '1995-01-05', 'compliant', 'uk_irish',
   st_setsrid(st_makepoint(-0.1010, 51.5000), 4326)::geography, 90, 4.5),
  (:'w_new',  'Fresh',  'Pool',   'new@597.test',  '+447700959706', date '1995-01-06', 'compliant', 'uk_irish',
   st_setsrid(st_makepoint(-0.1010, 51.5000), 4326)::geography, 90, 4.5);
insert into staff_roles (staff_id, role_id)
select id, :'role_id' from staff where id in (:'w_ns', :'w_ok', :'w_esc', :'w_leak', :'w_left', :'w_new');

insert into bookings (id, shift_id, staff_id, status, source, confirmed_at) values
  (:'bk_ns',    :'sh_live',  :'w_ns',   'confirmed', 'auto',   now() - interval '2 days'),
  (:'bk_ok',    :'sh_live',  :'w_ok',   'confirmed', 'auto',   now() - interval '2 days'),
  (:'bk_later', :'sh_later', :'w_ok',   'confirmed', 'auto',   now() - interval '2 days'),
  (:'bk_inv',   :'sh_later', :'w_ns',   'invited',   'auto',   null);

-- BG-03 raised the no-show for w_ns an hour ago (the shape booking_tick writes).
insert into violations (id, staff_id, booking_id, type, detected_at)
values (:'v_ns', :'w_ns', :'bk_ns', 'no_show', now() - interval '60 minutes');

-- The manager.
set local "request.jwt.claims" = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

-- =====================================================================
-- A · get_back()
-- =====================================================================
select is((select count(*)::int from check_logs where booking_id = :'bk_ns'), 0,
  'A: the no-show has no check log — the button had locked');

select is(get_back(:'bk_ns')->>'decision', 'resolved',
  'A: Get back resolves the booking''s open no-show through resolve_violation()');
select is((select status::text from bookings where id = :'bk_ns'), 'worked',
  'A: §3.3 the worker is registered as arrived — the booking moves to worked');
select is((select count(*)::int from check_logs where booking_id = :'bk_ns' and check_in_at is not null), 1,
  'A: and a check-in stands at the moment of the press, so RULE-01 has a window to pay from');
select is((select type::text from violations where id = :'v_ns'), 'late',
  'A: the SAME violation row is reclassified to late — history kept, not deleted and re-inserted');
select is((select resolved from violations where id = :'v_ns'), true,
  'A: and it is closed, with the board''s note');
select ok((select minutes_late between 89 and 91 from violations where id = :'v_ns'),
  'A: minutes late are counted from the section start to the press (~90)');
select is((select resolution_note from violations where id = :'v_ns'),
  'Get back — registered as arrived from the event board (§3.3).',
  'A: the press is the note when the manager types none');
select is((select count(*)::int from violations where booking_id = :'bk_ns'), 1,
  'A: one entry for one arrival — no second `late` row stacked on the no-show');

select throws_like(
  format('select get_back(%L)', :'bk_ns'), '%no_open_no_show%',
  'A: a second press finds nothing to get back from');
select throws_like(
  format('select get_back(%L)', :'bk_ok'), '%no_open_no_show%',
  'A: a worker without a no-show cannot be "got back"');

-- =====================================================================
-- B · office_mark_no_show()
-- =====================================================================
select is(office_mark_no_show(:'bk_ok')->>'ok', 'true',
  'B: a confirmed worker with no check-in is marked no-show');
select is((select count(*)::int from violations where booking_id = :'bk_ok' and type = 'no_show' and not resolved), 1,
  'B: one open no_show violation, the shape BG-03 writes');
select is((select status::text from bookings where id = :'bk_ok'), 'confirmed',
  'B: §3.3 the worker STAYS in Confirmed, badged — the violation does not move them');
select is(office_mark_no_show(:'bk_ok')->>'already', 'true',
  'B: a second press finds the first rather than stacking a second no-show');
select is((select count(*)::int from violations where booking_id = :'bk_ok' and type = 'no_show'), 1,
  'B: still one');

select throws_like(
  format('select office_mark_no_show(%L)', :'bk_inv'), '%booking_not_confirmed%',
  'B: an invitation is not a promise to turn up — only a confirmed booking can be a no-show');
select throws_like(
  format('select office_mark_no_show(%L)', :'booking_a'), '%already_checked_in%',
  'B: a worker who has checked in is not a no-show');
select throws_like(
  format('select office_mark_no_show(%L)', :'bk_later'), '%outside_window%',
  'B: §3.3 the window opens at the shift start — tomorrow''s shift cannot be a no-show yet');
update shift_requirements set starts_at = now() - interval '15 days', ends_at = now() - interval '14 days 1 hour'
 where id = :'sh_later';
select throws_like(
  format('select office_mark_no_show(%L)', :'bk_later'), '%outside_window%',
  'B: and closes two weeks after the shift ends (canMarkNoShow''s NO_SHOW_WINDOW_DAYS)');
update shift_requirements set starts_at = now() - interval '13 days 8 hours', ends_at = now() - interval '13 days'
 where id = :'sh_later';
select is(office_mark_no_show(:'bk_later')->>'ok', 'true',
  'B: thirteen days after the end is still inside the window');

-- Not for a worker.
set local "request.jwt.claims" = '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}';
select throws_like(format('select office_mark_no_show(%L)', :'bk_ns'), '%admins_only%',
  'B: a worker cannot record a no-show');
select throws_like(format('select get_back(%L)', :'bk_ns'), '%admins_only%',
  'A: nor get anyone back');
select throws_like(format('select auto_assign_first_round(%L)', :'ev_new'), '%admins_only%',
  'C: nor post a first round');
set local "request.jwt.claims" = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

-- =====================================================================
-- C · auto_assign_first_round()
-- =====================================================================
select throws_like(
  'select auto_assign_first_round(''e5970000-0000-4000-8000-0000000000ff'')', '%event_not_found%',
  'C: an unknown event is an error, not a silent no-op');

update events set auto_assign = false where id = :'ev_new';
select is(auto_assign_first_round(:'ev_new')->>'reason', 'nothing_due',
  'C: §3.4 the switch: auto-assign off at the event means no round is posted');
update events set auto_assign = true where id = :'ev_new';
update shift_requirements set auto_assign = false where id = :'sh_new';
select is(auto_assign_first_round(:'ev_new')->>'reason', 'nothing_due',
  'C: and off at the role level, for its only section, means the same');
update shift_requirements set auto_assign = true where id = :'sh_new';

select is(auto_assign_first_round(:'ev_live')->>'reason', 'nothing_due',
  'C: a section already under way is the escalation job''s (§3.4 exclusive handover), not a first round''s');

-- Nothing configured: reported, never raised into the save.
select is(auto_assign_first_round(:'ev_new')->>'reason', 'edge_base_url_not_set',
  'C: with no Edge base URL the save is told, not failed — the :17 round catches up');
select is((auto_assign_first_round(:'ev_new')->>'due')::int, 1,
  'C: and it says how many sections were due');

reset role;
insert into settings (key, value) values ('edge_base_url', to_jsonb('http://127.0.0.1:54321/functions/v1'::text))
on conflict (key) do update set value = excluded.value;
set local "request.jwt.claims" = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select is(auto_assign_first_round(:'ev_new')->>'reason', 'service_role_key_not_set',
  'C: the bearer comes from Vault, as for the cron — without it nothing is posted');

do $$ begin
  perform vault.create_secret('local-test-key', 'service_role_key');
exception when undefined_function then
  insert into vault.secrets (name, secret) values ('service_role_key', 'local-test-key');
end $$;
select is(auto_assign_first_round(:'ev_new')->>'queued', 'true',
  'C: base URL and key in place → one hourly-mode round is posted for this event');

update events set cancelled_at = now(), cancel_reason = 'audit' where id = :'ev_new';
select is(auto_assign_first_round(:'ev_new')->>'reason', 'event_cancelled',
  'C: a cancelled event gets no round (§3.3 auto-assign stops)');
update events set cancelled_at = null, cancel_reason = null where id = :'ev_new';

-- =====================================================================
-- D · RULE-12 on the Accept path
-- =====================================================================
-- An escalation invitation on the section that is under way — the one
-- block_worker used to leave standing.
select is(invite_worker(:'sh_live', :'w_esc', 'escalation', true)->>'invited', 'true',
  'D: the escalation job invites a nearby worker onto the section under way');
select is(
  (block_worker(:'w_esc', 'auto_document', 'Passport expired', now(), 'blocked', 'blocked')->>'withdrawn')::int, 1,
  'D: blocking them withdraws that invitation even though the section has started');
select is((select cancel_cause from bookings where shift_id = :'sh_live' and staff_id = :'w_esc'),
  'blocked_invite', 'D: with the block as its cause');

-- The pre-fix leak, reconstructed: a blocked worker still holding an
-- `invited` row. Accept must refuse on the status, whatever the fill.
update staff set status = 'blocked', block_kind = 'auto_document', block_reason = 'Passport expired'
 where id = :'w_leak';
insert into bookings (id, shift_id, staff_id, status, source)
values (:'bk_leak', :'sh_live', :'w_leak', 'invited', 'escalation');
select is(accept_invite(:'bk_leak')->>'reason', 'blocked',
  'D: RULE-12 — a blocked worker cannot Accept their way into confirmed');
select is((select status::text from bookings where id = :'bk_leak'), 'invited',
  'D: the refusal leaves the row as it was (block_worker is what cancels it)');

-- A leaver: no candidate row at all.
update staff set status = 'inactive', left_at = now() - interval '1 hour' where id = :'w_left';
insert into bookings (id, shift_id, staff_id, status, source)
values (:'bk_left', :'sh_live', :'w_left', 'invited', 'auto');
select is(accept_invite(:'bk_left')->>'reason', 'not_bookable',
  'D: a worker who has left is not_bookable — an absent candidate row is a refusal, not "no gate applies"');

-- And the ordinary case still confirms.
select is(invite_worker(:'sh_new', :'w_new')->>'invited', 'true', 'D: a clean worker is invited');
select is(accept_invite((select id from bookings where shift_id = :'sh_new' and staff_id = :'w_new'))->>'ok',
  'true', 'D: and a compliant worker''s Accept goes through with the gate in place');

-- =====================================================================
-- E · RULE-05: allocation_per_hour defaults to headcount + buffer
-- =====================================================================
reset role;
insert into shift_requirements (id, event_id, role_id, starts_at, ends_at, headcount, buffer,
                                charge_rate, pay_rate)
values ('f5970000-0000-4000-8000-000000000004', :'ev_new', :'role_id',
        now() + interval '10 days 9 hours', now() + interval '10 days 17 hours', 6, 1, 22.97, 14.00);
select is((select allocation_per_hour from shift_requirements where id = 'f5970000-0000-4000-8000-000000000004'), 7,
  'E: §3.4 an insert without an allocation gets headcount + buffer (6 + 1)');
select is((select allocation_per_hour from shift_requirements where id = :'sh_new'), 3,
  'E: an explicit allocation is kept — "editable"');
select is((select allocation from auto_assign_due_shifts('hourly') where shift_id = 'f5970000-0000-4000-8000-000000000004'), 7,
  'E: and the round reads that allocation for the section — the number of invitations it adds');

select * from finish();
rollback;
