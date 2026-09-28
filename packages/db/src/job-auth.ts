/**
 * Who may call a job endpoint (supabase/functions/_shared/job.ts): only a
 * caller holding the service role. Pure, like willo.ts — the environment
 * and `fetch` are passed in, nothing is read from the process, and it runs
 * unchanged on Deno (ADR-0006).
 *
 * WHY NOT A STRING COMPARE. pg_cron and the Willo nudge send the vault
 * secret `service_role_key` as the bearer (docs/16 §4.7): the legacy
 * `service_role` JWT. Until 28.09.2026 this compared it byte for byte with
 * the `SUPABASE_SERVICE_ROLE_KEY` the platform injects into the function.
 * On this project that variable is not the legacy JWT — a correctly signed
 * service_role JWT for the right project was refused on every call (231 in
 * a row, every job, including the Willo invite and the outbox drain), and
 * nothing was ever sent. Supabase is moving projects to `sb_secret_…` keys
 * and the injected value is theirs to change, so the check no longer
 * depends on which form it holds:
 *
 *   1. A bearer (or `apikey` header) equal to any key the function was
 *      given — the legacy `SUPABASE_SERVICE_ROLE_KEY` or any value of
 *      `SUPABASE_SECRET_KEYS` — is the service role. Constant time.
 *   2. Otherwise, a JWT whose claims SAY service_role for THIS project is
 *      put to the platform: Auth's admin endpoint answers 200 only to the
 *      service role and checks the signature itself. The claims are read
 *      unverified, but only to skip a round trip for a token that could
 *      never pass; they decide nothing. A forged token fails at Auth.
 *      A token that passed is remembered (by SHA-256, never the token) for
 *      ten minutes in this isolate, so a job that runs every minute costs
 *      one call per isolate, not one per run.
 */

import { timingSafeEqual } from './willo.ts';

export type EnvReader = (name: string) => string | undefined;
export type Fetcher = (
  url: string,
  init: { method: string; headers: Record<string, string> },
) => Promise<{ status: number; body?: { cancel(): Promise<void> } | null }>;

const encoder = new TextEncoder();

/** The token a request presents: `Authorization: Bearer …`, else `apikey`. */
export function presentedToken(headers: { get(name: string): string | null }): string | null {
  const auth = headers.get('Authorization');
  if (auth?.startsWith('Bearer ')) {
    const token = auth.slice(7).trim();
    if (token) return token;
  }
  const apikey = headers.get('apikey')?.trim();
  return apikey ? apikey : null;
}

/**
 * Every service key the platform gave the function. `SUPABASE_SECRET_KEYS`
 * is a JSON object of name → key; a malformed one contributes nothing.
 */
export function serviceKeys(env: EnvReader): string[] {
  const keys: string[] = [];
  const legacy = env('SUPABASE_SERVICE_ROLE_KEY')?.trim();
  if (legacy) keys.push(legacy);
  const secret = env('SUPABASE_SECRET_KEYS');
  if (secret) {
    try {
      const parsed: unknown = JSON.parse(secret);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        for (const value of Object.values(parsed)) {
          if (typeof value === 'string' && value.trim()) keys.push(value.trim());
        }
      }
    } catch {
      // Not JSON: nothing to add.
    }
  }
  return keys;
}

/**
 * Constant time per key over equal lengths; every key is compared whatever
 * matched, so timing says only how many keys there are.
 */
export function matchesAnyKey(token: string, keys: string[]): boolean {
  const offered = encoder.encode(token);
  let matched = false;
  for (const key of keys) matched = timingSafeEqual(offered, encoder.encode(key)) || matched;
  return matched;
}

/** `https://<ref>.supabase.co` → `<ref>`; null for anything else. */
export function projectRef(supabaseUrl: string | undefined): string | null {
  if (!supabaseUrl) return null;
  try {
    const host = new URL(supabaseUrl).hostname;
    const match = /^([a-z0-9]+)\.supabase\.(co|in|net)$/i.exec(host);
    return match ? match[1]!.toLowerCase() : null;
  } catch {
    return null;
  }
}

/**
 * The claims of a JWT, UNVERIFIED. Used only to decide whether asking the
 * platform is worth a round trip — never to grant anything.
 */
export function unverifiedClaims(token: string): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length !== 3 || !parts[1]) return null;
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, '='));
    const claims: unknown = JSON.parse(json);
    return claims && typeof claims === 'object' && !Array.isArray(claims)
      ? (claims as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** Claims that could belong to this project's service role, and are not expired. */
export function claimsWorthChecking(
  claims: Record<string, unknown> | null,
  ref: string | null,
  nowSeconds: number,
): boolean {
  if (!claims || claims['role'] !== 'service_role') return false;
  // A legacy key names its project; a token that names another is refused
  // here. One that names none is left for the platform to judge.
  if (ref && typeof claims['ref'] === 'string' && claims['ref'].toLowerCase() !== ref) return false;
  const exp = claims['exp'];
  if (typeof exp === 'number' && exp <= nowSeconds) return false;
  return true;
}

export const VERIFIED_TTL_MS = 10 * 60 * 1000;

async function sha256Hex(text: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(text)));
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
}

export interface ServiceRoleCheckDeps {
  env: EnvReader;
  fetch: Fetcher;
  nowMs: () => number;
  /** Token hash → expiry (ms). One per isolate in production. */
  verified: Map<string, number>;
  warn?: (message: string, details?: Record<string, unknown>) => void;
}

/**
 * Ask Auth whether the token holds the service role: its admin user list
 * answers 200 to the service role only (403 to any other valid token, 401
 * to a bad signature). One user is asked for and the body is not read.
 */
async function platformSaysServiceRole(
  supabaseUrl: string,
  token: string,
  deps: ServiceRoleCheckDeps,
): Promise<boolean> {
  try {
    const answer = await deps.fetch(
      `${supabaseUrl.replace(/\/+$/, '')}/auth/v1/admin/users?page=1&per_page=1`,
      { method: 'GET', headers: { apikey: token, Authorization: `Bearer ${token}` } },
    );
    // Deno holds an unread body open; the status is all that is wanted.
    await answer.body?.cancel().catch(() => undefined);
    if (answer.status === 200) return true;
    deps.warn?.('[job] a service_role token was refused by Auth', { status: answer.status });
    return false;
  } catch (cause) {
    deps.warn?.('[job] could not reach Auth to check the caller', {
      error: cause instanceof Error ? cause.message : String(cause),
    });
    return false;
  }
}

/** Does this request carry the service role? See the file comment. */
export async function holdsServiceRole(
  headers: { get(name: string): string | null },
  deps: ServiceRoleCheckDeps,
): Promise<boolean> {
  const token = presentedToken(headers);
  if (!token) return false;

  if (matchesAnyKey(token, serviceKeys(deps.env))) return true;

  const supabaseUrl = deps.env('SUPABASE_URL');
  const now = deps.nowMs();
  if (!supabaseUrl) return false;
  if (!claimsWorthChecking(unverifiedClaims(token), projectRef(supabaseUrl), now / 1000)) {
    return false;
  }

  const hash = await sha256Hex(token);
  const until = deps.verified.get(hash);
  if (until !== undefined && until > now) return true;

  const ok = await platformSaysServiceRole(supabaseUrl, token, deps);
  if (ok) deps.verified.set(hash, now + VERIFIED_TTL_MS);
  else deps.verified.delete(hash);
  return ok;
}
