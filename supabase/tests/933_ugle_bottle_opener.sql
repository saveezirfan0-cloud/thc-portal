-- =====================================================================
-- 933 · UGLE bottle-opener kit message · 20261026100000 · ADR-0110
--   Re-running the data migration puts the kit message on every rate-card
--   role of a United Grand Lodge client, leaves other clients alone, and
--   does not double rows.
-- =====================================================================
begin;
select plan(3);
\ir _shared/fixtures.psql

insert into clients (id, name, contact_name, phone, staff_contact_point, contact_emails)
  values ('c0c0c0c0-0000-4000-8000-0000000009a1', 'United Grand Lodge of England', 'Test', '0', 'Test', array['t@example.com']);
insert into client_rate_cards (client_id, role_id, charge_rate)
  values ('c0c0c0c0-0000-4000-8000-0000000009a1', :'role_id', 20.00);

\ir ../migrations/20261026100000_ugle_bottle_opener_kit_message.sql
\ir ../migrations/20261026100000_ugle_bottle_opener_kit_message.sql

select is((select count(*)::int from client_role_requirements
            where client_id = 'c0c0c0c0-0000-4000-8000-0000000009a1' and role_id = :'role_id'), 1,
  'one requirement per role, however often it runs');
select matches((select kit_message from client_role_requirements
                 where client_id = 'c0c0c0c0-0000-4000-8000-0000000009a1'), 'bottle opener',
  'the kit message names the bottle opener');
select is((select count(*)::int from client_role_requirements r join clients c on c.id = r.client_id
            where c.name not ilike 'United Grand Lodge%' and r.kit_message ilike '%bottle opener%'), 0,
  'no other client is touched');
select * from finish();
rollback;
