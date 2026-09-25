-- =====================================================================
-- 250 · The rest of §1.7 (docs/14 O11)
--   remove_worker's Storage queue, the applications anonymisation,
--   willo_candidate_id, and the claim/complete pair behind gdpr-purge
--   from 20260922081512_gdpr_removal_reaches_the_rest.sql
--
-- 230 asserts what removal does to the rows. This file is about the
-- personal data that was NOT in those rows: the objects the records
-- pointed at, the public form's own copy of the worker's name, and a
-- live handle on a video at a third party.
--
-- The Storage half is a queue rather than a call because §1.7 is an
-- obligation, not a best effort: a row stays until the object is gone,
-- so an erasure survives Storage being unreachable.
-- =====================================================================
begin;
select plan(24);
\set now '2026-09-22 09:00:00+01'
\ir _shared/fixtures.psql

\set gone 'd5000000-0000-4000-8000-000000000001'
\set stay 'd5000000-0000-4000-8000-000000000002'

-- 20260926120000: blanking a verified right-to-work date needs the owner-only escape.
set local thc.allow_rtw_date_clear = 'on';
update compliance_docs set expiry_date = null, right_to_work_until = null;
set local thc.allow_rtw_date_clear = 'off';
update staff set right_to_work_until = null, term_dates = '{}';

insert into staff (id, employee_id, first_name, last_name, email, phone, dob, status,
                   rtw_branch, photo_path, willo_candidate_id) values
  (:'gone', 95101, 'Grace','Lindqvist','grace@example.com','+447700900501', date '1997-03-30',
   'compliant','uk_irish','photos/95101/selfie.jpg','willo_cand_abc123'),
  (:'stay', 95102, 'Stays','Here','stays@example.com','+447700900502', date '1996-01-01',
   'compliant','uk_irish','photos/95102/selfie.jpg','willo_cand_zzz999');

insert into compliance_docs (id, staff_id, doc_type, review_status, file_path, gov_report_path, uploaded_at) values
  ('e5000000-0000-4000-8000-000000000001', :'gone','passport','verified',
   'documents/95101/passport.pdf', null, :'now'::timestamptz),
  ('e5000000-0000-4000-8000-000000000002', :'gone','share_code_report','verified',
   'documents/95101/share-code.pdf', 'documents/95101/gov-report.pdf', :'now'::timestamptz),
  ('e5000000-0000-4000-8000-000000000003', :'stay','passport','verified',
   'documents/95102/passport.pdf', null, :'now'::timestamptz);

-- `dob` arrived with main's 20260921170000: §2.12 matches a returning
-- applicant on mobile AND date of birth, so the column is not null.
insert into applications (id, first_name, last_name, email, phone, dob, age_band, outcome, staff_id, consented_at) values
  ('f5000000-0000-4000-8000-000000000001','Grace','Lindqvist','grace@example.com','+447700900501',
   date '1997-03-30','25-34','candidate_created', :'gone', :'now'::timestamptz),
  ('f5000000-0000-4000-8000-000000000002','Grace','Lindqvist','grace@example.com','+447700900501',
   date '1997-03-30','25-34','returning_applicant', :'gone', :'now'::timestamptz),
  ('f5000000-0000-4000-8000-000000000003','Stays','Here','stays@example.com','+447700900502',
   date '1996-01-01','25-34','candidate_created', :'stay', :'now'::timestamptz);

create temporary table t_rm as select remove_worker(:'gone', :'now'::timestamptz) as r;

-- ---------------------------------------------------------------------
-- 1 · The objects. §1.7 says "documents / photo wiped" and deleting the
--     row that names one does not touch it.
-- ---------------------------------------------------------------------
select is((select r->>'filesQueued' from t_rm), '4',
  'every Storage object the worker''s records pointed at is queued: two documents, the gov.uk report and the selfie');
select bag_eq(
  $$ select bucket || '/' || path from storage_deletions where not prefix $$,
  $$ values ('documents/documents/95101/passport.pdf'::text),
            ('documents/documents/95101/share-code.pdf'),
            ('documents/documents/95101/gov-report.pdf'),
            ('photos/photos/95101/selfie.jpg') $$,
  'named individually, with their bucket — a path this function does not capture is one nothing can ever find again');
-- …and, since 20260926110300, the worker's two FOLDERS as prefixes: an
-- object that reached a bucket without a row (an upload whose finish…()
-- never ran, a selfie whose staff_set_photo() raised) is erased by the
-- prefix sweep, which nothing named could have found.
select bag_eq(
  $$ select bucket || '/' || path from storage_deletions where prefix $$,
  $$ values ('documents/d5000000-0000-4000-8000-000000000001/'::text),
            ('photos/d5000000-0000-4000-8000-000000000001/') $$,
  '§1.7 "documents / photo wiped": the worker''s <staff_id>/ folder in each bucket is queued as a prefix, so orphaned objects go too');
