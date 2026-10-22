/**
 * booking-tick — the per-booking timers (§7 BG-01/02/02b/03/09/10).
 *
 * Every minute, per docs/01-architecture.md §4. All six rules live in
 * `booking_tick()` (20260921155908_booking_tick.sql) and are covered by
 * supabase/tests/170_booking_tick.sql, so there is deliberately nothing
 * to decide here: this reads one row of counts and hands them back.
 *
 * Beside it, `client_kit_reminder_tick()` (20261008180000, ADR-0110): the
 * morning-of "what to bring" push for a shift on a role the client has a
 * kit message for, until the worker confirms it. Its own function, so the
 * §7 timers are not restated to add it; its counts ride in the same row.
 *
 * And `late_ready_tick()` (20261024120000, ADR-0196): the "I'm ready" pushes
 * at 15, 30 and 45 minutes for a worker who accepted after the noon deadline.
 * Their release at the hour is `release_unready_bookings()`, run by the
 * auto-staffing cutoff mode, which re-fills the seat in the same run.
 *
 * All the SQL functions are idempotent — outbox keys for the notifications,
 * not-exists guards for the violations — which is what makes a job that
 * runs sixty times an hour safe to re-run after a failure.
 */

import { runJob } from '../_shared/job.ts';

Deno.serve((request) =>
  runJob('booking-tick', request, async (db) => {
    const { data, error } = await db.rpc('booking_tick');
    if (error) throw new Error(`booking_tick: ${error.message}`);
    const kit = await db.rpc('client_kit_reminder_tick');
    if (kit.error) throw new Error(`client_kit_reminder_tick: ${kit.error.message}`);
    const late = await db.rpc('late_ready_tick');
    if (late.error) throw new Error(`late_ready_tick: ${late.error.message}`);
    return {
      ...((data ?? {}) as Record<string, unknown>),
      ...((kit.data ?? {}) as Record<string, unknown>),
      ...((late.data ?? {}) as Record<string, unknown>),
    };
  }),
);
