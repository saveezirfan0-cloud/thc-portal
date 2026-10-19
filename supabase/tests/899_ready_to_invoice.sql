-- =====================================================================
-- 899 · Ready to invoice — ADR-0168, 20261021100000_ready_to_invoice.sql
--
-- Five events, each one step of the status ladder:
--
--   E1 Clean     two 4 h Waiting shifts, clean → review; signed off →
--                ready; a violation raised after → review again (stale)
--   E2 Held      a 4 h shift with an unresolved No check-out → missing;
--   E3 Open      a section that ended an hour ago → open (the 4 h
--                check-out window is still running)
--   E4 No-show   one worked shift and one unresolved No-show → review:
--                the no-show blocks nothing and is never invoiced
--   E5 Gone      cancelled the day before → no lines, not listed
--
-- Charge: Waiting £22.97/h, so 4 h = 91.88.
-- =====================================================================
begin;
select plan(49);
\ir _shared/fixtures.psql

\set r_wait '89900000-0000-4000-8000-000000000001'
\set w1 '89910000-0000-4000-8000-000000000001'
\set w2 '89910000-0000-4000-8000-000000000002'
\set w3 '89910000-0000-4000-8000-000000000003'
\set w4 '89910000-0000-4000-8000-000000000004'
\set sched_uid  '89920000-0000-4000-8000-000000000001'
\set viewer_uid '89920000-0000-4000-8000-000000000002'

insert into auth.users (id, email) values
  (:'sched_uid',  'sched.899@rls.test'),
  (:'viewer_uid', 'viewer.899@rls.test');
insert into profiles (id, role, office_role, full_name) values
  (:'sched_uid',  'admin', 'scheduler', 'Sam Scheduler'),
  (:'viewer_uid', 'admin', 'viewer',    'Vera Viewer');

insert into roles (id, name, description, pay_rate) values
  (:'r_wait', 'Invoice Waiting Staff', 'fixture', 14.00);

insert into staff (id, employee_id, first_name, last_name, email, phone, dob, status) values
  (:'w1', 89901, 'Ina',  'Able',  'i-w1@rls.test', '+447700989901', date '1996-05-01', 'compliant'),
  (:'w2', 89902, 'Ivo',  'Baker', 'i-w2@rls.test', '+447700989902', date '1997-06-02', 'compliant'),
  (:'w3', 89903, 'Iris', 'Cole',  'i-w3@rls.test', '+447700989903', date '1995-07-03', 'compliant'),
  (:'w4', 89904, 'Ian',  'Dunn',  'i-w4@rls.test', '+447700989904', date '1994-08-04', 'compliant');

create temp table ev (name text primary key, event_id uuid, shift_id uuid);
grant select on ev to authenticated;

create function pg_temp.event(p_name text, p_start timestamptz, p_hours numeric,
                              p_cancelled_at timestamptz default null)
returns uuid language plpgsql as $$
declare
  v_event uuid := gen_random_uuid();
  v_shift uuid := gen_random_uuid();
begin
  insert into events (id, client_id, venue_name, venue_address, venue_location, geofence_radius_m,
                      title, event_date, pays_breaks, pays_buffer, cancelled_at, po_number)
  values (v_event, 'aaaaaaaa-0000-4000-8000-000000000001', 'Invoice Venue', '1 Invoice St, London',
          st_setsrid(st_makepoint(-0.1, 51.5), 4326)::geography, 150,
          'Invoice ' || p_name, (p_start at time zone 'Europe/London')::date, true, false,
          p_cancelled_at, 'PO-' || p_name);
  insert into shift_requirements (id, event_id, role_id, starts_at, ends_at, headcount, buffer,
                                  charge_rate, pay_rate, allocation_per_hour)
  values (v_shift, v_event, '89900000-0000-4000-8000-000000000001', p_start, p_start + p_hours * interval '1 hour', 2, 0,
          22.97, 14.00, 1);
  insert into ev values (p_name, v_event, v_shift);
  return v_shift;
