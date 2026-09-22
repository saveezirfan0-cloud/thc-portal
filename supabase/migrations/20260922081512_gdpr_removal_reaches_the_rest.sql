-- =====================================================================
-- GDPR removal reaches the rest of it (§1.7, docs/14 O11)
--
-- 20260921190118 anonymised the profile, deleted the documents, bank
-- details, referees, checklist and push subscriptions, and released the
-- future work. Three places kept personal data anyway, and this closes
-- all three.
--
--   1. The FILES. Deleting a compliance_docs row does not delete the
--      passport scan it pointed at — Storage keeps the object, and SQL
--      cannot call the Storage API. §1.7 says "contacts / documents /
--      photo wiped", so the object has to go too. Queued here, drained
--      by the gdpr-purge Edge Function, which needs no key the platform
--      does not already hold.
--   2. `applications`. The public form (§2.1) stores a name, email and
--      phone per submission. The §2.12 duplicate check already ignores a
--      removed worker (`where s.removed_at is null`, 20260921150000) and
--      reads `staff` rather than this table, so matching was never the
--      problem — the problem is that an irreversible anonymisation left
--      the worker's name and contact details sitting in a table it never
--      touched. Anonymised in place: the row survives as the record that
--      an application happened and what the office did with it.
--   3. `staff.willo_candidate_id`. A live handle on the interview video
--      at a third party. Nulled. Deleting the video itself is a Willo API
--      call that waits on P3's account — the id is written to the audit
--      row first so it can be found and deleted when that lands, rather
--      than being orphaned by this migration.
-- =====================================================================

-- ---------------------------------------------------------------------
-- The queue.
--
-- A table rather than a direct call, for the reason the rest of the jobs
-- layer is a table: removal must not fail because Storage is briefly
-- unreachable, and an erasure obligation must not be lost when it does.
-- The row is the evidence that the deletion is owed, and it stays until
-- the object is gone.
-- ---------------------------------------------------------------------
create table if not exists storage_deletions (
  id          bigint generated always as identity primary key,
  bucket      text        not null,
  path        text        not null,
  staff_id    uuid        references staff(id) on delete set null,
  queued_at   timestamptz not null default now(),
  attempts    int         not null default 0,
  deleted_at  timestamptz,
  error       text,
  constraint storage_deletions_once unique (bucket, path)
);
create index if not exists storage_deletions_pending_idx
  on storage_deletions (queued_at) where deleted_at is null;

comment on table storage_deletions is
  'Storage objects a §1.7 removal owes but SQL cannot delete. Drained by the gdpr-purge Edge Function; a row stays until deleted_at is set, so an erasure obligation survives Storage being unreachable.';

alter table storage_deletions enable row level security;
drop policy if exists admin_read on storage_deletions;
-- Admin-read only, like job_runs and the outbox: written by a definer
-- function, drained by the service role, and carrying a path that names
-- a document nobody but the office should be able to enumerate.
create policy admin_read on storage_deletions for select using (current_app_role() = 'admin');

