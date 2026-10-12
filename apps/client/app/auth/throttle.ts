import 'server-only';
import { createHmac } from 'node:crypto';
import { createAdminClient } from '@thc/db/admin';

/**
 * The Client Portal's sign-in and reset-email throttle (§1.4, §10.2, §1.7;
 * ADR-0115; supabase/migrations/20261012120200_client_auth_throttles.sql).
 *
 * Every request this app makes to Supabase Auth leaves from Vercel's
 * addresses, so Supabase's own per-IP limits bind every customer at once
 * rather than the one guessing. Before /login calls signInWithPassword and
 * before /forgot calls resetPasswordForEmail, one slot is taken per key:
 *
 *   · the lower-cased email the form was given;
 *   · the caller's address, the first hop of x-forwarded-for (Vercel sets
 *     it and does not pass a client's own value through), else x-real-ip,
 *     with IPv6 keyed by its /64 — the same reading /apply uses
 *     (apps/staff/app/apply/caller.ts, ADR-0024).
 *
 * Neither leaves this file: what is sent is an HMAC-SHA256 of each under
 * SUPABASE_SERVICE_ROLE_KEY, which the call needs anyway and which is
 * server-only. The database refuses anything that is not a 64-hex digest.
 *
 * `auth_attempt_take` is service-role only, as /apply's limit is: a digest
 * anybody could send would be a limit anybody could fill for somebody else.
 *
 * When the throttle cannot run — no service key on the deployment, or the
 * call fails — the answer is 'unavailable' and the action carries on, with
 * the reason logged as an error. That is the documented trade (ADR-0115):
 * this limit is defence in depth in front of Supabase Auth, which still
 * checks the password and still applies its own limits; failing closed
 * would turn a missing environment variable into every customer locked out
 * of the portal and out of password reset at once.
 */

export type ThrottleAction = 'login' | 'reset';
export type ThrottleOutcome = 'allowed' | 'blocked' | 'unavailable';

/** The one answer to a throttled attempt. Says nothing about the account. */
export const THROTTLED = 'Too many attempts. Wait a few minutes and try again.';

export interface HeaderGetter {
  get(name: string): string | null;
}

/** The caller's address from the request headers, or null. */
export function callerAddress(headers: HeaderGetter | null | undefined): string | null {
  const forwarded = headers?.get('x-forwarded-for');
  const first = forwarded?.split(',')[0]?.trim();
  if (first) return first;
  const real = headers?.get('x-real-ip')?.trim();
  return real ? real : null;
}

function expandIpv6(address: string): string[] | null {
  const [head = '', tail, extra] = address.split('::');
  if (extra !== undefined) return null;
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  if (tail === undefined) return left.length === 8 ? left : null;
  const missing = 8 - left.length - right.length;
  if (missing < 1) return null;
  return [...left, ...Array<string>(missing).fill('0'), ...right];
}

/**
 * The part of an address that identifies one caller: IPv4 as is, IPv6 by
 * its /64, an IPv4-mapped address as its IPv4 address. Anything else is
 * used verbatim — still hashed, still bounded.
 */
export function callerBucket(address: string): string {
  const text = address
    .trim()
    .replace(/^\[|\]$/g, '')
    .split('%')[0]!;
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(text);
  if (mapped) return mapped[1]!;
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(text)) return text;
  if (text.includes(':')) {
    const groups = expandIpv6(text.toLowerCase());
    if (groups && groups.every((g) => /^[0-9a-f]{1,4}$/.test(g))) {
      return `${groups
        .slice(0, 4)
        .map((g) => g.replace(/^0+(?=.)/, ''))
        .join(':')}::/64`;
    }
  }
  return text;
}

/** HMAC-SHA256, hex, with the kind in the message so an email and an address never collide. */
export function throttleDigest(secret: string, kind: 'email' | 'caller', value: string): string {
  return createHmac('sha256', secret)
    .update(`thc-client-auth-throttle|${kind}|${value}`)
    .digest('hex');
}

interface ThrottleRpc {
  rpc(
    fn: 'auth_attempt_take',
    args: { p_action: ThrottleAction; p_email_hash: string | null; p_caller_hash: string | null },
  ): PromiseLike<{ data: unknown; error: { code?: string; message: string } | null }>;
}

/**
 * Take one attempt for this email and caller. 'blocked' means do not call
 * Supabase Auth at all.
 */
export async function takeAuthAttempt(
  action: ThrottleAction,
  email: string,
  headers: HeaderGetter | null | undefined,
): Promise<ThrottleOutcome> {
  const secret = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!secret) {
    console.error(
      `[throttle] SUPABASE_SERVICE_ROLE_KEY is not set — the ${action} throttle is OFF on this deployment. Set it in the Vercel env vars.`,
    );
    return 'unavailable';
  }

  const normalised = email.trim().toLowerCase();
  const address = callerAddress(headers);
  try {
    const admin = createAdminClient() as unknown as ThrottleRpc;
    const { data, error } = await admin.rpc('auth_attempt_take', {
      p_action: action,
      p_email_hash: normalised ? throttleDigest(secret, 'email', normalised) : null,
      p_caller_hash: address ? throttleDigest(secret, 'caller', callerBucket(address)) : null,
    });
    if (error) {
      console.error(`[throttle] ${action} limit could not be taken`, {
        code: error.code,
        message: error.message,
      });
      return 'unavailable';
    }
    if (data === true) return 'allowed';
    if (data === false) return 'blocked';
    console.error(`[throttle] ${action} limit gave an unexpected answer`, { data });
    return 'unavailable';
  } catch (error) {
    console.error(`[throttle] ${action} limit could not be taken`, {
      message: error instanceof Error ? error.message : String(error),
    });
    return 'unavailable';
  }
}
