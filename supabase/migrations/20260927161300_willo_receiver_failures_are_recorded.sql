-- =====================================================================
-- Migration 20260927161300 · the Willo receiver's failures leave a trace
--                            (security brief Invariant 7; ADR-0021)
--
-- Every §7 job runs inside runJob(), which opens a job_runs row and
-- records the error when the work throws. The inbound Willo webhook
-- cannot use that wrapper (ADR-0021: Willo sends its own signature, not
-- a Supabase JWT) and wrote nothing when a delivery failed with a 500 —
-- a receiver that failed every delivery (STAFF_APP_URL unset, a GoTrue
-- outage, a lock timeout) showed nowhere in the database and the card
-- simply never moved. Only permanent refusals reached audit_log
-- (willo_record_refusal). This is the retryable-failure twin: one
-- admin-readable audit row per failed delivery, written by the Edge
-- Function on each of its 500 paths. Service role only, like its twin.
-- =====================================================================

create or replace function public.willo_record_failure(
  p_willo_candidate_id text,
  p_event              text,
  p_code               text
) returns void
language sql
security definer
set search_path = public, extensions
as $$
  insert into audit_log (actor, action, entity, entity_id, data)
  values (null, 'willo_event_failed', 'staff',
          (select id from staff where willo_candidate_id = p_willo_candidate_id limit 1),
          jsonb_build_object('willoCandidateId', p_willo_candidate_id,
                             'event', p_event,
                             'code', left(coalesce(p_code, ''), 200)));
$$;

comment on function public.willo_record_failure(text, text, text) is
  '§2.4: audits a Willo delivery the receiver could not apply and answered 500 to (Willo retries). The retryable twin of willo_record_refusal(). Service role only.';

revoke execute on function public.willo_record_failure(text, text, text) from public, anon, authenticated;
grant  execute on function public.willo_record_failure(text, text, text) to service_role;
