-- =====================================================================
-- Migration 20261022170200 · only named office users decide criminal
--                            declarations (ADR-0180)
--
-- THC's reply (22.10.2026): only named people — today Sam and Richard —
-- may decide a criminal declaration. Every other office login keeps
-- reading it as before (who may READ the details is unchanged here).
--
--   profiles.reviews_criminal_records   the per-login permission, beside
--                                       office_role (ADR-0056/0060); set by
--                                       an owner on /users, audited
--   can_review_criminal_records()       may the caller decide one? A holder
--                                       who may write — or, while NO
--                                       working office login holds it, an
--                                       owner, so nothing locks up at release
--   assert_criminal_records_reviewer()  the same, as a refusal
--                                       (not_criminal_records_reviewer, 42501)
--   admin_set_criminal_records_reviewer(user, on)   owners only
--   admin_criminal_records_reviewers()              the holders, for /users
--
-- Enforced in every function that decides one: compliance_verify_declaration
-- and compliance_reject_declaration (restated below from their latest
-- bodies, 20260923100000 and 20260930130200, with one line added), and the
-- two ADR-0180 follow-ups (20261022170100, which call the assert). The
-- onboarding screen's verify_declaration / reject_declaration wrap the
-- first two, so they are covered too.
--
-- "Working" is what the last-owner guard counts (20261001200100): a login
-- that is not switched off. A viewer cannot decide anything (ADR-0060), so
-- a viewer holding it does not count either, and cannot be given it.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1 · The permission
-- ---------------------------------------------------------------------
alter table public.profiles
  add column if not exists reviews_criminal_records boolean not null default false;

alter table public.profiles
  add constraint profiles_reviews_criminal_records_office_only
    check (not reviews_criminal_records or role = 'admin');

comment on column public.profiles.reviews_criminal_records is
  'ADR-0180: this Back Office login may decide criminal declarations (Verify, Reject, Ask for more details, Reverse rejection). Set by an owner on /users (admin_set_criminal_records_reviewer, audited). While no working, writing office login holds it, owners decide (can_review_criminal_records).';

-- ---------------------------------------------------------------------
-- 2 · Who may decide
-- ---------------------------------------------------------------------
create or replace function public.can_review_criminal_records()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select office_can('write')
           and (p.reviews_criminal_records
                or (office_can('users')
                    and not exists (
                      select 1 from profiles h join auth.users u on u.id = h.id
                       where h.role = 'admin'
                         and h.reviews_criminal_records
                         and h.office_role in ('owner', 'manager', 'scheduler')
                         and (u.banned_until is null or u.banned_until <= now()))))
      from profiles p
     where p.id = auth.uid() and p.role = 'admin'), false)
$$;
comment on function public.can_review_criminal_records() is
  'ADR-0180: may the signed-in Back Office login decide a criminal declaration? A login named on /users (reviews_criminal_records) that may write; or, while no working, writing office login is named, an owner. False for any other session.';

revoke execute on function public.can_review_criminal_records() from public, anon;
grant execute on function public.can_review_criminal_records() to authenticated, service_role;

create or replace function public.assert_criminal_records_reviewer()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not can_review_criminal_records() then
    raise exception 'not_criminal_records_reviewer' using errcode = '42501',
      detail = 'Only office users allowed to review criminal records can decide this.';
  end if;
end $$;
comment on function public.assert_criminal_records_reviewer() is
  'ADR-0180: raises not_criminal_records_reviewer (42501) unless can_review_criminal_records(). Called by every function that decides a criminal declaration.';

revoke execute on function public.assert_criminal_records_reviewer() from public, anon, authenticated;
grant execute on function public.assert_criminal_records_reviewer() to service_role;

