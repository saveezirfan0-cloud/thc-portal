-- =====================================================================
-- Migration 20261001205000 · §1.7 removal holds right-to-work evidence
--                            for employment + 2 years (ADR-0065,
--                            amending ADR-0019)
--
-- The product owner's decision of 28.09.2026, on the gov.uk employer
-- guidance (THC's adviser signed off the gov.uk check the same day): copies of
-- right-to-work checks are kept for the duration of employment plus two
-- years, and deleting them early loses the statutory excuse. ADR-0019
-- held only the university completion letter; a GDPR removal now holds
-- the right-to-work evidence the same way — same window, same
-- retain_until, same rtw_daily() purge.
--
-- WHAT IS HELD (doc_type, and why it is right-to-work evidence, §2.5):
--
--   passport                      branches 1–5 (identity + nationality;
--                                 the whole of the check for branch 1)
--   national_id                   branch 2 (EU/EEA: passport OR ID card)
--   birth_certificate             branch 1's other route (List A: UK
--                                 birth certificate + an official NI
--                                 document)
--   ni_evidence                   ONLY as the second half of that pair:
--                                 held when a relied-on birth certificate
--                                 is held with it. Otherwise it is payroll
--                                 evidence (§2.5 pt 7) and is deleted as
--                                 before.
--   visa_document                 branch 3
--   status_document               branch 5
--   share_code_report             branches 2–5: the gov.uk online check —
--                                 the row, its gov_report_path and every
--                                 rtw_checks run on it (report + photo)
--   university_term_dates_letter  branch 4: the Home Office guidance
--                                 requires an employer of a student with
--                                 term-time work limits to obtain, copy and
--                                 RETAIN their term and vacation dates;
--                                 they are the evidence that a 48-hour
--                                 week fell in a vacation (RULE-20). The
--                                 same reasoning ADR-0019 applied to the
--                                 completion letter.
--
-- NOT held: criminal_declarations (not a document, §10.7 scrub as
-- before), the opt-out copy (Working Time Regulations, not immigration),
-- references, bank details, the HMRC checklist, the selfie.
--
-- ONLY EVIDENCE THAT WAS RELIED ON. A right-to-work row is held when it
-- was verified at some point:
--   · review_status = 'verified' — including one whose expiry has passed
--     (expiry is derived, not a status; an expired passport was the
--     evidence for the weeks it covered);
--   · review_status = 'superseded' with reviewed_at set and no
--     rejection_reason — a verified row Reset to candidate superseded
--     (20260927160400). Every writer of compliance_docs.reviewed_at is a
--     Verify, a Reject (which writes rejection_reason in the same
--     statement — the NI-number comparison's included) or a date
--     confirmed on an already-verified row, and no path moves a row back
--     to 'pending'; so stamped-and-unrejected is exactly "was verified".
-- A pending or rejected upload, or one superseded before any decision,
-- was never the basis of anything and is deleted as before.
--
-- The completion letter keeps ADR-0019's behaviour exactly: every
-- completion letter row of an employed worker is held, whatever its
-- status, and its columns are untouched.
--
-- On the held right-to-work rows, what is not the evidence is scrubbed:
-- ai_extracted (the extraction provider's raw read — a second copy of
-- what the scan itself holds) and share_code (a ~90-day key to run a new
-- check, not a record of the one that was run; staff.share_code is
-- already nulled). The file, the gov.uk report, the dates confirmed,
-- who verified and when all stay: they are what the Home Office asks to
-- see.
--
-- rtw_checks. The unconditional `delete from rtw_checks` becomes:
--   · checks on a document being deleted go, as before (explicitly here,
--     and by the compliance_doc_id cascade);
--   · a check still queued or running on a held document goes too — it
--     never produced a result and is nobody's evidence; its delete
--     trigger queues whatever file it had;
--   · the finished checks on a held document STAY: status, outcome,
--     source, recommendation, result (the name gov.uk returned, the
--     conditions and the date — the evidence of the check), report_path,
--     photo_path (the photo the admin compared, ADR-0041), reviewed_at /
--     reviewed_by and the timestamps. Their free text is scrubbed:
--     review_reason (the office's, from the runner, may quote names),
--     worker_reason and suggested_reason (N8 text), error.
-- retained_storage_paths() (20260930150000) already names every held
-- document's file_path and gov_report_path and its checks' report_path
-- and photo_path, so the prefix sweep in gdpr-purge leaves them.
--
-- The purge. rtw_daily() (20260923100100) is restated with every line
-- carried, changing only its retention loop: it queued a held row's
-- file_path; it now also queues gov_report_path (a share-code document's
-- report, attached by the office or the check), and writes rtw.purged to
-- the audit trail for a right-to-work document (the completion letter's
-- delete trigger already writes completion_letter.purged). The row
-- delete cascades to its rtw_checks, whose rtw_checks_forget_report()
-- trigger (20260930150000) queues each report and photo. The return
-- value keeps its shape.
--
-- remove_worker(): restated from 20260930120100 with every line carried;
-- changed only in the hold statement, the rtw_checks statement and the
-- function comment. Signature, grants, return shape unchanged.
-- compliance_docs.retain_until's column comment follows.
--
-- Forward-only. Nothing here edits an earlier migration.
-- =====================================================================

comment on column compliance_docs.retain_until is
  'Set only by a §1.7 removal of someone who was employed, inside the legal retention window of employment + 2 years: the completion letter (ADR-0019) and right-to-work evidence that was relied on (ADR-0065). The row, its file, its gov.uk report and its checks'' reports and photos are held until this date and purged by rtw_daily().';

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

  -- The legal hold (ADR-0019, ADR-0065): the completion letter, whatever
  -- its status, as before; and the right-to-work evidence that was relied
  -- on — verified, or verified and later superseded by a reset. An NI
  -- document only as the second half of a birth certificate's List A
  -- pair. The right-to-work rows lose what is not the evidence.
  if v_retain is not null and v_retain > v_today then
    with relied as (
      select d.id, d.doc_type
        from compliance_docs d
       where d.staff_id = p_staff
         and (d.review_status = 'verified'
              or (d.review_status = 'superseded'
                  and d.reviewed_at is not null
                  and d.rejection_reason is null))
    ), held as (
      select d.id
        from compliance_docs d
       where d.staff_id = p_staff
         and d.doc_type = 'university_completion_letter'
      union
      select r.id
        from relied r
       where r.doc_type in ('passport', 'national_id', 'birth_certificate',
                            'visa_document', 'status_document', 'share_code_report',
                            'university_term_dates_letter')
      union
      select r.id
        from relied r
       where r.doc_type = 'ni_evidence'
         and exists (select 1 from relied b where b.doc_type = 'birth_certificate')
    ), h as (
      update compliance_docs d
         set retain_until = v_retain,
             ai_extracted = case when d.doc_type = 'university_completion_letter'
                                 then d.ai_extracted end,
             share_code   = case when d.doc_type = 'university_completion_letter'
                                 then d.share_code end
        from held
       where d.id = held.id
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

  -- rtw_checks. On a document the next statement deletes, the check goes
  -- (here, and by the cascade), and so does one still queued or running
  -- on a held document: it never produced a result. Their delete trigger
  -- owes each report and photo to the purge queue. A FINISHED check on a
  -- held document is the record of the check (ADR-0065): it stays with
  -- its result, report and photo, and loses its free text.
  delete from rtw_checks c
   where c.staff_id = p_staff
     and (c.status in ('queued', 'running')
          or not exists (select 1 from compliance_docs d
                          where d.id = c.compliance_doc_id and d.retain_until is not null));

  update rtw_checks
     set review_reason    = null,
         worker_reason    = null,
         suggested_reason = null,
         error            = null
   where staff_id = p_staff
     and (review_reason is not null or worker_reason is not null
          or suggested_reason is not null or error is not null);

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
  -- removed_at is set by the update above. 670 asserts it.

  -- §1.5 declarations are never edited; the §1.7 scrub is the one change
  -- the criminal_declarations_never_edited trigger allows, on a removed
  -- worker, to NULL (20260930120000).
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
  '§1.7 GDPR removal. Irreversible anonymisation of the staff row, the auth login (banned; email, phone and metadata replaced, tokens and sessions deleted), the profile name, applications (names, contacts, DOB, resolution note), onboarding answers, declaration content, qualification notes, outbox rows (unsent deleted, sent scrubbed) and audit rows about or by the worker; location fixes deleted (check-in/out times kept); documents, bank details, referees, checklist, rtw checks and push subscriptions deleted; files and the two Storage folders queued for gdpr-purge; future bookings released. EXCEPT, for someone who was employed, the legal hold of employment + 2 years (retain_until, purged by rtw_daily()): the completion letter (ADR-0019) and the right-to-work evidence that was relied on — verified (or verified then superseded) passport, national ID, birth certificate with its NI document, visa and status documents, share-code report with its finished gov.uk checks (result, report, photo; free text scrubbed) and term dates letter (ADR-0065). p_actor is the manager who pressed it (the service key carries no sub).';

revoke execute on function public.remove_worker(uuid, timestamptz, uuid) from public, anon, authenticated;
grant  execute on function public.remove_worker(uuid, timestamptz, uuid) to service_role;

-- ---------------------------------------------------------------------
-- What the prefix sweep keeps: 20260930150000's body, unchanged — it
-- already names every held document's file and report and its checks'
-- reports and photos. Only the comment follows the wider hold.
-- ---------------------------------------------------------------------
comment on function public.retained_storage_paths(uuid) is
  '§1.7 + ADR-0019 + ADR-0065: the Storage paths of a removed worker that a prefix purge must keep — the file and gov.uk report of every document carrying retain_until (the completion letter, relied-on right-to-work evidence), and the reports and photos of the automated checks on them (ADR-0025, ADR-0041). Service role only.';

-- ---------------------------------------------------------------------
-- The purge: rtw_daily() restated from 20260923100100 with every line
-- carried. Changed only in the retention loop — the gov.uk report is
-- queued with the file, and a right-to-work document's purge is audited
-- as rtw.purged (the completion letter's trigger writes its own) — and in
-- the comment.
-- ---------------------------------------------------------------------
create or replace function public.rtw_daily(p_now timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_today  date := (p_now at time zone 'Europe/London')::date;
  v_alerts int := 0;
  v_purged int := 0;
  r record;
begin
  with due as (
    select s.id, s.first_name, s.last_name, s.employee_id, s.rtw_branch,
           s.right_to_work_until as rtw_until,
           (s.right_to_work_until - v_today) as days_left
      from staff s
     where s.status in ('compliant', 'blocked')
       and s.left_at is null
       and s.removed_at is null
       and s.right_to_work_until is not null
       and s.right_to_work_until >= v_today
       and s.right_to_work_until - v_today <= 60
  ), q as (
    insert into notification_outbox (key, channel, template, recipient_emails, payload)
    select 'CL4:staff:' || due.id || ':' || due.rtw_until || ':'
             || case when due.days_left > 30 then 60 when due.days_left > 14 then 30 else 14 end,
           'email', 'CL4',
           array['admin@thehospitalitycompany.co.uk'],
           jsonb_build_object(
             'name',       due.first_name || ' ' || due.last_name,
             'employeeId', coalesce(due.employee_id::text, '(not yet issued)'),
             'visaExpiry', to_char(due.rtw_until, 'DD Mon YYYY'),
             'days',       due.days_left::text,
             'tier',       (case when due.days_left > 30 then 60
                                 when due.days_left > 14 then 30 else 14 end)::text,
             'route',      case due.rtw_branch
                             when 'international_student' then 'Student visa'
                             when 'work_visa' then 'Work visa'
                             when 'eu_settled' then 'EU settled / pre-settled status'
                             else coalesce(due.rtw_branch::text, 'not recorded') end)
      from due
    on conflict (key) do nothing
    returning 1
  ) select count(*)::int into v_alerts from q;

  -- The retention purge (ADR-0019, ADR-0065). The file and the gov.uk
  -- report are queued BEFORE the row that names them is deleted. The
  -- delete cascades to the document's rtw_checks, whose
  -- rtw_checks_forget_report() trigger queues each check's report and
  -- photo. A completion letter's delete writes completion_letter.purged
  -- through its trigger; a right-to-work document's purge is written here.
  for r in
    select d.id, d.file_path, d.gov_report_path, d.doc_type, d.retain_until,
           d.staff_id, s.employee_id
      from compliance_docs d
      join staff s on s.id = d.staff_id
     where d.retain_until is not null
       and d.retain_until <= v_today
       and s.removed_at is not null
  loop
    if r.file_path is not null then
      insert into storage_deletions (bucket, path, staff_id)
      values ('documents', r.file_path, r.staff_id)
      on conflict (bucket, path) do nothing;
    end if;
    if r.gov_report_path is not null then
      insert into storage_deletions (bucket, path, staff_id)
      values ('documents', r.gov_report_path, r.staff_id)
      on conflict (bucket, path) do nothing;
    end if;
    delete from compliance_docs where id = r.id;
    if r.doc_type <> 'university_completion_letter' then
      insert into audit_log (at, actor, action, entity, entity_id, data)
      values (now(), null, 'rtw.purged', 'compliance_docs', r.id,
              jsonb_build_object('staffId',     r.staff_id,
                                 'employeeId',  r.employee_id,
                                 'docType',     r.doc_type::text,
                                 'retainUntil', r.retain_until,
                                 'actorName',   'system'));
    end if;
    v_purged := v_purged + 1;
  end loop;

  return jsonb_build_object('rtwAlerts', v_alerts, 'retentionPurged', v_purged);
end $$;

comment on function public.rtw_daily(timestamptz) is
  'Completion letter requirement §2.3 and §4: admin email CL4 at 60/30/14 days before any live worker''s right to work expires (bands, once each per expiry date), and the purge of evidence held by a §1.7 removal — completion letters (ADR-0019) and right-to-work evidence (ADR-0065) — whose employment + 2 years retention hold has run out: the row, its file and gov.uk report, and (by cascade) its checks with their reports and photos, all queued for gdpr-purge.';

revoke execute on function public.rtw_daily(timestamptz) from public, anon, authenticated;
grant  execute on function public.rtw_daily(timestamptz) to service_role;
