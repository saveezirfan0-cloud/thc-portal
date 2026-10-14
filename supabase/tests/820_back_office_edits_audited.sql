-- =====================================================================
-- 820 · Every Back Office edit is in the activity log
--       20261014093200 · release audit 14.10.2026 D-M1 · §1.7, ADR-0055
--
-- Each write below is made the way the Back Office makes it: an owner's
-- own session, role `authenticated` — never the table owner, which
-- bypasses RLS and is how B1 (20261014093100) stayed green. Each must
-- leave one audit_log row naming the owner, filed where the client card's
-- and the profile's History look, with {from, to} for money and policy.
--
-- Then: a write with no session (a job, the seed) logs nothing; nothing is
-- logged when nothing changed; cancel_event's own switch-off is not an
-- "edit"; Do not return keeps its single row; a scheduler reads the rows
-- without the rates (ADR-0061); a client and a worker read none of it.
-- =====================================================================
begin;
select plan(52);
\ir _shared/fixtures.psql

\set owner     '82000000-0000-4000-8000-000000000001'
\set scheduler '82000000-0000-4000-8000-000000000002'
\set role_b    '82000000-0000-4000-8000-000000000003'
\set new_event '82000000-0000-4000-8000-000000000004'
\set dup_event '82000000-0000-4000-8000-000000000005'
\set new_shift '82000000-0000-4000-8000-000000000006'

insert into auth.users (id, email) values
  (:'owner',     'owner.820@rls.test'),
  (:'scheduler', 'scheduler.820@rls.test');
insert into profiles (id, role, office_role, full_name) values
  (:'owner',     'admin', 'owner',     'Olive Owner'),
  (:'scheduler', 'admin', 'scheduler', 'Sid Scheduler');
insert into roles (id, name, description, pay_rate) values
  (:'role_b', 'Audit Fixture Role B', 'internal only', 15.00);

-- The newest row for an action about one record.
create function pg_temp.last_row(p_action text, p_entity_id uuid)
returns audit_log language sql as $$
  select a.* from audit_log a
   where a.action = p_action and a.entity_id = p_entity_id
   order by a.id desc limit 1
$$;

-- /activity and a record's History, read as a given office login. Both
-- readers are definers that ask current_app_role() and office_can(), which
-- read the session's claims — so only the claims need to change.
create function pg_temp.admin_activity_as(p_user uuid, p_action text)
returns table (action text, data jsonb, entity_label text) language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
                     json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  return query
    select a.action, a.data, a.entity_label
      from public.admin_activity(200) a
     where a.action = p_action
     order by a.id desc
     limit 1;
end $$;

create function pg_temp.admin_record_history_as(p_user uuid, p_entity text, p_id uuid)
returns table (action text, data jsonb) language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
                     json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  return query
    select h.action, h.data from public.admin_record_history(p_entity, p_id, 200) h;
end $$;

select set_config('request.jwt.claims', json_build_object('sub', :'owner', 'role', 'authenticated')::text, true);
set local role authenticated;

-- =====================================================================
-- Clients (create_client, update_client)
-- =====================================================================
select create_client('Audit Fixture Client', 'Ann Audit', '+447700900820', 'Front desk',
                     array['ann@audit.test'], true, true) as new_client \gset
select update_client(:'new_client', 'Audit Fixture Client', 'Ann Audit', '+447700900820', 'Front desk',
                     array['ann@audit.test'], false, true);
select update_client(:'new_client', 'Audit Fixture Client', 'Ann Audit', '+447700900820', 'Front desk',
                     array['ann@audit.test'], false, true);
reset role;

select is((pg_temp.last_row('client.created', :'new_client')).actor, :'owner'::uuid,
  'create_client: one client.created row, naming the manager');
select is((pg_temp.last_row('client.created', :'new_client')).data ->> 'paysBreaks', 'true',
  'and it records the two policies the client starts with (§9.7)');
select is((pg_temp.last_row('client.updated', :'new_client')).data -> 'paysBreaks',
  '{"from": true, "to": false}'::jsonb,
  'update_client: the break policy change is recorded from → to');
select is((pg_temp.last_row('client.updated', :'new_client')).data ? 'name', false,
  'and only what changed');
select is((select count(*)::int from audit_log where action = 'client.updated' and entity_id = :'new_client'), 1,
  'saving the dialog again with no change writes nothing');
select is((select created_by from clients where id = :'new_client'), :'owner'::uuid,
  'clients.created_by is the manager');

