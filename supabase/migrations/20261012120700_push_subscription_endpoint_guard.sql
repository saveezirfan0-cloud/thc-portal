-- =====================================================================
-- Migration 20261012120700 · a push endpoint is a real push service's,
--                            and stays with its device (§10.5, §8)
--
-- save_push_subscription() (20260922181000) took any non-empty endpoint
-- and, on a clash, moved the row to the caller:
--
--     on conflict (endpoint) do update set staff_id = excluded.staff_id, …
--
-- Staff App audit 12.10.2026, LOW:
--
--   1 · any endpoint at all. notify-drain POSTs a signed Web Push to the
--       endpoint — so a worker could register `https://anything/` and
--       have the platform make requests to a host of their choosing, on a
--       schedule they control (every shift reminder).
--   2 · endpoint stealing. A worker who learned another worker's endpoint
--       (a shared phone, a screenshot of devtools) could save it under
--       their own account with junk keys: the row moved, the victim's
--       phone stopped receiving N9/N10 reminders, and nobody was told.
--   3 · no cap. One account could register endpoints without limit, and
--       the drain sends to each.
--
-- Now:
--
--   1 · The endpoint must be https on a known Web Push service, at most
--       1024 characters: fcm.googleapis.com (Chrome, Edge on Android,
--       Samsung), *.push.services.mozilla.com (Firefox — updates.push…),
--       web.push.apple.com (Safari, iOS 16.4+ installed PWAs) and
--       *.notify.windows.com (Edge/WNS). Anything else is 22023
--       'endpoint_not_a_push_service'. p256dh and auth are capped at 200
--       characters each.
--   2 · A row belonging to ANOTHER worker moves only when the caller
--       presents the same p256dh and auth — which is exactly the shared
--       phone 20260922181000 exists for (the browser hands the second
--       worker the same subscription, keys and all). With different keys
--       nothing changes and nothing is said, the same silence
--       forget_push_subscription() keeps: an error would confirm someone
--       else's endpoint.
--   3 · At most 10 rows per worker: saving an eleventh drops the
--       least-recently-seen beyond ten.
--
-- The caller is resolved by staff_caller() now (20261012120400: a live
-- session, an unbanned login); 'not_a_worker' and 'account_closed' are
-- unchanged. 340 is updated to real push hosts; 793 pins the rest.
-- =====================================================================

create or replace function public.is_push_endpoint(p_endpoint text)
returns boolean
language sql
immutable
set search_path = public, extensions
as $$
  select coalesce(
    char_length(p_endpoint) <= 1024
    and p_endpoint ~ ('^https://('
        || 'fcm\.googleapis\.com'
        || '|([a-z0-9-]+\.)*push\.services\.mozilla\.com'
        || '|web\.push\.apple\.com'
        || '|[a-z0-9-]+(\.[a-z0-9-]+)*\.notify\.windows\.com'
        || ')/[^[:space:]]+$'),
    false)
$$;

comment on function public.is_push_endpoint(text) is
  '20261012120700 (§10.5): an https endpoint on a known Web Push service — fcm.googleapis.com, *.push.services.mozilla.com, web.push.apple.com, *.notify.windows.com — at most 1024 characters.';

revoke execute on function public.is_push_endpoint(text) from public, anon;
grant  execute on function public.is_push_endpoint(text) to authenticated, service_role;

create or replace function public.save_push_subscription(
  p_endpoint   text,
  p_p256dh     text,
  p_auth       text,
  p_user_agent text default null,
  p_replaces   text default null
) returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_staff uuid := staff_caller();
  v_owner push_subscriptions;
begin
  if v_staff is null then
    raise exception 'not_a_worker' using errcode = '42501';
  end if;

  if coalesce(p_endpoint, '') = '' or coalesce(p_p256dh, '') = '' or coalesce(p_auth, '') = '' then
    -- No echo of the value: the message a client sees says which field, not
    -- what was in it.
    raise exception 'endpoint, p256dh and auth are all required' using errcode = '22023';
  end if;
  if not is_push_endpoint(p_endpoint) then
    raise exception 'endpoint_not_a_push_service' using errcode = '22023';
  end if;
  if char_length(p_p256dh) > 200 or char_length(p_auth) > 200 then
    raise exception 'push_keys_too_long' using errcode = '22023';
  end if;

  -- A removed worker (§1.7) or a leaver (§10.6) keeps no device registered:
  -- 20260922081512 deletes their rows on removal, and §2.12 takes them out
  -- of every send. Re-registering here would put them back.
  if exists (select 1 from staff where id = v_staff and status in ('removed', 'inactive')) then
    raise exception 'account_closed' using errcode = '42501';
  end if;

  -- Another worker's device moves to this one only on the shared phone:
  -- the browser's own subscription, keys and all. Otherwise, silence.
  select * into v_owner from push_subscriptions where endpoint = p_endpoint for update;
  if v_owner.id is not null and v_owner.staff_id is distinct from v_staff
     and (v_owner.p256dh, v_owner.auth) is distinct from (p_p256dh, p_auth) then
    return;
  end if;

  if p_replaces is not null and p_replaces <> p_endpoint then
    delete from push_subscriptions where endpoint = p_replaces and staff_id = v_staff;
  end if;

  -- clock_timestamp(), not now(): several saves in one transaction must
  -- still order, or the cap below could drop the device just saved.
  insert into push_subscriptions (staff_id, endpoint, p256dh, auth, user_agent, last_seen_at)
  values (v_staff, p_endpoint, p_p256dh, p_auth, left(p_user_agent, 200), clock_timestamp())
  on conflict (endpoint) do update
    set staff_id     = excluded.staff_id,
        p256dh       = excluded.p256dh,
        auth         = excluded.auth,
        user_agent   = excluded.user_agent,
        last_seen_at = excluded.last_seen_at;

  -- Ten devices per worker: this one and the nine most recently seen.
  delete from push_subscriptions
   where id in (select id from push_subscriptions
                 where staff_id = v_staff and endpoint <> p_endpoint
                 order by last_seen_at desc, id desc
                 offset 9);
end $$;

revoke execute on function public.save_push_subscription(text, text, text, text, text) from public, anon;
grant  execute on function public.save_push_subscription(text, text, text, text, text) to authenticated;
