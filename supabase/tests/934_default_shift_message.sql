-- =====================================================================
-- 934 · Default morning message for every shift · 20261026110000 · ADR-0203
--   A. shift_kit_message: the default alone; the client's own kit message
--      then the default; the default switched off; neither → null.
--   B. A worker's booking at a client with no requirement still carries the
--      message (staff_shift_requirements), and acknowledging it works.
--   C. CR2 is queued for it at the due moment, with the message as payload.
-- =====================================================================
begin;
select plan(10);
\ir _shared/fixtures.psql

select value #>> '{}' as dflt from settings where key = 'default_shift_message' \gset

select is(:'dflt' like E'Look sharp. Every shift.\nUniform clean and pressed.%Thank you.', true,
  'A: the default is the owner''s wording');
select is((select shift_kit_message(:'clienta', :'role_id')), :'dflt',
  'A: a client with no requirement gets the default alone');

insert into client_role_requirements (client_id, role_id, kit_message)
values (:'clienta', :'role_id', 'Bring a corkscrew.');
select is((select shift_kit_message(:'clienta', :'role_id')), 'Bring a corkscrew.' || E'\n\n' || :'dflt',
  'A: a client''s kit message comes first, then the default');

update settings set value = '""'::jsonb where key = 'default_shift_message';
select is((select shift_kit_message(:'clienta', :'role_id')), 'Bring a corkscrew.',
  'A: with the default blanked, the client''s message stands alone');
delete from client_role_requirements where client_id = :'clienta' and role_id = :'role_id';
select is((select shift_kit_message(:'clienta', :'role_id')), null,
  'A: neither set → null');
update settings set value = to_jsonb(:'dflt'::text) where key = 'default_shift_message';

select kit_reminder_due_at(starts_at) as due_a_lit from shift_requirements where id = :'shift_a' \gset
select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((select kit_message from staff_shift_requirements() where booking_id = :'booking_a'), :'dflt',
  'B: staff A''s booking at a client with no requirement carries the default');
select is((select (acknowledge_shift_kit(:'booking_a') ->> 'ok')::boolean), true,
  'B: and can be acknowledged');
reset role;
delete from booking_kit_acknowledgements where booking_id = :'booking_a';

select lives_ok(format($$ select client_kit_reminder_tick(%L::timestamptz) $$, :'due_a_lit'),
  'C: the tick runs at booking A''s due moment');
select is((select count(*)::int from notification_outbox
            where template = 'CR2' and recipient_staff_id = :'staffa'), 1,
  'C: and queues one CR2 for staff A');
select is((select payload ->> 'message' from notification_outbox
            where template = 'CR2' and recipient_staff_id = :'staffa'), :'dflt',
  'C: its message is the default');
select * from finish();
rollback;
