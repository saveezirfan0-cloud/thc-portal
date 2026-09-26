-- =====================================================================
-- ADR-0054 · The viewer office role writes nothing — enforced in the
-- database, on every write path
--
-- A viewer (20260930220000) is a Back Office login that reads what a
-- manager reads, finance included, and changes nothing. Every existing
-- policy asks `current_app_role() = 'admin'`, which a viewer is, so the
-- permissive admin_all policies would let one write; and a security
-- definer RPC runs past RLS altogether. A restrictive policy per table
-- would therefore close only half of it.
--
-- What closes all of it is a TRIGGER, because a trigger fires whoever
-- runs the statement — a PostgREST write, a definer RPC, a trigger inside
-- either. So:
--
-- 1 · office_can() learns the viewer (finance: yes; users, settings: no)
--     and a fourth permission, 'write' — owner, manager and scheduler
--     yes, viewer no — for the Back Office to ask.
-- 2 · office_read_only — a BEFORE INSERT / UPDATE / DELETE / TRUNCATE
--     trigger, FOR EACH STATEMENT, on every table in public (extension
--     tables aside), raising `read_only` when auth.uid() is a viewer.
--     Statement-level, so a 10,000-row job pays once, not 10,000 times;
--     and with no session at all (jobs, the service role, webhooks) it
--     returns before its one lookup. With a session it is one primary-key
--     read of profiles per statement. 750_viewer_role fails if a table
--     arrives without it.
--       The allow-list is one table, `profiles`: a viewer changes their
--     own name, job title and phone through update_my_profile() (/account).
--     profiles has no write policy, and every other definer that writes it
--     is owners-only (/users) or also writes a guarded table.
--       audit_log is guarded for UPDATE / DELETE / TRUNCATE; its INSERT is
--     item 3, because update_my_profile() writes the audit row too.
-- 3 · audit_log_office_read_only — an AFTER INSERT statement trigger with
--     a transition table: an audit row naming a viewer as its actor is
--     refused unless it is 'profile.updated'. This is the one gate for
--     the SERVICE-KEY paths, where auth.uid() is null: the staff profile's
--     Block / Unblock / Reset to candidate / Remove run on the service key
--     and pass the manager as p_actor, and each writes that actor into
--     audit_log in the same transaction — so the raise undoes the whole
--     call. One query per statement, over the rows inserted.
-- 4 · onboarding_resend_activation_check() refuses a viewer. It is the
--     office's "may I?" asked BEFORE the service key mints a new token,
--     and minting replaces the token in the link the candidate already
--     has; its second step is refused by item 2, but by then the old
--     link is dead. The body is 20260924110000's with one line added
--     (docs/10 §3b).
--
-- Deliberately not here (ADR-0054 "Residual gaps"): Supabase Auth and
-- Storage calls the Back Office makes with the service key BEFORE any
-- database write — Accept's login mint, a document PDF stored before
-- record_event_document() refuses, an upload slot. Those leave an unused
-- login or file behind, never a changed record.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1 · office_can()
--
-- 20260930210500's body with the viewer and 'write' added. It still goes
-- through current_app_role(), so a switched-off login and a two-step
-- login below aal2 are refused everything, as before.
-- ---------------------------------------------------------------------
create or replace function public.office_can(p_perm text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select p_perm in ('users', 'settings', 'finance', 'write')
           and case p.office_role
                 when 'owner'     then true
                 when 'manager'   then p_perm in ('finance', 'write')
                 when 'scheduler' then p_perm = 'write'
                 when 'viewer'    then p_perm = 'finance'
                 else false
               end
      from profiles p
     where p.id = auth.uid() and p.role = 'admin'
       and current_app_role() = 'admin'), false)
$$;

comment on function public.office_can(text) is
  'ADR-0050, ADR-0054: may the signed-in Back Office login use ''users'' | ''settings'' | ''finance'' | ''write''? owner: all four; manager: finance, write; scheduler: write; viewer: finance (reads money, changes nothing). False for any other session and any other permission name. ''write'' is for the Back Office to ask; the database enforces it with the office_read_only triggers (20260930220100).';

revoke all on function public.office_can(text) from public, anon;
grant execute on function public.office_can(text) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 2 · The read-only guard
-- ---------------------------------------------------------------------

-- For a definer RPC to ask before it does something outside the database
-- (item 4). Internal: not granted to any API role.
create or replace function public.assert_not_read_only()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is not null
     and exists (select 1 from profiles p where p.id = v_uid and p.office_role = 'viewer') then
    raise exception 'read_only' using errcode = '42501',
      detail = 'A viewer can read the Back Office but not change anything (ADR-0054).';
  end if;