end $$;

create function pg_temp.booking(p_shift uuid, p_staff uuid, p_status booking_status,
                                p_in timestamptz default null, p_out timestamptz default null)
returns uuid language plpgsql as $$
declare v_booking uuid := gen_random_uuid();
begin
  insert into bookings (id, shift_id, staff_id, status, source, confirmed_at)
  values (v_booking, p_shift, p_staff, p_status, 'manual', now() - interval '30 days');
  if p_in is not null then
    insert into check_logs (booking_id, attempted_at, outcome, check_in_at, check_out_at)
    values (v_booking, p_in, 'checked_in', p_in, p_out);
  end if;
  return v_booking;
end $$;

create temp table bk (name text primary key, id uuid);
grant select on bk to authenticated;

-- E1 · Clean, Tue 12 Nov 2024 (GMT) 12:00–16:00
select pg_temp.event('Clean', '2024-11-12 12:00+00', 4);
insert into bk values
  ('e1w1', pg_temp.booking((select shift_id from ev where name = 'Clean'), :'w1', 'worked',
                           '2024-11-12 12:00+00', '2024-11-12 16:00+00')),
  ('e1w2', pg_temp.booking((select shift_id from ev where name = 'Clean'), :'w2', 'worked',
                           '2024-11-12 12:00+00', '2024-11-12 16:00+00'));

-- E2 · Held: checked in, never out, No check-out unresolved
select pg_temp.event('Held', '2024-11-13 12:00+00', 4);
insert into bk values
  ('e2w3', pg_temp.booking((select shift_id from ev where name = 'Held'), :'w3', 'worked',
                           '2024-11-13 12:00+00', null));
insert into violations (staff_id, booking_id, type)
  select :'w3', id, 'no_checkout' from bk where name = 'e2w3';

-- E3 · Open: ended an hour ago, checked out
select pg_temp.event('Open', now() - interval '5 hours', 4);
insert into bk values
  ('e3w1', pg_temp.booking((select shift_id from ev where name = 'Open'), :'w1', 'worked',
                           now() - interval '5 hours', now() - interval '1 hour'));

-- E4 · one worked, one no-show (confirmed, never checked in)
select pg_temp.event('NoShow', '2024-11-14 12:00+00', 4);
insert into bk values
  ('e4w1', pg_temp.booking((select shift_id from ev where name = 'NoShow'), :'w1', 'worked',
                           '2024-11-14 12:00+00', '2024-11-14 16:00+00')),
  ('e4w4', pg_temp.booking((select shift_id from ev where name = 'NoShow'), :'w4', 'confirmed'));
insert into violations (staff_id, booking_id, type)
  select :'w4', id, 'no_show' from bk where name = 'e4w4';

-- E5 · cancelled the day before, with a confirmed worker
select pg_temp.event('Gone', '2024-11-15 12:00+00', 4, '2024-11-14 09:00+00');
insert into bk values
  ('e5w2', pg_temp.booking((select shift_id from ev where name = 'Gone'), :'w2', 'confirmed'));

-- =====================================================================
-- 1-8 · Who may call what
-- =====================================================================
select ok(not has_function_privilege('anon', 'public.invoice_events(date,date)', 'execute'),
  'anon cannot read the invoice list');
select ok(not has_function_privilege('anon', 'public.sign_off_event_invoice(uuid,text,text)', 'execute'),
  'anon cannot sign an event off');
select ok(not has_function_privilege('authenticated', 'public.invoice_event_fingerprint(uuid)', 'execute'),
  'the fingerprint is internal');

select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok($$ select * from invoice_events('2024-11-01', '2024-11-30') $$, '42501', 'admins_only',
  'a worker cannot read the invoice list');
select is((select count(*)::int from event_invoice_signoffs), 0, 'a worker reads no sign-off');
reset role;

