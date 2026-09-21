-- =====================================================================
-- 010 · RLS for the admin role (Back Office) — §1.4, §9.x
-- Both directions for every RLS-enabled table: what admin may reach, and
-- the two tables admin is locked out of today. Since 0004_rls_gaps this
-- also covers the eleven previously unpoliced tables, including the two
-- that are admin-READ and service-role-write (audit_log, report_sends).
-- =====================================================================
begin;
select plan(62);
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

-- ---- the tables 0004_rls_gaps policed ---------------------------------
select is((select count(*)::int from bank_details          where staff_id in (:'staffa', :'staffb')), 2, 'admin reads every worker''s bank details (payroll)');
select is((select count(*)::int from hmrc_checklists       where staff_id in (:'staffa', :'staffb')), 2, 'admin reads every HMRC checklist (§2.8 New Starter report)');
select is((select count(*)::int from staff_references      where id in (:'ref_a', :'ref_b')),         2, 'admin reads every worker''s referees');
select is((select count(*)::int from staff_roles           where staff_id in (:'staffa', :'staffb')), 2, 'admin reads role qualifications');
select is((select count(*)::int from client_qualifications where id in (:'qual_a', :'qual_b')),       2, 'admin reads client+role clearances (§9.6)');
select is((select count(*)::int from quiz_attempts         where id in (:'quiz_a', :'quiz_b')),       2, 'admin reads quiz attempts');
select is((select count(*)::int from push_subscriptions    where id in (:'push_a', :'push_b')),       2, 'admin reads push subscriptions');
select is((select count(*)::int from location_pings        where booking_id in (:'booking_a', :'booking_b')), 2, 'admin reads location pings');
select is((select count(*)::int from audit_log             where action = 'rls_fixture_probe'),       1, 'admin reads the audit log (§1.7)');
select is((select count(*)::int from report_sends          where error  = 'rls_fixture_probe'),       1, 'admin reads the report send log (§9.9)');
select is((select count(*)::int from venue_types           where key = 'rls_fixture_type'),           1, 'admin reads venue type defaults (§9.11)');

-- admin sees the derived HMRC statement the worker is never shown (§2.8)
select is((select statement::text from hmrc_checklists where staff_id = :'staffa'), 'A',
  'admin sees the derived A/B/C statement, which §2.8 keeps from the worker');

-- ---- reads that are blocked today (documented gaps) --------------------
select is((select count(*)::int from profiles where id in (:'staffa_uid', :'clienta_uid')), 0,
  'KNOWN GAP: profiles has only profiles_self, so admin cannot read other users'' profiles');
select is((select count(*)::int from profiles where id = :'admin_uid'), 1,
  'admin still reads its own profile row');
select is((select count(*)::int from notification_outbox where key = 'RLS:fixture:outbox'), 0,
  'KNOWN GAP: notification_outbox is deny-all, admin cannot read the send queue');

-- ---- writes ----------------------------------------------------------
with u as (update staff set rating = 4.50 where id = :'staffa' returning 1)
  select is((select count(*)::int from u), 1, 'admin writes staff');
with u as (update events set notes = 'edited' where id = :'event_a' returning 1)
  select is((select count(*)::int from u), 1, 'admin writes events');
with u as (update shift_requirements set headcount = 7 where id = :'shift_a' returning 1)
  select is((select count(*)::int from u), 1, 'admin writes role sections');
with u as (update bookings set status = 'worked' where id = :'booking_a' returning 1)
  select is((select count(*)::int from u), 1, 'admin writes bookings');
with u as (update compliance_docs set review_status = 'rejected' where id = :'doc_a' returning 1)
  select is((select count(*)::int from u), 1, 'admin writes compliance docs');
with u as (update criminal_declarations set review_status = 'verified' where id = :'decl_a' returning 1)
  select is((select count(*)::int from u), 1, 'admin writes criminal declarations');
with u as (update check_logs set on_site_verified = true where id = :'checklog_a' returning 1)
  select is((select count(*)::int from u), 1, 'admin writes check logs');
with u as (update breaks set ended_at = now() where id = :'break_a' returning 1)
  select is((select count(*)::int from u), 1, 'admin writes breaks');
with u as (update violations set resolved = true where id = :'violation_a' returning 1)
  select is((select count(*)::int from u), 1, 'admin resolves violations');
