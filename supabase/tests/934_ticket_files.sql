-- =====================================================================
-- 934 · Files on a ticket (ADR-0204) — 20261026110000_ticket_files.sql
--
--   · the private ticket-files bucket and its limits; no API role writes
--     ticket_files; anon reads nothing;
--   · only the person who filed a ticket attaches to it, within the hour,
--     up to five files;
--   · attach_ticket_file() reads size and type from what Storage recorded:
--     an object nobody uploaded, a path off the ticket, a kind that does not
--     match the type are all refused;
--   · deleting a row queues its object for removal.
-- =====================================================================
begin;
select plan(38);
\ir _shared/fixtures.psql

\set filer  '93400000-0000-4000-8000-000000000001'
\set other  '93400000-0000-4000-8000-000000000002'
\set viewer '93400000-0000-4000-8000-000000000003'

insert into auth.users (id, email) values
  (:'filer',  'filer.934@rls.test'),
  (:'other',  'other.934@rls.test'),
  (:'viewer', 'viewer.934@rls.test');
insert into profiles (id, role, office_role, full_name) values
  (:'filer',  'admin', 'manager', 'Fay Filer'),
  (:'other',  'admin', 'manager', 'Otto Other'),
  (:'viewer', 'admin', 'viewer',  'Vera Viewer');

-- ---------------------------------------------------------------------
-- Structure
-- ---------------------------------------------------------------------
select has_table('public', 'ticket_files', 'ticket_files exists');
select ok(not has_table_privilege('authenticated', 'ticket_files', 'insert')
      and not has_table_privilege('authenticated', 'ticket_files', 'update')
      and not has_table_privilege('authenticated', 'ticket_files', 'delete'),
  'no API role can write it directly: the one write is attach_ticket_file()');
select ok(not has_table_privilege('anon', 'ticket_files', 'select'), 'anon reads nothing');
select ok(not has_function_privilege('anon', 'attach_ticket_file(uuid,text,text,text)', 'execute')
      and not has_function_privilege('anon', 'ticket_file_allowed(uuid)', 'execute'),
  'anon calls neither function');
select ok(not has_function_privilege('authenticated', 'ticket_file_queue_removal()', 'execute'),
  'the removal trigger function is internal');
select is((select public from storage.buckets where id = 'ticket-files'), false,
  'the ticket-files bucket exists and is private');
select is((select file_size_limit from storage.buckets where id = 'ticket-files'), 52428800::bigint,
  'it refuses an object over 50 MB at the door');
select ok((select 'video/webm' = any (allowed_mime_types) and 'image/png' = any (allowed_mime_types)
                  and not ('application/pdf' = any (allowed_mime_types))
             from storage.buckets where id = 'ticket-files'),
  'and takes pictures and videos only');

-- ---------------------------------------------------------------------
-- A manager files a ticket
-- ---------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'filer', 'role', 'authenticated')::text, true);

create temporary table made (r jsonb);
grant all on made to authenticated;
insert into made select create_ticket('bug', null, 'Card vanishes after a drag', 'See the recording.', '/events');

select is(ticket_file_allowed((select (r ->> 'id')::uuid from made)), true,
  'the person who filed it may add files');
select throws_ok(format($$ select attach_ticket_file(%L, %L, 'screenshot') $$,
    (select r ->> 'id' from made),
    (select r ->> 'id' from made) || '/11111111-1111-4111-8111-111111111111.png'),
  'P0002', 'file_not_found', 'a path nobody uploaded to cannot be attached');

-- What the server's signed upload leaves behind in Storage.
reset role;
insert into storage.objects (bucket_id, name, metadata)
select 'ticket-files',
       (select r ->> 'id' from made) || '/' || n.id || '.' || n.ext,
       jsonb_build_object('mimetype', n.mime, 'size', n.bytes)
  from (values
    ('11111111-1111-4111-8111-111111111111', 'png', 'image/png',  120000),
    ('22222222-2222-4222-8222-222222222222', 'webm', 'video/webm', 9000000),
    ('33333333-3333-4333-8333-333333333333', 'png', 'image/png',  1000),
    ('44444444-4444-4444-8444-444444444444', 'png', 'image/png',  1000),
    ('55555555-5555-4555-8555-555555555555', 'png', 'image/png',  1000),
    ('66666666-6666-4666-8666-666666666666', 'png', 'image/png',  1000)
  ) as n(id, ext, mime, bytes);

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'filer', 'role', 'authenticated')::text, true);

