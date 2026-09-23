-- =====================================================================
-- A verified right-to-work document keeps its date
-- (§2.3, §2.5, §2.6, RULE-20; ADR-0018 follow-up; docs/14 §4)
--
-- The gap this closes
-- -------------------
-- 20260923200000 made the right-to-work date required on the ROW, but
-- compliance_docs_rtw_date_guard only fires on the flip to `verified`.
-- A later direct UPDATE that blanked a verified visa document's expiry,
-- a status document's expiry or a share code report's right-to-work
-- date was not refused — by an admin through PostgREST (admin_all
-- reaches compliance_docs), by a service-role script, by a psql fix. The
-- worker's date then recomputes from the evidence (compliance_docs_
-- rtw_until) and, with nothing left, becomes NULL: can_roster_staff()
-- reads NULL as "no expiry recorded", so the per-shift hard stop, the
-- rtw_daily alerts and compliance_daily's block all go quiet. Right-to-
-- work expiry outranks everything (CLAUDE.md); a blank must not be the
-- way it is lost.
--
-- The rule
-- --------
-- A verified visa_document / status_document / share_code_report that
-- STAYS verified cannot end an UPDATE without the date it confirms
-- (rtw_doc_until) unless it is a settled-status share code confirmed
-- with no time limit (rtw_no_time_limit, §2.5 pt 2). Concretely refused:
--   · the date set to null;
--   · rtw_no_time_limit switched off with no date put in its place;
--   · rtw_no_time_limit switched ON for a worker not on the EU settled
--     branch (that is a blank by another name — the same refusal the
--     flip guard raises);
--   · doc_type moved onto one of the three while verified and dateless.
-- A row that was ALREADY verified-and-dateless before this migration
-- (legacy data) is not made worse by a write that leaves it so, and is
-- not refused. Un-verifying a row (review_status leaves `verified`) is
-- a state change, not a blank, and is not this trigger's business.
--
-- The escape
-- ----------
-- Test fixtures (the 200, 220 and 250 pgTAP setups empty the seed's
-- dates so their counts are true) and deliberate maintenance need to
-- blank dates. They do it with a transaction-local setting:
--
--     set local thc.allow_rtw_date_clear = 'on';
--
-- A custom GUC is settable by ANY session, so the setting alone is not a
-- permission. It is honoured only when the caller is not a client role:
--   · current_setting('role') — what PostgREST's `set local role` and a
--     test's `set local role` write — is not anon / authenticated. This
--     GUC is NOT changed by entering a SECURITY DEFINER function, so an
--     authenticated caller cannot launder the update through an RPC
--     owned by postgres.
--   · session_user is not anon / authenticated (they are nologin on
--     Supabase; defence in depth should that ever change).
--   · a PostgREST connection that has dropped its role (session_user =
--     authenticator, role = none) is refused as well: authenticator is
--     only ever meant to act AS one of its three roles.
-- So: the migration owner / postgres / supabase_admin, and service_role,
-- may use it; anon and authenticated (admins included — they are
-- authenticated) may not. current_user is deliberately not the test —
-- this function is SECURITY DEFINER (it reads staff for the branch
-- check), so inside it current_user is always the owner.
-- =====================================================================

create or replace function public.rtw_date_clear_allowed()
returns boolean
language sql
stable
set search_path = public, extensions
as $$
  select coalesce(current_setting('thc.allow_rtw_date_clear', true), '') = 'on'
     and coalesce(nullif(current_setting('role', true), ''), 'none') not in ('anon', 'authenticated')
     and session_user::text not in ('anon', 'authenticated')
     and not (session_user::text = 'authenticator'
              and coalesce(nullif(current_setting('role', true), ''), 'none') = 'none')
$$;

comment on function public.rtw_date_clear_allowed() is
  'True only when thc.allow_rtw_date_clear = on AND the caller is not a client role (role GUC and session_user not anon/authenticated, not a role-less authenticator). The escape hatch for compliance_docs_rtw_date_keep (20260926120000).';

create or replace function public.compliance_docs_rtw_date_keep()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_branch    rtw_branch;
  v_new_until date := rtw_doc_until(new.doc_type, new.expiry_date, new.right_to_work_until);
  v_old_until date := rtw_doc_until(old.doc_type, old.expiry_date, old.right_to_work_until);
begin
  if rtw_date_clear_allowed() then
    return new;
  end if;

  -- No time limit newly claimed on a verified row: the same branch rule
  -- as the flip guard (§2.5 pt 2). The check constraint already pins it
  -- to a dateless share code report.
  if new.rtw_no_time_limit and not old.rtw_no_time_limit then
    select rtw_branch into v_branch from staff where id = new.staff_id;
    if new.doc_type <> 'share_code_report' or v_branch is distinct from 'eu_settled' then
      raise exception 'no_time_limit_not_allowed: %', coalesce(v_branch::text, 'no branch')
        using errcode = 'P0001',
              hint = 'Only a share code report on the EU settled branch may be confirmed with no time limit (§2.5 pt 2).';
    end if;
    return new;
  end if;

  if new.rtw_no_time_limit or v_new_until is not null then
    return new;
  end if;

  -- Dateless now. Legacy verified-and-dateless rows of the same type are
  -- left as they were; anything that HAD a date (or no time limit), or
  -- that has just become right-to-work evidence, is refused.
  if old.doc_type = new.doc_type and v_old_until is null and not old.rtw_no_time_limit then
    return new;
  end if;

  raise exception 'rtw_date_locked: %', new.doc_type
    using errcode = 'P0001',
          hint = 'A verified right-to-work document keeps the date it confirms. Supersede it with a new upload, or reject it; fixtures and maintenance use set local thc.allow_rtw_date_clear = ''on'' as owner or service role (20260926120000).';
end $$;

comment on function public.compliance_docs_rtw_date_keep() is
  'Refuses an UPDATE that leaves a still-verified visa document, status document or share code report without its right-to-work date (settled no-time-limit share codes excepted). Escape: rtw_date_clear_allowed() (20260926120000).';

drop trigger if exists compliance_docs_rtw_date_keep on compliance_docs;
create trigger compliance_docs_rtw_date_keep
  before update of expiry_date, right_to_work_until, rtw_no_time_limit, doc_type, review_status
  on compliance_docs
  for each row
  when (old.review_status = 'verified'
        and new.review_status = 'verified'
        and new.doc_type in ('visa_document', 'status_document', 'share_code_report'))
  execute function compliance_docs_rtw_date_keep();

revoke execute on function public.compliance_docs_rtw_date_keep() from public, anon, authenticated;
revoke execute on function public.rtw_date_clear_allowed()        from public, anon, authenticated;
