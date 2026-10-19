-- =====================================================================
-- Migration 20261020130000 · compulsory two-step for the Back Office and
--                            a server-side cap on an office session's age
--                            (ADR-0164; security audit H1, M4; §1.4, §10.2)
--
-- Measured on the live project, 19.10.2026 (read-only): four Back Office
-- logins (two owners, two managers), none with an authenticator, and
-- sessions up to 17 days old. A phished or reused office password was the
-- whole of the defence, and a refresh token copied once from a shared
-- browser kept working for as long as it was used.
--
-- 1 · Two settings rows, owner-editable on /settings like every other
--     (the `settings` policies and the settings_audit trigger apply):
--       office_two_step_required  JSON boolean, default true
--       office_session_max_hours  JSON number 1–24, default 12
--     settings_office_security_guard refuses any other shape, so a typo
--     can never become "no cap" or "not required".
-- 2 · office_security_settings(): the one reading of the two rows. A row
--     that is missing or unreadable reads as the SAFE value (required,
--     12 h), never as off.
-- 3 · current_app_role(): restated from the live body (20261013100100,
--     md5 941ac781…, pg_get_functiondef read 19.10.2026) and still plpgsql,
--     security definer, stable, search_path = public (786). For a Back
--     Office login whose token names a sign-in session (`session_id`, which
--     every GoTrue token carries) it now also answers NULL when
--       · the setting is on and the session is below aal2 — with or
--         without an authenticator, so a password alone reaches no data;
--       · the session was created more than office_session_max_hours ago
--         (auth.sessions.created_at: the sign-in, which a refresh never
--         moves), so a stolen refresh token stops working however often
--         it is refreshed.
--     Unchanged: no session → NULL; a switched-off login → NULL; a token
--     whose session has ended → NULL (every role); a verified factor
--     below aal2 → NULL whatever the setting; staff and client logins are
--     untouched by both new rules. A token with no session_id (none that
--     GoTrue issues: the service role, jobs, pgTAP fixtures that set only
--     `sub`) is judged as before — the same line 20261013100100 draws for
--     the session clause, and the reason 745 still passes.
--     service_role and every job: auth.uid() is null there, as before.
-- 4 · office_session_policy(): what the Back Office middleware needs to
--     send a session to the enrol step or back to sign-in before any page
--     is drawn — the two settings and the start of the caller's OWN
--     session. Authenticated only; it reads nothing of anyone else's.
--
-- The middleware is the first gate (apps/office/middleware.ts); this is
-- the one that protects the rows, so it ships with it.
-- Forward-only. pgTAP 895 pins it; 756 now gives its live-session admin an
-- aal2 token (the setting is on by default).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1 · The settings rows and their guard
-- ---------------------------------------------------------------------
insert into public.settings (key, value) values
  ('office_two_step_required', 'true'::jsonb),
  ('office_session_max_hours', '12'::jsonb)
on conflict (key) do nothing;

create or replace function public.settings_office_security_guard()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
declare
  v_hours numeric;
  v_ok    boolean;
