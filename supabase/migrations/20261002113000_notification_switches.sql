-- =====================================================================
-- Notification switches — turn any outgoing notification off (ADR-0083)
--
-- The owner asked (02.10.2026), after the first live BG-08 payroll email
-- reached the external payroll provider, to pause it and to have a place
-- in /settings to switch each notification on and off. This is that
-- switch, in the database, so it holds on every send path without an
-- Edge Function deploy:
--
--   1. `settings.notification_switches` — a JSON object of register codes
--      that are OFF: {"BG08": false}. A code that is absent is on. Written
--      by /settings → Notifications (owners only, the existing restrictive
--      settings policies, ADR-0056).
--
--   2. claim_outbox_batch() — every send in the product goes through it.
--      A due row whose code is off is settled there and then: failed_at
--      now, with the reason, and never sent — not held until the switch
--      comes back on. Held rows would all go at once on the day it is
--      switched on again: last week's "Confirm tomorrow's shift", a
--      cancelled invitation, a stale document reminder. A row queued for
--      later (send_after in the future) is judged when it falls due, so
--      switching back on before then lets it go.
--
--   3. finance_reports_due() — BG-08 is different: the job STAMPS the week
--      into payroll_export_lines and events.payroll_exported_at before it
--      queues the email (20260923130000). Off at the outbox only, it would
--      mark shifts "already included in a payroll export" (§3.3 warnings)
--      that finance never received. So BG08 off stops the job before it
--      stamps anything; switched back on, it catches up last week as it
--      already does for a missed Monday. The weeks in between are not sent
--      by the job — /reports exports them.
--
-- BG08 is seeded OFF: that is the pause the owner asked for. Every other
-- code stays on.
--
-- Forward-only; nothing here edits an earlier migration.
-- =====================================================================

insert into settings (key, value) values ('notification_switches', '{"BG08": false}'::jsonb)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------
-- 1 · Is this code switched on?
-- ---------------------------------------------------------------------
-- Only a JSON false switches a code off; anything else, or no row at all,
-- leaves it on — a malformed value must not silence the activation email.
-- Definer, because `settings` is admin-read and the jobs' callers are not
-- always the owner of the table.
create or replace function public.notification_switched_on(p_template text)
returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select not exists (
    select 1 from settings s
     where s.key = 'notification_switches'
       and jsonb_typeof(s.value) = 'object'
       and s.value -> p_template = 'false'::jsonb)
$$;

comment on function public.notification_switched_on(text) is
  'ADR-0083: false when /settings → Notifications has switched this register code off (settings.notification_switches holds {"<code>": false}). Read by claim_outbox_batch() and finance_reports_due().';

revoke execute on function public.notification_switched_on(text) from public, anon, authenticated;
grant execute on function public.notification_switched_on(text) to service_role;

-- ---------------------------------------------------------------------
-- 2 · The outbox claim settles a switched-off row instead of sending it
-- ---------------------------------------------------------------------
-- Same signature, same claim as 20260921130927; only the first statement
-- is new. The settle and the claim take disjoint rows (the claim's
-- `failed_at is null` no longer matches a settled one), and a row another
-- drain has leased is not due (`send_after` is in the future), so neither
-- step touches a row in flight.
create or replace function public.claim_outbox_batch(
  p_limit integer default 50, p_lease interval default interval '5 minutes'
) returns setof notification_outbox
language plpgsql security definer set search_path = public, extensions as $$
begin
  update notification_outbox o
     set failed_at = now(),
         error = 'Not sent: switched off in Settings'
   where o.sent_at is null and o.failed_at is null and o.send_after <= now()
     and not notification_switched_on(o.template);

  return query
  with due as (
    select o.id from notification_outbox o
     where o.sent_at is null and o.failed_at is null and o.send_after <= now()
     order by o.send_after
     limit greatest(p_limit, 0)
     for update skip locked
  )
  update notification_outbox o
     set attempts = o.attempts + 1,
         last_attempt_at = now(),
         send_after = now() + p_lease      -- the lease: hides it from other runners
    from due
   where o.id = due.id
  returning o.*;
end;
$$;

-- ---------------------------------------------------------------------
-- 3 · BG-08 does not run while BG08 is off
-- ---------------------------------------------------------------------
create or replace function public.finance_reports_due(p_now timestamptz default now())
returns boolean language sql stable set search_path = public, extensions as $$
  select notification_switched_on('BG08')
     and uk_local(p_now) >= date_trunc('week', uk_local(p_now)) + interval '9 hours'
     and not exists (
           select 1 from report_sends r
            where r.kind = 'payroll'
              and r.period_start = report_week_start(p_now) - 7
              and r.outbox_key is not null)
$$;

comment on function public.finance_reports_due(timestamptz) is
  'BG-08 gate: from Monday 09:00 Europe/London until last week''s payroll email has been queued, and only while BG08 is switched on in /settings → Notifications (ADR-0083). DST-proof because pg_cron is UTC and this reads the London clock.';
