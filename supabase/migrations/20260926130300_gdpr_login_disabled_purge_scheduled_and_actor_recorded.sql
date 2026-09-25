-- =====================================================================
-- Migration 20260926130300 · §1.7 removal disables the login, the Storage
--                            purge is actually scheduled and erases by
--                            prefix, and the office's irreversible
--                            actions record who pressed them
--                            (§1.7, §9.6, §4.3; ADR-0019)
--
-- 1 · "login disabled" (§1.7; wireframes/staff/auth.html: "A GDPR-removed
--     account cannot sign in at all"). remove_worker() only nulled
--     staff.user_id — the comment said "login unlinked" — so a removed
--     worker could still sign in with their old password and land on an
--     unlocked staff shell. The auth.users row is now BANNED (GoTrue's
--     banned_until, a century out) and its sessions and refresh tokens
--     deleted, BEFORE user_id is nulled so the id is still known. The
--     office never has to remember a second admin-API call.
--
-- 2 · The purge was never scheduled. remove_worker() queues objects into
--     storage_deletions and the gdpr-purge Edge Function drains them —
--     but job_schedules had no 'gdpr-purge' row, so nothing ever ran it
--     and every removed worker's passport scan and selfie stayed in
--     Storage. Registered here, enabled: the function exists.
--
-- 3 · Erase by prefix, not by name. The queue only ever named the paths a
--     row still pointed at, so an object that reached a bucket without a
--     row — an upload whose finish…() never ran, a selfie whose
--     staff_set_photo() raised — survived erasure under the removed
--     worker's <staff_id>/ folder. remove_worker() now also queues the
--     two folders themselves (prefix = true); the drain lists them and
--     removes everything found EXCEPT the paths retained_storage_paths()
--     still names (ADR-0019's held completion letter).
--
-- 4 · The actor. remove_worker, block_worker_manually, unblock_worker and
--     reset_to_candidate wrote audit_log.actor = auth.uid(), but all four
--     are service-role-only and the office reaches them through the
--     service key, whose JWT has no sub — so every irreversible removal
--     and every block was recorded with NO actor. Each takes p_actor
--     (default null, so every existing call shape still resolves) and
--     writes coalesce(p_actor, auth.uid()). The office passes the
--     signed-in manager's id. Block and Unblock now write an audit row at
--     all (they wrote none), so the §9.6 profile banner can say who
--     blocked, when, and what was released — staff_block_audit_v.
--
-- Signatures change (a parameter is added), so the old ones are dropped
-- rather than left as overloads; grants are restated. Forward-only.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 2 · The schedule
-- ---------------------------------------------------------------------
insert into job_schedules (job, cron_expression, edge_path, enabled, note) values
  ('gdpr-purge', '*/5 * * * *', 'gdpr-purge', true,
   '§1.7 Storage purge: drains storage_deletions (objects and whole <staff_id>/ prefixes queued by remove_worker). Idempotent; a row stays until the object is gone.')
on conflict (job) do nothing;

-- ---------------------------------------------------------------------
-- 3 · Prefix rows, and what the drain must keep
-- ---------------------------------------------------------------------
alter table storage_deletions add column if not exists prefix boolean not null default false;

comment on column storage_deletions.prefix is
  'True: `path` is a folder (<staff_id>/) and the drain lists it recursively and removes everything found except retained_storage_paths(staff_id). False: one named object.';

drop function if exists public.claim_storage_deletions(int);
create function public.claim_storage_deletions(p_limit int default 100)
returns table (id bigint, bucket text, path text, prefix boolean, staff_id uuid)
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
  returning t.id, t.bucket, t.path, t.prefix, t.staff_id
$$;

comment on function public.claim_storage_deletions(int) is
  'gdpr-purge takes a batch of pending deletions (named objects and prefixes) under skip-locked, counting the attempt.';

-- The paths a prefix sweep must NOT remove: evidence held under a legal
-- retention (ADR-0019). Nothing else under a removed worker's folder is
-- retained by anything.
create or replace function public.retained_storage_paths(p_staff uuid)
returns setof text
language sql
stable
security definer
set search_path = public, extensions
as $$
  select d.file_path from compliance_docs d
   where d.staff_id = p_staff and d.retain_until is not null and d.file_path is not null
  union
  select d.gov_report_path from compliance_docs d
   where d.staff_id = p_staff and d.retain_until is not null and d.gov_report_path is not null
$$;

comment on function public.retained_storage_paths(uuid) is
  '§1.7 + ADR-0019: the Storage paths of a removed worker that a prefix purge must keep — evidence rows carrying retain_until. Service role only.';

revoke execute on function public.claim_storage_deletions(int)      from public, anon, authenticated;
revoke execute on function public.retained_storage_paths(uuid)      from public, anon, authenticated;
grant  execute on function public.claim_storage_deletions(int)      to service_role;
grant  execute on function public.retained_storage_paths(uuid)      to service_role;

-- ---------------------------------------------------------------------
-- 1 + 3 + 4 · remove_worker, from 20260923100100
-- ---------------------------------------------------------------------
drop function if exists public.remove_worker(uuid, timestamptz);
create function public.remove_worker(
  p_staff uuid,
  p_now   timestamptz default now(),
  p_actor uuid        default null
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
  v_held int := 0;
  v_today date := (p_now at time zone 'Europe/London')::date;
  v_retain date;
  v_login_disabled boolean := false;
  v_actor uuid := coalesce(p_actor, auth.uid());
begin
  select * into v from staff where id = p_staff for update;
  if v.id is null then
    raise exception 'unknown_staff' using errcode = 'P0001';
  end if;
  if v.status = 'removed' then
    return jsonb_build_object('staffId', p_staff::text, 'alreadyRemoved', true);
  end if;

  v_cascade := block_worker(p_staff, null, null, p_now, 'removed', 'gdpr');

  -- §1.7 "login disabled". GoTrue refuses a sign-in while banned_until is
  -- in the future, and a live session cannot outlast its refresh token.
  -- Done while user_id is still known. A schema this cannot write is a
  -- deployment fault and is raised, not swallowed: a removal that leaves
  -- the login open is not a removal.
  if v.user_id is not null then
    begin
      execute 'update auth.users set banned_until = $1, updated_at = now() where id = $2'
        using p_now + interval '100 years', v.user_id;
      v_login_disabled := found;
      if to_regclass('auth.sessions') is not null then
        execute 'delete from auth.sessions where user_id = $1' using v.user_id;
      end if;
      if to_regclass('auth.refresh_tokens') is not null then
        execute 'delete from auth.refresh_tokens where user_id = $1' using v.user_id::text;
      end if;
    exception when insufficient_privilege or undefined_table or undefined_column then
      raise exception 'gdpr_login_not_disabled: %', sqlerrm using errcode = '42501';
    end;
  end if;

  if v.contract_signed_at is not null or v.employee_id is not null then
    v_retain := ((coalesce(v.left_at, p_now) at time zone 'Europe/London')::date
                 + interval '2 years')::date;
  end if;

  if v_retain is not null and v_retain > v_today then
    with h as (
      update compliance_docs set retain_until = v_retain
       where staff_id = p_staff
         and doc_type = 'university_completion_letter'
      returning 1
    ) select count(*)::int into v_held from h;
  end if;

  with paths as (
    select 'documents'::text as bucket, d.file_path as path
      from compliance_docs d
     where d.staff_id = p_staff and d.file_path is not null and d.retain_until is null
    union
    select 'documents', d.gov_report_path
      from compliance_docs d
     where d.staff_id = p_staff and d.gov_report_path is not null and d.retain_until is null
    union
    select 'documents', v.wtr_optout_copy_path where v.wtr_optout_copy_path is not null
    union
    select 'photos', v.photo_path where v.photo_path is not null
  ), queued as (
    insert into storage_deletions (bucket, path, staff_id)
    select bucket, path, p_staff from paths
    on conflict (bucket, path) do nothing
    returning 1
  ) select count(*)::int into v_files from queued;

  -- The folders themselves: anything that reached a bucket without a row.
  insert into storage_deletions (bucket, path, staff_id, prefix)
  values ('documents', p_staff::text || '/', p_staff, true),
         ('photos',    p_staff::text || '/', p_staff, true)
  on conflict (bucket, path) do nothing;

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
         course_completion_date = null,
         below_degree_level = false,
         wtr_optout  = false,
         wtr_optout_cancelled_from = null,
         wtr_optout_signed_at = null,
         wtr_optout_notice_days = null,
         wtr_optout_copy_path = null,
         leave_reason = null,
         willo_candidate_id = null,
         user_id     = null,
         removed_at  = p_now
   where id = p_staff;

  with d as (delete from compliance_docs
              where staff_id = p_staff and retain_until is null
             returning 1)
    select count(*)::int into v_docs from d;
  delete from bank_details      where staff_id = p_staff;
  delete from staff_references  where staff_id = p_staff;
  delete from hmrc_checklists   where staff_id = p_staff;
  delete from push_subscriptions where staff_id = p_staff;

  update criminal_declarations
     set details = null, conviction_date = null
   where staff_id = p_staff;

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
  values (p_now, v_actor, 'gdpr_remove', 'staff', p_staff,
          jsonb_build_object('employeeId', v.employee_id,
                             'fromStatus', v.status::text,
                             'documentsDeleted', v_docs,
                             'documentsHeld', v_held,
                             'retainUntil', v_retain,
                             'filesQueued', v_files,
                             'prefixesQueued', 2,
                             'loginDisabled', v_login_disabled,
                             'applicationsAnonymised', v_apps,
                             'willoCandidateId', v.willo_candidate_id));

  return v_cascade || jsonb_build_object(
    'label', deleted_account_label(v.employee_id),
    'documentsDeleted', v_docs,
    'documentsHeld', v_held,
    'retainUntil', case when v_held > 0 then v_retain end,
    'filesQueued', v_files,
    'prefixesQueued', 2,
    'loginDisabled', v_login_disabled,
    'applicationsAnonymised', v_apps);
end $$;

comment on function public.remove_worker(uuid, timestamptz, uuid) is
  '§1.7 GDPR removal. Irreversible anonymisation; login DISABLED (auth.users banned, sessions and refresh tokens deleted); documents, bank details, referees, checklist and push subscriptions deleted; files AND the worker''s two Storage folders queued for gdpr-purge; future bookings released. EXCEPT a completion letter of someone who was employed, removed inside employment + 2 years: held with retain_until and purged by rtw_daily() when the window closes (completion letter requirement §4, ADR-0019). p_actor is the manager who pressed it (the service key carries no sub).';

-- ---------------------------------------------------------------------
-- 4 · block_worker_manually, from 20260921183945, now audited
-- ---------------------------------------------------------------------
drop function if exists public.block_worker_manually(uuid, text, timestamptz);
create function public.block_worker_manually(
  p_staff  uuid,
  p_reason text,
  p_now    timestamptz default now(),
  p_actor  uuid        default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare v jsonb;
begin
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'reason_required' using errcode = 'P0001';
  end if;
  v := block_worker(p_staff, 'manual', trim(p_reason), p_now);
  insert into audit_log (at, actor, action, entity, entity_id, data)
  values (p_now, coalesce(p_actor, auth.uid()), 'block_manual', 'staff', p_staff,
          jsonb_build_object('reason', trim(p_reason),
                             'released', v->'released',
                             'withdrawn', v->'withdrawn'));
  return v;
end $$;

comment on function public.block_worker_manually(uuid, text, timestamptz, uuid) is
  '§9.6 Block. The §4.3 cascade with block_kind = manual and a mandatory reason, shown on the profile as "Blocked — <reason>"; writes the audit row (actor, when, reason, bookings released, invitations withdrawn) the profile banner reads through staff_block_audit_v.';

-- ---------------------------------------------------------------------
-- 4 · unblock_worker, from 20260921183945, now audited
-- ---------------------------------------------------------------------
drop function if exists public.unblock_worker(uuid, date);
create function public.unblock_worker(
  p_staff uuid,
  p_on    date default current_date,
  p_actor uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v staff;
  v_reasons text[];
begin
  select * into v from staff where id = p_staff for update;
  if v.id is null then
    raise exception 'unknown_staff' using errcode = 'P0001';
  end if;
  if v.status <> 'blocked' then
    raise exception 'not_blocked' using errcode = 'P0001';
  end if;

  select array_agg(reason order by reason) into v_reasons
    from compliance_blockers(p_staff, p_on);

  if v_reasons is not null then
    return jsonb_build_object('unblocked', false, 'blockers', to_jsonb(v_reasons));
  end if;

  perform assert_staff_transition(v.status, 'compliant'::staff_status);
  update staff set status = 'compliant', block_kind = null, block_reason = null
   where id = p_staff;

  insert into audit_log (at, actor, action, entity, entity_id, data)
  values (now(), coalesce(p_actor, auth.uid()), 'unblock', 'staff', p_staff,
          jsonb_build_object('blockKind', v.block_kind::text,
                             'reason', v.block_reason,
                             'checkedOn', p_on));
  return jsonb_build_object('unblocked', true, 'blockers', '[]'::jsonb);
end $$;

comment on function public.unblock_worker(uuid, date, uuid) is
  '§9.6 Unblock. Runs the §4.3 full compliance check first and reports what is still outstanding when it refuses. Lifts any block_kind, manual included — unlike unblock_if_compliant(), which no automatic caller may use on a human decision. Audited with the manager as actor.';

-- ---------------------------------------------------------------------
-- 4 · reset_to_candidate, from 20260923100100, with the actor
-- ---------------------------------------------------------------------
drop function if exists public.reset_to_candidate(uuid, text, timestamptz);
create function public.reset_to_candidate(
  p_staff  uuid,
  p_reason text,
  p_now    timestamptz default now(),
  p_actor  uuid        default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v staff;
  v_docs int := 0;
  v_decl int := 0;
  v_hmrc int := 0;
begin
  select * into v from staff where id = p_staff for update;
  if v.id is null then
    raise exception 'unknown_staff' using errcode = 'P0001';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'reason_required' using errcode = 'P0001';
  end if;
  if v.status not in ('blocked', 'rejected', 'inactive') then
    raise exception 'not_resettable: %', v.status using errcode = 'P0001';
  end if;
  perform assert_staff_transition(v.status, 'interview_requested'::staff_status);

  with d as (
    update compliance_docs set review_status = 'superseded'
     where staff_id = p_staff and review_status <> 'superseded'
    returning 1
  ) select count(*)::int into v_docs from d;

  with c as (
    update criminal_declarations set superseded = true
     where staff_id = p_staff and not superseded
    returning 1
  ) select count(*)::int into v_decl from c;

  with h as (
    update hmrc_checklists set superseded = true
     where staff_id = p_staff and not superseded
    returning 1
  ) select count(*)::int into v_hmrc from h;

  update staff
     set status = 'interview_requested',
         block_kind = null,
         block_reason = null,
         contract_signed_at = null,
         contract_version = null,
         quiz_attempts = 0,
         share_code = null,
         right_to_work_until = null,
         rtw_branch = null,
         term_dates = '{}',
         graduated_at = null,
         course_completion_date = null,
         wtr_optout = false,
         wtr_optout_cancelled_from = null,
         wtr_optout_signed_at = null,
         wtr_optout_notice_days = null,
         wtr_optout_copy_path = null
   where id = p_staff;

  insert into audit_log (at, actor, action, entity, entity_id, data)
  values (p_now, coalesce(p_actor, auth.uid()), 'reset_to_candidate', 'staff', p_staff,
          jsonb_build_object('reason', trim(p_reason),
                             'fromStatus', v.status::text,
                             'employeeId', v.employee_id,
                             'leftAt', v.left_at,
                             'leaveReason', v.leave_reason,
                             -- What the superseded evidence had set, so the
                             -- previous period's cap can still be explained.
                             'courseCompletionDate', v.course_completion_date,
                             'graduatedAt', v.graduated_at,
                             'wtrOptout', v.wtr_optout));

  return jsonb_build_object(
    'staffId', p_staff::text,
    'fromStatus', v.status::text,
    'employeeId', v.employee_id,
    'docsSuperseded', v_docs,
    'declarationsSuperseded', v_decl,
    'checklistsSuperseded', v_hmrc);
end $$;

comment on function public.reset_to_candidate(uuid, text, timestamptz, uuid) is
  '§9.6 / §2.12 Reset to candidate: status → interview_requested, Employee ID retained, evidence superseded, history kept; the previous period''s completion-letter and WTR facts are cleared from the row and recorded in the audit row (p_actor = the manager).';

-- ---------------------------------------------------------------------
-- Grants: service role only, as before (20260921183945, 20260921190118).
-- ---------------------------------------------------------------------
revoke execute on function public.remove_worker(uuid, timestamptz, uuid)             from public, anon, authenticated;
revoke execute on function public.block_worker_manually(uuid, text, timestamptz, uuid) from public, anon, authenticated;
revoke execute on function public.unblock_worker(uuid, date, uuid)                    from public, anon, authenticated;
revoke execute on function public.reset_to_candidate(uuid, text, timestamptz, uuid)   from public, anon, authenticated;
grant  execute on function public.remove_worker(uuid, timestamptz, uuid)              to service_role;
grant  execute on function public.block_worker_manually(uuid, text, timestamptz, uuid) to service_role;
grant  execute on function public.unblock_worker(uuid, date, uuid)                    to service_role;
grant  execute on function public.reset_to_candidate(uuid, text, timestamptz, uuid)   to service_role;

-- ---------------------------------------------------------------------
-- 4 · What the profile banner reads (§9.6 "they see the reason first")
-- ---------------------------------------------------------------------
create or replace view staff_block_audit_v with (security_invoker = true, security_barrier = true) as
select distinct on (a.entity_id)
  a.entity_id                          as staff_id,
  a.action,
  a.at,
  a.actor,
  p.full_name                          as actor_name,
  a.data->>'reason'                    as reason,
  (a.data->>'released')::int           as released,
  (a.data->>'withdrawn')::int          as withdrawn
from audit_log a
left join profiles p on p.id = a.actor
where a.entity = 'staff'
  and a.action in ('block_manual', 'unblock')
order by a.entity_id, a.at desc, a.id desc;

comment on view staff_block_audit_v is
  '§9.6: the latest manual Block or Unblock on each worker — who, when (a UK stamp on screen), the reason, and how many future bookings were released and invitations withdrawn. Admin-only through the audit_log policy (security_invoker).';

revoke all on staff_block_audit_v from public, anon;
grant select on staff_block_audit_v to authenticated;