begin
  if new.key = 'office_two_step_required' and jsonb_typeof(new.value) is distinct from 'boolean' then
    raise exception 'office_two_step_required_not_boolean' using errcode = '22023',
      hint = 'settings.office_two_step_required is true or false (ADR-0164).';
  end if;
  if new.key = 'office_session_max_hours' then
    -- Nested, so the cast never meets a value that is not a number.
    if jsonb_typeof(new.value) is distinct from 'number' then
      v_ok := false;
    else
      v_hours := (new.value #>> '{}')::numeric;
      v_ok := v_hours = trunc(v_hours) and v_hours between 1 and 24;
    end if;
    if not v_ok then
      raise exception 'office_session_max_hours_out_of_range' using errcode = '22023',
        hint = 'settings.office_session_max_hours is a whole number of hours from 1 to 24 (ADR-0164).';
    end if;
  end if;
  return new;
end $$;

comment on function public.settings_office_security_guard() is
  'ADR-0164: settings.office_two_step_required must be a JSON boolean and settings.office_session_max_hours a whole number from 1 to 24; anything else is refused (22023).';

drop trigger if exists settings_office_security_guard on public.settings;
create trigger settings_office_security_guard
  before insert or update on public.settings
  for each row execute function public.settings_office_security_guard();

revoke execute on function public.settings_office_security_guard() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 2 · The one reading of them
-- ---------------------------------------------------------------------
create or replace function public.office_security_settings(
  out two_step_required boolean,
  out session_max_hours integer
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  select coalesce(bool_or(case when s.key = 'office_two_step_required'
                                and jsonb_typeof(s.value) = 'boolean'
                               then (s.value #>> '{}')::boolean end), true),
         coalesce(max(case when s.key = 'office_session_max_hours'
                            and jsonb_typeof(s.value) = 'number'
                           then least(24, greatest(1, floor((s.value #>> '{}')::numeric)))::int end), 12)
    from settings s
   where s.key in ('office_two_step_required', 'office_session_max_hours')
$$;

comment on function public.office_security_settings() is
  'ADR-0164: the Back Office sign-in policy — two_step_required (settings.office_two_step_required, missing = true) and session_max_hours (settings.office_session_max_hours, 1–24, missing = 12). Read by current_app_role() and office_session_policy().';

revoke execute on function public.office_security_settings() from public, anon, authenticated;
grant  execute on function public.office_security_settings() to service_role;

-- ---------------------------------------------------------------------
-- 3 · current_app_role()
-- ---------------------------------------------------------------------
create or replace function public.current_app_role() returns app_role
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid      uuid := auth.uid();
  v_claims   jsonb;
  v_role     app_role;
  v_sid      uuid;
  v_started  timestamptz;
  v_aal2     boolean;
  v_required boolean;
  v_hours    integer;
begin
  if v_uid is null then
    return null;
  end if;

  select p.role into v_role
    from profiles p
    join auth.users u on u.id = p.id
   where p.id = v_uid
     and (u.banned_until is null or u.banned_until <= now());
  if v_role is null then
    return null;
  end if;

  -- 20261013100100: every role (admin since 20261001204000, staff since
  -- 20261012120400, client since 20261013100100). A token with no
  -- session_id is judged as before.
  v_claims := auth.jwt();
  v_sid := nullif(v_claims ->> 'session_id', '')::uuid;
  if v_sid is not null then
    select s.created_at into v_started from auth.sessions s where s.id = v_sid;
    if not found then
      return null;
    end if;
  end if;

  if v_role <> 'admin' then
    return v_role;
  end if;

  -- 20261001200500: a verified factor and a session below aal2.
  v_aal2 := coalesce(v_claims ->> 'aal', 'aal1') = 'aal2';
  if not v_aal2
     and exists (select 1 from auth.mfa_factors f
                  where f.user_id = v_uid and f.status::text = 'verified') then
    return null;
  end if;

  -- 20261020130000 (ADR-0164): for a real sign-in session, two-step is
  -- compulsory while the setting is on, and the session has a maximum age.
  if v_sid is not null then
    select o.two_step_required, o.session_max_hours
      into v_required, v_hours
      from office_security_settings() o;
    if v_required and not v_aal2 then
      return null;
    end if;
    if coalesce(v_started, '-infinity'::timestamptz) < now() - make_interval(hours => v_hours) then
      return null;
    end if;
  end if;

  return v_role;
end $$;

comment on function public.current_app_role() is
  'The caller''s app role for RLS and every admin RPC. NULL — no access — with no session; for a switched-off login; for a Back Office login with a verified two-step factor below aal2; for any token (Back Office, Staff App or Client Portal) whose sign-in session has been ended (reset two-step, switch off, sign out other devices, a password reset); and, for a Back Office token naming its sign-in session, below aal2 while settings.office_two_step_required is on and once the session is older than settings.office_session_max_hours (20261020130000, ADR-0164). plpgsql so the plan is cached per session (20261012120000).';

-- The definer convention for this one is deliberate and old (0001): the
-- policies of every role call it, anon included.
grant execute on function public.current_app_role() to anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- 4 · What the Back Office middleware asks
-- ---------------------------------------------------------------------
create or replace function public.office_session_policy()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_sid     uuid;
  v_started timestamptz;
  o         record;
begin
  if v_uid is null then
    return null;
  end if;
  select * into o from office_security_settings();
  v_sid := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  if v_sid is not null then
    -- The caller's own session only.
    select s.created_at into v_started
      from auth.sessions s
     where s.id = v_sid and s.user_id = v_uid;
  end if;
  return jsonb_build_object(
    'twoStepRequired',  o.two_step_required,
    'sessionMaxHours',  o.session_max_hours,
    'sessionStartedAt', v_started);
end $$;

comment on function public.office_session_policy() is
  'ADR-0164: for the Back Office middleware — {twoStepRequired, sessionMaxHours, sessionStartedAt}: the sign-in policy and when the CALLER''s own sign-in session began (null when the token names none, or it has ended). Authenticated only. The database''s own enforcement is current_app_role().';

revoke execute on function public.office_session_policy() from public, anon;
grant  execute on function public.office_session_policy() to authenticated, service_role;
