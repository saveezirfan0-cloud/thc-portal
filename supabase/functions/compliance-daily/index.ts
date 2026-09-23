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
 * The 05:00 gate is the one thing this file would get wrong if it tried,
 * so it does not: `compliance_daily_due()` decides, and pgTAP holds it.
 * pg_cron runs on UTC and 05:00 UK is 04:00 UTC for half the year and
 * 05:00 UTC for the other half, so the schedule is an every-5-minute
 * entry. Without a gate this would run 288 times a day; the SQL is
 * idempotent, so the cost would be 288 sweeps rather than 288 blocks —
 * but a block is not something to leave resting on an idempotency key
 * alone. The gate also lets a MISSED 05:00 run later the same day, so a
 * deploy across the window does not defer a §4.3 block by 24 hours.
 */

import { runJob } from '../_shared/job.ts';

Deno.serve((request) =>
  runJob('compliance-daily', request, async (db) => {
    const { data: due, error: gateError } = await db.rpc('compliance_daily_due', {
      p_now: new Date().toISOString(),
    });
    if (gateError) throw new Error(`compliance_daily_due: ${gateError.message}`);
    if (!due) return { skipped: "not the 05:00 UK window, and today's sweep has already run" };

    const { data, error } = await db.rpc('compliance_daily');
    if (error) throw new Error(`compliance_daily: ${error.message}`);

    // The completion letter requirement's daily half (20260923100100): the
    // 60/30/14-day right-to-work alerts to the office (§2.3) and the purge
    // of completion letters whose employment + 2 years hold has run out
    // (§4, ADR-0019). Same gate, same run: both are dated by the UK day.
    const { data: rtw, error: rtwError } = await db.rpc('rtw_daily');
    if (rtwError) throw new Error(`rtw_daily: ${rtwError.message}`);

    return {
      ...((data ?? {}) as Record<string, unknown>),
      ...((rtw ?? {}) as Record<string, unknown>),
    };
  }),
);
