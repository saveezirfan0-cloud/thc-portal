-- =====================================================================
-- 270 · The client card (§9.7) — rate card, qualified pool, events
--                                — 20260922095200_client_card.sql
--
-- The four things here that are decisions rather than lookups:
--
--   · The margin is of the CHARGE. It is the share of what the client
--     pays that THC keeps; dividing by the pay gives a bigger, flattering
--     number that means nothing.
--   · The event window is DERIVED (§3.2): min start to max end across the
--     role sections. Role sections at different times are why RULE-18
--     exists, and this list is one of the few places the event window is
--     the right answer.
--   · A cancelled event keeps its row and loses its margin — null, not
--     zero, because zero drags an average down with money nobody ever
--     expected.
--   · A worker barred at a client is barred across every role there, so
--     the aggregated row says so rather than showing a mixture.
-- =====================================================================
begin;
select plan(39);
\ir _shared/fixtures.psql

\set role_b     'bbbbbbbb-0000-4000-8000-00000000000b'
\set card_b     'cccccccc-0000-4000-8000-00000000000b'
\set cancelled  'eeeeeeee-0000-4000-8000-00000000000c'
\set cshift     'ffffffff-0000-4000-8000-00000000000c'
\set late_shift 'ffffffff-0000-4000-8000-00000000000d'

insert into roles (id, name, description, pay_rate) values
  (:'role_b', 'Card Fixture Role B', 'internal only', 16.00);

-- =====================================================================
-- Block 2 · the rate card
-- =====================================================================
select has_view('clients_rate_card_v', 'the rate card is a view, not a join in the screen');

-- The naming rule, asserted directly rather than left to be discovered by
-- tripping 050's money guard. The singular `client_` prefix belongs to the
-- Client Portal (ADR-0004); a Back Office view that takes it is one rename
-- away from putting a charge rate on the customer's screen, and a view
-- with no money column would take the prefix without 050 noticing at all.
select is((select count(*)::int from pg_views
            where schemaname = 'public'
              and viewname in ('client_rate_card_v', 'client_qualified_staff_v',
                               'client_events_list_v')), 0,
  'the client card''s views are `clients_`, plural — the singular prefix is the Client Portal''s and 050 forbids money on it (§11.1)');

-- The fixture card is charge 22.97 against base 14.00.
select is((select base_pay_rate from clients_rate_card_v where id = :'ratecard_a'), 14.00,
  'base pay comes from the Roles catalogue, never from the client (§9.8)');
select is((select final_pay_rate from clients_rate_card_v where id = :'ratecard_a'),
  final_rate(14.00),
  'final pay is final_rate()''s answer — the one definition of the 12.07% (§9.8)');
select is((select margin_per_hour from clients_rate_card_v where id = :'ratecard_a'),
  22.97 - final_rate(14.00),
  'the margin per hour is charge minus FINAL pay, so holiday is inside the cost, not outside it');
select is((select margin_pct from clients_rate_card_v where id = :'ratecard_a'),
  round((1 - final_rate(14.00) / 22.97) * 100, 1),
  'and the percentage is of the CHARGE — the share of what the client pays that THC keeps');
select is((select dress_codes from clients_rate_card_v where id = :'ratecard_a'),
  array['Black tie'],
  'the dress codes are the client''s, and this is the only place they live (§9.7)');

-- Writes.
select throws_ok($$ select add_client_role('aaaaaaaa-0000-4000-8000-000000000001',
                                           '00000000-0000-4000-8000-00000000dead', 20.00) $$,
  'P0001', null,
  'a role that is not in the catalogue is refused, not created — §9.7 sends the manager to Roles first (§9.8)');

select throws_ok($$ select add_client_role('aaaaaaaa-0000-4000-8000-000000000001',
                                           'bbbbbbbb-0000-4000-8000-00000000000b', 22.975) $$,
  '23514', null,
  'a third decimal is rejected, not rounded — numeric(8,2) would turn £22.975 into £22.98 and never say so, and every margin here is derived from it');

select throws_ok($$ select add_client_role('aaaaaaaa-0000-4000-8000-000000000001',
                                           'bbbbbbbb-0000-4000-8000-00000000000b', -1) $$,
  '23514', null,
  'and a negative charge rate is refused');

