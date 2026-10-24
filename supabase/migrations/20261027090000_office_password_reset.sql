-- =====================================================================
-- Migration 20261027090000 · Send password reset from the Back Office
--                            (ADR-0207, ticket TK-4)
--
-- "Resend activation link" is offered only until the person sets a
-- password (activation_resend_refusal → already_activated). After that the
-- Back Office had nothing to offer: a worker who opened an old activation
-- email, or the used link a second time, read "link expired", and the
-- office could neither resend it nor see that the account was already
-- working. Their way back in is the Staff App's own Forgot password, which
-- the worker has to find for themselves.
--
-- onboarding_password_reset_request(p_staff) is the office's half of that:
-- an office login that may write asks for Supabase Auth's recovery email
-- (the same email /forgot sends) to go to the worker's own login address.
--
--   * assert_office_caller(); a viewer is refused (assert_not_read_only).
--   * Refused for unknown_staff / removed, not_accepted, not_resendable
--     (rejected, inactive) — the same set Resend activation refuses — and
--     not_activated: before a password exists, Resend activation link is
--     the button, and this answers so.
--   * Once per 10 minutes per person (reset_too_soon: HH:MI, UK time).
--   * Audited as onboarding_password_reset against the manager, BEFORE the
--     email is asked for, so the 10-minute window holds even when two
--     presses race: the audit line records the REQUEST. If the send then
--     fails, the window is still used, and the answer's retryAfter (UK
--     HH:MI) lets the screen say when to try again rather than promise a
--     retry the database would refuse. The address comes from auth.users,
--     never the caller.
--
-- The email itself is sent by the Back Office server action through
-- GoTrue (/recover), throttled again there by the 'recover' counter
-- (3 an hour per address, packages/db/src/auth-throttle.ts).
-- =====================================================================

create or replace function public.onboarding_password_reset_request(p_staff uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  s       staff;
  v_email text;
  v_pass  boolean;
  v_last  timestamptz;
begin
  perform assert_office_caller();
  -- ADR-0060: a viewer reads and changes nothing, and sends nothing.
  perform assert_not_read_only();

  -- One request at a time per person, so the 10-minute window is real.
  select * into s from staff where id = p_staff for update;
  if s.id is null or s.removed_at is not null or s.status = 'removed' then
    raise exception 'unknown_staff' using errcode = 'P0001';
  end if;
  if s.status in ('interview_requested', 'interview_completed') then
    raise exception 'not_accepted' using errcode = 'P0001';
  end if;
  if s.status in ('rejected', 'inactive') then
    raise exception 'not_resendable' using errcode = 'P0001';
  end if;

  select u.email, coalesce(u.encrypted_password, '') <> ''
    into v_email, v_pass
    from auth.users u
   where u.id = s.user_id;
  if v_email is null or not coalesce(v_pass, false) then
    raise exception 'not_activated' using errcode = 'P0001';
  end if;

  select max(a.at) into v_last
    from audit_log a
   where a.entity = 'staff' and a.entity_id = p_staff and a.action = 'onboarding_password_reset';
  if v_last is not null and v_last > now() - interval '10 minutes' then
    raise exception 'reset_too_soon: %',
      to_char((v_last + interval '10 minutes') at time zone 'Europe/London', 'HH24:MI')
      using errcode = 'P0001';
  end if;

  insert into audit_log (actor, action, entity, entity_id, data)
  values (auth.uid(), 'onboarding_password_reset', 'staff', p_staff, '{}'::jsonb);

  -- When the window opens again, for the screen's words if the send then
  -- fails: this request has used it either way.
  return jsonb_build_object(
    'staffId', s.id::text,
    'email', lower(v_email),
    'retryAfter', to_char((now() + interval '10 minutes') at time zone 'Europe/London', 'HH24:MI'));
end $$;

comment on function public.onboarding_password_reset_request(uuid) is
  'ADR-0207: the Back Office asks for a password-reset email for a worker or candidate who has already activated their account (set a password). Office logins that may write; refuses unknown_staff, not_accepted, not_resendable, not_activated (use Resend activation link) and reset_too_soon (once per 10 minutes per person). Audited as onboarding_password_reset; returns the login address the server action sends the recovery email to, and retryAfter (UK HH:MI) for when the next request is allowed.';

revoke all on function public.onboarding_password_reset_request(uuid) from public, anon;
grant execute on function public.onboarding_password_reset_request(uuid) to authenticated;
