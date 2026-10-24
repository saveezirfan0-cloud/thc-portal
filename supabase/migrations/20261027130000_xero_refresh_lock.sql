-- =====================================================================
-- 20261027130000 · Xero refresh-token lock — ADR-0211 (builds on ADR-0210)
--
-- Xero's refresh tokens ROTATE: each refresh spends the old token and issues
-- a new one. The 15-minute job and the office's "Sync now" can run at the
-- same moment, and two refreshes with the same token would burn the
-- connection (the office would have to reconnect). The client takes this
-- lock for the length of one refresh. Service role only; the lease expires
-- by itself so a crashed refresh never wedges the connection.
-- =====================================================================
alter table public.xero_connection
  add column if not exists refresh_lock_until timestamptz;

create or replace function public.xero_refresh_lock(p_seconds int default 30)
returns boolean
language plpgsql security definer set search_path = public, extensions as $$
begin
  update xero_connection
     set refresh_lock_until = now() + make_interval(secs => greatest(least(p_seconds, 120), 1))
   where refresh_lock_until is null or refresh_lock_until < now();
  return found;
end $$;
revoke execute on function public.xero_refresh_lock(int) from public, anon, authenticated;
grant execute on function public.xero_refresh_lock(int) to service_role;

create or replace function public.xero_refresh_unlock()
returns void
language sql security definer set search_path = public, extensions as $$
  update xero_connection set refresh_lock_until = null;
$$;
revoke execute on function public.xero_refresh_unlock() from public, anon, authenticated;
grant execute on function public.xero_refresh_unlock() to service_role;

comment on function public.xero_refresh_lock(int) is
  'ADR-0211: true for the one caller that may refresh the Xero token now (lease, seconds). Service role only.';
