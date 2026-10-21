-- =====================================================================
-- The Home Office check branch — ADR-0182
--
-- A deliberate addition to scope v1.6 §2.5 ("5 branches"), asked for by
-- THC on 21.10.2026 (Richard): "On occasions we need to run an Employer
-- Checking Service check … mainly for staff members who are claiming
-- asylum. We complete the online form and the results are emailed back as
-- a PDF. We would attach this to their profile; they normally run for 6
-- months. Currently we are unable to attach files of this nature, which
-- stops the person progressing as we do not have a right-to-work date."
--
-- Until now every branch but UK / Irish had to type a W-format share code
-- at step 1, and step 4 filed a share_code_report the gov.uk check runs
-- on. A worker whose right to work is confirmed by the Employer Checking
-- Service (an asylum seeker with permission to work, a pending application
-- or appeal, section 3C leave) has no share code, so they could never
-- reach the quiz, and the office had nowhere to put the result.
--
-- The branch, mirroring the share-code branches wherever it can:
--
--   1 · Step 1 asks for the worker's Home Office reference (Application
--       Registration Card number or application reference) instead of a
--       share code: required, 6–30 letters, digits, spaces, "/" or "-",
--       at least one digit. Stored on staff.home_office_ref, which — like
--       staff.share_code — no API role can read (no column grant, ADR-0163);
--       the office reads it through staff_identity_v, the worker through
--       onboarding_state(). It follows the branch: moving off the branch,
--       a reset to candidate and a GDPR removal clear it (trigger).
--   2 · Step 4 asks for no upload (identity is the selfie at step 3; the
--       Home Office result is the right-to-work evidence). Submitting files
--       a pending `home_office_check_result` row carrying the reference, as
--       a share-code branch files its pending share_code_report — the
--       office's place in the queue until it attaches the result.
--   3 · The office attaches the result (PDF/JPG/PNG ≤ 10 MB) with
--       office_attach_home_office_check(): onto the step-4 row while it has
--       no file, otherwise as a fresh pending row (a renewal — they run
--       about six months — or a replacement for one not yet reviewed, which
--       is superseded and kept). The worker can never upload this type.
--   4 · Verify (compliance_verify_home_office_check) needs the attached
--       file and the date the Home Office APPROVED it, printed on the PDF
--       and stored on the row (home_office_approved_on). THC, 22.10.2026:
--       "valid for 6 months from the date it was approved". The
--       right-to-work-until (the share code report's column,
--       compliance_docs_rtw_date_guard, ADR-0018) defaults to that date + 6
--       months — PostgreSQL's month arithmetic, the same day of the month,
--       clamped to the month's end (31.08 → 28/29.02) — and the office may
--       type another if the result says otherwise. No AI read (the
--       extractor runs only on the worker's own uploads, in the Staff App),
--       no gov.uk check, no "no time limit". Once verified, the latest
--       result is the worker's evidence and staff.right_to_work_until
--       follows it; a renewal verified later replaces the old one, which
--       stays on file.
--   5 · Expiry: the normal ladder and the automatic block, except that the
--       worker is not sent N1–N3 for it ("Update your …") — they cannot
--       obtain the document. The office is told by CL4 (60, 30 and 14 days
--       before, route "Home Office check (Employer Checking Service)"). A
--       rejected result sends no N8 ("Re-upload") for the same reason.
--   6 · The office's Change dialog (record_right_to_work_change) may move a
--       worker onto or off the branch. Moving onto it supersedes the share
--       code report and any visa / status document (they are no longer the
--       evidence, and an expired one would otherwise keep blocking);
--       moving off it supersedes the Home Office results. Kept, read-only.
--   7 · The cap is a non-student's (48 h, the opt-out lifts it):
--       weekly_cap_for() needs no change. can_roster_staff() refuses a
--       worker on this branch with no right-to-work date at all, as well as
--       past it.
--   8 · The quiz gate is unchanged: the pending result is a current,
--       unverified document (compliance_blockers), so the quiz opens once
--       the office has verified it and every other gate passes. No
--       share-code token is owed on this branch; `home_office_check_result`
--       is "missing" until the row exists.
--
-- Every function changed here is re-created from its LIVE definition
-- (pg_get_functiondef), changed by literal patterns that must match an
-- exact number of times or the migration stops — the pattern of
-- 20261019192000 (docs/10 §3b), so no gate added since the file a body
-- was last written in is lost. Owners, grants and comments stay with each
-- function (same oid), except onboarding_save_right_to_work(), whose
-- signature gains p_home_office_ref and is re-granted below.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0 · Literal substitution that insists on how many times it matches.
-- ---------------------------------------------------------------------
create function pg_temp.hoc_sub(p_def text, p_from text, p_to text, p_expect int, p_label text)
returns text language plpgsql as $f$
declare
  v_n int := (length(p_def) - length(replace(p_def, p_from, ''))) / greatest(length(p_from), 1);
begin
  if v_n <> p_expect then
    raise exception '20261022190100: % matched % time(s), expected %', p_label, v_n, p_expect;
  end if;
  return replace(p_def, p_from, p_to);
end $f$;

-- ---------------------------------------------------------------------
-- 1 · The reference: what is accepted, and where it is kept.
--
-- packages/domain homeOfficeRef.ts (normaliseHomeOfficeRef,
-- isValidHomeOfficeRef) is the same rule; its vectors are held to these
-- two functions by pgTAP 911.
-- ---------------------------------------------------------------------
create or replace function public.normalise_home_office_ref(p_ref text)
returns text
language sql
immutable
set search_path = public, extensions
as $$
  select nullif(upper(regexp_replace(btrim(coalesce(p_ref, '')), '\s+', ' ', 'g')), '')
$$;

comment on function public.normalise_home_office_ref(text) is
  'ADR-0182: a Home Office reference as stored — trimmed, inner spaces collapsed to one, upper case; null when blank.';

create or replace function public.is_valid_home_office_ref(p_ref text)
returns boolean
language sql
immutable
set search_path = public, extensions
as $$
  select coalesce(normalise_home_office_ref(p_ref) ~ '^[A-Z0-9][A-Z0-9 /-]{4,28}[A-Z0-9]$'
                  and normalise_home_office_ref(p_ref) ~ '[0-9]', false)
$$;

comment on function public.is_valid_home_office_ref(text) is
  'ADR-0182: an Application Registration Card number or Home Office application reference, after normalise_home_office_ref(): 6–30 characters, letters, digits, spaces, "/" or "-", starting and ending with a letter or digit, with at least one digit. A shape check only — the office checks it with the Home Office.';

revoke all on function public.normalise_home_office_ref(text) from public, anon;
revoke all on function public.is_valid_home_office_ref(text) from public, anon;
grant execute on function public.normalise_home_office_ref(text) to authenticated, service_role;
grant execute on function public.is_valid_home_office_ref(text) to authenticated, service_role;

alter table public.staff add column if not exists home_office_ref text;
alter table public.staff add constraint staff_home_office_ref_shape
  check (home_office_ref is null or is_valid_home_office_ref(home_office_ref));

comment on column public.staff.home_office_ref is
  'ADR-0182: the Home Office reference (ARC number or application reference) a worker on the home_office_check branch typed at step 1, for the office''s Employer Checking Service form. Admin-only like share_code: no API role holds the column (ADR-0163) — the office reads it through staff_identity_v, the worker through onboarding_state(). Cleared when the branch changes, on a reset to candidate and on a GDPR removal (staff_home_office_ref_follows_branch).';

-- The reference belongs to the branch: a worker moved off it (step 1, the
-- office's Change dialog, reset_to_candidate) or removed (§1.7) keeps none.
create or replace function public.staff_home_office_ref_follows_branch()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
begin
  if new.home_office_ref is not null
     and (new.rtw_branch is distinct from 'home_office_check' or new.removed_at is not null) then
    new.home_office_ref := null;
  end if;
  return new;
end $$;

-- A trigger needs no EXECUTE grant (190).
revoke all on function public.staff_home_office_ref_follows_branch() from public, anon, authenticated;

create trigger staff_home_office_ref_follows_branch
  before insert or update of rtw_branch, removed_at, home_office_ref on public.staff
  for each row execute function public.staff_home_office_ref_follows_branch();

-- The office's route to it: staff_identity_v (ADR-0163), one column
-- appended so every view built on it keeps its shape.
create or replace view public.staff_identity_v with (security_barrier = true) as
select
  s.id                                                     as staff_id,
  case when s.removed_at is null then s.dob end            as dob,
  case when s.removed_at is null then s.home_address end   as home_address,
  case when s.removed_at is null then s.share_code end     as share_code,
  case when s.removed_at is null then s.ni_number end      as ni_number,
  case when s.removed_at is null then s.home_office_ref end as home_office_ref
from public.staff s
where (select current_app_role()) = 'admin'
   or current_user not in ('anon', 'authenticated');

comment on view public.staff_identity_v is
  'ADR-0163: the only route to staff.dob, home_address, share_code, ni_number and (ADR-0182) home_office_ref for a PostgREST role. Owner rights + the admin gate in the body (ADR-0004); a worker reads their own values through staff_me() / onboarding_state(), which show what the wireframes show.';

revoke all on table public.staff_identity_v from public, anon, authenticated;
grant select on table public.staff_identity_v to authenticated;

-- ---------------------------------------------------------------------
-- 2 · The result is right-to-work evidence, dated like a share code report.
-- ---------------------------------------------------------------------
create or replace function public.doc_label(p_doc_type doc_type)
returns text
language sql
immutable
set search_path = public, extensions
as $$
  select case p_doc_type
    when 'passport'                     then 'Passport'
    when 'birth_certificate'            then 'Birth certificate'
    when 'ni_evidence'                  then 'NI evidence'
    when 'national_id'                  then 'National ID'
    when 'visa_document'                then 'Visa document'
    when 'status_document'              then 'Status document'
    when 'university_term_dates_letter' then 'University Term Dates Letter'
    when 'university_completion_letter' then 'Official University Completion Letter'
    when 'share_code_report'            then 'Right to work · share code'
    when 'home_office_check_result'     then 'Right to work · Home Office check'
    -- Never null: render() in packages/notifications leaves an unmatched
    -- placeholder in the copy, so a doc_type added later without a label
    -- here would be sent to a worker as the literal "{document}".
    else replace(initcap(replace(p_doc_type::text, '_', ' ')), ' Id', ' ID')
  end
$$;

create or replace function public.rtw_doc_until(p_doc_type doc_type, p_expiry date, p_right_to_work_until date)
returns date
language sql
immutable
set search_path = public, extensions
as $$
  select case p_doc_type
    when 'share_code_report'        then p_right_to_work_until
    when 'home_office_check_result' then p_right_to_work_until
    when 'visa_document'            then p_expiry
    when 'status_document'          then p_expiry
    else null
  end
$$;

comment on function public.rtw_doc_until(doc_type, date, date) is
  'The right-to-work date a document confirms: a share code report''s or (ADR-0182) a Home Office check result''s right_to_work_until, a visa or status document''s expiry; null for anything else.';

create or replace function public.rtw_evidence_until(p_staff uuid)
returns date
language sql
stable
set search_path = public, extensions
as $$
  select min(rtw_doc_until(d.doc_type, d.expiry_date, d.right_to_work_until))
    from (
      select distinct on (c.doc_type) c.doc_type, c.expiry_date, c.right_to_work_until
        from compliance_docs c
       where c.staff_id = p_staff
         and c.review_status = 'verified'
         and c.doc_type in ('visa_document', 'status_document', 'share_code_report',
                            'home_office_check_result')
       order by c.doc_type, c.uploaded_at desc, c.id
    ) d
$$;

comment on function public.rtw_evidence_until(uuid) is
  'ADR-0018: the earliest right-to-work date across the worker''s current verified evidence — the latest verified visa document, status document, share code report and (ADR-0182) Home Office check result.';

do $$
declare
  v_def text;
begin
  v_def := pg_get_functiondef(
    'public.doc_expires_on(doc_type,date,date,date,timestamp with time zone,daterange[])'::regprocedure);
  v_def := pg_temp.hoc_sub(v_def,
    $p$when 'share_code_report' then coalesce(p_doc_rtw, p_staff_rtw, p_expiry)$p$,
    $p$when 'share_code_report' then coalesce(p_doc_rtw, p_staff_rtw, p_expiry)
    when 'home_office_check_result' then coalesce(p_doc_rtw, p_staff_rtw, p_expiry)$p$,
    1, 'doc_expires_on');
  execute v_def;
end $$;

-- The three right-to-work row triggers name their types in WHEN.
drop trigger compliance_docs_rtw_date_guard on public.compliance_docs;
create trigger compliance_docs_rtw_date_guard
  before update of review_status on public.compliance_docs
  for each row
  when (new.doc_type = any (array['visa_document', 'status_document', 'share_code_report',
                                  'home_office_check_result']::doc_type[])
        and new.review_status = 'verified'
        and old.review_status is distinct from 'verified')
  execute function public.compliance_docs_rtw_date_guard();

drop trigger compliance_docs_rtw_date_keep on public.compliance_docs;
create trigger compliance_docs_rtw_date_keep
  before update of expiry_date, right_to_work_until, rtw_no_time_limit, doc_type, review_status
  on public.compliance_docs
  for each row
  when (old.review_status = 'verified'
        and new.review_status = 'verified'
        and new.doc_type = any (array['visa_document', 'status_document', 'share_code_report',
                                      'home_office_check_result']::doc_type[]))
  execute function public.compliance_docs_rtw_date_keep();

drop trigger compliance_docs_rtw_until on public.compliance_docs;
create trigger compliance_docs_rtw_until
  after update of review_status, expiry_date, right_to_work_until, rtw_no_time_limit
  on public.compliance_docs
  for each row
  when (new.doc_type = any (array['visa_document', 'status_document', 'share_code_report',
                                  'home_office_check_result']::doc_type[]))
  execute function public.compliance_docs_rtw_until();

-- The date the Home Office approved the result, as printed on it: the six
-- months run from it (THC, 22.10.2026).
alter table public.compliance_docs add column if not exists home_office_approved_on date;
alter table public.compliance_docs add constraint compliance_docs_home_office_approved_on_type
  check (home_office_approved_on is null or doc_type = 'home_office_check_result');

comment on column public.compliance_docs.home_office_approved_on is
  'ADR-0182: the date the Home Office approved an Employer Checking Service result, as printed on it, confirmed by the reviewer on Verify (compliance_verify_home_office_check). The result is valid for six months from it; the right-to-work-until defaults to it + 6 months. Home Office check results only.';

-- A result is verified on the file the office attached and the date it was
-- approved, never on the empty row step 4 files — whatever path flips it.
create or replace function public.compliance_docs_home_office_result_guard()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
begin
  if new.file_path is null then
    raise exception 'home_office_result_missing'
      using errcode = 'P0001',
            hint = 'Attach the Home Office check result (the PDF the Employer Checking Service emailed) before verifying it (ADR-0182).';
  end if;
  if new.home_office_approved_on is null then
    raise exception 'approved_on_required'
      using errcode = 'P0001',
            hint = 'Verify a Home Office check result with compliance_verify_home_office_check(), giving the date approved printed on it (ADR-0182).';
  end if;
  return new;
end $$;

revoke all on function public.compliance_docs_home_office_result_guard() from public, anon, authenticated;

create trigger compliance_docs_home_office_result_guard
  before update of review_status on public.compliance_docs
  for each row
  when (new.doc_type = 'home_office_check_result'
        and new.review_status = 'verified'
        and old.review_status is distinct from 'verified')
  execute function public.compliance_docs_home_office_result_guard();

-- ---------------------------------------------------------------------
-- 3 · Verify, reject, the daily jobs, removal — live bodies, patterns.
-- ---------------------------------------------------------------------
do $$
declare
  v_def text;
begin
  -- Verify: the result is right-to-work evidence (date required, audited
  -- as rtw.verified). The "no time limit" path stays the EU share code's.
  v_def := pg_get_functiondef(
    'public.compliance_verify_document_as(uuid,uuid,date,daterange[],date)'::regprocedure);
  v_def := pg_temp.hoc_sub(v_def,
    $p$v_is_rtw := d.doc_type in ('visa_document', 'status_document', 'share_code_report');$p$,
    $p$v_is_rtw := d.doc_type in ('visa_document', 'status_document', 'share_code_report',
                               'home_office_check_result');$p$,
    1, 'compliance_verify_document_as');
  execute v_def;

  -- The candidate screen's one date field: on a result, as on a share code
  -- report, it is the right-to-work-until (verify_document()).
  v_def := pg_get_functiondef('public.verify_document(uuid,date,daterange[],date)'::regprocedure);
  v_def := pg_temp.hoc_sub(v_def,
    $p$if v_type = 'share_code_report' then$p$,
    $p$if v_type in ('share_code_report', 'home_office_check_result') then$p$,
    1, 'verify_document');
  execute v_def;

  -- Reject: no "Re-upload" push for a document the worker cannot obtain.
  v_def := pg_get_functiondef('public.compliance_reject_document_as(uuid,uuid,text)'::regprocedure);
  v_def := pg_temp.hoc_sub(v_def,
    E'  values (''N8:doc:'' || d.id, ''push'', ''N8'', d.staff_id,\n',
    E'  select ''N8:doc:'' || d.id, ''push'', ''N8'', d.staff_id,\n',
    1, 'compliance_reject_document_as N8 select');
  v_def := pg_temp.hoc_sub(v_def,
    E'''link'', n8_link(s.status)))\n  on conflict (key) do nothing;',
    E'''link'', n8_link(s.status))\n'
    || E'   -- ADR-0182: the worker cannot obtain a Home Office check result, so\n'
    || E'   -- "Re-upload" would be untrue; the office contacts them.\n'
    || E'   where d.doc_type <> ''home_office_check_result''\n'
    || E'  on conflict (key) do nothing;',
    1, 'compliance_reject_document_as N8 where');
  execute v_def;

  -- The ladder: N1–N3 say "Update your …"; the office renews this one and
  -- is told by CL4. N4 and the block on the day are unchanged.
  v_def := pg_get_functiondef('public.compliance_daily(timestamp with time zone)'::regprocedure);
  v_def := pg_temp.hoc_sub(v_def,
    '      from _due where days_left between ',
    '      from _due where doc_type <> ''home_office_check_result'' and days_left between ',
    3, 'compliance_daily N1-N3');
  execute v_def;

  -- CL4 names the route in words.
  v_def := pg_get_functiondef('public.rtw_daily(timestamp with time zone)'::regprocedure);
  v_def := pg_temp.hoc_sub(v_def,
    $p$when 'eu_settled' then 'EU settled / pre-settled status'$p$,
    $p$when 'eu_settled' then 'EU settled / pre-settled status'
                             when 'home_office_check' then 'Home Office check (Employer Checking Service)'$p$,
    1, 'rtw_daily route');
  execute v_def;

  -- Removal: the result is right-to-work evidence held for employment +
  -- 2 years like the share code report (ADR-0065).
  v_def := pg_get_functiondef('public.remove_worker(uuid,timestamp with time zone,uuid)'::regprocedure);
  v_def := pg_temp.hoc_sub(v_def,
    $p$'visa_document', 'status_document', 'share_code_report',$p$,
    $p$'visa_document', 'status_document', 'share_code_report', 'home_office_check_result',$p$,
    1, 'remove_worker retention');
  execute v_def;

  -- The Documents hub: the worker never files this type, and has no share
  -- code to enter on this branch.
  v_def := pg_get_functiondef('public.submit_document_upload(text,text,text,uuid)'::regprocedure);
  v_def := pg_temp.hoc_sub(v_def,
    E'  v_type := p_doc_type::doc_type;\n',
    E'  v_type := p_doc_type::doc_type;\n\n'
    || E'  -- ADR-0182: the office attaches the Home Office check result\n'
    || E'  -- (office_attach_home_office_check); the worker cannot obtain it.\n'
    || E'  if v_type = ''home_office_check_result'' then\n'
    || E'    return jsonb_build_object(''ok'', false, ''reason'', ''office_only'');\n'
    || E'  end if;\n',
    1, 'submit_document_upload office_only');
  v_def := pg_temp.hoc_sub(v_def,
    $p$s.rtw_branch is not null and s.rtw_branch <> 'uk_irish')$p$,
    $p$s.rtw_branch is not null and s.rtw_branch not in ('uk_irish', 'home_office_check'))$p$,
    1, 'submit_document_upload share code branch');
  execute v_def;

  v_def := pg_get_functiondef('public.onboarding_reenter_share_code(text,date)'::regprocedure);
  v_def := pg_temp.hoc_sub(v_def,
    $p$if s.rtw_branch is null or s.rtw_branch = 'uk_irish' then$p$,
    $p$if s.rtw_branch is null or s.rtw_branch in ('uk_irish', 'home_office_check') then$p$,
    1, 'onboarding_reenter_share_code');
  execute v_def;

  -- The per-shift hard stop: this branch always has a date, so none on
  -- file is no right to work yet.
  v_def := pg_get_functiondef('public.can_roster_staff(uuid,date)'::regprocedure);
  v_def := pg_temp.hoc_sub(v_def,
    E'    when s.right_to_work_until is null\n     and s.rtw_branch is distinct from ''uk_irish''::rtw_branch\n',
    E'    when s.right_to_work_until is null\n     and s.rtw_branch = ''home_office_check''::rtw_branch\n      then false\n'
    || E'    when s.right_to_work_until is null\n     and s.rtw_branch is distinct from ''uk_irish''::rtw_branch\n',
    1, 'can_roster_staff branch');
  v_def := pg_temp.hoc_sub(v_def,
    $p$d.doc_type in ('share_code_report', 'visa_document', 'status_document')$p$,
    $p$d.doc_type in ('share_code_report', 'visa_document', 'status_document',
                              'home_office_check_result')$p$,
    1, 'can_roster_staff types');
  execute v_def;
