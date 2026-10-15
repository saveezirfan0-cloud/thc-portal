-- =====================================================================
-- Migration 20261015140000 · setting a password through an emailed link
--                            clears that account's sign-in lockout
--                            (ADR-0051 §25, 20261012121000)
--
-- The per-account sign-in throttle refuses the sixth try after five wrong
-- passwords in 15 minutes, with the SAME words as a wrong password ("Email
-- or password is incorrect") so the limit says nothing about whether the
-- account exists. A success records nothing — and clears nothing.
--
-- Reported 15.10.2026 by a candidate: the activation link did not get her
-- to a password, so she tried to sign in (an account with no password
-- refuses every try: each one counted), then used Forgot password, set a
-- new password successfully, and signing in with it said the password was
-- incorrect. It was not: the five failures from before the reset were
-- still inside the window, and the correct password was refused unasked.
--
-- Whoever has just set a password from an emailed one-time link (reset,
-- activation, invitation) has proved they hold the mailbox; the guesses
-- the throttle was holding back are moot. So those actions now clear the
-- account's `sign_in` failures. Only that kind: the per-address count
-- (`sign_in_ip`), the two-step code count (`verify`) and the reset-request
-- count (`recover`) are left exactly as they were.
--
-- 844_password_set_clears_sign_in_lockout pins it.
-- =====================================================================

create or replace function public.clear_sign_in_failures(p_key_hash text)
returns void
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
begin
  perform auth_attempt_key_ok(p_key_hash);
  delete from private.auth_attempts a
   where a.kind = 'sign_in'
     and a.key_hash = p_key_hash;
end $$;

comment on function public.clear_sign_in_failures(text) is
  '20261015140000: deletes the sign_in failures counted against one account key (sha256 of the normalised email), called after a password is set from an emailed reset, activation or invitation link so the guesses made before it cannot refuse the new password. Leaves sign_in_ip, verify and recover untouched. Service role only; 22023 for a malformed key.';

revoke execute on function public.clear_sign_in_failures(text) from public, anon, authenticated;
grant  execute on function public.clear_sign_in_failures(text) to service_role;
