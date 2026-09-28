-- =====================================================================
-- Migration 20261001206000 · The `willo-invite` safety net is switched on
--                            (§2.4, §2.12; ADR-0021 §3, ADR-0066)
--
-- 20260924110000 registered the every-minute `willo-invite` sweep
-- DISABLED, "until the keys exist" (ADR-0021 §3). They now do: THC's
-- WILLO_API_KEY and WILLO_INTERVIEW_KEY are set as Edge Function secrets
-- (OWNER-TODO §4) and the function speaks Willo's real API (ADR-0066).
--
-- Why it matters. On submit, a trigger nudges /willo-webhook/invite once
-- through pg_net. A nudge that fails — as every one did on 28.09 while the
-- functions refused the Vault key (ADR-0067) — is never retried, so the
-- applicant waits for a Willo email that nothing will ever send. The
-- schedule is what picks them up: every minute, willo_invite_due() leases
-- whoever is `interview_requested` with no `willo_candidate_id`, with its
-- own backoff (5 min doubling, capped at 6 h) and ADR-0024's no-duplicate
-- rules. Without keys the route leases nothing and returns, so enabling it
-- is safe in any environment.
--
-- Not done here: `install_job_schedules()` reads this table and writes
-- pg_cron, and it needs the Vault secret, so it stays a one-off in the SQL
-- editor after this migration is applied (docs/16 §4.7).
-- pgTAP 190's enabled list and 482's registration check change with it.
-- =====================================================================

update job_schedules
   set enabled = true
 where job = 'willo-invite';