select is((select r->>'prefixesQueued' from t_rm), '2', 'and the removal reports the two prefixes');
select is_empty(
  format($$ select * from retained_storage_paths(%L) $$, :'gone'),
  'nothing under this worker is held back from the prefix sweep: no evidence carries retain_until (ADR-0019)');
select is((select count(*)::int from storage_deletions where path like '%95102%'), 0,
  'and nobody else''s objects are queued');
select is((select count(*)::int from compliance_docs where staff_id = :'gone'), 0,
  'the rows go, which is why the paths had to be read BEFORE they did');
select is((select count(*)::int from storage_deletions where deleted_at is null), 6,
  'nothing is marked deleted yet: SQL queues the obligation, the gdpr-purge job discharges it');

-- ---------------------------------------------------------------------
-- 2 · applications (§2.1). The row is the record that an application
--     happened; the person in it is not.
-- ---------------------------------------------------------------------
select is((select r->>'applicationsAnonymised' from t_rm), '2',
  'every submission the worker ever made is anonymised, not just the latest');
select is(
  (select first_name || ' ' || last_name from applications where id = 'f5000000-0000-4000-8000-000000000001'),
  'Deleted account', 'the name goes');
select is((select phone from applications where id = 'f5000000-0000-4000-8000-000000000001'),
  '+440000000000', 'and the phone');
select ok(
  (select email <> 'grace@example.com' and email like 'removed-%@invalid.example'
     from applications where id = 'f5000000-0000-4000-8000-000000000001'),
  'and the email, with one that can receive nothing');
select isnt(
  (select email from applications where id = 'f5000000-0000-4000-8000-000000000001'),
  (select email from applications where id = 'f5000000-0000-4000-8000-000000000002'),
  'keyed per submission rather than per worker, so the unique-ish shape of the column survives two applications from one person');
select is((select outcome::text from applications where id = 'f5000000-0000-4000-8000-000000000002'),
  'returning_applicant',
  'the outcome is retained — it is what the office did, not who they did it to');
select is((select count(*)::int from applications where staff_id = :'gone'), 2,
  'and the rows themselves are kept: §1.7 anonymises, it does not erase the record that something happened');
select is((select email from applications where id = 'f5000000-0000-4000-8000-000000000003'),
  'stays@example.com', 'nobody else''s application is touched');

-- §2.12 already held: the duplicate check reads `staff` and excludes a
-- removed worker outright, so "cannot be matched against" was never the
-- gap. This pins it so a future edit to submit_application cannot quietly
-- start matching a removed worker again.
select ok(
  (select removed_at is not null from staff where id = :'gone'),
  '§2.12: the removed worker is excluded from the duplicate check by removed_at, so they re-apply as a genuinely new candidate with a new Employee ID');

-- ---------------------------------------------------------------------
-- 3 · The third-party handle.
-- ---------------------------------------------------------------------
select is((select willo_candidate_id from staff where id = :'gone'), null,
  'the Willo candidate id is nulled — a live handle on an interview video is personal data');
select is((select data->>'willoCandidateId' from audit_log where action = 'gdpr_remove' and entity_id = :'gone'),
  'willo_cand_abc123',
  'but it is written to the audit row first, so the video can still be found and deleted when P3''s Willo account exists — nulling it alone would strand the video for ever');

-- ---------------------------------------------------------------------
-- 4 · The claim/complete pair the drain runs on.
-- ---------------------------------------------------------------------
select is((select count(*)::int from claim_storage_deletions(2)), 2,
  'the drain takes a batch, like the outbox''s claim');
select ok(
  (select pg_get_function_result(p.oid) like '%prefix boolean%staff_id uuid%'
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'claim_storage_deletions'),
  'and each claimed row says whether it is one object or a whole prefix, and whose, which is what the drain lists and what retained_storage_paths() keeps');
select is((select count(*)::int from storage_deletions where attempts = 1), 2,
  'and counts the attempt, so a path that can never be deleted becomes visible instead of being retried silently for ever');

select complete_storage_deletion((select id from storage_deletions order by id limit 1), true, null);
select is((select count(*)::int from storage_deletions where deleted_at is not null), 1,
  'a completed deletion is stamped and drops out of the queue');

select complete_storage_deletion((select id from storage_deletions order by id offset 1 limit 1), false, 'storage unreachable');
select is(
  (select coalesce(deleted_at::text, 'pending') || '/' || error
     from storage_deletions order by id offset 1 limit 1),
  'pending/storage unreachable',
  'and a failed one stays pending with its reason — §1.7 is an obligation, so an erasure must not be lost because Storage was briefly unreachable');

select * from finish();
rollback;
