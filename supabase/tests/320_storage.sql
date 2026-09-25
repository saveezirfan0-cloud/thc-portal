-- =====================================================================
-- 320 · Storage: four private buckets, and one worked policy (§1.7, §2.5,
--       §2.6, §9.8, §9.9, §11.3)
--
-- Until 20260922183015 the buckets were a bullet in docs/04 and a click in
-- the dashboard. Nothing in the repo created them and nothing asserted
-- anything about them, so the invariant that matters — `documents` holds
-- passport scans, visa documents and share-code reports, and must never be
-- a public bucket — was resting on nobody having ticked the wrong box.
--
-- A Supabase bucket marked public is not "readable by signed-in users": its
-- objects are served from unauthenticated URLs. There is no RLS in front of
-- that. So this file asserts the bucket flag first and the policies second,
-- in that order of seriousness.
--
-- The behavioural half needs `authenticated` to hold table privileges on
-- storage.objects, which is Supabase's own default but is granted by the
-- storage service rather than by anything in this repo. Rather than assume
-- it, the file probes and skips with a reason that names exactly what is
-- missing — a skipped assertion that says why is worth more than a red
-- suite that says "permission denied" and leaves the reader to work out
-- whether that is the finding or the harness.
-- =====================================================================
begin;
select plan(17);
\ir _shared/fixtures.psql

-- ---------------------------------------------------------------------
-- 1-2. The buckets exist, and none of them is public.
--
--      The second assertion is the whole point of the file. It is written
--      as "no bucket anywhere in this project is public", not "these four
--      are private", so a fifth bucket created public by hand fails here
--      too. If THC ever genuinely needs a public bucket (a logo, say),
--      that is a decision worth making in a PR against this line.
-- ---------------------------------------------------------------------
select bag_eq(
  $$ select id::text from storage.buckets where id in ('documents','photos','reports','timesheets') $$,
  $$ values ('documents'::text),('photos'),('reports'),('timesheets') $$,
  'the four buckets docs/04 lists exist, and are created by a migration rather than by hand'
);

select is_empty(
  $$ select id::text from storage.buckets where public $$,
  'no Storage bucket is public: documents holds passports and right-to-work evidence, and a public bucket serves every object from an unauthenticated URL (§1.7)'
);

-- 2a-2b. The buckets refuse at the door what §2.5 point 7 refuses after
--        the fact (20260927160200): 10 MB and PDF/JPG/PNG (+ HEIC) on
--        documents, a 2 MB JPEG on photos.
select is(
  (select file_size_limit::text || ' ' || array_to_string(allowed_mime_types, ',') from storage.buckets where id = 'documents'),
  '10485760 application/pdf,image/jpeg,image/png,image/heic,image/heif',
  '§2.5 point 7: documents takes at most 10 MB of PDF, JPEG, PNG or HEIC — anything else is refused before the bytes land');
select is(
  (select file_size_limit::text || ' ' || array_to_string(allowed_mime_types, ',') from storage.buckets where id = 'photos'),
  '2097152 image/jpeg',
  'photos takes a JPEG of at most 2 MB (the app downscales the selfie to 512 px)');

-- ---------------------------------------------------------------------
-- 3. RLS is on for storage.objects.
--
--    Asserted rather than set: storage.objects is owned by
--    supabase_storage_admin, so no migration in this repo can enable it
--    (the same wall ADR-0010 hit on spatial_ref_sys). Supabase ships it
--    on. If a future version does not, every policy below becomes
--    decoration and this is the line that says so.
-- ---------------------------------------------------------------------
select ok(
  (select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'storage' and c.relname = 'objects'),
  'row level security is enabled on storage.objects, which is what makes the policies below mean anything'
);

-- ---------------------------------------------------------------------
-- 4-5. Which buckets any non-service-role policy mentions.
--
--      Everything the Storage layer exposes to anon or authenticated has
--      to be a policy on storage.objects, so the set of bucket names
--      appearing in those policies IS the set of buckets reachable from a
--      browser. Today that must be `photos` and nothing else: documents,
--      reports and timesheets are reached only by server code holding the
--      service key, which bypasses RLS.
--
--      Written as "mentions a bucket other than photos" rather than a
--      policy-name list, for the reason 001's assertion 5b exists: a
--      naming convention is not an access control.
-- ---------------------------------------------------------------------
select is_empty(
  $$ select p.polname::text
       from pg_policy p join pg_class c on c.oid = p.polrelid
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'storage' and c.relname = 'objects'
        and (coalesce(pg_get_expr(p.polqual, p.polrelid), '')
          || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), ''))
            ~ '''(documents|reports|timesheets)''' $$,
  'no storage.objects policy mentions documents, reports or timesheets: those three are service-role only, so a passport scan is never reachable with a user''s JWT'
);