select lives_ok(format($$ select attach_ticket_file(%L, %L, 'screenshot', 'Screenshot 1.png') $$,
    (select r ->> 'id' from made),
    (select r ->> 'id' from made) || '/11111111-1111-4111-8111-111111111111.png'),
  'a screenshot that is in Storage attaches');
select is((select bytes from ticket_files order by created_at limit 1), 120000::bigint,
  'its size is what Storage recorded');
select is((select mime from ticket_files order by created_at limit 1), 'image/png',
  'and so is its type');
select lives_ok(format($$ select attach_ticket_file(%L, %L, 'recording') $$,
    (select r ->> 'id' from made),
    (select r ->> 'id' from made) || '/22222222-2222-4222-8222-222222222222.webm'),
  'a screen recording attaches');

select throws_ok(format($$ select attach_ticket_file(%L, %L, 'video') $$,
    (select r ->> 'id' from made),
    (select r ->> 'id' from made) || '/33333333-3333-4333-8333-333333333333.png'),
  '22023', 'bad_file_kind', 'a picture cannot be filed as a video');
select throws_ok(format($$ select attach_ticket_file(%L, %L, 'selfie') $$,
    (select r ->> 'id' from made),
    (select r ->> 'id' from made) || '/33333333-3333-4333-8333-333333333333.png'),
  '22023', 'bad_file_kind', 'a kind off the list is refused');
select throws_ok(format($$ select attach_ticket_file(%L, 'somebody-elses/33333333-3333-4333-8333-333333333333.png', 'screenshot') $$,
    (select r ->> 'id' from made)),
  '22023', 'bad_file_path', 'a path off this ticket is refused');
select throws_ok($$ select attach_ticket_file('00000000-0000-4000-8000-000000000000', 'x/y.png', 'screenshot') $$,
  'P0002', 'unknown_ticket', 'an unknown ticket is refused');
select throws_ok($$ insert into ticket_files (ticket_id, path, kind, mime, bytes)
                      values ((select (r ->> 'id')::uuid from made), 'x', 'screenshot', 'image/png', 1) $$,
  '42501', null, 'a direct insert is refused');

-- ---------------------------------------------------------------------
-- Not for anyone but the filer
-- ---------------------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', :'other', 'role', 'authenticated')::text, true);
select is(ticket_file_allowed((select (r ->> 'id')::uuid from made)), false,
  'another manager may not add files to it');
select throws_ok(format($$ select attach_ticket_file(%L, %L, 'screenshot') $$,
    (select r ->> 'id' from made),
    (select r ->> 'id' from made) || '/33333333-3333-4333-8333-333333333333.png'),
  'P0001', 'cannot_attach', 'and the database refuses it');
select is((select count(*)::int from ticket_files), 2, 'but reads the files that are there');

select set_config('request.jwt.claims', json_build_object('sub', :'viewer', 'role', 'authenticated')::text, true);
select throws_ok(format($$ select attach_ticket_file(%L, %L, 'screenshot') $$,
    (select r ->> 'id' from made),
    (select r ->> 'id' from made) || '/33333333-3333-4333-8333-333333333333.png'),
  'P0001', 'cannot_attach', 'a viewer attaches nothing');

-- ---------------------------------------------------------------------
-- A worker and a client reach none of it
-- ---------------------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
select is((select count(*)::int from ticket_files), 0, 'a worker reads no file');
select throws_ok(format($$ select attach_ticket_file(%L, %L, 'screenshot') $$,
    (select r ->> 'id' from made),
    (select r ->> 'id' from made) || '/33333333-3333-4333-8333-333333333333.png'),
  '42501', 'not_authorised', 'and cannot attach one');
select set_config('request.jwt.claims', json_build_object('sub', :'clienta_uid', 'role', 'authenticated')::text, true);
select is((select count(*)::int from ticket_files), 0, 'a client reads no file');

-- ---------------------------------------------------------------------
-- What the database refuses on the way in
-- ---------------------------------------------------------------------
reset role;
insert into storage.objects (bucket_id, name, metadata) values
  ('ticket-files', (select r ->> 'id' from made) || '/77777777-7777-4777-8777-777777777777.png',
   '{"mimetype": "image/png", "size": 0}'::jsonb),
  ('documents',    (select r ->> 'id' from made) || '/88888888-8888-4888-8888-888888888888.png',
   '{"mimetype": "image/png", "size": 5}'::jsonb);
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'filer', 'role', 'authenticated')::text, true);

