-- =====================================================================
-- Migration 20260926110100 · the locked avatar is locked in Storage too,
--                            and the buckets carry their own limits
--                            (§10.1, §11.1, §2.5 point 7, §2.6)
--
-- 1 · photos_worker_update_own goes.
--
-- §10.1: "The avatar is set once during onboarding and then locked;
-- changing it afterwards also goes through the office." staff_set_photo()
-- enforces that on staff.photo_path (photo_locked), but the BYTES behind
-- the path were not locked: the UPDATE policy 20260922183015 added "for
-- upsert" let a worker overwrite the object at their locked path in
-- place — the face the office, the client line-up (§11.1 "so the customer
-- recognises the people") and every issued allocation sheet then showed
-- was whatever they uploaded last. Both apps have uploaded with
-- `upsert: false` to a fresh name per attempt since the lock existed
-- (PhotoField.tsx, SelfieStep.tsx), so nothing needs the policy. A worker
-- keeps INSERT (a new name each time) and SELECT of their own folder.
--
-- 2 · Bucket-level size and type limits.
--
-- §2.5 point 7 and §2.1: "PDF, JPG, PNG … up to 10 MB". The rule was
-- judged only after the bytes landed — evidence_upload_problem() reads
-- the object's metadata — so a phone could put objects of any size and
-- type into photos/<own id>/ with its own JWT, and any size into
-- documents through the signed upload, before anything said no. Storage
-- refuses at the door now; the SQL check stays as the second layer and
-- the one that names the reason on screen.
--
--   documents  10 MB · pdf, jpeg, png, heic, heif (the wizard's
--              evidence_upload_problem(p_allow_heic) already admits the
--              two Apple types on the branches that allow them)
--   photos      2 MB · jpeg only (the app downscales selfies to a 512 px
--              JPEG before upload)
--
-- reports and timesheets are written by the service role only and keep
-- no limit. Forward-only.
-- =====================================================================

drop policy if exists photos_worker_update_own on storage.objects;

update storage.buckets
   set file_size_limit   = 10485760,
       allowed_mime_types = array['application/pdf', 'image/jpeg', 'image/png', 'image/heic', 'image/heif']
 where id = 'documents';

update storage.buckets
   set file_size_limit   = 2097152,
       allowed_mime_types = array['image/jpeg']
 where id = 'photos';
