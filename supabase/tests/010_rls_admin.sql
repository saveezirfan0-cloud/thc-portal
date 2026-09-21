-- =====================================================================
-- 010 · RLS for the admin role (Back Office) — §1.4, §9.x
-- Both directions for every RLS-enabled table: what admin may reach, and
-- the two tables admin is locked out of today.
-- =====================================================================
begin;
select plan(36);
\ir _shared/fixtures.psql

select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;

-- ---- reads -----------------------------------------------------------
select is((select count(*)::int from staff                  where id in (:'staffa', :'staffb')),     2, 'admin reads every staff row');
select is((select count(*)::int from events                 where id in (:'event_a', :'event_b')),   2, 'admin reads every client''s events');
select is((select count(*)::int from shift_requirements     where id in (:'shift_a', :'shift_b')),   2, 'admin reads every role section');
select is((select count(*)::int from bookings               where id in (:'booking_a', :'booking_b')), 2, 'admin reads every booking');
select is((select count(*)::int from compliance_docs        where id in (:'doc_a', :'doc_b')),       2, 'admin reads every compliance doc');
select is((select count(*)::int from criminal_declarations  where id in (:'decl_a', :'decl_b')),     2, 'admin reads every criminal declaration');
select is((select count(*)::int from check_logs             where id in (:'checklog_a', :'checklog_b')), 2, 'admin reads every check log');
select is((select count(*)::int from breaks                 where id in (:'break_a', :'break_b')),   2, 'admin reads every break');
select is((select count(*)::int from violations             where id in (:'violation_a', :'violation_b')), 2, 'admin reads every violation');
select is((select count(*)::int from feedback               where id in (:'feedback_a', :'feedback_b')), 2, 'admin reads every feedback row');
select is((select count(*)::int from clients                where id in (:'clienta', :'clientb')),   2, 'admin reads every client');
select is((select count(*)::int from venues                 where id = :'venue_id'),                 1, 'admin reads venues');
select is((select count(*)::int from roles                  where id = :'role_id'),                  1, 'admin reads roles (incl. pay_rate)');
select is((select count(*)::int from client_rate_cards      where id = :'ratecard_a'),               1, 'admin reads charge rates');
select is((select count(*)::int from settings               where key = 'rls_fixture_probe'),        1, 'admin reads settings');

-- admin sees money, which is the whole point of the Back Office (§9.8, §9.9)
select is((select charge_rate from shift_requirements where id = :'shift_a'), 22.97::numeric, 'admin sees charge_rate on a role section');
select is((select pay_rate    from shift_requirements where id = :'shift_a'), 14.00::numeric, 'admin sees pay_rate on a role section');

-- ---- reads that are blocked today (documented gaps) --------------------
select is((select count(*)::int from profiles where id in (:'staffa_uid', :'clienta_uid')), 0,
  'KNOWN GAP: profiles has only profiles_self, so admin cannot read other users'' profiles');
select is((select count(*)::int from profiles where id = :'admin_uid'), 1,
  'admin still reads its own profile row');
select is((select count(*)::int from notification_outbox where key = 'RLS:fixture:outbox'), 0,
  'KNOWN GAP: notification_outbox is deny-all, admin cannot read the send queue');

-- ---- writes ----------------------------------------------------------
with u as (update staff set rating = 4.50 where id = :'staffa' returning 1) select is((select count(*)::int from u), 1, 'admin writes staff');
with u as (update events set notes = 'edited' where id = :'event_a' returning 1) select is((select count(*)::int from u), 1, 'admin writes events');
with u as (update shift_requirements set headcount = 7 where id = :'shift_a' returning 1) select is((select count(*)::int from u), 1, 'admin writes role sections');
with u as (update bookings set status = 'worked' where id = :'booking_a' returning 1) select is((select count(*)::int from u), 1, 'admin writes bookings');
with u as (update compliance_docs set review_status = 'rejected' where id = :'doc_a' returning 1) select is((select count(*)::int from u), 1, 'admin writes compliance docs');
with u as (update criminal_declarations set review_status = 'verified' where id = :'decl_a' returning 1) select is((select count(*)::int from u), 1, 'admin writes criminal declarations');
with u as (update check_logs set on_site_verified = true where id = :'checklog_a' returning 1) select is((select count(*)::int from u), 1, 'admin writes check logs');
with u as (update breaks set ended_at = now() where id = :'break_a' returning 1) select is((select count(*)::int from u), 1, 'admin writes breaks');
with u as (update violations set resolved = true where id = :'violation_a' returning 1) select is((select count(*)::int from u), 1, 'admin resolves violations');
with u as (update feedback set read_at = now() where id = :'feedback_a' returning 1) select is((select count(*)::int from u), 1, 'admin marks feedback read');
with u as (update clients set pays_breaks = false where id = :'clienta' returning 1) select is((select count(*)::int from u), 1, 'admin writes clients');
with u as (update venues set geofence_radius_m = 200 where id = :'venue_id' returning 1) select is((select count(*)::int from u), 1, 'admin writes venues');
with u as (update roles set pay_rate = 15.00 where id = :'role_id' returning 1) select is((select count(*)::int from u), 1, 'admin writes roles');
with u as (update client_rate_cards set charge_rate = 24.00 where id = :'ratecard_a' returning 1) select is((select count(*)::int from u), 1, 'admin writes rate cards');
with u as (update settings set value = '{"secret":false}' where key = 'rls_fixture_probe' returning 1) select is((select count(*)::int from u), 1, 'admin writes settings');

select throws_ok(
  $$ insert into notification_outbox (key, channel, template) values ('RLS:denied:outbox','push','N1') $$,
  '42501', null,
  'KNOWN GAP: admin cannot enqueue a notification directly (deny-all); only service_role can'
);

reset role;
select * from finish();
rollback;