select isnt(add_client_role(:'clienta', :'role_b', 24.50, array['Chef whites']), null,
  'a role from the catalogue is added with its rate and dress codes');
select is((select charge_rate from clients_rate_card_v
            where client_id = :'clienta' and role_id = :'role_b'), 24.50,
  'at the rate given');

select lives_ok($$ select add_client_role('aaaaaaaa-0000-4000-8000-000000000001',
                                          'bbbbbbbb-0000-4000-8000-00000000000b',
                                          25.00, array['Kitchen blacks']) $$,
  'adding the same role again updates it rather than failing on the unique constraint');
select is((select charge_rate from clients_rate_card_v
            where client_id = :'clienta' and role_id = :'role_b'), 25.00,
  'with the new rate');

select is(update_client_role(
            (select id from client_rate_cards where client_id = :'clienta' and role_id = :'role_b'),
            26.00, array['Chef whites', 'Kitchen blacks']) ->> 'id' is not null, true,
  'the rate and the dress-code list are edited together');
select is((select array_length(dress_codes, 1) from clients_rate_card_v
            where client_id = :'clienta' and role_id = :'role_b'), 2,
  'and the list is replaced wholesale — it is built by adding and removing chips, not appended to blindly');

-- Removing a role does not reach into an event already built.
insert into shift_requirements (id, event_id, role_id, starts_at, ends_at, headcount, buffer,
                                charge_rate, pay_rate, dress_code, allocation_per_hour) values
  (:'late_shift', :'event_a', :'role_b', now() + interval '9 days',
   now() + interval '9 days 6 hours', 3, 0, 26.00, 16.00, 'Chef whites', 3);

select is((select section_count from clients_rate_card_v
            where client_id = :'clienta' and role_id = :'role_b'), 1,
  'the card says how many built sections use the role, so a manager can see what an edit will NOT change');

select lives_ok($$ select remove_client_role(
                     (select id from client_rate_cards
                       where client_id = 'aaaaaaaa-0000-4000-8000-000000000001'
                         and role_id = 'bbbbbbbb-0000-4000-8000-00000000000b')) $$,
  'a role can be removed from the rate card even where events already use it');
select is((select charge_rate from shift_requirements where id = :'late_shift'), 26.00,
  'and the built event keeps the rate it was built with — shift_requirements snapshots it (§3.2), so every historical margin stays correct');

-- §9.7 forbids deleting a client. 240 asserts delete_client does not
-- exist; this is the neighbouring mistake — a rate card row is not a
-- client, and removing one must not be mistaken for removing the other.
select is((select count(*)::int from clients where id = :'clienta'), 1,
  'removing a role from a rate card leaves the client itself untouched — a client record is only ever edited (§9.7)');

-- =====================================================================
-- Block 3 · the qualified pool
-- =====================================================================
insert into staff_roles (staff_id, role_id) values (:'staffa', :'role_b');
select grant_client_qualification(:'staffa', :'clienta', :'role_b', 'Also does the kitchen');

select is((select array_length(role_names, 1) from clients_qualified_staff_v
            where client_id = :'clienta' and staff_id = :'staffa'), 2,
  'one row per WORKER carrying every role they hold here — §9.7 puts "role(s) at this client" on one line');

select is((select do_not_return from clients_qualified_staff_v
            where client_id = :'clienta' and staff_id = :'staffa'), false,
  'not barred to begin with');

select set_do_not_return((select id from client_qualifications
                           where staff_id = :'staffa' and client_id = :'clienta'
                             and role_id = :'role_id'),
                         true, 'Client complaint');
select is((select do_not_return from clients_qualified_staff_v
            where client_id = :'clienta' and staff_id = :'staffa'), true,
  'barring through ONE role bars the worker across the whole row — the auto-assign gate is client-wide, and a mixed row would read as half a bar');

-- §1.7 reaches this list too. Inside a savepoint: §2.12 (20260926110800)
-- has no removed → compliant edge, so "putting them back" is a rollback,
-- with the answer captured by \gset and asserted afterwards.
savepoint removed_staffa;
update staff set removed_at = now(), status = 'removed' where id = :'staffa';
select display_name as removed_name from clients_qualified_staff_v
 where client_id = :'clienta' and staff_id = :'staffa' \gset
