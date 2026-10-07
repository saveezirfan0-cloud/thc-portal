/**
 * How many passes of the runner may be in flight at once.
 *
 * pg_cron fires the route every minute (20261006170000) and a pass can take
 * up to `maxDuration` (300 s), so passes overlap whenever there is real work.
 * That is safe for the data — claiming is `skip locked` with a lease — but
 * each pass runs two checks at a time, each in its own headless browser,
 * and nothing capped the number of passes. A pass that finds the cap reached
 * returns at once without a job_runs row; the next minute's pass picks the
 * work up.
 */

/** A pass older than this is a crashed one, not a running one (route maxDuration is 300 s). */
export const PASS_IN_FLIGHT_SECONDS = 360;

export const DEFAULT_MAX_PASSES = 2;

/** `RTW_CHECK_MAX_PASSES`: a whole number 1–6; anything else is the default. */
export function maxPasses(raw: string | undefined): number {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= 6 ? n : DEFAULT_MAX_PASSES;
}

/** Whether a new pass should stand down because enough are already running. */
export function passIsBusy(running: number | null | undefined, max: number): boolean {
  return typeof running === 'number' && running >= max;
}

/** The earliest start time that still counts as "in flight", as an ISO string. */
export function inFlightSince(now: Date = new Date()): string {
  return new Date(now.getTime() - PASS_IN_FLIGHT_SECONDS * 1000).toISOString();
}
