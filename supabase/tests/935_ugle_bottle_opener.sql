-- =====================================================================
-- 935 · UGLE bottle-opener kit message · 20261026140000 · ADR-0110
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

-- The migration's statement restated (the test container holds no migration
-- files), run twice to show it is idempotent.
insert into client_role_requirements (client_id, role_id, kit_message)
select rc.client_id, rc.role_id,
       'Don''t forget to bring a bottle opener to your shift at Freemasons'' Hall.'
  from client_rate_cards rc
  join clients c on c.id = rc.client_id
 where c.name ilike 'United Grand Lodge%'
on conflict (client_id, role_id) do update
  set kit_message = excluded.kit_message;
insert into client_role_requirements (client_id, role_id, kit_message)
select rc.client_id, rc.role_id,
       'Don''t forget to bring a bottle opener to your shift at Freemasons'' Hall.'
  from client_rate_cards rc
  join clients c on c.id = rc.client_id
 where c.name ilike 'United Grand Lodge%'
on conflict (client_id, role_id) do update
  set kit_message = excluded.kit_message;

select is((select count(*)::int from client_role_requirements
            where client_id = 'c0c0c0c0-0000-4000-8000-0000000009a1' and role_id = :'role_id'), 1,
  'one requirement per role, however often it runs');
select matches((select kit_message from client_role_requirements
                 where client_id = 'c0c0c0c0-0000-4000-8000-0000000009a1'), 'bottle opener',
  'the kit message names the bottle opener');
select is((select count(*)::int from client_role_requirements r join clients c on c.id = r.client_id
            where c.name not ilike 'United Grand Lodge%'
              and r.kit_message = 'Don''t forget to bring a bottle opener to your shift at Freemasons'' Hall.'), 0,
  'no other client is touched');
select * from finish();
rollback;
