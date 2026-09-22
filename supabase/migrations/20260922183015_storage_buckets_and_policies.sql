-- =====================================================================
-- Migration 20260922183015 · the four Storage buckets, in the repo
--                            (§1.7, §2.5, §2.6, §9.8, §11.3)
--
-- Why this exists
-- ---------------
-- `documents`, `photos`, `reports` and `timesheets` were a bullet in
-- docs/04-setup-github-vercel-supabase.md — "Storage buckets (private):
-- …" — and a hand click in the dashboard. Nothing in the repo created
-- them, nothing asserted their settings, and no pgTAP test would have
-- gone red if one of them had been created with `public = true`.
--
-- `documents` holds passport scans, visa documents, share-code reports
-- and university letters (§2.5, §2.6). A public bucket in Supabase is
-- not "readable by signed-in users": every object in it is served from
-- an unauthenticated URL, and object names are enumerable. The default
-- for `storage.objects` is deny-all, so the hand-made buckets are very
-- probably fine today — but "probably fine and untested" is how the
-- other findings in this pass got in, and this is the one where being
-- wrong means publishing a thousand people's identity documents.
--
-- So: the buckets are created here, `public = false` is asserted on
-- every deploy by the upsert below AND by 320_storage.sql, and the one
-- policy the apps actually need is written down instead of clicked.
--
-- Ownership note
-- --------------
-- `storage.objects` and `storage.buckets` are owned by
-- supabase_storage_admin, not by the migration role. Creating policies
-- on them from SQL is Supabase's own documented route (it is what the
-- dashboard's Storage → Policies screen emits), and `insert into
-- storage.buckets` is its documented way to create a bucket. What this
-- migration deliberately does NOT do is `alter table storage.objects
-- enable row level security`: that needs ownership, Supabase has it on
-- already, and an ALTER that failed would take the whole deploy with it.
-- 320_storage.sql asserts the RLS flag instead, so if a future Supabase
-- version ships it off, the suite says so.
--
-- What each bucket gets
-- ---------------------
-- photos      — §2.6 selfie, §9.8 profile photo. A worker writes their
--               own and reads their own; an admin reads any. This is the
--               one the Staff App needs now, so it is the one with a
--               working policy.
-- documents   — §2.5/§2.6 right-to-work evidence. DELIBERATELY no anon
--               or authenticated policy: deny-all. Uploads and signed
--               URLs go through server code holding the service key,
--               which bypasses RLS. A worker-writes-own policy here
--               would be the same shape as the photos one, but it is not
--               written until the screen that needs it exists — an
--               unused policy on the passport bucket is a standing
--               privilege nobody is testing against a real flow.
-- reports     — §9.9 payroll and finance CSVs. Money. Service role only.
-- timesheets  — §11.3 allocation sheets and sign-out timesheets. Carries
--               names and pay lines. Service role only.
--
-- Path convention for `photos`: `<staff_id>/<anything>`. The first
-- folder segment IS the authorisation, so it is the only part the policy
-- reads. The worker's staff id is reached through `staff`, which they
-- hold `staff_self` on (0001), so the subquery resolves as the caller
-- with no extra privilege.
--
-- Forward-only.
-- =====================================================================

-- ---------------------------------------------------------------------
-- The buckets. `on conflict … do update` rather than `do nothing`: the
-- point of putting them in a migration is that a bucket someone flipped
-- to public in the dashboard is flipped back on the next deploy.
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('documents',  'documents',  false),
       ('photos',     'photos',     false),
       ('reports',    'reports',    false),
       ('timesheets', 'timesheets', false)
on conflict (id) do update set public = false;

-- ---------------------------------------------------------------------
-- photos · a worker writes and reads their own, an admin reads any.
--
-- `(select auth.uid())` and not a bare `auth.uid()`, for the reason
-- 20260921123503 gives for the 15 policies it rewrote: bare, it is
-- evaluated once per row scanned; wrapped, the planner hoists it into an
-- InitPlan and evaluates it once per statement. 002_schema_hardening
-- assertion 4 only inspects schema `public`, so nothing enforces that
-- here — it is written correctly because it is correct, and the note is
-- for whoever adds the `documents` policies later.
--
-- UPDATE as well as INSERT because Supabase's client `upload(…, {upsert:
-- true})` issues an update when the object already exists — a worker
-- replacing their profile photo (§9.8) is the ordinary case, not an edge
-- one. No DELETE for anybody but the service role: §1.7 erasure is the
-- storage_deletions queue (20260922081512), drained by an Edge Function,
-- and a worker who could delete their own objects could delete the
-- evidence of an issued document.
-- ---------------------------------------------------------------------
drop policy if exists photos_worker_insert_own on storage.objects;
create policy photos_worker_insert_own on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'photos'
    and (storage.foldername(name))[1] = (
      select s.id::text from public.staff s where s.user_id = (select auth.uid())));

drop policy if exists photos_worker_update_own on storage.objects;
create policy photos_worker_update_own on storage.objects
  for update to authenticated
  using (
    bucket_id = 'photos'
    and (storage.foldername(name))[1] = (
      select s.id::text from public.staff s where s.user_id = (select auth.uid())))
  with check (
    bucket_id = 'photos'
    and (storage.foldername(name))[1] = (
      select s.id::text from public.staff s where s.user_id = (select auth.uid())));

drop policy if exists photos_worker_read_own on storage.objects;
create policy photos_worker_read_own on storage.objects
  for select to authenticated
  using (
    bucket_id = 'photos'
    and (storage.foldername(name))[1] = (
      select s.id::text from public.staff s where s.user_id = (select auth.uid())));

-- §9.6: the office sees the worker's photo on their profile. Read only —
-- the Back Office never writes a worker's selfie.
drop policy if exists photos_admin_read on storage.objects;
create policy photos_admin_read on storage.objects
  for select to authenticated
  using (bucket_id = 'photos' and public.current_app_role() = 'admin');

-- No `comment on table storage.buckets` here, deliberately. COMMENT needs
-- ownership of the table, which is one more way this migration could fail
-- on a project where the migration role is not a member of
-- supabase_storage_admin — and a comment is not worth a failed deploy. What
-- the buckets are for lives in this header, in docs/04 and in
-- 320_storage.sql.
