-- =====================================================================
-- The device's own door into push_subscriptions (§10.5, §8)
--
-- The table, its RLS and its pgTAP coverage already exist (0001, 0004,
-- 20260921123503, tests 010/030/040): a worker holds a full self policy on
-- their own rows and nobody else's, which is exactly right for a value the
-- browser mints and the browser retires.
--
-- What was missing is the write the Staff App actually needs to perform, and
-- it is not a plain insert:
--
--   1. `endpoint` is UNIQUE. A worker who re-opens the app, re-grants the
--      permission, or simply gets the same endpoint back from the browser
--      (which is what happens — the endpoint is stable per browser per VAPID
--      key) would collide with their own previous row. An `insert` would
--      raise 23505 and the app would treat a working subscription as a
--      failure.
--   2. A device is shared. Two workers signing into the same phone produce
--      the SAME endpoint, because the endpoint belongs to the browser, not
--      to the account. The row must follow whoever is signed in now, or the
--      second worker gets no pushes and the first gets someone else's.
--      `on conflict (endpoint) do update` is therefore the CORRECT
--      behaviour, not a convenience — and it is safe, because the endpoint
--      is a handle the sending service resolves to that device: re-pointing
--      it moves whose messages arrive there, it does not read anything.
--   3. `pushsubscriptionchange` rotation (§10.5) replaces one endpoint with
--      another. The old row must go, or the drain keeps posting to a
--      retired endpoint until the push service 410s it.
--
-- RLS alone cannot express 1–3 as one statement from PostgREST, so this is
-- the one write path and the app never touches the table directly. It is
-- `security definer` for the upsert-across-a-unique-constraint only: the
-- staff row is always resolved from `auth.uid()` — a caller cannot name a
-- worker, so there is no id here to forge.
--
-- What this deliberately does NOT do: return, log or accept anybody else's
-- endpoint. An endpoint is a bearer capability to send that device a
-- notification; it is treated like a credential (never raised in an error
-- message, never echoed back beyond a boolean).
-- =====================================================================

-- Staleness, so the office's "is this worker reachable?" line and any future
-- prune job can tell a live device from one that was replaced two phones
-- ago. Defaulted, so nothing existing has to change.
alter table push_subscriptions
  add column if not exists last_seen_at timestamptz not null default now();

comment on column push_subscriptions.last_seen_at is
  'Last time the device re-registered this endpoint (§10.5). The app reconciles on every launch, so a row that stops moving is a device that stopped opening the app.';

-- ---------------------------------------------------------------------
-- Register (or refresh) this device for the signed-in worker.
--
-- `p_replaces` carries the endpoint a `pushsubscriptionchange` retired, so
-- the rotation is one round trip and cannot leave an orphan behind. It is
-- only ever honoured for a row this worker owns.
-- ---------------------------------------------------------------------
create or replace function save_push_subscription(
  p_endpoint   text,
  p_p256dh     text,
  p_auth       text,
  p_user_agent text default null,
  p_replaces   text default null
) returns void language plpgsql security definer
set search_path = public, extensions as $$
declare v_staff uuid;
begin
  select id into v_staff from staff where user_id = auth.uid();
  if v_staff is null then
    raise exception 'not_a_worker' using errcode = '42501';
  end if;

  if coalesce(p_endpoint, '') = '' or coalesce(p_p256dh, '') = '' or coalesce(p_auth, '') = '' then
    -- No echo of the value: the message a client sees says which field, not
    -- what was in it.
    raise exception 'endpoint, p256dh and auth are all required' using errcode = '22023';
  end if;

  -- A removed worker (§1.7) or a leaver (§10.6) keeps no device registered:
  -- 20260922081512 deletes their rows on removal, and §2.12 takes them out
  -- of every send. Re-registering here would put them back.
  if exists (select 1 from staff where id = v_staff and status in ('removed', 'inactive')) then
    raise exception 'account_closed' using errcode = '42501';
  end if;

  if p_replaces is not null and p_replaces <> p_endpoint then
    delete from push_subscriptions where endpoint = p_replaces and staff_id = v_staff;
  end if;

  insert into push_subscriptions (staff_id, endpoint, p256dh, auth, user_agent)
  values (v_staff, p_endpoint, p_p256dh, p_auth, p_user_agent)
  on conflict (endpoint) do update
    set staff_id     = excluded.staff_id,
        p256dh       = excluded.p256dh,
        auth         = excluded.auth,
        user_agent   = excluded.user_agent,
        last_seen_at = now();
end $$;

comment on function save_push_subscription(text, text, text, text, text) is
  'Registers the calling worker''s Web Push endpoint (§10.5). Definer only so the upsert can cross the unique endpoint constraint; the worker is always auth.uid(), never an argument. A shared device legitimately re-points its endpoint to whoever is signed in.';

-- ---------------------------------------------------------------------
-- Unregister: sign-out, a revoked permission, or a worker turning
-- notifications off. Silent when the row is not theirs — there is nothing
-- to tell a caller that would not also confirm another worker's endpoint.
-- ---------------------------------------------------------------------
create or replace function forget_push_subscription(p_endpoint text)
returns void language plpgsql security definer
set search_path = public, extensions as $$
declare v_staff uuid;
begin
  select id into v_staff from staff where user_id = auth.uid();
  if v_staff is null then
    raise exception 'not_a_worker' using errcode = '42501';
  end if;
  delete from push_subscriptions where endpoint = p_endpoint and staff_id = v_staff;
end $$;

comment on function forget_push_subscription(text) is
  'Removes the calling worker''s own Web Push endpoint (§10.5). Never touches another worker''s row and never says whether one existed.';

-- Postgres grants EXECUTE to PUBLIC and Supabase's default privileges grant
-- it to anon, authenticated and service_role BY NAME, so a revoke from
-- PUBLIC alone leaves both open (docs/14 O7). anon is closed outright: there
-- is no worker behind an anonymous call and the function would raise anyway,
-- but the grant is the thing an auditor reads. service_role is closed too —
-- auth.uid() is null under the service key, so it could only ever raise.
revoke execute on function save_push_subscription(text, text, text, text, text)
  from public, anon, service_role;
revoke execute on function forget_push_subscription(text) from public, anon, service_role;
grant execute on function save_push_subscription(text, text, text, text, text) to authenticated;
grant execute on function forget_push_subscription(text) to authenticated;