end $$;

-- ---------------------------------------------------------------------
-- 4 · Onboarding: what is missing, step 1, step 4, the worker's state.
-- ---------------------------------------------------------------------
do $$
declare
  v_def text;
begin
  v_def := pg_get_functiondef('public.onboarding_documents_missing(uuid)'::regprocedure);
  v_def := pg_temp.hoc_sub(v_def,
    E'      when ''work_visa'', ''dependant_other'' then\n',
    E'      when ''home_office_check'' then\n'
    || E'        -- ADR-0182: no share code and nothing the worker uploads; the\n'
    || E'        -- office attaches the Home Office''s result to the row step 4 files.\n'
    || E'        if not (''home_office_check_result'' = any(have)) then\n'
    || E'          missing := missing || ''home_office_check_result''::text;\n'
    || E'        end if;\n'
    || E'      when ''work_visa'', ''dependant_other'' then\n',
    1, 'onboarding_documents_missing branch');
  v_def := pg_temp.hoc_sub(v_def,
    $p$if s_rtw_branch <> 'uk_irish' and not coalesce(s_has_share_code, false) then$p$,
    $p$if s_rtw_branch not in ('uk_irish', 'home_office_check')
       and not coalesce(s_has_share_code, false) then$p$,
    1, 'onboarding_documents_missing share code');
  execute v_def;

  v_def := pg_get_functiondef('public.onboarding_submit_documents(boolean,text,date)'::regprocedure);
  v_def := pg_temp.hoc_sub(v_def,
    E'  if s.rtw_branch <> ''uk_irish'' then\n'
    || E'    update compliance_docs set review_status = ''superseded''\n'
    || E'     where staff_id = s.id and doc_type = ''share_code_report'' and review_status = ''pending'';\n',
    E'  -- ADR-0182: no share code on the Home Office check branch. The row is\n'
    || E'  -- the office''s place in the queue until it attaches the result the\n'
    || E'  -- Employer Checking Service emails back; it carries the reference.\n'
    || E'  if s.rtw_branch = ''home_office_check'' then\n'
    || E'    update compliance_docs set review_status = ''superseded''\n'
    || E'     where staff_id = s.id and doc_type = ''home_office_check_result''\n'
    || E'       and review_status = ''pending'' and file_path is null;\n'
    || E'    insert into compliance_docs (staff_id, doc_type, share_code, review_status, uploaded_at)\n'
    || E'    values (s.id, ''home_office_check_result'', s.home_office_ref, ''pending'', clock_timestamp());\n'
    || E'  elsif s.rtw_branch <> ''uk_irish'' then\n'
    || E'    update compliance_docs set review_status = ''superseded''\n'
    || E'     where staff_id = s.id and doc_type = ''share_code_report'' and review_status = ''pending'';\n',
    1, 'onboarding_submit_documents');
  execute v_def;

  v_def := pg_get_functiondef('public.onboarding_state()'::regprocedure);
  v_def := pg_temp.hoc_sub(v_def,
    E'    ''shareCode'',      s.share_code,\n',
    E'    ''shareCode'',      s.share_code,\n    ''homeOfficeRef'',  s.home_office_ref,\n',
    1, 'onboarding_state');
  execute v_def;
