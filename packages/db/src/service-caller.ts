/**
 * Is the caller of a §7 job the service role? — the check every job in
 * `supabase/functions/_shared/job.ts` (and willo-webhook's `/invite`)
 * runs before it does anything. Pure, so vitest holds it; the Edge
 * Functions import it by relative path (ADR-0006).
 *
 * pg_cron sends `Authorization: Bearer <vault.service_role_key>`. The old
 * check demanded that string equal the function's own
 * `SUPABASE_SERVICE_ROLE_KEY`, byte for byte. On the live project the two
 * are both valid service-role keys for the project and still differ (28.09:
 * every job answered 401 "service role required" while Supabase's own
 * gateway had accepted the key), and Supabase shows no digest of its
 * built-in secret to compare them by. So:
 *
 *   1. equal to the function's key → yes, at once (constant time);
 *   2. otherwise, a token whose claims say `service_role` for THIS project
 *      is put to Supabase Auth itself (`confirm`, an admin call only a
 *      genuine service key passes). The claims are read unverified only to
 *      avoid asking Auth about user and anon tokens; Auth's answer is the
 *      check.
 */

import { timingSafeEqual } from './willo.ts';

const encoder = new TextEncoder();

/** The bearer token, or '' when there is none. */
export function bearerToken(header: string | null): string {
  if (!header?.startsWith('Bearer ')) return '';
  return header.slice(7).trim();
}

/** A JWT's payload, NOT verified. Null for anything that is not a JWT. */
export function unverifiedClaims(token: string): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length !== 3 || !parts[1]) return null;
  const normal = parts[1].replace(/-/g, '+').replace(/_/g, '/');
  try {
    const json = atob(normal.padEnd(Math.ceil(normal.length / 4) * 4, '='));
    const claims: unknown = JSON.parse(json);
    return typeof claims === 'object' && claims !== null && !Array.isArray(claims)
      ? (claims as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** `https://<ref>.supabase.co` → `<ref>`; null for anything else (local). */
export function projectRef(supabaseUrl: string | undefined): string | null {
  const match = supabaseUrl?.match(/^https:\/\/([a-z0-9]+)\.supabase\.co\/?$/);
  return match?.[1] ?? null;
}

export interface ServiceCallerCheck {
  /** The function's own `SUPABASE_SERVICE_ROLE_KEY`. */
  expected: string | undefined;
  /** The project the token must name, when known. */
  ref: string | null;
  /** Ask Supabase Auth whether this token is a working service key. */
  confirm: (token: string) => Promise<boolean>;
}

export async function isServiceCaller(
  header: string | null,
  check: ServiceCallerCheck,
): Promise<boolean> {
  const token = bearerToken(header);
  if (!token) return false;
  if (check.expected && timingSafeEqual(encoder.encode(token), encoder.encode(check.expected))) {
    return true;
  }
  const claims = unverifiedClaims(token);
  if (claims?.['role'] !== 'service_role') return false;
  if (check.ref && claims['ref'] !== check.ref) return false;
  try {
    return await check.confirm(token);
  } catch {
    return false;
  }
}