-- ---------------------------------------------------------------------
-- Remove (§1.7), reaching all of it.
-- ---------------------------------------------------------------------
create or replace function public.remove_worker(
  p_staff uuid,
  p_now   timestamptz default now()
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v staff;
  v_cascade jsonb;
  v_docs int := 0;
  v_files int := 0;
  v_apps int := 0;
begin
  select * into v from staff where id = p_staff for update;
  if v.id is null then
    raise exception 'unknown_staff' using errcode = 'P0001';
  end if;
  if v.status = 'removed' then
    return jsonb_build_object('staffId', p_staff::text, 'alreadyRemoved', true);
  end if;

  v_cascade := block_worker(p_staff, null, null, p_now, 'removed', 'gdpr');

  -- The objects, BEFORE the rows that name them are deleted. A path this
  -- function does not capture here is one nothing can ever find again.
  with paths as (
    select 'documents'::text as bucket, d.file_path as path
      from compliance_docs d where d.staff_id = p_staff and d.file_path is not null
    union
    select 'documents', d.gov_report_path
      from compliance_docs d where d.staff_id = p_staff and d.gov_report_path is not null
    union
    select 'photos', v.photo_path where v.photo_path is not null
  ), queued as (
    insert into storage_deletions (bucket, path, staff_id)
    select bucket, path, p_staff from paths
    on conflict (bucket, path) do nothing
    returning 1
  ) select count(*)::int into v_files from queued;

  update staff
     set first_name  = 'Deleted',
         last_name   = 'account',
         email       = 'removed-' || coalesce(v.employee_id::text, replace(p_staff::text, '-', '')) || '@invalid.example',
         phone       = '+440000000000',
         dob         = date '1900-01-01',
         home_address = null,
         home_location = null,
         photo_path  = null,
         ni_number   = null,
         share_code  = null,
         right_to_work_until = null,
         rtw_branch  = null,
         term_dates  = '{}',
         graduated_at = null,
         wtr_optout  = false,
         leave_reason = null,
         -- The handle on the interview video. The video itself is a Willo
         -- API call this platform cannot make until P3's account exists;
         -- the id goes into the audit row below so it can still be found.
         willo_candidate_id = null,
         user_id     = null,
         removed_at  = p_now
   where id = p_staff;

  with d as (delete from compliance_docs  where staff_id = p_staff returning 1)
    select count(*)::int into v_docs from d;
  delete from bank_details      where staff_id = p_staff;
  delete from staff_references  where staff_id = p_staff;
  delete from hmrc_checklists   where staff_id = p_staff;
  delete from push_subscriptions where staff_id = p_staff;

  update criminal_declarations
     set details = null, conviction_date = null
   where staff_id = p_staff;

  -- §2.1's submissions. The row is the record that an application
  -- happened and what the office decided; the person in it is not.
  with a as (
    update applications
       set first_name = 'Deleted',
           last_name  = 'account',
           email      = 'removed-' || id::text || '@invalid.example',
           phone      = '+440000000000'
     where staff_id = p_staff
       and email not like 'removed-%@invalid.example'
    returning 1
  ) select count(*)::int into v_apps from a;

  insert into audit_log (at, actor, action, entity, entity_id, data)
  values (p_now, auth.uid(), 'gdpr_remove', 'staff', p_staff,
          jsonb_build_object('employeeId', v.employee_id,
                             'fromStatus', v.status::text,
                             'documentsDeleted', v_docs,
                             'filesQueued', v_files,
                             'applicationsAnonymised', v_apps,
                             -- Kept so the Willo video is findable when
                             -- P3 lands. It is an identifier at a third
                             -- party, not personal data in itself, and
                             -- losing it strands the video for ever.
                             'willoCandidateId', v.willo_candidate_id));

  return v_cascade || jsonb_build_object(
    'label', deleted_account_label(v.employee_id),
    'documentsDeleted', v_docs,
    'filesQueued', v_files,
    'applicationsAnonymised', v_apps);
end $$;

comment on function public.remove_worker(uuid, timestamptz) is
  '§1.7 GDPR removal. Irreversible anonymisation across staff, applications and the declaration details; documents, bank details, referees, checklist and push subscriptions deleted; the Storage objects queued for the gdpr-purge job; login unlinked; future bookings released. History — bookings, feedback, violations, check-ins, the Employee ID — is retained for reporting, and feedback text is retained verbatim (v1: the office redacts by hand).';

-- ---------------------------------------------------------------------
-- The drain's claim, same shape as the outbox's (20260921130927): take a
-- batch, count the attempt, and let a failure come back rather than
-- vanishing. There is no backoff curve here — a Storage outage is not a
-- per-object problem — but attempts are counted so a path that can never
-- be deleted becomes visible instead of being retried for ever.
-- ---------------------------------------------------------------------
create or replace function public.claim_storage_deletions(p_limit int default 100)
returns table (id bigint, bucket text, path text)
language sql
security definer
set search_path = public, extensions
as $$
  with claimed as (
    select d.id from storage_deletions d
     where d.deleted_at is null
     order by d.queued_at
     limit greatest(p_limit, 1)
     for update skip locked
  )
  update storage_deletions t
     set attempts = t.attempts + 1
    from claimed c
   where t.id = c.id
  returning t.id, t.bucket, t.path
$$;

create or replace function public.complete_storage_deletion(
  p_id    bigint,
  p_ok    boolean,
  p_error text default null
) returns void
language sql
security definer
set search_path = public, extensions
as $$
  update storage_deletions
     set deleted_at = case when p_ok then now() end,
         error      = case when p_ok then null else p_error end
   where id = p_id
$$;

revoke execute on function public.claim_storage_deletions(int)
  from public, anon, authenticated;
revoke execute on function public.complete_storage_deletion(bigint, boolean, text)
  from public, anon, authenticated;
grant  execute on function public.claim_storage_deletions(int)                     to service_role;
grant  execute on function public.complete_storage_deletion(bigint, boolean, text) to service_role;
