/**
 * compliance-daily — the document clock (§7 BG-04/05, §4.2, §4.3, §4.4).
 *
 * 05:00 UK, every day. Three rules, one sweep:
 *
 *   BG-04  the expiry ladder — 1 month / 2 weeks / 1 week
 *   BG-05  the block on the expiry day, with the §4.3 five-step cascade
 *   §4.4   N14 when a worker's calculated weekly cap changes band
 *
 * All of it lives in `compliance_daily()`
 * (20260921170411_compliance_daily.sql) and is covered by
 * supabase/tests/200_compliance_daily.sql, so there is deliberately
 * nothing to decide here.
 *
 * The 05:00 gate is the one thing this file would get wrong if it tried.
 * pg_cron runs on UTC and 05:00 UK is 04:00 UTC for half the year and
 * 05:00 UTC for the other half, so the schedule is registered as an
 * every-5-minute entry and `is_uk_time` decides. Without the gate this
 * would run 288 times a day; the SQL is idempotent, so the cost would be
 * 288 sweeps rather than 288 blocks — but a block is not something to
 * leave resting on an idempotency key alone.
 */

import { runJob } from '../_shared/job.ts';

Deno.serve((request) =>
  runJob('compliance-daily', request, async (db) => {
    const { data: open, error: gateError } = await db.rpc('is_uk_time', {
      p_now: new Date().toISOString(),
      p_hhmm: '05:00',
    });
    if (gateError) throw new Error(`is_uk_time: ${gateError.message}`);
    if (!open) return { skipped: 'not the 05:00 UK window' };

    const { data, error } = await db.rpc('compliance_daily');
    if (error) throw new Error(`compliance_daily: ${error.message}`);
    return (data ?? {}) as Record<string, unknown>;
  }),
);
