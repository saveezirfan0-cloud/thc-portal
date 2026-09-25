-- =====================================================================
-- Migration 20260929140100 · §1.7 GDPR removal reaches every copy of the
--                            worker's personal data (audit 25.09 D9)
--
-- remove_worker() (20260927160400) anonymised the staff row, deleted the
-- evidence sets and banned the login. What it left behind, each a copy of
-- the same person:
--
--   · auth.users kept the real email, phone and raw_user_meta_data — and,
--     because the banned login still held the address, a removed person who
--     re-applied was matched by GoTrue to the banned login (generateLink
--     invite → "email exists" → magiclink on the old user) and could never
--     activate (D9b; packages/db/src/provision.ts).
--   · profiles.full_name kept the real name.
--   · notification_outbox kept names, addresses and — in E8 — the NI
--     number, in payload and recipient_emails, sent and unsent alike.
--   · audit_log rows kept the worker's name where the worker was the actor
--     (data.actorName) and under name/email keys on rows about them.
--   · location_pings and check_logs.location kept where they were, shift by
--     shift.
--   · applications.dob (to the 1900-01-01 sentinel, the column is not
--     null) / resolution_reason, staff.rejection_reason /
--     rejection_cause / gender / home_postcode / home_country /
--     applied_age_band, client_qualifications.note and
--     criminal_declarations.review_note all survived.
--   · rtw_checks rows on a document the removal did not delete.
--
-- Each is now scrubbed, in the same transaction as the anonymisation.
-- (onboarding_progress' visa type and expiry, also named by the audit,
-- were already deleted with the row by onboarding_on_staff_change() when
-- removed_at is set, 20260923120000; 630 pins that.)
--
-- What deliberately survives, as before (§1.7 "keep history rows and
-- already-issued PDFs"): bookings, check-in/out TIMES, breaks, violations,
-- feedback (text verbatim, v1), payroll_export_lines (a payroll export is
-- never corrected retroactively), event_documents, the Employee ID and a
-- completion letter held under ADR-0019. report_sends' stored CSVs are a
-- policy question for THC and are not touched here.
--
-- Order matters and is commented inline: ids are collected before any
-- delete; the auth row is scrubbed while staff.user_id is still known; the
-- outbox and audit scrubs match on the ORIGINAL email and NI number, so
-- they run before the staff row is overwritten.
--
-- Signature, grants and the service-role-only rule are unchanged.
-- =====================================================================

create or replace function public.remove_worker(
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
  v_outbox_deleted int := 0;
  v_outbox_scrubbed int := 0;
  v_audit int := 0;
  v_pings int := 0;
  v_today date := (p_now at time zone 'Europe/London')::date;
  v_retain date;
  v_login_disabled boolean := false;
  v_actor uuid := coalesce(p_actor, auth.uid());
  v_label text;
  v_removed_email text;
  v_auth_email text;
  v_emails text[];
  v_bookings uuid[];
  v_ids text[];
  v_pii_keys text[] := array['name', 'fullName', 'firstName', 'lastName', 'staffName',
                             'workerName', 'email', 'phone', 'mobile', 'niNumber',
                             'shareCode', 'dob', 'dateOfBirth', 'address', 'homeAddress',
                             'postcode', 'fileName', 'visaType', 'visaExpiry'];
begin
  select * into v from staff where id = p_staff for update;
  if v.id is null then
    raise exception 'unknown_staff' using errcode = 'P0001';
  end if;
  if v.status = 'removed' then
    return jsonb_build_object('staffId', p_staff::text, 'alreadyRemoved', true);
  end if;

  v_label := deleted_account_label(v.employee_id);
  v_removed_email := 'removed-' || replace(p_staff::text, '-', '') || '@invalid.example';

  -- Every id that can appear in an outbox key or an audit row about this
  -- worker, collected BEFORE anything below deletes rows.
  select coalesce(array_agg(b.id), '{}') into v_bookings from bookings b where b.staff_id = p_staff;
  select array[p_staff::text]
         || coalesce((select array_agg(x::text) from unnest(v_bookings) x), '{}')
         || coalesce((select array_agg(d.id::text) from compliance_docs d where d.staff_id = p_staff), '{}')
         || coalesce((select array_agg(c.id::text) from criminal_declarations c where c.staff_id = p_staff), '{}')
         || coalesce((select array_agg(a.id::text) from applications a where a.staff_id = p_staff), '{}')
         || coalesce((select array_agg(q.id::text) from quiz_attempts q where q.staff_id = p_staff), '{}')
         || coalesce((select array_agg(r.id::text) from rtw_checks r where r.staff_id = p_staff), '{}')
    into v_ids;

  v_cascade := block_worker(p_staff, null, null, p_now, 'removed', 'gdpr');

  -- §1.7 "login disabled", and the login no longer holds the person.
  -- Banned (GoTrue refuses a sign-in while banned_until is in the future),
  -- sessions and refresh tokens deleted, outstanding one-time tokens
  -- cleared, and the address, phone and user metadata replaced — so the
  -- same person re-applying gets a NEW login rather than this banned one
  -- (D9b). Done while user_id is still known. A schema this cannot write
  -- is a deployment fault and is raised, not swallowed.
  if v.user_id is not null then
    begin
      execute 'select email from auth.users where id = $1' into v_auth_email using v.user_id;
      execute 'update auth.users
                  set banned_until = $1,
                      email = $2,
                      phone = null,
                      raw_user_meta_data = ''{}''::jsonb,
                      email_change = '''',
                      confirmation_token = '''',
                      recovery_token = '''',
                      email_change_token_new = '''',
                      updated_at = now()
                where id = $3'
        using p_now + interval '100 years', v_removed_email, v.user_id;
      v_login_disabled := found;
      if to_regclass('auth.identities') is not null then
        execute 'update auth.identities
                    set identity_data = jsonb_build_object(''sub'', user_id::text, ''email'', $1::text)
                  where user_id = $2'
          using v_removed_email, v.user_id;
        -- Hosted Supabase generates identities.email from identity_data;
        -- a plain column (the local stand-in) is written directly.
        if exists (select 1 from pg_attribute
                    where attrelid = to_regclass('auth.identities') and attname = 'email'
                      and not attisdropped and attgenerated = '') then
          execute 'update auth.identities set email = $1 where user_id = $2'
            using v_removed_email, v.user_id;
        end if;
      end if;
      if to_regclass('auth.sessions') is not null then
        execute 'delete from auth.sessions where user_id = $1' using v.user_id;
      end if;
      if to_regclass('auth.refresh_tokens') is not null then
        execute 'delete from auth.refresh_tokens where user_id = $1' using v.user_id::text;
      end if;
      if to_regclass('auth.one_time_tokens') is not null then
        execute 'delete from auth.one_time_tokens where user_id = $1' using v.user_id;
      end if;
    exception when insufficient_privilege or undefined_table or undefined_column then
      raise exception 'gdpr_login_not_disabled: %', sqlerrm using errcode = '42501';
    end;

    update profiles set full_name = v_label where id = v.user_id;
  end if;

  v_emails := array_remove(array[lower(v.email), lower(v_auth_email)], null);

  -- The outbox. Matched on the recipient, on any of the worker's ids in
  -- the key (E8:staff:<id>:…, N6:booking:<id>, E9:declaration:<id>, …),
  -- and on the id, address or NI number anywhere in the payload. Unsent
  -- rows are deleted — a disabled account is not emailed, and nobody is
  -- sent an old copy of their data — and sent rows keep only the fact of
  -- the send.
  with m as (
    select o.id, o.sent_at
      from notification_outbox o
     where o.recipient_staff_id = p_staff
        or exists (select 1 from unnest(v_ids) i where position(i in o.key) > 0)
        or position(p_staff::text in o.payload::text) > 0
        or exists (select 1 from unnest(v_emails) e
                    where position(e in lower(o.payload::text)) > 0
                       or e = any (select lower(r) from unnest(o.recipient_emails) r))
        or (v.ni_number is not null and position(v.ni_number in o.payload::text) > 0)
  ), gone as (
    delete from notification_outbox o using m
     where o.id = m.id and m.sent_at is null
    returning 1
  ) select count(*)::int into v_outbox_deleted from gone;

  with m as (
    select o.id
      from notification_outbox o
     where o.sent_at is not null
       and (o.recipient_staff_id = p_staff
            or exists (select 1 from unnest(v_ids) i where position(i in o.key) > 0)
            or position(p_staff::text in o.payload::text) > 0
            or exists (select 1 from unnest(v_emails) e
                        where position(e in lower(o.payload::text)) > 0
                           or e = any (select lower(r) from unnest(o.recipient_emails) r))
            or (v.ni_number is not null and position(v.ni_number in o.payload::text) > 0))
  ), scrubbed as (
    update notification_outbox o
       set payload = jsonb_build_object('gdprRemoved', true, 'label', v_label),
           recipient_emails = (
             select array_agg(case when lower(r) = any (v_emails) then v_removed_email else r end)
               from unnest(o.recipient_emails) r),
           error = null
      from m
     where o.id = m.id
    returning 1
  ) select count(*)::int into v_outbox_scrubbed from scrubbed;

  -- The audit trail keeps what happened and who did it, not who the
  -- worker was. Rows about the worker lose the personal keys; rows the
  -- worker acted in name them by the label.
  with a as (
    update audit_log l
       set data = (coalesce(l.data, '{}'::jsonb) - v_pii_keys)
                  || case when v.user_id is not null and l.actor = v.user_id
                               and l.data ? 'actorName'
                          then jsonb_build_object('actorName', v_label)
                          else '{}'::jsonb end
     where l.entity_id::text = any (v_ids)
        or l.data ->> 'staffId' = p_staff::text
        or (v.user_id is not null and l.actor = v.user_id)
    returning 1
  ) select count(*)::int into v_audit from a;

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
         home_location_stale = false,
         home_postcode = null,
         home_country = null,
         gender      = null,
         applied_age_band = null,
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
         rejection_reason = null,
         rejection_cause = null,
         willo_candidate_id = null,
         user_id     = null,
         removed_at  = p_now
   where id = p_staff;

  -- rtw_checks on documents the next statement deletes go by cascade;
  -- any on a held document go here. Their delete trigger owes each report
  -- PDF to the purge queue.
  delete from rtw_checks where staff_id = p_staff;

  with d as (delete from compliance_docs
              where staff_id = p_staff and retain_until is null
             returning 1)
    select count(*)::int into v_docs from d;
  delete from bank_details      where staff_id = p_staff;
  delete from staff_references  where staff_id = p_staff;
  delete from hmrc_checklists   where staff_id = p_staff;
  delete from push_subscriptions where staff_id = p_staff;

  -- onboarding_progress (visa type, typed visa expiry) needs nothing here:
  -- onboarding_on_staff_change() (20260923120000) deletes the row when
  -- removed_at is set by the update above. 630 asserts it.

  -- §1.5 declarations are never edited; the §1.7 scrub is the one change
  -- the criminal_declarations_never_edited trigger allows, on a removed
  -- worker, to NULL (20260929140000).
  update criminal_declarations
     set details = null, conviction_date = null, review_note = null
   where staff_id = p_staff;

  update client_qualifications set note = null where staff_id = p_staff and note is not null;

  -- Where the worker was, shift by shift. The check-in and check-out TIMES
  -- stay (pay and timesheets reconcile through them); the fixes go.
  with p as (delete from location_pings where booking_id = any (v_bookings) returning 1)
    select count(*)::int into v_pings from p;
  update check_logs
     set location = null, distance_m = null
   where booking_id = any (v_bookings)
     and (location is not null or distance_m is not null);

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
  -- applications.dob is `not null` (20260921170000), so it takes the same
  -- sentinel staff.dob does: a date that identifies nobody.
  update applications
     set dob = date '1900-01-01', resolution_reason = null
   where staff_id = p_staff
     and (dob is distinct from date '1900-01-01' or resolution_reason is not null);

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
                             'outboxDeleted', v_outbox_deleted,
                             'outboxScrubbed', v_outbox_scrubbed,
                             'auditRowsScrubbed', v_audit,
                             'locationPingsDeleted', v_pings,
                             'willoCandidateId', v.willo_candidate_id));

  return v_cascade || jsonb_build_object(
    'label', v_label,
    'documentsDeleted', v_docs,
    'documentsHeld', v_held,
    'retainUntil', case when v_held > 0 then v_retain end,
    'filesQueued', v_files,
    'prefixesQueued', 2,
    'loginDisabled', v_login_disabled,
    'applicationsAnonymised', v_apps,
    'outboxDeleted', v_outbox_deleted,
    'outboxScrubbed', v_outbox_scrubbed,
    'auditRowsScrubbed', v_audit,
    'locationPingsDeleted', v_pings);
end $$;

comment on function public.remove_worker(uuid, timestamptz, uuid) is
  '§1.7 GDPR removal. Irreversible anonymisation of the staff row, the auth login (banned; email, phone and metadata replaced, tokens and sessions deleted), the profile name, applications (names, contacts, DOB, resolution note), onboarding answers, declaration content, qualification notes, outbox rows (unsent deleted, sent scrubbed) and audit rows about or by the worker; location fixes deleted (check-in/out times kept); documents, bank details, referees, checklist, rtw checks and push subscriptions deleted; files and the two Storage folders queued for gdpr-purge; future bookings released. EXCEPT a completion letter held under ADR-0019. p_actor is the manager who pressed it (the service key carries no sub).';

revoke execute on function public.remove_worker(uuid, timestamptz, uuid) from public, anon, authenticated;
grant  execute on function public.remove_worker(uuid, timestamptz, uuid) to service_role;