-- =====================================================================
-- The rate card (add / update / remove) — filed under the client
-- =====================================================================
set local role authenticated;
select add_client_role(:'new_client', :'role_id', 20.00, array['Black tie']);
select id as card_row from client_rate_cards where client_id = :'new_client' and role_id = :'role_id' \gset
select update_client_role(:'card_row', 21.50, array['Black tie']);
select remove_client_role(:'card_row');
reset role;

select is((pg_temp.last_row('client.rate_added', :'new_client')).data -> 'chargeRate',
  '{"from": null, "to": 20.00}'::jsonb,
  'add_client_role: client.rate_added with the charge rate, on the client''s History');
select is((pg_temp.last_row('client.rate_added', :'new_client')).data ->> 'role', 'RLS Fixture Role',
  'naming the role');
select is((pg_temp.last_row('client.rate_changed', :'new_client')).data -> 'chargeRate',
  '{"from": 20.00, "to": 21.50}'::jsonb,
  'update_client_role: the charge rate from → to (money)');
select is((pg_temp.last_row('client.rate_removed', :'new_client')).data -> 'chargeRate',
  '{"from": 21.50, "to": null}'::jsonb,
  'remove_client_role: what the rate was when it went');

-- =====================================================================
-- A worker's pay rate, roles and client qualifications (§9.6)
-- =====================================================================
set local role authenticated;
select set_staff_pay_rate(:'staffa', 15.25);
select set_staff_pay_rate(:'staffa', 15.75);
select set_staff_pay_rate(:'staffa', null);
select add_staff_role(:'staffb', :'role_b');
select grant_client_qualification(:'staffb', :'clienta', :'role_b', 'Cleared for B') as new_qual \gset
select grant_client_qualification(:'staffb', :'clienta', :'role_b', 'Cleared for B, again');
reset role;

select is((pg_temp.last_row('staff.pay_rate_set', :'staffa')).data -> 'payRate',
  '{"from": 15.25, "to": 15.75}'::jsonb,
  'set_staff_pay_rate: the personal rate from → to, on the worker');
select is((pg_temp.last_row('staff.pay_rate_cleared', :'staffa')).data -> 'payRate',
  '{"from": 15.75, "to": null}'::jsonb,
  'clearing it is its own row');
select is((select count(*)::int from audit_log where action = 'staff.pay_rate_set' and entity_id = :'staffa'), 2,
  'one row per set');
select is((pg_temp.last_row('staff.role_added', :'staffb')).data ->> 'role', 'Audit Fixture Role B',
  'add_staff_role: staff.role_added, naming the role');
select is((pg_temp.last_row('client_qualification.granted', :'new_qual')).data ->> 'clientId', :'clienta',
  'grant_client_qualification: granted, carrying the client so its card''s History finds it');
select is((pg_temp.last_row('client_qualification.note_changed', :'new_qual')).data -> 'note',
  '{"from": "Cleared for B", "to": "Cleared for B, again"}'::jsonb,
  're-adding with a new note records the note change');

-- Do not return keeps its own single row: the flag moving is not also a
-- "note changed".
set local role authenticated;
select set_do_not_return(:'new_qual', true, 'Client asked');
select set_do_not_return(:'new_qual', false);
select revoke_client_qualification(:'new_qual');
select remove_staff_role(:'staffb', :'role_b');
reset role;
select is((select count(*)::int from audit_log
            where entity_id = :'new_qual' and action = 'client_qualification.note_changed'), 1,
  'switching Do not return on with a reason is the do_not_return_on row, not a second note change');
select is((pg_temp.last_row('client_qualification.revoked', :'new_qual')).actor, :'owner'::uuid,
  'revoke_client_qualification: revoked, naming the manager');
select is((pg_temp.last_row('staff.role_removed', :'staffb')).data ->> 'role', 'Audit Fixture Role B',
  'remove_staff_role: staff.role_removed');

select ok((select count(*) from pg_temp.admin_record_history_as(:'owner', 'client', :'clienta')
            where action = 'client_qualification.revoked') = 1,
  'the client card''s History finds the removed qualification by its clientId');

-- =====================================================================
-- Feedback (§9.10)
-- =====================================================================
set local role authenticated;
select add_office_feedback(:'staffa', 4, 'Strong on the pass', null) as fb \gset
select update_office_feedback(:'fb', 5, 'Strong on the pass', null);
select delete_feedback(:'fb');
select mark_feedback_read(:'feedback_a');
reset role;

