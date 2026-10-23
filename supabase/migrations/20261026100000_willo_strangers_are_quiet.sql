-- =====================================================================
-- Migration 20261026100000 · A Willo delivery for somebody we have never
--                            heard of is answered, not audited (ADR-0203,
--                            §2.4)
--
-- 23.10.2026: 18 candidates were moved to Documents by hand with "Mark
-- interview complete — accepted via an old interview link". None of them
-- has a delivery of ANY kind: no Received, no New Response, no Accepted,
-- no refusal. Our webhooks follow one interview (ADR-0066 §5), so a
-- candidate who records on another one (the invitation from the previous
-- system still sitting in their inbox, an old job advert) is accepted by
-- the office in Willo and nothing ever reaches us.
--
-- The fix on Willo's side is to follow every interview. The reason it was
-- not done on 28.09 was that THC has thousands of Willo assessments, and a
-- `willo_event_refused` audit row for every stranger would bury the real
-- refusals. This function is what makes following everything safe: the
-- receiver asks it, and a delivery whose participant's email matches no
-- person we hold is answered 200 and written nowhere in audit_log. A
-- delivery whose email DOES match somebody (a worker, a rejected
-- candidate, one past the interview) and cannot be applied is still
-- audited as a refusal, exactly as before.
--
-- Service role only (the willo-webhook Edge Function).
-- pgTAP: supabase/tests/933_willo_stranger.sql.
-- =====================================================================

create or replace function public.willo_stranger(p_email text)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select case
           when lower(btrim(coalesce(p_email, ''))) !~ '^[^\s@]+@[^\s@]+$' then false
           else not exists (
             select 1 from staff
              where lower(btrim(email)) = lower(btrim(p_email))
           )
         end
$$;

comment on function public.willo_stranger(text) is
  'ADR-0203, §2.4: true when a well-formed email belongs to no staff row at all (any status, removed ones included). False for a malformed or missing email, so a delivery we cannot place is still audited. The willo-webhook Edge Function answers a stranger 200 and writes no audit row, which is what lets the webhook follow every Willo interview. Service role only.';

revoke execute on function public.willo_stranger(text) from public, anon, authenticated;
grant  execute on function public.willo_stranger(text) to service_role;