select throws_ok(format($$ select attach_ticket_file(%L, %L, 'screenshot') $$,
    (select r ->> 'id' from made),
    (select r ->> 'id' from made) || '/not-a-uuid.png'),
  '22023', 'bad_file_path', 'a file name that is not a uuid is refused');
select throws_ok(format($$ select attach_ticket_file(%L, %L, 'screenshot') $$,
    (select r ->> 'id' from made),
    (select r ->> 'id' from made) || '/' || repeat('-', 36) || '.png'),
  '22023', 'bad_file_path', 'and so is thirty-six hyphens');
select throws_ok(format($$ select attach_ticket_file(%L, %L, 'screenshot') $$,
    (select r ->> 'id' from made),
    (select r ->> 'id' from made) || '/11111111-1111-4111-8111-111111111111.png'),
  '23505', null, 'the same object is not attached twice');
select throws_ok(format($$ select attach_ticket_file(%L, %L, 'screenshot') $$,
    (select r ->> 'id' from made),
    (select r ->> 'id' from made) || '/77777777-7777-4777-8777-777777777777.png'),
  '23514', null, 'an empty object is refused by the table');
select throws_ok(format($$ select attach_ticket_file(%L, %L, 'screenshot') $$,
    (select r ->> 'id' from made),
    (select r ->> 'id' from made) || '/88888888-8888-4888-8888-888888888888.png'),
  'P0002', 'file_not_found', 'an object of that name in another bucket is not this bucket''s');

-- The filer is demoted to Viewer inside the hour: still the reporter, but
-- the table refuses the write (ADR-0060).
reset role;
update profiles set office_role = 'viewer' where id = :'filer';
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'filer', 'role', 'authenticated')::text, true);
select throws_ok(format($$ select attach_ticket_file(%L, %L, 'screenshot') $$,
    (select r ->> 'id' from made),
    (select r ->> 'id' from made) || '/33333333-3333-4333-8333-333333333333.png'),
  '42501', 'read_only', 'a filer demoted to Viewer attaches nothing');
reset role;
update profiles set office_role = 'manager' where id = :'filer';
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'filer', 'role', 'authenticated')::text, true);

-- ---------------------------------------------------------------------
-- At most five, and only for an hour
-- ---------------------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', :'filer', 'role', 'authenticated')::text, true);
select lives_ok(format($$ select attach_ticket_file(%L, %L || '/' || f.id || '.png', 'screenshot')
                            from (values ('33333333-3333-4333-8333-333333333333'),
                                         ('44444444-4444-4444-8444-444444444444'),
                                         ('55555555-5555-4555-8555-555555555555')) f(id) $$,
    (select r ->> 'id' from made), (select r ->> 'id' from made)),
  'up to five files attach');
select throws_ok(format($$ select attach_ticket_file(%L, %L, 'screenshot') $$,
    (select r ->> 'id' from made),
    (select r ->> 'id' from made) || '/66666666-6666-4666-8666-666666666666.png'),
  'P0001', 'cannot_attach', 'a sixth is refused');

-- ---------------------------------------------------------------------
-- A removed row owes its object a removal
-- ---------------------------------------------------------------------
reset role;
delete from ticket_files where path like '%/66666666%' or path like '%/11111111%';
select is((select count(*)::int from storage_deletions
            where bucket = 'ticket-files' and path like '%/11111111-1111-4111-8111-111111111111.png'), 1,
  'deleting a file row queues its object for removal');

update tickets set created_at = now() - interval '2 hours'
 where id = (select (r ->> 'id')::uuid from made);
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'filer', 'role', 'authenticated')::text, true);
select is(ticket_file_allowed((select (r ->> 'id')::uuid from made)), false,
  'after an hour even the filer may not add more');

-- An owner deleting the ticket takes the whole folder with it, including an
-- object that was uploaded but never attached.
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
select lives_ok(format($$ select delete_ticket(%L) $$, (select r ->> 'id' from made)),
  'an owner deletes the ticket');
reset role;
select is((select count(*)::int from storage_deletions
            where bucket = 'ticket-files' and prefix and path = (select r ->> 'id' from made) || '/'), 1,
  'and its folder is queued for removal, attached or not');

select * from finish();
rollback;