rollback to savepoint removed_staffa;
select is(:'removed_name', deleted_account_label(90001),
  'a removed worker who is still cleared reads as the anonymised label here as well — the view goes through staff_directory_v rather than the table (§1.7)');

-- =====================================================================
-- Block 4 · the client's events
-- =====================================================================
select is((select starts_at from clients_event_list_v where id = :'event_a'),
  (select min(starts_at) from shift_requirements where event_id = :'event_a'),
  'the date column is the DERIVED window, min start across the role sections (§3.2)');
select is((select ends_at from clients_event_list_v where id = :'event_a'),
  (select max(ends_at) from shift_requirements where event_id = :'event_a'),
  'to max end — and with two sections at different times, that is the only honest single answer');

select is((select margin_gbp from clients_event_list_v where id = :'event_a'),
  (select round(sum((s.charge_rate - final_rate(s.pay_rate)) * s.headcount
                    * extract(epoch from (s.ends_at - s.starts_at)) / 3600), 2)
     from shift_requirements s where s.event_id = :'event_a'),
  'the margin is what the event was built to earn: headcount x hours x (charge - final)');

insert into events (id, client_id, venue_id, venue_name, venue_address, venue_location,
                    geofence_radius_m, title, event_date, pays_breaks, pays_buffer, cancelled_at) values
  (:'cancelled', :'clienta', :'venue_id', 'RLS Fixture Venue', '1 Test Street, London',
   st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150,
   'Card Fixture Cancelled', current_date + 5, true, true, now());
insert into shift_requirements (id, event_id, role_id, starts_at, ends_at, headcount, buffer,
                                charge_rate, pay_rate, allocation_per_hour) values
  (:'cshift', :'cancelled', :'role_id', now() + interval '5 days',
   now() + interval '5 days 6 hours', 4, 0, 22.97, 14.00, 4);

select is((select count(*)::int from clients_event_list_v where id = :'cancelled'), 1,
  'a cancelled event keeps its row — the manager still needs to see it');
select is((select margin_gbp from clients_event_list_v where id = :'cancelled'), null,
  'but has no margin: NULL, not zero, because zero drags an average down with money nobody ever expected');
select is((select status::text from clients_event_list_v where id = :'cancelled'), 'cancelled',
  'and is labelled as cancelled rather than derived from the clock');

-- =====================================================================
-- Who reads the three clients_* views (§9.7, §11.1)
--
-- Everything above ran as the table owner. The office reads with the
-- manager's own session (role `authenticated`), and until 20260926110700
-- clients_event_list_v failed for every admin: security_invoker over
-- event_windows, which 0009 revoked from the PostgREST roles — so §9.7's
-- fourth block never rendered. A customer and a worker read nothing:
-- the rate card carries charge_rate and margin.
-- =====================================================================
reset role;
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select count(*)::int from clients_event_list_v where id = :'event_a'), 1,
  '§9.7 block 4: an admin session reads the client''s events (the window is derived inline, not read from the revoked event_windows)');
select ok((select count(*) from clients_rate_card_v where client_id = :'clienta') >= 1,
  'and the rate card');
select ok((select count(*) from clients_qualified_staff_v where client_id = :'clienta') >= 1,
  'and the qualified pool');
reset role;

select set_config('request.jwt.claims', json_build_object('sub', :'clienta_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select count(*)::int from clients_rate_card_v), 0, '§11.1 a client reads no rate card — charge rates and margin');
select is((select count(*)::int from clients_qualified_staff_v), 0, 'nor the qualified pool — worker personal data');
select is((select count(*)::int from clients_event_list_v), 0, 'nor the office''s event list with its margin; its own events come from client_events_v');
reset role;

select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select count(*)::int from clients_rate_card_v), 0, 'a worker reads no rate card');
select is((select count(*)::int from clients_qualified_staff_v), 0, 'nor the pool, not even their own clearance row');
select is((select count(*)::int from clients_event_list_v), 0, 'nor the client''s event list');
reset role;

select * from finish();
rollback;
