/**
 * Who may call a §7 job Edge Function (supabase/functions/_shared/job.ts).
 *
 * Pure, so vitest holds it; the Deno wrapper imports this file directly.
 *
 * Two ways in, either is enough:
 *
 *   1. `x-job-secret` equal to JOB_SECRET — a secret of our own, also in
 *      the vault as job_secret, which pg_cron and the two nudges send
 *      (20261001205000). This is the one production relies on: the key
 *      the Functions runtime injects as SUPABASE_SERVICE_ROLE_KEY is not
 *      the legacy service_role JWT the vault holds, so (2) never matched
 *      on the live project and every job answered 401.
 *   2. `Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>` — as before;
 *      it still holds in local development and tests.
 *
 * An unset or empty expected value never matches, whatever is presented:
 * without JOB_SECRET only (2) can let a caller in.
 */

import { timingSafeEqual } from './willo.ts';

const encoder = new TextEncoder();

export interface JobCaller {
  authorization: string | null;
  jobSecret: string | null;
}

export interface JobKeys {
  serviceRoleKey: string | undefined;
  jobSecret: string | undefined;
}

/**
 * The presented value equals the expected one. Constant time over
 * equal-length inputs (timingSafeEqual visits every byte whatever the
 * first difference), so the response time never says how long a prefix a
 * guess shared.
 */
export function secretMatches(presented: string | null, expected: string | undefined): boolean {
  if (!expected || !presented) return false;
  return timingSafeEqual(encoder.encode(presented), encoder.encode(expected));
}

/** The bearer the caller presented equals the expected key. */
export function bearerMatches(header: string | null, expected: string | undefined): boolean {
  const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
  return secretMatches(token, expected);
}

export function jobCallerAuthorised(caller: JobCaller, keys: JobKeys): boolean {
  // Both evaluated, so which one matched is not visible in the timing.
  const bySecret = secretMatches(caller.jobSecret, keys.jobSecret);
  const byBearer = bearerMatches(caller.authorization, keys.serviceRoleKey);
  return bySecret || byBearer;
}
