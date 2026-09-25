-- =====================================================================
-- 280 · Clients directory (§9.7) — 20260922091447_clients_directory.sql
--
-- The margin is the thing worth pinning. §9.7 defines it in one line —
-- "(charge − final pay) ÷ charge across completed events, after holiday
-- pay" — and every screen that quotes a margin quotes this number, so the
-- three decisions the definition leaves open (holiday included, weighted
-- by headcount and hours, read from the event as built) are asserted
-- against figures worked out by hand below.
--
-- The other half is §9.7's absolutes: every field mandatory, and no
-- delete function anywhere.
-- =====================================================================
begin;
select plan(28);
\ir _shared/fixtures.psql

\set past_event '9c9c9c9c-0000-4000-8000-000000000001'
\set past_shift '9c9c9c9c-0000-4000-8000-000000000002'

-- A delivered event for client A, with figures that make the weighting
-- visible: 10 people for 5 hours at £30.00 charge against £20.00 base.
--   final pay  = round(20.00 * 1.1207, 2) = 22.41
--   weight     = 10 * 5 = 50 hours of labour
--   charge     = 30.00 * 50 = 1500.00
--   pay        = 22.41 * 50 = 1120.50
--   margin     = 1 - 1120.50/1500.00 = 0.253  → 25.3%
insert into events (id, client_id, venue_id, venue_name, venue_address, venue_location,
                    geofence_radius_m, title, event_date, pays_breaks, pays_buffer) values
  (:'past_event', :'clienta', :'venue_id', 'RLS Fixture Venue', '1 Test Street, London',
   st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150,
   'Fixture Delivered Event', current_date - 14, true, true);

insert into shift_requirements (id, event_id, role_id, starts_at, ends_at, headcount, buffer,
                                charge_rate, pay_rate, dress_code, allocation_per_hour) values
  (:'past_shift', :'past_event', :'role_id',
   now() - interval '14 days', now() - interval '14 days' + interval '5 hours',
   10, 0, 30.00, 20.00, 'Black tie', 10);

-- ---- structure --------------------------------------------------------
select ok((select 'security_invoker=true' = any(reloptions) from pg_class where relname = 'clients_directory_v'),
  'clients_directory_v is security_invoker');
select ok((select 'security_invoker=true' = any(reloptions) from pg_class where relname = 'clients_margins_v'),
  'clients_margins_v is security_invoker');

-- §9.7: "there is no Delete action; a client record cannot be removed from
-- the system, only edited". The absence is the requirement, so it is asserted.
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'delete_client'),
  0,
  'there is no delete_client: a client record can be edited but never removed (§9.7)');

-- ---- admin ------------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;

select is((select count(*)::int from clients_directory_v where id = :'clienta'), 1,
  'admin reads the client through clients_directory_v');
select is((select name from clients_directory_v where id = :'clienta'), 'RLS Fixture Client A',
  'the row carries the client name');
select is((select rate_card_roles from clients_directory_v where id = :'clienta'),
  array['RLS Fixture Role'],
  'the rate-card roles come back as names, which is what the directory prints as chips');
select is((select rate_card_count from clients_directory_v where id = :'clienta'), 1,
  'and the count beside them');
select is((select count(*)::int from clients_directory_v where id = :'clientb' and rate_card_roles = '{}'), 1,
  'a client with an empty rate card gets an empty array, never null');

-- ---- the margin -------------------------------------------------------
select is((select completed_events from clients_margins_v where client_id = :'clienta'), 1,
  'only the delivered event counts towards the margin');
select is((select charge_total from clients_margins_v where client_id = :'clienta'), 1500.00::numeric,
  'charge is weighted by headcount and section hours: £30.00 x 10 x 5h');
select is((select pay_total from clients_margins_v where client_id = :'clienta'), 1120.50::numeric,
  'and pay is the FINAL rate — base plus the 12.07% holiday element (§9.8)');
select is((select avg_margin_pct from clients_directory_v where id = :'clienta'), 25.3::numeric,
  'so the margin is 25.3%, not the 33.3% a base-rate calculation would show');
select is((select avg_margin_pct from clients_directory_v where id = :'clientb'), null,
  'a client with nothing delivered has no margin — null, never 0%');

-- An event still to come is not a margin, and neither is a cancelled one.
-- The fixture moves a started event's date, which §3.2's edit lock
-- (20260926131100) refuses to a manager's session: the moves run as the
-- owner and the reads as the admin.
reset role;
update events set event_date = current_date + 7 where id = :'past_event';
set local role authenticated;
select is((select avg_margin_pct from clients_directory_v where id = :'clienta'), null,
  'an event that has not happened yet is not in the margin');
reset role;
update events set event_date = current_date - 14, cancelled_at = now() where id = :'past_event';
set local role authenticated;
select is((select avg_margin_pct from clients_directory_v where id = :'clienta'), null,
  'nor is a cancelled one');
reset role;
update events set cancelled_at = null where id = :'past_event';
set local role authenticated;

select is((select event_count from clients_directory_v where id = :'clienta'), 2,
  'the Events column counts every event that was not cancelled');

-- ---- writes -----------------------------------------------------------
select lives_ok(
  $$ select create_client('  Claridge''s  ', '  Helena Ashworth  ', ' +44 20 7629 8860 ',
                          '  Banqueting office, staff entrance  ',
                          array['  h.ashworth@claridges.example  ', 'banqueting@claridges.example'],
                          false, true) $$,
  'admin creates a client');
select is((select name from clients where contact_name = 'Helena Ashworth'), 'Claridge''s',
  'create_client trims the name');
select is((select contact_emails[1] from clients where contact_name = 'Helena Ashworth'),
  'h.ashworth@claridges.example',
  'and every address, so the allocation sheet does not bounce on a stray space (§11.4)');

-- Every field on the form is mandatory (§9.7).
select throws_ok(
  $$ select create_client('  ', 'A', '1', 'P', array['a@b.co'], true, true) $$,
  '23514', null, 'a client cannot be created without a name');
select throws_ok(
  $$ select create_client('N', 'A', '1', '   ', array['a@b.co'], true, true) $$,
  '23514', null, 'nor without a staff contact point — it pre-fills every event (§3.2)');
select throws_ok(
  $$ select create_client('N', 'A', '1', 'P', '{}'::text[], true, true) $$,
  '23514', null, 'nor with no contact email: the allocation sheet has nowhere to go');
select throws_ok(
  $$ select create_client('N', 'A', '1', 'P', array['not-an-address'], true, true) $$,
  '23514', null, 'nor with an address that is not one');
select throws_ok(
  $$ select create_client('N', 'A', '1', 'P', array['a@b.co'], null, true) $$,
  '23514', null, 'neither policy has a "not set" state (§9.7)');

select lives_ok(
  $$ select update_client('aaaaaaaa-0000-4000-8000-000000000001', 'Renamed Client', 'Ada A',
                          '+447700900001', 'Front desk', array['clienta@rls.test'], false, false) $$,
  'admin edits a client at any time (§9.7)');
select is((select pays_breaks from clients where id = :'clienta'), false,
  'the break policy is stored');

-- ---- client and worker ------------------------------------------------
-- client_rate_cards carries charge_rate, so this view is money (§11.1).
reset role;
select set_config('request.jwt.claims', json_build_object('sub', :'clienta_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select count(*)::int from clients_directory_v), 0,
  'a client reads nothing through clients_directory_v — not even their own row (§11.1)');

reset role;
select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select count(*)::int from clients_directory_v), 0,
  'a worker reads nothing through it either');

reset role;
select * from finish();
rollback;
