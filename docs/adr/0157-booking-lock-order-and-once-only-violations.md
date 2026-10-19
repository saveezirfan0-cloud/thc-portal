# ADR-0157 · One lock order for bookings and check-ins; once-only violations; a bounded booking tick

**Status:** Accepted · **Refines:** RULE-20 (§4.4), §3.4 first-to-confirm, §5.1 / BG-03, RULE-02 / BG-09 · **Reported:** go-live audits, 17.10.2026 (concurrency H2, M1, M2, M5; database F6, F7)

## Context
Four findings shared one cause: two transactions each read committed state and each acted on what the other had not yet written.

- **H2.** `accept_invite`, `accept_application` and `take_offered_shift` locked only their own role section. Two confirmations for one worker on two sections, in the same second, each read the other as absent in the overlap check, `weekly_cap_would_breach()` and `bookings_rota_guard`. A 20 h student visa could end the week at 24 h.
- **M2.** `accept_invite` judged a double tap on a booking read before the lock. On the last slot that ran `confirmed → closed` (`illegal_booking_transition`). Elsewhere it re-ran the gates against the worker's own new confirmation.
- **M1.** No-show, No check-out, Late and Left-early were written behind `NOT EXISTS` and nothing else. Two overlapping ticks, or the tick and a press at start + 30, could each write one. A check-in committing during the tick was invisible to it, so the worker got a No-show beside a worked booking.
- **F6/F7.** `booking_tick()` rebuilt a temporary table of every booking ever, every minute. `attempt_check_in` held `FOR UPDATE` on the section, which also blocked the foreign-key share lock of every booking being added to it.

## Decision
1. **Lock order: worker, then section, then booking, then check-in row.** Every path that writes `confirmed` takes `lock_worker(staff_id)` first, before any row lock or write. That lock is a transaction-scoped advisory lock (`worker_lock_key()`), not the staff row, so profile edits, uploads and blocks do not queue behind an Accept. Nothing takes the worker lock after a section or booking lock. pgTAP 870 checks that the set of confirm writers equals the set of `lock_worker` callers, and that each caller takes it first. A new path to `confirmed` must take it too. `booking_tick` locks sections, then check-in rows, each in id order, and never a worker.
2. **A second Accept is the first one's answer.** Under the locks, `accept_invite` re-reads its booking `FOR UPDATE`. A booking that is already `confirmed` returns `{ok: true, already: true}`. `mark_ready` and `confirm_on_day` were already idempotent (they coalesce the stamp and change no status).
3. **Once-only violations.** A partial unique index allows one UNRESOLVED row per (booking, type) for `no_show`, `no_checkout`, `late` and `left_early`. It is unresolved-only because Get back turns a No-show into a resolved Late in place, and because the office may record a new No-show after resolving the first. `left_geofence` gets one row per exit. Every writer inserts `ON CONFLICT DO NOTHING`. Any existing duplicates are removed in the migration (the earliest is kept), and each removal is logged to `audit_log`.
4. **One outcome at a press.** Before it raises a No-show, `booking_tick` locks the candidates' sections, which is the lock `attempt_check_in` holds. Before it raises a No check-out, it locks their accepted check-in rows, which is the lock `check_out` holds. It then re-reads in a fresh snapshot. A press that waited behind the tick and finds a No-show or No check-out detected after the press began answers `locked`, the same answer it would get a moment later. A No-show the office recorded before the press still lets the worker in.
5. **`attempt_check_in`** locks the section `FOR NO KEY UPDATE`, which still serialises the RULE-15 slot count. It evaluates the D16 compliance reads before the lock and raises them where it always did.
6. **`booking_tick`** has no temporary table. Each rule reads a non-materialised CTE over the sections with `starts_at < p_now + 3 days and ends_at > p_now − 7 days`. Every rule fires between start − 30 min and end + 4 h, and N6 fires at most 41 h ahead. Bounding the end rather than the start keeps a section longer than a week in the set. A run that overlaps another returns `skipped: true`.

## Consequences
- RULE-20 and the §3.4 overlap net now hold under concurrent Accepts. A second Accept by the same worker waits for the first (milliseconds); Accepts by different workers do not wait for each other.
- A No-show or No check-out lost to a cron outage longer than 6 days 20 hours after the section's end is no longer raised. The office's manual No-show (`office_mark_no_show`) still covers that case.
- The tick's cost depends on the size of the window, not on history: locally, over 100,000 bookings, a run took 570–960 ms before this change and 60 ms after.
- The race itself cannot be run inside pgTAP, which has one session. The tests pin the index, the conflict clause, the lock order and the answers. A two-session run on a local cluster showed the second Accept waiting for the first.
- `packages/domain/state.ts` is unchanged: no transition was added or removed.