select is((pg_temp.last_row('feedback.added', :'staffa')).data ->> 'rating', '4',
  'add_office_feedback: feedback.added on the worker, with the rating (the text stays on the entry)');
select is((pg_temp.last_row('feedback.edited', :'staffa')).data -> 'rating',
  '{"from": 4, "to": 5}'::jsonb,
  'update_office_feedback: the rating from → to');
select is((pg_temp.last_row('feedback.deleted', :'staffa')).data ->> 'author', 'office',
  'delete_feedback: feedback.deleted');
select is((pg_temp.last_row('feedback.read', :'staffa')).data ->> 'author', 'client',
  'mark_feedback_read: a client entry marked read is recorded');
select is((select count(*)::int from audit_log a where a.entity_id = :'staffa' and a.action like 'feedback.%'
            and a.data::text ilike '%strong on the pass%'), 0,
  'and no row copies the feedback text');

-- =====================================================================
-- Venues (§9.11) and the role catalogue (§9.8)
-- =====================================================================
set local role authenticated;
select create_venue('Audit Fixture Hall', '2 Test Street, London', 51.501, -0.101, 'hotel', 150) as venue \gset
select update_venue(:'venue', 'Audit Fixture Hall', '2 Test Street, London', 51.501, -0.101, 'hotel', 200);
select delete_venue(:'venue');
select create_role('Audit Fixture Role C', 12.50, null) as role_c \gset
select update_role(:'role_c', 'Audit Fixture Role C', 13.00, null);
reset role;

select is((pg_temp.last_row('venue.created', :'venue')).data ->> 'name', 'Audit Fixture Hall',
  'create_venue: venue.created');
select is((pg_temp.last_row('venue.updated', :'venue')).data -> 'radius',
  '{"from": 150, "to": 200}'::jsonb,
  'update_venue: the geofence radius from → to');
select ok((pg_temp.last_row('venue.deleted', :'venue')).id is not null,
  'delete_venue: venue.deleted');
select is((pg_temp.last_row('role.updated', :'role_c')).data -> 'payRate',
  '{"from": 12.50, "to": 13.00}'::jsonb,
  'update_role: the base pay rate from → to');

-- =====================================================================
-- Events: create, duplicate, edit, role sections (Shift Builder — table
-- writes through PostgREST, not an RPC)
-- =====================================================================
set local role authenticated;
insert into events (id, client_id, venue_id, venue_name, venue_address, venue_location, geofence_radius_m,
                    title, event_date, pays_breaks, pays_buffer)
values (:'new_event', :'clienta', :'venue_id', 'RLS Fixture Venue', '1 Test Street, London',
        st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150, 'Audit Gala', current_date + 10, true, true);
insert into events (id, client_id, venue_id, venue_name, venue_address, venue_location, geofence_radius_m,
                    title, event_date, pays_breaks, pays_buffer, duplicated_from)
values (:'dup_event', :'clienta', :'venue_id', 'RLS Fixture Venue', '1 Test Street, London',
        st_setsrid(st_makepoint(-0.1000, 51.5000), 4326)::geography, 150, 'Audit Gala', current_date + 11, true, true,
        :'new_event');
insert into shift_requirements (id, event_id, role_id, starts_at, ends_at, headcount, buffer,
                                charge_rate, pay_rate)
values (:'new_shift', :'new_event', :'role_id', now() + interval '10 days', now() + interval '10 days 6 hours',
        4, 1, 22.00, 14.00);
update events set title = 'Audit Gala Dinner', po_number = 'PO-820' where id = :'new_event';
update shift_requirements set headcount = 5, charge_rate = 23.00 where id = :'new_shift';
update events set title = 'Audit Gala Dinner' where id = :'new_event';
delete from shift_requirements where id = :'new_shift';
reset role;

select is((select created_by from events where id = :'new_event'), :'owner'::uuid,
  'events.created_by is the manager who built it (it stayed NULL before)');
select is((pg_temp.last_row('event.created', :'new_event')).data ->> 'title', 'Audit Gala',
  'event.created, with its title');
select is((pg_temp.last_row('event.duplicated', :'dup_event')).data ->> 'duplicatedFrom',
  'Audit Gala · ' || to_char(current_date + 10, 'DD.MM.YYYY'),
  'a Duplicate is event.duplicated, naming what it was made from');
select is((pg_temp.last_row('event.updated', :'new_event')).data -> 'title',
  '{"from": "Audit Gala", "to": "Audit Gala Dinner"}'::jsonb,
  'an edit records each changed field from → to');