-- ---------------------------------------------------------------------
-- 3 · /users: an owner names who may decide, and the list
-- ---------------------------------------------------------------------
create or replace function public.admin_set_criminal_records_reviewer(
  p_user uuid,
  p_on   boolean
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor  uuid := auth.uid();
  v_target profiles;
begin
  if current_app_role() is distinct from 'admin' then
    raise exception 'not_authorised' using errcode = '42501';
  end if;
  if not office_can('users') then
    raise exception 'not_permitted' using errcode = '42501', detail = 'users';
  end if;
  if p_on is null then
    raise exception 'value_required' using errcode = 'P0001';
  end if;
  select * into v_target from profiles where id = p_user for update;
  if v_target.id is null then
    raise exception 'unknown_account' using errcode = 'P0001';
  end if;
  if v_target.role <> 'admin' then
    raise exception 'not_office_login' using errcode = 'P0001';
  end if;
  if p_on and v_target.office_role = 'viewer' then
    -- A viewer changes nothing (ADR-0060), so naming one would name nobody.
    raise exception 'viewer_cannot_review' using errcode = 'P0001';
  end if;
  if v_target.reviews_criminal_records = p_on then
    return jsonb_build_object('userId', p_user, 'reviewsCriminalRecords', p_on, 'changed', false);
  end if;

  update profiles set reviews_criminal_records = p_on, updated_at = now() where id = p_user;

  insert into audit_log (actor, action, entity, entity_id, data)
  values (v_actor,
          case when p_on then 'account.criminal_records_granted'
               else 'account.criminal_records_revoked' end,
          'account', p_user,
          jsonb_build_object('from', v_target.reviews_criminal_records, 'to', p_on,
                             'officeRole', v_target.office_role::text));

  return jsonb_build_object('userId', p_user, 'reviewsCriminalRecords', p_on, 'changed', true);
end $$;
comment on function public.admin_set_criminal_records_reviewer(uuid, boolean) is
  'ADR-0180 /users: allow or stop a Back Office login deciding criminal declarations. Owners only (office_can(''users'')); office logins only; never a viewer. Audited as account.criminal_records_granted / _revoked.';

revoke execute on function public.admin_set_criminal_records_reviewer(uuid, boolean) from public, anon;
grant execute on function public.admin_set_criminal_records_reviewer(uuid, boolean) to authenticated;

create or replace function public.admin_criminal_records_reviewers()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case when current_app_role() = 'admin' then
    coalesce((select jsonb_agg(p.id::text order by p.full_name)
                from profiles p
               where p.role = 'admin' and p.reviews_criminal_records), '[]'::jsonb)
  end
$$;
comment on function public.admin_criminal_records_reviewers() is
  'ADR-0180: the ids of the Back Office logins named to decide criminal declarations, for /users. Office sessions only (NULL for anyone else).';

revoke execute on function public.admin_criminal_records_reviewers() from public, anon;
grant execute on function public.admin_criminal_records_reviewers() to authenticated;

-- ---------------------------------------------------------------------
-- 4 · Verify, restated from 20260923100000 with the check added
-- ---------------------------------------------------------------------
create or replace function public.compliance_verify_declaration(
  p_declaration uuid,
  p_note        text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_reviewer uuid := assert_reviewer();
  c          criminal_declarations;
  v_was      staff_status;
  v_now      staff_status;
begin
  -- 20261022170200 (ADR-0180): only the named criminal-records reviewers.
  perform assert_criminal_records_reviewer();
  select * into c from criminal_declarations where id = p_declaration for update;
  if c.id is null then
    raise exception 'declaration_not_found' using errcode = 'P0002';
  end if;
  if not c.answer or c.superseded or c.review_status <> 'pending' then
    raise exception 'not_pending' using errcode = 'P0001';
  end if;
  select status into v_was from staff where id = c.staff_id;
  if v_was in ('rejected', 'removed') then
    raise exception 'not_reviewable: %', v_was using errcode = 'P0001';
  end if;

  update criminal_declarations
     set review_status = 'verified',
         reviewed_by = v_reviewer,
         reviewed_at = now(),
         review_note = nullif(trim(coalesce(p_note, '')), '')
   where id = c.id;

  select status into v_now from staff where id = c.staff_id;
  return jsonb_build_object(
    'verified', true,
    'declarationId', c.id::text,
    'unblocked', v_was = 'blocked' and v_now = 'compliant',
    'status', v_now::text);
end $$;
comment on function public.compliance_verify_declaration(uuid, text) is
  '§10.7 Verify on a pending Yes declaration: the reviewer is stamped and criminal_declaration_reviewed() runs the §4.3 re-check and N15. Since 20261022170200 only a named criminal-records reviewer (owners while nobody is named, ADR-0180).';

-- ---------------------------------------------------------------------
-- 5 · Reject, restated from 20260930130200 with the check added
-- ---------------------------------------------------------------------
create or replace function public.compliance_reject_declaration(
  p_declaration uuid,
  p_reason      text
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_reviewer uuid := assert_reviewer();
  c          criminal_declarations;
  v_reason   text := nullif(trim(coalesce(p_reason, '')), '');
begin
  -- 20261022170200 (ADR-0180): only the named criminal-records reviewers.
  perform assert_criminal_records_reviewer();
  if v_reason is null then
    raise exception 'reason_required' using errcode = 'P0001';
  end if;
  select * into c from criminal_declarations where id = p_declaration for update;
  if c.id is null then
    raise exception 'declaration_not_found' using errcode = 'P0002';
  end if;
  if not c.answer or c.superseded or c.review_status <> 'pending' then
    raise exception 'not_pending' using errcode = 'P0001';
  end if;

  update criminal_declarations
     set review_status = 'rejected',
         reviewed_by = v_reviewer,
         reviewed_at = now(),
         review_note = v_reason
   where id = c.id;

  -- In employment: no push, by design (§10.7). At onboarding a Yes
  -- follows the document mechanic, N8 included, landing in the wizard.
  if c.source = 'onboarding' then
    insert into notification_outbox (key, channel, template, recipient_staff_id, payload)
    values ('N8:declaration:' || c.id, 'push', 'N8', c.staff_id,
            jsonb_build_object('reason', v_reason,
                               'document', 'Criminal Record declaration',
                               'documentId', c.id::text,
                               'link', n8_link((select s.status from staff s where s.id = c.staff_id))))
    on conflict (key) do nothing;
  end if;

  return jsonb_build_object('rejected', true, 'declarationId', c.id::text);
end $$;
comment on function public.compliance_reject_declaration(uuid, text) is
  '§10.7 Reject, reason mandatory: the block converts to a manual block carrying the reason. No push for an in-employment declaration — the office calls the worker; an onboarding Yes gets N8, landing in the wizard (D42). Since 20261022170200 only a named criminal-records reviewer (owners while nobody is named, ADR-0180).';
