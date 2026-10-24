-- ADR-0110 · United Grand Lodge of England (Freemasons' Hall): every worker
-- brings a bottle opener to every shift. Carried as data — the kit message
-- (CR2, 07:00 UK on the day or start − 3 h, until acknowledged) on every role
-- the client has a rate card for. Product owner, 23.10.2026.
-- Idempotent; an existing quiz on a requirement is left as it is.
insert into client_role_requirements (client_id, role_id, kit_message)
select rc.client_id, rc.role_id,
       'Don''t forget to bring a bottle opener to your shift at Freemasons'' Hall.'
  from client_rate_cards rc
  join clients c on c.id = rc.client_id
 where c.name ilike 'United Grand Lodge%'
on conflict (client_id, role_id) do update
  set kit_message = excluded.kit_message;
