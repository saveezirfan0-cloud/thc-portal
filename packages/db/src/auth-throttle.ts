// Build-time fence (security.md Invariant 8): this module holds the
// service-role client, so it must never reach a browser bundle.
import 'server-only';
import { createAdminClient } from './admin';

/**
 * Per-account throttle on sign-in, forgot-password and the Back Office's
 * two-step code — the three places a guess is made against one login.
 *
 * GoTrue limits by caller IP, and every sign-in reaches it from a Vercel
 * function, so that limit is shared by every user of an app and stops
 * nobody in particular. These counters are kept in the database instead,
 * behind two SERVICE-ROLE-ONLY functions:
 *
 *   auth_attempt_allowed(p_kind, p_key_hash) → boolean
 *   record_auth_attempt(p_kind, p_key_hash, p_failed) → void
 *
 *   'sign_in'     5 failures per 15 minutes, per account
 *   'sign_in_ip'  30 failures per 15 minutes, per caller address — looser,
 *                 because a venue's Wi-Fi or the office's NAT is one address
 *                 for many honest people
 *   'recover'  3 requests per hour — every request counts
 *   'verify'   5 wrong codes per 15 minutes
 *
 * Keys are never stored in the clear: a key is the lowercase hex SHA-256
 * of the normalised email (trimmed, lowercased), of `ip:<address>` for the
 * caller, or of the user id for 'verify'.
 *
 * FAILS OPEN on an error (the RPC missing, the database unreachable, the
 * service key unset), with a console.error: a database hiccup must not lock
 * every user out of every app. A definite `false` is always honoured.
 *
 * The caller decides what a refusal looks like, and on sign-in and forgot
 * it is the SAME answer as a wrong password / a sent link (§1.7): a
 * different message would say the account exists.
 */

export type AuthAttemptKind = 'sign_in' | 'sign_in_ip' | 'recover' | 'verify';

/** A key counted under the call's kind, or under a kind of its own. */
export type ThrottleKey = string | { kind: AuthAttemptKind; key: string };

function keyKind(kind: AuthAttemptKind, key: ThrottleKey): [AuthAttemptKind, string] {
  return typeof key === 'string' ? [kind, key] : [key.kind, key.key];
}

