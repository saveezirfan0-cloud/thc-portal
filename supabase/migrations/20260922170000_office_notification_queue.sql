-- =====================================================================
-- The office can queue a notification again (§8, §3.3, §3.5)
--
-- Three MANDATORY sends have been silently going nowhere since the Shift
-- Builder and the event board merged:
--
--   N11  the office moves a shift's time, venue or dress code (§3.5)
--   N10b the office withdraws a booking (§3.3)
--   N12  the office cancels an event (§3.3)
--
-- All three are queued by a server action running as the signed-in manager,
-- with `supabase.from('notification_outbox').insert(...)`. That cannot work
-- and never could: `notification_outbox` carries exactly one policy,
-- `admin_read`, SELECT only (20260921123503, asserted by 001_rls_guard
-- assertion 8), and the `authenticated` role holds no table privilege on it
-- at all. The insert is refused with `permission denied for table
-- notification_outbox`, the server action does not check, and the manager
-- sees the cancellation succeed while nobody is told.
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
-- The copy stays in TypeScript. CLAUDE.md requires §8's wording to come from
-- the register in `packages/notifications`, so this takes rows that are
-- already rendered rather than composing any text itself. It is a write
-- path, not a template.
--
-- Takes an array because N11 sends one row per confirmed worker on a
-- changed section, and a sixty-person event should be one round trip.
-- `on conflict (key) do nothing` is what makes a re-save of the same times,
-- or a double-pressed Cancel, queue one push and not two.
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

  with inserted as (
    insert into notification_outbox
      (key, channel, template, recipient_staff_id, recipient_emails, payload)
    select
      r ->> 'key',
      (r ->> 'channel')::notification_channel,
      r ->> 'template',
      nullif(r ->> 'recipient_staff_id', '')::uuid,
      case when r ? 'recipient_emails'
           then (select array_agg(value::text) from jsonb_array_elements_text(r -> 'recipient_emails'))
      end,
      coalesce(r -> 'payload', '{}'::jsonb)
    from jsonb_array_elements(p_rows) r
    where coalesce(r ->> 'key', '') <> ''
    on conflict (key) do nothing
    returning 1
  )
  select count(*)::int into n from inserted;

  return n;
end $$;

comment on function queue_office_notifications(jsonb) is
  'The office''s write path into notification_outbox (§8). Admin-only and definer, because the table is admin_read and must stay that way (001_rls_guard assertion 8). Rows arrive already rendered from the §8 register in packages/notifications; this composes no copy. Returns how many were queued, so a caller can tell a duplicate key from a send.';

-- Postgres grants EXECUTE to PUBLIC, and Supabase's default privileges grant
-- it to anon, authenticated and service_role BY NAME — a revoke from PUBLIC
-- alone leaves both open (docs/14 O7). anon is closed here outright; the
-- signed-in grant is what the office needs and the admin check inside is
-- what makes it safe.
revoke execute on function queue_office_notifications(jsonb) from public, anon;
grant execute on function queue_office_notifications(jsonb) to authenticated, service_role;
