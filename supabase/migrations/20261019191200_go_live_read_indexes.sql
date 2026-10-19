-- =====================================================================
-- Indexes for four hot reads that had none that fit (ADR-0154)
--
-- From the go-live database audit (17.10.2026, live plans):
--
--   audit_log (at desc) where action = 'rota_guard.warned'
--     rota_guard_warnings_v (/compliance, 20260923100200) filters audit_log
--     on action alone. The only index naming action is
--     audit_log_entity_action_idx (entity_id, action, at desc), where it is
--     the second key, so the plan read the whole index: 84 ms with 0 rows
--     today, and audit_log grows 2–5k rows a day in production.
--
--   shift_requirements (ends_at)
--     "not over yet" — staff_open_shifts (sr.ends_at > now()),
--     series_siblings (sr2.ends_at > now()), staff_shift_requirements —
--     had only starts_at, event_id and role_id indexes, so each read every
--     section ever built (about 16k a year) instead of the open ones.
--
--   shift_requirements (event_id, role_id)
--     series_siblings and the per-event, per-role lookups. Not covered:
--     event_id and role_id are indexed separately. The single-column
--     shift_requirements_event_id_idx stays (the composite would serve it,
--     but dropping an index is not this migration's business).
--
--   quiz_attempts (staff_id, taken_at)
--     staff_directory_v's per-worker quiz subqueries. The only index,
--     quiz_attempts_current_attempt, is partial on NOT superseded, which
--     those subqueries do not filter on, so each was a sequential scan.
--
-- Plain CREATE INDEX: a migration runs in one transaction, which
-- CONCURRENTLY cannot. Every table here is small today (sections in the
-- hundreds, audit_log ~6k rows, quiz_attempts in the low thousands), so
-- the write lock lasts milliseconds. IF NOT EXISTS so a hand-made index
-- of the same name on any environment is left as it is.
-- =====================================================================

create index if not exists audit_log_rota_guard_warned_idx
  on public.audit_log (at desc)
  where action = 'rota_guard.warned';

create index if not exists shift_requirements_ends_at_idx
  on public.shift_requirements (ends_at);

create index if not exists shift_requirements_event_role_idx
  on public.shift_requirements (event_id, role_id);

create index if not exists quiz_attempts_staff_taken_idx
  on public.quiz_attempts (staff_id, taken_at);