/** The throttle's RPCs, typed here so this file does not depend on the generated types. */
interface ThrottleRpc {
  rpc(
    fn: 'auth_attempt_allowed' | 'record_auth_attempt' | 'clear_sign_in_failures',
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

const encoder = new TextEncoder();

/** Lowercase hex SHA-256 of a string. */
export async function sha256Hex(value: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
  let out = '';
  for (const byte of digest) out += byte.toString(16).padStart(2, '0');
  return out;
}

/** The email as every auth form normalises it. */
export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function emailKey(email: string): Promise<string> {
  return sha256Hex(normaliseEmail(email));
}

export function ipKey(ip: string): Promise<string> {
  return sha256Hex(`ip:${ip}`);
}

export function userKey(userId: string): Promise<string> {
  return sha256Hex(userId);
}

interface HeaderReader {
  get(name: string): string | null;
}

/**
 * The caller's address: Vercel's own `x-vercel-forwarded-for` first, which a
 * client cannot set, then the first entry of `x-forwarded-for`. Null when
 * neither is there (a test, a bare `next start` with no proxy).
 */
export function callerIp(headers: HeaderReader | null | undefined): string | null {
  for (const name of ['x-vercel-forwarded-for', 'x-forwarded-for']) {
    const first = headers?.get(name)?.split(',')[0]?.trim();
    if (first) return first;
  }
  return null;
}

function client(): ThrottleRpc {
  return createAdminClient() as unknown as ThrottleRpc;
}

function logFailOpen(what: string, kind: AuthAttemptKind, cause: unknown): void {
  console.error(`[auth-throttle] ${what} failed; letting the attempt through`, {
    kind,
    error: cause instanceof Error ? cause.message : String(cause),
  });
}

/**
 * May an attempt of `kind` be made for every one of `keys`? False only when
 * the database says false for at least one; true on any error (fail open).
 */
export async function authAttemptAllowed(
  kind: AuthAttemptKind,
  keys: readonly ThrottleKey[],
): Promise<boolean> {
  if (keys.length === 0) return true;
  try {
    const db = client();
    const answers = await Promise.all(
      keys.map(async (entry) => {
        const [k, key] = keyKind(kind, entry);
        const { data, error } = await db.rpc('auth_attempt_allowed', {
          p_kind: k,
          p_key_hash: key,
        });
        if (error) throw new Error(error.message);
        return data;
      }),
    );
    return !answers.some((answer) => answer === false);
  } catch (cause) {
    logFailOpen('auth_attempt_allowed', kind, cause);
    return true;
  }
}

/** Count an attempt against every key. Never throws. */
export async function recordAuthAttempt(
  kind: AuthAttemptKind,
  keys: readonly ThrottleKey[],
  failed: boolean,
): Promise<void> {
  if (keys.length === 0) return;
  try {
    const db = client();
    await Promise.all(
      keys.map(async (entry) => {
        const [k, key] = keyKind(kind, entry);
        const { error } = await db.rpc('record_auth_attempt', {
          p_kind: k,
          p_key_hash: key,
          p_failed: failed,
        });
        if (error) throw new Error(error.message);
      }),
    );
  } catch (cause) {
    logFailOpen('record_auth_attempt', kind, cause);
  }
}

/**
 * A GoTrue sign-in refusal that is a guess, not an outage: a wrong password
 * (400 `invalid_credentials`) and any other 4xx except GoTrue's own 429. A
 * 5xx or a network error is not the user's attempt and does not count.
 */
export function isCredentialFailure(error: { status?: number; code?: string } | null): boolean {
  if (!error) return false;
  if (error.code === 'invalid_credentials') return true;
  const status = error.status ?? 0;
  return status >= 400 && status < 500 && status !== 429;
}

// ---------------------------------------------------------------------
// The three call sites, so each app's action is two lines
// ---------------------------------------------------------------------

/**
 * The keys a sign-in is counted under: the account, and the caller's
 * address under its own, looser 'sign_in_ip' limit.
 */
export async function signInKeys(email: string, ip: string | null): Promise<ThrottleKey[]> {
  const account = await emailKey(email);
  return ip ? [account, { kind: 'sign_in_ip', key: await ipKey(ip) }] : [account];
}

/**
 * Forgot password: may a link be sent to this address? Every request that
 * is let through is counted (`p_failed` true: a request IS the spend), so
 * the fourth in an hour is answered exactly like the first, with no email.
 */
export async function recoveryRequestAllowed(email: string): Promise<boolean> {
  const keys = [await emailKey(email)];
  if (!(await authAttemptAllowed('recover', keys))) return false;
  await recordAuthAttempt('recover', keys, true);
  return true;
}

/**
 * A password was just set from an emailed one-time link (reset, activation,
 * invitation): forget the account's sign-in failures. Without this, the
 * wrong guesses made BEFORE the reset keep the new password refused, with
 * the wrong-password words, for up to 15 minutes (20261015140000). Only the
 * account's 'sign_in' count; the address, code and reset counts stay.
 * Never throws: the password is already set, and a failure here only means
 * the lockout runs out on its own.
 */
export async function clearSignInFailures(email: string | null | undefined): Promise<void> {
  if (!email?.trim()) return;
  try {
    const { error } = await client().rpc('clear_sign_in_failures', {
      p_key_hash: await emailKey(email),
    });
    if (error) throw new Error(error.message);
  } catch (cause) {
    console.error('[auth-throttle] clear_sign_in_failures failed', {
      error: cause instanceof Error ? cause.message : String(cause),
    });
  }
}

/**
 * The current-password check a signed-in user makes before a sensitive
 * change (Change password, and the Staff App's bank / P45 / email step,
 * ADR-0113). It counts under the account's own 'sign_in' key, so a stolen
 * session cannot guess the password faster than the sign-in form allows.
 * Same fail-open rule as above.
 */
export async function currentPasswordCheckAllowed(email: string): Promise<boolean> {
  return authAttemptAllowed('sign_in', [await emailKey(email)]);
}

export async function recordCurrentPasswordFailure(email: string): Promise<void> {
  await recordAuthAttempt('sign_in', [await emailKey(email)], true);
}
