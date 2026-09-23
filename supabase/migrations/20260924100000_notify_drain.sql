-- =====================================================================
-- P2 · The outbox drain ships (§8, §9.12, §10.5)
--
-- `supabase/functions/notify-drain` now exists. It claims rows with
-- claim_outbox_batch() and settles them with complete_outbox_send(), both
-- from 20260921130927. Two more ways of settling a claim are needed, and
-- both are about NOT spending the six attempts on the wrong thing:
--
--   1. fail_outbox_send — the row is wrong, not the network. messageFor()
--      throws UnsendableRow for E1 (Willo's), an unknown code, a push with
--      no recipient, N9 with no half; Resend answers 422 for a malformed
--      recipient; a BG08/D1/D2 whose file is gone from Storage. Each of
--      those fails identically six times over half an hour, and meanwhile
--      the office's queue says "retrying". Fail it now, with the reason.
--
--   2. release_outbox_claim — the drain has no keys for the channel
--      (RESEND_API_KEY, or the VAPID trio). That is the owner's to fix, and
--      it will be fixed on some day nobody can predict; counting it as an
--      attempt would have every queued row exhausted and failed within
--      half an hour of the first deploy, and the E3 activation emails with
--      them. So the claim is handed back: the attempt is un-counted, the
--      reason is written to `error` so the office can see why nothing is
--      going out, and the row is looked at again in five minutes.
--
-- Both only touch a row that is still unsettled, like complete_outbox_send,
-- so a late call cannot resurrect a sent row or un-fail a failed one.
--
-- And the schedules: notify-drain is enabled, and finance-reports is
-- re-enabled — 20260923193100 paused it precisely until this commit, so
-- that the first Monday after deploy did not stamp a week into
-- payroll_export_lines for an email that could not go out. 190 asserts the
-- enabled list and is updated alongside.
--
-- Deploy order, as for every job: `supabase functions deploy notify-drain`
-- (and finance-reports) BEFORE `select install_job_schedules()`.
-- =====================================================================

create or replace function public.fail_outbox_send(p_id bigint, p_error text)
returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if coalesce(trim(p_error), '') = '' then
    -- A permanent failure with no reason is one nobody can act on.
    raise exception 'a permanent failure needs a reason' using errcode = '22023';
  end if;
  update notification_outbox
     set failed_at = now(), error = p_error
   where id = p_id and sent_at is null and failed_at is null;
end;
$$;

comment on function public.fail_outbox_send(bigint, text) is
  'notify-drain (P2): fail a claimed outbox row at once — the row itself can never be sent (UnsendableRow, a 4xx the same bytes will get again, a missing attachment). No retries. Service role only.';

create or replace function public.release_outbox_claim(
  p_id bigint, p_error text, p_retry_in interval default interval '5 minutes'
) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  update notification_outbox
     set attempts   = greatest(attempts - 1, 0),
         error      = p_error,
         send_after = now() + greatest(coalesce(p_retry_in, interval '5 minutes'), interval '0')
   where id = p_id and sent_at is null and failed_at is null;
end;
$$;

comment on function public.release_outbox_claim(bigint, text, interval) is
  'notify-drain (P2): hand a claim back without counting it as an attempt — the channel is not configured (no RESEND_API_KEY / VAPID keys). Records why in error. Service role only.';

-- ---------------------------------------------------------------------
-- The registry
-- ---------------------------------------------------------------------
update job_schedules
   set enabled = true,
       note = 'Outbox drain (§8): Web Push over VAPID + email through Resend, every minute; retries with outbox_backoff(), fails an unsendable row at once, holds a channel with no keys without spending attempts. supabase/functions/notify-drain (20260924100000). Deploy functions before running install_job_schedules().'
 where job = 'notify-drain';

update job_schedules
   set enabled = true,
       note = 'BG-08 Monday 09:00 UK finance send (§9.9). Every 5 min; finance_reports_due() picks the UK minute and catches up a missed Monday. Re-enabled with the outbox drain (20260924100000), which sends the BG08 email it queues. Deploy functions before running install_job_schedules().'
 where job = 'finance-reports';

-- ---------------------------------------------------------------------
-- Grants: the service role, and nobody else — as 20260921130927 does for
-- claim/complete. Either function lets its caller silence a notification
-- (fail it) or defer it indefinitely (release it every five minutes).
-- Supabase's default privileges grant anon/authenticated BY NAME, so they
-- are revoked by name (docs/14 O7).
-- ---------------------------------------------------------------------
revoke execute on function
  public.fail_outbox_send(bigint, text),
  public.release_outbox_claim(bigint, text, interval)
from public, anon, authenticated;

grant execute on function
  public.fail_outbox_send(bigint, text),
  public.release_outbox_claim(bigint, text, interval)
to service_role;