select is((select count(*)::int from audit_log where action = 'event.updated' and entity_id = :'new_event'), 1,
  'saving with nothing changed writes nothing');
select is((pg_temp.last_row('event.role_added', :'new_event')).data ->> 'role', 'RLS Fixture Role',
  'a new role section is event.role_added on the event');
select is((pg_temp.last_row('event.role_added', :'new_event')).data ->> 'starts',
  to_char((now() + interval '10 days') at time zone 'Europe/London', 'DD.MM.YYYY HH24:MI'),
  'with its times in UK time (§1.8)');
select is((pg_temp.last_row('event.role_changed', :'new_event')).data -> 'chargeRate',
  '{"from": 22.00, "to": 23.00}'::jsonb,
  'a section edit records the charge rate from → to');
select is((pg_temp.last_row('event.role_changed', :'new_event')).data -> 'headcount',
  '{"from": 4, "to": 5}'::jsonb,
  'and the headcount');
select ok((pg_temp.last_row('event.role_removed', :'new_event')).id is not null,
  'removing a section is event.role_removed');

-- cancel_event switches auto-assign off on the event and its sections:
-- that is the cancellation's own row, not an "edit".
set local role authenticated;
select cancel_event(:'dup_event', 'Client postponed');
reset role;
select is((select count(*)::int from audit_log
            where entity_id = :'dup_event' and action in ('event.updated', 'event.role_changed')), 0,
  'cancelling writes event.cancelled only — no event.updated for the auto-assign switch-off');

-- =====================================================================
-- Only a person's edit is logged
-- =====================================================================
select set_config('request.jwt.claims', '', true);
update clients set phone = '+447700900999' where id = :'new_client';
select is((select count(*)::int from audit_log where action = 'client.updated' and entity_id = :'new_client'), 1,
  'a write with no session (a job, the seed) logs nothing — it is not an edit');

-- =====================================================================
-- The readers: money withheld from a scheduler (ADR-0061)
-- =====================================================================
select is((select data -> 'chargeRate' from pg_temp.admin_activity_as(:'owner', 'client.rate_changed')),
  '{"from": 20.00, "to": 21.50}'::jsonb,
  'an owner reads the charge rate change on /activity');
select is((select data ? 'chargeRate' from pg_temp.admin_activity_as(:'scheduler', 'client.rate_changed')), false,
  'a scheduler does not — ADR-0061: no money for the scheduler role');
select is((select data ->> 'rates' from pg_temp.admin_activity_as(:'scheduler', 'client.rate_changed')),
  'not shown to your login',
  'and the entry says the rates were withheld rather than reading as if nothing changed');
select is((select data ->> 'role' from pg_temp.admin_activity_as(:'scheduler', 'client.rate_changed')),
  'RLS Fixture Role', 'the rest of the row is still there');
select is((select data ? 'payRate' from pg_temp.admin_record_history_as(:'scheduler', 'staff', :'staffa')
            where action = 'staff.pay_rate_set' limit 1), false,
  'the profile''s History withholds the personal pay rate from a scheduler too');
select is((select entity_label from pg_temp.admin_activity_as(:'owner', 'venue.created')), 'Audit Fixture Hall',
  'a venue row is labelled with the venue''s name');

-- =====================================================================
-- Who else may see or write it
-- =====================================================================
select set_config('request.jwt.claims', json_build_object('sub', :'clienta_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select count(*)::int from audit_log), 0, 'a client reads no audit row (admin_read only, §11.1)');
select throws_ok($$ select * from admin_activity() $$, '42501', 'not_authorised',
  'and cannot call the activity log');
reset role;
select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select count(*)::int from audit_log), 0, 'a worker reads none either');
select throws_ok($$ insert into audit_log (action, entity) values ('forged', 'staff') $$, '42501', null,
  'and nobody writes audit_log through the API — only the definer triggers do');
reset role;

select is((select count(*)::int from pg_proc p
            where p.pronamespace = 'public'::regnamespace
              and p.proname in ('audit_client_change', 'audit_rate_card_change', 'audit_staff_pay_rate_change',
                                'audit_staff_role_change', 'audit_client_qualification_change',
                                'audit_feedback_change', 'audit_venue_change', 'audit_role_change',
                                'audit_event_change', 'audit_section_change')
              and p.prosecdef
              and not has_function_privilege('authenticated', p.oid, 'execute')), 10,
  'all ten audit triggers are SECURITY DEFINER and not callable by a signed-in session');

select * from finish();
rollback;
