-- =====================================================================
-- Migration 20261020130100 · "Sign out other devices" also stops their
--                            push notifications (ADR-0164; security
--                            audit M4; §10.1, §10.5)
--
-- The Staff App's Profile → Security → "Sign out others" ended the other
-- sessions (GoTrue signOut scope 'others') and nothing else. Each of those
-- devices still held a row in push_subscriptions, so a stolen phone that
-- had been signed out remotely went on receiving every shift push (event,
-- venue, times) the worker was sent.
--
-- forget_other_push_subscriptions(p_keep_endpoint): deletes every one of
-- the CALLER's subscriptions except the endpoint this device holds (null
-- when it holds none: then all of them go). The caller is staff_caller()
-- — a live, not switched-off session of a worker — so nobody reaches
-- another worker's rows, and a session already signed out reaches nothing.
-- The endpoint is a bearer capability and is never logged or audited;
-- the count is returned.
--
-- Authenticated only (20261012121500's convention: never anon). pgTAP 896.
-- =====================================================================

create or replace function public.forget_other_push_subscriptions(p_keep_endpoint text default null)
returns integer
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_staff uuid := staff_caller();
  v_n     integer;
begin
  if v_staff is null then
    raise exception 'not_a_worker' using errcode = '42501';
  end if;
  delete from push_subscriptions
   where staff_id = v_staff
     and (nullif(btrim(coalesce(p_keep_endpoint, '')), '') is null
          or endpoint <> p_keep_endpoint);
  get diagnostics v_n = row_count;
  return v_n;
end $$;

comment on function public.forget_other_push_subscriptions(text) is
  'ADR-0164: the Staff App''s "Sign out others" — deletes every push subscription of the calling worker (staff_caller(): a live session) except p_keep_endpoint, this device''s own (null → all of them). Returns the number removed.';

revoke execute on function public.forget_other_push_subscriptions(text) from public, anon;
grant  execute on function public.forget_other_push_subscriptions(text) to authenticated, service_role;