end $$;

-- Step 1 gains the reference. The signature changes (one argument, with a
-- default, at the end), so the function is dropped and re-created from its
-- live body and granted as before.
do $$
declare
  v_def     text;
  v_comment text := obj_description(
    'public.onboarding_save_right_to_work(text,date,text,text,date,text,boolean)'::regprocedure, 'pg_proc');
begin
  v_def := pg_get_functiondef(
    'public.onboarding_save_right_to_work(text,date,text,text,date,text,boolean)'::regprocedure);
  v_def := pg_temp.hoc_sub(v_def,
    'p_uk_doc_choice text, p_wtr_optout boolean)',
    'p_uk_doc_choice text, p_wtr_optout boolean, p_home_office_ref text DEFAULT NULL::text)',
    1, 'onboarding_save_right_to_work signature');
  v_def := pg_temp.hoc_sub(v_def,
    E'  v_optout jsonb;\nbegin\n',
    E'  v_optout jsonb;\n  v_ref text;\nbegin\n',
    1, 'onboarding_save_right_to_work declare');
  v_def := pg_temp.hoc_sub(v_def,
    E'      raise exception ''doc_choice_required'' using errcode = ''P0001'';\n    end if;\n  else\n',
    E'      raise exception ''doc_choice_required'' using errcode = ''P0001'';\n    end if;\n'
    || E'  elsif v_branch = ''home_office_check'' then\n'
    || E'    -- ADR-0182: no share code. The Home Office reference the office puts\n'
    || E'    -- on its Employer Checking Service form (ARC or application number).\n'
    || E'    v_code := null;\n'
    || E'    v_choice := null;\n'
    || E'    v_ref := normalise_home_office_ref(p_home_office_ref);\n'
    || E'    if v_ref is null then\n'
    || E'      raise exception ''home_office_ref_required'' using errcode = ''P0001'';\n'
    || E'    end if;\n'
    || E'    if not is_valid_home_office_ref(v_ref) then\n'
    || E'      raise exception ''bad_home_office_ref'' using errcode = ''P0001'';\n'
    || E'    end if;\n'
    || E'  else\n',
    1, 'onboarding_save_right_to_work branch');
  v_def := pg_temp.hoc_sub(v_def,
    E'         share_code = v_code\n   where id = s.id;\n',
    E'         share_code = v_code,\n         home_office_ref = v_ref\n   where id = s.id;\n',
    1, 'onboarding_save_right_to_work update');
  v_def := pg_temp.hoc_sub(v_def,
    $p$'shareCode', v_code, 'uploadsDropped', v_dropped,$p$,
    $p$'shareCode', v_code, 'homeOfficeRef', v_ref, 'uploadsDropped', v_dropped,$p$,
    1, 'onboarding_save_right_to_work result');

  drop function public.onboarding_save_right_to_work(text, date, text, text, date, text, boolean);
  execute v_def;
  execute format('comment on function public.onboarding_save_right_to_work(text,date,text,text,date,text,boolean,text) is %L',
    coalesce(v_comment || ' ', '')
    || 'ADR-0182 (20261022190100): on the home_office_check branch no share code is taken; p_home_office_ref (ARC or application reference, is_valid_home_office_ref) is required and stored on staff.home_office_ref.');
