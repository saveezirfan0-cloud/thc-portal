-- Removes what the demo recordings added to a Supabase project: the seed and
-- review data (supabase/seed.sql, supabase/demo/review-data.sql), the six demo
-- logins, the onboarding candidate, and the extra shift added for the Staff App
-- video. Everything is matched by the fixed ids those files use, so nothing
-- that was in the project before is touched.
--
-- Before running it, set :candidate_staff and :candidate_user to the ids of the
-- onboarding candidate (staff.id and auth.users.id of DEMO_CANDIDATE_EMAIL), or
-- leave them as the nil uuid to skip that part. Run it in the SQL editor or with
-- psql; it is one transaction.
--
-- The Storage objects the candidate uploaded are not SQL's to delete: remove
-- them through the Storage API (see cleanup-storage.mjs).
--
-- What it cannot undo: Employee IDs handed out (the sequence only moves on),
-- audit_log rows (append-only), and job_runs.
begin;

-- Dependents that do not cascade, before the rows they point at.
delete from feedback where id::text like '75000000-0000-4000-8000-%';

delete from event_document_autosends where event_id::text like '60000000-0000-4000-8000-%' or event_id::text like '70000000-0000-4000-8000-%';
delete from event_documents           where event_id::text like '60000000-0000-4000-8000-%' or event_id::text like '70000000-0000-4000-8000-%';

-- Events, then their sections and bookings (and check-ins, breaks, violations) cascade.
delete from events where id::text like '60000000-0000-4000-8000-%' or id::text like '70000000-0000-4000-8000-%';

delete from client_qualifications where client_id::text like '40000000-0000-4000-8000-%';
delete from client_rate_cards     where client_id::text like '40000000-0000-4000-8000-%';
delete from clients               where id::text like '40000000-0000-4000-8000-%';
delete from venues                where id::text like '50000000-0000-4000-8000-%';

-- Applications and queued notifications point at staff without cascading.
delete from applications where id::text like '76000000-0000-4000-8000-%'
   or staff_id::text like '20000000-0000-4000-8000-%';
delete from notification_outbox where recipient_staff_id::text like '20000000-0000-4000-8000-%';

-- The seeded workers. THE ONE WORKER (…0005, Grace Lindqvist) was already in the
-- project before the recordings and is left alone.
delete from staff where id::text like '20000000-0000-4000-8000-%'
  and id <> '20000000-0000-4000-8000-000000000005';

-- The onboarding candidate.
\set candidate_staff '00000000-0000-0000-0000-000000000000'
\set candidate_user  '00000000-0000-0000-0000-000000000000'
delete from applications         where staff_id = :'candidate_staff';
delete from notification_outbox  where recipient_staff_id = :'candidate_staff';
delete from staff                where id = :'candidate_staff';

-- The demo logins.
delete from profiles where id::text like '10000000-0000-4000-8000-%' or id = :'candidate_user';
delete from auth.users where id::text like '10000000-0000-4000-8000-%' or id = :'candidate_user';

commit;
