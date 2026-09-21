/**
 * booking-tick — the per-booking timers (§7 BG-01/02/02b/03/09/10).
 *
 * Every minute, per docs/01-architecture.md §4. All six rules live in
 * `booking_tick()` (20260921155908_booking_tick.sql) and are covered by
 * supabase/tests/170_booking_tick.sql, so there is deliberately nothing
 * to decide here: this reads one row of counts and hands them back.
 *
 * The SQL function is idempotent — outbox keys for the notifications,
 * not-exists guards for the violations — which is what makes a job that
 * runs sixty times an hour safe to re-run after a failure.
 */

import { runJob } from '../_shared/job.ts';

Deno.serve((request) =>
  runJob('booking-tick', request, async (db) => {
    const { data, error } = await db.rpc('booking_tick');
    if (error) throw new Error(`booking_tick: ${error.message}`);
    return (data ?? {}) as Record<string, unknown>;
  }),
);