end $$;

revoke all on function public.onboarding_save_right_to_work(text, date, text, text, date, text, boolean, text)
  from public, anon;
grant execute on function public.onboarding_save_right_to_work(text, date, text, text, date, text, boolean, text)
  to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 5 · The office's Change dialog: the evidence follows the branch.
-- ---------------------------------------------------------------------
do $$
declare
  v_def text;
begin
  v_def := pg_get_functiondef('public.record_right_to_work_change(uuid,rtw_branch,date,text)'::regprocedure);
  v_def := pg_temp.hoc_sub(v_def,
    E'  s          staff;\nbegin\n',
    E'  s          staff;\n  v_superseded int := 0;\nbegin\n',
    1, 'record_right_to_work_change declare');
  v_def := pg_temp.hoc_sub(v_def,
    E'  insert into audit_log (at, actor, action, entity, entity_id, data)\n  values (now(), v_reviewer, ''rtw.changed''',
    E'  -- ADR-0182: onto the Home Office check branch, the share code report\n'
    || E'  -- and any visa / status document stop being the evidence (an expired\n'
    || E'  -- one would otherwise keep blocking); off it, the Home Office results\n'
    || E'  -- do. Superseded, kept read-only (§2.12), never deleted.\n'
    || E'  if p_branch = ''home_office_check'' and s.rtw_branch is distinct from ''home_office_check'' then\n'
    || E'    update compliance_docs set review_status = ''superseded''\n'
    || E'     where staff_id = p_staff and review_status <> ''superseded''\n'
    || E'       and doc_type in (''share_code_report'', ''visa_document'', ''status_document'');\n'
    || E'    get diagnostics v_superseded = row_count;\n'
    || E'  elsif s.rtw_branch = ''home_office_check'' and p_branch <> ''home_office_check'' then\n'
    || E'    update compliance_docs set review_status = ''superseded''\n'
    || E'     where staff_id = p_staff and review_status <> ''superseded''\n'
    || E'       and doc_type = ''home_office_check_result'';\n'
    || E'    get diagnostics v_superseded = row_count;\n'
    || E'  end if;\n\n'
    || E'  insert into audit_log (at, actor, action, entity, entity_id, data)\n  values (now(), v_reviewer, ''rtw.changed''',
    1, 'record_right_to_work_change supersede');
  v_def := pg_temp.hoc_sub(v_def,
    $p$'actorName', (select full_name from profiles where id = v_reviewer))));$p$,
    $p$'evidenceSuperseded', nullif(v_superseded, 0),
            'actorName', (select full_name from profiles where id = v_reviewer))));$p$,
    1, 'record_right_to_work_change audit');
  v_def := pg_temp.hoc_sub(v_def,
    $p$return jsonb_build_object('ok', true, 'branch', p_branch::text, 'until', p_until,$p$,
    $p$return jsonb_build_object('ok', true, 'branch', p_branch::text, 'until', p_until,
                            'evidenceSuperseded', v_superseded,$p$,
    1, 'record_right_to_work_change result');
  execute v_def;
end $$;

-- ---------------------------------------------------------------------
-- 6 · The office attaches the result.
-- ---------------------------------------------------------------------
create or replace function public.office_attach_home_office_check(p_staff uuid, p_path text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_reviewer uuid := assert_reviewer();
  s          staff;
  d          compliance_docs;
  v_check    record;
  v_doc      uuid;
  v_mode     text;
begin
  select * into s from staff where id = p_staff for update;
  if s.id is null then
    raise exception 'unknown_staff' using errcode = 'P0002';
  end if;
  if s.status in ('rejected', 'removed', 'inactive') or s.removed_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'not_eligible');
  end if;
  if s.rtw_branch is distinct from 'home_office_check' then
    return jsonb_build_object('ok', false, 'reason', 'not_home_office_branch');
  end if;

  -- PDF, JPG or PNG up to 10 MB, under this worker's own folder (§2.5 pt 7).
  select * into v_check from evidence_upload_problem(s.id, 'home-office-check-result', p_path);
  if v_check.problem is not null then
    return jsonb_build_object('ok', false, 'reason', v_check.problem);
  end if;
  if exists (select 1 from compliance_docs c
              where c.file_path = p_path or c.gov_report_path = p_path) then
    return jsonb_build_object('ok', false, 'reason', 'invalid_path');
  end if;

  select * into d
    from compliance_docs c
   where c.staff_id = s.id
     and c.doc_type = 'home_office_check_result'
     and c.review_status = 'pending'
   order by c.uploaded_at desc, c.id
   limit 1
   for update;

  if d.id is not null and d.file_path is null then
    -- The row step 4 filed, waiting for exactly this.
    update compliance_docs
       set file_path = p_path,
           mime_type = v_check.mime,
           size_bytes = v_check.size_bytes,
           uploaded_at = clock_timestamp(),
           share_code = coalesce(share_code, s.home_office_ref)
     where id = d.id;
    v_doc := d.id;
    v_mode := 'attached';
  else
    -- A renewal (the last one verified or rejected), or a replacement for a
    -- result not yet reviewed: a fresh row. The one it replaces, if still
    -- pending, is superseded and kept; a verified one counts until this one
    -- is verified (current_verified_docs, rtw_evidence_until).
    update compliance_docs
       set review_status = 'superseded'
     where staff_id = s.id
       and doc_type = 'home_office_check_result'
       and review_status = 'pending';
    insert into compliance_docs (staff_id, doc_type, file_path, share_code, review_status,
                                 mime_type, size_bytes, uploaded_at)
    values (s.id, 'home_office_check_result', p_path, s.home_office_ref, 'pending',
            v_check.mime, v_check.size_bytes, clock_timestamp())
    returning id into v_doc;
    v_mode := case when d.id is null then 'new' else 'replaced' end;
  end if;

  insert into audit_log (at, actor, action, entity, entity_id, data)
  values (now(), v_reviewer, 'rtw.home_office_check_attached', 'compliance_docs', v_doc,
          jsonb_strip_nulls(jsonb_build_object(
            'staffId', s.id, 'employeeId', s.employee_id, 'branch', s.rtw_branch,
            'docType', 'home_office_check_result', 'filePath', p_path, 'mode', v_mode,
            'replacedDocumentId', case when v_mode = 'replaced' then d.id end,
            'actorName', (select full_name from profiles where id = v_reviewer))));

  return jsonb_build_object('ok', true, 'documentId', v_doc::text, 'mode', v_mode,
                            'status', 'pending');
end $$;

comment on function public.office_attach_home_office_check(uuid, text) is
  'ADR-0182: the office attaches the Home Office Employer Checking Service result (PDF/JPG/PNG ≤ 10 MB, <staff>/home-office-check-result/…) for a worker on the home_office_check branch — onto the pending row step 4 filed while it has no file, otherwise as a fresh pending row (a renewal, or a replacement that supersedes a result not yet reviewed). Verify then needs the right-to-work-until date. Reviewer only (assert_reviewer); audited as rtw.home_office_check_attached.';

revoke all on function public.office_attach_home_office_check(uuid, text) from public, anon;
grant execute on function public.office_attach_home_office_check(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 7 · Verify a result: the date approved, then the one Verify path.
-- ---------------------------------------------------------------------
create or replace function public.home_office_check_until(p_approved_on date)
returns date
language sql
immutable
set search_path = public, extensions
as $$
  select (p_approved_on + interval '6 months')::date
$$;

comment on function public.home_office_check_until(date) is
  'ADR-0182: the right-to-work-until a Home Office check result gives by default — six months from the date approved, the same day of the month, clamped to the end of a shorter month (31.08 → 28/29.02). homeOfficeCheckUntil() in packages/domain is the same rule; pgTAP 912 runs its vectors here.';

revoke all on function public.home_office_check_until(date) from public, anon;
grant execute on function public.home_office_check_until(date) to authenticated, service_role;

create or replace function public.compliance_verify_home_office_check(
  p_doc                 uuid,
  p_approved_on         date,
  p_right_to_work_until date default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_reviewer uuid := assert_reviewer();
  d          compliance_docs;
  v_today    date := (now() at time zone 'Europe/London')::date;
  v_until    date;
begin
  select * into d from compliance_docs where id = p_doc for update;
  if d.id is null then
    raise exception 'document_not_found' using errcode = 'P0002';
  end if;
  if d.doc_type <> 'home_office_check_result' then
    raise exception 'not_a_home_office_check' using errcode = 'P0001';
  end if;
  if d.review_status <> 'pending' then
    raise exception 'not_pending: %', d.review_status using errcode = 'P0001';
  end if;
  if p_approved_on is null then
    raise exception 'approved_on_required' using errcode = 'P0001';
  end if;
  if not isfinite(p_approved_on) or p_approved_on > v_today or p_approved_on < date '2000-01-01' then
    raise exception 'approved_on_invalid' using errcode = '22023';
  end if;
  if p_right_to_work_until is not null and not isfinite(p_right_to_work_until) then
    -- "No time limit" is only ever an EU settled share code's.
    raise exception 'no_time_limit_not_allowed: home_office_check' using errcode = 'P0001';
  end if;

  -- Six months from approval, same day of the month, clamped to the end of
  -- a shorter month — homeOfficeCheckUntil() in packages/domain.
  v_until := coalesce(p_right_to_work_until, home_office_check_until(p_approved_on));
  if v_until <= p_approved_on then
    raise exception 'until_before_approved' using errcode = 'P0001';
  end if;

  update compliance_docs set home_office_approved_on = p_approved_on where id = d.id;

  -- The one Verify path: the date guard, the right-to-work date, rtw.verified
  -- in the audit log, the re-check, the §2.3 advance. A refusal there
  -- (already expired, a removed worker) rolls the approval date back too.
  return compliance_verify_document_as(v_reviewer, d.id, null, null, v_until)
         || jsonb_build_object('approvedOn', p_approved_on, 'confirmedUntil', v_until);
end $$;

comment on function public.compliance_verify_home_office_check(uuid, date, date) is
  'ADR-0182: Verify a Home Office Employer Checking Service result. The reviewer gives the date approved printed on it (stored as home_office_approved_on; not in the future); the right-to-work-until is that date + 6 months (THC, 22.10.2026: "valid for 6 months from the date it was approved") unless the reviewer types another, and must fall after it. Then the one Verify path (compliance_verify_document_as). Reviewer only (assert_reviewer).';

revoke all on function public.compliance_verify_home_office_check(uuid, date, date) from public, anon;
grant execute on function public.compliance_verify_home_office_check(uuid, date, date) to authenticated, service_role;

comment on function public.compliance_docs_rtw_date_guard() is
  'ADR-0018: a visa document, status document, share code report or (ADR-0182) Home Office check result is verified with the right-to-work date it confirms; "no time limit" only on an EU settled share code report.';

drop function pg_temp.hoc_sub(text, text, text, int, text);
