-- =====================================================================
-- The office can queue a notification again (§8, §3.3, §3.5)
--
-- Three office sends have been silently going nowhere since the Shift
-- Builder and the event board merged:
--
--   N11  the office moves a shift's time, venue or dress code (§3.5)
--   N10b the office withdraws a booking (§3.3) — MANDATORY
--   N12  the office cancels an event (§3.3)     — MANDATORY
--
-- N11 is not marked mandatory in the register (packages/notifications), and
-- that is right: §3.5 requires the push, §8 does not make it unmutable. The
-- defect is the same for all three.
--
-- All three are queued by a server action running as the signed-in manager,
-- with `supabase.from('notification_outbox').insert(...)`. That cannot work
-- and never could. `notification_outbox` carries exactly one policy —
-- `admin_read`, SELECT only (20260921123503, asserted by 001_rls_guard
-- assertion 8). The Data API roles DO hold table privileges on it, because
-- Supabase grants those on everything in `public` by default, so the insert
-- is not refused for want of a GRANT: it reaches RLS, finds no INSERT
-- policy, and is rejected with
--
--   new row violates row-level security policy for table "notification_outbox"
--
-- The server action does not read the error, so the manager sees the
-- cancellation succeed while nobody is told. The read still works — an
-- admin can open their own send queue — which is why nothing looked wrong.
--
-- Why not simply give admin an insert policy: 001_rls_guard asserts the
-- exact policy set on this table on purpose, and its comment says why — "a
-- row anybody can insert is a notification anybody can send, and an
-- updatable sent_at is a send anybody can suppress". That assertion is
-- right and stays untouched.
--
-- So the write goes through a definer function that checks the caller, the
-- same shape as `queue_booking_push` (20260921141500) — which is NOT reused
-- here because it is service-role-only by design and `190` asserts that a
-- signed-in account cannot execute it. That assertion is also right: it
-- stops a WORKER sending pushes. This is the office's door, and it is
-- guarded by `current_app_role() = 'admin'` rather than by the grant alone.
--
-- The copy stays where §8 keeps it. The DRAIN renders it — `messageFor()` in
-- packages/notifications/src/outbox.ts does `render(entry.title, values)`
-- against the register and ignores any text a row carries — so `payload` is
-- the VALUES map, not rendered copy. `queue_booking_push` (20260921141500)
-- has always written values for the same reason. This function composes no
-- text and stores none; it is a write path.
--
-- Takes an array because N11 sends one row per confirmed worker on a
-- changed section, and a sixty-person event should be one round trip.
-- `on conflict (key) do nothing` is what makes a re-save of the same times,
-- or a double-pressed Cancel, queue one push and not two.
--
-- Narrow on purpose: push only, and a recipient is required. All three sends
-- this exists for are a push to one worker. Accepting a channel and a
-- recipient_emails list would have let any office account queue THC-branded
-- mail to an arbitrary address for any register code that does not pin its
-- own recipients (`entry.recipients ?? row.recipient_emails`, outbox.ts) —
-- a capability nothing here needs. A row without a recipient is also one
-- `messageFor` can only throw `UnsendableRow` on, so it is refused at the
-- door rather than left to fail in the drain at 03:00.
--
-- Every refusal RAISES. An earlier draft skipped malformed rows quietly,
-- which is the same silence this migration exists to end.
-- =====================================================================
create or replace function queue_office_notifications(p_rows jsonb)
returns int language plpgsql security definer
set search_path = public, extensions as $$
declare n int;
begin
  if current_app_role() is distinct from 'admin' then
    raise exception 'not_authorised' using errcode = '42501';
  end if;

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'rows_must_be_an_array' using errcode = '22023';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_rows) r
     where jsonb_typeof(r) <> 'object'
        or coalesce(r ->> 'key', '') = ''
        or coalesce(r ->> 'template', '') = ''
        or coalesce(r ->> 'channel', 'push') <> 'push'
        or nullif(r ->> 'recipient_staff_id', '') is null
  ) then
    raise exception 'every row needs key, template, channel push and recipient_staff_id'
      using errcode = '22023';
  end if;

  with inserted as (
    insert into notification_outbox
      (key, channel, template, recipient_staff_id, payload)
    select
      r ->> 'key',
      'push'::notification_channel,
      r ->> 'template',
      (r ->> 'recipient_staff_id')::uuid,
      coalesce(r -> 'payload', '{}'::jsonb)
    from jsonb_array_elements(p_rows) r
    on conflict (key) do nothing
    returning 1
  )
  select count(*)::int into n from inserted;

  return n;
end $$;

comment on function queue_office_notifications(jsonb) is
  'The office''s write path into notification_outbox (§8). Admin-only and definer, because the table is admin_read and must stay that way (001_rls_guard assertion 8). Push to one worker only. `payload` is the VALUES map the drain renders the register''s copy with, never rendered text. Returns how many were queued, so a caller can tell a duplicate key from a send; malformed rows raise rather than being skipped.';

-- Postgres grants EXECUTE to PUBLIC, and Supabase's default privileges grant
-- it to anon, authenticated and service_role BY NAME — a revoke from PUBLIC
-- alone leaves both open (docs/14 O7). anon is closed here outright; the
-- signed-in grant is what the office needs and the admin check inside is
-- what makes it safe.
-- No service_role grant. It would be dead: `current_app_role()` reads
-- `profiles` by `auth.uid()`, which is null under the service key, so the
-- admin check refuses it. `invite_worker` lets a job through by adding
-- `and auth.uid() is not null` — deliberately NOT copied here, because that
-- same predicate is what let anon past invite_worker's guard
-- (20260921162758). Nothing server-side queues these three sends today; a
-- job that needs to should get its own door and its own test.
revoke execute on function queue_office_notifications(jsonb) from public, anon;
grant execute on function queue_office_notifications(jsonb) to authenticated;