select set_config('request.jwt.claims', json_build_object('sub', :'clienta_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok($$ select * from invoice_event_lines((select event_id from ev where name = 'Clean')) $$,
  '42501', 'admins_only', 'a client cannot read invoice lines — the portal carries no money (§11.1)');
reset role;

select set_config('request.jwt.claims', json_build_object('sub', :'sched_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok($$ select * from invoice_events('2024-11-01', '2024-11-30') $$, '42501', 'not_permitted',
  'a scheduler holds no finance permission (ADR-0056)');
reset role;

select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok($$ select * from invoice_events('2024-01-01', '2025-06-01') $$, '22023', 'bad_range',
  'a range longer than a year is refused');

-- =====================================================================
-- 9-24 · The list
-- =====================================================================
create temp table il as
  select i.*, e.name from invoice_events('2024-11-01', '2024-11-30') i join ev e on e.event_id = i.event_id;
reset role;

select is((select count(*)::int from il where name = 'Gone'), 0,
  'an event cancelled before its day has nothing to invoice and is not listed');
select is((select status from il where name = 'Clean'), 'review', 'a clean, closed event waits for the sign-off');
select is((select invoicing from il where name = 'Clean'), 183.76::numeric, 'two 4 h shifts × £22.97 = 183.76');
select is((select payable_min from il where name = 'Clean'), 480, 'payable minutes add up');
select is((select po_number from il where name = 'Clean'), 'PO-Clean', 'the PO number carries through');
select is((select billable_shifts from il where name = 'Clean'), 2, 'both shifts are billable');
select is((select signed_off_at from il where name = 'Clean'), null, 'not yet signed off');

select is((select status from il where name = 'Held'), 'missing', 'an unresolved No check-out blocks the event');
select is((select pending from il where name = 'Held'), 1, 'the held shift is pending');
select is((select invoicing from il where name = 'Held'), 0::numeric, 'a pending shift adds no amount — never a guess');
select is((select unresolved from il where name = 'Held'), 1, 'one unresolved violation');

select is((select status from il where name = 'NoShow'), 'review',
  'an unresolved No-show does not block — the manager reviews it at the sign-off');
select is((select invoicing from il where name = 'NoShow'), 91.88::numeric, 'only the worked shift is invoiced');
select is((select no_shows from il where name = 'NoShow'), 1, 'the no-show is counted');
select is((select billable_shifts from il where name = 'NoShow'), 1, 'the no-show is not billable');

select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select status from invoice_events(current_date - 1, current_date + 1) i
            where i.event_id = (select event_id from ev where name = 'Open')), 'open',
  'an event inside its 4 h check-out window is still open');

-- =====================================================================
-- 25-31 · Lines and violations
-- =====================================================================
select is((select count(*)::int from invoice_event_lines((select event_id from ev where name = 'NoShow'))), 2,
  'the event''s lines include the no-show');
select is((select invoicing from invoice_event_lines((select event_id from ev where name = 'NoShow'))
            where kind = 'no_show'), 0::numeric, 'a no-show line is invoiced at nothing');
select is((select charge_rate from invoice_event_lines((select event_id from ev where name = 'Clean')) limit 1),
  22.97::numeric, 'each line carries the charge rate');
select is((select payable_min from invoice_event_lines((select event_id from ev where name = 'Held'))), null::int,
  'a pending line has no payable minutes');
select is((select count(*)::int from invoice_event_violations((select event_id from ev where name = 'NoShow'))), 1,
  'the no-show is in the review list');
select is((select type from invoice_event_violations((select event_id from ev where name = 'NoShow'))), 'no_show',
  'with its type');
select is((select resolved from invoice_event_violations((select event_id from ev where name = 'NoShow'))), false,
  'and unresolved');

-- =====================================================================
-- 32-38 · The sign-off refuses
-- =====================================================================
select throws_ok(
  format($$ select sign_off_event_invoice(%L, '  ', %L) $$,
         (select event_id from ev where name = 'Clean'), (select fingerprint from il where name = 'Clean')),
  'P0001', 'note_required', 'the note is mandatory');