with u as (update feedback set read_at = now() where id = :'feedback_a' returning 1)
  select is((select count(*)::int from u), 1, 'admin marks feedback read');
with u as (update clients set pays_breaks = false where id = :'clienta' returning 1)
  select is((select count(*)::int from u), 1, 'admin writes clients');
with u as (update venues set geofence_radius_m = 200 where id = :'venue_id' returning 1)
  select is((select count(*)::int from u), 1, 'admin writes venues');
with u as (update roles set pay_rate = 15.00 where id = :'role_id' returning 1)
  select is((select count(*)::int from u), 1, 'admin writes roles');
with u as (update client_rate_cards set charge_rate = 24.00 where id = :'ratecard_a' returning 1)
  select is((select count(*)::int from u), 1, 'admin writes rate cards');
with u as (update settings set value = '{"secret":false}' where key = 'rls_fixture_probe' returning 1)
  select is((select count(*)::int from u), 1, 'admin writes settings');

-- ---- writes on the tables 0004_rls_gaps policed -----------------------
with u as (update bank_details set sort_code = '99-99-99' where staff_id = :'staffa' returning 1)
  select is((select count(*)::int from u), 1, 'admin writes bank details');
with u as (update hmrc_checklists set superseded = true where staff_id = :'staffa' returning 1)
  select is((select count(*)::int from u), 1, 'admin supersedes an HMRC checklist');
with u as (update staff_references set phone = '+447700900031' where id = :'ref_a' returning 1)
  select is((select count(*)::int from u), 1, 'admin writes staff references');
with u as (delete from staff_roles where staff_id = :'staffb' returning 1)
  select is((select count(*)::int from u), 1, 'admin revokes a role qualification');
with u as (update client_qualifications set do_not_return = true where id = :'qual_a' returning 1)
  select is((select count(*)::int from u), 1, 'admin sets do-not-return on a clearance (§9.6)');
with u as (update quiz_attempts set score = 100.00 where id = :'quiz_a' returning 1)
  select is((select count(*)::int from u), 1, 'admin writes quiz attempts');
with u as (update push_subscriptions set user_agent = 'admin-edited' where id = :'push_a' returning 1)
  select is((select count(*)::int from u), 1, 'admin writes push subscriptions');
with u as (update venue_types set default_radius_m = 300 where key = 'rls_fixture_type' returning 1)
  select is((select count(*)::int from u), 1, 'admin writes venue type defaults');

-- ---- the three evidence tables are admin-READ, service-role-write ------
-- location_pings joined these in 0006: inside_geofence decides the last
-- on-site fix behind RULE-01 pay, so an admin who could edit it could move
-- a worker's money with no record (§5.2b, §1.7).
with u as (update location_pings set inside_geofence = false where booking_id = :'booking_a' returning 1)
  select is((select count(*)::int from u), 0, 'admin cannot rewrite the location trail (§5.2b evidence behind RULE-01 pay)');
select throws_ok(
  format($$ insert into location_pings (booking_id, location, inside_geofence)
            values (%L, st_setsrid(st_makepoint(-0.1, 51.5), 4326)::geography, true) $$, :'booking_a'),
  '42501', null, 'admin cannot forge a location ping; only the record_location_ping definer RPC writes one');

with u as (update audit_log set action = 'tampered' where action = 'rls_fixture_probe' returning 1)
  select is((select count(*)::int from u), 0, 'admin cannot rewrite the audit log (§1.7 append-only)');
select throws_ok(
  $$ insert into audit_log (action, entity) values ('forged','staff') $$,
  '42501', null, 'admin cannot forge an audit_log row; only definer functions and service_role write it');
with u as (update report_sends set status = 'sent' where error = 'rls_fixture_probe' returning 1)
  select is((select count(*)::int from u), 0, 'admin cannot rewrite a report send record (§9.9)');
select throws_ok(
  $$ insert into report_sends (kind, period_start, period_end, status)
     values ('payroll', current_date, current_date, 'sent') $$,
  '42501', null, 'admin cannot fake a report send; only the scheduled job on the service role writes it');

select throws_ok(
  $$ insert into notification_outbox (key, channel, template) values ('RLS:denied:outbox','push','N1') $$,
  '42501', null,
  'KNOWN GAP: admin cannot enqueue a notification directly (deny-all); only service_role can'
);

reset role;
select * from finish();
rollback;