select is_empty(
  $$ select p.polname::text
       from pg_policy p join pg_class c on c.oid = p.polrelid
       join pg_namespace n on n.oid = c.relnamespace
       join pg_roles r on r.oid = any(p.polroles)
      where n.nspname = 'storage' and c.relname = 'objects'
        and r.rolname = 'anon' $$,
  'no storage.objects policy grants anything to anon: nothing in Storage is public, in either sense of the word'
);

-- ---------------------------------------------------------------------
-- 6-7. The photos policy set, by shape.
--
--      Three worker policies (select / insert / update) and one admin
--      read. No DELETE for anybody: §1.7 erasure runs through
--      storage_deletions (20260922081512) on the service key, and a
--      worker who could delete objects could delete the evidence behind
--      an issued document.
-- ---------------------------------------------------------------------
select bag_eq(
  $$ select p.polname::text || ':' || p.polcmd::text
       from pg_policy p join pg_class c on c.oid = p.polrelid
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'storage' and c.relname = 'objects'
        and p.polname like 'photos\_%' $$,
  $$ values ('photos_worker_read_own:r'::text), ('photos_worker_insert_own:a'),
            ('photos_admin_read:r') $$,
  'photos carries exactly a worker read/insert on their own folder and an admin read — no UPDATE (§10.1: the locked avatar''s bytes are locked too, 20260927160200) and no delete for anybody (§1.7 erasure is the storage_deletions queue)'
);

select is_empty(
  $$ select p.polname::text
       from pg_policy p join pg_class c on c.oid = p.polrelid
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'storage' and c.relname = 'objects'
        and p.polcmd = 'd' $$,
  'nothing in storage.objects is deletable through a policy at all'
);

-- ---------------------------------------------------------------------
-- 8-12. And it behaves: a worker writes their own folder and nobody
--       else's, an admin reads any photo, a worker does not.
--
--       Skipped, with the reason, where `authenticated` holds no table
--       privilege on storage.objects — see the file header.
-- ---------------------------------------------------------------------
select (has_table_privilege('authenticated', 'storage.objects', 'insert')
    and has_table_privilege('authenticated', 'storage.objects', 'select'))::text as storage_grants \gset

\if :storage_grants

select set_config('request.jwt.claims', json_build_object('sub', :'staffa_uid', 'role', 'authenticated')::text, true);
set local role authenticated;

select lives_ok(
  format($$ insert into storage.objects (bucket_id, name) values ('photos', %L) $$,
         :'staffa' || '/selfie.jpg'),
  '§2.6 a worker writes a photo into their own staff-id folder');

select throws_ok(
  format($$ insert into storage.objects (bucket_id, name) values ('photos', %L) $$,
         :'staffb' || '/stolen.jpg'),
  '42501', null,
  'and cannot write into a colleague''s folder: the first path segment IS the authorisation');

select throws_ok(
  $$ insert into storage.objects (bucket_id, name) values ('documents', 'anything.pdf') $$,
  '42501', null,
  '§2.5 a worker cannot put an object in the documents bucket at all — right-to-work evidence goes through server code on the service key');

select is((select count(*)::int from storage.objects where bucket_id = 'photos'), 1,
  'the worker reads their own photo back, and only their own');

-- §10.1 the avatar is locked once set, and the lock covers the BYTES: an
-- upsert onto the object the office, the client line-up and every issued
-- sheet read is refused (20260927160200 dropped photos_worker_update_own).
with u as (update storage.objects set metadata = '{}'::jsonb
            where bucket_id = 'photos' and name = :'staffa' || '/selfie.jpg' returning 1)
  select is((select count(*)::int from u), 0,
    '§10.1 a worker cannot overwrite the object behind their locked photo path — a new face is a new object, and staff_set_photo() decides whether it may become the avatar');

reset role;
select set_config('request.jwt.claims', json_build_object('sub', :'admin_uid', 'role', 'authenticated')::text, true);
set local role authenticated;

select is((select count(*)::int from storage.objects where bucket_id = 'photos'), 1,
  '§9.6 an admin reads any worker''s photo, which is what puts it on the profile screen');

reset role;
select set_config('request.jwt.claims', json_build_object('sub', :'clienta_uid', 'role', 'authenticated')::text, true);
set local role authenticated;

select is((select count(*)::int from storage.objects where bucket_id = 'photos'), 0,
  '§11.1 a customer session — also `authenticated` — reads no worker''s selfie from the bucket: the line-up''s photos are signed by the server');
select throws_ok(
  format($$ insert into storage.objects (bucket_id, name) values ('photos', %L) $$,
         :'staffa' || '/planted.jpg'),
  '42501', null,
  'and cannot put an object into a worker''s folder');

reset role;

\else

select skip('authenticated holds no INSERT/SELECT privilege on storage.objects, so the photos policies cannot be exercised from here. Supabase grants these from the storage service, not from this repo — if this skip is showing on a real project, the photos upload will fail with 42501 and the grant is the thing to fix.', 8);

\endif

select * from finish();
rollback;