select throws_ok(
  format($$ select sign_off_event_invoice(%L, 'checked', %L) $$,
         (select event_id from ev where name = 'Held'), (select fingerprint from il where name = 'Held')),
  'P0001', 'check_out_missing', 'an event with an unresolved No check-out cannot be signed off');
select throws_ok(
  format($$ select sign_off_event_invoice(%L, 'checked', 'x') $$, (select event_id from ev where name = 'Open')),
  'P0001', 'check_out_open', 'an event inside its check-out window cannot be signed off');
select throws_ok(
  format($$ select sign_off_event_invoice(%L, 'checked', 'stale') $$, (select event_id from ev where name = 'Clean')),
  'P0001', 'changed_since_viewed', 'a sign-off for figures the manager did not see is refused');
select throws_ok(
  format($$ select sign_off_event_invoice(%L, 'checked', 'x') $$, (select event_id from ev where name = 'Gone')),
  'P0001', 'nothing_to_invoice', 'an event with no lines cannot be signed off');
reset role;

select set_config('request.jwt.claims', json_build_object('sub', :'viewer_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select count(*)::int from invoice_events('2024-11-01', '2024-11-30') i
            where i.event_id in (select event_id from ev)), 3, 'a viewer can read the list');
select throws_ok(
  format($$ select sign_off_event_invoice(%L, 'checked', %L) $$,
         (select event_id from ev where name = 'Clean'), (select fingerprint from il where name = 'Clean')),
  '42501', 'not_permitted', 'a viewer cannot sign off (ADR-0060)');
reset role;

-- =====================================================================
-- 39-49 · Signed off, exported, then stale
-- =====================================================================
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is(
  (sign_off_event_invoice((select event_id from ev where name = 'Clean'), ' All checked out, nothing to review ',
                          (select fingerprint from il where name = 'Clean')) ->> 'decision'),
  'signed_off', 'a closed, settled event is signed off');
select is((select status from invoice_events('2024-11-12', '2024-11-12') i
            where i.event_id = (select event_id from ev where name = 'Clean')), 'ready', 'and is ready to invoice');
select is((select signoff_note from invoice_events('2024-11-12', '2024-11-12') i
            where i.event_id = (select event_id from ev where name = 'Clean')), 'All checked out, nothing to review',
  'the note is kept, trimmed');
select is((select count(*)::int from event_invoice_signoffs where event_id = (select event_id from ev where name = 'Clean')), 1,
  'a finance admin reads the sign-off');
reset role;

select is((select count(*)::int from audit_log where action = 'invoice.signed_off'
            and entity_id = (select event_id from ev where name = 'Clean')), 1, 'the sign-off is audited');

select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select count(*)::int from invoice_export_rows('2024-11-01', '2024-11-30') x
            where x.event_id in (select event_id from ev)), 2,
  'the export carries the ready event''s two shifts and nothing from the events that are not ready');
select is((select sum(invoicing) from invoice_export_rows('2024-11-01', '2024-11-30') x
            where x.event_id in (select event_id from ev)), 183.76::numeric, 'for the signed-off amount');
select is((select count(*)::int from invoice_export_rows('2024-11-14', '2024-11-14',
            (select event_id from ev where name = 'NoShow'))), 0, 'an event awaiting review exports nothing');
reset role;

-- A Late raised after the sign-off — something changed.
insert into violations (staff_id, booking_id, type, minutes_late)
  select :'w1', id, 'late', 5 from bk where name = 'e1w1';

select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select status from invoice_events('2024-11-12', '2024-11-12') i
            where i.event_id = (select event_id from ev where name = 'Clean')), 'review',
  'a violation raised after the sign-off sends the event back to review');
select is((select count(*)::int from invoice_export_rows('2024-11-12', '2024-11-12')), 0,
  'and its lines leave the export until it is signed off again');
select is((select signoff_stale from invoice_events('2024-11-12', '2024-11-12') i
            where i.event_id = (select event_id from ev where name = 'Clean')), true, 'and says the sign-off is stale');
reset role;

select * from finish();
rollback;