end;
$$;

comment on function public.assert_not_read_only() is
  'ADR-0054: raises read_only when the signed-in session is a Back Office viewer. For definer RPCs that act outside the database before they write.';

-- Security definer so the one lookup never depends on the caller's own
-- policies on profiles; it reads one row by primary key.
create or replace function public.office_read_only_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  -- Jobs, webhooks and the service role carry no user: nothing to ask.
  if v_uid is null then
    return null;
  end if;
  if exists (select 1 from profiles p where p.id = v_uid and p.office_role = 'viewer') then
    raise exception 'read_only' using errcode = '42501',
      detail = format('A viewer can read the Back Office but not change anything (%s on %s, ADR-0054).',
                      tg_op, tg_table_name);
  end if;
  return null;
end;
$$;

comment on function public.office_read_only_guard() is
  'ADR-0054: the office_read_only statement trigger on every public table (profiles aside). Raises read_only for a Back Office viewer, whether the write came through PostgREST or a security definer RPC. No session: returns at once.';

-- 3 · The audit actor guard — the service-key paths.
create or replace function public.office_read_only_audit_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1
               from office_read_only_new_rows n
               join profiles p on p.id = n.actor
              where p.office_role = 'viewer'
                and n.action is distinct from 'profile.updated') then
    raise exception 'read_only' using errcode = '42501',
      detail = 'A viewer can read the Back Office but not change anything (ADR-0054).';
  end if;
  return null;
end;
$$;

comment on function public.office_read_only_audit_guard() is
  'ADR-0054: refuses an audit_log row whose actor is a Back Office viewer (their own profile.updated aside). Catches the service-key RPCs that name the manager as p_actor, where auth.uid() is null.';

do $$
declare
  r record;
begin
  for r in
    select c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relkind in ('r', 'p')
       and c.relname <> 'profiles'
       -- PostGIS's spatial_ref_sys: the extension's, and on Supabase not
       -- the migration role's to alter.
       and not exists (select 1 from pg_depend d
                        where d.classid = 'pg_class'::regclass
                          and d.objid = c.oid and d.deptype = 'e')
     order by c.relname
  loop
    execute format('drop trigger if exists office_read_only on public.%I', r.relname);
    if r.relname = 'audit_log' then
      execute format(
        'create trigger office_read_only before update or delete or truncate on public.%I '
        'for each statement execute function public.office_read_only_guard()', r.relname);
    else
      execute format(
        'create trigger office_read_only before insert or update or delete or truncate on public.%I '
        'for each statement execute function public.office_read_only_guard()', r.relname);
    end if;
  end loop;
end;
$$;

drop trigger if exists audit_log_office_read_only on audit_log;
create trigger audit_log_office_read_only
  after insert on audit_log
  referencing new table as office_read_only_new_rows
  for each statement execute function public.office_read_only_audit_guard();

-- ---------------------------------------------------------------------
-- 4 · Resend activation link: refuse a viewer before anything is minted.
--     20260924110000's body; the ADR-0054 line is the only addition.
-- ---------------------------------------------------------------------
create or replace function public.onboarding_resend_activation_check(p_staff uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_refusal text;
  s         staff;
begin
  perform assert_office_caller();
  -- ADR-0054: minting the new token kills the candidate's current link.
  perform assert_not_read_only();
  v_refusal := activation_resend_refusal(p_staff, now());
  if v_refusal is not null then
    raise exception '%', v_refusal using errcode = 'P0001';
  end if;
  select * into s from staff where id = p_staff;
  return jsonb_build_object('staffId', s.id::text, 'email', s.email, 'userId', s.user_id::text);
end $$;

comment on function public.onboarding_resend_activation_check(uuid) is
  '§2.7 Resend activation link, step 1: whether a resend is allowed now (accepted, not rejected/inactive/removed, not yet activated, none in the last 10 minutes) and the email + login to mint it for. Office only, and never a viewer (ADR-0054); raises the refusal code.';

-- ---------------------------------------------------------------------
-- Grants (docs/14 O7: by name). The trigger functions need none — a
-- trigger fires regardless (190_job_function_grants 3).
-- ---------------------------------------------------------------------
revoke all on function public.assert_not_read_only()           from public, anon, authenticated;
revoke all on function public.office_read_only_guard()         from public, anon, authenticated;
revoke all on function public.office_read_only_audit_guard()   from public, anon, authenticated;
revoke execute on function public.onboarding_resend_activation_check(uuid) from public, anon;
grant  execute on function public.onboarding_resend_activation_check(uuid) to authenticated;
